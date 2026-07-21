import { existsSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { pauseGoalFromFlow } from "../../goal.js";
import { readAlignmentStateIfExists } from "../../shared/generation-state.js";
import { formatUserNotice, notifyUser } from "../../shared/ui-language.js";
import { recordFlowGoalCompletionBoundary } from "../completion.js";
import { cancelFlowGeneration } from "../generation.js";
import { publishFlowReportProjection } from "../html.js";
import { flowLockBusyMessage, withFlowLock } from "../lock.js";
import { currentSessionFile } from "../ownership.js";
import {
	activeParallelBatchForDir,
	cancelParallelBatch,
} from "../parallel/batch-runner.js";
import { quoteCommand } from "../parallel/console.js";
import { stopParallelRunFlow } from "../parallel/stop-state.js";
import {
	deleteCompletionFact,
	releaseFlowContext,
	rememberFlowContext,
} from "../runtime.js";
import { currentGoal, writeFlow } from "../store.js";
import type { FlowState } from "../types.js";
import { validateFlowDir } from "../validator.js";
import { closeFlowGoalWatcher } from "../watcher.js";
import { flowTargetOrNotify, flowValidationFailedNotice } from "./shared.js";

interface StopFlowResult {
	alreadyComplete: boolean;
	releaseSessionFiles: string[];
	saved: FlowState;
	shouldAbortCurrentAgent: boolean;
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
	if (result.shouldAbortCurrentAgent) abortCurrentAgent(ctx);
	if (activeBatch) await activeBatch.wait();
	cancelFlowGeneration(ctx, location.dir, result.saved.id);
	for (const sessionFile of result.releaseSessionFiles)
		releaseFlowContext(sessionFile);
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
		const paused = await pauseGoalFromFlow(ctx);
		if (paused) abortCurrentAgent(ctx);
		recordStopCompletionBoundary(ctx, sessionFile);
		return paused;
	}
	if (!existsSync(sessionFile)) return false;
	let paused = false;
	await ctx.switchSession(sessionFile, {
		withSession: async (sessionCtx) => {
			rememberFlowContext(sessionCtx);
			paused = await pauseGoalFromFlow(sessionCtx);
			if (paused) abortCurrentAgent(sessionCtx);
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

async function stopFlowTransaction(
	ctx: ExtensionCommandContext,
	dir: string,
	language: "zh" | "en",
): Promise<StopFlowResult | undefined> {
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
			releaseSessionFiles: [],
			saved: flow,
			shouldAbortCurrentAgent: false,
		};
	cancelParallelBatch(dir);
	const plan = currentGoal(flow);
	const releaseSessionFiles = stoppedSessionFiles(flow, plan?.sessionFile);
	const shouldPauseGoal =
		flow.status === "running" &&
		flow.parallelRun === null &&
		plan?.status === "running";
	const shouldAbortCurrentAgent = preDraftOwnedByCurrentSession(ctx, dir, flow);
	if (shouldPauseGoal) await pauseTargetGoal(ctx, plan?.sessionFile ?? null);
	const saved = writeFlow(dir, stopFlowState(dir, flow));
	closeFlowGoalWatcher(dir);
	publishFlowReportProjection(ctx, dir, saved);
	return {
		alreadyComplete: saved.status === "complete",
		releaseSessionFiles,
		saved,
		shouldAbortCurrentAgent,
	};
}

function stoppedSessionFiles(flow: FlowState, goalSessionFile?: string | null) {
	const files = [flow.parallelRun?.consoleSessionFile, goalSessionFile].filter(
		(file): file is string => Boolean(file),
	);
	return [...new Set(files)];
}

function stopFlowState(dir: string, flow: FlowState): FlowState {
	if (flow.parallelRun) return stopParallelRunFlow(dir, flow);
	return {
		...flow,
		status: "paused",
		parallelRun: null,
		errors: [],
		goals: flow.goals,
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
		readAlignmentStateIfExists(dir)?.sessionFile === currentSessionFile(ctx)
	);
}

function abortCurrentAgent(ctx: ExtensionCommandContext) {
	const abort = (ctx as { abort?: () => void }).abort;
	const isIdle = (ctx as { isIdle?: () => boolean }).isIdle;
	if (typeof abort === "function" && isIdle?.() === false) abort.call(ctx);
}

function flowPausedMessage(id: string, language: "zh" | "en") {
	const command = quoteCommand(`/flow go ${id}`);
	return language === "en"
		? formatUserNotice("⚠️", "Flow paused", [
				`ID: ${id}`,
				`Run ${command} to continue`,
			])
		: formatUserNotice("⚠️", "Flow 已暂停", [
				`编号：${id}`,
				`运行 ${command} 继续`,
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
