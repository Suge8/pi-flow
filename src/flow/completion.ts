import { isRecord } from "../shared/guards.js";
import type { GoalCompletionFact } from "./types.js";

export const FLOW_GOAL_COMPLETED_ENTRY = "pi-flow-goal-completed";
const FLOW_GOAL_COMPLETION_BOUNDARY_ENTRY = "pi-flow-goal-completion-boundary";

type FlowCompletionContext = {
	cwd: string;
	sessionManager?: unknown;
	ui: {
		notify: (message: string, level?: "info" | "warning" | "error") => void;
	};
};

interface CompletionBoundary {
	createdAt: number;
	expectedGoalId: string | null;
	reason: "stop" | "resume";
}

type Listener = (fact: GoalCompletionFact, ctx?: FlowCompletionContext) => void;
const listeners = new Set<Listener>();

export function onFlowGoalCompleted(listener: Listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function emitFlowGoalCompleted(
	fact: GoalCompletionFact,
	ctx?: FlowCompletionContext,
) {
	for (const listener of listeners) listener(fact, ctx);
}

export function recordFlowGoalCompletionBoundary(
	ctx: { sessionManager?: unknown },
	input: { reason: CompletionBoundary["reason"]; expectedGoalId?: string },
) {
	appendCustomEntry(ctx, FLOW_GOAL_COMPLETION_BOUNDARY_ENTRY, {
		createdAt: Date.now(),
		expectedGoalId: input.expectedGoalId ?? null,
		reason: input.reason,
	});
}

export function latestGoalCompletion(ctx: { sessionManager?: unknown }) {
	const { boundary, boundaryIndex, entries } = latestCompletionBoundary(ctx);
	for (let index = entries.length - 1; index > boundaryIndex; index -= 1) {
		const entry = entries[index];
		if (!isCompletionEntry(entry)) continue;
		const fact = entry.data;
		if (boundaryAllowsFact(boundary, fact)) return fact;
	}
	return undefined;
}

export function completionFactAllowedByBoundary(
	ctx: { sessionManager?: unknown },
	fact: GoalCompletionFact,
) {
	const { boundary } = latestCompletionBoundary(ctx);
	return boundaryAllowsFact(boundary, fact);
}

function latestCompletionBoundary(ctx: { sessionManager?: unknown }) {
	const entries = sessionEntries(ctx);
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const boundary = completionBoundary(entries[index]);
		if (boundary) return { boundary, boundaryIndex: index, entries };
	}
	return { boundary: undefined, boundaryIndex: -1, entries };
}

function boundaryAllowsFact(
	boundary: CompletionBoundary | undefined,
	fact: GoalCompletionFact,
) {
	return !boundary || boundary.expectedGoalId === fact.goalId;
}

function appendCustomEntry(
	ctx: { sessionManager?: unknown },
	customType: string,
	data: unknown,
) {
	const sessionManager = ctx.sessionManager as
		| { appendCustomEntry?: (customType: string, data?: unknown) => unknown }
		| undefined;
	sessionManager?.appendCustomEntry?.(customType, data);
}

function sessionEntries(ctx: { sessionManager?: unknown }) {
	const sessionManager = ctx.sessionManager as
		| { getBranch?: () => unknown[]; getEntries?: () => unknown[] }
		| undefined;
	return sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
}

function isCompletionEntry(
	entry: unknown,
): entry is { data: GoalCompletionFact } {
	return (
		isRecord(entry) &&
		entry.type === "custom" &&
		entry.customType === FLOW_GOAL_COMPLETED_ENTRY &&
		isGoalCompletionFact(entry.data)
	);
}

function completionBoundary(entry: unknown): CompletionBoundary | undefined {
	if (
		!isRecord(entry) ||
		entry.type !== "custom" ||
		entry.customType !== FLOW_GOAL_COMPLETION_BOUNDARY_ENTRY ||
		!isRecord(entry.data)
	)
		return undefined;
	const expectedGoalId = entry.data.expectedGoalId;
	const reason = entry.data.reason;
	return {
		createdAt: Number.isFinite(entry.data.createdAt)
			? Number(entry.data.createdAt)
			: 0,
		expectedGoalId: typeof expectedGoalId === "string" ? expectedGoalId : null,
		reason: reason === "resume" ? "resume" : "stop",
	};
}

function isGoalCompletionFact(value: unknown): value is GoalCompletionFact {
	if (!isRecord(value)) return false;
	return (
		typeof value.goalId === "string" &&
		typeof value.summary === "string" &&
		typeof value.acceptance === "string" &&
		(typeof value.sessionFile === "string" || value.sessionFile === null) &&
		(value.checks === undefined ||
			value.checks === null ||
			isRecord(value.checks)) &&
		(value.parallelRunId === undefined ||
			typeof value.parallelRunId === "string")
	);
}
