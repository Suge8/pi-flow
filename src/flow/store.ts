import { mkdirSync, rmSync } from "node:fs";
import { createArtifactStore } from "../shared/artifact-store.js";
import type { AlignmentDepth, Language } from "../shared/config.js";
import {
	createAlignmentState,
	readAlignmentStateIfExists,
} from "../shared/generation-state.js";
import { withFlowLockSync } from "./lock.js";
import type { FlowLocation, FlowSource, FlowState } from "./types.js";
import { FLOW_SCHEMA_VERSION } from "./types.js";

const FLOW_ID_PATTERN = /^F[1-9]\d*$/u;

export function isFlowId(id: string) {
	return FLOW_ID_PATTERN.test(id);
}

const flowStore = createArtifactStore<FlowState, "flow">({
	rootDir: ".flow",
	jsonName: "flow.json",
	idPattern: FLOW_ID_PATTERN,
	idLabel: "flow id",
	artifactKey: "flow",
	artifactDirectoryMessage: "flow 目录不是普通目录",
});

export function flowRoot(cwd: string) {
	return flowStore.root(cwd);
}

export function flowDir(cwd: string, id: string) {
	return flowStore.dir(cwd, id);
}

export function flowJsonPath(dir: string) {
	return flowStore.jsonPath(dir);
}

export function readFlow(dir: string): FlowState {
	return requireCurrentFlow(flowStore.read(dir));
}

export function tryReadFlow(dir: string): FlowState | undefined {
	try {
		return readFlow(dir);
	} catch {
		return undefined;
	}
}

export function writeFlow(dir: string, flow: FlowState) {
	return flowStore.write(dir, flow);
}

export function listFlowIds(cwd: string) {
	return flowStore.listIds(cwd);
}

export function listFlows(cwd: string): FlowLocation[] {
	return listFlowIds(cwd).flatMap((id) => {
		try {
			const location = flowStore.find(cwd, id);
			return location ? [requireCurrentFlowLocation(location)] : [];
		} catch {
			return [];
		}
	});
}

export function findFlow(cwd: string, id: string) {
	const location = flowStore.find(cwd, id);
	return location ? requireCurrentFlowLocation(location) : undefined;
}

export function latestFlow(
	cwd: string,
	include: (flow: FlowState) => boolean = () => true,
) {
	return listFlows(cwd)
		.filter((item) => include(item.flow))
		.sort(
			(a, b) => flowNumber(a.id) - flowNumber(b.id) || a.id.localeCompare(b.id),
		)
		.at(-1);
}

export function runningFlows(cwd: string) {
	return listFlows(cwd).filter((item) => item.flow.status === "running");
}

export function advanceableFlows(cwd: string) {
	return listFlows(cwd).filter((item) => isAdvanceableFlow(item.flow));
}

function isAdvanceableFlow(flow: FlowState) {
	if (flow.status === "aligning" || flow.status === "generating")
		return (
			Array.isArray(flow.goals) &&
			flow.goals.length === 0 &&
			flow.currentGoal === 0 &&
			flow.startedAt === null &&
			flow.parallelRun === null
		);
	return (
		flow.status === "draft" ||
		flow.status === "paused" ||
		flow.status === "running"
	);
}

export function createPreDraftFlow(
	cwd: string,
	input: {
		language: Language;
		status: "aligning" | "generating";
		source: FlowSource;
		sessionFile: string | null;
		autoStart: boolean;
		depth: AlignmentDepth;
	},
) {
	const reserved = reservePreDraftFlow(cwd);
	const initialized = withFlowLockSync(
		reserved.dir,
		`initialize ${reserved.id}`,
		() => {
			try {
				const alignment = createAlignmentState(reserved.dir, {
					stage: input.status,
					sessionFile: input.sessionFile,
					autoStart: input.autoStart,
					depth: input.depth,
				});
				const now = Date.now();
				const flow = writeFlow(reserved.dir, {
					schemaVersion: FLOW_SCHEMA_VERSION,
					language: input.language,
					id: reserved.id,
					title: `Flow ${reserved.id}`,
					status: input.status,
					source: input.source,
					createdAt: now,
					updatedAt: now,
					startedAt: null,
					completedAt: null,
					currentGoal: 0,
					meta: null,
					attention: null,
					parallelRun: null,
					repairAttempts: 0,
					errors: [],
					goals: [],
				});
				return {
					...reserved,
					jsonPath: flowJsonPath(reserved.dir),
					flow,
					alignment,
				};
			} catch (error) {
				rmSync(reserved.dir, { recursive: true, force: true });
				throw error;
			}
		},
	);
	if (!initialized.ok) throw new Error(`Flow ${reserved.id} 初始化锁被占用`);
	return initialized.value;
}

function reservePreDraftFlow(cwd: string) {
	const existingIds = listFlowIds(cwd);
	mkdirSync(flowRoot(cwd), { recursive: true });
	let nextNumber = maxFlowNumber(existingIds) + 1;
	for (;;) {
		const id = `F${nextNumber}`;
		const dir = flowDir(cwd, id);
		try {
			mkdirSync(dir);
			return { id, dir };
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
			nextNumber += 1;
		}
	}
}

function requireCurrentFlow(flow: FlowState) {
	const schemaVersion = (flow as { schemaVersion?: unknown }).schemaVersion;
	if (schemaVersion !== FLOW_SCHEMA_VERSION)
		throw new Error(`schemaVersion 必须为 ${FLOW_SCHEMA_VERSION}`);
	return flow;
}

function requireCurrentFlowLocation(location: FlowLocation) {
	return { ...location, flow: requireCurrentFlow(location.flow) };
}

function maxFlowNumber(ids: string[]) {
	return ids.reduce((max, id) => Math.max(max, flowNumber(id)), 0);
}

function flowNumber(id: string) {
	return Number(/^F([1-9]\d*)$/u.exec(id)?.[1] ?? 0);
}

function isAlreadyExists(error: unknown) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "EEXIST"
	);
}

export function flowOwningSession(
	cwd: string,
	sessionFile: string | undefined,
) {
	if (!sessionFile) return undefined;
	return listFlows(cwd).find((location) =>
		flowLocationOwnsSession(location, sessionFile),
	);
}

export function flowLocationOwnsSession(
	location: FlowLocation,
	sessionFile: string,
) {
	if (isPreDraftSessionFlow(location.flow))
		return alignmentOwnsSession(location.dir, sessionFile);
	return flowOwnsSession(location.flow, sessionFile);
}

function alignmentOwnsSession(dir: string, sessionFile: string) {
	try {
		return readAlignmentStateIfExists(dir)?.sessionFile === sessionFile;
	} catch {
		return false;
	}
}

export function flowOwnsSession(flow: FlowState, sessionFile: string) {
	return (
		flow.parallelRun?.consoleSessionFile === sessionFile ||
		runningGoals(flow).some((goal) => goal.sessionFile === sessionFile)
	);
}

export function flowCurrentSessionFile(flow: FlowState) {
	if (!flowCanOwnSession(flow) || !Array.isArray(flow.goals)) return undefined;
	if (flow.parallelRun?.consoleSessionFile)
		return flow.parallelRun.consoleSessionFile;
	const current = currentGoal(flow);
	if (current?.status === "running") return current.sessionFile ?? undefined;
	const running = runningGoals(flow);
	return running.length === 1
		? (running[0].sessionFile ?? undefined)
		: undefined;
}

function runningGoals(flow: FlowState) {
	if (!flowCanOwnSession(flow) || !Array.isArray(flow.goals)) return [];
	return flow.goals.filter((goal) => goal?.status === "running");
}

function isPreDraftSessionFlow(flow: FlowState) {
	return (
		Array.isArray(flow.goals) &&
		flow.goals.length === 0 &&
		(flow.status === "aligning" ||
			flow.status === "generating" ||
			flow.status === "paused")
	);
}

function flowCanOwnSession(flow: FlowState) {
	return flow.status === "running" || flow.status === "paused";
}

export function currentGoal(flow: FlowState) {
	return flow.goals[flow.currentGoal];
}

export function touchFlowErrors(
	dir: string,
	flow: FlowState,
	errors: string[],
) {
	return flowStore.touchErrors(dir, flow, errors);
}
