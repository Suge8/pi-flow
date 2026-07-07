import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
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
import {
	cancelFlow,
	continueFlow,
	handleGoalCompletionEnd,
	pauseFlow,
	startFlow,
} from "./flow/execution.js";
import {
	clearFlowGeneration,
	consumeFlowClarificationInput,
	continueFlowGeneration,
	ensureFlowGenerationPromptModel,
	handleGenerationEnd,
	recordFlowPromptSendFailure,
	rememberFlowGenerationPromptContext,
	startFromFile,
	startGeneration,
} from "./flow/generation.js";
import { flowOwnerForSession } from "./flow/ownership.js";
import {
	rememberCompletionFact,
	rememberedFlowContext,
} from "./flow/runtime.js";
import { showStatus } from "./flow/status-command.js";
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
	pi.on("agent_end", async (event, ctx) => {
		const generated = await handleGenerationEnd(pi, ctx, event);
		if (generated?.autoStart) {
			if (canAutoStartFlow(generated.startContext))
				await startFlow(pi, generated.startContext, generated.id);
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
	if (command === "start") {
		if (rest.length > 1)
			return ctx.ui.notify("用法：/flow start [id]", "warning");
		return startFlow(pi, ctx, rest[0]);
	}
	if (command === "status") {
		if (rest.length > 1)
			return ctx.ui.notify("用法：/flow status [id]", "warning");
		return showStatus(ctx, rest[0]);
	}
	if (command === "pause") {
		if (rest.length > 1)
			return ctx.ui.notify("用法：/flow pause [id]", "warning");
		return pauseFlow(ctx, rest[0]);
	}
	if (command === "continue") {
		if (rest.length > 1)
			return ctx.ui.notify("用法：/flow continue [id]", "warning");
		if (await continueFlowGeneration(pi, ctx, rest[0])) return;
		return continueFlow(pi, ctx, rest[0]);
	}
	if (command === "cancel") {
		if (rest.length > 1)
			return ctx.ui.notify("用法：/flow cancel [id]", "warning");
		const cancelled = clearFlowGeneration(ctx, rest[0]);
		if (cancelled)
			return notifyUser(
				ctx,
				flowGenerationCancelledMessage(cancelled.language),
				"warning",
				cancelled.language,
			);
		return cancelFlow(ctx, rest[0]);
	}
	const options = await generationStartOptions(ctx);
	if (!options) return;
	if (tokens.length === 1 && isFile(ctx.cwd, command))
		return startFromFile(pi, ctx, [command], options);
	return startGeneration(pi, ctx, args.trim(), "prompt", undefined, options);
}

function flowGenerationCancelledMessage(language: "zh" | "en") {
	return language === "en"
		? "Flow plan generation cancelled."
		: "Flow 计划生成已取消。";
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
	const command = `/flow start ${flow.id}`;
	notifyUser(
		ctx,
		flow.language === "en"
			? `Flow ${flow.id} plan generated; Pi cannot auto-start it from here. Run ${command} to start.`
			: `Flow ${flow.id} 计划已生成；当前会话不能自动启动。运行 ${command} 启动。`,
		"warning",
		flow.language,
	);
}

function isFile(cwd: string, path: string) {
	try {
		return lstatSync(resolve(cwd, path)).isFile();
	} catch {
		return false;
	}
}
