import { mkdirSync } from "node:fs";
import { createArtifactStore } from "../shared/artifact-store.js";
import type { Language } from "../shared/config.js";
import { tryReadAlignmentState } from "../shared/generation-state.js";
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
	return flowStore.read(dir);
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
	return flowStore.list(cwd);
}

export function findFlow(cwd: string, id: string) {
	return flowStore.find(cwd, id);
}

export function latestFlow(
	cwd: string,
	include: (flow: FlowState) => boolean = () => true,
) {
	return flowStore.latest(cwd, include);
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
	},
): FlowLocation {
	const existingIds = listFlowIds(cwd);
	mkdirSync(flowRoot(cwd), { recursive: true });
	let nextNumber = maxFlowNumber(existingIds) + 1;
	for (;;) {
		const id = `F${nextNumber}`;
		const dir = flowDir(cwd, id);
		try {
			mkdirSync(dir);
		} catch (error) {
			if (isAlreadyExists(error)) {
				nextNumber += 1;
				continue;
			}
			throw error;
		}
		const now = Date.now();
		const flow = writeFlow(dir, {
			schemaVersion: FLOW_SCHEMA_VERSION,
			language: input.language,
			id,
			title: `Flow ${id}`,
			status: input.status,
			source: input.source,
			createdAt: now,
			updatedAt: now,
			startedAt: null,
			currentGoal: 0,
			parallelRun: null,
			repairAttempts: 0,
			errors: [],
			goals: [],
		});
		return { id, dir, jsonPath: flowJsonPath(dir), flow };
	}
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
		return tryReadAlignmentState(location.dir)?.sessionFile === sessionFile;
	return flowOwnsSession(location.flow, sessionFile);
}

export function flowOwnsSession(flow: FlowState, sessionFile: string) {
	return runningGoals(flow).some((goal) => goal.sessionFile === sessionFile);
}

export function flowCurrentSessionFile(flow: FlowState) {
	if (!flowCanOwnSession(flow) || !Array.isArray(flow.goals)) return undefined;
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
