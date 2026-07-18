export interface FlowGoalBlockedHandoff {
	goalId: string;
	message: string;
}

type GoalBlockedListener = (
	handoff: FlowGoalBlockedHandoff,
	ctx?: object,
) => void;

const goalBlockedListeners = new Set<GoalBlockedListener>();

export function onFlowGoalBlocked(listener: GoalBlockedListener) {
	goalBlockedListeners.add(listener);
	return () => goalBlockedListeners.delete(listener);
}

export function emitFlowGoalBlocked(
	handoff: FlowGoalBlockedHandoff,
	ctx?: object,
) {
	for (const listener of goalBlockedListeners) listener(handoff, ctx);
}
