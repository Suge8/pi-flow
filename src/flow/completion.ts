import { isRecord } from "../shared/guards.js";
import type { GoalCompletionFact } from "./types.js";

export const FLOW_GOAL_COMPLETED_ENTRY = "pi-flow-goal-completed";

type FlowCompletionContext = {
	cwd: string;
	sessionManager?: unknown;
	ui: {
		notify: (message: string, level?: "info" | "warning" | "error") => void;
	};
};

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

export function latestGoalCompletion(ctx: { sessionManager?: unknown }) {
	const entries = sessionEntries(ctx);
	const entry = entries
		.filter(
			(item) =>
				isRecord(item) &&
				item.type === "custom" &&
				item.customType === FLOW_GOAL_COMPLETED_ENTRY,
		)
		.pop();
	if (!isRecord(entry) || !isGoalCompletionFact(entry.data)) return undefined;
	return entry.data;
}

function sessionEntries(ctx: { sessionManager?: unknown }) {
	const sessionManager = ctx.sessionManager as
		| { getBranch?: () => unknown[]; getEntries?: () => unknown[] }
		| undefined;
	return sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
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
			isRecord(value.checks))
	);
}
