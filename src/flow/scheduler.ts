import type { FlowState } from "./types.js";

const WRITE_SCOPE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;
const MAX_ENUMERATED_GOALS = 10;

export interface ReadyBatch {
	mode: "serial" | "parallel";
	indices: number[];
}

export function computeReadyBatch(flow: FlowState): ReadyBatch | null {
	if (hasActiveBatch(flow)) return null;
	return readyBatch(flow, readyGoalIndices(flow));
}

export function computeLaunchSet(
	flow: FlowState,
	active: ReadonlySet<number>,
	budget: number,
): number[] {
	if (
		!Number.isInteger(budget) ||
		budget <= active.size ||
		ordinaryGoalCount(flow) > MAX_ENUMERATED_GOALS
	)
		return [];
	const candidates = readyGoalIndices(flow).filter(
		(index) =>
			hasSafeWriteScope(flow, index) && activeScopesAllow(flow, active, index),
	);
	const finalAcceptance = candidates.find((index) =>
		isFinalAcceptance(flow, index),
	);
	if (finalAcceptance !== undefined)
		return active.size === 0 ? [finalAcceptance] : [];
	return bestLaunchSubset(flow, active, candidates, budget - active.size);
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

function ordinaryGoalCount(flow: FlowState) {
	return flow.goals.filter((goal) => goal.role === "normal").length;
}

function activeScopesAllow(
	flow: FlowState,
	active: ReadonlySet<number>,
	candidate: number,
) {
	const candidateScopes = flow.goals[candidate]?.writeScope;
	for (const activeIndex of active) {
		if (scopesOverlap(candidateScopes, flow.goals[activeIndex]?.writeScope))
			return false;
	}
	return true;
}

function bestLaunchSubset(
	flow: FlowState,
	active: ReadonlySet<number>,
	candidates: number[],
	capacity: number,
) {
	let best: number[] = [];
	let bestPath = remainingCriticalPath(flow, active, best);
	for (let mask = 1; mask < 2 ** candidates.length; mask += 1) {
		const launch = candidates.filter((_, offset) => mask & (2 ** offset));
		if (launch.length > capacity || !scopesArePairwiseDisjoint(flow, launch))
			continue;
		const path = remainingCriticalPath(flow, active, launch);
		if (!isBetterLaunch(launch, path, best, bestPath)) continue;
		best = launch;
		bestPath = path;
	}
	return best;
}

function scopesArePairwiseDisjoint(flow: FlowState, indices: number[]) {
	return indices.every((index, offset) =>
		indices
			.slice(offset + 1)
			.every(
				(other) =>
					!scopesOverlap(
						flow.goals[index]?.writeScope,
						flow.goals[other]?.writeScope,
					),
			),
	);
}

function isBetterLaunch(
	candidate: number[],
	candidatePath: number,
	current: number[],
	currentPath: number,
) {
	if (candidatePath !== currentPath) return candidatePath < currentPath;
	if (candidate.length !== current.length)
		return candidate.length > current.length;
	for (const [offset, index] of candidate.entries()) {
		if (index !== current[offset]) return index < (current[offset] ?? Infinity);
	}
	return false;
}

function remainingCriticalPath(
	flow: FlowState,
	active: ReadonlySet<number>,
	launch: number[],
) {
	const excluded = new Set(active);
	for (const index of launch) excluded.add(index);
	const depths: number[] = [];
	let longest = 0;
	for (const [index, goal] of flow.goals.entries()) {
		if (goal.status === "complete" || excluded.has(index)) {
			depths[index] = 0;
			continue;
		}
		const depth =
			1 +
			Math.max(
				0,
				...criticalPathDependencies(flow, index).map(
					(dependency) => depths[dependency] ?? 0,
				),
			);
		depths[index] = depth;
		longest = Math.max(longest, depth);
	}
	return longest;
}

function criticalPathDependencies(flow: FlowState, index: number) {
	if (!isFinalAcceptance(flow, index)) return goalDependencies(flow, index);
	return flow.goals.flatMap((goal, goalIndex) =>
		goal.role === "normal" ? [goalIndex] : [],
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

function hasSafeWriteScope(flow: FlowState, index: number) {
	const scopes = flow.goals[index]?.writeScope;
	if (!hasScopes(scopes)) return false;
	for (const scope of scopes) {
		if (scopePrefix(scope) === undefined) return false;
	}
	return true;
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
