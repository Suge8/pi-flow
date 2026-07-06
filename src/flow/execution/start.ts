import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { objectiveFromPlan } from "../../goal/validator.js";
import { startGoalFromFlow } from "../../goal.js";
import { formatError } from "../../shared/guards.js";
import { runtimeLanguage } from "../../shared/language.js";
import { flowStepLabel } from "../../shared/progress-labels.js";
import { liveReportUrl } from "../../shared/report-server.js";
import { sendResultCard } from "../../shared/result-card.js";
import { notifyUser } from "../../shared/ui-language.js";
import { writeFlowHtml } from "../html.js";
import { flowLockBusyMessage, withFlowLock } from "../lock.js";
import { currentSessionFile } from "../ownership.js";
import { runParallelBatch } from "../parallel/batch-runner.js";
import { planGoalPrompt } from "../prompt.js";
import { rememberFlowContext } from "../runtime.js";
import { computeReadyBatch } from "../scheduler.js";
import { planSnapshotHash } from "../snapshot.js";
import { findFlow, latestFlow, writeFlow } from "../store.js";
import { flowTargetLookupFailedMessage } from "../target.js";
import type { FlowGoal, FlowLocation, FlowState } from "../types.js";
import {
	clip,
	flowSessionName,
	replaceGoal,
	requireFlowStartedAt,
} from "../util.js";
import { validateFlowDir } from "../validator.js";
import { closeFlowGoalWatcher, watchCurrentFlowGoal } from "../watcher.js";
import { askRepair } from "./repair.js";
import {
	flowNotFoundMessage,
	flowStatusLabel,
	verifyCurrentSnapshot,
} from "./shared.js";

export async function startFlow(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	id: string | undefined,
) {
	let location: FlowLocation | undefined;
	try {
		location = id
			? findFlow(ctx.cwd, id)
			: latestFlow(ctx.cwd, (flow) => flow.status === "draft");
	} catch (error) {
		const language = runtimeLanguage();
		notifyUser(
			ctx,
			flowTargetLookupFailedMessage(error, language),
			"error",
			language,
		);
		return false;
	}
	if (!location) {
		const language = runtimeLanguage();
		notifyUser(
			ctx,
			id
				? flowNotFoundMessage(id, language)
				: language === "en"
					? "No draft Flow to start. Run /flow <request> first."
					: "没有待启动的 Flow 计划。先运行 /flow <需求> 生成。",
			"warning",
			language,
		);
		return false;
	}
	const validation = validateFlowDir(location.dir, location.flow.language);
	if (!validation.ok || !validation.flow) {
		await askRepair(pi, ctx, location, validation.errors);
		return false;
	}
	const flow = validation.flow;
	if (flow.status !== "draft") {
		const verified = await withFlowLock(location.dir, `verify ${flow.id}`, () =>
			verifyCurrentSnapshot(ctx, location.dir, flow),
		);
		if (!verified.ok) {
			notifyUser(
				ctx,
				flowLockBusyMessage(verified.owner, flow.language),
				"warning",
				flow.language,
			);
			return false;
		}
		notifyUser(ctx, flowCannotStartMessage(flow), "warning", flow.language);
		return false;
	}
	if (hasActiveFlowExecution(flow)) {
		notifyUser(ctx, runningFlowMessage(flow), "warning", flow.language);
		return false;
	}
	return startGoalInNewSession(pi, ctx, location.dir, flow, 0);
}

export async function startGoalInNewSession(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	goalIndex: number,
): Promise<boolean> {
	const current = validatedFlowForScheduling(ctx, dir, flow.language);
	if (!current) return false;
	const batch = computeReadyBatch(current);
	if (!batch) return false;
	if (batch.mode === "parallel")
		return startParallelBatch(pi, ctx, dir, current, batch.indices);
	return startSelectedGoalInNewSession(
		pi,
		ctx,
		dir,
		current,
		batch.indices[0] ?? goalIndex,
	);
}

export async function startSelectedGoalInNewSession(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	goalIndex: number,
): Promise<boolean> {
	if (typeof ctx.newSession !== "function") {
		notifyUser(
			ctx,
			flow.language === "en"
				? "The current Pi runtime cannot create a new session, so Flow cannot start."
				: "当前 Pi 运行环境不支持新建会话，无法启动 Flow。",
			"error",
			flow.language,
		);
		return false;
	}
	const locked = await withFlowLock(
		dir,
		`start ${flow.id} G${goalIndex + 1}`,
		async () => startSelectedGoalWithLock(pi, ctx, dir, flow, goalIndex),
	);
	if (!locked.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(locked.owner, flow.language),
			"warning",
			flow.language,
		);
		return false;
	}
	return locked.value;
}

async function startSelectedGoalWithLock(
	pi: ExtensionAPI,
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
			"warning",
			current.language,
		);
		return false;
	}
	let prepared = false;
	let replacementCtx: ExtensionCommandContext | undefined;
	try {
		const result = await ctx.newSession({
			withSession: async (sessionCtx) => {
				replacementCtx = sessionCtx;
				rememberFlowContext(sessionCtx);
				try {
					const saved = prepareGoalStart(sessionCtx, dir, current, goalIndex);
					await bindFlowReportStatus(sessionCtx, dir, current.language);
					prepared = await startPreparedGoalWithLockHeld(
						sessionCtx,
						dir,
						current,
						saved,
						goalIndex,
						pi,
						true,
					);
				} catch (error) {
					notifyUser(
						sessionCtx,
						flowStepSessionStartFailedMessage(
							formatError(error),
							current.language,
						),
						"error",
						current.language,
					);
				}
			},
		});
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

async function startParallelBatch(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
): Promise<boolean> {
	await bindFlowReportStatus(ctx, dir, flow.language);
	const result = await runParallelBatch(ctx, dir, flow, batchIndices, pi, {
		signal: ctx.signal,
	});
	if (
		!result.allSuccess ||
		result.cancelled ||
		result.flow.status === "complete"
	)
		return result.allSuccess && !result.cancelled;
	return startGoalInNewSession(
		pi,
		ctx,
		dir,
		result.flow,
		result.flow.currentGoal,
	);
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
	setSessionName(ctx, sessionName);
	const goals = replaceGoal(flow, goalIndex, {
		...goal,
		status: "running",
		sessionFile: currentSessionFile(ctx) ?? null,
		sessionName,
		snapshot,
		snapshotHash: goal.snapshotHash ?? planSnapshotHash(snapshot),
	});
	const startedAt =
		flow.status === "draft" ? Date.now() : requireFlowStartedAt(flow);
	const saved = writeFlow(dir, {
		...flow,
		status: "running",
		startedAt,
		currentGoal: goalIndex,
		errors: [],
		goals,
	});
	writeFlowHtml(dir, saved);
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
		"warning",
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
) {
	try {
		const goal = saved.goals[goalIndex];
		const snapshot = goal.snapshot ?? "";
		const objective = objectiveFromPlan(snapshot) || goal.title;
		sendFlowGoalStartCard(pi, ctx, saved, goal, objective);
		const sent = await startGoalFromFlow(
			{
				objective,
				prompt: planGoalPrompt(saved, goal, snapshot),
			},
			ctx,
		);
		if (!sent && canRollback)
			rollbackPreparedGoalStartUnlocked(dir, originalFlow);
		return sent;
	} catch (error) {
		if (canRollback) rollbackPreparedGoalStartUnlocked(dir, originalFlow);
		notifyUser(
			ctx,
			flowStepSessionStartFailedMessage(formatError(error), saved.language),
			"error",
			saved.language,
		);
		return false;
	}
}

export async function bindFlowReportStatus(
	ctx: ExtensionCommandContext,
	dir: string,
	language: FlowState["language"],
) {
	await liveReportUrl(ctx, join(dir, "flow.html"), language).catch(
		() => undefined,
	);
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
			rollbackPreparedGoalStartUnlocked(dir, originalFlow);
			return true;
		},
	);
	if (rolledBack.ok) return rolledBack.value;
	notifyUser(
		ctx,
		flowLockBusyMessage(rolledBack.owner, preparedFlow.language),
		"warning",
		preparedFlow.language,
	);
	return false;
}

function rollbackPreparedGoalStartUnlocked(
	dir: string,
	originalFlow: FlowState,
) {
	closeFlowGoalWatcher(dir);
	const saved = writeFlow(dir, originalFlow);
	writeFlowHtml(dir, saved);
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
		currentGoal.snapshotHash === preparedGoal?.snapshotHash
	);
}

export function sendFlowGoalStartCard(
	pi: ExtensionAPI | undefined,
	ctx: ExtensionCommandContext,
	flow: FlowState,
	goal: FlowGoal,
	objective: string,
) {
	const label = flowStepLabel(goal.index, goal.title, flow.language);
	const remaining = flow.goals
		.slice(goal.index + 1)
		.map((item) => flowStepLabel(item.index, item.title, flow.language))
		.join(" → ");
	const fallbackRemaining = flow.language === "en" ? "none" : "无";
	const title =
		flow.language === "en" ? `Flow ${label} started` : `Flow ${label} 已启动`;
	const lines =
		flow.language === "en"
			? [
					`Goal: ${clip(objective, 120)}`,
					`Progress: ${goal.index + 1}/${flow.goals.length}`,
					`Remaining: ${clip(remaining || fallbackRemaining, 120)}`,
				]
			: [
					`目标：${clip(objective, 120)}`,
					`进度：${goal.index + 1}/${flow.goals.length}`,
					`后续：${clip(remaining || fallbackRemaining, 120)}`,
				];
	sendResultCard(pi, ctx, [`[${title}]`, "", ...lines].join("\n"), {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		language: flow.language,
	});
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
		language === "en"
			? `Flow validation failed:\n${validation.errors.join("\n")}`
			: `Flow 校验失败：\n${validation.errors.join("\n")}`,
		"error",
		language,
	);
	return undefined;
}

function canStartSelectedGoal(flow: FlowState, goalIndex: number) {
	return (
		(flow.status === "draft" || flow.status === "running") &&
		!hasActiveFlowExecution(flow) &&
		flow.goals[goalIndex]?.status === "pending"
	);
}

function hasActiveFlowExecution(flow: FlowState) {
	return (
		!!flow.parallelRun || flow.goals.some((goal) => goal.status === "running")
	);
}

function noSchedulableGoalMessage(flow: FlowState) {
	return flow.language === "en"
		? "Flow has no pending step ready to start."
		: "Flow 没有可启动的待执行步骤。";
}

function flowCannotStartMessage(flow: FlowState) {
	const status = flowStatusLabel(flow.status, flow.language);
	return flow.language === "en"
		? `${flow.id} status: ${status}; cannot start.`
		: `${flow.id} 当前状态：${status}，不能启动。`;
}

function runningFlowMessage(flow: FlowState) {
	return flow.language === "en"
		? `A Flow is already running: ${flow.id}`
		: `已有运行中的 Flow：${flow.id}`;
}

function notifySessionStartFailed(
	ctx: ExtensionCommandContext,
	message: string,
	language: FlowState["language"],
) {
	try {
		notifyUser(ctx, message, "error", language);
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
		? `Flow step session start failed: ${error}`
		: `Flow 步骤会话启动失败：${error}`;
}

function setSessionName(ctx: ExtensionCommandContext, name: string) {
	appendSessionName(ctx, name);
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
