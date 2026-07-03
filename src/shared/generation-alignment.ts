import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	type GenerationAlign,
	type Language,
	readGenerationConfig,
} from "./config.js";
import { readPrompt } from "./prompts.js";

export type GenerationMode = "align" | "direct";
export type GenerationStage =
	| "aligning"
	| "awaiting_alignment_input"
	| "awaiting_final_confirm"
	| "generating"
	| "awaiting_blocking_input";

export interface GenerationStartOptions {
	mode: GenerationMode;
	autoStart: boolean;
}

export interface AlignmentTurn {
	question: string;
	answer: string;
}

export interface AlignmentPromptInput {
	kind: "goal" | "flow";
	language: Language;
	originalRequest: string;
	source: string;
	latestInput?: string;
	alignedRequest?: string;
	alignmentTurns?: AlignmentTurn[];
}

const ALIGN_OPTION = "先进行多轮问答对齐想法";
const DIRECT_OPTION = "跳过对齐，直接根据上下文生成计划";
const READY_TO_DRAFT_PATTERN = /<!--\s*pi-flow:ready-to-draft\s*-->/iu;
const NEED_INPUT_PATTERN = /<!--\s*pi-flow:need-input\s*-->/iu;
const ALIGNED_REQUEST_PATTERN =
	/<aligned-request>([\s\S]*?)<\/aligned-request>/iu;
const START_GENERATION_CONFIRMATIONS: Record<Language, string> = {
	zh: "开始生成",
	en: "Start generation",
};

export async function generationStartOptions(
	ctx: ExtensionCommandContext,
): Promise<GenerationStartOptions | undefined> {
	const config = readGenerationConfig();
	if (config.warning)
		ctx.ui.notify(`${config.warning}；已按 ask 处理。`, "warning");
	const align = effectiveAlign(config.align, ctx);
	if (align === "yes") return { mode: "align", autoStart: true };
	if (align === "no") return { mode: "direct", autoStart: true };
	const selected = await ctx.ui.select("生成计划前先对齐思路？", [
		ALIGN_OPTION,
		DIRECT_OPTION,
	]);
	if (!selected) return undefined;
	return {
		mode: selected === DIRECT_OPTION ? "direct" : "align",
		autoStart: true,
	};
}

export function buildAlignmentPrompt(input: AlignmentPromptInput) {
	const separator = input.language === "en" ? ":" : "：";
	const latest = input.latestInput
		? `\n\n${input.language === "en" ? "Latest user input" : "用户最新补充"}${separator}\n${input.latestInput}`
		: "";
	const turns = input.alignmentTurns?.length
		? `\n\n${input.language === "en" ? "Aligned Q&A" : "已对齐问答"}${separator}\n${formatAlignmentTurns(input.alignmentTurns)}`
		: "";
	const aligned = input.alignedRequest
		? `\n\n${input.language === "en" ? "Existing alignment summary" : "已有对齐摘要"}${separator}\n${input.alignedRequest}`
		: "";
	const originalRequest =
		input.originalRequest.trim() || defaultOriginalRequest(input.language);
	if (input.language === "en")
		return `${readPrompt("grilling", input.language)}\n\n---\n\nYou are aligning before draft generation.\n\nTarget: ${input.kind === "goal" ? "single Goal plan" : "multi-step Flow"}\nSource: ${input.source}\nCurrent language: ${input.language}\n\nOriginal request:\n${originalRequest}${turns}${aligned}${latest}\n\nRules:\n- This is the alignment phase. Do not write .flow files and do not modify product code.\n- Output language must use current language: ${input.language}. Use Chinese for zh and English for en.\n- Continue the questioning protocol above: ask exactly one question at a time and include your recommended answer.\n- If a question can be answered by reading the codebase, docs, or existing .flow files, inspect them yourself instead of asking the user.\n- If there is enough information, output a user-visible alignment summary and then include the marker <!-- pi-flow:ready-to-draft --> on its own.\n- Put the summary inside <aligned-request>...</aligned-request>; it is a review anchor, not the full source of truth.\n- Do not write a confirmation instruction after the summary; the plugin UI will show how to start generation.`;
	return `${readPrompt("grilling", input.language)}\n\n---\n\n你正在做生成前对齐。\n\n对象：${input.kind === "goal" ? "单目标计划" : "多步骤 Flow"}\n来源：${input.source}\n当前 language：${input.language}\n\n原始需求：\n${originalRequest}${turns}${aligned}${latest}\n\n规则：\n- 这是对齐阶段，禁止写 .flow，禁止修改业务代码。\n- 输出语言必须使用当前 language：${input.language}。zh 用中文；en 用英文。\n- 继续按上面的拷问规则一次只问一个问题，并给出你的推荐答案。\n- 如果问题能通过阅读代码库、文档或现有 .flow 文件回答，就自己查，不要问用户。\n- 如果信息已经足够，请输出对用户可见的对齐摘要，然后单独包含标记 <!-- pi-flow:ready-to-draft -->。\n- 摘要必须放在 <aligned-request>...</aligned-request> 中；它是核对锚点，不是完整事实源。\n- 摘要后不要写确认操作；插件 UI 会显示如何开始生成。`;
}

function defaultOriginalRequest(language: Language) {
	return language === "en"
		? "(no explicit argument; generate from the current conversation context)"
		: "（无显式参数；根据当前会话上下文生成）";
}

export function extractAlignmentQuestion(text: string) {
	return clipAlignmentText(
		text
			.replace(READY_TO_DRAFT_PATTERN, "")
			.replace(NEED_INPUT_PATTERN, "")
			.replace(ALIGNED_REQUEST_PATTERN, "")
			.trim(),
	);
}

export function formatAlignmentTurns(turns: AlignmentTurn[]) {
	return turns
		.slice(-8)
		.map(
			(turn, index) =>
				`Q${index + 1}: ${clipAlignmentText(turn.question)}\nA${index + 1}: ${clipAlignmentText(turn.answer)}`,
		)
		.join("\n");
}

function clipAlignmentText(text: string) {
	const compact = text.replace(/\s+/gu, " ").trim();
	return compact.length <= 800
		? compact
		: `${compact.slice(0, 800).trimEnd()}…`;
}

export function appendAlignedRequest(
	prompt: string,
	alignedRequest?: string,
	language: Language = "zh",
) {
	const trimmed = alignedRequest?.trim();
	if (!trimmed) return prompt;
	const label = language === "en" ? "Alignment summary" : "对齐摘要";
	const separator = language === "en" ? ":" : "：";
	return `${prompt}\n\n${label}${separator}\n${trimmed}`;
}

export function hasReadyToDraft(text: string) {
	return READY_TO_DRAFT_PATTERN.test(text);
}

export function hasNeedInput(text: string) {
	return NEED_INPUT_PATTERN.test(text);
}

export function extractAlignedRequest(text: string) {
	return ALIGNED_REQUEST_PATTERN.exec(text)?.[1]?.trim() ?? "";
}

export function startGenerationLabel(language: Language) {
	return START_GENERATION_CONFIRMATIONS[language];
}

export function generationAlignmentActivityCopy(
	stage: GenerationStage,
	language: Language,
	hasAlignmentTurns = false,
) {
	const start = startGenerationLabel(language);
	if (language === "en")
		return englishAlignmentActivityCopy(stage, start, hasAlignmentTurns);
	return chineseAlignmentActivityCopy(stage, start, hasAlignmentTurns);
}

export function generationAlignmentSummary(
	stage: GenerationStage,
	language: Language,
) {
	const start = startGenerationLabel(language);
	if (language === "en") return englishAlignmentSummary(stage, start);
	return chineseAlignmentSummary(stage, start);
}

export function isDraftConfirmation(text: string, language?: Language) {
	const trimmed = text.trim();
	return (
		trimmed === "Y" ||
		trimmed === "y" ||
		isStartGenerationConfirmation(trimmed, language)
	);
}

export function isStartGenerationConfirmation(
	text: string,
	language?: Language,
) {
	const normalized = normalizeConfirmation(text);
	if (language)
		return (
			normalized ===
			normalizeConfirmation(START_GENERATION_CONFIRMATIONS[language])
		);
	return Object.values(START_GENERATION_CONFIRMATIONS).some(
		(label) => normalized === normalizeConfirmation(label),
	);
}

function chineseAlignmentActivityCopy(
	stage: GenerationStage,
	start: string,
	hasAlignmentTurns: boolean,
) {
	if (stage === "aligning")
		return {
			phase: "对齐中",
			rows: hasAlignmentTurns ? "等待 AI 追问" : "等待 AI 提问",
		};
	if (stage === "awaiting_alignment_input")
		return {
			phase: "等待回复",
			rows: ["回答问题继续对齐", `回复「${start}」直接生成计划`],
		};
	if (stage === "awaiting_final_confirm")
		return {
			phase: "等待确认",
			rows: [`回复「${start}」生成计划`, "继续输入则补充对齐"],
		};
	if (stage === "awaiting_blocking_input")
		return { phase: "等待补充", rows: "回答当前问题后继续生成" };
	return { phase: "计划生成中", rows: [] };
}

function englishAlignmentActivityCopy(
	stage: GenerationStage,
	start: string,
	hasAlignmentTurns: boolean,
) {
	if (stage === "aligning")
		return {
			phase: "Aligning",
			rows: hasAlignmentTurns
				? "Waiting for AI follow-up"
				: "Waiting for AI to ask",
		};
	if (stage === "awaiting_alignment_input")
		return {
			phase: "Waiting for reply",
			rows: [
				"Continue alignment by answering the question",
				`Reply “${start}” to generate the plan directly`,
			],
		};
	if (stage === "awaiting_final_confirm")
		return {
			phase: "Waiting for confirmation",
			rows: [
				`Reply “${start}” to generate the plan`,
				"Any other input continues alignment",
			],
		};
	if (stage === "awaiting_blocking_input")
		return {
			phase: "Waiting for input",
			rows: "Answer the current question to continue generation",
		};
	return { phase: "Generating plan", rows: [] };
}

function chineseAlignmentSummary(stage: GenerationStage, start: string) {
	if (stage === "awaiting_alignment_input")
		return `回答问题继续对齐，或回复「${start}」直接生成计划。`;
	if (stage === "aligning") return "正在对齐，等待 AI 提问。";
	if (stage === "awaiting_final_confirm")
		return `对齐摘要已生成，回复「${start}」生成计划；继续输入则补充对齐。`;
	if (stage === "awaiting_blocking_input")
		return "生成被阻塞，回答当前问题后继续生成。";
	return "计划生成中。";
}

function englishAlignmentSummary(stage: GenerationStage, start: string) {
	if (stage === "awaiting_alignment_input")
		return `Continue alignment by answering the question, or reply “${start}” to generate the plan directly.`;
	if (stage === "aligning") return "Aligning; waiting for AI to ask.";
	if (stage === "awaiting_final_confirm")
		return `Alignment summary is ready. Reply “${start}” to generate the plan; any other input continues alignment.`;
	if (stage === "awaiting_blocking_input")
		return "Generation is blocked. Answer the current question to continue generation.";
	return "Generating plan.";
}

function normalizeConfirmation(text: string) {
	return text.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function effectiveAlign(
	align: GenerationAlign,
	ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
): GenerationAlign {
	if (align !== "ask") return align;
	return ctx.hasUI !== false && typeof ctx.ui.select === "function"
		? "ask"
		: "yes";
}
