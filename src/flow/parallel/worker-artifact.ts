import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { StepRuntimeState } from "../../goal/persistence.js";
import type {
	CompletionCursor,
	GoalArtifactStatus,
	GoalHandoff,
} from "../../goal/types.js";
import { isRecord } from "../../shared/guards.js";
import type { FlowGoal, FlowState, GoalCompletionFact } from "../types.js";
import { flowSessionName } from "../util.js";

const WORKER_ARTIFACT_SCHEMA_VERSION = 3;
const MAX_EVENTS = 20;

export type WorkerArtifactStatus = GoalArtifactStatus | "failed";

export interface FlowWorkerArtifact {
	schemaVersion: typeof WORKER_ARTIFACT_SCHEMA_VERSION;
	flowId: string;
	goalIndex: number;
	goalTitle: string;
	goalFile: string;
	parallelRunId: string;
	status: WorkerArtifactStatus;
	completionCursor: StepRuntimeState["completionCursor"];
	runtimeGoalId: string | null;
	sessionFile: string | null;
	sessionName: string | null;
	result: StepRuntimeState["result"];
	checks: StepRuntimeState["checks"];
	checkAttribution?: StepRuntimeState["checkAttribution"];
	handoff: GoalHandoff | null;
	completion: GoalCompletionFact | null;
	updatedAt: number;
}

export interface WorkerArtifactInit {
	parallelRunId: string;
	sessionFile: string | null;
	sessionName: string | null;
	status?: WorkerArtifactStatus;
}

export function workerArtifactPath(dir: string, goalIndex: number) {
	return join(dir, `G${goalIndex + 1}-worker.json`);
}

export function readWorkerArtifact(dir: string, goalIndex: number) {
	return readWorkerArtifactFile(workerArtifactPath(dir, goalIndex));
}

export function readWorkerArtifactFile(path: string) {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isWorkerArtifact(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function initWorkerArtifact(
	dir: string,
	flow: FlowState,
	goalIndex: number,
	input: WorkerArtifactInit,
) {
	const previous = readWorkerArtifact(dir, goalIndex);
	if (previous?.parallelRunId === input.parallelRunId) {
		if (previous.completion) return previous;
		return writeWorkerArtifact(dir, goalIndex, {
			...previous,
			status: input.status ?? "running",
			handoff: null,
			sessionFile: input.sessionFile ?? previous.sessionFile,
			sessionName: input.sessionName ?? previous.sessionName,
		});
	}
	const goal = requiredGoal(flow, goalIndex);
	return writeWorkerArtifact(dir, goalIndex, {
		...baseWorkerArtifact(flow, goal, input),
		completion: null,
	});
}

export function updateWorkerArtifactStatus(
	dir: string,
	goalIndex: number,
	status: WorkerArtifactStatus,
) {
	const previous = readWorkerArtifact(dir, goalIndex);
	if (!previous) return undefined;
	return writeWorkerArtifact(dir, goalIndex, { ...previous, status });
}

/**
 * 事件日志单独落盘：`G<N>-worker.json` 的唯一写 owner 是 worker 进程，
 * 父进程只写 events 文件，杬绝跨进程 read-modify-write 竞态。
 */
export function workerEventsPath(dir: string, goalIndex: number) {
	return join(dir, `G${goalIndex + 1}-worker-events.json`);
}

export function appendWorkerEvent(
	dir: string,
	goalIndex: number,
	event: unknown,
) {
	const path = workerEventsPath(dir, goalIndex);
	const events = [...readWorkerEvents(dir, goalIndex), event].slice(
		-MAX_EVENTS,
	);
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(events)}\n`);
	renameSync(tmp, path);
}

export function readWorkerEvents(dir: string, goalIndex: number): unknown[] {
	const path = workerEventsPath(dir, goalIndex);
	if (!existsSync(path)) return [];
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function writeWorkerCompletion(
	dir: string,
	goalIndex: number,
	fact: GoalCompletionFact,
	parallelRunId: string,
) {
	const previous = readWorkerArtifact(dir, goalIndex);
	if (!previous) return undefined;
	const completion = { ...fact, parallelRunId };
	return writeWorkerArtifact(dir, goalIndex, {
		...previous,
		status: "complete",
		runtimeGoalId: fact.goalId,
		result: { summary: fact.summary, outcome: fact.acceptance },
		checks: fact.checks ?? previous.checks,
		checkAttribution: fact.checkAttribution ?? previous.checkAttribution,
		handoff: null,
		completion,
	});
}

export function readWorkerCompletion(
	dir: string,
	goalIndex: number,
	parallelRunId?: string,
) {
	const completion = readWorkerArtifact(dir, goalIndex)?.completion;
	if (!completion) return undefined;
	if (parallelRunId !== undefined && completion.parallelRunId !== parallelRunId)
		return undefined;
	return completion;
}

export function readWorkerHandoff(
	dir: string,
	goalIndex: number,
	parallelRunId: string,
) {
	const artifact = readWorkerArtifact(dir, goalIndex);
	if (
		artifact?.parallelRunId !== parallelRunId ||
		artifact.status !== "paused" ||
		artifact.completion !== null
	)
		return undefined;
	return artifact.handoff ?? undefined;
}

export function firstWorkerHandoff(dir: string, flow: FlowState) {
	const run = flow.parallelRun;
	if (!run) return undefined;
	for (const goalIndex of [...run.goalIndexes].sort(
		(left, right) => left - right,
	)) {
		const handoff = readWorkerHandoff(dir, goalIndex, run.id);
		if (handoff) return { goalIndex, handoff };
	}
	return undefined;
}

function writeWorkerArtifact(
	dir: string,
	goalIndex: number,
	artifact: FlowWorkerArtifact,
) {
	const path = workerArtifactPath(dir, goalIndex);
	mkdirSync(dirname(path), { recursive: true });
	const existingCompletion = readExistingCompletion(
		path,
		artifact.parallelRunId,
	);
	const next = {
		...artifact,
		completion: artifact.completion ?? existingCompletion,
		updatedAt: Date.now(),
	};
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
	renameSync(tmp, path);
	return next;
}

function baseWorkerArtifact(
	flow: FlowState,
	goal: FlowGoal,
	input: WorkerArtifactInit,
): FlowWorkerArtifact {
	return {
		schemaVersion: WORKER_ARTIFACT_SCHEMA_VERSION,
		flowId: flow.id,
		goalIndex: goal.index,
		goalTitle: goal.title,
		goalFile: goal.file,
		parallelRunId: input.parallelRunId,
		status: input.status ?? "running",
		completionCursor: null,
		runtimeGoalId: null,
		sessionFile: input.sessionFile,
		sessionName: input.sessionName ?? flowSessionName(flow, goal),
		result: { summary: null, outcome: null },
		checks: goal.checks,
		checkAttribution: goal.checkAttribution ?? {},
		handoff: null,
		completion: null,
		updatedAt: Date.now(),
	};
}

/** 断线恢复时只有检查/收口阶段跳过执行 prompt，直接按 cursor 续跑。 */
export function resumableWorkerCursor(
	artifact: FlowWorkerArtifact | undefined,
	parallelRunId: string,
): CompletionCursor {
	if (
		!artifact ||
		artifact.parallelRunId !== parallelRunId ||
		artifact.completion !== null
	)
		return null;
	const cursor = artifact.completionCursor;
	return cursor === "acceptance_retry" ||
		cursor === "quality_retry" ||
		cursor === "finalize_retry"
		? cursor
		: null;
}

function readExistingCompletion(path: string, parallelRunId: string) {
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isRecord(parsed) || !isRecord(parsed.completion)) return null;
		return parsed.completion.parallelRunId === parallelRunId
			? (parsed.completion as unknown as GoalCompletionFact)
			: null;
	} catch {
		return null;
	}
}

function requiredGoal(flow: FlowState, goalIndex: number) {
	const goal = flow.goals[goalIndex];
	if (!goal) throw new Error(`Worker goal not found: G${goalIndex + 1}`);
	return goal;
}

function isWorkerArtifact(value: unknown): value is FlowWorkerArtifact {
	if (!isRecord(value)) return false;
	return (
		value.schemaVersion === WORKER_ARTIFACT_SCHEMA_VERSION &&
		typeof value.flowId === "string" &&
		typeof value.goalIndex === "number" &&
		typeof value.goalTitle === "string" &&
		typeof value.goalFile === "string" &&
		typeof value.parallelRunId === "string" &&
		typeof value.status === "string" &&
		(typeof value.sessionFile === "string" || value.sessionFile === null) &&
		(typeof value.sessionName === "string" || value.sessionName === null) &&
		isWorkerHandoff(value.handoff) &&
		(value.completion === null || isRecord(value.completion)) &&
		(value.handoff === null ||
			(value.status === "paused" && value.completion === null))
	);
}

function isWorkerHandoff(value: unknown) {
	if (value === null) return true;
	return (
		isRecord(value) &&
		value.kind === "user_action_required" &&
		typeof value.message === "string" &&
		value.message.length > 0 &&
		Number.isFinite(value.at)
	);
}
