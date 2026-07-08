import { lstatSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { onFlowGoalCompleted } from "./flow/completion.js";
import {
	isWorkerContext,
	registerWorkerRuntime,
	startPrivateWorkerFromEnv,
} from "./flow/execution/worker-command.js";
import { goFlow, handleGoalCompletionEnd, stopFlow } from "./flow/execution.js";
import {
	consumeFlowClarificationInput,
	ensureFlowGenerationPromptModel,
	goFlowGeneration,
	handleGenerationEnd,
	recordFlowPromptSendFailure,
	rememberFlowGenerationPromptContext,
	startFromFile,
	startGeneration,
	stripGenerationPromptMarkerFromMessage,
} from "./flow/generation.js";
import { flowOwnerForSession } from "./flow/ownership.js";
import {
	rememberCompletionFact,
	rememberedFlowContext,
} from "./flow/runtime.js";
import { showStatus } from "./flow/status-command.js";
import { isFlowId } from "./flow/store.js";
import { tokenize } from "./flow/util.js";
import { closeFlowGoalWatcher } from "./flow/watcher.js";
import { cancelGoalRecoveryAfterUserAction } from "./goal/runtime.js";
import { setGoalActivityBox } from "./shared/activity-frame.js";
import { generationStartOptions } from "./shared/generation-alignment.js";
import {
	appendVisibleUserInput,
	sendOrchestrationPrompt,
} from "./shared/internal-prompt.js";
import { liveReportUrl } from "./shared/report-server.js";
import {
	formatUserNotice,
	installLocalizedUi,
	localizeUserText,
	notifyUser,
} from "./shared/ui-language.js";

let currentApi: ExtensionAPI | undefined;
let completionListenerRegistered = false;

export default function flowExtension(pi: ExtensionAPI) {
	currentApi = pi;
	registerWorkerRuntime(pi);
	registerFlowCompletionListener();
	pi.registerCommand("flow", {
		description:
			localizeUserText("生成并执行单步或多步任务：/flow [需求|path.md]") ??
			"生成并执行单步或多步任务：/flow [需求|path.md]",
		handler: (args, ctx) =>
			Promise.resolve(handleFlowCommand(pi, args, ctx)).then(() => undefined),
	});
	pi.on("session_start", async (_event, ctx) => {
		await bindOwnedFlowReportStatus(ctx);
		await startPrivateWorkerFromEnv(pi, ctx);
	});
	pi.on("message_end", (event, ctx) =>
		stripGenerationPromptMarkerFromMessage(event, ctx),
	);
	pi.on("agent_end", async (event, ctx) => {
		const generated = await handleGenerationEnd(pi, ctx, event);
		if (generated?.autoStart) {
			if (canAutoStartFlow(generated.startContext))
				await goFlow(pi, generated.startContext, generated.id);
			else notifyAutoStartUnavailable(ctx, generated);
			return;
		}
		if (!isWorkerContext(ctx)) await handleGoalCompletionEnd(pi, ctx);
	});
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return;
		const action = consumeFlowClarificationInput(event.text, ctx);
		if (!action) return;
		setGoalActivityBox(ctx, action.activityBox);
		if (action.kind === "handled") return { action: "handled" as const };
		if (action.showUserInput)
			appendVisibleUserInput(pi, event.text, {
				streamingBehavior: event.streamingBehavior,
			});
		if (!(await ensureFlowGenerationPromptModel(pi, ctx, action)))
			return { action: "handled" as const };
		const sent = await sendOrchestrationPrompt(pi, ctx, action.prompt, {
			followUp: true,
			errorPrefix: "Flow 计划澄清提示发送失败",
		});
		if (sent) rememberFlowGenerationPromptContext(action, ctx);
		else recordFlowPromptSendFailure(action, ctx);
		return { action: "handled" as const };
	});
	pi.on("session_shutdown", (_event, ctx) => {
		const owner = flowOwnerForSession(ctx);
		if (owner) closeFlowGoalWatcher(owner.dir);
	});
}

function registerFlowCompletionListener() {
	if (completionListenerRegistered) return;
	completionListenerRegistered = true;
	onFlowGoalCompleted((fact, emittedCtx) => {
		if (isWorkerContext(emittedCtx)) return;
		rememberCompletionFact(fact);
		const ctx = emittedCtx
			? (emittedCtx as ExtensionContext)
			: rememberedFlowContext(fact.sessionFile);
		if (currentApi && ctx) void handleGoalCompletionEnd(currentApi, ctx, fact);
	});
}

async function bindOwnedFlowReportStatus(ctx: ExtensionContext) {
	try {
		const owner = flowOwnerForSession(ctx);
		if (owner)
			await liveReportUrl(
				ctx,
				join(owner.dir, "flow.html"),
				owner.flow.language,
			);
	} catch {}
}

async function handleFlowCommand(
	pi: ExtensionAPI,
	args: string,
	ctx: ExtensionCommandContext,
) {
	installLocalizedUi(ctx);
	cancelGoalRecoveryAfterUserAction(ctx);
	const tokens = tokenize(args.trim());
	const [command, ...rest] = tokens;
	if (!command) {
		const options = await generationStartOptions(ctx);
		if (!options) return;
		await startGeneration(pi, ctx, "", "conversation", undefined, options);
		return;
	}
	if (command === "go" && isFlowControlInvocation(rest)) {
		if (await goFlowGeneration(pi, ctx, rest[0])) return;
		return goFlow(pi, ctx, rest[0]);
	}
	if (command === "stop" && isFlowControlInvocation(rest))
		return stopFlow(ctx, rest[0]);
	if (command === "status" && isFlowControlInvocation(rest))
		return showStatus(ctx, rest[0]);
	const options = await generationStartOptions(ctx);
	if (!options) return;
	if (tokens.length === 1 && isFile(ctx.cwd, command))
		return startFromFile(pi, ctx, [command], options);
	return startGeneration(pi, ctx, args.trim(), "prompt", undefined, options);
}

function isFlowControlInvocation(args: string[]) {
	return (
		args.length === 0 || (args.length === 1 && isFlowTargetArgument(args[0]))
	);
}

function isFlowTargetArgument(arg: string) {
	return isFlowId(arg) || /^F\d/iu.test(arg) || isUnsafePathArgument(arg);
}

function isUnsafePathArgument(arg: string) {
	return (
		isAbsolute(arg) ||
		/^[A-Za-z]:[\\/]/u.test(arg) ||
		/^\.\.?$/u.test(arg) ||
		/^\.\.?[\\/]/u.test(arg)
	);
}

function canAutoStartFlow(
	ctx: ExtensionCommandContext | undefined,
): ctx is ExtensionCommandContext {
	return typeof ctx?.newSession === "function";
}

function notifyAutoStartUnavailable(
	ctx: ExtensionContext,
	flow: { id: string; language: "zh" | "en" },
) {
	const command = `/flow go ${flow.id}`;
	notifyUser(
		ctx,
		autoStartUnavailableNotice(flow.id, command, flow.language),
		"info",
		flow.language,
	);
}

function autoStartUnavailableNotice(
	id: string,
	command: string,
	language: "zh" | "en",
) {
	return language === "en"
		? formatUserNotice("⚠️", `Flow ${id} plan generated`, [
				"Pi cannot auto-start it from here",
				`Run ${command} to start`,
			])
		: formatUserNotice("⚠️", `Flow ${id} 计划已生成`, [
				"当前会话不能自动启动",
				`运行 ${command} 启动`,
			]);
}

function isFile(cwd: string, path: string) {
	try {
		return lstatSync(resolve(cwd, path)).isFile();
	} catch {
		return false;
	}
}
