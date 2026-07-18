import { isRecord } from "../shared/guards.js";

export const GOAL_STATE_ENTRY_TYPE = "goal-state";

export function hasActiveGoalSessionEntry(ctx: { sessionManager?: unknown }) {
	const sessionManager = ctx.sessionManager as
		| { getBranch?: () => unknown[]; getEntries?: () => unknown[] }
		| undefined;
	const entries =
		sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (
			!isRecord(entry) ||
			entry.type !== "custom" ||
			entry.customType !== GOAL_STATE_ENTRY_TYPE
		)
			continue;
		const goal = isRecord(entry.data) ? entry.data.goal : undefined;
		return isRecord(goal) && goal.status !== "complete";
	}
	return false;
}
