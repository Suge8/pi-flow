import {
	buildSessionContext,
	convertToLlm,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { clipText } from "./clip.js";
import type { Language } from "./config.js";
import { isRecord } from "./guards.js";

export interface TranscriptConfig {
	maxUser: number;
	maxAssistant: number;
	maxTranscript: number;
}

export type TranscriptOptions = TranscriptConfig;

interface TranscriptLine {
	role: "user" | "assistant";
	line: string;
}

export interface FileBuckets {
	modified: Set<string>;
	referenced: Set<string>;
}

const NATIVE_COMPACTION_STRATEGY = "openai-native-compact-v1";
const NATIVE_COMPACTION_SHIM_SUMMARY = "[OpenAI native compaction checkpoint]";
const MIN_RETAINED_ASSISTANTS = 1;

export function currentSessionFile(ctx: { sessionManager?: unknown }) {
	const sessionManager = ctx.sessionManager as
		| { getSessionFile?: () => string | undefined }
		| undefined;
	return sessionManager?.getSessionFile?.();
}

export function sessionEntries(ctx: {
	sessionManager?: unknown;
}): SessionEntry[] {
	if (!isRecord(ctx.sessionManager)) return [];
	const getBranch = ctx.sessionManager.getBranch;
	if (typeof getBranch !== "function") return [];
	const entries = getBranch.call(ctx.sessionManager);
	return Array.isArray(entries) ? (entries as SessionEntry[]) : [];
}

export function buildTranscript(
	entries: SessionEntry[],
	options: TranscriptConfig,
) {
	const maxUser = options.maxUser ?? options.maxTranscript;
	const lines: TranscriptLine[] = [];
	for (const message of convertToLlm(buildSessionContext(entries).messages)) {
		if (!isRecord(message)) continue;
		const role = message.role;
		if (role === "user") {
			const rawText = compact(textOf(message.content));
			const text = rawText.includes(NATIVE_COMPACTION_SHIM_SUMMARY)
				? nativeCompactionText(entries, options.maxTranscript)
				: rawText;
			if (!text) continue;
			lines.push({
				role: "user",
				line: `U: ${clipText(text, maxUser, "...")}`,
			});
		}
		if (role === "assistant") {
			const stopReason =
				typeof message.stopReason === "string" ? message.stopReason : "stop";
			if (stopReason === "toolUse") continue;
			const text = compact(textOf(message.content));
			if (!text) continue;
			const label = stopReason === "stop" ? "A" : `A(${stopReason})`;
			lines.push({
				role: "assistant",
				line: `${label}: ${clipText(text, options.maxAssistant, "...")}`,
			});
		}
	}
	return trimTranscript(lines, options.maxTranscript);
}

export function buildFilesSection(
	entries: SessionEntry[],
	language: Language = "zh",
) {
	const files = collectFiles(entries);
	const modifiedNote =
		language === "en"
			? "Paths recorded from edit/write calls in the session, including Cursor Write/Edit/StrReplace. Files changed by bash will not appear here; verify manually when needed."
			: "来自会话中 edit/write（含 Cursor 的 Write/Edit/StrReplace）记录的路径；bash 改文件不会出现在此列表，必要时自行验证。";
	const label = fileSectionCopy(language);
	return [
		`${label.modified}:\n${modifiedNote}\n${formatFiles(files.modified, language)}`,
		`${label.referenced}:\n${formatFiles(files.referenced, language)}`,
	].join("\n\n");
}

function collectFiles(entries: SessionEntry[]): FileBuckets {
	const files: FileBuckets = { modified: new Set(), referenced: new Set() };
	for (const entry of entries) {
		if (
			!isRecord(entry) ||
			entry.type !== "message" ||
			!isRecord(entry.message) ||
			entry.message.role !== "assistant"
		)
			continue;
		for (const call of toolCalls(entry.message.content))
			collectToolFiles(call, files);
	}
	return files;
}

const MODIFY_TOOL_NAMES = new Set([
	"edit",
	"write",
	"Write",
	"Edit",
	"StrReplace",
]);
const REFERENCE_TOOL_NAMES = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"Read",
	"Grep",
	"Glob",
	"LS",
]);

function collectToolFiles(call: Record<string, unknown>, files: FileBuckets) {
	const args = isRecord(call.arguments) ? call.arguments : {};
	const name = String(call.name ?? "");
	if (MODIFY_TOOL_NAMES.has(name))
		return addPath(files.modified, getPathArg(args));
	if (REFERENCE_TOOL_NAMES.has(name))
		addPath(files.referenced, getPathArg(args));
}

function toolCalls(content: unknown) {
	return (Array.isArray(content) ? content : []).filter(
		(part): part is Record<string, unknown> =>
			isRecord(part) && part.type === "toolCall",
	);
}

function getPathArg(args: Record<string, unknown>) {
	for (const key of [
		"path",
		"file_path",
		"filePath",
		"file",
		"target",
		"directory",
		"cwd",
	]) {
		const value = args[key];
		if (typeof value === "string" && looksLikePath(value)) return value;
	}
	return "";
}

function addPath(files: Set<string>, path: string) {
	if (path) files.add(path);
}

function formatFiles(files: Set<string>, language: Language) {
	return (
		Array.from(files).sort().slice(0, 80).join("\n") ||
		(language === "en" ? "None detected" : "未检测到")
	);
}

function fileSectionCopy(language: Language) {
	return language === "en"
		? { modified: "Modified files", referenced: "Referenced files" }
		: { modified: "修改文件", referenced: "引用文件" };
}

function trimTranscript(lines: TranscriptLine[], maxTranscript: number) {
	const firstUserIndex = lines.findIndex((line) => line.role === "user");
	if (firstUserIndex === -1)
		return trimUnpinnedTranscript(lines, maxTranscript);
	const firstUser = clipLine(lines[firstUserIndex], maxTranscript);
	if (!firstUser.line || firstUser.line.length >= maxTranscript)
		return joinTranscript([firstUser]);
	const remaining = maxTranscript - firstUser.line.length - 1;
	const tail = lines.filter((_line, index) => index !== firstUserIndex);
	const recent = trimUnpinnedTranscript(tail, remaining);
	return recent ? `${firstUser.line}\n${recent}` : firstUser.line;
}

function trimUnpinnedTranscript(
	lines: TranscriptLine[],
	maxTranscript: number,
) {
	const withoutOldAssistants = dropOldAssistantLines(lines, maxTranscript);
	if (transcriptSize(withoutOldAssistants) <= maxTranscript)
		return joinTranscript(withoutOldAssistants);
	return trimByRecency(withoutOldAssistants, maxTranscript);
}

function clipLine(line: TranscriptLine, maxLength: number): TranscriptLine {
	return { ...line, line: clipText(line.line, maxLength, "...") };
}

function dropOldAssistantLines(lines: TranscriptLine[], maxTranscript: number) {
	const kept = [...lines];
	let assistantCount = kept.filter((line) => line.role === "assistant").length;
	let size = transcriptSize(kept);
	while (size > maxTranscript && assistantCount > MIN_RETAINED_ASSISTANTS) {
		const index = kept.findIndex((line) => line.role === "assistant");
		if (index === -1) break;
		size -= kept[index].line.length;
		if (kept.length > 1) size -= 1;
		kept.splice(index, 1);
		assistantCount -= 1;
	}
	return kept;
}

function trimByRecency(lines: TranscriptLine[], maxTranscript: number) {
	const kept: TranscriptLine[] = [];
	let size = 0;
	for (let index = lines.length - 1; index >= 0; index--) {
		const separator = kept.length === 0 ? 0 : 1;
		const remaining = maxTranscript - size - separator;
		if (remaining <= 0) break;
		const line = lines[index];
		if (line.line.length <= remaining) {
			kept.unshift(line);
			size += line.line.length + separator;
			continue;
		}
		const clipped = clipText(line.line, remaining, "...");
		if (clipped) kept.unshift({ ...line, line: clipped });
		break;
	}
	return joinTranscript(kept);
}

function transcriptSize(lines: TranscriptLine[]) {
	return lines.reduce(
		(size, line, index) => size + line.line.length + (index === 0 ? 0 : 1),
		0,
	);
}

function joinTranscript(lines: TranscriptLine[]) {
	return lines.map((line) => line.line).join("\n");
}

function nativeCompactionText(entries: SessionEntry[], maxLength: number) {
	const details = latestNativeCompactionDetails(entries);
	if (!details) return NATIVE_COMPACTION_SHIM_SUMMARY;
	const text = compact(textFromNativeCompactedWindow(details.compactedWindow));
	if (!text)
		return "OpenAI native compaction checkpoint: compacted window has no readable text.";
	return clipText(`OpenAI native compaction: ${text}`, maxLength, "...");
}

function latestNativeCompactionDetails(entries: SessionEntry[]) {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (!isRecord(entry) || entry.type !== "compaction") continue;
		const details = entry.details;
		if (!isRecord(details)) continue;
		if (details.strategy !== NATIVE_COMPACTION_STRATEGY) continue;
		return Array.isArray(details.compactedWindow)
			? { compactedWindow: details.compactedWindow }
			: undefined;
	}
}

function textFromNativeCompactedWindow(items: unknown[]) {
	return items.flatMap(textFragments).join("\n");
}

function textFragments(value: unknown): string[] {
	if (typeof value === "string") return [];
	if (Array.isArray(value)) return value.flatMap(textFragments);
	if (!isRecord(value)) return [];
	const ownText = typeof value.text === "string" ? [value.text] : [];
	const contentText =
		typeof value.content === "string"
			? [value.content]
			: textFragments(value.content);
	return [...ownText, ...contentText];
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part) =>
				isRecord(part) && part.type === "text" && typeof part.text === "string",
		)
		.map((part) => (part as { text: string }).text)
		.join("\n");
}

function looksLikePath(value: string) {
	const path = value.trim();
	if (!path || path.length > 240 || /\s|\n/.test(path)) return false;
	if ([".", "..", "-", "--"].includes(path)) return false;
	return true;
}

function compact(text: string) {
	return text.replace(/\s+/g, " ").trim();
}
