import { completeGoalWithFact } from "../goal-completion.js";
import type { FlowGoal, FlowState } from "../types.js";
import { replaceGoal } from "../util.js";
import { readWorkerCompletion } from "./worker-artifact.js";

export function stopParallelRunFlow(dir: string, flow: FlowState): FlowState {
	const run = flow.parallelRun;
	let stopped = flow;
	if (run) {
		for (const goalIndex of run.goalIndexes) {
			const goal = stopped.goals[goalIndex];
			if (!goal || goal.status === "complete") continue;
			const fact = readWorkerCompletion(dir, goalIndex, run.id);
			stopped = fact
				? completeGoalWithFact(dir, stopped, goalIndex, fact)
				: pauseParallelGoal(stopped, goalIndex);
		}
	}
	const goals = stopped.goals;
	const complete = goals.every((goal) => goal.status === "complete");
	return {
		...stopped,
		status: complete ? "complete" : "paused",
		completedAt: complete ? Date.now() : null,
		parallelRun: complete ? null : run,
		errors: [],
		currentGoal: complete
			? goals.length - 1
			: firstIncompleteGoalIndex(goals, stopped.currentGoal),
		goals,
	};
}

function pauseParallelGoal(flow: FlowState, goalIndex: number): FlowState {
	const goal = flow.goals[goalIndex];
	if (!goal) return flow;
	return {
		...flow,
		goals: replaceGoal(flow, goalIndex, {
			...goal,
			status: "paused",
			completionCursor: null,
		}),
	};
}

function firstIncompleteGoalIndex(goals: FlowGoal[], fallback: number) {
	return goals.find((goal) => goal.status !== "complete")?.index ?? fallback;
}
