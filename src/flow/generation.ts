import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	setFlowActivity,
	setGoalActivityBox,
} from "../shared/activity-frame.js";
import type { Language } from "../shared/config.js";
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
import { formatError, isRecord } from "../shared/guards.js";
import { sendOrchestrationPrompt } from "../shared/internal-prompt.js";
import { runtimeLanguage } from "../shared/language.js";
import { flowStepLabel } from "../shared/progress-labels.js";
import { openLiveHtmlOnce } from "../shared/report-server.js";
import { notifyUser } from "../shared/ui-language.js";
import { buildFlowArtifact, type FlowSemanticInput } from "./builder.js";
import { writeFlowErrorHtml, writeFlowHtml } from "./html.js";
import { generationPrompt, repairPrompt } from "./prompt.js";
import {
	findFlow,
	flowDir,
	flowJsonPath,
	latestFlow,
	listFlowIds,
	readFlow,
	touchFlowErrors,
	writeFlow,
} from "./store.js";
import type { FlowLocation, FlowSource, FlowSourceType } from "./types.js";
import { validateFlowDir } from "./validator.js";

interface PendingGeneration extends PendingGenerationBase {
	flowId?: string;
}

export interface FlowClarificationAction {
	kind: "prompt";
	prompt: string;
	activityBox?: ReturnType<typeof generationDraftBox>;
	showUserInput?: boolean;
}

export interface FlowGenerationReady {
	kind: "ready";
	id: string;
	autoStart: boolean;
	language: Language;
}

const FLOW_DRAFT_ACTIVITY = "flow-draft";
const pendingGenerations = new Map<string, PendingGeneration>();

export async function startGeneration(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	originalRequest: string,
	sourceType: FlowSourceType,
	sourcePath?: string,
	options: GenerationStartOptions = { mode: "direct", autoStart: false },
) {
	if (hasPendingGenerationInCwd(pendingGenerations, ctx.cwd)) {
		ctx.ui.notify(
			"当前目录已有 Flow 计划在生成中；等它完成后再运行 /flow。",
			"warning",
		);
		return false;
	}
	let beforeIds: string[];
	try {
		beforeIds = listFlowIds(ctx.cwd);
	} catch (error) {
		ctx.ui.notify(`.flow 目录不可用：${formatError(error)}`, "error");
		return false;
	}
	const key = generationKey(ctx);
	const language = runtimeLanguage();
	const pending: PendingGeneration = {
		key,
		cwd: ctx.cwd,
		originalRequest,
		sourceType,
		sourcePath,
		language,
		beforeIds,
		attempts: 0,
		stage: options.mode === "align" ? "aligning" : "generating",
		awaitingClarification: false,
		autoStart: options.autoStart,
	};
	pendingGenerations.set(key, pending);
	setFlowActivity("goal", true, FLOW_DRAFT_ACTIVITY);
	setGoalActivityBox(ctx, flowPendingBox(pending));
	const prompt =
		options.mode === "align"
			? buildAlignmentPrompt({
					kind: "flow",
					language,
					originalRequest,
					source: sourceLabel({ sourceType, sourcePath }),
				})
			: generationPrompt({ originalRequest, sourceType, sourcePath, language });
	if (options.mode === "align") sendAlignmentStartCard(pi, ctx, "flow");
	const sent = await sendOrchestrationPrompt(pi, ctx, prompt, {
		errorPrefix: "多步骤计划提示发送失败",
	});
	if (!sent) {
		finishGeneration(pending, ctx);
		return false;
	}
	if (options.mode === "align") return true;
	ctx.ui.notify("多步骤计划已开始生成；完成后会自动校验。", "info");
	return true;
}

export async function startFromFile(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	args: string[],
	options?: GenerationStartOptions,
) {
	if (args.length !== 1)
		return ctx.ui.notify("用法：/flow <path.md>", "warning");
	const path = resolve(ctx.cwd, args[0]);
	let originalRequest: string;
	try {
		originalRequest = readFileSync(path, "utf8");
	} catch (error) {
		return ctx.ui.notify(`读取失败：${formatError(error)}`, "error");
	}
	await startGeneration(pi, ctx, originalRequest, "file", path, options);
}

export async function handleGenerationEnd(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	event?: { messages?: unknown[] },
): Promise<FlowGenerationReady | undefined> {
	const pending = pendingGenerations.get(generationKey(ctx));
	if (!pending || pending.cwd !== ctx.cwd) return;
	let location: FlowLocation | undefined;
	try {
		const failedSemanticIds = new Set<string>();
		const semanticErrors: string[] = [];
		const built = tryBuildFlowFromSemantic(ctx.cwd, pending, (id, error) => {
			const message = `Flow 计划草稿组装失败（${id}）：${formatError(error)}`;
			failedSemanticIds.add(id);
			semanticErrors.push(message);
			ctx.ui.notify(`${message}；将继续查找已有计划。`, "warning");
		});
		if (pending.flowId && !built) {
			const staleLocation = generatedFlow(ctx.cwd, pending);
			const errors = failedSemanticIds.has(pending.flowId)
				? semanticErrors
				: ["Flow 语义草稿缺失"];
			if (staleLocation)
				await repairInvalidFlow(pi, ctx, pending, staleLocation, errors);
			else
				handleMissingFlow(
					ctx,
					pending,
					finalAssistantText(event?.messages ?? []),
				);
			return undefined;
		}
		location = built;
	} catch (error) {
		ctx.ui.notify(`flow.json 读取失败：${formatError(error)}`, "error");
		finishGeneration(pending, ctx);
		return;
	}
	if (!location) {
		handleMissingFlow(ctx, pending, finalAssistantText(event?.messages ?? []));
		return undefined;
	}
	if (pending.stage === "aligning") {
		ctx.ui.notify("对齐阶段不接受 Flow 计划；请继续对齐后再生成。", "error");
		finishGeneration(pending, ctx);
		return undefined;
	}
	pending.flowId = location.id;
	const validation = validateFlowDir(location.dir, pending.language);
	if (validation.ok && validation.flow) {
		const flow = touchFlowErrors(location.dir, validation.flow, []);
		const html = writeFlowHtml(location.dir, flow);
		await openLiveHtmlOnce(pi, ctx, html, flow.language);
		if (!pending.autoStart)
			notifyUser(ctx, generatedSummary(flow), "info", flow.language);
		finishGeneration(pending, ctx);
		return {
			kind: "ready",
			id: flow.id,
			autoStart: pending.autoStart === true,
			language: flow.language,
		};
	}
	await repairInvalidFlow(pi, ctx, pending, location, validation.errors);
}

function generatedFlow(cwd: string, pending: PendingGeneration) {
	if (pending.flowId) return findFlow(cwd, pending.flowId);
	const before = new Set(pending.beforeIds);
	return latestFlow(cwd, (flow) => !before.has(flow.id));
}

function tryBuildFlowFromSemantic(
	cwd: string,
	pending: PendingGeneration,
	onError: (id: string, error: unknown) => void,
): FlowLocation | undefined {
	const before = new Set(pending.beforeIds);
	const ids = pending.flowId ? [pending.flowId] : listFlowIds(cwd);
	let built: FlowLocation | undefined;
	for (const id of ids) {
		if (!pending.flowId && before.has(id)) continue;
		const dir = flowDir(cwd, id);
		const semanticPath = join(dir, "flow.semantic.json");
		if (!existsSync(semanticPath)) continue;
		try {
			const repairAttempts = currentRepairAttempts(dir);
			let flow = buildFlowArtifact(
				dir,
				semanticInput(semanticPath),
				pending.language,
				flowSource(pending),
			);
			if (repairAttempts > flow.repairAttempts)
				flow = writeFlow(dir, { ...flow, repairAttempts });
			built = { id, dir, jsonPath: flowJsonPath(dir), flow };
		} catch (error) {
			onError(id, error);
		}
	}
	return built;
}

function currentRepairAttempts(dir: string) {
	try {
		const attempts = readFlow(dir).repairAttempts;
		return Number.isInteger(attempts) ? attempts : 0;
	} catch {
		return 0;
	}
}

function semanticInput(path: string): FlowSemanticInput {
	return JSON.parse(readFileSync(path, "utf8")) as FlowSemanticInput;
}

function flowSource(pending: PendingGeneration): FlowSource {
	return {
		type: pending.sourceType,
		path: pending.sourcePath ?? null,
		originalRequest: pending.originalRequest,
	};
}

function handleMissingFlow(
	ctx: Pick<ExtensionContext, "ui">,
	pending: PendingGeneration,
	assistantText: string,
) {
	if (pending.stage === "aligning")
		return waitForAlignment(ctx, pending, assistantText);
	if (hasNeedInput(assistantText)) return waitForBlockingInput(ctx, pending);
	if (isGoalFlowRecommendation(assistantText)) return;
	ctx.ui.notify("AI 未生成有效 Flow 计划。请重试 /flow。", "error");
	finishGeneration(pending, ctx);
}

function waitForAlignment(
	ctx: Pick<ExtensionContext, "ui">,
	pending: PendingGeneration,
	assistantText: string,
) {
	if (hasReadyToDraft(assistantText)) {
		const alignedRequest = extractAlignedRequest(assistantText);
		if (alignedRequest) {
			pending.stage = "awaiting_final_confirm";
			pending.alignedRequest = alignedRequest;
			return setGoalActivityBox(ctx, flowPendingBox(pending));
		}
		ctx.ui.notify(
			"对齐摘要缺失；请继续对齐，直到 AI 输出 <aligned-request>。",
			"warning",
		);
	}
	rememberAlignmentQuestion(pending, assistantText);
	pending.stage = "awaiting_alignment_input";
	setGoalActivityBox(ctx, flowPendingBox(pending));
}

function waitForBlockingInput(
	ctx: Pick<ExtensionContext, "ui">,
	pending: PendingGeneration,
) {
	pending.stage = "awaiting_blocking_input";
	setGoalActivityBox(ctx, flowPendingBox(pending));
}

export function clearFlowGeneration(
	ctx: Pick<ExtensionContext, "ui"> & { cwd: string; sessionManager?: unknown },
) {
	const pending = pendingGenerations.get(generationKey(ctx));
	finishGeneration(pending, ctx);
	return pending !== undefined;
}

export function showFlowGenerationStatus(
	ctx: Pick<ExtensionContext, "ui"> & { cwd: string; sessionManager?: unknown },
) {
	const pending = pendingGenerations.get(generationKey(ctx));
	if (!pending) return false;
	setGoalActivityBox(ctx, flowPendingBox(pending));
	ctx.ui.notify(flowPendingSummary(pending), "info");
	return true;
}

export function consumeFlowClarificationInput(
	text: string,
	ctx: { cwd: string; sessionManager?: unknown },
): FlowClarificationAction | undefined {
	const pending = pendingGenerations.get(generationKey(ctx));
	const clarification = text.trim();
	if (!pending || pending.cwd !== ctx.cwd || !clarification) return;
	if (clarification.startsWith("/")) return;
	if (pending.stage === "awaiting_final_confirm") {
		if (isDraftConfirmation(clarification, pending.language))
			return confirmFlowDraft(pending);
		return continueFlowAlignment(pending, clarification);
	}
	if (pending.stage === "awaiting_alignment_input") {
		if (isStartGenerationConfirmation(clarification, pending.language))
			return confirmFlowDraft(pending);
		return continueFlowAlignment(pending, clarification);
	}
	if (pending.stage === "awaiting_blocking_input")
		return continueFlowGeneration(pending, clarification);
	return undefined;
}

function confirmFlowDraft(pending: PendingGeneration): FlowClarificationAction {
	pending.stage = "generating";
	pending.awaitingClarification = false;
	return {
		kind: "prompt",
		activityBox: flowPendingBox(pending),
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

function continueFlowAlignment(
	pending: PendingGeneration,
	clarification: string,
): FlowClarificationAction {
	appendAlignmentAnswer(pending, clarification);
	pending.stage = "aligning";
	return {
		kind: "prompt",
		activityBox: flowPendingBox(pending),
		showUserInput: true,
		prompt: buildAlignmentPrompt({
			kind: "flow",
			language: pending.language,
			originalRequest: pending.originalRequest,
			source: sourceLabel(pending),
			alignmentTurns: pending.alignmentTurns,
			alignedRequest: pending.alignedRequest,
		}),
	};
}

function continueFlowGeneration(
	pending: PendingGeneration,
	clarification: string,
): FlowClarificationAction {
	recordFlowClarification(pending, clarification);
	pending.stage = "generating";
	pending.awaitingClarification = false;
	return {
		kind: "prompt",
		activityBox: flowPendingBox(pending),
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

function recordFlowClarification(
	pending: PendingGeneration,
	clarification: string,
) {
	pending.lastClarification = clarification;
	pending.originalRequest = appendGenerationClarification(
		pending.originalRequest,
		clarification,
		pending.language,
	);
}

async function repairInvalidFlow(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	pending: PendingGeneration,
	location: FlowLocation,
	errors: string[],
) {
	const flow = location.flow;
	const baseAttempts = Number.isInteger(flow.repairAttempts)
		? flow.repairAttempts
		: pending.attempts;
	const attempts = baseAttempts + 1;
	setGoalActivityBox(ctx, flowDraftBox("计划修复中", `错误：${errors[0]}`));
	const saved = writeFlow(location.dir, {
		...flow,
		errors,
		repairAttempts: attempts,
	});
	writeFlowErrorHtml(location.dir, {
		title: safeFlowTitle(saved, location.id),
		errors,
		originalRequest: safeOriginalRequest(saved, pending.originalRequest),
		language: saved.language ?? pending.language,
	});
	pending.attempts = attempts;
	if (attempts > 3) {
		ctx.ui.notify(
			`Flow 校验失败，自动修复已达 3 轮：\n${errors.join("\n")}`,
			"error",
		);
		finishGeneration(pending, ctx);
		return;
	}
	const sent = await sendOrchestrationPrompt(
		pi,
		ctx,
		repairPrompt({
			errors,
			originalRequest: safeOriginalRequest(saved, pending.originalRequest),
			flowPath: location.dir,
			language: saved.language ?? pending.language,
		}),
		{ followUp: true, errorPrefix: "Flow 计划修复提示发送失败" },
	);
	if (!sent) finishGeneration(pending, ctx);
}

function isGoalFlowRecommendation(text: string) {
	return /<!--\s*pi-flow:recommend-flow\s*-->/iu.test(text);
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

function safeFlowTitle(flow: unknown, fallback: string) {
	return isRecord(flow) && typeof flow.title === "string" && flow.title.trim()
		? flow.title
		: fallback;
}

function safeOriginalRequest(flow: unknown, fallback: string) {
	if (!isRecord(flow) || !isRecord(flow.source)) return fallback;
	return typeof flow.source.originalRequest === "string"
		? flow.source.originalRequest
		: fallback;
}

function finishGeneration(
	pending: PendingGeneration | undefined,
	ctx: Pick<ExtensionContext, "ui">,
) {
	finishPendingGeneration({
		pendingGenerations,
		pending,
		activityId: FLOW_DRAFT_ACTIVITY,
		ctx,
	});
}

function flowPendingBox(pending: PendingGeneration) {
	const copy = generationAlignmentActivityCopy(
		pending.stage,
		pending.language,
		Boolean(pending.alignmentTurns?.length),
	);
	return flowDraftBox(copy.phase, copy.rows);
}

function flowPendingSummary(pending: PendingGeneration) {
	return generationAlignmentSummary(pending.stage, pending.language);
}

function flowDraftBox(phase: string, rows: string | string[] = []) {
	return generationDraftBox(`🌊 Flow · ${phase}`, rows);
}

function generatedSummary(flow: {
	id: string;
	language: Language;
	goals: { index: number; title: string }[];
}) {
	if (flow.language === "en")
		return [
			`Flow plan generated: ${flow.id}`,
			...flow.goals.map(
				(goal) => `- ${flowStepLabel(goal.index, goal.title, flow.language)}`,
			),
			`Next: /flow start ${flow.id}`,
		].join("\n");
	return [
		`Flow 计划已生成：${flow.id}`,
		...flow.goals.map(
			(goal) => `- ${flowStepLabel(goal.index, goal.title, flow.language)}`,
		),
		`下一步：/flow start ${flow.id}`,
	].join("\n");
}

function sourceLabel(input: {
	sourceType: FlowSourceType;
	sourcePath?: string;
}) {
	return input.sourcePath
		? `${input.sourceType}: ${input.sourcePath}`
		: input.sourceType;
}
