import type { FlowState } from "./types.js";

const WRITE_SCOPE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;

export interface ReadyBatch {
	mode: "serial" | "parallel";
	indices: number[];
}

export function computeReadyBatch(flow: FlowState): ReadyBatch | null {
	if (hasActiveBatch(flow)) return null;
	return readyBatch(flow, readyGoalIndices(flow));
}

export function scopesOverlap(a: unknown, b: unknown) {
	if (!hasScopes(a) || !hasScopes(b)) return true;
	for (const left of a) {
		for (const right of b) {
			if (scopePrefixOverlaps(scopePrefix(left), scopePrefix(right)))
				return true;
		}
	}
	return false;
}

function hasActiveBatch(flow: FlowState) {
	return (
		flow.goals.some((goal) => goal.status === "running") ||
		(flow.parallelRun?.goalIndexes.length ?? 0) > 0
	);
}

function readyBatch(flow: FlowState, candidates: number[]): ReadyBatch | null {
	const first = candidates[0];
	if (first === undefined) return null;
	const finalAcceptance = candidates.find((index) =>
		isFinalAcceptance(flow, index),
	);
	if (finalAcceptance !== undefined) return serialBatch(finalAcceptance);
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
		if (goal.role === "final_acceptance") {
			if (ordinaryGoalsComplete(flow)) ready.push(index);
			continue;
		}
		if (goalDependencies(flow, index).every((item) => isComplete(flow, item)))
			ready.push(index);
	}
	return ready;
}

function ordinaryGoalsComplete(flow: FlowState) {
	return flow.goals.every(
		(goal, index) =>
			goal.role === "final_acceptance" || isComplete(flow, index),
	);
}

function isFinalAcceptance(flow: FlowState, index: number) {
	return flow.goals[index]?.role === "final_acceptance";
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
	return hasScopes(flow.goals[index]?.writeScope);
}

function hasScopes(value: unknown): value is unknown[] {
	return Array.isArray(value) && value.length > 0;
}

function scopePrefix(scope: unknown) {
	if (scope === "**") return "";
	if (typeof scope !== "string" || !scope.endsWith("/**")) return undefined;
	const prefix = scope.slice(0, -3);
	return prefix.split("/").every(isWriteScopeSegment) ? prefix : undefined;
}

function isWriteScopeSegment(segment: string) {
	return (
		segment !== "." &&
		segment !== ".." &&
		WRITE_SCOPE_SEGMENT_PATTERN.test(segment)
	);
}

function scopePrefixOverlaps(
	left: string | undefined,
	right: string | undefined,
) {
	return (
		left === undefined ||
		right === undefined ||
		containsScope(left, right) ||
		containsScope(right, left)
	);
}

function containsScope(parent: string, child: string) {
	return parent === "" || child === parent || child.startsWith(`${parent}/`);
}
