import type { FlowState } from "./types.js";

export interface ReadyBatch {
	mode: "serial" | "parallel";
	indices: number[];
}

export function computeReadyBatch(flow: FlowState): ReadyBatch | null {
	if (hasActiveBatch(flow)) return null;
	return readyBatch(flow, readyGoalIndices(flow));
}

export function scopesOverlap(a: string[], b: string[]) {
	return a.some((left) =>
		b.some((right) =>
			scopePrefixOverlaps(scopePrefix(left), scopePrefix(right)),
		),
	);
}

function hasActiveBatch(flow: FlowState) {
	return (
		flow.goals.some((goal) => goal.status === "running") ||
		(flow.parallelBatch?.length ?? 0) > 0
	);
}

function readyBatch(flow: FlowState, candidates: number[]): ReadyBatch | null {
	const first = candidates[0];
	if (first === undefined) return null;
	if (candidates.some((index) => !hasWriteScope(flow, index)))
		return serialBatch(first);
	const indices = nonOverlappingCandidates(flow, candidates);
	return { mode: indices.length > 1 ? "parallel" : "serial", indices };
}

function nonOverlappingCandidates(flow: FlowState, candidates: number[]) {
	const selected: number[] = [];
	for (const index of candidates) {
		const writeScope = flow.goals[index]?.writeScope ?? [];
		if (
			selected.every(
				(item) =>
					!scopesOverlap(writeScope, flow.goals[item]?.writeScope ?? []),
			)
		) {
			selected.push(index);
		}
	}
	return selected;
}

function serialBatch(index: number): ReadyBatch {
	return { mode: "serial", indices: [index] };
}

function readyGoalIndices(flow: FlowState) {
	const ready: number[] = [];
	for (const [index, goal] of flow.goals.entries()) {
		if (goal.status !== "pending") continue;
		if (goalDependencies(flow, index).every((item) => isComplete(flow, item)))
			ready.push(index);
	}
	return ready;
}

function goalDependencies(flow: FlowState, index: number) {
	const declared = flow.goals[index]?.dependsOn;
	if (declared !== undefined) return declared;
	return index === 0 ? [] : [index - 1];
}

function isComplete(flow: FlowState, index: number) {
	return flow.goals[index]?.status === "complete";
}

function hasWriteScope(flow: FlowState, index: number) {
	return (flow.goals[index]?.writeScope?.length ?? 0) > 0;
}

function scopePrefix(scope: string) {
	const normalized = scope.trim().replaceAll("\\", "/");
	const wildcard = normalized.indexOf("*");
	const prefix = wildcard === -1 ? normalized : normalized.slice(0, wildcard);
	return prefix.replace(/\/+$/u, "");
}

function scopePrefixOverlaps(left: string, right: string) {
	return containsScope(left, right) || containsScope(right, left);
}

function containsScope(parent: string, child: string) {
	return parent === "" || child === parent || child.startsWith(`${parent}/`);
}
