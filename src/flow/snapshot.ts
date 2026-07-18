import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Language } from "../shared/config.js";
import { flowStepLabel } from "../shared/progress-labels.js";
import type { FlowGoal } from "./types.js";

/**
 * 恢复前置校验：只拦真正不可恢复的事实（缺启动快照 / 步骤文件被删）。
 * 计划内容变更不在此裁决——修订合法性由检查仲裁按启动快照 diff 判定。
 */
export function planSnapshotError(
	dir: string,
	goal: FlowGoal,
	language: Language = "zh",
) {
	const label = flowStepLabel(goal.index, goal.title, language);
	if (!goal.snapshot)
		return language === "en"
			? `Missing plan snapshot for ${label}, cannot recover`
			: `${label} 缺少计划快照，不能恢复`;
	if (!existsSync(join(dir, goal.file)))
		return language === "en"
			? `Missing step file: ${goal.file}`
			: `步骤文件不存在：${goal.file}`;
	return undefined;
}
