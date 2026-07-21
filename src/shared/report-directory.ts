import { basename, isAbsolute, relative, sep } from "node:path";
import type { Language } from "./config.js";
import { copy } from "./copy.js";
import {
	card,
	escapeHtml,
	pageShell,
	statusText,
	TYPE,
} from "./report-blocks.js";
import { isCapability, type ReportLifecycleState } from "./report-protocol.js";

const FLOW_ID = /^F[1-9]\d*$/u;
const REVIEW_FILE = /^[^/\\]+\.html$/u;

export const DIRECTORY_SCHEMA_VERSION = 1;
export const DIRECTORY_RECENT_LIMIT = 50;

export type DirectoryKind = "flow" | "review";

export interface DirectoryRecord {
	cap: string;
	cwd: string;
	path: string;
	realPath: string;
	state: ReportLifecycleState;
	generation: number;
	updatedAt: number;
	kind: DirectoryKind;
	label: string;
	available: boolean;
}

export interface DirectoryLedger {
	version: typeof DIRECTORY_SCHEMA_VERSION;
	records: DirectoryRecord[];
}

export function parseDirectoryLedger(
	value: unknown,
): DirectoryLedger | undefined {
	if (!isRecord(value) || !exactRecord(value, ["version", "records"]))
		return undefined;
	if (value.version !== DIRECTORY_SCHEMA_VERSION) return undefined;
	if (!Array.isArray(value.records)) return undefined;
	const records: DirectoryRecord[] = [];
	const caps = new Set<string>();
	const realPaths = new Set<string>();
	for (const item of value.records) {
		const record = parseDirectoryRecord(item);
		if (!record) return undefined;
		if (caps.has(record.cap) || realPaths.has(record.realPath))
			return undefined;
		caps.add(record.cap);
		realPaths.add(record.realPath);
		records.push(record);
	}
	return { version: DIRECTORY_SCHEMA_VERSION, records };
}

export function parseDirectoryRecord(
	value: unknown,
): DirectoryRecord | undefined {
	if (
		!exactRecord(value, [
			"cap",
			"cwd",
			"path",
			"realPath",
			"state",
			"generation",
			"updatedAt",
			"kind",
			"label",
			"available",
		])
	)
		return undefined;
	if (
		typeof value.cap !== "string" ||
		typeof value.cwd !== "string" ||
		typeof value.path !== "string" ||
		typeof value.realPath !== "string" ||
		typeof value.label !== "string" ||
		typeof value.available !== "boolean"
	)
		return undefined;
	if (!isCapability(value.cap)) return undefined;
	if (
		!isAbsolute(value.cwd) ||
		!isAbsolute(value.path) ||
		!isAbsolute(value.realPath)
	)
		return undefined;
	if (value.state !== "live" && value.state !== "complete") return undefined;
	if (value.kind !== "flow" && value.kind !== "review") return undefined;
	if (!positiveSafeInteger(value.generation)) return undefined;
	if (
		typeof value.updatedAt !== "number" ||
		!Number.isFinite(value.updatedAt) ||
		!Number.isInteger(value.updatedAt) ||
		value.updatedAt < 0
	)
		return undefined;
	const pathIdentity = directoryPathIdentity(value.cwd, value.path);
	if (
		!pathIdentity ||
		pathIdentity.kind !== value.kind ||
		pathIdentity.label !== value.label
	)
		return undefined;
	// realPath 若仍落在 cwd 下必须同身份；越界（symlink 解析）只要求绝对路径已通过。
	const realIdentity = directoryPathIdentity(value.cwd, value.realPath);
	if (
		realIdentity &&
		(realIdentity.kind !== value.kind || realIdentity.label !== value.label)
	)
		return undefined;
	return value as unknown as DirectoryRecord;
}

/** 从 cwd+绝对路径推导目录身份；路径越界或不匹配两类精确 HTML 形状时返回 undefined。 */
export function directoryPathIdentity(
	cwd: string,
	path: string,
): { kind: DirectoryKind; label: string } | undefined {
	if (!isAbsolute(cwd) || !isAbsolute(path)) return undefined;
	const relativePath = relative(cwd, path);
	if (
		!relativePath ||
		relativePath.startsWith(`..${sep}`) ||
		relativePath === ".."
	)
		return undefined;
	const parts = relativePath.split(sep);
	if (parts.length === 3 && parts[0] === ".flow") {
		if (FLOW_ID.test(parts[1] ?? "") && parts[2] === "flow.html")
			return { kind: "flow", label: parts[1] ?? "" };
		if (parts[1] === "reviews" && REVIEW_FILE.test(parts[2] ?? ""))
			return {
				kind: "review",
				label: reviewReportLabel(parts[2] ?? basename(path)),
			};
	}
	return undefined;
}

export function trimDirectoryRecords(
	records: readonly DirectoryRecord[],
): DirectoryRecord[] {
	const live = records
		.filter((record) => record.state === "live")
		.sort(byUpdatedDesc);
	const recent = records
		.filter((record) => record.state === "complete")
		.sort(byUpdatedDesc)
		.slice(0, DIRECTORY_RECENT_LIMIT);
	return [...live, ...recent];
}

export function directoryIdentity(
	kind: DirectoryKind,
	label: string,
): { kind: DirectoryKind; label: string } {
	return { kind, label };
}

export function reviewReportLabel(path: string) {
	return basename(path).replace(/\.html$/u, "");
}

export function renderReportDirectory(
	records: readonly DirectoryRecord[],
	language: Language = "zh",
) {
	const t = copy(language);
	const live = records
		.filter((record) => record.state === "live")
		.sort(byUpdatedDesc);
	const recent = records
		.filter((record) => record.state === "complete")
		.sort(byUpdatedDesc);
	const body = [
		`<header class="space-y-1 px-1">
<h1 class="font-serif text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">${escapeHtml(t.reportDirectoryTitle)}</h1>
<p class="${TYPE.meta} text-stone-500 dark:text-stone-400">${escapeHtml(t.reportDirectoryHint)}</p>
</header>`,
		section(t.reportDirectoryLive, live, language, true),
		section(t.reportDirectoryRecent, recent, language, false),
	].join("\n");
	return pageShell(t.reportDirectoryTitle, body, {
		language,
		width: "max-w-3xl",
	});
}

function section(
	title: string,
	records: readonly DirectoryRecord[],
	language: Language,
	live: boolean,
) {
	const empty =
		language === "en"
			? live
				? "No live reports"
				: "No recent reports"
			: live
				? "暂无进行中的报告"
				: "暂无最近报告";
	const list =
		records.length === 0
			? `<p class="${TYPE.meta} px-1 text-stone-400 dark:text-stone-500">${escapeHtml(empty)}</p>`
			: `<ul class="space-y-2">${records.map((record) => row(record, language)).join("")}</ul>`;
	return `<section class="space-y-2">
<div class="flex items-baseline justify-between gap-3 px-1">
<h2 class="text-sm font-semibold uppercase tracking-[0.14em] text-stone-500 dark:text-stone-400">${escapeHtml(title)}</h2>
<span class="${TYPE.meta} tabular-nums text-stone-400 dark:text-stone-500">${records.length}</span>
</div>
${list}
</section>`;
}

function row(record: DirectoryRecord, language: Language) {
	const kindLabel =
		record.kind === "flow"
			? `${language === "en" ? "Flow" : "Flow"} ${record.label}`
			: `${language === "en" ? "Review" : "质检"} ${record.label}`;
	const stateLabel =
		record.state === "live"
			? language === "en"
				? "In progress"
				: "进行中"
			: language === "en"
				? "Complete"
				: "已完成";
	const unavailable = language === "en" ? "Unavailable" : "不可用";
	const updated = formatUpdatedAt(record.updatedAt, language);
	const meta = `<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
<span class="text-sm font-semibold text-stone-900 dark:text-stone-100">${escapeHtml(kindLabel)}</span>
${statusText(stateLabel, record.state === "live" ? "blue" : "green")}
${record.available ? "" : statusText(unavailable, "gray")}
</div>
<p class="break-words font-mono ${TYPE.meta} leading-relaxed text-stone-500 dark:text-stone-400">${escapeHtml(record.cwd)}</p>
<p class="${TYPE.micro} tabular-nums text-stone-400 dark:text-stone-500">${escapeHtml(updated)}</p>`;
	const body = card(meta, {
		tone: record.available
			? record.state === "live"
				? "blue"
				: "green"
			: "gray",
	});
	if (!record.available) return `<li>${body}</li>`;
	return `<li><a href="/r/${encodeURIComponent(record.cap)}/" class="block rounded-[inherit] transition-transform duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:focus-visible:ring-sky-700">${body}</a></li>`;
}

function formatUpdatedAt(value: number, language: Language) {
	try {
		return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		}).format(value);
	} catch {
		return new Date(value).toISOString();
	}
}

function byUpdatedDesc(left: DirectoryRecord, right: DirectoryRecord) {
	if (right.updatedAt !== left.updatedAt)
		return right.updatedAt - left.updatedAt;
	return right.generation - left.generation;
}

function exactRecord(
	value: unknown,
	keys: string[],
): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
