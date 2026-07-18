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
	deliverFlowGenerationPrompt,
	goFlowGeneration,
	handleGenerationEnd,
	releaseFlowGenerationSession,
	resetFlowGenerationRuntime,
	startFromFile,
	startGeneration,
	stripGenerationPromptMarkerFromMessage,
} from "./flow/generation.js";
import { currentSessionFile, flowOwnerForSession } from "./flow/ownership.js";
import {
	activeParallelBatchForDir,
	cancelParallelBatch,
} from "./flow/parallel/batch-runner.js";
import {
	isAllowedParallelConsoleInput,
	parallelConsoleInputNotice,
	quoteCommand,
} from "./flow/parallel/console.js";
import {
	closeParallelLaneBoard,
	showParallelLaneBoard,
} from "./flow/parallel/lane-ui.js";
import { resetPrewalkRuntime } from "./flow/prewalk.js";
import {
	releaseFlowContext,
	rememberCompletionFact,
	rememberedFlowContext,
	rememberFlowContext,
	resetFlowRuntime,
} from "./flow/runtime.js";
import {
	cancelSessionTransition,
	requestSessionTransition,
} from "./flow/session-transition.js";
import { showStatus } from "./flow/status-command.js";
import { isFlowId } from "./flow/store.js";
import { tokenize } from "./flow/util.js";
import { closeFlowGoalWatcher } from "./flow/watcher.js";
import { cancelGoalRecoveryAfterUserAction } from "./goal/runtime.js";
import { setGoalActivityBox } from "./shared/activity-frame.js";
import { generationStartOptions } from "./shared/generation-alignment.js";
import { formatError } from "./shared/guards.js";
import { appendVisibleUserInput } from "./shared/internal-prompt.js";
import {
	bindLiveReport,
	releaseReportStatusContext,
} from "./shared/report-client.js";
import { registerRuntimePart } from "./shared/runtime-registration.js";
import {
	formatUserNotice,
	installLocalizedUi,
	localizeUserText,
	notifyUser,
} from "./shared/ui-language.js";

let currentApi: ExtensionAPI | undefined;
let completionListenerRegistered = false;

export default function flowExtension(pi: ExtensionAPI) {
	registerFlowRuntime(pi);
	pi.registerCommand("flow", {
		description:
			localizeUserText("生成并执行单步或多步任务：/flow [需求|path.md]") ??
			"生成并执行单步或多步任务：/flow [需求|path.md]",
		handler: (args, ctx) =>
			Promise.resolve(handleFlowCommand(pi, args, ctx)).then(() => undefined),
	});
	pi.on("session_start", (_event, ctx) => handleFlowSessionStart(pi, ctx));
}

export function registerFlowRuntime(pi: ExtensionAPI) {
	registerRuntimePart(pi, "flow:initialize", () => {
		resetFlowGenerationRuntime();
		resetFlowRuntime();
		resetPrewalkRuntime();
		currentApi = pi;
		registerWorkerRuntime(pi);
		registerFlowCompletionListener();
	});
	registerRuntimePart(pi, "flow:message_end", () => {
		pi.on("message_end", (event, ctx) =>
			stripGenerationPromptMarkerFromMessage(event, ctx),
		);
	});
	registerRuntimePart(pi, "flow:agent_end", () => {
		pi.on("agent_end", async (event, ctx) => {
			const generated = await handleGenerationEnd(pi, ctx, event);
			if (generated?.autoStart) {
				requestGeneratedFlowStart(pi, ctx, generated);
				return;
			}
			if (!isWorkerContext(ctx)) await handleGoalCompletionEnd(pi, ctx);
		});
	});
	registerRuntimePart(pi, "flow:input", () => {
		pi.on("input", async (event, ctx) => {
			if (event.source === "extension") return;
			const consoleFlow = parallelConsoleFlowForInput(ctx);
			if (consoleFlow) {
				if (isAllowedParallelConsoleInput(event.text, consoleFlow)) return;
				notifyUser(
					ctx,
					parallelConsoleInputNotice(consoleFlow),
					"info",
					consoleFlow.language,
				);
				return { action: "handled" as const };
			}
			const action = consumeFlowClarificationInput(event.text, ctx);
			if (!action) return;
			setGoalActivityBox(ctx, action.activityBox);
			if (action.kind === "handled") return { action: "handled" as const };
			const promptAction =
				action.kind === "pending" ? await action.continuation : action;
			if (!promptAction) return { action: "handled" as const };
			setGoalActivityBox(ctx, promptAction.activityBox);
			if (promptAction.showUserInput)
				appendVisibleUserInput(pi, event.text, {
					streamingBehavior: event.streamingBehavior,
				});
			await deliverFlowGenerationPrompt(
				pi,
				ctx,
				promptAction,
				"Flow 计划澄清提示发送失败",
			);
			return { action: "handled" as const };
		});
	});
	registerRuntimePart(pi, "flow:session_shutdown", () => {
		pi.on("session_shutdown", (_event, ctx) => {
			const sessionFile = currentSessionFile(ctx);
			cancelSessionTransition(sessionFile);
			releaseFlowContext(sessionFile);
			releaseFlowGenerationSession(ctx);
			releaseReportStatusContext(ctx);
			closeParallelLaneBoard(ctx);
			const owner = flowOwnerForSession(ctx);
			if (!owner) return;
			if (
				owner.flow.parallelRun?.consoleSessionFile === currentSessionFile(ctx)
			)
				cancelParallelBatch(owner.dir);
			closeFlowGoalWatcher(owner.dir);
		});
	});
}

export async function handleFlowSessionStart(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
) {
	await bindOwnedFlowReportStatus(ctx);
	await startPrivateWorkerFromEnv(pi, ctx);
	showOwnedParallelConsole(ctx);
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

function bindOwnedFlowReportStatus(ctx: ExtensionContext) {
	try {
		const owner = flowOwnerForSession(ctx);
		if (owner)
			bindLiveReport(ctx, join(owner.dir, "flow.html"), owner.flow.language);
	} catch {}
}

function showOwnedParallelConsole(ctx: ExtensionContext) {
	try {
		if (isWorkerContext(ctx)) return;
		const owner = flowOwnerForSession(ctx);
		const run = owner?.flow.parallelRun;
		if (!owner || !run || run.consoleSessionFile !== currentSessionFile(ctx))
			return;
		if (activeParallelBatchForDir(owner.dir)) return;
		showParallelLaneBoard(ctx, owner.dir, owner.flow, run.goalIndexes);
	} catch {}
}

function parallelConsoleFlowForInput(ctx: ExtensionContext) {
	try {
		if (isWorkerContext(ctx)) return undefined;
		const owner = flowOwnerForSession(ctx);
		const run = owner?.flow.parallelRun;
		if (!owner || !run || run.consoleSessionFile !== currentSessionFile(ctx))
			return undefined;
		return owner.flow;
	} catch {
		return undefined;
	}
}

export async function handleFlowCommand(
	pi: ExtensionAPI,
	args: string,
	ctx: ExtensionCommandContext,
) {
	installLocalizedUi(ctx);
	rememberFlowContext(ctx);
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

function requestGeneratedFlowStart(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	flow: { id: string; language: "zh" | "en" },
) {
	const flowContext = rememberedFlowContext(currentSessionFile(ctx));
	if (
		!flowContext ||
		!requestSessionTransition({
			key: `flow:${flow.id}`,
			ctx: flowContext,
			run: async () => {
				await goFlow(pi, flowContext, flow.id);
			},
			onError: (error) =>
				notifyAutoStartFailed(flowContext, flow, formatError(error)),
		})
	)
		notifyAutoStartUnavailable(ctx, flow);
}

function notifyAutoStartFailed(
	ctx: ExtensionCommandContext,
	flow: { id: string; language: "zh" | "en" },
	error: string,
) {
	const command = `/flow go ${flow.id}`;
	const message =
		flow.language === "en"
			? formatUserNotice("❌", `Flow ${flow.id} could not auto-start`, [
					error,
					`Run ${quoteCommand(command)} to retry`,
				])
			: formatUserNotice("❌", `Flow ${flow.id} 自动启动失败`, [
					error,
					`运行 ${quoteCommand(command)} 重试`,
				]);
	notifyUser(ctx, message, "info", flow.language);
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
				`Run ${quoteCommand(command)} to start`,
			])
		: formatUserNotice("⚠️", `Flow ${id} 计划已生成`, [
				"当前会话不能自动启动",
				`运行 ${quoteCommand(command)} 启动`,
			]);
}

function isFile(cwd: string, path: string) {
	try {
		return lstatSync(resolve(cwd, path)).isFile();
	} catch {
		return false;
	}
}
