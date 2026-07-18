import type { Language } from "./config.js";
import type { ConversationTurn } from "./context-evidence.js";
import { renderMarkdownBlock } from "./html-markdown.js";
import {
	CHIP,
	escapeHtml,
	escapeHtmlLiteral,
	TONE,
	type Tone,
	TYPE,
} from "./report-blocks.js";
import { type ReportIconName, reportIcon } from "./report-icons.js";

export function reportTranscript(
	turns: readonly ConversationTurn[],
	language: Language,
) {
	return `<div data-report-transcript class="space-y-5">${turns
		.map((turn) => transcriptTurn(turn, language))
		.join("")}</div>`;
}

function transcriptTurn(turn: ConversationTurn, language: Language) {
	const role = transcriptRole(turn.kind, language);
	const muted = turn.kind === "visible_supplement" ? " opacity-55" : "";
	const body =
		turn.kind === "assistant_final"
			? renderMarkdownBlock(
					turn.text,
					"space-y-2 text-sm leading-6 text-stone-700 dark:text-stone-300",
				)
			: `<p class="whitespace-pre-wrap text-sm leading-6 text-stone-700 dark:text-stone-300">${escapeHtmlLiteral(turn.text)}</p>`;
	return `<article data-transcript-turn data-transcript-kind="${turn.kind}" class="relative pl-5">
<span aria-hidden="true" class="absolute inset-y-0 left-0 w-0.5 rounded-full ${TONE[role.tone].dot}${muted}"></span>
<div data-transcript-role class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 ${TYPE.meta}">
<span class="inline-flex items-center gap-1.5 font-semibold text-stone-700 dark:text-stone-300"><span class="${TONE[role.tone].text}${muted}">${reportIcon(role.icon, "h-3.5 w-3.5")}</span><span>${role.label}</span></span>
<time datetime="${escapeHtml(turn.at)}" class="tabular-nums text-stone-400 dark:text-stone-500">${escapeHtml(displayTimestamp(turn.at, language))}</time>
</div>
<div data-transcript-body data-collapsed="true">${body}</div>
<button type="button" data-transcript-expand hidden aria-expanded="false" data-expand-label="${language === "en" ? "Show more" : "展开"}" data-collapse-label="${language === "en" ? "Show less" : "收起"}" class="mt-2 ${CHIP.soft} ${TONE.gray.soft} px-2.5 py-1 ${TYPE.meta} font-medium"><span data-transcript-expand-label>${language === "en" ? "Show more" : "展开"}</span></button>
</article>`;
}

function transcriptRole(
	kind: ConversationTurn["kind"],
	language: Language,
): { label: string; tone: Tone; icon: ReportIconName } {
	if (kind === "assistant_final")
		return {
			label: language === "en" ? "Assistant reply" : "助手回复",
			tone: "gray",
			icon: "bot",
		};
	return {
		label:
			kind === "visible_supplement"
				? language === "en"
					? "User addition"
					: "用户补充"
				: language === "en"
					? "User"
					: "用户",
		tone: "blue",
		icon: "chat",
	};
}

function displayTimestamp(value: string, language: Language) {
	const timestamp = new Date(value);
	if (Number.isNaN(timestamp.getTime())) return value;
	return timestamp.toLocaleString(language === "en" ? "en" : "zh-CN", {
		dateStyle: "medium",
		timeStyle: "short",
	});
}
