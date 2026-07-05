import {
	hasCheckedOrUncheckedItem,
	hasSection,
	hasTaskListItem,
	planSection,
	stepsText,
	verificationText,
} from "./markdown.js";

export { hasSection } from "./markdown.js";

export const FLOW_GOAL_SECTIONS = [
	"Objective",
	"Scope",
	"Steps",
	"Success Criteria",
	"Verification",
	"Notes",
	"Handoff",
] as const;

export const STANDALONE_GOAL_SECTIONS = [
	"Objective",
	"Scope",
	"Steps",
	"Success Criteria",
	"Verification",
	"Notes",
	"Outcome",
] as const;

const CONTRACT_SECTIONS = ["Objective", "Scope", "Success Criteria"] as const;

export function validatePlanMarkdown(
	markdown: string,
	sections: readonly string[],
) {
	const errors: string[] = [];
	for (const section of sections) {
		if (!hasSection(markdown, section)) errors.push(`缺少章节：${section}`);
	}
	if (!planSection(markdown, "Objective").trim())
		errors.push("Objective 不能为空");
	for (const section of CONTRACT_SECTIONS) {
		if (hasTaskListItem(planSection(markdown, section)))
			errors.push(
				`${section} 禁止使用 checkbox；该区是验收合同，完成证据请写入 Verification/Outcome/Handoff`,
			);
	}
	if (!hasCheckedOrUncheckedItem(stepsText(markdown)))
		errors.push("Steps 至少需要 1 项 checkbox");
	if (!hasCheckedOrUncheckedItem(verificationText(markdown)))
		errors.push("Verification 至少需要 1 项 checkbox");
	return errors;
}
