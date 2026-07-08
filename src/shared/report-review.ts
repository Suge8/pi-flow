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
	SOFT_CHIP_BASE,
	SOFT_CHIP_TONE,
	statusText,
	TONE_TEXT,
	type Tone,
} from "./report-blocks.js";
import { type ReportIconName, reportIcon } from "./report-icons.js";
import { formatReviewResultLines } from "./review-format.js";

/** 检查视图上下文：keyPrefix 跨卡片唯一；live 表示步骤正在执行（允许推导「修复中」）。 */
export interface CheckViewContext {
	keyPrefix: string;
	language: Language;
	live?: boolean;
	/** 已完成步骤的检查状态由步骤右上角承载，避免重复显示两个「已通过」。 */
	hidePassedStatus?: boolean;
	/** 待执行步骤已由父级显示，不重复显示「等待」。 */
	hideWaitingStatus?: boolean;
	/** full：round 详情直接展开（用于步骤模态框内，避免模态嵌套）。默认 modal。 */
	detail?: "modal" | "full";
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

interface PhaseMeta {
	key: "acceptance" | "quality";
	name: string;
	hint: string;
	icon: ReportIconName;
	accent: Tone;
}

function phaseMetas(language: Language): PhaseMeta[] {
	const t = copy(language);
	return [
		{
			key: "acceptance",
			name: t.completionAcceptance,
			hint: t.completionAcceptanceHint,
			icon: "target",
			accent: "blue",
		},
		{
			key: "quality",
			name: t.qualityCheck,
			hint: t.qualityCheckHint,
			icon: "shield-check",
			accent: "green",
		},
	];
}

export function checkPhases(checks: GoalChecks, ctx: CheckViewContext) {
	return phaseMetas(ctx.language)
		.map((meta) => checkPhaseCard(checks[meta.key], meta, ctx))
		.join("");
}

function checkPhaseCard(
	phase: CheckPhase,
	meta: PhaseMeta,
	ctx: CheckViewContext,
) {
	const state = phaseState(phase, meta.key, ctx.language, ctx.live);
	const history = phaseHistory(phase, meta, ctx);
	const active = activeRoundItem(phase, meta, ctx);
	const rows = [history, active].filter(Boolean).join("");
	if (!phase.enabled && !rows) return "";
	const tone = state.tone === "gray" ? undefined : state.tone;
	const status = phaseStatusHtml(phase, state, ctx);
	return `<section data-rough-card${tone ? ` data-tone="${tone}"` : ""} class="${checkCardClass(state.tone)}">
<div class="flex items-start justify-between gap-3">${checkTitle(meta, phase.enabled && state.tone === "gray" ? meta.accent : state.tone)}${status}</div>
${rows ? `<ol class="mt-3 space-y-2">${rows}</ol>` : ""}
</section>`;
}

function checkTitle(meta: PhaseMeta, tone: Tone) {
	return `<div class="inline-flex min-w-0 items-center gap-2">
<span class="${TONE_TEXT[tone]}">${reportIcon(meta.icon, "h-5 w-5")}</span>
<p class="text-base font-semibold leading-6 text-stone-900">${escapeHtml(meta.name)}</p>
<span tabindex="0" aria-label="${escapeHtml(meta.hint)}" data-tooltip="${escapeHtml(meta.hint)}" class="tooltip inline-grid h-3 w-3 shrink-0 cursor-pointer place-items-center rounded-full bg-stone-100 text-[8px] font-semibold text-stone-500 shadow-[inset_0_0_0_1px_rgba(41,37,36,0.08)] transition-[color,background-color,box-shadow] duration-150 hover:bg-white hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200">?</span>
</div>`;
}

function phaseStatusHtml(
	phase: CheckPhase,
	state: PhaseView,
	ctx: CheckViewContext,
) {
	if (!phase.enabled) return "";
	if (ctx.hidePassedStatus && state.tone === "green") return "";
	if (ctx.hideWaitingStatus && state.tone === "gray") return "";
	return statusText(state.label, state.tone);
}

function checkCardClass(tone: Tone) {
	if (tone === "green") return "bg-emerald-50/60 p-4";
	if (tone === "blue") return "bg-sky-50/60 p-4";
	if (tone === "amber") return "bg-amber-50/60 p-4";
	if (tone === "red") return "bg-rose-50/60 p-4";
	return "bg-white/80 p-4";
}

export interface PhaseView {
	label: string;
	tone: Tone;
	pulse?: boolean;
	repairing?: boolean;
}

export function phaseState(
	phase: CheckPhase,
	key: PhaseMeta["key"],
	language: Language = "zh",
	live = false,
): PhaseView {
	const t = copy(language);
	if (!phase.enabled) return { label: t.disabled, tone: "gray" };
	if (phase.active?.some((item) => item.status === "running"))
		return {
			label: phaseActiveLabel(key, language),
			tone: "blue",
			pulse: true,
		};
	const last = phase.rounds.at(-1);
	if (!last) return { label: t.waiting, tone: "gray" };
	if (last.result === "passed") return { label: t.passed, tone: "green" };
	if (last.result === "error") return { label: t.error, tone: "amber" };
	if (live)
		return {
			label: phaseRepairLabel(key, language),
			tone: "blue",
			pulse: true,
			repairing: true,
		};
	return { label: t.failed, tone: "red" };
}

function phaseActiveLabel(key: PhaseMeta["key"], language: Language) {
	if (language === "en") return key === "acceptance" ? "Accepting" : "Checking";
	return key === "acceptance" ? "验收中" : "检查中";
}

function phaseRepairLabel(key: PhaseMeta["key"], language: Language) {
	if (language === "en")
		return key === "acceptance" ? "Completing" : "Optimizing";
	return key === "acceptance" ? "补完中" : "优化中";
}

const MINI_CHIP: Record<Tone, string> = {
	green: "text-emerald-800",
	blue: "text-sky-800",
	amber: "text-amber-800",
	red: "text-rose-800",
	gray: "text-stone-500",
};

const MINI_DOT: Record<Tone, string> = {
	green: "bg-emerald-500",
	blue: "bg-sky-500",
	amber: "bg-amber-500",
	red: "bg-rose-500",
	gray: "bg-stone-300",
};

/** stepper 用的微型检查点：验收 + 质检各一枚，保持紧凑横排。 */
export function checkDots(
	checks: GoalChecks | null | undefined,
	options: {
		goalComplete: boolean;
		language: Language;
		live?: boolean;
		criteriaChanged?: boolean;
	},
) {
	const t = copy(options.language);
	return phaseMetas(options.language)
		.map((meta) => {
			const label = phaseShortLabel(meta.key, options.language);
			const flagged = meta.key === "acceptance" && options.criteriaChanged;
			if (!checks)
				return options.goalComplete
					? checkMiniChip(
							label,
							{ label: t.passed, tone: "green" },
							0,
							options.language,
							flagged,
						)
					: checkMiniChip(
							label,
							{ label: t.waiting, tone: "gray" },
							0,
							options.language,
							flagged,
						);
			const phase = checks[meta.key];
			const state = phaseState(phase, meta.key, options.language, options.live);
			const roundCount =
				phase.rounds.length + (state.pulse && !state.repairing ? 1 : 0);
			return checkMiniChip(label, state, roundCount, options.language, flagged);
		})
		.join("");
}

function phaseShortLabel(key: PhaseMeta["key"], language: Language) {
	if (language === "en") return key === "acceptance" ? "Accept" : "QA";
	return key === "acceptance" ? "验收" : "质检";
}

function checkMiniChip(
	shortLabel: string,
	state: PhaseView,
	roundCount: number,
	language: Language = "zh",
	criteriaChanged = false,
) {
	const badge =
		roundCount > 1
			? `<span class="text-[9px] font-bold tabular-nums ${TONE_TEXT[state.tone]}">${language === "en" ? `×${roundCount}` : `${roundCount}轮`}</span>`
			: "";
	const marker = criteriaChanged
		? `<span class="font-bold text-amber-700">▲</span>`
		: "";
	return `<span class="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-medium leading-none ${MINI_CHIP[state.tone]}"><span class="h-1.5 w-1.5 shrink-0 rounded-full ${MINI_DOT[state.tone]}${state.pulse ? " pulse-soft" : ""}"></span><span>${escapeHtml(shortLabel)}</span>${badge}${marker}</span>`;
}

const MODEL_TONE: Record<CheckModelStatus, Tone> = {
	running: "blue",
	passed: "green",
	failed: "red",
	error: "amber",
};
const MODEL_ICON: Record<CheckModelStatus, ReturnType<typeof modelIcon>> = {
	running: reportIcon("loader-circle", "h-3 w-3 spin-soft"),
	passed: modelIcon("check"),
	failed: modelIcon("x"),
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
	meta: PhaseMeta,
	ctx: CheckViewContext,
) {
	if (!phase.enabled || phase.rounds.length === 0) return "";
	return phase.rounds
		.map((round) => roundItem(round, phase.rounds.length, meta, ctx))
		.join("");
}

function activeRoundItem(
	phase: CheckPhase,
	meta: PhaseMeta,
	ctx: CheckViewContext,
) {
	if (!phase.enabled || !phase.active || phase.active.length === 0) return "";
	const round = Math.max(0, ...phase.rounds.map((item) => item.round)) + 1;
	return reviewRoundItem({
		round,
		result: "running",
		models: phase.active,
		language: ctx.language,
		meta,
	});
}

function roundItem(
	round: CheckPhase["rounds"][number],
	total: number,
	meta: PhaseMeta,
	ctx: CheckViewContext,
) {
	if (ctx.detail === "full") return fullRoundItem(round, total, ctx.language);
	return reviewRoundItem({
		round: round.round,
		result: round.result,
		models: roundModels(round, ctx.language),
		language: ctx.language,
		meta,
	});
}

function fullRoundItem(
	round: CheckPhase["rounds"][number],
	total: number,
	language: Language,
) {
	const tone = ROUND_TONE[round.result];
	const title = roundHistoryTitle(round, total, language);
	const details = round.details?.trim();
	const detailHtml = details
		? renderMarkdownBlock(
				formatReviewResultLines(details).join("\n"),
				"mt-2 space-y-2 text-xs leading-5 text-stone-600",
			)
		: "";
	return `<li class="flex gap-2 text-xs leading-5 text-stone-600"><span data-rough-node data-tone="${tone}" class="mt-0.5 grid h-4 w-4 shrink-0 place-items-center ${TONE_TEXT[tone]}">${ROUND_ICON[round.result]}</span><div class="min-w-0"><span><span class="font-medium ${TONE_TEXT[tone]}">${escapeHtml(title)}</span>${round.summary ? ` · ${escapeHtml(clipText(round.summary, 160))}` : ""}</span>${detailHtml}</div></li>`;
}

function reviewRoundItem(input: {
	round: number;
	result: CheckResult | "running";
	models: CheckModelSnapshot[];
	language: Language;
	meta: PhaseMeta;
}) {
	const tone = input.result === "running" ? "blue" : ROUND_TONE[input.result];
	const title =
		input.language === "en"
			? `Round ${input.round}`
			: roundLabel(input.round, input.language);
	const models = input.models
		.map((model, index) =>
			reviewModelChip(model, index, input.meta, input.language),
		)
		.join("");
	return `<li class="text-xs leading-5 text-stone-600"><div class="min-w-0 flex flex-wrap items-center gap-1.5"><span class="font-medium ${TONE_TEXT[tone]}">${escapeHtml(title)}</span><span class="text-stone-300">·</span>${models}</div></li>`;
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

function roundModels(
	round: CheckPhase["rounds"][number],
	language: Language,
): CheckModelSnapshot[] {
	if (round.models?.length) return round.models;
	const source = [round.details, round.summary].filter(Boolean).join("\n\n");
	const sections = modelSections(source, language);
	if (sections.length > 0)
		return sections.map((section) => ({
			label: section.label,
			status: roundResultModelStatus(round.result),
			summary: section.body,
		}));
	return [
		{
			label: resultLabel(round.result, language),
			status: roundResultModelStatus(round.result),
			summary: [round.summary, round.details].filter(Boolean).join("\n\n"),
		},
	];
}

function modelSections(text: string, language: Language) {
	const normalized = text.replace(/^(PASS|FAIL)\s*/iu, "").trim();
	const pattern =
		/(?:^|\n)(?:模型|Model)\s+\d+\s+·\s+([^\n]+)\n([\s\S]*?)(?=\n\n(?:模型|Model)\s+\d+\s+·|$)/giu;
	return [...normalized.matchAll(pattern)]
		.map((match) => ({
			label: match[1].trim(),
			body: cleanModelFeedback(match[2], language),
		}))
		.filter((item) => item.label);
}

function cleanModelFeedback(text: string, language: Language) {
	const cleaned = formatReviewResultLines(text).join("\n").trim();
	return cleaned || (language === "en" ? "No detailed output" : "暂无详细输出");
}

function roundResultModelStatus(result: CheckResult): CheckModelStatus {
	if (result === "passed") return "passed";
	if (result === "failed") return "failed";
	return "error";
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

function reviewModelChip(
	model: CheckModelSnapshot,
	_index: number,
	_meta: PhaseMeta,
	language: Language,
) {
	const tone = MODEL_TONE[model.status];
	const summary = modelTooltip(model, _meta.key, language);
	return `<span tabindex="0" data-model-chip data-hover-chip data-tooltip="${escapeHtml(summary)}" data-tooltip-side="auto" data-tooltip-size="lg" class="${SOFT_CHIP_BASE} ${SOFT_CHIP_TONE[tone]} gap-1 px-2 py-0.5 text-[11px] font-medium tracking-[-0.01em]"><span>${MODEL_ICON[model.status]}</span><span>${escapeHtml(model.label)}</span></span>`;
}

function modelTooltip(
	model: CheckModelSnapshot,
	key: PhaseMeta["key"],
	language: Language,
) {
	const fallback =
		model.status === "running"
			? phaseRunningModelFallback(key, language)
			: language === "en"
				? "No detailed output"
				: "暂无详细输出";
	return clipText(model.summary?.trim() || fallback, 1400);
}

function phaseRunningModelFallback(key: PhaseMeta["key"], language: Language) {
	if (language === "en")
		return key === "acceptance"
			? "Accepting, no output yet"
			: "Checking, no output yet";
	return key === "acceptance" ? "验收中，暂无输出" : "检查中，暂无输出";
}

function modelIcon(name: ReportIconName) {
	return reportIcon(name, "h-3 w-3");
}
