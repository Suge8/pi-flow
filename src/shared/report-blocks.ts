import { readFileSync } from "node:fs";
import type { Language } from "./config.js";
import { copy } from "./copy.js";
import { localizeErrors } from "./error-language.js";
import { renderMarkdownBlock } from "./html-markdown.js";
import { cleanReportCopy } from "./report-copy.js";
import { reportHead } from "./report-html.js";
import { reportIcon } from "./report-icons.js";

export type Tone = "green" | "blue" | "amber" | "red" | "gray";

export const TONE_TEXT: Record<Tone, string> = {
	green: "text-emerald-800",
	blue: "text-sky-800",
	amber: "text-amber-800",
	red: "text-rose-800",
	gray: "text-stone-500",
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

export function hero(args: {
	title: string;
	subtitle: string;
	percent: number;
	tone: Tone;
	caption: string;
	commands?: string[];
}) {
	const chips = args.commands?.length
		? `<div class="flex flex-wrap items-center gap-2 pt-1">${args.commands.map(commandChip).join("")}</div>`
		: "";
	return `<header data-rough-card class="bg-white p-6">
<div class="flex flex-wrap items-center justify-between gap-6">
<div class="min-w-0 flex-1 space-y-3">
<h1 class="font-serif text-3xl leading-snug text-stone-900">${escapeHtml(args.title)}</h1>
<p class="text-sm leading-6 text-stone-500">${escapeHtml(args.subtitle)}</p>
${chips}
</div>
${progressRing(args.percent, args.tone, args.caption)}
</div>
</header>`;
}
let logoDataUri: string | undefined;

export function brandHeader() {
	const logo = flowLogoDataUri();
	const mark = logo
		? `<img src="${logo}" alt="" class="h-full w-full rounded-xl object-cover" />`
		: reportIcon("sparkle", "h-6 w-6 text-stone-900");
	return `<div class="flex items-center gap-3 px-1 pb-1" aria-label="Flow">
<span class="grid h-11 w-11 place-items-center rounded-2xl bg-white p-1 shadow-[0_0_0_1px_rgba(41,37,36,0.14),0_10px_24px_rgba(41,37,36,0.08)]">${mark}</span>
<span class="font-serif text-3xl font-semibold tracking-[-0.055em] text-stone-950">Flow</span>
</div>`;
}

function flowLogoDataUri() {
	if (logoDataUri !== undefined) return logoDataUri;
	try {
		logoDataUri = `data:image/png;base64,${readFileSync(new URL("../../assets/logo.png", import.meta.url)).toString("base64")}`;
	} catch {
		logoDataUri = "";
	}
	return logoDataUri;
}

export function seal(text: string, tone: Tone) {
	return `<span data-rough-seal data-tone="${tone}" class="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold ${TONE_TEXT[tone]}">${toneIcon(tone)}${escapeHtml(text)}</span>`;
}

function toneIcon(tone: Tone) {
	if (tone === "green") return reportIcon("check-circle", "h-3.5 w-3.5");
	if (tone === "red") return reportIcon("x-circle", "h-3.5 w-3.5");
	if (tone === "amber") return reportIcon("warning-circle", "h-3.5 w-3.5");
	if (tone === "blue") return reportIcon("clock", "h-3.5 w-3.5");
	return "";
}

export function sectionTitle(text: string) {
	return `<p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">${escapeHtml(text)}</p>`;
}

export function progressRing(percent: number, tone: Tone, caption: string) {
	return `<div class="flex flex-col items-center gap-1.5">
<div data-rough-ring data-percent="${percent}" data-tone="${tone}" class="grid h-28 w-28 place-items-center">
<span class="text-2xl font-bold tabular-nums text-stone-900">${percent}<span class="text-sm font-semibold text-stone-400">%</span></span>
</div>
<p class="text-xs text-stone-500">${escapeHtml(caption)}</p>
</div>`;
}

export function progressBar(percent: number, tone: Tone) {
	return `<div data-rough-bar data-percent="${percent}" data-tone="${tone}" class="h-3 w-full"></div>`;
}

export function detailsCard(label: string, body: string) {
	return `<details data-rough-card data-key="${escapeHtml(label)}" class="bg-white/70 px-5 py-4">${detailsSummary(label, "text-sm font-medium text-stone-600")}<div class="mt-3 space-y-4">${body}</div></details>`;
}

export function detailsSummary(
	label: string,
	className: string,
	options: { iconOnly?: boolean } = {},
) {
	if (options.iconOnly)
		return `<summary aria-label="${escapeHtml(label)}" class="inline-grid h-6 w-6 place-items-center rounded-full bg-white/75 text-stone-500 shadow-[0_0_0_1px_rgba(41,37,36,0.08),0_5px_12px_rgba(41,37,36,0.05)] transition-[color,background-color,box-shadow,transform] duration-150 hover:bg-stone-50 hover:text-stone-900 hover:shadow-[0_0_0_1px_rgba(41,37,36,0.12),0_7px_16px_rgba(41,37,36,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 active:scale-[0.96] ${className}">${reportIcon("dots-three", "h-3.5 w-3.5")}</summary>`;
	return `<summary class="inline-flex items-center gap-1.5 ${className}">${reportIcon("dots-three", "h-3.5 w-3.5 opacity-70")}<span>${escapeHtml(label)}</span></summary>`;
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

export function commandChip(command: string) {
	return `<code class="bg-stone-100 px-2.5 py-1 font-mono text-xs text-stone-700">${escapeHtml(command)}</code>`;
}

export function debugList(entries: [string, string][]) {
	return `<dl class="grid gap-3 text-xs sm:grid-cols-2">${entries
		.map(
			([key, value]) =>
				`<div>${sectionTitle(key)}<dd class="mt-1 break-all font-mono text-stone-500">${escapeHtml(value)}</dd></div>`,
		)
		.join("")}</dl>`;
}
