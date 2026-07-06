import type { PlanStep } from "../plan/view.js";
import type { Language } from "./config.js";
import { copy } from "./copy.js";
import { inline } from "./html-markdown.js";
import { TONE_TEXT, type Tone } from "./report-blocks.js";
import { reportIcon } from "./report-icons.js";

export interface StepListOptions {
	/** details data-key 前缀，跨卡片唯一（如 "step" / "g0-step"）。 */
	keyPrefix: string;
	/** 是否自动展开第一个未完成步骤的细节（仅当前执行中的清单开）。 */
	expandCurrent: boolean;
	/** 追加在清单末尾的 li（如审查终点节点）；存在时末步连线继续向下。 */
	tail?: string;
	language?: Language;
}

export function stepList(steps: PlanStep[], options: StepListOptions) {
	if (steps.length === 0) return "";
	const activeIndex = steps.findIndex((step) => step.status === "active");
	const currentIndex =
		activeIndex === -1 ? steps.findIndex((step) => !step.done) : activeIndex;
	const rows = steps
		.map((step, index) => stepRow(step, index, steps, currentIndex, options))
		.join("");
	return `<ol class="mt-5">${rows}${options.tail ?? ""}</ol>`;
}

function stepRow(
	step: PlanStep,
	index: number,
	steps: PlanStep[],
	currentIndex: number,
	options: StepListOptions,
) {
	const isLast = index === steps.length - 1 && !options.tail;
	const isCurrent = index === currentIndex;
	const state = stepState(step, index, options.language ?? "zh");
	const connector = isLast
		? ""
		: `<span data-rough-line data-vertical data-tone="${step.done ? "green" : "gray"}" class="absolute bottom-0 left-[13px] top-9 w-1"></span>`;
	const open = isCurrent && options.expandCurrent;
	const detail = step.detail
		? `<details data-key="${options.keyPrefix}-${index}"${open ? " open" : ""} class="mt-1">${stepDetailSummary(options.language ?? "zh")}<p class="mt-1.5 text-sm leading-6 text-stone-600">${inline(step.detail)}</p></details>`
		: "";
	return `<li class="relative flex gap-3 ${isLast ? "" : "pb-5"}">
${connector}
<span data-rough-node data-tone="${state.tone}" class="grid h-7 w-7 shrink-0 place-items-center text-[11px] font-bold ${TONE_TEXT[state.tone]}">${stepGlyph(state.glyph)}</span>
<div class="min-w-0 flex-1 pt-1">
<p class="flex flex-wrap items-center gap-2 text-sm font-medium leading-5 ${isCurrent ? "text-stone-900" : "text-stone-700"}"><span>${inline(step.title)}</span>${stateBadge(state.label, state.tone)}</p>
${detail}
</div>
</li>`;
}

function stepState(step: PlanStep, index: number, language: Language) {
	const t = copy(language);
	if (step.status === "done")
		return { glyph: "✓", label: t.done, tone: "green" as Tone };
	if (step.status === "active")
		return { glyph: "…", label: t.active, tone: "blue" as Tone };
	if (step.status === "blocked")
		return { glyph: "!", label: t.blocked, tone: "amber" as Tone };
	return { glyph: String(index + 1), label: t.todo, tone: "gray" as Tone };
}

function stepGlyph(glyph: string) {
	if (glyph === "✓") return reportIcon("check", "h-4 w-4");
	if (glyph === "…") return reportIcon("clock", "h-4 w-4");
	if (glyph === "!") return reportIcon("warning-circle", "h-4 w-4");
	return glyph;
}

function stateBadge(label: string, tone: Tone) {
	if (tone === "green") return "";
	return `<span class="text-[11px] font-medium ${TONE_TEXT[tone]}">${label}</span>`;
}

function stepDetailSummary(language: Language) {
	const label = language === "en" ? "Notes" : "说明";
	return `<summary class="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium text-stone-500 transition-[color,background-color,transform] duration-150 hover:bg-stone-50 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 active:scale-[0.96]">${reportIcon("list-checks", "h-3.5 w-3.5")}<span>${label}</span></summary>`;
}
