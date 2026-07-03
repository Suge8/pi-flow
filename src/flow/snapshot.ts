import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { planSnapshotHash } from "../plan/snapshot.js";
import type { Language } from "../shared/config.js";
import { flowStepLabel } from "../shared/progress-labels.js";
import type { FlowGoal } from "./types.js";

export { planSnapshotHash };

export function planSnapshotError(
	dir: string,
	goal: FlowGoal,
	language: Language = "zh",
) {
	const label = flowStepLabel(goal.index, goal.title, language);
	if (!goal.snapshot || !goal.snapshotHash)
		return language === "en"
			? `${label} is missing a plan snapshot (snapshot/snapshotHash), so it cannot resume.`
			: `${label} 缺少计划快照（snapshot/snapshotHash），不能恢复。`;
	const path = join(dir, goal.file);
	if (!existsSync(path))
		return language === "en"
			? `Step file does not exist: ${goal.file}`
			: `步骤文件不存在：${goal.file}`;
	const current = readFileSync(path, "utf8");
	if (planSnapshotHash(current) === goal.snapshotHash) return undefined;
	return language === "en"
		? `${label} plan changed after start: ${goal.file} Objective/Scope/Success Criteria no longer match the start snapshot.`
		: `${label} 启动后计划被修改：${goal.file} 的 Objective/Scope/Success Criteria 与启动时快照不一致。`;
}
