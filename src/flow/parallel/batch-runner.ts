import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	setFlowCancelHandler,
	setFlowEditorInputHidden,
} from "../../shared/activity-frame.js";
import { flowStepLabel } from "../../shared/progress-labels.js";
import { settledChecks } from "../../shared/report-review.js";
import { sendResultCard } from "../../shared/result-card.js";
import { completeGoalWithFact } from "../execution/continue.js";
import { writeFlowHtml } from "../html.js";
import { planSnapshotHash } from "../snapshot.js";
import { writeFlow } from "../store.js";
import type { FlowState, GoalCompletionFact } from "../types.js";
import { flowSessionName, replaceGoal, requireFlowStartedAt } from "../util.js";
import { closeFlowGoalWatcher, watchParallelBatch } from "../watcher.js";
import { showParallelLaneBoard } from "./lane-ui.js";
import { readCompletionFact, watchBatchResults } from "./result-watcher.js";
import { spawnWorker, type WorkerHandle } from "./spawner.js";

export interface WorkerResult {
	goalIndex: number;
	fact: GoalCompletionFact | null;
	exitCode: number | null;
	exitSignal: NodeJS.Signals | null;
}

export interface BatchResult {
	allSuccess: boolean;
	cancelled: boolean;
	flow: FlowState;
	results: WorkerResult[];
}

export interface RunParallelBatchOptions {
	signal?: AbortSignal;
	onWorkerEvent?: (goalIndex: number, event: unknown) => void;
}

interface WorkerState extends WorkerResult {
	exited: boolean;
}

interface ActiveBatch {
	controller: AbortController;
	cwd: string;
	dir: string;
	done: Promise<void>;
	flow: FlowState;
}

const activeBatches = new Map<string, ActiveBatch>();

export function activeParallelBatch(cwd: string) {
	for (const batch of activeBatches.values()) {
		if (batch.cwd === cwd)
			return {
				dir: batch.dir,
				flow: batch.flow,
				cancel: () => batch.controller.abort(),
				wait: () => batch.done,
			};
	}
	return undefined;
}

export function cancelParallelBatch(dir: string) {
	const batch = activeBatches.get(dir);
	if (!batch) return false;
	batch.controller.abort();
	return true;
}

export async function runParallelBatch(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
	pi: ExtensionAPI,
	options: RunParallelBatchOptions = {},
): Promise<BatchResult> {
	const controller = linkedAbortController(options.signal);
	const done = deferredDone();
	const laneBoard = showParallelLaneBoard(ctx, dir, flow, batchIndices);
	setFlowEditorInputHidden(true);
	setFlowCancelHandler(() => controller.abort());
	try {
		const prepared = prepareParallelBatchStart(dir, flow, batchIndices);
		for (const goalIndex of batchIndices)
			mkdirSync(workerDir(dir, goalIndex), { recursive: true });
		watchParallelBatch(dir, prepared, batchIndices);
		activeBatches.set(dir, {
			controller,
			cwd: ctx.cwd,
			dir,
			done: done.promise,
			flow: prepared,
		});
		const collected = await collectWorkerResults(
			ctx,
			dir,
			prepared,
			batchIndices,
			controller.signal,
			(goalIndex, event) => {
				laneBoard.updateWorkerEvent(goalIndex, event);
				options.onWorkerEvent?.(goalIndex, event);
			},
			laneBoard.updateWorkerExit,
		);
		if (collected.cancelled)
			return { ...collected, flow: cancelBatch(dir, prepared) };
		if (!collected.allSuccess)
			return {
				...collected,
				flow: failBatch(pi, ctx, dir, prepared, collected),
			};
		return {
			...collected,
			flow: fanInSuccess(dir, prepared, batchIndices, collected.results),
		};
	} finally {
		activeBatches.delete(dir);
		closeFlowGoalWatcher();
		setFlowEditorInputHidden(false);
		setFlowCancelHandler(undefined);
		laneBoard.dispose();
		done.resolve();
	}
}

function prepareParallelBatchStart(
	dir: string,
	flow: FlowState,
	batchIndices: number[],
) {
	let goals = flow.goals;
	for (const index of batchIndices) {
		const goal = flow.goals[index];
		const snapshot =
			goal.snapshot ?? readFileSync(join(dir, goal.file), "utf8");
		goals = replaceGoal({ ...flow, goals }, index, {
			...goal,
			status: "running",
			sessionFile: workerSessionPath(dir, index),
			sessionName: flowSessionName(flow, goal),
			snapshot,
			snapshotHash: goal.snapshotHash ?? planSnapshotHash(snapshot),
		});
	}
	const startedAt =
		flow.status === "draft" ? Date.now() : requireFlowStartedAt(flow);
	return {
		...flow,
		status: "running" as const,
		startedAt,
		currentGoal: Math.min(...batchIndices),
		parallelBatch: batchIndices,
		errors: [],
		goals,
	};
}

function collectWorkerResults(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
	signal: AbortSignal,
	onWorkerEvent: RunParallelBatchOptions["onWorkerEvent"],
	onWorkerExit: (
		goalIndex: number,
		exitCode: number | null,
		exitSignal: NodeJS.Signals | null,
	) => void,
) {
	return new Promise<Omit<BatchResult, "flow">>((resolve) => {
		const states = new Map(
			batchIndices.map((index) => [index, workerState(index)]),
		);
		const paths = new Map(
			batchIndices.map((index) => [workerResultPath(dir, index), index]),
		);
		const cleanups: Array<() => void> = [];
		let handles: WorkerHandle[] = [];
		let done = false;
		const cleanup = () => {
			for (const item of cleanups) item();
		};
		const finishIfDone = () => {
			if (done || ![...states.values()].every((state) => state.exited)) return;
			done = true;
			readExistingResults(paths, states);
			cleanup();
			const results = batchIndices.map(
				(index) => states.get(index) ?? workerState(index),
			);
			resolve({
				cancelled: signal.aborted,
				allSuccess: results.every((item) => item.exitCode === 0 && item.fact),
				results,
			});
		};
		const abort = () => {
			for (const handle of handles) handle.kill();
		};
		for (const path of paths.keys()) rmSync(path, { force: true });
		handles = batchIndices.map((goalIndex) => {
			const handle = spawnWorker({
				flowId: flow.id,
				goalIndex,
				flowDir: dir,
				cwd: ctx.cwd,
				signal,
			});
			cleanups.push(
				handle.onEvent((event) => onWorkerEvent?.(goalIndex, event)),
			);
			cleanups.push(
				handle.onExit((exitCode, exitSignal) => {
					onWorkerExit(goalIndex, exitCode, exitSignal);
					const state = states.get(goalIndex);
					if (!state) return;
					state.exitCode = exitCode;
					state.exitSignal = exitSignal;
					state.exited = true;
					finishIfDone();
				}),
			);
			return handle;
		});
		cleanups.push(
			watchBatchResults(
				[...paths.keys()],
				(path, fact) => {
					const state = states.get(paths.get(path) ?? -1);
					if (state) state.fact = fact;
				},
				signal,
			),
		);
		if (signal.aborted) abort();
		signal.addEventListener("abort", abort, { once: true });
		cleanups.push(() => signal.removeEventListener("abort", abort));
	});
}

function readExistingResults(
	paths: Map<string, number>,
	states: Map<number, WorkerState>,
) {
	for (const [path, goalIndex] of paths) {
		const state = states.get(goalIndex);
		if (!state || state.fact) continue;
		const fact = readCompletionFact(path);
		if (fact) state.fact = fact;
	}
}

function fanInSuccess(
	dir: string,
	flow: FlowState,
	batchIndices: number[],
	results: WorkerResult[],
) {
	const factByIndex = new Map(
		results.map((item) => [item.goalIndex, item.fact]),
	);
	let completed = flow;
	for (const goalIndex of batchIndices) {
		const fact = factByIndex.get(goalIndex);
		if (!fact) throw new Error(`worker ${goalIndex} 缺少完成结果`);
		completed = completeGoalWithFact(dir, completed, goalIndex, fact);
	}
	const final = completed.goals.every((goal) => goal.status === "complete");
	const nextGoal = Math.min(
		Math.max(...batchIndices) + 1,
		completed.goals.length - 1,
	);
	const saved = writeFlow(dir, {
		...completed,
		status: final ? "complete" : "running",
		currentGoal: final ? completed.goals.length - 1 : nextGoal,
		parallelBatch: null,
		errors: [],
	});
	writeFlowHtml(dir, saved);
	return saved;
}

function failBatch(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	result: Omit<BatchResult, "flow">,
) {
	const settled = settleFailedBatchGoals(dir, flow, result.results);
	const lines = failureLines(flow, result.results);
	const title =
		flow.language === "en"
			? "Flow parallel batch failed"
			: "Flow 并行批次未通过";
	const saved = writeFlow(dir, {
		...settled,
		status: "running",
		currentGoal: firstFailedGoalIndex(result.results) ?? flow.currentGoal,
		parallelBatch: null,
		errors: lines,
	});
	writeFlowHtml(dir, saved);
	sendResultCard(pi, ctx, [`[${title}]`, "", ...lines].join("\n"), {
		tone: "neutral",
		result: "未通过",
		title,
		lines,
		language: flow.language,
	});
	return saved;
}

function settleFailedBatchGoals(
	dir: string,
	flow: FlowState,
	results: WorkerResult[],
) {
	let settled = flow;
	for (const result of results) {
		if (isSuccessfulWorker(result)) {
			settled = completeGoalWithFact(
				dir,
				settled,
				result.goalIndex,
				result.fact,
			);
		} else {
			settled = resetFailedWorkerGoal(settled, result.goalIndex);
		}
	}
	return settled;
}

function isSuccessfulWorker(
	result: WorkerResult,
): result is WorkerResult & { fact: GoalCompletionFact } {
	return result.exitCode === 0 && result.fact !== null;
}

function firstFailedGoalIndex(results: WorkerResult[]) {
	return results.find((result) => !isSuccessfulWorker(result))?.goalIndex;
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

function cancelBatch(dir: string, flow: FlowState) {
	const saved = writeFlow(dir, {
		...flow,
		status: "cancelled",
		parallelBatch: null,
		goals: flow.goals.map((goal) => ({
			...goal,
			checks: settledChecks(goal.checks),
		})),
	});
	writeFlowHtml(dir, saved);
	return saved;
}

function failureLines(flow: FlowState, results: WorkerResult[]) {
	return results
		.filter((result) => !isSuccessfulWorker(result))
		.map((result) => {
			const goal = flow.goals[result.goalIndex];
			const label = goal
				? flowStepLabel(result.goalIndex, goal.title, flow.language)
				: `G${result.goalIndex}`;
			const parts = [
				workerExitSummary(result, flow.language),
				workerResultSummary(result, flow.language),
			];
			return flow.language === "en"
				? `${label}: ${parts.join("; ")}`
				: `${label}：${parts.join("；")}`;
		});
}

function workerExitSummary(
	result: WorkerResult,
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
	result: WorkerResult,
	language: FlowState["language"],
) {
	if (result.fact)
		return language === "en" ? "result.json present" : "已写 result.json";
	return language === "en" ? "missing result.json" : "缺少 result.json";
}

function deferredDone() {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function linkedAbortController(signal: AbortSignal | undefined) {
	const controller = new AbortController();
	if (!signal) return controller;
	if (signal.aborted) controller.abort();
	else
		signal.addEventListener("abort", () => controller.abort(), { once: true });
	return controller;
}

function workerState(goalIndex: number): WorkerState {
	return {
		goalIndex,
		fact: null,
		exitCode: null,
		exitSignal: null,
		exited: false,
	};
}

function workerSessionPath(dir: string, goalIndex: number) {
	return join(workerDir(dir, goalIndex), "session.jsonl");
}

function workerResultPath(dir: string, goalIndex: number) {
	return join(workerDir(dir, goalIndex), "result.json");
}

function workerDir(dir: string, goalIndex: number) {
	return join(dir, "workers", `G${goalIndex}`);
}
