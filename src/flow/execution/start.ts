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
import { currentSessionFile } from "../ownership.js";
import {
	activeParallelBatch,
	runParallelBatch,
} from "../parallel/batch-runner.js";
import { planGoalPrompt } from "../prompt.js";
import { rememberFlowContext } from "../runtime.js";
import { computeReadyBatch } from "../scheduler.js";
import { planSnapshotHash } from "../snapshot.js";
import { findFlow, latestFlow, writeFlow } from "../store.js";
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
	runningFlowOrNotify,
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
			language === "en"
				? `flow.json read failed: ${formatError(error)}`
				: `flow.json 读取失败：${formatError(error)}`,
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
		verifyCurrentSnapshot(ctx, location.dir, flow);
		notifyUser(ctx, flowCannotStartMessage(flow), "warning", flow.language);
		return false;
	}
	const activeBatch = activeParallelBatch(ctx.cwd);
	if (activeBatch) {
		notifyUser(
			ctx,
			runningFlowMessage(activeBatch.flow),
			"warning",
			activeBatch.flow.language,
		);
		return false;
	}
	const running = runningFlowOrNotify(ctx);
	if (running === null) return false;
	if (running) {
		notifyUser(
			ctx,
			runningFlowMessage(running.flow),
			"warning",
			running.flow.language,
		);
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
	const batch = computeReadyBatch(flow);
	if (batch?.mode === "parallel")
		return startParallelBatch(pi, ctx, dir, flow, batch.indices);
	return startSelectedGoalInNewSession(
		pi,
		ctx,
		dir,
		flow,
		batch?.indices[0] ?? goalIndex,
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
	let prepared = false;
	let replacementCtx: ExtensionCommandContext | undefined;
	try {
		const result = await ctx.newSession({
			withSession: async (sessionCtx) => {
				replacementCtx = sessionCtx;
				rememberFlowContext(sessionCtx);
				try {
					const saved = prepareGoalStart(sessionCtx, dir, flow, goalIndex, pi);
					await bindFlowReportStatus(sessionCtx, dir, flow.language);
					scheduleGoalPromptStart(sessionCtx, dir, flow, saved, goalIndex);
					prepared = true;
				} catch (error) {
					notifyUser(
						sessionCtx,
						flowStepSessionStartFailedMessage(
							formatError(error),
							flow.language,
						),
						"error",
						flow.language,
					);
				}
			},
		});
		return prepared && !result.cancelled;
	} catch (error) {
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
	pi?: ExtensionAPI,
) {
	const goal = flow.goals[goalIndex];
	const currentFile = readFileSync(join(dir, goal.file), "utf8");
	const snapshot = goal.snapshot ?? currentFile;
	const sessionName = flowSessionName(flow, goal);
	setSessionName(pi, ctx, sessionName);
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
) {
	try {
		const goal = saved.goals[goalIndex];
		const snapshot = goal.snapshot ?? "";
		const objective = objectiveFromPlan(snapshot) || goal.title;
		sendFlowGoalStartCard(undefined, ctx, saved, goal, objective);
		const started = await startGoalFromFlow(
			{
				objective,
				prompt: planGoalPrompt(saved, goal, snapshot),
			},
			ctx,
		);
		if (!started) rollbackPreparedGoalStart(dir, originalFlow);
	} catch (error) {
		rollbackPreparedGoalStart(dir, originalFlow);
		notifyUser(
			ctx,
			flowStepSessionStartFailedMessage(formatError(error), saved.language),
			"error",
			saved.language,
		);
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

export function rollbackPreparedGoalStart(dir: string, flow: FlowState) {
	closeFlowGoalWatcher();
	const saved = writeFlow(dir, flow);
	writeFlowHtml(dir, saved);
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

function scheduleGoalPromptStart(
	ctx: ExtensionCommandContext,
	dir: string,
	originalFlow: FlowState,
	saved: FlowState,
	goalIndex: number,
) {
	setImmediate(() => {
		void startPreparedGoal(ctx, dir, originalFlow, saved, goalIndex);
	});
}

function setSessionName(
	pi: ExtensionAPI | undefined,
	ctx: ExtensionCommandContext,
	name: string,
) {
	if (typeof pi?.setSessionName === "function") {
		try {
			pi.setSessionName(name);
			return;
		} catch (error) {
			if (!isStaleSessionError(error)) throw error;
		}
	}
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
