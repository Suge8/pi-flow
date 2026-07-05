import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { StepRuntimeState } from "../goal/persistence.js";
import { createPlanFileWatcher } from "../shared/plan-file-watcher.js";
import { writeFlowHtml } from "./html.js";
import { readFlow } from "./store.js";
import type { FlowGoal, FlowGoalStatus, FlowState } from "./types.js";

const flowGoalWatcher = createPlanFileWatcher();

export function watchCurrentFlowGoal(dir: string, flow: FlowState) {
	const goal = flow.goals[flow.currentGoal];
	if (!goal) return closeFlowGoalWatcher();
	const file = join(dir, goal.file);
	flowGoalWatcher.watchFile(
		file,
		() => {
			writeFlowHtml(dir, readFlow(dir));
		},
		{ skipIfSame: true },
	);
}

export function watchParallelBatch(
	dir: string,
	flow: FlowState,
	batchIndices: number[],
) {
	closeFlowGoalWatcher();
	const refresh = () => {
		writeFlowHtml(dir, parallelReportFlow(dir, flow, batchIndices));
	};
	for (const file of parallelWatchFiles(dir, flow, batchIndices)) {
		flowGoalWatcher.watchFile(file, refresh, {
			keepExisting: true,
			skipIfSame: true,
		});
	}
	flowGoalWatcher.refresh(refresh);
}

export function closeFlowGoalWatcher() {
	flowGoalWatcher.close();
}

function parallelWatchFiles(
	dir: string,
	flow: FlowState,
	batchIndices: number[],
) {
	const files = new Set<string>();
	for (const goalIndex of batchIndices) {
		const goal = flow.goals[goalIndex];
		if (goal) files.add(join(dir, goal.file));
		files.add(workerPlanPath(dir, goalIndex));
		files.add(workerGoalPath(dir, goalIndex));
	}
	return files;
}

function parallelReportFlow(
	dir: string,
	flow: FlowState,
	batchIndices: number[],
): FlowState {
	const batch = new Set(batchIndices);
	return {
		...flow,
		status: "running",
		currentGoal: Math.min(...batchIndices),
		parallelBatch: batchIndices,
		goals: flow.goals.map((goal, index) =>
			batch.has(index) ? parallelGoal(dir, goal, index) : goal,
		),
	};
}

function parallelGoal(
	dir: string,
	goal: FlowGoal,
	goalIndex: number,
): FlowGoal {
	const artifact = readWorkerArtifact(dir, goalIndex);
	return {
		...goal,
		file: existsSync(workerPlanPath(dir, goalIndex))
			? workerPlanFile(goalIndex)
			: goal.file,
		status: artifact
			? flowGoalStatus(artifact.status)
			: goal.status === "complete"
				? "complete"
				: "running",
		checks: artifact?.checks ?? goal.checks,
		sessionFile: artifact?.sessionFile ?? goal.sessionFile,
		sessionName: artifact?.sessionName ?? goal.sessionName,
		goalId: artifact?.runtimeGoalId ?? goal.goalId,
	};
}

function readWorkerArtifact(dir: string, goalIndex: number) {
	try {
		return JSON.parse(
			readFileSync(workerGoalPath(dir, goalIndex), "utf8"),
		) as StepRuntimeState;
	} catch {
		return undefined;
	}
}

function flowGoalStatus(status: StepRuntimeState["status"]): FlowGoalStatus {
	return status === "complete" ? "complete" : "running";
}

function workerPlanPath(dir: string, goalIndex: number) {
	return join(dir, workerPlanFile(goalIndex));
}

function workerGoalPath(dir: string, goalIndex: number) {
	return join(workerDir(dir, goalIndex), "state.json");
}

function workerPlanFile(goalIndex: number) {
	return join("workers", `G${goalIndex}`, "plan.md");
}

function workerDir(dir: string, goalIndex: number) {
	return join(dir, "workers", `G${goalIndex}`);
}
