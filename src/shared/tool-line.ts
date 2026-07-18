import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "./tui.js";
import { toolDisplayLabel } from "./ui-language.js";

export { toolDisplayLabel };

export interface ToolLinePart {
	text: string;
	color: ThemeColor;
}

export interface ToolLineLayout {
	prefix: ToolLinePart[];
	value: ToolLinePart[];
	metrics: ToolLinePart[];
	padding: number;
}

const ELLIPSIS = "…";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const CONNECTOR = /^(&&|\|\||\||;|↵)$/u;
const REDIRECT = /^\d*(>>?|<)$/u;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

export function pathToolParts(path: string, cwd: string, home: string) {
	const { value, suffix } = splitPathRange(path.trim());
	let display = value || ELLIPSIS;
	if (isWithin(display, cwd)) display = `./${display.slice(cwd.length + 1)}`;
	else if (isWithin(display, home))
		display = `~/${display.slice(home.length + 1)}`;
	const basenameAt = display.lastIndexOf("/") + 1;
	const parts: ToolLinePart[] = [];
	if (basenameAt > 0)
		parts.push({ text: display.slice(0, basenameAt), color: "muted" });
	parts.push({ text: display.slice(basenameAt) || ELLIPSIS, color: "accent" });
	if (suffix) parts.push({ text: suffix, color: "muted" });
	return parts;
}

export function commandToolParts(command: string, home: string) {
	let display = command
		.replace(/\r?\n/gu, " ↵ ")
		.replace(/[\t ]+/gu, " ")
		.trim();
	if (home) display = display.replaceAll(home, "~");
	if (!display)
		return [
			{ text: "$ ", color: "muted" },
			{ text: ELLIPSIS, color: "accent" },
		] satisfies ToolLinePart[];
	display = display
		.replace(/(&&|\|\||[|;]|(?:\d*>>?|\d*<))/gu, " $1 ")
		.replace(/[\t ]+/gu, " ")
		.trim();
	const parts: ToolLinePart[] = [{ text: "$ ", color: "muted" }];
	let expectsCommand = true;
	for (const token of display.split(" ")) {
		let color: ThemeColor = "text";
		if (CONNECTOR.test(token)) {
			color = "muted";
			expectsCommand = true;
		} else if (REDIRECT.test(token)) color = "muted";
		else if (expectsCommand && ENV_ASSIGNMENT.test(token)) color = "muted";
		else if (expectsCommand) {
			color = "accent";
			expectsCommand = false;
		}
		appendPart(parts, `${token} `, color);
	}
	const last = parts.at(-1);
	if (last) last.text = last.text.trimEnd();
	return parts;
}

export function toolValueParts(
	tool: string,
	args: string,
	cwd: string,
	home: string,
) {
	if (["read", "edit", "write"].includes(tool))
		return pathToolParts(args, cwd, home);
	if (tool === "bash") return commandToolParts(args, home);
	return [{ text: args || ELLIPSIS, color: "text" }] satisfies ToolLinePart[];
}

export function toolValueText(
	tool: string,
	args: string,
	cwd: string,
	home: string,
) {
	return toolValueParts(tool, args, cwd, home)
		.map((part) => part.text)
		.join("");
}

export function formatToolDuration(milliseconds: number) {
	if (milliseconds < 1000) return "";
	if (milliseconds < 10_000)
		return `${(Math.floor(milliseconds / 100) / 10).toFixed(1)}s`;
	const seconds = Math.floor(milliseconds / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatToolTokens(tokens: number) {
	return `${(Math.max(0, tokens) / 1000).toFixed(1)}k`;
}

export function clipToolParts(
	parts: readonly ToolLinePart[],
	width: number,
	from: "start" | "end",
): ToolLinePart[] {
	if (width <= 0) return [];
	if (toolPartsWidth(parts) <= width) return [...parts];
	const ordered = from === "start" ? [...parts].reverse() : [...parts];
	const kept: ToolLinePart[] = [];
	let used = 0;
	for (const part of ordered) {
		const partWidth = visibleWidth(part.text);
		if (used + partWidth <= width) {
			kept.push(part);
			used += partWidth;
			continue;
		}
		const room = width - used;
		if (room > 0)
			kept.push({
				...part,
				text: clipText(part.text, room, from),
			});
		break;
	}
	return from === "start" ? kept.reverse() : kept;
}

export function layoutToolLine(
	prefix: readonly ToolLinePart[],
	value: readonly ToolLinePart[],
	metrics: readonly ToolLinePart[],
	width: number,
	clipFrom: "start" | "end",
): ToolLineLayout {
	const safeWidth = Math.max(1, width);
	const prefixWidth = toolPartsWidth(prefix);
	if (prefixWidth >= safeWidth)
		return {
			prefix: clipToolParts(prefix, safeWidth, "end"),
			value: [],
			metrics: [],
			padding: 0,
		};
	const visibleMetrics = [...metrics];
	while (
		visibleMetrics.length > 0 &&
		safeWidth - prefixWidth - metricBlockWidth(visibleMetrics) < 8
	)
		visibleMetrics.pop();
	const reserved = metricBlockWidth(visibleMetrics);
	const valueWidth = Math.max(0, safeWidth - prefixWidth - reserved);
	const clippedValue = clipToolParts(value, valueWidth, clipFrom);
	const bodyWidth = prefixWidth + toolPartsWidth(clippedValue);
	const padding = visibleMetrics.length
		? Math.max(2, safeWidth - bodyWidth - metricsWidth(visibleMetrics))
		: 0;
	return {
		prefix: [...prefix],
		value: clippedValue,
		metrics: visibleMetrics,
		padding,
	};
}

export function paintToolParts(theme: Theme, parts: readonly ToolLinePart[]) {
	return parts.map((part) => theme.fg(part.color, part.text)).join("");
}

export function toolPartsWidth(parts: readonly ToolLinePart[]) {
	return parts.reduce((width, part) => width + visibleWidth(part.text), 0);
}

function metricBlockWidth(parts: readonly ToolLinePart[]) {
	return parts.length ? metricsWidth(parts) + 2 : 0;
}

function metricsWidth(parts: readonly ToolLinePart[]) {
	return toolPartsWidth(parts) + Math.max(0, parts.length - 1) * 3;
}

function splitPathRange(path: string) {
	const match = path.match(/(:\d+(?:-\d+|\+)?)$/u);
	if (!match || match.index === undefined) return { value: path, suffix: "" };
	return { value: path.slice(0, match.index), suffix: match[1] ?? "" };
}

function isWithin(value: string, parent: string) {
	return Boolean(parent && value.startsWith(`${parent}/`));
}

function appendPart(parts: ToolLinePart[], text: string, color: ThemeColor) {
	const last = parts.at(-1);
	if (last?.color === color) last.text += text;
	else parts.push({ text, color });
}

function clipText(text: string, width: number, from: "start" | "end") {
	if (visibleWidth(text) <= width) return text;
	if (width <= 1) return ELLIPSIS;
	const target = width - 1;
	const graphemes = [...segmenter.segment(text)].map((entry) => entry.segment);
	if (from === "end") {
		let output = "";
		let used = 0;
		for (const grapheme of graphemes) {
			const graphemeWidth = visibleWidth(grapheme);
			if (used + graphemeWidth > target) break;
			output += grapheme;
			used += graphemeWidth;
		}
		return `${output}${ELLIPSIS}`;
	}
	let output = "";
	let used = 0;
	for (let index = graphemes.length - 1; index >= 0; index -= 1) {
		const grapheme = graphemes[index] ?? "";
		const graphemeWidth = visibleWidth(grapheme);
		if (used + graphemeWidth > target) break;
		output = `${grapheme}${output}`;
		used += graphemeWidth;
	}
	return `${ELLIPSIS}${output}`;
}
