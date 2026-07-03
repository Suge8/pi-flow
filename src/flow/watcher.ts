import { join } from "node:path";
import { createPlanFileWatcher } from "../shared/plan-file-watcher.js";
import { writeFlowHtml } from "./html.js";
import { readFlow } from "./store.js";
import type { FlowState } from "./types.js";

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

export function closeFlowGoalWatcher() {
	flowGoalWatcher.close();
}
