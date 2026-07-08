import type { Language } from "./config.js";
import { copy } from "./copy.js";
import { localizeErrors } from "./error-language.js";
import { renderMarkdownBlock } from "./html-markdown.js";
import { cleanReportCopy } from "./report-copy.js";
import { reportHead } from "./report-html.js";
import { type ReportIconName, reportIcon } from "./report-icons.js";

export type Tone = "green" | "blue" | "amber" | "red" | "gray";

export const TONE_TEXT: Record<Tone, string> = {
	green: "text-emerald-800",
	blue: "text-sky-800",
	amber: "text-amber-800",
	red: "text-rose-800",
	gray: "text-stone-500",
};

const TONE_SEAL_BG: Record<Tone, string> = {
	green: "bg-emerald-50/80",
	blue: "bg-sky-50/80",
	amber: "bg-amber-50/80",
	red: "bg-rose-50/80",
	gray: "bg-stone-100/80",
};

export const SOFT_CHIP_BASE =
	"inline-flex cursor-pointer items-center rounded-full transition-[background-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 active:scale-[0.96]";

export const SOFT_CHIP_TONE: Record<Tone, string> = {
	green:
		"bg-emerald-50/90 text-emerald-800 shadow-[0_6px_16px_rgba(16,185,129,0.08)] hover:bg-emerald-50 hover:shadow-[0_9px_24px_rgba(16,185,129,0.11)]",
	blue: "bg-sky-50/90 text-sky-800 shadow-[0_6px_16px_rgba(14,165,233,0.08)] hover:bg-sky-50 hover:shadow-[0_9px_24px_rgba(14,165,233,0.11)]",
	amber:
		"bg-amber-50/90 text-amber-800 shadow-[0_6px_16px_rgba(245,158,11,0.08)] hover:bg-amber-50 hover:shadow-[0_9px_24px_rgba(245,158,11,0.11)]",
	red: "bg-rose-50/90 text-rose-800 shadow-[0_6px_16px_rgba(244,63,94,0.08)] hover:bg-rose-50 hover:shadow-[0_9px_24px_rgba(244,63,94,0.11)]",
	gray: "bg-white/80 text-stone-600 shadow-[0_6px_16px_rgba(41,37,36,0.06)] hover:bg-white hover:text-stone-900 hover:shadow-[0_9px_24px_rgba(41,37,36,0.08)]",
};

export function escapeHtml(value: string) {
	return cleanReportCopy(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function pageShell(
	title: string,
	body: string,
	options: { width?: string; language?: Language } = {},
) {
	return `<!doctype html>
<html lang="${copy(options.language ?? "zh").htmlLang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
${reportHead()}
</head>
<body class="bg-stone-50 text-stone-900 font-sans">
<main class="mx-auto ${options.width ?? "max-w-5xl"} px-5 py-8 space-y-4">
${body}
</main>
</body>
</html>
`;
}

export function card(body: string, options: { tone?: Tone; bg?: string } = {}) {
	const tone = options.tone ? ` data-tone="${options.tone}"` : "";
	return `<section data-rough-card${tone} class="${options.bg ?? "bg-white"} p-5">${body}</section>`;
}

/** 交互 pill 共享样式：按钮 / summary / 触发器统一手感。 */
export const PILL_INTERACTIVE =
	"cursor-pointer rounded-full bg-white/75 shadow-[0_0_0_1px_rgba(41,37,36,0.08),0_6px_14px_rgba(41,37,36,0.05)] transition-[color,background-color,box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-px hover:bg-stone-50 hover:text-stone-900 hover:shadow-[0_0_0_1px_rgba(41,37,36,0.12),0_8px_18px_rgba(41,37,36,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 active:translate-y-0 active:scale-[0.96]";

export function modalTrigger(input: {
	id: string;
	label: string;
	icon?: ReportIconName;
	className?: string;
}) {
	const icon = input.icon ? reportIcon(input.icon, "h-3.5 w-3.5") : "";
	return `<button type="button" data-modal-open="${escapeHtml(input.id)}" class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium ${input.className ?? "text-stone-500"} ${PILL_INTERACTIVE}">${icon}<span>${escapeHtml(input.label)}</span></button>`;
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
	return `<span tabindex="0" data-hover-chip data-tooltip="${escapeHtml(input.tooltip)}" data-tooltip-side="${input.side ?? "top"}" data-tooltip-size="lg" class="${SOFT_CHIP_BASE} ${SOFT_CHIP_TONE[tone]} gap-1.5 px-3 py-1 text-xs font-medium${extra}">${icon}<span>${escapeHtml(input.label)}</span></span>`;
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
			? `<span class="${TONE_TEXT[input.tone ?? "gray"]}">${reportIcon(input.icon, "h-5 w-5")}</span>`
			: "";
	const closeLabel = (input.language ?? "zh") === "en" ? "Close" : "关闭";
	const label = input.ariaLabel ?? input.title;
	const aria = label ? ` aria-label="${escapeHtml(label)}"` : "";
	const heading = hasTitle
		? `<div class="inline-flex min-w-0 items-center gap-2">${icon}<p class="truncate text-base font-semibold text-stone-900">${escapeHtml(input.title ?? "")}</p></div>`
		: "";
	return `<dialog id="${escapeHtml(input.id)}"${aria}${input.dataKey ? ` data-key="${escapeHtml(input.dataKey)}"` : ""}>
<div data-modal-shell data-rough-card class="flex max-h-[82dvh] flex-col bg-white shadow-[0_24px_80px_rgba(41,37,36,0.18)]">
<header class="flex shrink-0 items-center ${hasTitle ? "justify-between" : "justify-end"} gap-3 px-6 pt-5">
${heading}
<button type="button" data-modal-close aria-label="${closeLabel}" class="grid h-8 w-8 shrink-0 place-items-center text-stone-500 ${PILL_INTERACTIVE}">${reportIcon("x", "h-3.5 w-3.5")}</button>
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
	return `<span data-rough-seal data-tone="${tone}" class="inline-flex shrink-0 items-center gap-1 px-2.5 py-0.5 text-xs font-medium ${TONE_SEAL_BG[tone]} ${TONE_TEXT[tone]}">${iconHtml}${escapeHtml(text)}</span>`;
}

export function statusText(text: string, tone: Tone) {
	return `<span class="shrink-0 text-xs font-medium ${TONE_TEXT[tone]}">${escapeHtml(text)}</span>`;
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
	return `<p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">${escapeHtml(text)}</p>`;
}

export function progressRing(percent: number, tone: Tone) {
	return `<div data-rough-ring data-percent="${percent}" data-tone="${tone}" class="grid h-24 w-24 shrink-0 place-items-center">
<span class="text-xl font-bold tabular-nums text-stone-900">${percent}<span class="text-xs font-semibold text-stone-400">%</span></span>
</div>`;
}

export function subSection(label: string, markdown: string) {
	return `<div>${sectionTitle(label)}${renderMarkdownBlock(markdown, "mt-2 space-y-2 text-sm leading-6 text-stone-700")}</div>`;
}

export function errorCard(errors: string[], language: Language = "zh") {
	return `<section data-rough-card data-tone="red" class="bg-rose-50/70 p-5"><p class="text-sm font-semibold text-rose-900">${escapeHtml(copy(language).validationErrors)}</p><ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-800">${localizeErrors(
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
	originalRequest?: string;
	language?: Language;
}) {
	const t = copy(input.language ?? "zh");
	return pageShell(
		input.pageTitle,
		[
			`<header data-rough-card data-tone="red" class="bg-white p-6"><p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-600">${escapeHtml(input.kindLabel)}</p><h1 class="mt-2 font-serif text-3xl leading-snug text-stone-900">${escapeHtml(input.title)}</h1></header>`,
			errorCard(input.errors, input.language),
			card(
				`${sectionTitle(t.originalRequest)}<p class="mt-3 whitespace-pre-wrap text-sm leading-6 text-stone-700">${escapeHtml(input.originalRequest ?? "")}</p>`,
			),
		].join("\n"),
		{ language: input.language },
	);
}

export function debugList(entries: [string, string][]) {
	return `<dl class="grid gap-3 text-xs sm:grid-cols-2">${entries
		.map(
			([key, value]) =>
				`<div>${sectionTitle(key)}<dd class="mt-1 break-all font-mono text-stone-500">${escapeHtml(value)}</dd></div>`,
		)
		.join("")}</dl>`;
}
