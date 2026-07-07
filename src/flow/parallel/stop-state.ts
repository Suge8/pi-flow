import { join } from "node:path";
import { settledChecks } from "../../shared/report-review.js";
import { completeGoalWithFact } from "../goal-completion.js";
import type { FlowGoal, FlowState } from "../types.js";
import { replaceGoal } from "../util.js";
import { readCompletionFact } from "./result-watcher.js";

export function stopParallelRunFlow(dir: string, flow: FlowState): FlowState {
	const run = flow.parallelRun;
	let stopped = flow;
	if (run) {
		for (const goalIndex of run.goalIndexes) {
			const goal = stopped.goals[goalIndex];
			if (!goal || goal.status === "complete") continue;
			const fact = readCompletionFact(workerResultPath(dir, goalIndex), run.id);
			stopped = fact
				? completeGoalWithFact(dir, stopped, goalIndex, fact)
				: resetParallelGoal(stopped, goalIndex);
		}
	}
	const goals = stopped.goals.map((goal) => ({
		...goal,
		checks: settledChecks(goal.checks),
	}));
	const complete = goals.every((goal) => goal.status === "complete");
	return {
		...stopped,
		status: complete ? "complete" : "paused",
		parallelRun: null,
		errors: [],
		currentGoal: complete
			? goals.length - 1
			: firstIncompleteGoalIndex(goals, stopped.currentGoal),
		goals,
	};
}

function resetParallelGoal(flow: FlowState, goalIndex: number): FlowState {
	const goal = flow.goals[goalIndex];
	if (!goal) return flow;
	return {
		...flow,
		goals: replaceGoal(flow, goalIndex, {
			...goal,
			status: "pending",
			completionCursor: null,
			sessionFile: null,
			sessionName: null,
			snapshot: null,
			snapshotHash: null,
			goalId: null,
			result: {
				summary: null,
				handoff: null,
				handoffGenerated: false,
				criteriaChanged: false,
			},
		}),
	};
}

function firstIncompleteGoalIndex(goals: FlowGoal[], fallback: number) {
	return goals.find((goal) => goal.status !== "complete")?.index ?? fallback;
}

function workerResultPath(dir: string, goalIndex: number) {
	return join(workerDir(dir, goalIndex), "result.json");
}

function workerDir(dir: string, goalIndex: number) {
	return join(dir, "workers", `G${goalIndex}`);
}
