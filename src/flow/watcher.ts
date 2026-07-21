import { join } from "node:path";
import {
	createPlanFileWatcher,
	planFileWatcherResourceSnapshot,
} from "../shared/plan-file-watcher.js";
import { tryWriteFlowHtml } from "./html.js";
import type { FlowWorkerArtifact } from "./parallel/worker-artifact.js";
import {
	readWorkerArtifact as readWorkerRuntimeArtifact,
	workerEventsPath,
} from "./parallel/worker-artifact.js";
import { readFlow } from "./store.js";
import type { FlowGoal, FlowGoalStatus, FlowState } from "./types.js";

const REPORT_REFRESH_FRAME_MS = 25;

type RefreshTarget =
	| { kind: "serial"; goalIndex: number; goalFile: string }
	| { kind: "parallel"; parallelRunId: string };

type FlowWatcherEntry = {
	watcher: ReturnType<typeof createPlanFileWatcher>;
	target: RefreshTarget;
	dirty: boolean;
	pendingFrame?: ReturnType<typeof setTimeout>;
	closed: boolean;
	signals: number;
	refreshes: number;
};

const flowGoalWatchers = new Map<string, FlowWatcherEntry>();

export function watchCurrentFlowGoal(dir: string, flow: FlowState) {
	const goal = flow.goals[flow.currentGoal];
	if (!goal) return closeFlowGoalWatcher(dir);
	const entry = watcherForFlow(dir, {
		kind: "serial",
		goalIndex: flow.currentGoal,
		goalFile: goal.file,
	});
	entry.watcher.watchFile(
		join(dir, goal.file),
		() => scheduleRefresh(dir, entry),
		{ skipIfSame: true },
	);
	scheduleInitialRefresh(dir, entry);
}

export function watchParallelBatch(
	dir: string,
	flow: FlowState,
	batchIndices: number[],
) {
	closeFlowGoalWatcher(dir);
	const parallelRunId = flow.parallelRun?.id;
	if (!parallelRunId) return;
	const entry = watcherForFlow(dir, { kind: "parallel", parallelRunId });
	const refresh = () => scheduleRefresh(dir, entry);
	for (const file of parallelWatchFiles(dir, flow, batchIndices)) {
		entry.watcher.watchFile(file, refresh, {
			keepExisting: true,
			skipIfSame: true,
		});
	}
	scheduleInitialRefresh(dir, entry);
}

export function closeFlowGoalWatcher(dir?: string) {
	if (dir) {
		const entry = flowGoalWatchers.get(dir);
		if (entry) closeWatcherEntry(entry);
		flowGoalWatchers.delete(dir);
		return;
	}
	for (const entry of flowGoalWatchers.values()) closeWatcherEntry(entry);
	flowGoalWatchers.clear();
}

export function flowGoalWatcherCount() {
	return flowGoalWatchers.size;
}

export function flowGoalWatcherResourceSnapshot() {
	let pendingFrames = 0;
	for (const entry of flowGoalWatchers.values())
		if (entry.pendingFrame) pendingFrames += 1;
	return {
		flows: flowGoalWatchers.size,
		...planFileWatcherResourceSnapshot(),
		pendingFrames,
	};
}

export function flowGoalWatcherStats(dir: string) {
	const entry = flowGoalWatchers.get(dir);
	return entry
		? {
				pending: entry.pendingFrame !== undefined,
				signals: entry.signals,
				refreshes: entry.refreshes,
				...entry.watcher.stats(),
			}
		: undefined;
}

function watcherForFlow(dir: string, target: RefreshTarget) {
	const entry = flowGoalWatchers.get(dir);
	if (entry && sameRefreshTarget(entry.target, target)) return entry;
	if (entry) closeWatcherEntry(entry);
	const next: FlowWatcherEntry = {
		watcher: createPlanFileWatcher(),
		target,
		dirty: false,
		closed: false,
		signals: 0,
		refreshes: 0,
	};
	flowGoalWatchers.set(dir, next);
	return next;
}

function sameRefreshTarget(left: RefreshTarget, right: RefreshTarget) {
	if (left.kind !== right.kind) return false;
	if (left.kind === "parallel" && right.kind === "parallel")
		return left.parallelRunId === right.parallelRunId;
	return (
		left.kind === "serial" &&
		right.kind === "serial" &&
		left.goalIndex === right.goalIndex &&
		left.goalFile === right.goalFile
	);
}

function scheduleRefresh(dir: string, entry: FlowWatcherEntry) {
	if (entry.closed || flowGoalWatchers.get(dir) !== entry) return;
	entry.signals += 1;
	entry.dirty = true;
	scheduleFrame(dir, entry);
}

function scheduleInitialRefresh(dir: string, entry: FlowWatcherEntry) {
	entry.dirty = true;
	scheduleFrame(dir, entry);
}

function scheduleFrame(dir: string, entry: FlowWatcherEntry) {
	if (entry.pendingFrame) return;
	entry.pendingFrame = setTimeout(
		() => runRefreshFrame(dir, entry),
		REPORT_REFRESH_FRAME_MS,
	);
	entry.pendingFrame.unref?.();
}

function runRefreshFrame(dir: string, entry: FlowWatcherEntry) {
	entry.pendingFrame = undefined;
	if (entry.closed || flowGoalWatchers.get(dir) !== entry || !entry.dirty)
		return;
	entry.dirty = false;
	try {
		refreshLatestFlow(dir, entry);
	} catch {
		// Best-effort derived UI refresh; command paths surface real errors.
	}
	if (entry.dirty) scheduleFrame(dir, entry);
}

function refreshLatestFlow(dir: string, entry: FlowWatcherEntry) {
	const flow = readFlow(dir);
	if (entry.target.kind === "serial") {
		const goal = flow.goals[entry.target.goalIndex];
		if (
			flow.status !== "running" ||
			flow.parallelRun !== null ||
			flow.currentGoal !== entry.target.goalIndex ||
			goal?.file !== entry.target.goalFile ||
			goal.status !== "running"
		)
			return;
		entry.refreshes += 1;
		tryWriteFlowHtml(dir, flow);
		return;
	}
	const run = flow.parallelRun;
	if (
		flow.status !== "running" ||
		!run ||
		run.id !== entry.target.parallelRunId
	)
		return;
	entry.refreshes += 1;
	tryWriteFlowHtml(dir, parallelReportFlow(dir, flow, run.goalIndexes, run.id));
}

function closeWatcherEntry(entry: FlowWatcherEntry) {
	entry.closed = true;
	entry.dirty = false;
	if (entry.pendingFrame) clearTimeout(entry.pendingFrame);
	entry.pendingFrame = undefined;
	entry.watcher.close();
}

function parallelWatchFiles(
	dir: string,
	flow: FlowState,
	batchIndices: number[],
) {
	const files = new Set<string>();
	for (const goalIndex of batchIndices) {
		const goal = flow.goals[goalIndex];
		if (goal) files.add(join(dir, goal.file));
		files.add(workerGoalPath(dir, goalIndex));
		// 事件文件是刷新节奏源：macOS FSEventStream 重建窗口可能丢单次文件事件，
		// 持续的事件流让 live report 在丢事件后自愈，不引入轮询。
		files.add(workerEventsPath(dir, goalIndex));
	}
	return files;
}

function parallelReportFlow(
	dir: string,
	flow: FlowState,
	batchIndices: number[],
	parallelRunId: string,
): FlowState {
	const batch = new Set(batchIndices);
	return {
		...flow,
		status: "running",
		currentGoal: Math.min(...batchIndices),
		goals: flow.goals.map((goal, index) =>
			batch.has(index) ? parallelGoal(dir, goal, index, parallelRunId) : goal,
		),
	};
}

function parallelGoal(
	dir: string,
	goal: FlowGoal,
	goalIndex: number,
	parallelRunId: string,
): FlowGoal {
	const artifact = readWorkerArtifact(dir, goalIndex, parallelRunId);
	return {
		...goal,
		status: artifact
			? flowGoalStatus(artifact.status)
			: goal.status === "complete"
				? "complete"
				: "running",
		checks: artifact?.checks ?? goal.checks,
		checkAttribution: artifact?.checkAttribution ?? goal.checkAttribution,
		sessionFile: artifact?.sessionFile ?? goal.sessionFile,
		sessionName: artifact?.sessionName ?? goal.sessionName,
		goalId: artifact?.runtimeGoalId ?? goal.goalId,
	};
}

function readWorkerArtifact(
	dir: string,
	goalIndex: number,
	parallelRunId: string,
) {
	const artifact = readWorkerRuntimeArtifact(dir, goalIndex);
	return artifact?.parallelRunId === parallelRunId ? artifact : undefined;
}

function flowGoalStatus(status: FlowWorkerArtifact["status"]): FlowGoalStatus {
	if (status === "complete") return "complete";
	if (status === "paused") return "paused";
	return "running";
}

function workerGoalPath(dir: string, goalIndex: number) {
	return join(dir, `G${goalIndex + 1}-worker.json`);
}
