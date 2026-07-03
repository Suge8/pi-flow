import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { FlowSourceType } from "../flow/types.js";
import {
	setFlowActivity,
	setGoalActivityBox,
} from "../shared/activity-frame.js";
import {
	buildAlignmentPrompt,
	extractAlignedRequest,
	type GenerationStartOptions,
	generationAlignmentActivityCopy,
	generationAlignmentSummary,
	hasNeedInput,
	hasReadyToDraft,
	isDraftConfirmation,
	isStartGenerationConfirmation,
} from "../shared/generation-alignment.js";
import { sendAlignmentStartCard } from "../shared/generation-card.js";
import {
	alignedRequestForGeneration,
	appendAlignmentAnswer,
	appendGenerationClarification,
	finishPendingGeneration,
	generationDraftBox,
	generationKey,
	hasPendingGenerationInCwd,
	type PendingGenerationBase,
	rememberAlignmentQuestion,
} from "../shared/generation-state.js";
import { formatError } from "../shared/guards.js";
import { sendOrchestrationPrompt } from "../shared/internal-prompt.js";
import { runtimeLanguage } from "../shared/language.js";
import { openLiveHtmlOnce } from "../shared/report-server.js";
import { notifyUser } from "../shared/ui-language.js";
import { buildGoalArtifact, type GoalSemanticInput } from "./builder.js";
import { writeGoalErrorHtml, writeGoalHtml } from "./html.js";
import { generationPrompt, repairPrompt } from "./prompt.js";
import {
	findGoalArtifact,
	goalDir,
	goalJsonPath,
	latestGoalArtifact,
	listGoalIds,
	readGoalArtifact,
	touchGoalErrors,
	writeGoalArtifact,
} from "./store.js";
import type { GoalArtifactLocation } from "./types.js";
import { validateGoalDir } from "./validator.js";

interface PendingGoalGeneration extends PendingGenerationBase {
	awaitingFlowConfirmation: boolean;
	goalId?: string;
}

export interface GoalClarificationAction {
	kind: "prompt";
	prompt: string;
	activityBox?: ReturnType<typeof generationDraftBox>;
	showUserInput?: boolean;
}

export interface GoalGenerationReady {
	kind: "ready";
	id: string;
	autoStart: boolean;
	language: "zh" | "en";
}

const GOAL_DRAFT_ACTIVITY = "goal-draft";
const MAX_CLARIFICATION_CHARS = 2000;
const pendingGenerations = new Map<string, PendingGoalGeneration>();

export async function startGoalGeneration(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	originalRequest: string,
	sourceType: FlowSourceType,
	sourcePath?: string,
	options: GenerationStartOptions = { mode: "direct", autoStart: false },
) {
	if (hasPendingGenerationInCwd(pendingGenerations, ctx.cwd)) {
		ctx.ui.notify("当前目录已有未完成的计划生成。", "warning");
		return;
	}
	const request = await generationRequest(
		ctx,
		originalRequest,
		sourceType,
		sourcePath,
	);
	if (!request) return;
	let beforeIds: string[];
	try {
		beforeIds = listGoalIds(ctx.cwd);
	} catch (error) {
		ctx.ui.notify(`.flow 目录不可用：${formatError(error)}`, "error");
		return;
	}
	const key = generationKey(ctx);
	const language = runtimeLanguage();
	const pending: PendingGoalGeneration = {
		key,
		cwd: ctx.cwd,
		originalRequest: request.originalRequest,
		sourceType: request.sourceType,
		sourcePath: request.sourcePath,
		language,
		beforeIds,
		attempts: 0,
		stage: options.mode === "align" ? "aligning" : "generating",
		awaitingClarification: false,
		awaitingFlowConfirmation: false,
		autoStart: options.autoStart,
	};
	pendingGenerations.set(key, pending);
	setFlowActivity("goal", true, GOAL_DRAFT_ACTIVITY);
	setGoalActivityBox(ctx, goalPendingBox(pending));
	const prompt =
		options.mode === "align"
			? buildAlignmentPrompt({
					kind: "goal",
					language,
					originalRequest: request.originalRequest,
					source: sourceLabel(request),
				})
			: generationPrompt({ ...request, language });
	if (options.mode === "align") sendAlignmentStartCard(pi, ctx, "goal");
	const sent = await sendGenerationPrompt(pi, ctx, prompt);
	if (!sent) return finishGeneration(pendingGenerations.get(key), ctx);
	if (options.mode === "align") return;
	ctx.ui.notify("计划已开始生成；完成后会自动校验。", "info");
}

export async function startGoalFromFile(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	args: string[],
	options?: GenerationStartOptions,
) {
	if (args.length !== 1)
		return ctx.ui.notify("用法：/goal <path.md>", "warning");
	const path = resolve(ctx.cwd, args[0]);
	let originalRequest: string;
	try {
		originalRequest = readFileSync(path, "utf8");
	} catch (error) {
		return ctx.ui.notify(`读取失败：${formatError(error)}`, "error");
	}
	await startGoalGeneration(pi, ctx, originalRequest, "file", path, options);
}

export async function handleGoalGenerationEnd(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	event?: { messages?: unknown[] },
): Promise<GoalGenerationReady | undefined> {
	const pending = pendingGenerations.get(generationKey(ctx));
	if (!pending || pending.cwd !== ctx.cwd) return;
	let location: GoalArtifactLocation | undefined;
	try {
		const failedSemanticIds = new Set<string>();
		const semanticErrors: string[] = [];
		const built = tryBuildFromSemantic(ctx.cwd, pending, (id, error) => {
			const message = `目标计划草稿组装失败（${id}）：${formatError(error)}`;
			failedSemanticIds.add(id);
			semanticErrors.push(message);
			ctx.ui.notify(`${message}；将继续查找已有计划。`, "warning");
		});
		if (pending.goalId && !built) {
			const staleLocation = generatedGoal(ctx.cwd, pending);
			const errors = failedSemanticIds.has(pending.goalId)
				? semanticErrors
				: ["目标语义草稿缺失"];
			if (staleLocation)
				await repairInvalidGoal(pi, ctx, pending, staleLocation, errors);
			else
				handleMissingGoal(
					ctx,
					pending,
					finalAssistantText(event?.messages ?? []),
				);
			return undefined;
		}
		location = built;
	} catch (error) {
		ctx.ui.notify(`goal.json 读取失败：${formatError(error)}`, "error");
		finishGeneration(pending, ctx);
		return;
	}
	const assistantText = finalAssistantText(event?.messages ?? []);
	if (!location) {
		handleMissingGoal(ctx, pending, assistantText);
		return undefined;
	}
	if (pending.stage === "aligning") {
		ctx.ui.notify("对齐阶段不接受目标计划；请继续对齐后再生成。", "error");
		finishGeneration(pending, ctx);
		return undefined;
	}
	pending.goalId = location.id;
	const validation = validateGoalDir(location.dir, pending.language);
	if (validation.ok && validation.goal) {
		const goal = touchGoalErrors(location.dir, validation.goal, []);
		const html = writeGoalHtml(location.dir, goal);
		await openLiveHtmlOnce(pi, ctx, html, goal.language);
		if (!pending.autoStart)
			notifyUser(ctx, generatedSummary(goal), "info", goal.language);
		finishGeneration(pending, ctx);
		return {
			kind: "ready",
			id: goal.id,
			autoStart: pending.autoStart === true,
			language: goal.language,
		};
	}
	await repairInvalidGoal(pi, ctx, pending, location, validation.errors);
}

async function generationRequest(
	ctx: ExtensionCommandContext,
	originalRequest: string,
	sourceType: FlowSourceType,
	sourcePath?: string,
) {
	if (canGenerateFromContext(ctx, originalRequest, sourceType))
		return { originalRequest, sourceType, sourcePath };
	if (ctx.hasUI === false || typeof ctx.ui.input !== "function") {
		ctx.ui.notify(
			"没有可用于生成目标的上下文。先描述需求，或使用 /goal <path.md>。",
			"warning",
		);
		return undefined;
	}
	const requestedGoal = await ctx.ui.input("目标", "你想完成什么？");
	const trimmedGoal = requestedGoal?.trim();
	if (!trimmedGoal) return undefined;
	return { originalRequest: trimmedGoal, sourceType: "prompt" as const };
}

function generatedGoal(
	cwd: string,
	pending: PendingGoalGeneration,
	excludeIds: ReadonlySet<string> = new Set(),
) {
	if (pending.goalId)
		return excludeIds.has(pending.goalId)
			? undefined
			: findGoalArtifact(cwd, pending.goalId);
	const before = new Set(pending.beforeIds);
	return latestGoalArtifact(
		cwd,
		(goal) => !before.has(goal.id) && !excludeIds.has(goal.id),
	);
}

function tryBuildFromSemantic(
	cwd: string,
	pending: PendingGoalGeneration,
	onError: (goalId: string, error: unknown) => void,
): GoalArtifactLocation | undefined {
	const before = new Set(pending.beforeIds);
	const ids = pending.goalId ? [pending.goalId] : listGoalIds(cwd);
	let built: GoalArtifactLocation | undefined;
	for (const id of ids) {
		if (!pending.goalId && before.has(id)) continue;
		const dir = goalDir(cwd, id);
		const semanticPath = join(dir, "goal.semantic.json");
		if (!existsSync(semanticPath)) continue;
		try {
			const repairAttempts = currentRepairAttempts(dir);
			let goal = buildGoalArtifact(
				dir,
				semanticInput(semanticPath, pending),
				pending.language,
				cwd,
			);
			if (repairAttempts > goal.repairAttempts)
				goal = writeGoalArtifact(dir, { ...goal, repairAttempts });
			built = { id, dir, jsonPath: goalJsonPath(dir), goal };
		} catch (error) {
			onError(id, error);
		}
	}
	return built;
}

function currentRepairAttempts(dir: string) {
	try {
		const attempts = readGoalArtifact(dir).repairAttempts;
		return Number.isInteger(attempts) ? attempts : 0;
	} catch {
		return 0;
	}
}

function semanticInput(
	path: string,
	pending: PendingGoalGeneration,
): GoalSemanticInput {
	const parsed = JSON.parse(readFileSync(path, "utf8")) as { title?: unknown };
	return {
		title: parsed?.title,
		source: {
			type: pending.sourceType,
			path: pending.sourcePath ?? null,
			originalRequest: pending.originalRequest,
		},
	};
}

function handleMissingGoal(
	ctx: Pick<ExtensionContext, "ui">,
	pending: PendingGoalGeneration,
	assistantText: string,
) {
	if (pending.stage === "aligning")
		return waitForAlignment(ctx, pending, assistantText);
	if (recommendsFlow(assistantText)) return waitForFlowChoice(ctx, pending);
	if (hasNeedInput(assistantText)) return waitForBlockingInput(ctx, pending);
	ctx.ui.notify("AI 未生成有效目标计划。请重试 /goal。", "error");
	finishGeneration(pending, ctx);
}

function waitForAlignment(
	ctx: Pick<ExtensionContext, "ui">,
	pending: PendingGoalGeneration,
	assistantText: string,
) {
	if (recommendsFlow(assistantText)) return waitForFlowChoice(ctx, pending);
	if (hasReadyToDraft(assistantText)) {
		const alignedRequest = extractAlignedRequest(assistantText);
		if (alignedRequest) {
			pending.stage = "awaiting_final_confirm";
			pending.alignedRequest = alignedRequest;
			return setGoalActivityBox(ctx, goalPendingBox(pending));
		}
		ctx.ui.notify(
			"对齐摘要缺失；请继续对齐，直到 AI 输出 <aligned-request>。",
			"warning",
		);
	}
	rememberAlignmentQuestion(pending, assistantText);
	pending.stage = "awaiting_alignment_input";
	setGoalActivityBox(ctx, goalPendingBox(pending));
}

function waitForBlockingInput(
	ctx: Pick<ExtensionContext, "ui">,
	pending: PendingGoalGeneration,
) {
	pending.stage = "awaiting_blocking_input";
	setGoalActivityBox(ctx, goalPendingBox(pending));
}

function waitForFlowChoice(
	ctx: Pick<ExtensionContext, "ui">,
	pending: PendingGoalGeneration,
) {
	pending.awaitingClarification = true;
	pending.awaitingFlowConfirmation = true;
	setGoalActivityBox(ctx, goalDraftBox("等待选择", "运行 /flow 拆分执行"));
}

export function clearGoalGeneration(ctx: {
	cwd: string;
	sessionManager?: unknown;
	ui?: ExtensionContext["ui"];
}) {
	const pending = pendingGenerations.get(generationKey(ctx));
	finishGeneration(pending, ctx.ui ? { ui: ctx.ui } : undefined);
	return pending !== undefined;
}

export function showGoalGenerationStatus(ctx: {
	cwd: string;
	sessionManager?: unknown;
	ui: ExtensionContext["ui"];
}) {
	const pending = pendingGenerations.get(generationKey(ctx));
	if (!pending) return false;
	setGoalActivityBox(ctx, goalPendingBox(pending));
	ctx.ui.notify(goalPendingSummary(pending), "info");
	return true;
}

export function consumeGoalClarificationInput(
	text: string,
	ctx?: { cwd: string; sessionManager?: unknown },
): GoalClarificationAction | undefined {
	const pending = ctx
		? pendingGenerations.get(generationKey(ctx))
		: pendingClarification();
	const clarification = text.trim();
	if (!pending || (ctx && pending.cwd !== ctx.cwd) || !clarification) return;
	if (clarification.startsWith("/")) return;
	if (pending.stage === "awaiting_final_confirm") {
		if (isDraftConfirmation(clarification, pending.language))
			return confirmGoalDraft(pending);
		return continueGoalAlignment(pending, clarification);
	}
	if (pending.stage === "awaiting_alignment_input") {
		if (isStartGenerationConfirmation(clarification, pending.language))
			return confirmGoalDraft(pending);
		return continueGoalAlignment(pending, clarification);
	}
	if (
		pending.stage === "awaiting_blocking_input" ||
		pending.awaitingFlowConfirmation
	)
		return continueGoalGeneration(pending, clarification);
	return undefined;
}

function confirmGoalDraft(
	pending: PendingGoalGeneration,
): GoalClarificationAction {
	pending.stage = "generating";
	pending.awaitingClarification = false;
	pending.awaitingFlowConfirmation = false;
	return {
		kind: "prompt",
		activityBox: goalPendingBox(pending),
		showUserInput: true,
		prompt: generationPrompt({
			originalRequest: pending.originalRequest,
			sourceType: pending.sourceType,
			sourcePath: pending.sourcePath,
			alignedRequest: alignedRequestForGeneration(pending),
			language: pending.language,
		}),
	};
}

function continueGoalAlignment(
	pending: PendingGoalGeneration,
	clarification: string,
): GoalClarificationAction {
	const compactClarification = compactUserClarification(
		clarification,
		pending.language,
	);
	appendAlignmentAnswer(pending, compactClarification);
	pending.stage = "aligning";
	return {
		kind: "prompt",
		activityBox: goalPendingBox(pending),
		showUserInput: true,
		prompt: buildAlignmentPrompt({
			kind: "goal",
			language: pending.language,
			originalRequest: pending.originalRequest,
			source: sourceLabel(pending),
			alignmentTurns: pending.alignmentTurns,
			alignedRequest: pending.alignedRequest,
		}),
	};
}

function continueGoalGeneration(
	pending: PendingGoalGeneration,
	clarification: string,
): GoalClarificationAction {
	recordGoalClarification(pending, clarification);
	pending.stage = "generating";
	pending.awaitingClarification = false;
	pending.awaitingFlowConfirmation = false;
	return {
		kind: "prompt",
		activityBox: goalPendingBox(pending),
		showUserInput: true,
		prompt: generationPrompt({
			originalRequest: pending.originalRequest,
			sourceType: pending.sourceType,
			sourcePath: pending.sourcePath,
			alignedRequest: pending.alignedRequest,
			language: pending.language,
		}),
	};
}

function recordGoalClarification(
	pending: PendingGoalGeneration,
	clarification: string,
) {
	const compactClarification = compactUserClarification(
		clarification,
		pending.language,
	);
	pending.lastClarification = compactClarification;
	pending.originalRequest = appendGenerationClarification(
		pending.originalRequest,
		compactClarification,
		pending.language,
	);
	return compactClarification;
}

export function pendingGoalFlowRequest(ctx: {
	cwd: string;
	sessionManager?: unknown;
}) {
	return flowRecommendedPending(ctx)?.originalRequest;
}

export function commitGoalFlowRequest(ctx: {
	cwd: string;
	sessionManager?: unknown;
	ui?: ExtensionContext["ui"];
}) {
	finishGeneration(
		flowRecommendedPending(ctx),
		ctx.ui ? { ui: ctx.ui } : undefined,
		{
			clearActivityBox: false,
		},
	);
}

function flowRecommendedPending(ctx: {
	cwd: string;
	sessionManager?: unknown;
}) {
	const pending = pendingGenerations.get(generationKey(ctx));
	if (
		!pending?.awaitingClarification ||
		!pending.awaitingFlowConfirmation ||
		pending.cwd !== ctx.cwd
	)
		return undefined;
	return pending;
}

function pendingClarification() {
	const pending = [...pendingGenerations.values()].filter(isAwaitingUserInput);
	return pending.length === 1 ? pending[0] : undefined;
}

function isAwaitingUserInput(pending: PendingGoalGeneration) {
	return (
		pending.awaitingClarification ||
		pending.stage === "awaiting_alignment_input" ||
		pending.stage === "awaiting_final_confirm" ||
		pending.stage === "awaiting_blocking_input"
	);
}

function compactUserClarification(
	clarification: string,
	language: PendingGoalGeneration["language"] = "zh",
) {
	if (clarification.length <= MAX_CLARIFICATION_CHARS) return clarification;
	const suffix =
		language === "en"
			? "(user addition was too long; later content was omitted. Do not copy long templates into source.originalRequest or plan.md.)"
			: "（用户补充过长，后续内容已省略；不要把长模板复制进 source.originalRequest 或 plan.md。）";
	return `${clarification.slice(0, MAX_CLARIFICATION_CHARS).trimEnd()}\n\n${suffix}`;
}

async function repairInvalidGoal(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	pending: PendingGoalGeneration,
	location: GoalArtifactLocation,
	errors: string[],
) {
	const baseAttempts = Number.isInteger(location.goal.repairAttempts)
		? location.goal.repairAttempts
		: pending.attempts;
	const attempts = baseAttempts + 1;
	setGoalActivityBox(ctx, goalDraftBox("计划修复中", `错误：${errors[0]}`));
	const saved = writeGoalArtifact(location.dir, {
		...location.goal,
		errors,
		repairAttempts: attempts,
	});
	writeGoalErrorHtml(location.dir, {
		title: saved.title || location.id,
		errors,
		originalRequest: saved.source?.originalRequest ?? pending.originalRequest,
		language: saved.language ?? pending.language,
	});
	pending.attempts = attempts;
	if (attempts > 3) {
		ctx.ui.notify(
			`计划校验失败，自动修复已达 3 轮：\n${errors.join("\n")}`,
			"error",
		);
		finishGeneration(pending, ctx);
		return;
	}
	const sent = await sendGenerationPrompt(
		pi,
		ctx,
		repairPrompt({
			errors,
			originalRequest: saved.source?.originalRequest ?? pending.originalRequest,
			goalPath: location.dir,
			language: saved.language ?? pending.language,
		}),
		true,
	);
	if (!sent) finishGeneration(pending, ctx);
}

async function sendGenerationPrompt(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "ui">,
	prompt: string,
	followUp = false,
) {
	return sendOrchestrationPrompt(pi, ctx, prompt, {
		followUp,
		errorPrefix: "计划提示发送失败",
	});
}

function canGenerateFromContext(
	ctx: { sessionManager?: unknown },
	originalRequest: string,
	sourceType: FlowSourceType,
) {
	if (sourceType !== "conversation" || originalRequest.trim()) return true;
	const sessionManager = ctx.sessionManager as
		| { getBranch?: () => Array<{ type?: string; message?: unknown }> }
		| undefined;
	return (sessionManager?.getBranch?.() ?? []).some(isUserContextMessage);
}

function finalAssistantText(messages: unknown[]) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message || typeof message !== "object") continue;
		const candidate = message as { role?: unknown; content?: unknown };
		if (candidate.role === "assistant") return messageText(candidate.content);
	}
	return "";
}

function recommendsFlow(text: string) {
	return /<!--\s*pi-flow:recommend-flow\s*-->/iu.test(text);
}

function isUserContextMessage(entry: { type?: string; message?: unknown }) {
	if (entry.type !== "message" || !entry.message) return false;
	const message = entry.message as { role?: unknown; content?: unknown };
	return message.role === "user" && messageText(message.content).trim() !== "";
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) =>
			typeof item === "object" && item && "text" in item
				? String(item.text)
				: "",
		)
		.join("\n");
}

function finishGeneration(
	pending: PendingGoalGeneration | undefined,
	ctx?: Pick<ExtensionContext, "ui">,
	options: { clearActivityBox?: boolean } = {},
) {
	finishPendingGeneration({
		pendingGenerations,
		pending,
		activityId: GOAL_DRAFT_ACTIVITY,
		ctx,
		clearActivityBox: options.clearActivityBox,
	});
}

function goalPendingBox(pending: PendingGoalGeneration) {
	const copy = generationAlignmentActivityCopy(
		pending.stage,
		pending.language,
		Boolean(pending.alignmentTurns?.length),
	);
	return goalDraftBox(copy.phase, copy.rows);
}

function goalPendingSummary(pending: PendingGoalGeneration) {
	return generationAlignmentSummary(pending.stage, pending.language);
}

function goalDraftBox(phase: string, rows: string | string[] = []) {
	return generationDraftBox(`🎯 目标 · ${phase}`, rows);
}

function generatedSummary(goal: {
	id: string;
	title: string;
	language: "zh" | "en";
}) {
	return goal.language === "en"
		? `Next: /goal start ${goal.id}`
		: `下一步：/goal start ${goal.id}`;
}

function sourceLabel(input: {
	sourceType: FlowSourceType;
	sourcePath?: string;
}) {
	return input.sourcePath
		? `${input.sourceType}: ${input.sourcePath}`
		: input.sourceType;
}
