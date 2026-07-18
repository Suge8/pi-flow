import type { CheckboxAttribution } from "../flow/types.js";
import type { PlanStep } from "../plan/view.js";
import type { Language } from "./config.js";
import { copy } from "./copy.js";
import { inline } from "./html-markdown.js";
import {
	escapeHtml,
	modelWithThinking,
	TONE,
	type Tone,
	TYPE,
} from "./report-blocks.js";
import { reportIcon } from "./report-icons.js";
import { shortModel } from "./reviewer-pool.js";

export interface StepListOptions {
	language?: Language;
	/** 勾级归因（与 steps 下标对齐）：谁在何时把该步勾成完成；无归因不渲染。 */
	attributions?: (CheckboxAttribution | undefined)[];
}

export function stepList(steps: PlanStep[], options: StepListOptions) {
	if (steps.length === 0) return "";
	const activeIndex = steps.findIndex((step) => step.status === "active");
	const currentIndex =
		activeIndex === -1 ? steps.findIndex((step) => !step.done) : activeIndex;
	return `<div data-step-flow-container class="relative">
<ol data-step-flow>${stepRows(steps, 0, currentIndex, options)}</ol>
</div>`;
}

function stepRows(
	steps: PlanStep[],
	offset: number,
	currentIndex: number,
	options: StepListOptions,
) {
	return steps
		.map((step, index) =>
			stepRow(
				step,
				offset + index,
				index === steps.length - 1,
				currentIndex,
				options,
			),
		)
		.join("");
}

function stepRow(
	step: PlanStep,
	index: number,
	isLast: boolean,
	currentIndex: number,
	options: StepListOptions,
) {
	const isCurrent = index === currentIndex;
	const state = stepState(step, index, options.language ?? "zh");
	const connector = isLast
		? ""
		: `<span data-rough-line data-vertical data-tone="${step.done ? "green" : "gray"}" class="absolute bottom-0 left-[17px] top-11 w-1"></span>`;
	const detail = step.detail ? stepDetailText(step.detail) : "";
	return `<li class="relative ${isLast ? "" : "pb-6"}">
${connector}
<div data-step-row data-step-index="${index}" class="flex min-w-0 gap-4">
<span data-rough-node data-tone="${state.tone}" class="grid h-9 w-9 shrink-0 place-items-center text-xs font-bold ${TONE[state.tone].text}">${stepGlyph(state.glyph)}</span>
<div data-step-copy class="min-w-0 flex-1 pt-1.5">
<p class="flex flex-wrap items-center gap-2 text-sm font-semibold leading-5 ${isCurrent ? "text-stone-900 dark:text-stone-100" : "text-stone-700 dark:text-stone-300"}"><span>${inline(step.title)}</span>${stateBadge(state.label, state.tone)}${attributionText(options.attributions?.[index])}</p>
${detail}
</div>
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
	if (glyph === "✓") return reportIcon("check", "h-5 w-5");
	if (glyph === "…") return reportIcon("rotate-3d", "h-5 w-5 rotate-3d-soft");
	if (glyph === "!") return reportIcon("warning-circle", "h-5 w-5");
	return glyph;
}

function stateBadge(label: string, tone: Tone) {
	if (tone === "green" || tone === "gray") return "";
	return `<span class="${TYPE.meta} font-medium ${TONE[tone].text}">${label}</span>`;
}

/** 勾级归因行内文字：🧠 模型 强度：时间；轻于标题两个层级。 */
function attributionText(attribution: CheckboxAttribution | undefined) {
	if (!attribution) return "";
	const time = new Date(attribution.at);
	const body = `${modelWithThinking(shortModel(attribution.model), attribution.thinking)}<span class="text-stone-300 dark:text-stone-600">：</span><time datetime="${escapeHtml(time.toISOString())}" class="tabular-nums">${escapeHtml(attributionTime(time))}</time>`;
	return `<span class="inline-flex shrink-0 items-center gap-1 text-[10.5px] font-normal leading-none text-stone-400 dark:text-stone-500"><span class="text-indigo-400/70 dark:text-indigo-300/50">${reportIcon("brain", "h-3 w-3")}</span>${body}</span>`;
}

function attributionTime(date: Date) {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function stepDetailText(detail: string) {
	return `<p data-step-detail class="mt-1 max-w-[46ch] text-xs leading-5 text-stone-500 dark:text-stone-400">${inline(detail)}</p>`;
}
