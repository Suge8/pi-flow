import { createPlanFileWatcher } from "../shared/plan-file-watcher.js";
import { writeGoalHtml } from "./html.js";
import { goalPlanPath, readGoalArtifact } from "./store.js";

const goalPlanWatcher = createPlanFileWatcher();

export function watchGoalPlan(dir: string) {
	goalPlanWatcher.watchFile(goalPlanPath(dir), () => {
		writeGoalHtml(dir, readGoalArtifact(dir));
	});
}

export function refreshGoalPlanHtml(dir: string | undefined) {
	if (!dir) return;
	goalPlanWatcher.refresh(() => {
		writeGoalHtml(dir, readGoalArtifact(dir));
	});
}

export function closeGoalPlanWatcher() {
	goalPlanWatcher.close();
}
