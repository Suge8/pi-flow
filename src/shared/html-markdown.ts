import { clipText } from "./clip.js";
import { cleanReportCopy } from "./report-copy.js";

export function renderMarkdownBlock(markdown: string, className = "") {
	const html = markdownToHtml(cleanReportCopy(markdown).trim() || "未填写");
	return `<div class="${className || "space-y-3 text-sm leading-6 text-stone-700 dark:text-stone-300"}">${html}</div>`;
}

export { clipText };

function markdownToHtml(markdown: string) {
	const state = { list: "" as "" | "ul" | "ol", paragraph: [] as string[] };
	const html: string[] = [];
	let code: string[] | undefined;
	for (const rawLine of markdown.split(/\r?\n/)) {
		if (rawLine.trim().startsWith("```")) {
			if (code) {
				html.push(codeBlock(code.join("\n")));
				code = undefined;
			} else {
				flushText(html, state);
				code = [];
			}
			continue;
		}
		if (code) {
			code.push(rawLine);
			continue;
		}
		const line = rawLine.trim();
		if (!line) {
			flushText(html, state);
			continue;
		}
		const heading = line.match(/^#{1,4}\s+(.+)$/u);
		if (heading) {
			flushText(html, state);
			html.push(
				`<p class="text-sm font-semibold text-stone-800 dark:text-stone-200">${inline(heading[1])}</p>`,
			);
			continue;
		}
		const checkbox = line.match(/^-\s+\[([ xX~!])\]\s+(.+)$/u);
		if (checkbox) {
			openList(html, state, "ul");
			html.push(checkboxItem(checkbox[2], checkboxStatus(checkbox[1])));
			continue;
		}
		const bullet = line.match(/^[-*]\s+(.+)$/u);
		if (bullet) {
			openList(html, state, "ul");
			html.push(
				`<li class="flex gap-2"><span class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-400"></span><span>${inline(bullet[1])}</span></li>`,
			);
			continue;
		}
		const number = line.match(/^\d+[.)]\s+(.+)$/u);
		if (number) {
			openList(html, state, "ol");
			html.push(`<li class="pl-1">${inline(number[1])}</li>`);
			continue;
		}
		flushList(html, state);
		state.paragraph.push(line);
	}
	if (code) html.push(codeBlock(code.join("\n")));
	flushText(html, state);
	return html.join("\n");
}

function openList(
	html: string[],
	state: { list: "" | "ul" | "ol"; paragraph: string[] },
	type: "ul" | "ol",
) {
	flushParagraph(html, state);
	if (state.list === type) return;
	flushList(html, state);
	state.list = type;
	html.push(
		type === "ul"
			? '<ul class="space-y-2">'
			: '<ol class="list-decimal space-y-2 pl-5">',
	);
}

function flushText(
	html: string[],
	state: { list: "" | "ul" | "ol"; paragraph: string[] },
) {
	flushParagraph(html, state);
	flushList(html, state);
}

function flushParagraph(html: string[], state: { paragraph: string[] }) {
	if (state.paragraph.length === 0) return;
	html.push(`<p>${inline(state.paragraph.join(" "))}</p>`);
	state.paragraph = [];
}

function flushList(html: string[], state: { list: "" | "ul" | "ol" }) {
	if (!state.list) return;
	html.push(`</${state.list}>`);
	state.list = "";
}

function checkboxStatus(mark: string) {
	if (mark === "~")
		return {
			icon: "…",
			label: "进行中",
			tone: "border-sky-300 bg-[var(--tone-blue-surface)] text-sky-800 dark:border-sky-700 dark:text-sky-300",
		};
	if (mark === "!")
		return {
			icon: "!",
			label: "阻塞",
			tone: "border-amber-300 bg-[var(--tone-amber-surface)] text-amber-800 dark:border-amber-700 dark:text-amber-300",
		};
	if (mark.trim())
		return {
			icon: "✓",
			label: "完成",
			tone: "border-emerald-300 bg-[var(--tone-green-surface)] text-emerald-800 dark:border-emerald-700 dark:text-emerald-300",
		};
	return {
		icon: "",
		label: "待做",
		tone: "border-stone-300 bg-[var(--report-surface)] text-transparent dark:border-stone-600",
	};
}

function checkboxItem(
	text: string,
	status: { icon: string; label: string; tone: string },
) {
	const label =
		status.label === "待做"
			? ""
			: `<span class="ml-2 text-xs text-stone-400 dark:text-stone-500">${status.label}</span>`;
	return `<li class="flex gap-2"><span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${status.tone}">${status.icon}</span><span>${inline(text)}${label}</span></li>`;
}

function codeBlock(text: string) {
	return `<pre class="overflow-auto bg-[var(--report-code)] p-4 text-xs leading-5 text-[var(--report-code-text)]"><code>${escapeHtml(text)}</code></pre>`;
}

export function inline(text: string) {
	return text
		.split(/(`[^`]+`)/gu)
		.map((part) =>
			part.startsWith("`") && part.endsWith("`")
				? `<code class="bg-[var(--report-surface-muted)] px-1.5 py-0.5 font-mono text-[0.85em] text-stone-800 dark:text-stone-200">${escapeHtml(part.slice(1, -1))}</code>`
				: inlineEmphasis(part),
		)
		.join("");
}

function inlineEmphasis(text: string) {
	return text
		.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/gu)
		.map((part) => {
			if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
				return `<strong class="font-semibold text-stone-900 dark:text-stone-100">${escapeHtml(part.slice(2, -2))}</strong>`;
			if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
				return `<em>${escapeHtml(part.slice(1, -1))}</em>`;
			return escapeHtml(part);
		})
		.join("");
}

function escapeHtml(value: string) {
	return cleanReportCopy(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
