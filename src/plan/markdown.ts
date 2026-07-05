import { escapeRegExp } from "../shared/guards.js";

const FLOW_GOAL_SECTIONS = [
	"Objective",
	"Scope",
	"Steps",
	"Success Criteria",
	"Verification",
	"Notes",
	"Handoff",
] as const;

export function missingPlanSections(markdown: string) {
	return FLOW_GOAL_SECTIONS.filter((section) => !hasSection(markdown, section));
}

export function planSection(markdown: string, title: string) {
	return sectionBody(markdown, title)?.trim() ?? "";
}

export function objectiveText(markdown: string) {
	return planSection(markdown, "Objective");
}

export function stepsText(markdown: string) {
	return planSection(markdown, "Steps");
}

export function verificationText(markdown: string) {
	return planSection(markdown, "Verification");
}

export function handoffText(markdown: string) {
	return planSection(markdown, "Handoff");
}

export function outcomeText(markdown: string) {
	return planSection(markdown, "Outcome");
}

export function replaceHandoff(markdown: string, handoff: string) {
	return replaceSection(markdown, "Handoff", handoff);
}

export function replaceOutcome(markdown: string, outcome: string) {
	return replaceSection(markdown, "Outcome", outcome);
}

const CRITERIA_DEVIATION_PATTERNS = [
	/\bcriteria\s*deviation\b/iu,
	/\bacceptance\s+deviation\b/iu,
	/\bacceptance\s+criteria\s+(?:changed|adjusted|updated|modified)\b/iu,
	/验收(?:标准|口径)?.{0,8}(?:偏差|调整|变更|变化|改变)/u,
	/criteria.{0,12}(?:有|存在|发生|出现).{0,8}偏差/iu,
] as const;

const NEGATED_CRITERIA_DEVIATION_PATTERNS = [
	/\b(?:no|without)\s+(?:criteria\s*deviation|acceptance\s+deviation)\b/iu,
	/\b(?:not|never)\s+(?:found|detected|seen|observed|identified)\s+(?:any\s+)?(?:criteria\s*deviation|acceptance\s+deviation)\b/iu,
	/\b(?:criteria\s*deviation|acceptance\s+deviation)\s+(?:(?:is|are|was|were|has been)\s+)?(?:not|never)\s+(?:found|detected|seen|observed|identified)\b/iu,
	/(?:未|无|没有|没|并未|未曾|不存在).{0,12}(?:criteria\s*deviation|acceptance\s+deviation|验收(?:标准|口径)?.{0,8}(?:偏差|调整|变更|变化|改变))/iu,
	/验收(?:标准|口径)?.{0,8}(?:未|无|没有|没|无需|不用|不需要).{0,8}(?:偏差|调整|变更|变化|改变)/u,
] as const;

export function hasCriteriaDeviation(text: string | null | undefined) {
	return (text ?? "")
		.split(/[。\n\r；;!?？，,]+/u)
		.flatMap((part) => part.split(/\b(?:but|however)\b|但(?:是)?|不过|然而/iu))
		.some(
			(part) =>
				matchesAny(part, CRITERIA_DEVIATION_PATTERNS) &&
				!matchesAny(part, NEGATED_CRITERIA_DEVIATION_PATTERNS),
		);
}

function matchesAny(text: string, patterns: readonly RegExp[]) {
	return patterns.some((pattern) => pattern.test(text));
}

export const TASK_LIST_ITEM = /^\s*[-*+]\s*\[[ xX~!]\]/mu;
export const TASK_LIST_LINE = /^(\s*[-*+]\s*)\[([ xX~!])\](.*)$/u;

export function hasTaskListItem(text: string) {
	return TASK_LIST_ITEM.test(text);
}

export function hasCheckedOrUncheckedItem(text: string) {
	return /^\s*-\s*\[[ xX~!]\]/mu.test(text);
}

function replaceSection(markdown: string, title: string, body: string) {
	const lines = markdown.split(/\r?\n/);
	const start = sectionStart(lines, title);
	if (start === -1)
		return `${markdown.trimEnd()}\n\n## ${title}\n${body.trim()}\n`;
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^##\s+\S/.test(lines[index])) {
			end = index;
			break;
		}
	}
	return [...lines.slice(0, start + 1), body.trim(), ...lines.slice(end)]
		.join("\n")
		.replace(/\s+$/u, "\n");
}

export function hasSection(markdown: string, title: string) {
	return sectionStart(markdown.split(/\r?\n/), title) !== -1;
}

function sectionBody(markdown: string, title: string) {
	const lines = markdown.split(/\r?\n/);
	const start = sectionStart(lines, title);
	if (start === -1) return undefined;
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^##\s+\S/.test(lines[index])) {
			end = index;
			break;
		}
	}
	return lines.slice(start + 1, end).join("\n");
}

function sectionStart(lines: string[], title: string) {
	const pattern = new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`, "iu");
	return lines.findIndex((line) => pattern.test(line.trim()));
}
