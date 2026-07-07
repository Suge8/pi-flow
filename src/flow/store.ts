import { mkdirSync } from "node:fs";
import { createArtifactStore } from "../shared/artifact-store.js";
import type { Language } from "../shared/config.js";
import type { FlowLocation, FlowSource, FlowState } from "./types.js";

const FLOW_ID_PATTERN = /^F[1-9]\d*$/u;

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

export function activeFlows(cwd: string) {
	return listFlows(cwd).filter((item) => isActiveFlowStatus(item.flow.status));
}

function isActiveFlowStatus(status: FlowState["status"]) {
	return (
		status === "aligning" || status === "generating" || status === "running"
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
			schemaVersion: 8,
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
	return listFlows(cwd).find(
		({ flow }) => flowCurrentSessionFile(flow) === sessionFile,
	);
}

export function flowCurrentSessionFile(flow: FlowState) {
	if (flow.status !== "running" || !Array.isArray(flow.goals)) return undefined;
	const current = currentGoal(flow);
	if (current?.status === "running") return current.sessionFile ?? undefined;
	const running = flow.goals.filter((goal) => goal.status === "running");
	return running.length === 1
		? (running[0].sessionFile ?? undefined)
		: undefined;
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
