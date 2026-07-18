import {
	existsSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AlignmentDepth, Language } from "./config.js";
import {
	type AlignmentTurn,
	extractAlignmentQuestion,
	type GenerationStage,
} from "./generation-alignment.js";
import { isRecord } from "./guards.js";

const ALIGNMENT_STATE_FIELDS = new Set([
	"version",
	"stage",
	"sessionFile",
	"autoStart",
	"depth",
	"alignmentTurns",
	"lastAlignmentQuestion",
	"createdAt",
	"updatedAt",
]);
const ALIGNMENT_TURN_FIELDS = new Set(["question", "answer"]);
const GENERATION_STAGES = new Set<GenerationStage>([
	"aligning",
	"awaiting_alignment_input",
	"awaiting_final_confirm",
	"generating",
	"awaiting_blocking_input",
]);
const ALIGNMENT_DEPTHS = new Set<AlignmentDepth>([
	"coarse",
	"standard",
	"deep",
]);

export interface AlignmentState {
	version: 1;
	stage: GenerationStage;
	sessionFile: string | null;
	autoStart: boolean;
	depth: AlignmentDepth;
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
		depth: AlignmentDepth;
	},
) {
	const now = Date.now();
	return writeAlignmentState(flowDir, {
		version: 1,
		stage: input.stage,
		sessionFile: input.sessionFile,
		autoStart: input.autoStart,
		depth: input.depth,
		alignmentTurns: [],
		lastAlignmentQuestion: null,
		createdAt: now,
		updatedAt: now,
	});
}

export function readAlignmentState(flowDir: string): AlignmentState {
	return parseAlignmentState(
		JSON.parse(readFileSync(alignmentJsonPath(flowDir), "utf8")) as unknown,
	);
}

export function readAlignmentStateIfExists(flowDir: string) {
	if (!existsSync(alignmentJsonPath(flowDir))) return undefined;
	return readAlignmentState(flowDir);
}

export function writeAlignmentState(
	flowDir: string,
	alignment: AlignmentState,
) {
	const next = {
		...alignment,
		updatedAt: Math.max(Date.now(), alignment.updatedAt + 1),
	};
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

function parseAlignmentState(value: unknown): AlignmentState {
	if (!isRecord(value)) throw new Error("alignment.json 必须是对象");
	assertFields(value, ALIGNMENT_STATE_FIELDS, "alignment.json");
	if (value.version !== 1) throw new Error("alignment.json version 必须为 1");
	if (!isGenerationStage(value.stage))
		throw new Error("alignment.json stage 不受支持");
	if (typeof value.sessionFile !== "string" && value.sessionFile !== null)
		throw new Error("alignment.json sessionFile 必须是字符串或 null");
	if (typeof value.autoStart !== "boolean")
		throw new Error("alignment.json autoStart 必须是布尔值");
	if (!isAlignmentDepth(value.depth))
		throw new Error("alignment.json depth 必须是 coarse、standard 或 deep");
	if (!Array.isArray(value.alignmentTurns))
		throw new Error("alignment.json alignmentTurns 必须是数组");
	if (
		typeof value.lastAlignmentQuestion !== "string" &&
		value.lastAlignmentQuestion !== null
	)
		throw new Error("alignment.json lastAlignmentQuestion 必须是字符串或 null");
	if (!Number.isFinite(value.createdAt))
		throw new Error("alignment.json createdAt 必须是时间戳");
	if (!Number.isFinite(value.updatedAt))
		throw new Error("alignment.json updatedAt 必须是时间戳");
	return {
		version: 1,
		stage: value.stage,
		sessionFile: value.sessionFile,
		autoStart: value.autoStart,
		depth: value.depth,
		alignmentTurns: value.alignmentTurns.map(parseAlignmentTurn),
		lastAlignmentQuestion: value.lastAlignmentQuestion,
		createdAt: Number(value.createdAt),
		updatedAt: Number(value.updatedAt),
	};
}

function parseAlignmentTurn(value: unknown, index: number): AlignmentTurn {
	if (!isRecord(value))
		throw new Error(`alignment.json alignmentTurns[${index}] 必须是对象`);
	assertFields(
		value,
		ALIGNMENT_TURN_FIELDS,
		`alignment.json alignmentTurns[${index}]`,
	);
	if (typeof value.question !== "string")
		throw new Error(
			`alignment.json alignmentTurns[${index}].question 必须是字符串`,
		);
	if (typeof value.answer !== "string")
		throw new Error(
			`alignment.json alignmentTurns[${index}].answer 必须是字符串`,
		);
	return { question: value.question, answer: value.answer };
}

function isGenerationStage(value: unknown): value is GenerationStage {
	return GENERATION_STAGES.has(value as GenerationStage);
}

function isAlignmentDepth(value: unknown): value is AlignmentDepth {
	return ALIGNMENT_DEPTHS.has(value as AlignmentDepth);
}

function assertFields(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	path: string,
) {
	const field = Object.keys(value).find((key) => !allowed.has(key));
	if (field) throw new Error(`${path}.${field} 不受支持`);
}

export function appendGenerationClarification(
	requestText: string,
	clarification: string,
	language: Language = "zh",
) {
	const base =
		requestText.trim() ||
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
