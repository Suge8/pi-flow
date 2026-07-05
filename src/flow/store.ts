import { createArtifactStore } from "../shared/artifact-store.js";
import type { FlowLocation, FlowState } from "./types.js";

const FLOW_ID_PATTERN = /^F[1-9]\d*-[a-z0-9-]+$/u;
const FLOW_SHORT_ID_PATTERN = /^F[1-9]\d*$/u;

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
	const resolvedId = resolveFlowId(cwd, id);
	return resolvedId ? flowStore.find(cwd, resolvedId) : undefined;
}

export function latestFlow(
	cwd: string,
	include: (flow: FlowState) => boolean = () => true,
) {
	return flowStore.latest(cwd, include);
}

export function runningFlow(cwd: string) {
	return listFlows(cwd).find((item) => item.flow.status === "running");
}

function resolveFlowId(cwd: string, id: string) {
	if (!FLOW_SHORT_ID_PATTERN.test(id)) return id;
	const matches = listFlowIds(cwd).filter((item) => item.startsWith(`${id}-`));
	if (matches.length === 1) return matches[0];
	if (matches.length === 0) return undefined;
	throw new Error(`Flow 短 id 不唯一：${id}（${matches.join(", ")}）`);
}

export function flowOwningSession(
	cwd: string,
	sessionFile: string | undefined,
) {
	if (!sessionFile) return undefined;
	return listFlows(cwd).find(
		({ flow }) =>
			flow.status === "running" &&
			flow.goals.some((goal) => goal.sessionFile === sessionFile),
	);
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
