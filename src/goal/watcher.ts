import { createPlanFileWatcher } from "../shared/plan-file-watcher.js";

const goalPlanWatcher = createPlanFileWatcher();

export function watchGoalPlan(_dir: string) {
	// Flow owns live report rendering; worker plan changes are watched by flow/watcher.
}

export function closeGoalPlanWatcher() {
	goalPlanWatcher.close();
}
