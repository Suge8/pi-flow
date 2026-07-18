import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { flowStepLabel } from "../../shared/progress-labels.js";
import { completeGoalWithFact } from "../goal-completion.js";
import { refreshFlowHtmlProjection } from "../html.js";
import { computeReadyBatch } from "../scheduler.js";
import { writeFlow } from "../store.js";
import type { FlowState, GoalCompletionFact } from "../types.js";
import { replaceGoal } from "../util.js";
import { readCompletionFact } from "./result-watcher.js";
import { workerArtifactPath } from "./worker-artifact.js";

export interface ParallelWorkerResult {
	goalIndex: number;
	fact: GoalCompletionFact | null;
	exitCode: number | null;
	exitSignal: NodeJS.Signals | null;
	stderr: string | null;
}

export interface ParallelFanInResult {
	allSuccess: boolean;
	completedIndexes: number[];
	errors: string[];
	flow: FlowState;
	resetIndexes: number[];
	results: ParallelWorkerResult[];
}

export interface SettleParallelRunOptions {
	requireSuccessfulExit: boolean;
	recovery?: boolean;
}

export function settleParallelRun(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	results: ParallelWorkerResult[],
	options: SettleParallelRunOptions,
): ParallelFanInResult {
	const run = flow.parallelRun;
	if (!run)
		return {
			allSuccess: false,
			completedIndexes: [],
			errors: [],
			flow,
			resetIndexes: [],
			results: [],
		};
	const normalized = normalizeResults(dir, run.id, run.goalIndexes, results);
	const completedIndexes: number[] = [];
	const resetIndexes: number[] = [];
	let settled = flow;
	for (const result of normalized) {
		if (isSuccessfulWorker(result, options.requireSuccessfulExit)) {
			if (settled.goals[result.goalIndex]?.status !== "complete")
				settled = completeGoalWithFact(
					dir,
					settled,
					result.goalIndex,
					result.fact,
				);
			completedIndexes.push(result.goalIndex);
		} else {
			settled = resetFailedWorkerGoal(settled, result.goalIndex);
			resetIndexes.push(result.goalIndex);
		}
	}
	const allSuccess = resetIndexes.length === 0;
	const saved = writeFlow(
		dir,
		allSuccess
			? completedParallelFlow(settled)
			: pausedParallelFlow(
					settled,
					flow,
					normalized,
					completedIndexes,
					options.recovery,
				),
	);
	refreshFlowHtmlProjection(ctx, dir, saved);
	return {
		allSuccess,
		completedIndexes,
		errors: saved.errors,
		flow: saved,
		resetIndexes,
		results: normalized,
	};
}

function isSuccessfulWorker(
	result: ParallelWorkerResult,
	requireSuccessfulExit = true,
): result is ParallelWorkerResult & { fact: GoalCompletionFact } {
	return (
		result.fact !== null && (!requireSuccessfulExit || result.exitCode === 0)
	);
}

function firstFailedGoalIndex(
	results: ParallelWorkerResult[],
	requireSuccessfulExit = true,
) {
	return results.find(
		(result) => !isSuccessfulWorker(result, requireSuccessfulExit),
	)?.goalIndex;
}

function failureLines(
	flow: FlowState,
	results: ParallelWorkerResult[],
	completedIndexes: number[] = [],
	recovery = false,
) {
	const failedLines = results
		.filter((result) => !isSuccessfulWorker(result, !recovery))
		.map((result) => workerFailureLine(flow, result));
	if (!recovery) return failedLines;
	const completed = completedIndexes.map((index) => goalLabel(flow, index));
	const reset = results
		.filter((result) => !isSuccessfulWorker(result, false))
		.map((result) => goalLabel(flow, result.goalIndex));
	return [recoverySummaryLine(flow, completed, reset), ...failedLines];
}

function normalizeResults(
	dir: string,
	parallelRunId: string,
	goalIndexes: number[],
	results: ParallelWorkerResult[],
) {
	const byIndex = new Map(results.map((result) => [result.goalIndex, result]));
	return goalIndexes.map((goalIndex) => {
		const result = byIndex.get(goalIndex) ?? emptyResult(goalIndex);
		return {
			...result,
			fact:
				matchingFact(result.fact, parallelRunId) ??
				readCompletionFact(workerResultPath(dir, goalIndex), parallelRunId) ??
				null,
		};
	});
}

function matchingFact(fact: GoalCompletionFact | null, parallelRunId: string) {
	return fact?.parallelRunId === parallelRunId ? fact : undefined;
}

function completedParallelFlow(flow: FlowState): FlowState {
	const final = flow.goals.every((goal) => goal.status === "complete");
	const ready = final
		? null
		: computeReadyBatch({ ...flow, parallelRun: null });
	return {
		...flow,
		status: final ? "complete" : "running",
		completedAt: final ? Date.now() : null,
		currentGoal: final
			? flow.goals.length - 1
			: (ready?.indices[0] ??
				firstIncompleteGoalIndex(flow) ??
				flow.currentGoal),
		parallelRun: null,
		errors: [],
	};
}

function pausedParallelFlow(
	settled: FlowState,
	original: FlowState,
	results: ParallelWorkerResult[],
	completedIndexes: number[],
	recovery = false,
): FlowState {
	return {
		...settled,
		status: "paused" as const,
		currentGoal:
			firstFailedGoalIndex(results, false) ??
			firstIncompleteGoalIndex(settled) ??
			settled.currentGoal,
		parallelRun: original.parallelRun,
		errors: failureLines(original, results, completedIndexes, recovery),
		goals: settled.goals,
	};
}

function firstIncompleteGoalIndex(flow: FlowState) {
	return flow.goals.find((goal) => goal.status !== "complete")?.index;
}

function resetFailedWorkerGoal(flow: FlowState, goalIndex: number) {
	const goal = flow.goals[goalIndex];
	if (!goal) return flow;
	return {
		...flow,
		goals: replaceGoal(flow, goalIndex, {
			...goal,
			status: "paused",
		}),
	};
}

function workerFailureLine(flow: FlowState, result: ParallelWorkerResult) {
	const label = goalLabel(flow, result.goalIndex);
	const parts = [
		workerExitSummary(result, flow.language),
		workerResultSummary(result, flow.language),
		workerStderrSummary(result, flow.language),
	].filter(Boolean);
	return flow.language === "en"
		? `${label}: ${parts.join("; ")}`
		: `${label}：${parts.join("；")}`;
}

function recoverySummaryLine(
	flow: FlowState,
	completed: string[],
	reset: string[],
) {
	const none = flow.language === "en" ? "none" : "无";
	return flow.language === "en"
		? `Parallel recovery: completed ${completed.join(", ") || none}; reset ${reset.join(", ") || none}`
		: `并行恢复：已收口 ${completed.join("、") || none}；已重置 ${reset.join("、") || none}`;
}

function goalLabel(flow: FlowState, goalIndex: number) {
	const goal = flow.goals[goalIndex];
	return goal
		? flowStepLabel(goalIndex, goal.title, flow.language)
		: `G${goalIndex}`;
}

function workerExitSummary(
	result: ParallelWorkerResult,
	language: FlowState["language"],
) {
	if (result.exitCode !== null)
		return language === "en"
			? `exit code ${result.exitCode}`
			: `退出码 ${result.exitCode}`;
	if (result.exitSignal)
		return language === "en"
			? `signal ${result.exitSignal}`
			: `信号 ${result.exitSignal}`;
	return language === "en" ? "exit unknown" : "退出状态未知";
}

function workerResultSummary(
	result: ParallelWorkerResult,
	language: FlowState["language"],
) {
	if (result.fact)
		return language === "en"
			? "worker completion present"
			: "已写 worker completion";
	return language === "en"
		? "missing worker completion"
		: "缺少 worker completion";
}

function workerStderrSummary(
	result: ParallelWorkerResult,
	language: FlowState["language"],
) {
	if (!result.stderr) return undefined;
	const stderr = truncateWorkerStderr(result.stderr);
	return language === "en" ? `stderr: ${stderr}` : `stderr：${stderr}`;
}

function truncateWorkerStderr(message: string) {
	return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

function emptyResult(goalIndex: number): ParallelWorkerResult {
	return {
		goalIndex,
		fact: null,
		exitCode: null,
		exitSignal: null,
		stderr: null,
	};
}

function workerResultPath(dir: string, goalIndex: number) {
	return workerArtifactPath(dir, goalIndex);
}
