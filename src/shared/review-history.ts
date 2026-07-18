import type { CheckRoundAdvisor, GoalChecks } from "../goal/types.js";
import { clipText } from "./clip.js";
import type { Language } from "./config.js";
import { roundLabel } from "./progress-labels.js";

export type ReviewHistoryResult = "passed" | "failed" | "error";

export interface ReviewHistoryEntry {
	round: number;
	result: ReviewHistoryResult;
	summary: string;
	details?: string;
	models?: {
		label: string;
		status: ReviewHistoryResult;
		summary?: string;
		thinking?: string;
	}[];
	advisor?: CheckRoundAdvisor;
	elapsedMs?: number;
}

const PRIOR_ROUNDS_BUDGET = 12_000;
const PRIOR_ROUND_DETAIL_LIMIT = 2_000;

/**
 * 检查 prompt 的往轮发现清单（跨轮收敛输入）：第 2 轮起注入；
 * 长度预算封顶，超出时从最新轮往旧保留（最近轮次信息价值最高）。
 */
export function priorRoundsSection(
	history: readonly ReviewHistoryEntry[],
	round: number,
	language: Language,
): string | undefined {
	const prior = history.filter((entry) => entry.round < round);
	if (round <= 1 || prior.length === 0) return undefined;
	const lines: string[] = [];
	let used = 0;
	for (const entry of [...prior].sort((a, b) => b.round - a.round)) {
		const body = clipText(
			(entry.details ?? entry.summary).trim(),
			PRIOR_ROUND_DETAIL_LIMIT,
			"...",
		);
		const block = `${roundLabel(entry.round, language)} · ${priorResultLabel(entry.result, language)}\n${body}`;
		if (used + block.length > PRIOR_ROUNDS_BUDGET && lines.length > 0) break;
		lines.push(block);
		used += block.length;
	}
	const header =
		language === "en"
			? `Current round: ${round}. Findings from prior rounds (newest first):`
			: `当前为第 ${round} 轮。往轮发现清单（由新到旧）：`;
	return [header, ...lines].join("\n\n");
}

function priorResultLabel(result: ReviewHistoryResult, language: Language) {
	if (result === "passed") return language === "en" ? "passed" : "通过";
	if (result === "failed") return language === "en" ? "failed" : "未通过";
	return language === "en" ? "error" : "异常";
}

const SUGGESTIONS_HEADING =
	/^##\s+(?:建议（非阻塞）|Suggestions \(non-blocking\))\s*$/iu;

/** 提取检查输出里「## 建议（非阻塞）」段的列表项（完成报告聚合用）。 */
export function nonBlockingSuggestions(details: string | undefined): string[] {
	if (!details) return [];
	const lines = details.split(/\r?\n/);
	const items: string[] = [];
	let inSection = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (SUGGESTIONS_HEADING.test(trimmed)) {
			inSection = true;
			continue;
		}
		if (inSection && /^#{1,6}\s/.test(trimmed)) {
			inSection = false;
			continue;
		}
		if (!inSection) continue;
		const item = /^[-*+]\s+(.+)$/u.exec(trimmed);
		if (item) items.push(item[1].trim());
	}
	return items;
}

/** 聚合全部检查轮次的非阻塞建议（去重，保留首次出现顺序）。 */
export function collectSuggestions(checks: GoalChecks | null | undefined) {
	if (!checks) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const round of [...checks.acceptance.rounds, ...checks.quality.rounds])
		for (const item of nonBlockingSuggestions(round.details)) {
			if (seen.has(item)) continue;
			seen.add(item);
			result.push(item);
		}
	return result;
}

type CompletionRound = Pick<
	ReviewHistoryEntry,
	"round" | "result" | "summary" | "details"
>;

export function completionChecksLines(
	checks: GoalChecks,
	language: Language,
): string[] {
	const acceptance = completionPhaseLines(
		language === "en" ? "Acceptance" : "验收",
		checks.acceptance.enabled ? checks.acceptance.rounds : undefined,
		language,
	);
	const quality = completionPhaseLines(
		language === "en" ? "Quality check" : "质检",
		checks.quality.enabled ? checks.quality.rounds : undefined,
		language,
	);
	return [...acceptance, "", ...quality];
}

export function completionPhaseLines(
	label: string,
	history: readonly CompletionRound[] | undefined,
	language: Language,
) {
	const separator = language === "en" ? ":" : "：";
	if (!history)
		return [language === "en" ? `${label}: disabled` : `${label}：未启用`];
	if (history.length === 1) {
		const [round] = history;
		return [formatCompletionRound(`${label}${separator}`, round, language)];
	}
	return [
		`${label}${separator}`,
		...history.map((round) =>
			formatCompletionRound(roundLabel(round.round, language), round, language),
		),
	];
}

export function formatCompletionRound(
	prefix: string,
	round: CompletionRound,
	language: Language,
) {
	const summary = completionSummary(round, language);
	const gap = prefix.endsWith("：") ? "" : " ";
	return `${prefix}${gap}${resultIcon(round.result)}${summary ? ` ${summary}` : ""}`;
}

export function completionSummary(round: CompletionRound, language: Language) {
	const summary =
		visibleCompletionSummary(round.summary) || detailsSummary(round.details);
	if (summary) return clipText(summary, 180);
	if (round.result === "passed") return "";
	return language === "en" ? "see this round's details" : "见本轮详情";
}

export function visibleCompletionSummary(summary: string) {
	const text = summary.trim();
	return STATUS_ONLY_SUMMARIES.has(text.replace(/[。.]$/u, "")) ? "" : text;
}

export const STATUS_ONLY_SUMMARIES = new Set([
	"验收通过",
	"验收判定未通过",
	"验收失败",
	"质检通过",
	"质检未通过",
	"质检失败",
	"Acceptance passed",
	"Acceptance judged the goal incomplete",
	"Acceptance failed",
	"Quality check passed",
	"Quality check failed",
]);

export function detailsSummary(details: string | undefined) {
	if (!details) return "";
	const lines = details
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const issueIndex = lines.findIndex((line) => /^- (问题|Issue):/u.test(line));
	if (issueIndex === -1) return "";
	const issue = lines[issueIndex].replace(/^- (问题|Issue):\s*/u, "");
	return cleanCompletionDetail(
		issue || nextIssueDetail(lines.slice(issueIndex + 1)),
	);
}

function nextIssueDetail(lines: string[]) {
	return lines.find(issueDetailCandidate) ?? "";
}

function issueDetailCandidate(line: string) {
	if (line.startsWith("#") || /^(模型|Model)\s+\d+\s+·\s+/iu.test(line))
		return false;
	if (/^- (问题|Issue):\s*$/u.test(line)) return false;
	return !STATUS_ONLY_SUMMARIES.has(line.replace(/[。.]$/u, ""));
}

function cleanCompletionDetail(line: string) {
	return line
		.replace(/^[-*+]\s+/u, "")
		.replace(/`([^`]+)`/gu, "$1")
		.trim();
}

function resultIcon(result: ReviewHistoryResult) {
	if (result === "passed") return "✅";
	if (result === "failed") return "❌";
	return "🛑";
}
