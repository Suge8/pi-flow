import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { planSection, TASK_LIST_LINE } from "../plan/markdown.js";
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
	return (
		snapshotChangeDetail(label, goal.file, goal.snapshot, current, language) ??
		(language === "en"
			? `${label} plan changed after start: ${goal.file} Objective/Scope/Success Criteria no longer match the start snapshot.`
			: `${label} 启动后计划被修改：${goal.file} 的 Objective/Scope/Success Criteria 与启动时快照不一致。`)
	);
}

const IMMUTABLE_SECTIONS = ["Objective", "Scope", "Success Criteria"] as const;

function snapshotChangeDetail(
	label: string,
	file: string,
	beforeMarkdown: string,
	afterMarkdown: string,
	language: Language,
) {
	for (const section of IMMUTABLE_SECTIONS) {
		const beforeLines = planSection(beforeMarkdown, section).split(/\r?\n/u);
		const afterLines = planSection(afterMarkdown, section).split(/\r?\n/u);
		const lineCount = Math.min(beforeLines.length, afterLines.length);
		for (let index = 0; index < lineCount; index += 1) {
			const before = TASK_LIST_LINE.exec(beforeLines[index]);
			const after = TASK_LIST_LINE.exec(afterLines[index]);
			if (!before || !after) continue;
			if (`${before[1]}${before[3]}` !== `${after[1]}${after[3]}`) continue;
			if (before[2] === after[2]) continue;
			return checkboxChangeMessage(
				label,
				file,
				section,
				index + 1,
				before[2],
				after[2],
				language,
			);
		}
	}
	return undefined;
}

function checkboxChangeMessage(
	label: string,
	file: string,
	section: string,
	line: number,
	before: string,
	after: string,
	language: Language,
) {
	const from = checkboxMark(before);
	const to = checkboxMark(after);
	return language === "en"
		? `${label} plan changed after start: ${file} ${section} line ${line} changed from ${from} to ${to}. This section is the acceptance contract, not a progress area. Restore it; write completion evidence in Verification/Handoff.`
		: `${label} 启动后计划被修改：${file} 的 ${section} 第 ${line} 行从 ${from} 改成 ${to}。该区是验收合同，不是进度区。请恢复；完成证据写入 Verification/Handoff。`;
}

function checkboxMark(mark: string) {
	return `[${mark === "X" ? "x" : mark}]`;
}
