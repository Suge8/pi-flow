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
	kind: "flow";
	language: Language;
	originalRequest: string;
	source: string;
}

export interface AlignmentFollowUpPromptInput {
	language: Language;
}

const ALIGN_OPTION = "先进行多轮问答对齐想法";
const DIRECT_OPTION = "跳过对齐，直接根据上下文生成计划";
const READY_TO_DRAFT_PATTERN = /<!--\s*pi-flow:ready-to-draft\s*-->/iu;
const NEED_INPUT_PATTERN = /<!--\s*pi-flow:need-input\s*-->/iu;
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
	const originalRequest =
		input.originalRequest.trim() || defaultOriginalRequest(input.language);
	if (input.language === "en")
		return `${readPrompt("grilling", input.language)}\n\n---\n\nYou are aligning before draft generation.\n\nTarget: Flow plan\nSource: ${input.source}\nCurrent language: ${input.language}\n\nOriginal request:\n${originalRequest}\n\nRules:\n- This is the alignment phase. Do not write .flow files and do not modify product code.\n- Output language must use current language: ${input.language}. Use Chinese for zh and English for en.\n- Follow the questioning protocol above without turning each round into a full decision-tree report.\n- Only output the ready marker <!-- pi-flow:ready-to-draft --> on its own after all decisions that affect implementation scope, implementation details, requirements, prompt semantics, state source of truth, and test verification are aligned.\n- Do not write a confirmation instruction after the marker; the plugin UI will show how to start generation.`;
	return `${readPrompt("grilling", input.language)}\n\n---\n\n你正在做生成前对齐。\n\n对象：Flow 计划\n来源：${input.source}\n当前 language：${input.language}\n\n原始需求：\n${originalRequest}\n\n规则：\n- 这是对齐阶段，禁止写 .flow，禁止修改业务代码。\n- 输出语言必须使用当前 language：${input.language}。zh 用中文；en 用英文。\n- 遵循上面的拷问规则，不要把每轮回复写成完整决策树报告。\n- 只有所有会影响实现范围、实现细节、需求、提示词语义、状态事实源、测试验证的决策都已对齐，才单独输出 ready marker <!-- pi-flow:ready-to-draft -->。\n- marker 后不要写确认操作；插件 UI 会显示如何开始生成。`;
}

export function buildAlignmentFollowUpPrompt(
	input: AlignmentFollowUpPromptInput,
) {
	if (input.language === "en")
		return `Continue Flow alignment.

Rules:
- This is still the alignment phase. Do not write .flow files and do not modify product code.
- Use the visible conversation as context; do not restate a full decision-tree report.
- Before asking, inspect the codebase, docs, or existing .flow files when facts there can reduce uncertainty.
- Ask exactly one concise question, provide 2-4 concrete options, mark your recommendation based on the project, requirements, and best practices, and explain why.
- Only when all decisions affecting implementation scope, implementation details, requirements, prompt semantics, state source of truth, and test verification are aligned, output only the ready marker <!-- pi-flow:ready-to-draft --> on its own.
- Do not write a confirmation instruction after the marker; the plugin UI will show how to start generation.`;
	return `继续 Flow 生成前对齐。

规则：
- 仍处于对齐阶段，禁止写 .flow，禁止修改业务代码。
- 以上下文里的可见会话为背景；不要把每轮回复写成完整决策树报告。
- 提问前，如果代码库、文档或现有 .flow 文件能减少不确定性，先探索事实源。
- 一次只问一个简洁问题，给出 2-4 个具体选项，基于项目、需求和最佳实践标出推荐，并说明理由。
- 只有所有会影响实现范围、实现细节、需求、提示词语义、状态事实源、测试验证的决策都已对齐，才单独输出 ready marker <!-- pi-flow:ready-to-draft -->。
- marker 后不要写确认操作；插件 UI 会显示如何开始生成。`;
}

function defaultOriginalRequest(language: Language) {
	return language === "en"
		? "(no explicit argument; generate from the current conversation context)"
		: "（无显式参数；根据当前会话上下文生成）";
}

export function extractAlignmentQuestion(text: string) {
	return text
		.replace(READY_TO_DRAFT_PATTERN, "")
		.replace(NEED_INPUT_PATTERN, "")
		.trim();
}

export function hasReadyToDraft(text: string) {
	return READY_TO_DRAFT_PATTERN.test(text);
}

export function hasNeedInput(text: string) {
	return NEED_INPUT_PATTERN.test(text);
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
		return `对齐已完成，回复「${start}」生成计划；继续输入则补充对齐。`;
	if (stage === "awaiting_blocking_input")
		return "生成被阻塞，回答当前问题后继续生成。";
	return "计划生成中。";
}

function englishAlignmentSummary(stage: GenerationStage, start: string) {
	if (stage === "awaiting_alignment_input")
		return `Continue alignment by answering the question, or reply “${start}” to generate the plan directly.`;
	if (stage === "aligning") return "Aligning; waiting for AI to ask.";
	if (stage === "awaiting_final_confirm")
		return `Alignment is ready. Reply “${start}” to generate the plan; any other input continues alignment.`;
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
