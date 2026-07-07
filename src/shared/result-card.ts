import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { notifyCentered } from "./activity-frame.js";
import type { Language } from "./config.js";
import { formatError } from "./guards.js";
import { runtimeLanguage } from "./language.js";
import {
	formatUserNotice,
	localizeUserText,
	notifyUser,
} from "./ui-language.js";

export type ResultCardTone =
	| "goal-review"
	| "quality-review"
	| "success"
	| "neutral";
export type ResultWord = "通过" | "未通过" | "取消" | "错误" | "完成" | "启动";

export interface ResultCardDetails {
	tone: ResultCardTone;
	result: ResultWord;
	title: string;
	lines: string[];
	icon?: string;
	language?: Language;
}

export type ResultCardElapsedKind = "elapsed" | "totalElapsed";

export const RESULT_CARD_TYPE = "pi-flow-result-card";

export function composeResultCardLines(
	sections: readonly (readonly string[])[],
	footer: readonly string[] = [],
): string[] {
	const lines: string[] = [];
	for (const section of sections) appendResultCardSection(lines, section);
	appendResultCardSection(lines, footer);
	return lines;
}

export function resultCardElapsedLine(
	text: string,
	language: Language,
	kind: ResultCardElapsedKind = "elapsed",
) {
	if (language === "en")
		return kind === "totalElapsed"
			? `⏱ Total elapsed: ${text}`
			: `⏱ Elapsed: ${text}`;
	return kind === "totalElapsed" ? `⏱ 总用时：${text}` : `⏱ 用时：${text}`;
}

function appendResultCardSection(
	lines: string[],
	section: readonly string[],
): void {
	const trimmed = trimBlankEdges(section);
	if (trimmed.length === 0) return;
	if (lines.length > 0) lines.push("", "---", "");
	lines.push(...trimmed);
}

function trimBlankEdges(lines: readonly string[]) {
	let start = 0;
	let end = lines.length;
	while (start < end && lines[start] === "") start += 1;
	while (end > start && lines[end - 1] === "") end -= 1;
	return lines.slice(start, end);
}

export function registerResultCardRenderer(pi: ExtensionAPI) {
	pi.registerMessageRenderer<ResultCardDetails>(
		RESULT_CARD_TYPE,
		(message, _options, theme) => new ResultCard(message.details, theme),
	);
}

export function sendResultCard(
	pi: ExtensionAPI | undefined,
	ctx: Pick<ExtensionContext, "ui"> & {
		sendMessage?: ExtensionAPI["sendMessage"];
	},
	content: string,
	details: ResultCardDetails,
	options: { triggerTurn?: boolean; deliverAs?: "followUp" | "nextTurn" } = {},
) {
	const sendMessage = ctx.sendMessage ?? pi?.sendMessage?.bind(pi);
	const localizedDetails = resultCardDetails(details);
	if (!sendMessage) {
		notifyCentered(
			ctx as ExtensionContext,
			localizedDetails.title,
			levelFor(details.result),
		);
		return;
	}
	try {
		sendMessage(
			{
				customType: RESULT_CARD_TYPE,
				content: resultCardText(content, details.language),
				display: true,
				details: localizedDetails,
			},
			options,
		);
	} catch (error) {
		const language = details.language ?? runtimeLanguage();
		notifyUser(
			ctx,
			resultCardSendFailedNotice(formatError(error), language),
			"info",
			language,
		);
	}
}

function resultCardSendFailedNotice(error: string, language: Language) {
	return language === "en"
		? formatUserNotice("❌", "Result card send failed", [error])
		: formatUserNotice("❌", "结果卡片发送失败", [error]);
}

export const FINAL_REPLY_INSTRUCTION =
	"请基于上面的完成验收和质量检查，给用户一个简洁最终回复：说明完成了什么、验证了什么、剩余风险。不要继续改代码，除非发现检查结果与当前事实冲突。";

export function finalReplyInstruction(language: Language) {
	return language === "en"
		? "Based on the acceptance and quality checks above, give the user a concise final reply: explain what was completed, what was verified, and any remaining risks. Do not continue changing code unless the check results conflict with current facts."
		: FINAL_REPLY_INSTRUCTION;
}

class ResultCard implements Component {
	constructor(
		private readonly details: ResultCardDetails | undefined,
		private readonly theme: Theme,
	) {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const details = this.details ?? {
			tone: "neutral" as const,
			result: "完成" as const,
			title: "结果",
			lines: [],
		};
		const border = this.theme.fg(
			borderColor(details.tone),
			"─".repeat(safeWidth),
		);
		const title = ` ${details.icon ?? iconFor(details.result)} ${details.title} `;
		const top = fitTitle(title, safeWidth, (text) =>
			this.theme.fg(borderColor(details.tone), text),
		);
		const body = details.lines.length ? details.lines : [details.title];
		return [top, ...body.flatMap((line) => cardLines(line, safeWidth)), border];
	}

	invalidate(): void {}
}

function cardLines(line: string, width: number) {
	return line
		.split(/\r?\n/u)
		.flatMap((part) => wrapLine(plainCardLine(part), Math.max(1, width)))
		.map((item) => padLine(item, width));
}

function wrapLine(line: string, width: number) {
	if (!line) return [""];
	// truncateToWidth 截断时会追加 ANSI reset，返回值不是源前缀；
	// 按字符累积可见宽度切分，避免换行点丢字。
	const lines: string[] = [];
	let current = "";
	let currentWidth = 0;
	for (const char of line) {
		if (current === "" && lines.length > 0 && char === " ") continue;
		const charWidth = visibleWidth(char);
		if (charWidth > width) {
			if (current) lines.push(current);
			lines.push("…");
			current = "";
			currentWidth = 0;
			continue;
		}
		if (currentWidth + charWidth > width && current) {
			lines.push(current);
			current = "";
			currentWidth = 0;
			if (char === " ") continue;
		}
		current += char;
		currentWidth += charWidth;
	}
	lines.push(current);
	return lines;
}

function padLine(line: string, width: number) {
	return `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`;
}

function plainCardLine(line: string) {
	return line
		.replace(/^#{1,6}\s+/u, "")
		.replace(/^[-*]\s+/u, "• ")
		.replace(/^```[\w-]*$/u, "")
		.replace(/`([^`]+)`/gu, "$1");
}

function fitTitle(
	title: string,
	width: number,
	color: (text: string) => string,
) {
	if (width <= 0) return "";
	const visibleTitle = truncateToWidth(title, width, "…");
	const fillWidth = Math.max(0, width - visibleWidth(visibleTitle));
	const left = Math.floor(fillWidth / 2);
	const right = fillWidth - left;
	return `${color("─".repeat(left))}${visibleTitle}${color("─".repeat(right))}`;
}

function resultCardDetails(details: ResultCardDetails) {
	if (details.language) return details;
	return {
		...details,
		title: localizeUserText(details.title) ?? details.title,
		lines: details.lines.map((line) => localizeUserText(line) ?? line),
	};
}

function resultCardText(text: string, language: Language | undefined) {
	if (language) return text;
	return localizeUserText(text) ?? text;
}

function borderColor(tone: ResultCardTone) {
	if (tone === "quality-review") return "warning";
	if (tone === "success") return "success";
	if (tone === "neutral") return "muted";
	return "accent";
}

function iconFor(result: ResultWord) {
	if (result === "启动") return "🌊";
	if (result === "通过" || result === "完成") return "✅";
	if (result === "未通过") return "❌";
	if (result === "错误") return "🛑";
	return "⏸";
}

function levelFor(result: ResultWord) {
	if (result === "错误") return "error" as const;
	if (result === "未通过") return "warning" as const;
	return "info" as const;
}
