import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { objectiveFromPlan } from "../../goal/validator.js";
import { startGoalFromFlow } from "../../goal.js";
import { type Language, readFlowConfig } from "../../shared/config.js";
import { formatError } from "../../shared/guards.js";
import {
	flowGoalDisplayLabel,
	flowStepLabel,
} from "../../shared/progress-labels.js";
import { sendResultCard } from "../../shared/result-card.js";
import { formatUserNotice, notifyUser } from "../../shared/ui-language.js";
import {
	publishFlowReportLifecycle,
	publishFlowReportProjection,
} from "../html.js";
import { flowLockBusyMessage, withFlowLock } from "../lock.js";
import { currentSessionFile } from "../ownership.js";
import { runParallelBatch } from "../parallel/batch-runner.js";
import { parallelConsoleSessionName } from "../parallel/console.js";
import {
	planTrajectoryForkPoint,
	releaseGenerationSession,
} from "../prewalk.js";
import { planGoalPrompt } from "../prompt.js";
import { releaseFlowContext, rememberFlowContext } from "../runtime.js";
import { computeReadyBatch } from "../scheduler.js";
import { requestSessionTransition } from "../session-transition.js";
import { writeFlow } from "../store.js";
import type { FlowGoal, FlowState } from "../types.js";
import {
	clip,
	flowSessionName,
	replaceGoal,
	requireFlowStartedAt,
} from "../util.js";
import { validateFlowDir } from "../validator.js";
import { closeFlowGoalWatcher, watchCurrentFlowGoal } from "../watcher.js";
import { flowValidationFailedNotice } from "./shared.js";

export async function startGoalInNewSession(
	pi: ExtensionAPI | undefined,
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	goalIndex: number,
): Promise<boolean> {
	const current = validatedFlowForScheduling(ctx, dir, flow.language);
	if (!current) return false;
	if (current.parallelRun)
		return startParallelBatchInNewSession(
			pi,
			ctx,
			dir,
			current,
			current.parallelRun.goalIndexes,
		);
	const batch = computeReadyBatch(current);
	if (!batch) return false;
	if (batch.mode === "parallel")
		return startParallelBatchInNewSession(pi, ctx, dir, current, batch.indices);
	return startSelectedGoalInNewSession(
		ctx,
		dir,
		current,
		batch.indices[0] ?? goalIndex,
	);
}

export async function startSelectedGoalInNewSession(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	goalIndex: number,
): Promise<boolean> {
	if (typeof ctx.newSession !== "function") {
		notifyUser(
			ctx,
			newSessionUnsupportedMessage(flow.language),
			"info",
			flow.language,
		);
		return false;
	}
	const locked = await withFlowLock(
		dir,
		`start ${flow.id} G${goalIndex + 1}`,
		async () => startSelectedGoalWithLock(ctx, dir, flow, goalIndex),
	);
	if (!locked.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(locked.owner, flow.language),
			"info",
			flow.language,
		);
		return false;
	}
	return locked.value;
}

async function startSelectedGoalWithLock(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	goalIndex: number,
) {
	const current = validatedFlowForScheduling(ctx, dir, flow.language);
	if (!current) return false;
	if (!canStartSelectedGoal(current, goalIndex)) {
		notifyUser(
			ctx,
			noSchedulableGoalMessage(current),
			"info",
			current.language,
		);
		return false;
	}
	let prepared = false;
	let replacementCtx: ExtensionCommandContext | undefined;
	const forkPoint = planTrajectoryForkPoint(ctx, dir, current);
	try {
		const withSession = async (sessionCtx: ExtensionCommandContext) => {
			replacementCtx = sessionCtx;
			rememberFlowContext(sessionCtx);
			// 首次启动即释放生成会话记忆：启动后 startedAt 非 null，事实永不再命中。
			releaseGenerationSession(dir);
			try {
				const saved = prepareGoalStart(sessionCtx, dir, current, goalIndex);
				await bindFlowReportStatus(sessionCtx, dir, current);
				prepared = await startPreparedGoalWithLockHeld(
					sessionCtx,
					dir,
					current,
					saved,
					goalIndex,
					undefined,
					true,
					{ forkedFromPlanSession: forkPoint !== undefined },
				);
			} catch (error) {
				notifyUser(
					sessionCtx,
					flowStepSessionStartFailedMessage(
						formatError(error),
						current.language,
					),
					"info",
					current.language,
				);
			}
		};
		const result = forkPoint
			? await ctx.fork(forkPoint, { position: "at", withSession })
			: await ctx.newSession({ withSession });
		return prepared && !result.cancelled;
	} catch (error) {
		const message = flowStepSessionStartFailedMessage(
			formatError(error),
			current.language,
		);
		const notified = replacementCtx
			? notifySessionStartFailed(replacementCtx, message, current.language)
			: notifySessionStartFailed(ctx, message, current.language);
		if (!notified) throw new Error(message);
		return false;
	}
}

export async function startParallelBatchInNewSession(
	pi: ExtensionAPI | undefined,
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
): Promise<boolean> {
	if (flow.parallelRun?.consoleSessionFile === currentSessionFile(ctx)) {
		setParallelSessionName(ctx, flow, batchIndices);
		return runParallelBatchAndContinue(pi, ctx, dir, flow, batchIndices);
	}
	const consoleSessionFile = flow.parallelRun?.consoleSessionFile;
	if (consoleSessionFile && existsSync(consoleSessionFile))
		return switchToParallelConsole(
			ctx,
			dir,
			flow,
			batchIndices,
			consoleSessionFile,
		);
	return createParallelConsoleSession(ctx, dir, flow, batchIndices);
}

async function createParallelConsoleSession(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
): Promise<boolean> {
	if (typeof ctx.newSession !== "function") {
		notifyUser(
			ctx,
			newSessionUnsupportedMessage(flow.language),
			"info",
			flow.language,
		);
		return false;
	}
	let started = false;
	let replacementCtx: ExtensionCommandContext | undefined;
	try {
		const result = await ctx.newSession({
			parentSession: currentSessionFile(ctx),
			withSession: async (sessionCtx) => {
				replacementCtx = sessionCtx;
				rememberFlowContext(sessionCtx);
				setParallelSessionName(sessionCtx, flow, batchIndices);
				started = await runParallelBatchAndContinue(
					undefined,
					sessionCtx,
					dir,
					flow,
					batchIndices,
				);
			},
		});
		return started && !result.cancelled;
	} catch (error) {
		return notifyParallelSessionStartFailure(ctx, replacementCtx, flow, error);
	}
}

async function switchToParallelConsole(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
	consoleSessionFile: string,
): Promise<boolean> {
	let started = false;
	let replacementCtx: ExtensionCommandContext | undefined;
	try {
		const result = await ctx.switchSession(consoleSessionFile, {
			withSession: async (sessionCtx) => {
				replacementCtx = sessionCtx;
				rememberFlowContext(sessionCtx);
				setParallelSessionName(sessionCtx, flow, batchIndices);
				started = await runParallelBatchAndContinue(
					undefined,
					sessionCtx,
					dir,
					flow,
					batchIndices,
				);
			},
		});
		return started && !result.cancelled;
	} catch (error) {
		return notifyParallelSessionStartFailure(ctx, replacementCtx, flow, error);
	}
}

function notifyParallelSessionStartFailure(
	ctx: ExtensionCommandContext,
	replacementCtx: ExtensionCommandContext | undefined,
	flow: FlowState,
	error: unknown,
) {
	const message = flowStepSessionStartFailedMessage(
		formatError(error),
		flow.language,
	);
	const notified = replacementCtx
		? notifySessionStartFailed(replacementCtx, message, flow.language)
		: notifySessionStartFailed(ctx, message, flow.language);
	if (!notified) throw new Error(message);
	return false;
}

async function runParallelBatchAndContinue(
	pi: ExtensionAPI | undefined,
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
): Promise<boolean> {
	const sessionFile = currentSessionFile(ctx);
	await bindFlowReportStatus(ctx, dir, flow);
	const result = await runParallelBatch(ctx, dir, flow, batchIndices, pi, {
		signal: ctx.signal,
	});
	if (
		!result.allSuccess ||
		result.cancelled ||
		result.flow.status === "complete"
	) {
		if (result.flow.status !== "running") releaseFlowContext(sessionFile, ctx);
		return result.allSuccess && !result.cancelled;
	}
	return requestSessionTransition({
		key: `flow:${result.flow.id}`,
		ctx,
		run: async () => {
			const started = await startGoalInNewSession(
				pi,
				ctx,
				dir,
				result.flow,
				result.flow.currentGoal,
			);
			if (started) releaseFlowContext(sessionFile, ctx);
		},
		onError: (error) =>
			notifyParallelSessionStartFailure(ctx, undefined, result.flow, error),
	});
}

export function prepareGoalStart(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	goalIndex: number,
) {
	const goal = flow.goals[goalIndex];
	const currentFile = readFileSync(join(dir, goal.file), "utf8");
	const snapshot = goal.snapshot ?? currentFile;
	const sessionName = flowSessionName(flow, goal);
	const now = Date.now();
	setSessionName(ctx, sessionName);
	const goals = replaceGoal(flow, goalIndex, {
		...goal,
		status: "running",
		startedAt: goal.startedAt ?? now,
		completedAt: null,
		sessionFile: currentSessionFile(ctx) ?? null,
		sessionName,
		snapshot,
	});
	const startedAt =
		flow.status === "draft" || flow.startedAt === null
			? now
			: requireFlowStartedAt(flow);
	const saved = writeFlow(dir, {
		...flow,
		status: "running",
		startedAt,
		currentGoal: goalIndex,
		errors: [],
		goals,
	});
	publishFlowReportProjection(ctx, dir, saved);
	watchCurrentFlowGoal(dir, saved);
	return saved;
}

export async function startPreparedGoal(
	ctx: ExtensionCommandContext,
	dir: string,
	originalFlow: FlowState,
	saved: FlowState,
	goalIndex: number,
	pi?: ExtensionAPI,
) {
	const started = await withFlowLock(dir, `prompt ${saved.id}`, async () => {
		const validation = validateFlowDir(dir, saved.language);
		const currentFlow = validation.flow;
		if (!currentFlow || !preparedGoalCanStart(currentFlow, saved)) return false;
		return startPreparedGoalWithLockHeld(
			ctx,
			dir,
			originalFlow,
			saved,
			goalIndex,
			pi,
			preparedGoalStillCurrent(currentFlow, saved),
		);
	});
	if (started.ok) return started.value;
	notifyUser(
		ctx,
		flowLockBusyMessage(started.owner, saved.language),
		"info",
		saved.language,
	);
	return false;
}

export async function startPreparedGoalWithLockHeld(
	ctx: ExtensionCommandContext,
	dir: string,
	originalFlow: FlowState,
	saved: FlowState,
	goalIndex: number,
	pi: ExtensionAPI | undefined,
	canRollback: boolean,
	options: { forkedFromPlanSession?: boolean } = {},
) {
	try {
		const goal = saved.goals[goalIndex];
		const snapshot = goal.snapshot ?? "";
		const objective = objectiveFromPlan(snapshot) || goal.title;
		sendFlowGoalStartCard(pi, ctx, saved, goal, objective);
		const sent = await startGoalFromFlow(
			{
				objective,
				prompt: planGoalPrompt(saved, goal, snapshot, options),
			},
			ctx,
			{
				onGoalCreated: (goalId) =>
					writeFlow(dir, {
						...saved,
						goals: replaceGoal(saved, goalIndex, { ...goal, goalId }),
					}),
			},
		);
		if (!sent && canRollback)
			rollbackPreparedGoalStartUnlocked(ctx, dir, originalFlow);
		return sent;
	} catch (error) {
		if (canRollback) rollbackPreparedGoalStartUnlocked(ctx, dir, originalFlow);
		notifyUser(
			ctx,
			flowStepSessionStartFailedMessage(formatError(error), saved.language),
			"info",
			saved.language,
		);
		return false;
	}
}

export function bindFlowReportStatus(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
) {
	publishFlowReportLifecycle(ctx, dir, flow);
}

export async function rollbackPreparedGoalStart(
	ctx: ExtensionCommandContext,
	dir: string,
	originalFlow: FlowState,
	preparedFlow: FlowState,
) {
	const rolledBack = await withFlowLock(
		dir,
		`rollback ${preparedFlow.id}`,
		() => {
			const validation = validateFlowDir(dir, preparedFlow.language);
			if (
				!validation.flow ||
				!preparedGoalStillCurrent(validation.flow, preparedFlow)
			)
				return false;
			rollbackPreparedGoalStartUnlocked(ctx, dir, originalFlow);
			return true;
		},
	);
	if (rolledBack.ok) return rolledBack.value;
	notifyUser(
		ctx,
		flowLockBusyMessage(rolledBack.owner, preparedFlow.language),
		"info",
		preparedFlow.language,
	);
	return false;
}

function rollbackPreparedGoalStartUnlocked(
	ctx: ExtensionCommandContext,
	dir: string,
	originalFlow: FlowState,
) {
	closeFlowGoalWatcher(dir);
	const saved = writeFlow(dir, originalFlow);
	publishFlowReportProjection(ctx, dir, saved);
}

function preparedGoalCanStart(current: FlowState, prepared: FlowState) {
	return preparedGoalMatches(current, prepared, false);
}

function preparedGoalStillCurrent(current: FlowState, prepared: FlowState) {
	return preparedGoalMatches(current, prepared, true);
}

function preparedGoalMatches(
	current: FlowState,
	prepared: FlowState,
	checkSessionName: boolean,
) {
	const index = prepared.currentGoal;
	const currentGoal = current.goals[index];
	const preparedGoal = prepared.goals[index];
	return (
		current.id === prepared.id &&
		current.status === prepared.status &&
		current.currentGoal === prepared.currentGoal &&
		current.parallelRun?.id === prepared.parallelRun?.id &&
		currentGoal?.status === "running" &&
		currentGoal.sessionFile === preparedGoal?.sessionFile &&
		(!checkSessionName ||
			currentGoal.sessionName === preparedGoal?.sessionName) &&
		currentGoal.snapshot === preparedGoal?.snapshot
	);
}

export function sendFlowGoalStartCard(
	pi: ExtensionAPI | undefined,
	ctx: ExtensionCommandContext,
	flow: FlowState,
	goal: FlowGoal,
	objective: string,
) {
	const label = flowGoalDisplayLabel(
		goal.index,
		goal.title,
		flow.goals.length,
		flow.language,
	);
	const title =
		flow.language === "en" ? `Flow ${label} started` : `Flow ${label} 已启动`;
	const lines = flowGoalStartLines(flow, goal, objective);
	sendResultCard(pi, ctx, [`[${title}]`, ...lines].join("\n"), {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		language: flow.language,
	});
}

function flowGoalStartLines(
	flow: FlowState,
	goal: FlowGoal,
	objective: string,
) {
	const lines =
		flow.language === "en"
			? [`ID: ${flow.id}`, `Goal: ${clip(objective, 120)}`]
			: [`编号：${flow.id}`, `目标：${clip(objective, 120)}`];
	if (flow.goals.length > 1) lines.push(...flowGoalProgressLines(flow, goal));
	const model = executorModelLine(flow.language);
	if (model) lines.push(model);
	return lines;
}

function flowGoalProgressLines(flow: FlowState, goal: FlowGoal) {
	const remaining = flow.goals
		.slice(goal.index + 1)
		.map((item) => flowStepLabel(item.index, item.title, flow.language))
		.join(" → ");
	const fallbackRemaining = flow.language === "en" ? "none" : "无";
	return flow.language === "en"
		? [
				`Progress: ${goal.index + 1}/${flow.goals.length}`,
				`Remaining: ${clip(remaining || fallbackRemaining, 120)}`,
			]
		: [
				`进度：${goal.index + 1}/${flow.goals.length}`,
				`后续：${clip(remaining || fallbackRemaining, 120)}`,
			];
}

function executorModelLine(language: Language) {
	try {
		const config = readFlowConfig().modelRoles.executor;
		if (config === "current") return undefined;
		const label = `${config.model}/${config.thinking}`;
		return language === "en" ? `Model: ${label}` : `模型：${label}`;
	} catch {
		return undefined;
	}
}

function validatedFlowForScheduling(
	ctx: ExtensionCommandContext,
	dir: string,
	language: FlowState["language"],
) {
	const validation = validateFlowDir(dir, language);
	if (validation.ok && validation.flow) return validation.flow;
	notifyUser(
		ctx,
		flowValidationFailedNotice(validation.errors, language),
		"info",
		language,
	);
	return undefined;
}

function canStartSelectedGoal(flow: FlowState, goalIndex: number) {
	return (
		(flow.status === "draft" ||
			flow.status === "paused" ||
			flow.status === "running") &&
		!hasActiveFlowExecution(flow) &&
		flow.goals[goalIndex]?.status === "pending"
	);
}

function hasActiveFlowExecution(flow: FlowState) {
	return (
		!!flow.parallelRun || flow.goals.some((goal) => goal.status === "running")
	);
}

function newSessionUnsupportedMessage(language: FlowState["language"]) {
	return language === "en"
		? formatUserNotice("⚠️", "Flow cannot start", [
				"The current Pi runtime cannot create a new session",
			])
		: formatUserNotice("⚠️", "Flow 无法启动", [
				"当前 Pi 运行环境不支持新建会话",
			]);
}

function noSchedulableGoalMessage(flow: FlowState) {
	return flow.language === "en"
		? formatUserNotice("⚠️", "Flow cannot start", [
				"No pending step ready to start",
			])
		: formatUserNotice("⚠️", "Flow 无法启动", ["没有可启动的待执行步骤"]);
}

function notifySessionStartFailed(
	ctx: ExtensionCommandContext,
	message: string,
	language: FlowState["language"],
) {
	try {
		notifyUser(ctx, message, "info", language);
		return true;
	} catch (notifyError) {
		if (isStaleSessionError(notifyError)) return false;
		throw notifyError;
	}
}

function flowStepSessionStartFailedMessage(
	error: string,
	language: FlowState["language"],
) {
	return language === "en"
		? formatUserNotice("❌", "Flow step session start failed", [error])
		: formatUserNotice("❌", "Flow 步骤会话启动失败", [error]);
}

function setSessionName(ctx: ExtensionCommandContext, name: string) {
	appendSessionName(ctx, name);
}

function setParallelSessionName(
	ctx: ExtensionCommandContext,
	flow: FlowState,
	batchIndices: number[],
) {
	appendSessionName(ctx, parallelConsoleSessionName(flow, batchIndices));
}

function appendSessionName(ctx: ExtensionCommandContext, name: string) {
	const sessionManager = ctx.sessionManager as
		| { appendSessionInfo?: (name: string) => unknown }
		| undefined;
	sessionManager?.appendSessionInfo?.(name);
}

function isStaleSessionError(error: unknown) {
	return formatError(error).includes("stale");
}
