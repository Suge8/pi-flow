import { existsSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { pauseGoalFromFlow } from "../../goal.js";
import { tryReadAlignmentState } from "../../shared/generation-state.js";
import { settledChecks } from "../../shared/report-review.js";
import { formatUserNotice, notifyUser } from "../../shared/ui-language.js";
import { recordFlowGoalCompletionBoundary } from "../completion.js";
import { writeFlowHtml } from "../html.js";
import { flowLockBusyMessage, withFlowLock } from "../lock.js";
import { currentSessionFile } from "../ownership.js";
import {
	activeParallelBatchForDir,
	cancelParallelBatch,
} from "../parallel/batch-runner.js";
import { stopParallelRunFlow } from "../parallel/stop-state.js";
import { deleteCompletionFact, rememberFlowContext } from "../runtime.js";
import { currentGoal, writeFlow } from "../store.js";
import type { FlowState } from "../types.js";
import { validateFlowDir } from "../validator.js";
import { closeFlowGoalWatcher } from "../watcher.js";
import { flowTargetOrNotify, flowValidationFailedNotice } from "./shared.js";

interface StopFlowResult {
	alreadyComplete: boolean;
	planSessionFile: string | null;
	saved: FlowState;
	shouldAbortCurrentAgent: boolean;
	shouldPauseGoal: boolean;
}

export async function stopFlow(ctx: ExtensionCommandContext, id?: string) {
	const location = flowTargetOrNotify(ctx, {
		id,
		command: "stop",
		requireRunning: false,
	});
	if (!location) return;
	const activeBatch = activeParallelBatchForDir(location.dir);
	activeBatch?.cancel();
	const stopped = await withFlowLock(
		location.dir,
		`stop ${location.flow.id}`,
		() => stopFlowTransaction(ctx, location.dir, location.flow.language),
	);
	if (!stopped.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(stopped.owner, location.flow.language),
			"info",
			location.flow.language,
		);
		if (activeBatch) await activeBatch.wait();
		return;
	}
	if (!stopped.value) {
		if (activeBatch) await activeBatch.wait();
		return;
	}
	const result = stopped.value;
	if (result.shouldPauseGoal)
		await pauseTargetGoal(ctx, result.planSessionFile);
	if (result.shouldAbortCurrentAgent) abortCurrentAgent(ctx);
	if (activeBatch) await activeBatch.wait();
	notifyUser(
		ctx,
		result.alreadyComplete
			? flowAlreadyCompleteMessage(result.saved.id, result.saved.language)
			: flowPausedMessage(result.saved.id, result.saved.language),
		"info",
		result.saved.language,
	);
}

async function pauseTargetGoal(
	ctx: ExtensionCommandContext,
	sessionFile: string | null,
) {
	if (!sessionFile) return false;
	if (sessionFile === currentSessionFile(ctx)) {
		const paused = pauseGoalFromFlow(ctx);
		recordStopCompletionBoundary(ctx, sessionFile);
		return paused;
	}
	if (!existsSync(sessionFile)) return false;
	let paused = false;
	await ctx.switchSession(sessionFile, {
		withSession: async (sessionCtx) => {
			rememberFlowContext(sessionCtx);
			paused = pauseGoalFromFlow(sessionCtx);
			recordStopCompletionBoundary(sessionCtx, sessionFile);
		},
	});
	return paused;
}

function recordStopCompletionBoundary(
	ctx: ExtensionCommandContext,
	sessionFile: string,
) {
	deleteCompletionFact(sessionFile);
	recordFlowGoalCompletionBoundary(ctx, { reason: "stop" });
}

function stopFlowTransaction(
	ctx: ExtensionCommandContext,
	dir: string,
	language: "zh" | "en",
): StopFlowResult | undefined {
	const validation = validateFlowDir(dir, language);
	if (!validation.ok || !validation.flow) {
		notifyUser(
			ctx,
			flowValidationFailedNotice(validation.errors, language),
			"info",
			language,
		);
		return undefined;
	}
	const flow = validation.flow;
	if (flow.status === "complete")
		return {
			alreadyComplete: true,
			planSessionFile: null,
			saved: flow,
			shouldAbortCurrentAgent: false,
			shouldPauseGoal: false,
		};
	cancelParallelBatch(dir);
	const plan = currentGoal(flow);
	const shouldPauseGoal =
		flow.status === "running" &&
		flow.parallelRun === null &&
		plan?.status === "running";
	const shouldAbortCurrentAgent =
		preDraftOwnedByCurrentSession(ctx, dir, flow) ||
		(shouldPauseGoal && plan?.sessionFile === currentSessionFile(ctx));
	const saved = writeFlow(dir, stopFlowState(dir, flow));
	closeFlowGoalWatcher(dir);
	writeFlowHtml(dir, saved);
	return {
		alreadyComplete: saved.status === "complete",
		planSessionFile: plan?.sessionFile ?? null,
		saved,
		shouldAbortCurrentAgent,
		shouldPauseGoal,
	};
}

function stopFlowState(dir: string, flow: FlowState): FlowState {
	if (flow.parallelRun) return stopParallelRunFlow(dir, flow);
	return {
		...flow,
		status: "paused",
		parallelRun: null,
		errors: [],
		goals: flow.goals.map((goal) => ({
			...goal,
			checks: settledChecks(goal.checks),
		})),
	};
}

function preDraftOwnedByCurrentSession(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
) {
	return (
		flow.goals.length === 0 &&
		(flow.status === "aligning" || flow.status === "generating") &&
		tryReadAlignmentState(dir)?.sessionFile === currentSessionFile(ctx)
	);
}

function abortCurrentAgent(ctx: ExtensionCommandContext) {
	const abort = (ctx as { abort?: () => void }).abort;
	const isIdle = (ctx as { isIdle?: () => boolean }).isIdle;
	if (typeof abort === "function" && isIdle?.() === false) abort.call(ctx);
}

function flowPausedMessage(id: string, language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("⚠️", "Flow paused", [
				`ID: ${id}`,
				`Run /flow go ${id} to continue`,
			])
		: formatUserNotice("⚠️", "Flow 已暂停", [
				`编号：${id}`,
				`运行 /flow go ${id} 继续`,
			]);
}

function flowAlreadyCompleteMessage(id: string, language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("✅", "Flow is already complete", [
				`ID: ${id}`,
				"No pause needed",
			])
		: formatUserNotice("✅", "Flow 已完成", [`编号：${id}`, "无需暂停"]);
}
