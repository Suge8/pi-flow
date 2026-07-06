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
import { escapeHtml, seal, TONE_TEXT, type Tone } from "./report-blocks.js";
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
	return [
		checkPhase({
			name: t.completionAcceptance,
			hint: t.completionAcceptanceHint,
			phase: checks.acceptance,
			keyPrefix: `${keyPrefix}-acceptance`,
			language,
			icon: "target",
			accent: "blue",
		}),
		checkPhase({
			name: t.qualityCheck,
			hint: t.qualityCheckHint,
			phase: checks.quality,
			keyPrefix: `${keyPrefix}-quality`,
			language,
			icon: "shield-check",
			accent: "green",
		}),
	].join("");
}

function checkPhase({
	name,
	hint,
	phase,
	keyPrefix,
	language,
	icon,
	accent,
}: {
	name: string;
	hint: string;
	phase: CheckPhase;
	keyPrefix: string;
	language: Language;
	icon: Parameters<typeof reportIcon>[0];
	accent: Tone;
}) {
	const state = phaseState(phase, language);
	const chips = (phase.active ?? []).map(modelChip).join("");
	const history = phaseHistory(phase, keyPrefix, language);
	const tone = state.tone === "gray" ? undefined : state.tone;
	return `<section data-rough-card${tone ? ` data-tone="${tone}"` : ""} class="${checkCardClass(state.tone)}">
<div class="flex items-start justify-between gap-3">${checkTitle(name, hint, icon, phase.enabled && state.tone === "gray" ? accent : state.tone)}${seal(state.label, state.tone)}</div>
${chips ? `<div class="mt-3 flex flex-wrap gap-1.5">${chips}</div>` : ""}
${history ? `<div class="mt-3">${history}</div>` : ""}
</section>`;
}

function checkTitle(
	name: string,
	hint: string,
	icon: Parameters<typeof reportIcon>[0],
	tone: Tone,
) {
	return `<div class="inline-flex min-w-0 items-center gap-2">
<span class="${TONE_TEXT[tone]}">${reportIcon(icon, "h-5 w-5")}</span>
<p class="text-base font-semibold leading-6 text-stone-900">${escapeHtml(name)}</p>
<span tabindex="0" aria-label="${escapeHtml(hint)}" data-tooltip="${escapeHtml(hint)}" class="tooltip inline-grid h-4 w-4 shrink-0 cursor-help place-items-center rounded-full bg-stone-100 text-[10px] font-semibold text-stone-500 shadow-[inset_0_0_0_1px_rgba(41,37,36,0.08)] transition-[color,background-color,box-shadow] duration-150 hover:bg-white hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200">?</span>
</div>`;
}

function checkCardClass(tone: Tone) {
	if (tone === "green") return "bg-emerald-50/60 p-4";
	if (tone === "blue") return "bg-sky-50/60 p-4";
	if (tone === "amber") return "bg-amber-50/60 p-4";
	if (tone === "red") return "bg-rose-50/60 p-4";
	return "bg-white/80 p-4";
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
		return { label: t.checking, tone: "blue" };
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
	passed: reportIcon("check", "h-3 w-3"),
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
	return `<li class="flex gap-2 text-xs leading-5 text-stone-600"><span data-rough-node data-tone="${tone}" class="mt-0.5 grid h-4 w-4 shrink-0 place-items-center ${TONE_TEXT[tone]}">${ROUND_ICON[round.result]}</span><div class="min-w-0"><span><span class="font-medium ${TONE_TEXT[tone]}">${escapeHtml(title)}</span>${summary ? ` · ${escapeHtml(summary)}` : ""}</span>${details}</div></li>`;
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
	return `<details data-key="${escapeHtml(key)}" class="mt-1">${roundDetailsSummary(round.result, language)}${renderMarkdownBlock(clipText(markdown, 2400), "mt-2 space-y-2 text-xs leading-5 text-stone-600")}</details>`;
}

function roundDetailsSummary(result: CheckResult, language: Language) {
	return `<summary class="inline-flex items-center gap-1 rounded-full bg-white/75 px-2.5 py-1 text-[11px] font-medium text-stone-500 shadow-[0_0_0_1px_rgba(41,37,36,0.08),0_6px_14px_rgba(41,37,36,0.05)] transition-[color,background-color,box-shadow,transform] duration-150 hover:bg-stone-50 hover:text-stone-900 hover:shadow-[0_0_0_1px_rgba(41,37,36,0.12),0_8px_18px_rgba(41,37,36,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 active:scale-[0.96]">${reportIcon("dots-three", "h-3.5 w-3.5")}<span>${escapeHtml(roundDetailsLabel(result, language))}</span></summary>`;
}

function roundDetailsLabel(result: CheckResult, language: Language) {
	if (language === "en") {
		if (result === "failed") return "View findings";
		if (result === "error") return "View error";
		return "View output";
	}
	if (result === "failed") return "查看未通过原因";
	if (result === "error") return "查看错误信息";
	return "查看输出";
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
