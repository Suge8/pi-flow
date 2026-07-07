import {
	existsSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Language } from "./config.js";
import {
	type AlignmentTurn,
	extractAlignmentQuestion,
	type GenerationStage,
} from "./generation-alignment.js";
import { isRecord } from "./guards.js";

export interface AlignmentState {
	version: 1;
	stage: GenerationStage;
	sessionFile: string | null;
	autoStart: boolean;
	alignmentTurns: AlignmentTurn[];
	lastAlignmentQuestion: string | null;
	createdAt: number;
	updatedAt: number;
}

export function alignmentJsonPath(flowDir: string) {
	return join(flowDir, "alignment.json");
}

export function createAlignmentState(
	flowDir: string,
	input: {
		stage: GenerationStage;
		sessionFile: string | null;
		autoStart: boolean;
	},
) {
	const now = Date.now();
	return writeAlignmentState(flowDir, {
		version: 1,
		stage: input.stage,
		sessionFile: input.sessionFile,
		autoStart: input.autoStart,
		alignmentTurns: [],
		lastAlignmentQuestion: null,
		createdAt: now,
		updatedAt: now,
	});
}

export function readAlignmentState(flowDir: string): AlignmentState {
	return normalizeAlignmentState(
		JSON.parse(readFileSync(alignmentJsonPath(flowDir), "utf8")) as unknown,
	);
}

export function tryReadAlignmentState(flowDir: string) {
	try {
		if (!existsSync(alignmentJsonPath(flowDir))) return undefined;
		return readAlignmentState(flowDir);
	} catch {
		return undefined;
	}
}

export function writeAlignmentState(
	flowDir: string,
	alignment: AlignmentState,
) {
	const next = { ...alignment, updatedAt: Date.now() };
	const tmp = join(flowDir, "alignment.json.tmp");
	writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
	renameSync(tmp, alignmentJsonPath(flowDir));
	return next;
}

export function updateAlignmentState(
	flowDir: string,
	update: (alignment: AlignmentState) => AlignmentState,
) {
	return writeAlignmentState(flowDir, update(readAlignmentState(flowDir)));
}

export function deleteAlignmentState(flowDir: string) {
	rmSync(alignmentJsonPath(flowDir), { force: true });
}

function normalizeAlignmentState(value: unknown): AlignmentState {
	if (!isRecord(value)) throw new Error("alignment.json 必须是对象");
	const turns = Array.isArray(value.alignmentTurns)
		? value.alignmentTurns.map(normalizeAlignmentTurn)
		: [];
	return {
		version: 1,
		stage: normalizeStage(value.stage),
		sessionFile:
			typeof value.sessionFile === "string" ? value.sessionFile : null,
		autoStart: value.autoStart === true,
		alignmentTurns: turns,
		lastAlignmentQuestion:
			typeof value.lastAlignmentQuestion === "string"
				? value.lastAlignmentQuestion
				: null,
		createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : 0,
		updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : 0,
	};
}

function normalizeAlignmentTurn(value: unknown): AlignmentTurn {
	if (!isRecord(value)) return { question: "", answer: "" };
	return {
		question: typeof value.question === "string" ? value.question : "",
		answer: typeof value.answer === "string" ? value.answer : "",
	};
}

function normalizeStage(value: unknown): GenerationStage {
	if (
		value === "aligning" ||
		value === "awaiting_alignment_input" ||
		value === "awaiting_final_confirm" ||
		value === "generating" ||
		value === "awaiting_blocking_input"
	)
		return value;
	return "generating";
}

export function appendGenerationClarification(
	originalRequest: string,
	clarification: string,
	language: Language = "zh",
) {
	const base =
		originalRequest.trim() ||
		(language === "en"
			? "(user did not provide an initial request)"
			: "（用户未给出初始需求）");
	if (base.includes(clarification.trim())) return base;
	const label = language === "en" ? "User addition" : "用户补充";
	const separator = language === "en" ? ":" : "：";
	return `${base}\n\n${label}${separator}\n${clarification}`;
}

export function rememberAlignmentQuestion(
	pending: { lastAlignmentQuestion?: string | null },
	assistantText: string,
) {
	const question = extractAlignmentQuestion(assistantText);
	if (question) pending.lastAlignmentQuestion = question;
}

export function appendAlignmentAnswer(
	pending: {
		language: Language;
		alignmentTurns?: AlignmentTurn[];
		lastAlignmentQuestion?: string | null;
	},
	answer: string,
) {
	const question =
		pending.lastAlignmentQuestion ??
		(pending.language === "en" ? "User addition" : "用户补充");
	pending.alignmentTurns = [
		...(pending.alignmentTurns ?? []),
		{ question, answer },
	];
	pending.lastAlignmentQuestion = undefined;
}

export function generationDraftBox(
	title: string,
	rows: string | string[] = [],
) {
	const normalizedRows = Array.isArray(rows) ? rows : [rows];
	return {
		title,
		rows: separateRows(normalizedRows),
		compact: true,
	};
}

function separateRows(rows: string[]) {
	const separated: string[] = [];
	for (const row of rows) {
		if (row === "") {
			if (separated.at(-1) !== "") separated.push("");
			continue;
		}
		if (separated.length > 0 && separated.at(-1) !== "") separated.push("");
		separated.push(row);
	}
	return separated;
}
