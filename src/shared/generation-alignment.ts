import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	type AlignmentDepth,
	type GenerationAlign,
	type Language,
	readGenerationConfig,
} from "./config.js";
import { runtimeLanguage } from "./language.js";
import { readPrompt } from "./prompts.js";
import { formatUserNotice, notifyUser } from "./ui-language.js";

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
	depth?: AlignmentDepth;
}

export interface AlignmentTurn {
	question: string;
	answer: string;
}

export interface AlignmentPromptInput {
	kind: "flow";
	language: Language;
	requestText: string;
	source: string;
	depth?: AlignmentDepth;
}

export interface AlignmentFollowUpPromptInput {
	language: Language;
	depth?: AlignmentDepth;
}

const DIRECT_OPTION = "跳过对齐，直接根据上下文生成计划";
const COARSE_OPTION = "粗对齐：约 10 问内，高杠杆问题优先";
const STANDARD_OPTION = "标准对齐：约 20-30 问，高杠杆 + 关键实现决策";
const DEEP_OPTION = "深度对齐：不设硬上限，高杠杆问题优先";
const DEPTH_OPTIONS: Record<string, AlignmentDepth> = {
	[COARSE_OPTION]: "coarse",
	[STANDARD_OPTION]: "standard",
	[DEEP_OPTION]: "deep",
};
const DEPTH_BUDGETS: Record<AlignmentDepth, number | undefined> = {
	coarse: 10,
	standard: 30,
	deep: undefined,
};
const READY_TO_DRAFT_PATTERN = /<!--\s*pi-flow:ready-to-draft\s*-->/iu;
const NEED_INPUT_PATTERN = /<!--\s*pi-flow:need-input\s*-->/iu;

export async function generationStartOptions(
	ctx: ExtensionCommandContext,
): Promise<GenerationStartOptions | undefined> {
	const config = readGenerationConfig();
	if (config.warning) {
		const language = runtimeLanguage();
		notifyUser(
			ctx,
			generationConfigWarningNotice(config.warning, language),
			"info",
			language,
		);
	}
	const align = effectiveAlign(config.align, ctx);
	if (align === "no") return { mode: "direct", autoStart: true };
	if (align !== "ask") return { mode: "align", depth: align, autoStart: true };
	const selected = await ctx.ui.select("生成计划前先对齐思路？", [
		DIRECT_OPTION,
		COARSE_OPTION,
		STANDARD_OPTION,
		DEEP_OPTION,
	]);
	if (!selected) return undefined;
	if (selected === DIRECT_OPTION) return { mode: "direct", autoStart: true };
	return {
		mode: "align",
		depth: DEPTH_OPTIONS[selected] ?? "standard",
		autoStart: true,
	};
}

function generationConfigWarningNotice(warning: string, language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Generation config fallback", [
				warning,
				"Handled as ask",
			])
		: formatUserNotice("⚠️", "生成配置已回退", [warning, "已按 ask 处理"]);
}

export function questionBudgetCopy(depth: AlignmentDepth, language: Language) {
	if (language === "en") {
		if (depth === "coarse") return "about 10 questions at most";
		if (depth === "deep") return "no hard cap";
		return "about 20-30 questions";
	}
	if (depth === "coarse") return "约 10 问以内";
	if (depth === "deep") return "不设硬上限";
	return "约 20-30 问";
}

function grillingProtocol(language: Language, depth: AlignmentDepth) {
	return readPrompt("grilling", language).replaceAll(
		"{{questionBudget}}",
		questionBudgetCopy(depth, language),
	);
}

export function buildAlignmentPrompt(input: AlignmentPromptInput) {
	const requestText =
		input.requestText.trim() || defaultRequestText(input.language);
	const protocol = grillingProtocol(input.language, input.depth ?? "standard");
	if (input.language === "en")
		return `${protocol}\n\n---\n\nYou are aligning before draft generation.\n\nTarget: Flow plan\nSource: ${input.source}\nCurrent language: ${input.language}\n\nOriginal request:\n${requestText}\n\nRules:\n- This is the alignment phase. Do not write .flow files and do not modify product code.\n- Output language must use current language: ${input.language}. Use Chinese for zh and English for en.\n- Follow the questioning protocol above without turning each round into a full decision-tree report.\n- Follow the convergence rule above; only then output the ready marker <!-- pi-flow:ready-to-draft --> on its own.\n- Do not write a confirmation instruction after the marker; the plugin UI will show the next command.`;
	return `${protocol}\n\n---\n\n你正在做生成前对齐。\n\n对象：Flow 计划\n来源：${input.source}\n当前 language：${input.language}\n\n原始需求：\n${requestText}\n\n规则：\n- 这是对齐阶段，禁止写 .flow，禁止修改业务代码。\n- 输出语言必须使用当前 language：${input.language}。zh 用中文；en 用英文。\n- 遵循上面的拷问规则，不要把每轮回复写成完整决策树报告。\n- 遵循上面的收敛规则；完成收敛后，才单独输出 ready marker <!-- pi-flow:ready-to-draft -->。\n- marker 后不要写确认操作；插件 UI 会显示下一步命令。`;
}

export function buildAlignmentFollowUpPrompt(
	input: AlignmentFollowUpPromptInput,
) {
	const budget = questionBudgetCopy(input.depth ?? "standard", input.language);
	if (input.language === "en")
		return `Continue Flow alignment; do not write .flow files or modify product code.

Question budget: ${budget}.
Follow the initial questioning protocol: inspect facts first, prioritize high-leverage questions, and do not ask minor decisions that can take a reasonable default.
After convergence, output the assumption list and end with the ready marker <!-- pi-flow:ready-to-draft --> on its own line.`;
	return `继续 Flow 生成前对齐；禁止写 .flow 或修改业务代码。

问题预算：${budget}。
遵循首次拷问协议：先查事实，高杠杆问题优先，可合理默认的次要决策不要问。
满足收敛条件后，输出假设清单，再以 ready marker <!-- pi-flow:ready-to-draft --> 单独一行结束。`;
}

function defaultRequestText(language: Language) {
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

export function generationAlignmentActivityCopy(
	stage: GenerationStage,
	language: Language,
	questionNumber = 1,
	goCommand = "/flow go <id>",
	depth: AlignmentDepth = "standard",
) {
	if (language === "en")
		return englishAlignmentActivityCopy(
			stage,
			goCommand,
			questionNumber,
			depth,
		);
	return chineseAlignmentActivityCopy(stage, goCommand, questionNumber, depth);
}

export function generationAlignmentSummary(
	stage: GenerationStage,
	language: Language,
	questionNumber = 1,
	goCommand = "/flow go <id>",
	depth: AlignmentDepth = "standard",
) {
	if (language === "en")
		return englishAlignmentSummary(stage, goCommand, questionNumber, depth);
	return chineseAlignmentSummary(stage, goCommand, questionNumber, depth);
}

function questionProgress(questionNumber: number, depth: AlignmentDepth) {
	const budget = DEPTH_BUDGETS[depth];
	return budget ? `Q${questionNumber} / ~${budget}` : `Q${questionNumber}`;
}

function englishQuestionProgress(
	questionNumber: number,
	depth: AlignmentDepth,
) {
	const budget = DEPTH_BUDGETS[depth];
	return budget ? `Q${questionNumber} of ~${budget}` : `Q${questionNumber}`;
}

function chineseAlignmentActivityCopy(
	stage: GenerationStage,
	_goCommand: string,
	questionNumber: number,
	depth: AlignmentDepth,
) {
	if (stage === "aligning")
		return {
			phase: `Q${questionNumber}`,
			rows: "准备问题中",
		};
	if (stage === "awaiting_alignment_input")
		return {
			phase: questionProgress(questionNumber, depth),
			rows: "回复对齐需求 ｜「按推荐」委托剩余决策 ｜「/flow go」直接生成计划",
		};
	if (stage === "awaiting_final_confirm")
		return {
			phase: "已对齐",
			rows: "「/flow go」生成计划 ｜继续回复则补充信息",
		};
	if (stage === "awaiting_blocking_input")
		return { phase: "等待补充", rows: "回答当前问题后继续生成" };
	return {
		phase: "生成中",
		rows: chineseDraftingPlanLine(questionNumber),
	};
}

function englishAlignmentActivityCopy(
	stage: GenerationStage,
	goCommand: string,
	questionNumber: number,
	depth: AlignmentDepth,
) {
	if (stage === "aligning")
		return {
			phase: "Aligning",
			rows: `Preparing Q${questionNumber}`,
		};
	if (stage === "awaiting_alignment_input")
		return {
			phase: "Waiting for reply",
			rows: `Answer ${englishQuestionProgress(questionNumber, depth)} · "use recommendations" delegates the rest`,
		};
	if (stage === "awaiting_final_confirm")
		return {
			phase: "Ready to draft",
			rows: [
				"Alignment is ready",
				`Run ${quoteCommand(goCommand)} to generate the plan`,
				"Any other input continues alignment",
			],
		};
	if (stage === "awaiting_blocking_input")
		return {
			phase: "Waiting for input",
			rows: "Answer the current question to continue generation",
		};
	return {
		phase: "Drafting plan",
		rows: englishDraftingPlanLine(questionNumber),
	};
}

function chineseAlignmentSummary(
	stage: GenerationStage,
	_goCommand: string,
	questionNumber: number,
	depth: AlignmentDepth,
) {
	if (stage === "awaiting_alignment_input")
		return `回复对齐需求（${questionProgress(questionNumber, depth)}）；「按推荐」委托剩余决策；「/flow go」直接生成计划`;
	if (stage === "aligning") return `Q${questionNumber} 准备问题中`;
	if (stage === "awaiting_final_confirm")
		return "已对齐，「/flow go」生成计划；继续回复则补充信息";
	if (stage === "awaiting_blocking_input")
		return "生成被阻塞，回答当前问题后继续生成";
	return chineseDraftingPlanLine(questionNumber);
}

function chineseDraftingPlanLine(questionNumber: number) {
	const count = completedQuestionCount(questionNumber);
	return count === 0
		? "洞察全部上下文，生成全面计划"
		: `基于 ${count} 轮问答生成全面计划`;
}

function englishDraftingPlanLine(questionNumber: number) {
	const count = completedQuestionCount(questionNumber);
	return count === 0
		? "Drafting a comprehensive plan from full context"
		: `Drafting a comprehensive plan from ${count} alignment rounds`;
}

function completedQuestionCount(questionNumber: number) {
	return Math.max(0, questionNumber - 1);
}

function quoteCommand(command: string) {
	return command.startsWith("「") ? command : `「${command}」`;
}

function englishAlignmentSummary(
	stage: GenerationStage,
	goCommand: string,
	questionNumber: number,
	depth: AlignmentDepth,
) {
	if (stage === "awaiting_alignment_input")
		return `Answer ${englishQuestionProgress(questionNumber, depth)} to continue alignment. Reply "use recommendations" to delegate the rest`;
	if (stage === "aligning") return `Aligning; preparing Q${questionNumber}`;
	if (stage === "awaiting_final_confirm")
		return `Alignment is ready. Run ${quoteCommand(goCommand)} to generate the plan; any other input continues alignment`;
	if (stage === "awaiting_blocking_input")
		return "Generation is blocked. Answer the current question to continue generation";
	return englishDraftingPlanLine(questionNumber);
}

function effectiveAlign(
	align: GenerationAlign,
	ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
): GenerationAlign {
	if (align !== "ask") return align;
	return ctx.hasUI !== false && typeof ctx.ui.select === "function"
		? "ask"
		: "standard";
}
