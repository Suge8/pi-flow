import {
	hasCheckedOrUncheckedItem,
	hasSection,
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
	if (!hasCheckedOrUncheckedItem(stepsText(markdown)))
		errors.push("Steps 至少需要 1 项 checkbox");
	if (!hasCheckedOrUncheckedItem(verificationText(markdown)))
		errors.push("Verification 至少需要 1 项 checkbox");
	return errors;
}
