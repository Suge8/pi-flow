export interface ReviewerSection {
	title: string;
	body: string;
}

export function splitReviewerSections(review: string) {
	const lines = review.split(/\r?\n/);
	const sections: ReviewerSection[] = [];
	const preface: string[] = [];
	let current: { title: string; body: string[] } | undefined;
	for (const line of lines) {
		if (isModelTitle(line.trim())) {
			if (current)
				sections.push({ title: current.title, body: current.body.join("\n") });
			current = { title: line.trim(), body: [] };
			continue;
		}
		if (current) current.body.push(line);
		else preface.push(line);
	}
	if (current)
		sections.push({ title: current.title, body: current.body.join("\n") });
	return { preface: preface.join("\n"), sections };
}

export function formatReviewResultLines(review: string) {
	const { preface, sections } = splitReviewerSections(review);
	if (sections.length === 0) return normalizedReviewLines(review);
	return [
		...normalizedReviewLines(preface),
		...(preface.trim() ? [""] : []),
		...sections.flatMap((section, index) => [
			...(index > 0 ? ["", "---", ""] : []),
			section.title,
			"",
			...normalizedReviewLines(section.body),
		]),
	];
}

export function normalizedReviewLines(review: string) {
	const lines = review
		.split(/\r?\n/)
		.map((line) => cleanReviewLine(line.trim()))
		.filter((line) => line !== undefined) as string[];
	return collapseBlankLines(lines).flatMap((line, index, collapsed) =>
		index > 0 && isFindingTitle(line) && collapsed[index - 1] !== ""
			? ["", line]
			: [line],
	);
}

export function summarizeReviewText(raw: string, fallback: string) {
	const lines = raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const issue = lines.find((line) => /^- (问题|Issue):/u.test(line));
	if (issue)
		return singleLineSummary(issue.replace(/^- (问题|Issue):\s*/u, ""));
	return singleLineSummary(
		lines.find(
			(line) =>
				!line.startsWith("#") &&
				!line.startsWith("-") &&
				!isModelTitle(line) &&
				!REDUNDANT_LINES.has(line),
		) ?? fallback,
	);
}

export function cleanSummary(summary: string) {
	return summary.replace(/`([^`]+)`/gu, "$1").trim();
}

export function singleLineSummary(summary: string) {
	return cleanSummary(summary)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !isModelTitle(line) && !REDUNDANT_LINES.has(line))
		.join(" · ");
}

const REDUNDANT_LINES = new Set([
	"PASS",
	"FAIL",
	"通过",
	"未通过",
	"需要修改",
	"已完成",
	"未完成",
	"## 审查未通过",
	"审查未通过",
	"## 检查未通过",
	"检查未通过",
	"## 完成验收未通过",
	"完成验收未通过",
	"## 质量检查未通过",
	"质量检查未通过",
	"## 完成验收通过",
	"完成验收通过",
	"## 质量检查通过",
	"质量检查通过",
	"passed",
	"failed",
	"needs changes",
	"complete",
	"incomplete",
	"## Review failed",
	"Review failed",
	"## Check failed",
	"Check failed",
	"## Completion acceptance failed",
	"Completion acceptance failed",
	"## Quality check failed",
	"Quality check failed",
	"## Completion acceptance passed",
	"Completion acceptance passed",
	"## Quality check passed",
	"Quality check passed",
]);

function cleanReviewLine(line: string) {
	if (REDUNDANT_LINES.has(line)) return undefined;
	const cleaned = line.replace(/^#{1,6}\s+/u, "").replace(/^[-*]\s+/u, "• ");
	return REDUNDANT_LINES.has(cleaned) ? undefined : cleaned;
}

function collapseBlankLines(lines: string[]) {
	const collapsed: string[] = [];
	for (const line of lines) {
		if (!line && collapsed.at(-1) === "") continue;
		collapsed.push(line);
	}
	while (collapsed[0] === "") collapsed.shift();
	while (collapsed.at(-1) === "") collapsed.pop();
	return collapsed;
}

function isFindingTitle(line: string) {
	return /^(发现|Finding)\s+\d+/iu.test(line);
}

function isModelTitle(line: string) {
	return /^(模型|Model)\s+\d+\s+·\s+/iu.test(line);
}
