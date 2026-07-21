import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { GoalHandoff } from "../../goal/types.js";
import {
	activityRows,
	setFlowCancelHandler,
	setGoalActivityBox,
} from "../../shared/activity-frame.js";
import { requestPiAttention } from "../../shared/activity-signal.js";
import {
	type AgentProgressScope,
	openProgressScope,
} from "../../shared/agent-progress.js";
import { autoOpenMonitorOverlay } from "../../shared/monitor-overlay.js";
import { flowStepLabel } from "../../shared/progress-labels.js";
import { sendResultCard } from "../../shared/result-card.js";
import { notifyUser, setStatusText } from "../../shared/ui-language.js";
import { flowValidationFailedNotice } from "../execution/shared.js";
import { workerInitialPrompt } from "../execution/worker-command.js";
import { publishFlowReportProjection } from "../html.js";
import {
	flowLockBusyMessage,
	watchFlowLockRelease,
	withFlowLock,
} from "../lock.js";
import { currentSessionFile } from "../ownership.js";
import {
	isForkedWorkerSession,
	prepareWorkerTrajectorySessions,
	releaseGenerationSession,
} from "../prewalk.js";
import { computeReadyBatch } from "../scheduler.js";
import { writeFlow } from "../store.js";
import type { FlowState } from "../types.js";
import {
	flowCommandId,
	flowSessionName,
	replaceGoal,
	requireFlowStartedAt,
} from "../util.js";
import { validateFlowDir } from "../validator.js";
import { closeFlowGoalWatcher, watchParallelBatch } from "../watcher.js";
import {
	parallelConsoleCommandHint,
	parallelConsoleSessionName,
	quoteCommand,
} from "./console.js";
import {
	type ParallelFanInResult,
	type ParallelWorkerResult,
	settleParallelRun,
} from "./fan-in.js";
import { showParallelLaneBoard } from "./lane-ui.js";
import { readCompletionFact, watchBatchResults } from "./result-watcher.js";
import { spawnWorker, type WorkerHandle } from "./spawner.js";
import { stopParallelRunFlow } from "./stop-state.js";
import {
	appendWorkerEvent,
	initWorkerArtifact,
	readWorkerArtifact,
	readWorkerCompletion,
	readWorkerHandoff,
	updateWorkerArtifactStatus,
	workerArtifactPath,
} from "./worker-artifact.js";

export interface WorkerResult extends ParallelWorkerResult {}

export interface BatchResult {
	allSuccess: boolean;
	cancelled: boolean;
	flow: FlowState;
	handoff?: ParallelBlockedHandoff;
	results: WorkerResult[];
}

export interface ParallelBlockedHandoff {
	goalIndex: number;
	handoff: GoalHandoff;
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
	progressScope: AgentProgressScope;
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
	pi: ExtensionAPI | undefined,
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
		if (collected.handoff) {
			const settled = await settleParallelBlockedRun(
				ctx,
				dir,
				run.prepared,
				collected.handoff,
			);
			return { ...collected, allSuccess: false, flow: settled.flow };
		}
		const fanIn = await fanInParallelRun(ctx, dir, run, collected.results);
		sendParallelConsoleResultCard(pi, ctx, fanIn);
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
	const batch = current.parallelRun ? undefined : computeReadyBatch(current);
	if (!current.parallelRun && batch?.mode !== "parallel") return undefined;
	const indices =
		current.parallelRun?.goalIndexes ?? batch?.indices ?? batchIndices;
	const controller = linkedAbortController(options.signal);
	const done = deferredDone();
	const progressScope = openProgressScope(
		"parallel",
		current.parallelRun?.consoleSessionName ??
			parallelConsoleSessionName(current, indices),
	);
	const progressAgents = new Map(
		indices.map((goalIndex) => [
			goalIndex,
			progressScope.register(
				parallelAgentKey(goalIndex),
				current.goals[goalIndex]?.title ?? `G${goalIndex + 1}`,
			),
		]),
	);
	if (current.parallelRun)
		for (const goalIndex of indices)
			if (readWorkerCompletion(dir, goalIndex, current.parallelRun.id))
				progressScope.finish(parallelAgentKey(goalIndex));
	autoOpenMonitorOverlay(ctx, progressScope.id, current.language);
	setGoalActivityBox(ctx, undefined);
	ctx.ui.setStatus("goal", undefined);
	let laneBoard: ReturnType<typeof showParallelLaneBoard>;
	try {
		laneBoard = showParallelLaneBoard(ctx, dir, current, indices, {
			scopeId: progressScope.id,
			agents: progressAgents,
		});
	} catch (error) {
		progressScope.close();
		throw error;
	}
	setFlowCancelHandler(() => controller.abort(), {
		captureWhenInputVisible: true,
	});
	try {
		const prepared = writeFlow(
			dir,
			prepareParallelBatchStart(ctx, dir, current, indices),
		);
		publishFlowReportProjection(ctx, dir, prepared);
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
					progressScope.feed(parallelAgentKey(goalIndex), event);
					laneBoard.updateWorkerEvent(goalIndex);
					options.onWorkerEvent?.(goalIndex, event);
				},
				(goalIndex, exitCode, exitSignal, stderr, succeeded) => {
					progressScope.finish(parallelAgentKey(goalIndex), !succeeded);
					laneBoard.updateWorkerExit(goalIndex, exitCode, exitSignal, stderr);
				},
			),
			done,
			laneBoard,
			prepared,
			progressScope,
		};
	} catch (error) {
		cleanupParallelRun(dir, { done, laneBoard, progressScope });
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
		() => cancelBatch(ctx, dir, latestParallelFlow(dir, run.prepared)),
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

export async function settleParallelBlockedRun(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	blocked: ParallelBlockedHandoff,
) {
	const settled = await commitParallelBlockedRun(ctx, dir, flow, blocked, true);
	if (settled.applied) {
		publishFlowReportProjection(ctx, dir, settled.flow);
		showParallelBlockedHandoff(ctx, settled.flow, blocked);
	}
	return settled;
}

async function commitParallelBlockedRun(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	blocked: ParallelBlockedHandoff,
	notifyLock: boolean,
): Promise<{ applied: boolean; flow: FlowState }> {
	const locked = await withFlowLock(dir, `pause blocked ${flow.id}`, () => {
		const current = latestParallelFlow(dir, flow);
		if (
			current.status === "paused" &&
			current.currentGoal === blocked.goalIndex &&
			current.attention?.kind === "user_action_required" &&
			current.attention.message === blocked.handoff.message &&
			current.attention.at === blocked.handoff.at
		)
			return { applied: true, flow: current };
		const run = current.parallelRun;
		if (current.status !== "running" || !run || run.id !== flow.parallelRun?.id)
			return { applied: false, flow: current };
		const handoff = readWorkerHandoff(dir, blocked.goalIndex, run.id);
		if (
			!handoff ||
			handoff.message !== blocked.handoff.message ||
			handoff.at !== blocked.handoff.at
		)
			return { applied: false, flow: current };
		const stopped = stopParallelRunFlow(dir, current);
		return {
			applied: true,
			flow: writeFlow(dir, {
				...stopped,
				status: "paused",
				currentGoal: blocked.goalIndex,
				attention: handoff,
			}),
		};
	});
	if (locked.ok) return locked.value;
	if (notifyLock)
		notifyUser(
			ctx,
			flowLockBusyMessage(locked.owner, flow.language),
			"info",
			flow.language,
		);
	await waitForFlowLockRelease(dir);
	return commitParallelBlockedRun(ctx, dir, flow, blocked, false);
}

function waitForFlowLockRelease(dir: string) {
	return new Promise<void>((resolve, reject) => {
		try {
			watchFlowLockRelease(dir, resolve);
		} catch (error) {
			reject(error);
		}
	});
}

function showParallelBlockedHandoff(
	ctx: ExtensionCommandContext,
	flow: FlowState,
	blocked: ParallelBlockedHandoff,
) {
	const goal = flow.goals[blocked.goalIndex];
	const label = goal
		? flowStepLabel(goal.index, goal.title, flow.language)
		: `G${blocked.goalIndex + 1}`;
	const command = quoteCommand(`/flow go ${flowCommandId(flow.id)}`);
	const english = flow.language === "en";
	setGoalActivityBox(ctx, {
		language: flow.language,
		title: english
			? "🌊 Flow · waiting for your action"
			: "🌊 Flow · 等待你接管",
		rows: activityRows(label, [
			english
				? `To do: ${blocked.handoff.message}`
				: `待办：${blocked.handoff.message}`,
			english ? `Next: ${command}` : `下一步：${command}`,
		]),
	});
	setStatusText(
		ctx,
		"goal",
		english ? "🌊 Flow · waiting for your action" : "🌊 Flow · 等待你接管",
		flow.language,
	);
	requestPiAttention(`pi-flow:flow:${flow.id}`);
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
		return settleParallelRun(ctx, dir, current, results, {
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
	run: Pick<ParallelRunStart, "done" | "laneBoard" | "progressScope">,
) {
	activeBatches.delete(dir);
	closeFlowGoalWatcher(dir);
	setFlowCancelHandler(undefined);
	run.laneBoard.dispose();
	run.progressScope.close();
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
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
) {
	const parallelStartedAt = flow.parallelRun?.startedAt ?? Date.now();
	const runId = flow.parallelRun?.id ?? parallelRunId(parallelStartedAt);
	const trajectorySessions = prepareWorkerTrajectorySessions(
		ctx.cwd,
		dir,
		flow,
		batchIndices,
	);
	// 首次启动即释放生成会话记忆：启动后 startedAt 非 null，事实永不再命中。
	releaseGenerationSession(dir);
	let goals = flow.goals;
	for (const index of batchIndices) {
		const goal = flow.goals[index];
		const snapshot =
			goal.snapshot ?? readFileSync(join(dir, goal.file), "utf8");
		const sessionFile = workerSessionPath(
			ctx,
			dir,
			flow,
			index,
			trajectorySessions.get(index),
		);
		const sessionName = flowSessionName(flow, goal);
		if (!readWorkerCompletion(dir, index, runId))
			initWorkerArtifact(dir, flow, index, {
				parallelRunId: runId,
				sessionFile,
				sessionName,
			});
		goals = replaceGoal({ ...flow, goals }, index, {
			...goal,
			status: readWorkerCompletion(dir, index, runId) ? goal.status : "running",
			startedAt: goal.startedAt ?? parallelStartedAt,
			completedAt: goal.completedAt,
			sessionFile,
			sessionName,
			snapshot,
		});
	}
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
			id: runId,
			goalIndexes: [...batchIndices],
			startedAt: parallelStartedAt,
			consoleSessionFile:
				flow.parallelRun?.consoleSessionFile ??
				currentSessionFile(ctx) ??
				join(sessionDir(ctx), `${flow.id}-parallel-console.jsonl`),
			consoleSessionName:
				flow.parallelRun?.consoleSessionName ??
				parallelConsoleSessionName(flow, batchIndices),
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
		stderr: string | null,
		succeeded: boolean,
	) => void,
) {
	return new Promise<Omit<BatchResult, "flow">>((resolve) => {
		const states = new Map(
			batchIndices.map((index) => [
				index,
				initialWorkerState(dir, flow, index),
			]),
		);
		const paths = new Map(
			batchIndices.map((index) => [workerArtifactPath(dir, index), index]),
		);
		const cleanups: Array<() => void> = [];
		const parallelRunId = flow.parallelRun?.id;
		if (!parallelRunId) throw new Error("Missing parallel run id.");
		let handles: WorkerHandle[] = [];
		let handoff: ParallelBlockedHandoff | undefined;
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
				allSuccess:
					!handoff &&
					results.every((item) => workerCompletedSuccessfully(item, false)),
				...(handoff ? { handoff } : {}),
				results,
			});
		};
		const abort = () => {
			for (const handle of handles) handle.kill();
		};
		const stopOtherWorkers = (blockedGoalIndex: number) => {
			for (const handle of handles)
				if (handle.goalIndex !== blockedGoalIndex) handle.kill();
		};
		const startIndexes = batchIndices.filter(
			(index) => !states.get(index)?.fact,
		);
		handles = startIndexes.map((goalIndex) => {
			const sessionFile = flow.goals[goalIndex]?.sessionFile;
			if (!sessionFile)
				throw new Error(`Worker G${goalIndex + 1} missing session file.`);
			const handle = spawnWorker({
				flowId: flow.id,
				goalIndex,
				flowDir: dir,
				parallelRunId,
				cwd: ctx.cwd,
				initialPrompt: workerInitialPrompt(dir, flow, goalIndex, {
					forkedFromPlanSession: isForkedWorkerSession(sessionFile),
				}),
				sessionFile,
				signal,
			});
			cleanups.push(
				handle.onEvent((event) => {
					appendWorkerEvent(dir, goalIndex, event);
					onWorkerEvent?.(goalIndex, event);
				}),
			);
			cleanups.push(
				handle.onExit((exitCode, exitSignal, stderr) => {
					const state = states.get(goalIndex);
					if (!state) return;
					state.exitCode = exitCode;
					state.exitSignal = exitSignal;
					state.stderr = stderr;
					state.fact ??=
						readCompletionFact(
							workerArtifactPath(dir, goalIndex),
							parallelRunId,
						) ?? null;
					const workerHandoff = readWorkerHandoff(
						dir,
						goalIndex,
						parallelRunId,
					);
					if (workerHandoff && !handoff) {
						handoff = { goalIndex, handoff: workerHandoff };
						stopOtherWorkers(goalIndex);
					}
					state.exited = true;
					const succeeded = workerCompletedSuccessfully(
						state,
						Boolean(workerHandoff),
					);
					onWorkerExit(goalIndex, exitCode, exitSignal, stderr, succeeded);
					if (!workerHandoff && !succeeded)
						updateWorkerArtifactStatus(dir, goalIndex, "failed");
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
		finishIfDone();
	});
}

function workerCompletedSuccessfully(
	result: Pick<WorkerResult, "exitCode" | "fact">,
	blocked: boolean,
) {
	return !blocked && result.exitCode === 0 && result.fact !== null;
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

function sendParallelConsoleResultCard(
	pi: ExtensionAPI | undefined,
	ctx: ExtensionCommandContext,
	fanIn: ParallelFanInResult,
) {
	const flow = fanIn.flow;
	const title =
		flow.language === "en" ? "Flow parallel settled" : "Flow 并行已收口";
	const laneLines = fanIn.results.map((result) =>
		parallelResultLine(flow, result),
	);
	const next = parallelNextLine(flow, fanIn.allSuccess);
	const lines = [...laneLines, next];
	sendResultCard(
		pi,
		ctx,
		[`[${title}]`, "", ...laneLines, "", next].join("\n"),
		{
			tone: fanIn.allSuccess ? "success" : "neutral",
			result: fanIn.allSuccess ? "完成" : "未通过",
			title,
			lines,
			language: flow.language,
		},
	);
}

function parallelResultLine(flow: FlowState, result: WorkerResult) {
	const label = parallelResultLabel(flow, result.goalIndex);
	const summary = result.fact?.summary ?? parallelFailureSummary(flow, result);
	return flow.language === "en"
		? `${label}: ${summary}`
		: `${label}：${summary}`;
}

function parallelResultLabel(flow: FlowState, goalIndex: number) {
	const goal = flow.goals[goalIndex];
	return goal
		? flowStepLabel(goalIndex, goal.title, flow.language)
		: `G${goalIndex + 1}`;
}

function parallelFailureSummary(flow: FlowState, result: WorkerResult) {
	if (result.exitCode !== null)
		return flow.language === "en"
			? `exit code ${result.exitCode}`
			: `退出码 ${result.exitCode}`;
	if (result.exitSignal)
		return flow.language === "en"
			? `signal ${result.exitSignal}`
			: `信号 ${result.exitSignal}`;
	return flow.language === "en" ? "missing worker completion" : "缺少完成结果";
}

function parallelNextLine(flow: FlowState, allSuccess: boolean) {
	if (flow.status === "complete")
		return flow.language === "en"
			? "Next: Flow complete"
			: "下一步：Flow 已完成";
	if (!allSuccess) {
		const command = quoteCommand(`/flow go ${flowCommandId(flow.id)}`);
		return flow.language === "en"
			? `Next: ${command} to continue`
			: `下一步：${command}继续`;
	}
	const next = flow.goals[flow.currentGoal];
	if (!next)
		return flow.language === "en"
			? `Next: ${parallelConsoleCommandHint(flow)}`
			: `下一步：${parallelConsoleCommandHint(flow)}`;
	const label = flowStepLabel(next.index, next.title, flow.language);
	return flow.language === "en"
		? `Next: ${label} will open in Resume`
		: `下一步：${label} 将在 Resume 中打开`;
}

function cancelBatch(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
) {
	const saved = writeFlow(dir, stopParallelRunFlow(dir, flow));
	publishFlowReportProjection(ctx, dir, saved);
	return saved;
}

function parallelRunId(startedAt: number) {
	return `P${startedAt}`;
}

function parallelAgentKey(goalIndex: number) {
	return `G${goalIndex + 1}`;
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
		stderr: null,
		exited: false,
	};
}

function initialWorkerState(
	dir: string,
	flow: FlowState,
	goalIndex: number,
): WorkerState {
	const state = workerState(goalIndex);
	const fact = readWorkerCompletion(dir, goalIndex, flow.parallelRun?.id);
	if (!fact) return state;
	return { ...state, fact, exitCode: 0, exited: true };
}

function workerSessionPath(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	goalIndex: number,
	trajectorySession?: string,
) {
	const existing =
		readWorkerArtifact(dir, goalIndex)?.sessionFile ??
		flow.goals[goalIndex]?.sessionFile;
	if (existing) return existing;
	if (trajectorySession) return trajectorySession;
	const directory = sessionDir(ctx);
	mkdirSync(directory, { recursive: true });
	return join(
		directory,
		`${safeSessionFilename(flowSessionName(flow, flow.goals[goalIndex]))}.jsonl`,
	);
}

function sessionDir(ctx: ExtensionCommandContext) {
	const manager = ctx.sessionManager as
		| { getSessionDir?: () => string | undefined }
		| undefined;
	return manager?.getSessionDir?.() ?? ctx.cwd;
}

function safeSessionFilename(name: string) {
	return name
		.split("")
		.map((char) => (isUnsafeFilenameChar(char) ? "-" : char))
		.join("")
		.replace(/\s+/gu, " ")
		.trim()
		.slice(0, 120);
}

function isUnsafeFilenameChar(char: string) {
	return char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char);
}
