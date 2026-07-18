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

const CHECKED_LINE_PATTERN = /^\s*[-*+]\s*\[x\]\s*(.*)$/iu;
const HEADING_PATTERN = /^#{1,6}\s+(.+)$/u;

export interface PlanCheckboxState {
	section: string;
	text: string;
	status: string;
	start: number;
	end: number;
	key?: string;
}

/** checkbox 的文本范围、状态与展示 key；文本范围只用于同一次精确 edit 的前后配对。 */
export function planCheckboxStates(planText: string): PlanCheckboxState[] {
	const states: PlanCheckboxState[] = [];
	const occurrences = new Map<string, number>();
	let section = "";
	let offset = 0;
	for (const raw of planText.split(/\r?\n/)) {
		const start = offset;
		const end = start + raw.length;
		offset = end + lineBreakLength(planText, end);
		const heading = HEADING_PATTERN.exec(raw.trim());
		if (heading) {
			section = heading[1].trim();
			continue;
		}
		const task = TASK_LIST_LINE.exec(raw);
		if (!task) continue;
		const key = checkedLineKey(raw, section, occurrences);
		states.push({
			section: section.toLowerCase(),
			text: task[3].trim(),
			status: task[2].toLowerCase(),
			start,
			end,
			...(key ? { key } : {}),
		});
	}
	return states;
}

function lineBreakLength(text: string, offset: number) {
	if (text.startsWith("\r\n", offset)) return 2;
	return offset < text.length ? 1 : 0;
}

/**
 * 指定区块内每个 checkbox（含未勾）的归因，下标与 parseSteps 结果对齐；
 * 未勾或无归因记录的条目为 undefined。
 */
export function sectionCheckboxAttributions<T>(
	markdown: string,
	section: string,
	attribution: Record<string, T> | undefined,
): (T | undefined)[] {
	const result: (T | undefined)[] = [];
	const occurrences = new Map<string, number>();
	let current = "";
	for (const raw of markdown.split(/\r?\n/)) {
		const heading = HEADING_PATTERN.exec(raw.trim());
		if (heading) {
			current = heading[1].trim();
			continue;
		}
		const key = checkedLineKey(raw, current, occurrences);
		if (current.toLowerCase() !== section.toLowerCase()) continue;
		if (TASK_LIST_LINE.test(raw))
			result.push(key && attribution ? attribution[key] : undefined);
	}
	return result;
}

/** 已勾行的 key；非已勾行返回 undefined（occurrence 只数已勾行，与 diff 口径一致）。 */
function checkedLineKey(
	raw: string,
	section: string,
	occurrences: Map<string, number>,
) {
	const checked = CHECKED_LINE_PATTERN.exec(raw);
	if (!checked) return undefined;
	const base = `${section}\u0000${checked[1].trim()}`;
	const occurrence = (occurrences.get(base) ?? 0) + 1;
	occurrences.set(base, occurrence);
	return `${base}\u0000${occurrence}`;
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
