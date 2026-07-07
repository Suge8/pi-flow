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
import { sendResultCard } from "../../shared/result-card.js";
import { notifyUser } from "../../shared/ui-language.js";
import { flowValidationFailedNotice } from "../execution/shared.js";
import { writeFlowHtml } from "../html.js";
import { flowLockBusyMessage, withFlowLock } from "../lock.js";
import { computeReadyBatch } from "../scheduler.js";
import { planSnapshotHash } from "../snapshot.js";
import { writeFlow } from "../store.js";
import type { FlowState } from "../types.js";
import { flowSessionName, replaceGoal, requireFlowStartedAt } from "../util.js";
import { validateFlowDir } from "../validator.js";
import { closeFlowGoalWatcher, watchParallelBatch } from "../watcher.js";
import {
	type ParallelFanInResult,
	type ParallelWorkerResult,
	settleParallelRun,
} from "./fan-in.js";
import { showParallelLaneBoard } from "./lane-ui.js";
import { readCompletionFact, watchBatchResults } from "./result-watcher.js";
import { spawnWorker, type WorkerHandle } from "./spawner.js";
import { stopParallelRunFlow } from "./stop-state.js";

export interface WorkerResult extends ParallelWorkerResult {}

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
	dir: string;
	done: Promise<void>;
	flow: FlowState;
}

interface ParallelRunStart {
	collected: Promise<Omit<BatchResult, "flow">>;
	done: ReturnType<typeof deferredDone>;
	laneBoard: ReturnType<typeof showParallelLaneBoard>;
	prepared: FlowState;
}

const activeBatches = new Map<string, ActiveBatch>();

export function activeParallelBatchForDir(dir: string) {
	const batch = activeBatches.get(dir);
	if (!batch) return undefined;
	return {
		dir: batch.dir,
		flow: batch.flow,
		cancel: () => batch.controller.abort(),
		wait: () => batch.done,
	};
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
	const started = await withFlowLock(dir, `start parallel ${flow.id}`, () =>
		beginParallelBatch(ctx, dir, flow, batchIndices, options),
	);
	if (!started.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(started.owner, flow.language),
			"info",
			flow.language,
		);
		return { allSuccess: false, cancelled: false, flow, results: [] };
	}
	if (!started.value)
		return { allSuccess: false, cancelled: false, flow, results: [] };
	const run = started.value;
	try {
		const collected = await run.collected;
		if (collected.cancelled)
			return { ...collected, flow: await cancelParallelRun(ctx, dir, run) };
		const fanIn = await fanInParallelRun(ctx, dir, run, collected.results);
		if (!fanIn.allSuccess)
			sendParallelFailureCard(pi, ctx, fanIn.flow, fanIn.errors);
		return {
			...collected,
			allSuccess: fanIn.allSuccess,
			flow: fanIn.flow,
			results: fanIn.results,
		};
	} finally {
		cleanupParallelRun(dir, run);
	}
}

function beginParallelBatch(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
	options: RunParallelBatchOptions,
): ParallelRunStart | undefined {
	const current = validatedFlowForParallelStart(ctx, dir, flow);
	if (!current) return undefined;
	const batch = computeReadyBatch(current);
	if (batch?.mode !== "parallel") return undefined;
	const indices = batch.indices.length > 0 ? batch.indices : batchIndices;
	const controller = linkedAbortController(options.signal);
	const done = deferredDone();
	const laneBoard = showParallelLaneBoard(ctx, dir, current, indices);
	setFlowEditorInputHidden(true);
	setFlowCancelHandler(() => controller.abort());
	try {
		for (const goalIndex of indices)
			mkdirSync(workerDir(dir, goalIndex), { recursive: true });
		const prepared = writeFlow(
			dir,
			prepareParallelBatchStart(dir, current, indices),
		);
		writeFlowHtml(dir, prepared);
		watchParallelBatch(dir, prepared, indices);
		activeBatches.set(dir, {
			controller,
			dir,
			done: done.promise,
			flow: prepared,
		});
		return {
			collected: collectWorkerResults(
				ctx,
				dir,
				prepared,
				indices,
				controller.signal,
				(goalIndex, event) => {
					laneBoard.updateWorkerEvent(goalIndex, event);
					options.onWorkerEvent?.(goalIndex, event);
				},
				laneBoard.updateWorkerExit,
			),
			done,
			laneBoard,
			prepared,
		};
	} catch (error) {
		cleanupParallelRun(dir, { done, laneBoard });
		throw error;
	}
}

async function cancelParallelRun(
	ctx: ExtensionCommandContext,
	dir: string,
	run: ParallelRunStart,
) {
	const locked = await withFlowLock(
		dir,
		`cancel parallel ${run.prepared.id}`,
		() => cancelBatch(dir, latestParallelFlow(dir, run.prepared)),
	);
	if (locked.ok) return locked.value;
	notifyUser(
		ctx,
		flowLockBusyMessage(locked.owner, run.prepared.language),
		"info",
		run.prepared.language,
	);
	return run.prepared;
}

async function fanInParallelRun(
	ctx: ExtensionCommandContext,
	dir: string,
	run: ParallelRunStart,
	results: WorkerResult[],
): Promise<ParallelFanInResult> {
	const locked = await withFlowLock(dir, `fan-in ${run.prepared.id}`, () => {
		const current = latestParallelFlow(dir, run.prepared);
		if (current.parallelRun?.id !== run.prepared.parallelRun?.id)
			return settledByOtherTransaction(current, results);
		return settleParallelRun(dir, current, results, {
			requireSuccessfulExit: true,
		});
	});
	if (locked.ok) return locked.value;
	notifyUser(
		ctx,
		flowLockBusyMessage(locked.owner, run.prepared.language),
		"info",
		run.prepared.language,
	);
	return settledByOtherTransaction(run.prepared, results);
}

function cleanupParallelRun(
	dir: string,
	run: Pick<ParallelRunStart, "done" | "laneBoard">,
) {
	activeBatches.delete(dir);
	closeFlowGoalWatcher(dir);
	setFlowEditorInputHidden(false);
	setFlowCancelHandler(undefined);
	run.laneBoard.dispose();
	run.done.resolve();
}

function validatedFlowForParallelStart(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
) {
	const validation = validateFlowDir(dir, flow.language);
	if (validation.ok && validation.flow) return validation.flow;
	notifyUser(
		ctx,
		flowValidationFailedNotice(validation.errors, flow.language),
		"info",
		flow.language,
	);
	return undefined;
}

function latestParallelFlow(dir: string, fallback: FlowState) {
	const validation = validateFlowDir(dir, fallback.language);
	return validation.flow ?? fallback;
}

function settledByOtherTransaction(
	flow: FlowState,
	results: WorkerResult[],
): ParallelFanInResult {
	return {
		allSuccess: flow.parallelRun === null && flow.errors.length === 0,
		completedIndexes: [],
		errors: flow.errors,
		flow,
		resetIndexes: [],
		results,
	};
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
	const parallelStartedAt = Date.now();
	const startedAt =
		flow.status === "draft" || flow.startedAt === null
			? parallelStartedAt
			: requireFlowStartedAt(flow);
	return {
		...flow,
		status: "running" as const,
		startedAt,
		currentGoal: Math.min(...batchIndices),
		parallelRun: {
			id: parallelRunId(parallelStartedAt),
			goalIndexes: [...batchIndices],
			startedAt: parallelStartedAt,
		},
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
		const parallelRunId = flow.parallelRun?.id;
		if (!parallelRunId) throw new Error("Missing parallel run id.");
		let handles: WorkerHandle[] = [];
		let done = false;
		const cleanup = () => {
			for (const item of cleanups) item();
		};
		const finishIfDone = () => {
			if (done || ![...states.values()].every((state) => state.exited)) return;
			done = true;
			readExistingResults(paths, states, parallelRunId);
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
				parallelRunId,
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
				parallelRunId,
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
	parallelRunId: string | undefined,
) {
	for (const [path, goalIndex] of paths) {
		const state = states.get(goalIndex);
		if (!state || state.fact) continue;
		const fact = readCompletionFact(path, parallelRunId);
		if (fact) state.fact = fact;
	}
}

function sendParallelFailureCard(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	flow: FlowState,
	lines: string[],
) {
	const title =
		flow.language === "en"
			? "Flow parallel batch failed"
			: "Flow 并行批次未通过";
	sendResultCard(pi, ctx, [`[${title}]`, "", ...lines].join("\n"), {
		tone: "neutral",
		result: "未通过",
		title,
		lines,
		language: flow.language,
	});
}

function cancelBatch(dir: string, flow: FlowState) {
	const saved = writeFlow(dir, stopParallelRunFlow(dir, flow));
	writeFlowHtml(dir, saved);
	return saved;
}

function parallelRunId(startedAt: number) {
	return `P${startedAt}`;
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
