import { join } from "node:path";
import { flowStepLabel } from "../../shared/progress-labels.js";
import { completeGoalWithFact } from "../goal-completion.js";
import { writeFlowHtml } from "../html.js";
import { writeFlow } from "../store.js";
import type { FlowState, GoalCompletionFact } from "../types.js";
import { replaceGoal } from "../util.js";
import { readCompletionFact } from "./result-watcher.js";

export interface ParallelWorkerResult {
	goalIndex: number;
	fact: GoalCompletionFact | null;
	exitCode: number | null;
	exitSignal: NodeJS.Signals | null;
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
	const final = allSuccess
		? settled.goals.every((goal) => goal.status === "complete")
		: false;
	const saved = writeFlow(dir, {
		...settled,
		status: final ? "complete" : "running",
		currentGoal: nextCurrentGoal(
			settled,
			normalized,
			allSuccess,
			final,
			options.requireSuccessfulExit,
		),
		parallelRun: null,
		errors: allSuccess
			? []
			: failureLines(flow, normalized, completedIndexes, options.recovery),
	});
	writeFlowHtml(dir, saved);
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

function nextCurrentGoal(
	flow: FlowState,
	results: ParallelWorkerResult[],
	allSuccess: boolean,
	final: boolean,
	requireSuccessfulExit: boolean,
) {
	if (final) return flow.goals.length - 1;
	if (!allSuccess)
		return (
			firstFailedGoalIndex(results, requireSuccessfulExit) ?? flow.currentGoal
		);
	return Math.min(
		Math.max(...results.map((result) => result.goalIndex)) + 1,
		flow.goals.length - 1,
	);
}

function resetFailedWorkerGoal(flow: FlowState, goalIndex: number) {
	const goal = flow.goals[goalIndex];
	if (!goal) return flow;
	return {
		...flow,
		goals: replaceGoal(flow, goalIndex, {
			...goal,
			status: "pending",
			sessionFile: null,
			sessionName: null,
			snapshot: null,
			snapshotHash: null,
		}),
	};
}

function workerFailureLine(flow: FlowState, result: ParallelWorkerResult) {
	const label = goalLabel(flow, result.goalIndex);
	const parts = [
		workerExitSummary(result, flow.language),
		workerResultSummary(result, flow.language),
	];
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
		return language === "en" ? "result.json present" : "已写 result.json";
	return language === "en" ? "missing result.json" : "缺少 result.json";
}

function emptyResult(goalIndex: number): ParallelWorkerResult {
	return {
		goalIndex,
		fact: null,
		exitCode: null,
		exitSignal: null,
	};
}

function workerResultPath(dir: string, goalIndex: number) {
	return join(workerDir(dir, goalIndex), "result.json");
}

function workerDir(dir: string, goalIndex: number) {
	return join(dir, "workers", `G${goalIndex}`);
}
