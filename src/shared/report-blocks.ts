import type { Language } from "./config.js";
import { copy } from "./copy.js";
import { localizeErrors } from "./error-language.js";
import { renderMarkdownBlock } from "./html-markdown.js";
import { cleanReportCopy } from "./report-copy.js";
import { reportHead } from "./report-html.js";
import { type ReportIconName, reportIcon } from "./report-icons.js";

export type Tone = "green" | "blue" | "amber" | "red" | "gray";

/** 报告字号阶梯：只收 thrice+ 的值。 */
export const TYPE = {
	meta: "text-[11px]",
	micro: "text-[10px]",
	tiny: "text-[9px]",
} as const;

const EASE = "ease-[cubic-bezier(0.22,1,0.36,1)]";
const FOCUS =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:focus-visible:ring-sky-700";
const INSET_RING = "shadow-[inset_0_0_0_1px_var(--ring-subtle)]";
const INSET_RING_HOVER =
	"hover:shadow-[inset_0_0_0_1px_var(--ring-hover),0_4px_12px_var(--shadow-chip)]";
const CHIP_MOTION = `transition-[background-color,box-shadow,transform] duration-200 ${EASE} ${FOCUS} active:scale-[0.96]`;
const SOFT_SHADOW =
	"shadow-[0_6px_16px_var(--shadow-chip)] hover:shadow-[0_9px_24px_var(--shadow-chip)]";

/** Tone 单一事实源：语义色只管文本/点；面色走 CSS 主题 token。 */
export const TONE: Record<
	Tone,
	{ text: string; sealBg: string; soft: string; dot: string }
> = {
	green: {
		text: "text-emerald-800 dark:text-emerald-300",
		sealBg: "bg-[var(--tone-green-surface)]",
		soft: `bg-[var(--tone-green-surface)] text-emerald-800 dark:text-emerald-200 hover:bg-[var(--tone-green-surface-hover)] ${SOFT_SHADOW}`,
		dot: "bg-emerald-500 dark:bg-emerald-400",
	},
	blue: {
		text: "text-sky-800 dark:text-sky-300",
		sealBg: "bg-[var(--tone-blue-surface)]",
		soft: `bg-[var(--tone-blue-surface)] text-sky-800 dark:text-sky-200 hover:bg-[var(--tone-blue-surface-hover)] ${SOFT_SHADOW}`,
		dot: "bg-sky-500 dark:bg-sky-400",
	},
	amber: {
		text: "text-amber-800 dark:text-amber-300",
		sealBg: "bg-[var(--tone-amber-surface)]",
		soft: `bg-[var(--tone-amber-surface)] text-amber-800 dark:text-amber-200 hover:bg-[var(--tone-amber-surface-hover)] ${SOFT_SHADOW}`,
		dot: "bg-amber-500 dark:bg-amber-400",
	},
	red: {
		text: "text-rose-800 dark:text-rose-300",
		sealBg: "bg-[var(--tone-red-surface)]",
		soft: `bg-[var(--tone-red-surface)] text-rose-800 dark:text-rose-200 hover:bg-[var(--tone-red-surface-hover)] ${SOFT_SHADOW}`,
		dot: "bg-rose-500 dark:bg-rose-400",
	},
	gray: {
		text: "text-stone-500 dark:text-stone-400",
		sealBg: "bg-[var(--report-surface-muted)]",
		soft: `bg-[var(--report-surface-soft)] text-stone-600 dark:text-stone-300 hover:bg-[var(--report-surface)] hover:text-stone-900 dark:hover:text-stone-100 ${SOFT_SHADOW}`,
		dot: "bg-stone-300 dark:bg-stone-500",
	},
};

/** Chip 变体：soft 彩色抬起 / neutral 中性模型 token。 */
export const CHIP = {
	soft: `inline-flex cursor-pointer items-center rounded-full hover:-translate-y-px ${CHIP_MOTION}`,
	neutral: `inline-flex cursor-pointer items-center rounded-full bg-[var(--report-chip)] text-stone-700 dark:text-stone-200 ${INSET_RING} hover:bg-[var(--report-chip-hover)] ${INSET_RING_HOVER} ${CHIP_MOTION}`,
} as const;

/** 交互 pill：按钮 / modal 关闭等，比 chip 略重一点的抬起。 */
export const PILL_INTERACTIVE = `cursor-pointer rounded-full bg-[var(--report-chip)] shadow-[0_0_0_1px_var(--ring-subtle),0_6px_14px_var(--shadow-chip)] transition-[color,background-color,box-shadow,transform] duration-300 ${EASE} hover:-translate-y-px hover:bg-[var(--report-chip-hover)] hover:text-stone-900 dark:hover:text-stone-50 hover:shadow-[0_0_0_1px_var(--ring-hover),0_8px_18px_var(--shadow-chip)] ${FOCUS} active:translate-y-0 active:scale-[0.96]`;

export function escapeHtml(value: string) {
	return escapeHtmlLiteral(cleanReportCopy(value));
}

export function escapeHtmlLiteral(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function themeToggleButton(language: Language = "zh") {
	const t = copy(language);
	return `<button type="button" data-theme-toggle class="inline-flex h-10 w-10 shrink-0 items-center justify-center text-stone-600 dark:text-stone-300 ${PILL_INTERACTIVE}" aria-label="${escapeHtml(t.themeToDark)}" data-label-light="${escapeHtml(t.themeToLight)}" data-label-dark="${escapeHtml(t.themeToDark)}"><span class="dark:hidden">${reportIcon("moon", "h-4 w-4")}</span><span class="hidden dark:inline">${reportIcon("sun", "h-4 w-4")}</span></button>`;
}

export function pageShell(
	title: string,
	body: string,
	options: {
		width?: string;
		language?: Language;
		themeToggle?: boolean;
		bodyClass?: string;
	} = {},
) {
	const t = copy(options.language ?? "zh");
	const themeToggle =
		options.themeToggle === false
			? ""
			: `<div class="flex justify-end px-1 pb-1">${themeToggleButton(options.language ?? "zh")}</div>`;
	return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
${reportHead()}
</head>
<body class="bg-[var(--report-page)] text-[var(--report-text)] antialiased transition-colors duration-200 font-sans${options.bodyClass ? ` ${options.bodyClass}` : ""}">
<main class="mx-auto ${options.width ?? "max-w-5xl"} px-5 py-8 space-y-4">
${themeToggle}
${body}
</main>
</body>
</html>
`;
}

export function card(body: string, options: { tone?: Tone; bg?: string } = {}) {
	const tone = options.tone ? ` data-tone="${options.tone}"` : "";
	return `<section data-rough-card${tone} class="${options.bg ?? "bg-[var(--report-surface)]"} p-5">${body}</section>`;
}

export function modalTrigger(input: {
	id: string;
	label: string;
	icon?: ReportIconName;
	className?: string;
}) {
	const icon = input.icon ? reportIcon(input.icon, "h-3.5 w-3.5") : "";
	return `<button type="button" data-modal-open="${escapeHtml(input.id)}" class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium ${input.className ?? "text-stone-500 dark:text-stone-400"} ${PILL_INTERACTIVE}">${icon}<span>${escapeHtml(input.label)}</span></button>`;
}

export function hovercardTrigger(input: {
	label: string;
	tooltip: string;
	icon?: ReportIconName;
	side?: "top" | "left" | "right";
	tone?: Tone;
	className?: string;
}) {
	const icon = input.icon ? reportIcon(input.icon, "h-3.5 w-3.5") : "";
	const tone = input.tone ?? "gray";
	const extra = input.className ? ` ${input.className}` : "";
	return `<span tabindex="0" data-hover-chip data-tooltip="${escapeHtml(input.tooltip)}" data-tooltip-side="${input.side ?? "top"}" data-tooltip-size="lg" class="${CHIP.soft} ${TONE[tone].soft} gap-1.5 px-3 py-1 text-xs font-medium${extra}">${icon}<span>${escapeHtml(input.label)}</span></span>`;
}

/** 模型 token：中性底，状态色只在 icon。 */
export function modelHoverChip(input: {
	label: string;
	tooltip: string;
	iconHtml: string;
	iconTone: Tone;
	thinking?: string;
	side?: "auto" | "top" | "left" | "right";
	preserveTooltip?: boolean;
}) {
	const thinking = input.thinking
		? `<span class="text-[10px] font-normal text-stone-400/90 dark:text-stone-500">${escapeHtml(input.thinking)}</span>`
		: "";
	const tooltip = input.preserveTooltip
		? escapeHtmlLiteral(input.tooltip)
		: escapeHtml(input.tooltip);
	return `<span tabindex="0" data-model-chip data-hover-chip data-tooltip="${tooltip}" data-tooltip-side="${input.side ?? "auto"}" data-tooltip-size="lg" class="${CHIP.neutral} gap-1 px-2 py-1 ${TYPE.meta} font-medium tracking-[-0.01em]"><span class="${TONE[input.iconTone].text}">${input.iconHtml}</span><span class="max-w-[9.5rem] truncate">${escapeHtml(input.label)}</span>${thinking}</span>`;
}

/** 标题旁小 ? 提示。 */
export function hintMark(hint: string) {
	return `<span tabindex="0" aria-label="${escapeHtml(hint)}" data-tooltip="${escapeHtml(hint)}" class="tooltip inline-grid h-3 w-3 shrink-0 cursor-pointer place-items-center rounded-full bg-[var(--report-surface-muted)] text-[8px] font-semibold text-stone-500 dark:text-stone-400 ${INSET_RING} transition-[color,background-color,box-shadow] duration-150 hover:bg-[var(--report-chip-hover)] hover:text-stone-900 dark:hover:text-stone-100 ${FOCUS}">?</span>`;
}

export function modal(input: {
	id: string;
	title?: string;
	ariaLabel?: string;
	icon?: ReportIconName;
	tone?: Tone;
	body: string;
	language?: Language;
	dataKey?: string;
}) {
	const hasTitle = Boolean(input.title);
	const icon =
		hasTitle && input.icon
			? `<span class="${TONE[input.tone ?? "gray"].text}">${reportIcon(input.icon, "h-5 w-5")}</span>`
			: "";
	const closeLabel = (input.language ?? "zh") === "en" ? "Close" : "关闭";
	const label = input.ariaLabel ?? input.title;
	const aria = label ? ` aria-label="${escapeHtml(label)}"` : "";
	const heading = hasTitle
		? `<div class="inline-flex min-w-0 items-center gap-2">${icon}<p class="truncate text-base font-semibold text-stone-900 dark:text-stone-100">${escapeHtml(input.title ?? "")}</p></div>`
		: "";
	return `<dialog id="${escapeHtml(input.id)}"${aria}${input.dataKey ? ` data-key="${escapeHtml(input.dataKey)}"` : ""}>
<div data-modal-shell data-rough-card class="flex max-h-[82dvh] flex-col bg-[var(--report-surface)] shadow-[0_24px_80px_var(--shadow-chip)]">
<header class="flex shrink-0 items-center ${hasTitle ? "justify-between" : "justify-end"} gap-3 px-6 pt-5">
${heading}
<button type="button" data-modal-close aria-label="${closeLabel}" class="grid h-8 w-8 shrink-0 place-items-center text-stone-500 dark:text-stone-400 ${PILL_INTERACTIVE}">${reportIcon("x", "h-3.5 w-3.5")}</button>
</header>
<div class="min-h-0 overflow-y-auto px-6 pb-8 pt-4">${input.body}</div>
</div>
</dialog>`;
}

export function seal(
	text: string,
	tone: Tone,
	options: { icon?: ReportIconName; pulse?: boolean } = {},
) {
	const icon = options.icon
		? reportIcon(options.icon, "h-3.5 w-3.5")
		: toneIcon(tone);
	const iconHtml =
		icon && options.pulse ? `<span class="pulse-soft">${icon}</span>` : icon;
	return `<span data-rough-seal data-tone="${tone}" class="inline-flex shrink-0 items-center gap-1 px-2.5 py-0.5 text-xs font-medium ${TONE[tone].sealBg} ${TONE[tone].text}">${iconHtml}${escapeHtml(text)}</span>`;
}

export function statusText(text: string, tone: Tone) {
	return `<span class="shrink-0 text-xs font-medium ${TONE[tone].text}">${escapeHtml(text)}</span>`;
}

function toneIcon(tone: Tone) {
	if (tone === "green") return reportIcon("check-circle", "h-3.5 w-3.5");
	if (tone === "red") return reportIcon("x-circle", "h-3.5 w-3.5");
	if (tone === "amber") return reportIcon("warning-circle", "h-3.5 w-3.5");
	if (tone === "blue")
		return reportIcon("loader-circle", "h-3.5 w-3.5 spin-soft");
	return "";
}

export function sectionTitle(text: string) {
	return `<p class="${TYPE.meta} font-semibold uppercase tracking-[0.18em] text-stone-400 dark:text-stone-500">${escapeHtml(text)}</p>`;
}

export function progressRing(percent: number, tone: Tone) {
	return `<div data-rough-ring data-percent="${percent}" data-tone="${tone}" class="grid h-32 w-32 shrink-0 place-items-center">
<span class="text-3xl font-bold tabular-nums text-stone-900 dark:text-stone-100">${percent}<span class="text-sm font-semibold text-stone-400 dark:text-stone-500">%</span></span>
</div>`;
}

/** 模型 + 思考强度的统一渲染：强度永远弱于模型名，所有展示面共用。 */
export function modelWithThinking(label: string, thinking?: string) {
	const suffix = thinking
		? `<span class="pl-1 text-[10px] font-normal text-stone-400/90 dark:text-stone-500">${escapeHtml(thinking)}</span>`
		: "";
	return `<span class="font-mono">${escapeHtml(label)}</span>${suffix}`;
}

export function subSection(label: string, markdown: string) {
	return `<div>${sectionTitle(label)}${renderMarkdownBlock(markdown, "mt-2 space-y-2 text-sm leading-6 text-stone-700 dark:text-stone-300")}</div>`;
}

export function errorCard(errors: string[], language: Language = "zh") {
	return `<section data-rough-card data-tone="red" class="bg-[var(--tone-red-surface)] p-5"><p class="text-sm font-semibold text-rose-900 dark:text-rose-200">${escapeHtml(copy(language).validationErrors)}</p><ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-800 dark:text-rose-300">${localizeErrors(
		errors,
		language,
	)
		.map((error) => `<li>${escapeHtml(error)}</li>`)
		.join("")}</ul></section>`;
}

export function errorPage(input: {
	pageTitle: string;
	kindLabel: string;
	title: string;
	errors: string[];
	requestText?: string;
	language?: Language;
}) {
	const t = copy(input.language ?? "zh");
	return pageShell(
		input.pageTitle,
		[
			`<header data-rough-card data-tone="red" class="bg-[var(--report-surface)] p-6"><p class="${TYPE.meta} font-semibold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-400">${escapeHtml(input.kindLabel)}</p><h1 class="mt-2 font-serif text-3xl leading-snug text-stone-900 dark:text-stone-100">${escapeHtml(input.title)}</h1></header>`,
			errorCard(input.errors, input.language),
			card(
				`${sectionTitle(t.request)}<p class="mt-3 whitespace-pre-wrap text-sm leading-6 text-stone-700 dark:text-stone-300">${escapeHtml(input.requestText ?? "")}</p>`,
			),
		].join("\n"),
		{ language: input.language },
	);
}

export function debugList(entries: [string, string][]) {
	return `<dl class="grid gap-3 text-xs sm:grid-cols-2">${entries
		.map(
			([key, value]) =>
				`<div>${sectionTitle(key)}<dd class="mt-1 break-all font-mono text-stone-500 dark:text-stone-400">${escapeHtml(value)}</dd></div>`,
		)
		.join("")}</dl>`;
}
