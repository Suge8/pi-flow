import {
	handoffHasCriteriaDeviation,
	readOrGenerateHandoff,
} from "./execution/handoff.js";
import type { FlowState, GoalCompletionFact } from "./types.js";
import { replaceGoal } from "./util.js";

export function completeGoalWithFact(
	dir: string,
	flow: FlowState,
	goalIndex: number,
	fact: GoalCompletionFact,
) {
	const goal = flow.goals[goalIndex];
	const handoff = readOrGenerateHandoff(dir, goal, fact);
	const goals = replaceGoal(flow, goalIndex, {
		...goal,
		status: "complete",
		completionCursor: null,
		goalId: fact.goalId,
		result: {
			summary: fact.summary,
			handoff: handoff.text,
			handoffGenerated: handoff.generated,
			criteriaChanged: handoffHasCriteriaDeviation(handoff.text),
		},
		checks: fact.checks ?? goal.checks,
	});
	return { ...flow, goals };
}
