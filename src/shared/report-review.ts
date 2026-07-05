import type {
	CheckModelSnapshot,
	CheckModelStatus,
	CheckPhase,
	CheckResult,
	GoalChecks,
} from "../goal/types.js";
import { clipText } from "./clip.js";
import { type Language, reviewToggles } from "./config.js";
import { copy } from "./copy.js";
import { renderMarkdownBlock } from "./html-markdown.js";
import { roundLabel } from "./progress-labels.js";
import {
	escapeHtml,
	seal,
	sectionTitle,
	TONE_TEXT,
	type Tone,
} from "./report-blocks.js";
import { reportIcon } from "./report-icons.js";
import { formatReviewResultLines } from "./review-format.js";

export interface CheckProgress {
	enabled: number;
	passed: number;
}

export function checkProgress(
	checks: GoalChecks | null | undefined,
): CheckProgress {
	if (!checks) return { enabled: 0, passed: 0 };
	let enabled = 0;
	let passed = 0;
	for (const phase of [checks.acceptance, checks.quality]) {
		if (!phase.enabled) continue;
		enabled += 1;
		if (phase.rounds.at(-1)?.result === "passed") passed += 1;
	}
	return { enabled, passed };
}

/** 清掉实时进度（active），保留轮次结论：用于取消/中断时落盘。 */
export function settledChecks<T extends GoalChecks | null | undefined>(
	checks: T,
): T {
	if (!checks) return checks;
	return {
		...checks,
		acceptance: { ...checks.acceptance, active: null },
		quality: { ...checks.quality, active: null },
	};
}

export function pendingChecks(): GoalChecks {
	const toggles = reviewToggles();
	return {
		acceptance: { enabled: toggles.acceptance, rounds: [], active: null },
		quality: { enabled: toggles.quality, rounds: [], active: null },
	};
}

export function checkPhases(
	checks: GoalChecks,
	keyPrefix = "goal",
	language: Language = "zh",
) {
	const t = copy(language);
	return `${checkPhase(t.completionAcceptance, t.completionAcceptanceHint, checks.acceptance, `${keyPrefix}-acceptance`, language)}${checkPhase(t.qualityCheck, t.qualityCheckHint, checks.quality, `${keyPrefix}-quality`, language)}`;
}

export function checkPhase(
	name: string,
	hint: string,
	phase: CheckPhase,
	keyPrefix: string,
	language: Language = "zh",
) {
	const state = phaseState(phase, language);
	const chips = (phase.active ?? []).map(modelChip).join("");
	const history = phaseHistory(phase, keyPrefix, language);
	return `<div class="space-y-3">
<div class="flex items-start justify-between gap-2"><div>${sectionTitle(name)}<p class="mt-0.5 text-xs text-stone-400">${hint}</p></div>${seal(state.label, state.tone)}</div>
${chips ? `<div class="flex flex-wrap gap-1.5">${chips}</div>` : ""}
${history}
</div>`;
}

export function phaseState(
	phase: CheckPhase,
	language: Language = "zh",
): {
	label: string;
	tone: Tone;
} {
	const t = copy(language);
	if (!phase.enabled) return { label: t.disabled, tone: "gray" };
	if (phase.active?.some((item) => item.status === "running"))
		return { label: t.checking, tone: "amber" };
	const last = phase.rounds.at(-1);
	if (!last) return { label: t.waiting, tone: "gray" };
	if (last.result === "passed") return { label: t.passed, tone: "green" };
	if (last.result === "error") return { label: t.error, tone: "amber" };
	return { label: t.failed, tone: "red" };
}

const MODEL_TONE: Record<CheckModelStatus, Tone> = {
	running: "blue",
	passed: "green",
	failed: "red",
	error: "amber",
};
const MODEL_ICON: Record<CheckModelStatus, ReturnType<typeof modelIcon>> = {
	running: modelIcon("clock"),
	passed: modelIcon("check-circle"),
	failed: modelIcon("x-circle"),
	error: modelIcon("warning-circle"),
};
const ROUND_TONE: Record<CheckResult, Tone> = {
	passed: "green",
	failed: "red",
	error: "amber",
};
const ROUND_ICON: Record<CheckResult, string> = {
	passed: reportIcon("check-circle", "h-3 w-3"),
	failed: reportIcon("x-circle", "h-3 w-3"),
	error: reportIcon("warning-circle", "h-3 w-3"),
};

function phaseHistory(
	phase: CheckPhase,
	keyPrefix: string,
	language: Language,
) {
	if (!phase.enabled || phase.rounds.length === 0) return "";
	return `<ol class="space-y-2">${phase.rounds.map((round) => roundItem(round, phase.rounds.length, keyPrefix, language)).join("")}</ol>`;
}

function roundItem(
	round: CheckPhase["rounds"][number],
	total: number,
	keyPrefix: string,
	language: Language,
) {
	const tone = ROUND_TONE[round.result];
	const title = roundHistoryTitle(round, total, language);
	const summary = clipText(round.summary, 160);
	const details = roundDetails(round, keyPrefix, language);
	return `<li class="flex gap-2 text-xs leading-5 text-stone-600"><span data-rough-node data-tone="${tone}"${round.result === "passed" ? ' data-fill="solid"' : ""} class="mt-0.5 grid h-4 w-4 shrink-0 place-items-center ${TONE_TEXT[tone]}">${ROUND_ICON[round.result]}</span><div class="min-w-0"><span><span class="font-medium ${TONE_TEXT[tone]}">${escapeHtml(title)}</span>${summary ? ` · ${escapeHtml(summary)}` : ""}</span>${details}</div></li>`;
}

function roundHistoryTitle(
	round: CheckPhase["rounds"][number],
	total: number,
	language: Language,
) {
	const label = resultLabel(round.result, language);
	const roundText =
		language === "en"
			? `Round ${round.round} `
			: roundLabel(round.round, language);
	return total > 1 ? `${roundText}${label}` : label;
}

function roundDetails(
	round: CheckPhase["rounds"][number],
	keyPrefix: string,
	language: Language,
) {
	const details = round.details?.trim();
	if (!details) return "";
	const markdown = formatReviewResultLines(details).join("\n");
	const key = `${keyPrefix}-round-${round.round}`;
	return `<details data-key="${escapeHtml(key)}" class="mt-1"><summary class="text-xs font-medium text-stone-500">${copy(language).roundDetails}</summary>${renderMarkdownBlock(clipText(markdown, 2400), "mt-2 space-y-2 text-xs leading-5 text-stone-600")}</details>`;
}

function resultLabel(result: CheckResult, language: Language) {
	if (language === "en") {
		if (result === "passed") return "passed";
		if (result === "failed") return "failed";
		return "error";
	}
	if (result === "passed") return "通过";
	if (result === "failed") return "未通过";
	return "错误";
}

function modelChip(model: CheckModelSnapshot) {
	const tone = MODEL_TONE[model.status];
	return `<span data-rough-seal data-tone="${tone}" class="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[11px] ${TONE_TEXT[tone]}">${MODEL_ICON[model.status]} ${escapeHtml(model.label)}</span>`;
}

function modelIcon(name: Parameters<typeof reportIcon>[0]) {
	return reportIcon(name, "h-3 w-3");
}
