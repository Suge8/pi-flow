import { existsSync, readFileSync, rmSync } from "node:fs";
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
	buildAlignmentFollowUpPrompt,
	buildAlignmentPrompt,
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
	type AlignmentState,
	appendAlignmentAnswer,
	appendGenerationClarification,
	createAlignmentState,
	deleteAlignmentState,
	generationDraftBox,
	rememberAlignmentQuestion,
	tryReadAlignmentState,
	writeAlignmentState,
} from "../shared/generation-state.js";
import { formatError, isRecord } from "../shared/guards.js";
import { sendOrchestrationPrompt } from "../shared/internal-prompt.js";
import { runtimeLanguage } from "../shared/language.js";
import { switchToRoleModel } from "../shared/model-roles.js";
import { flowStepLabel } from "../shared/progress-labels.js";
import { openLiveHtmlOnce } from "../shared/report-server.js";
import {
	buildTranscript,
	currentSessionFile,
	sessionEntries,
} from "../shared/session.js";
import { notifyUser } from "../shared/ui-language.js";
import { buildFlowArtifact, type FlowSemanticInput } from "./builder.js";
import { writeFlowErrorHtml, writeFlowHtml } from "./html.js";
import { generationPrompt, repairPrompt } from "./prompt.js";
import {
	createPreDraftFlow,
	findFlow,
	flowDir,
	flowJsonPath,
	listFlows,
	readFlow,
	touchFlowErrors,
	writeFlow,
} from "./store.js";
import { resolveFlowTarget } from "./target.js";
import type { FlowLocation, FlowSource, FlowSourceType } from "./types.js";
import { flowCommandId } from "./util.js";
import { validateFlowDir } from "./validator.js";

interface ActiveGeneration {
	location: FlowLocation;
	alignment: AlignmentState;
	cache?: GenerationCache;
	startContext?: ExtensionCommandContext;
}

interface GenerationCache {
	startContext: ExtensionCommandContext;
	source: FlowSource;
	createdAt: number;
	restoredAlignmentContext?: boolean;
	plannerReady?: boolean;
}

interface GenerationPromptTarget {
	dir: string;
	stale: boolean;
	token: string;
}

export type FlowClarificationAction =
	| {
			kind: "prompt";
			prompt: string;
			promptToken: string;
			flowId: string;
			flowDir: string;
			activityBox?: ReturnType<typeof generationDraftBox>;
			showUserInput?: boolean;
	  }
	| {
			kind: "handled";
			activityBox?: ReturnType<typeof generationDraftBox>;
	  };

export interface FlowGenerationReady {
	kind: "ready";
	id: string;
	language: Language;
	autoStart: boolean;
	startContext?: ExtensionCommandContext;
}

const FLOW_DRAFT_ACTIVITY = "flow-draft";
const PROMPT_TOKEN_PATTERN = /<!--\s*pi-flow:prompt:([a-z0-9_-]+)\s*-->/iu;
const generationContexts = new Map<string, GenerationCache>();
const generationPromptTargets = new Map<string, GenerationPromptTarget[]>();
const generationReplyTargets = new Map<string, string>();
let generationPromptSequence = 0;

export async function startGeneration(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	originalRequest: string,
	sourceType: FlowSourceType,
	sourcePath?: string,
	options: GenerationStartOptions = { mode: "direct", autoStart: false },
) {
	const existing = activeGenerationsForSession(ctx);
	if (existing.length > 1) {
		notifyAmbiguousGeneration(ctx, existing);
		return false;
	}
	if (existing.length === 1) {
		notifyActiveGeneration(ctx, existing[0]);
		return false;
	}
	const language = runtimeLanguage();
	if (blockGenerationPromptIfPending(ctx, language)) return false;
	const stage = options.mode === "align" ? "aligning" : "generating";
	const request = persistedOriginalRequest(
		ctx,
		originalRequest,
		sourceType,
		language,
	);
	let shell: FlowLocation;
	let alignment: AlignmentState;
	try {
		shell = createPreDraftFlow(ctx.cwd, {
			language,
			status: stage,
			source: {
				type: sourceType,
				path: sourcePath ?? null,
				originalRequest: request,
			},
		});
		try {
			alignment = createAlignmentState(shell.dir, {
				stage,
				sessionFile: safeCurrentSessionFile(ctx),
				autoStart: options.autoStart,
			});
		} catch (error) {
			rollbackPreDraftShell(shell);
			throw error;
		}
	} catch (error) {
		ctx.ui.notify(`.flow 目录不可用：${formatError(error)}`, "error");
		return false;
	}
	notifyUser(
		ctx,
		language === "en"
			? `Flow ${shell.id} created; state saved.`
			: `Flow ${shell.id} 已创建，状态已保存。`,
		"info",
		language,
	);
	if (!(await switchToRoleModel(pi, ctx, "planner", language))) {
		cancelPreDraftShell(shell, [
			language === "en" ? "Planner model unavailable" : "计划模型不可用",
		]);
		deleteAlignmentState(shell.dir);
		generationContexts.delete(generationCacheKey(shell.dir));
		return false;
	}
	const cache = {
		startContext: ctx,
		source: shell.flow.source,
		createdAt: shell.flow.createdAt,
	};
	const active = { location: shell, alignment, cache, startContext: ctx };
	generationContexts.set(generationCacheKey(shell.dir), cache);
	setFlowActivity("goal", true, generationActivityId(shell.id));
	setGoalActivityBox(ctx, flowPendingBox(active));
	const prompt =
		options.mode === "align"
			? buildAlignmentPrompt({
					kind: "flow",
					language,
					originalRequest: request,
					source: sourceLabel({ sourceType, sourcePath }),
				})
			: flowGenerationPrompt(active);
	if (options.mode === "align") sendAlignmentStartCard(pi, ctx, "flow");
	const promptToken = nextGenerationPromptToken(active);
	const sent = await sendOrchestrationPrompt(
		pi,
		ctx,
		promptWithToken(prompt, promptToken),
		{
			errorPrefix: "Flow 计划提示发送失败",
			language,
		},
	);
	if (!sent) {
		recordGenerationFailure(active, ["Flow 计划提示发送失败"]);
		finishGeneration(active, ctx);
		return false;
	}
	rememberGenerationPromptTarget(active, ctx, promptToken);
	if (options.mode === "align") {
		notifyUser(
			ctx,
			language === "en"
				? `Flow ${shell.id} created; alignment started.`
				: `Flow ${shell.id} 已创建；开始对齐。`,
			"info",
			language,
		);
		return true;
	}
	notifyUser(
		ctx,
		language === "en"
			? `Flow ${shell.id} plan drafting started; it will be validated automatically when done.`
			: `Flow ${shell.id} 计划已开始撰写；完成后会自动校验。`,
		"info",
		language,
	);
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
	const prompted = consumeGenerationPromptTarget(ctx, event);
	if (prompted === null) return;
	const active = prompted ?? activeGenerationForSession(ctx);
	if (!active) return;
	setFlowActivity("goal", true, generationActivityId(active.location.id));
	let location: FlowLocation | undefined;
	try {
		const failedSemanticIds = new Set<string>();
		const semanticErrors: string[] = [];
		const built = tryBuildFlowFromSemantic(ctx.cwd, active, (id, error) => {
			const message = `Flow 计划草稿组装失败（${id}）：${formatError(error)}`;
			failedSemanticIds.add(id);
			semanticErrors.push(message);
			ctx.ui.notify(`${message}；将继续查找已有计划。`, "warning");
		});
		if (!built) {
			const assistantText = finalAssistantText(event?.messages ?? []);
			const staleLocation = generatedFlow(ctx.cwd, active);
			if (failedSemanticIds.has(active.location.id) && staleLocation)
				await repairInvalidFlow(pi, ctx, active, staleLocation, semanticErrors);
			else handleMissingFlow(ctx, active, assistantText);
			return undefined;
		}
		location = built;
	} catch (error) {
		ctx.ui.notify(`flow.json 读取失败：${formatError(error)}`, "error");
		recordGenerationFailure(active, [
			`flow.json 读取失败：${formatError(error)}`,
		]);
		finishGeneration(active, ctx);
		return;
	}
	if (!location) {
		handleMissingFlow(ctx, active, finalAssistantText(event?.messages ?? []));
		return undefined;
	}
	if (active.location.flow.status === "aligning") {
		ctx.ui.notify("对齐阶段不接受 Flow 计划；请继续对齐后再生成。", "error");
		cancelPreDraftFlow(active, ["对齐阶段不接受 Flow 计划"]);
		finishGeneration(active, ctx);
		return undefined;
	}
	const validation = validateFlowDir(
		location.dir,
		active.location.flow.language,
	);
	if (validation.ok && validation.flow) {
		const flow = touchFlowErrors(location.dir, validation.flow, []);
		deleteAlignmentState(location.dir);
		const html = writeFlowHtml(location.dir, flow);
		await openLiveHtmlOnce(pi, ctx, html, flow.language);
		if (!active.alignment.autoStart)
			notifyUser(ctx, generatedSummary(flow), "info", flow.language);
		finishGeneration(active, ctx);
		return {
			kind: "ready",
			id: flow.id,
			language: flow.language,
			autoStart: active.alignment.autoStart === true,
			startContext: startContextFor(active),
		};
	}
	await repairInvalidFlow(pi, ctx, active, location, validation.errors);
}

function generatedFlow(cwd: string, active: ActiveGeneration) {
	return findFlow(cwd, active.location.id);
}

function tryBuildFlowFromSemantic(
	cwd: string,
	active: ActiveGeneration,
	onError: (id: string, error: unknown) => void,
): FlowLocation | undefined {
	let built: FlowLocation | undefined;
	for (const id of [active.location.id]) {
		const dir = flowDir(cwd, id);
		const semanticPath = join(dir, "flow.semantic.json");
		if (!existsSync(semanticPath)) continue;
		try {
			const repairAttempts = currentRepairAttempts(dir);
			let flow = buildFlowArtifact(
				dir,
				semanticInput(semanticPath),
				active.location.flow.language,
				flowSource(active),
			);
			const flowPatch = { ...flow };
			if (
				active.cache?.createdAt !== undefined &&
				flow.createdAt !== active.cache.createdAt
			)
				flowPatch.createdAt = active.cache.createdAt;
			if (repairAttempts > flow.repairAttempts)
				flowPatch.repairAttempts = repairAttempts;
			if (
				flowPatch.createdAt !== flow.createdAt ||
				flowPatch.repairAttempts !== flow.repairAttempts
			)
				flow = writeFlow(dir, flowPatch);
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

function flowSource(active: ActiveGeneration): FlowSource {
	return active.cache?.source ?? active.location.flow.source;
}

function handleMissingFlow(
	ctx: Pick<ExtensionContext, "ui">,
	active: ActiveGeneration,
	assistantText: string,
) {
	if (active.location.flow.status === "aligning")
		return waitForAlignment(ctx, active, assistantText);
	if (hasNeedInput(assistantText)) return waitForBlockingInput(ctx, active);
	if (isGoalFlowRecommendation(assistantText)) return;
	ctx.ui.notify("AI 未生成有效 Flow 计划。请重试 /flow。", "error");
	recordGenerationFailure(active, ["AI 未生成有效 Flow 计划"]);
	finishGeneration(active, ctx);
}

function waitForAlignment(
	ctx: Pick<ExtensionContext, "ui">,
	active: ActiveGeneration,
	assistantText: string,
) {
	const next = mutableAlignment(active);
	const remembered = rememberQuestion(next, assistantText);
	const saved = saveGenerationStage(
		active,
		{
			...next,
			lastAlignmentQuestion: remembered,
			stage: hasReadyToDraft(assistantText)
				? "awaiting_final_confirm"
				: "awaiting_alignment_input",
		},
		"aligning",
	);
	if (saved) setGoalActivityBox(ctx, flowPendingBox(saved));
}

function waitForBlockingInput(
	ctx: Pick<ExtensionContext, "ui">,
	active: ActiveGeneration,
) {
	const saved = saveGenerationStage(
		active,
		{ ...active.alignment, stage: "awaiting_blocking_input" },
		"generating",
	);
	if (saved) setGoalActivityBox(ctx, flowPendingBox(saved));
}

export function clearFlowGeneration(
	ctx: Pick<ExtensionContext, "ui"> & {
		cwd: string;
		sessionManager?: unknown;
	},
	id?: string,
) {
	const active = generationTarget(ctx, id);
	if (active) {
		const language = active.location.flow.language;
		cancelPreDraftFlow(active);
		finishGeneration(active, ctx);
		return { language };
	}
	const target = preDraftTarget(ctx, id);
	if (target && cancelOrphanPreDraft(target.location))
		return { language: target.location.flow.language };
	return undefined;
}

export async function continueFlowGeneration(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	id?: string,
) {
	const found = generationTarget(ctx, id);
	if (!found) return false;
	if (
		isPromptedRecoveryStage(found.alignment.stage) &&
		blockGenerationPromptIfPending(ctx, found.location.flow.language)
	)
		return true;
	const restoresOtherSession =
		found.alignment.sessionFile !== safeCurrentSessionFile(ctx);
	const active = rebindGenerationSession(ctx, found);
	if (!active) return true;
	setFlowActivity("goal", true, generationActivityId(active.location.id));
	setGoalActivityBox(ctx, flowPendingBox(active));
	if (!isPromptedRecoveryStage(active.alignment.stage)) {
		rememberGenerationCache(active, ctx, restoresOtherSession, false);
		rememberGenerationReplyTarget(active, ctx);
		notifyUser(
			ctx,
			flowPendingSummary(active),
			"info",
			active.location.flow.language,
		);
		return true;
	}
	if (
		!(await switchToRoleModel(
			pi,
			ctx,
			"planner",
			active.location.flow.language,
		))
	)
		return true;
	const input = recoveryPrompt(active);
	const promptToken = nextGenerationPromptToken(active);
	const sent = await sendOrchestrationPrompt(
		pi,
		ctx,
		promptWithToken(input.prompt, promptToken),
		{
			followUp: true,
			errorPrefix: input.errorPrefix,
			language: active.location.flow.language,
		},
	);
	if (sent) {
		rememberGenerationCache(active, ctx);
		rememberGenerationPromptTarget(active, ctx, promptToken);
		rememberGenerationReplyTarget(active, ctx);
	} else
		recordGenerationFailure(active, [
			input.errorPrefix,
			...active.location.flow.errors,
		]);
	return true;
}

export function consumeFlowClarificationInput(
	text: string,
	ctx: Pick<ExtensionContext, "ui"> & {
		cwd: string;
		sessionManager?: unknown;
	},
): FlowClarificationAction | undefined {
	const clarification = text.trim();
	if (!clarification) return;
	if (clarification.startsWith("/")) return;
	const routed = generationReplyTarget(ctx);
	const matches = routed ? [routed] : activeGenerationsForSession(ctx);
	const active = routed ?? (matches.length === 1 ? matches[0] : undefined);
	if (matches.length > 1) {
		notifyAmbiguousGeneration(ctx, matches);
		return { kind: "handled", activityBox: undefined };
	}
	if (!active) return;
	if (blockGenerationPromptIfPending(ctx, active.location.flow.language))
		return { kind: "handled", activityBox: flowPendingBox(active) };
	setFlowActivity("goal", true, generationActivityId(active.location.id));
	try {
		if (active.alignment.stage === "awaiting_final_confirm") {
			if (isDraftConfirmation(clarification, active.location.flow.language))
				return confirmFlowDraft(active);
			return continueFlowAlignment(active, clarification);
		}
		if (active.alignment.stage === "awaiting_alignment_input") {
			if (
				isStartGenerationConfirmation(
					clarification,
					active.location.flow.language,
				)
			)
				return confirmFlowDraft(active);
			return continueFlowAlignment(active, clarification);
		}
		if (active.alignment.stage === "awaiting_blocking_input")
			return continueFlowPlanGeneration(active, clarification);
		return undefined;
	} catch (error) {
		notifyUser(
			ctx,
			active.location.flow.language === "en"
				? `Flow generation state save failed: ${formatError(error)}`
				: `Flow 生成状态保存失败：${formatError(error)}`,
			"error",
			active.location.flow.language,
		);
		return { kind: "handled", activityBox: flowPendingBox(active) };
	}
}

export function recordFlowPromptSendFailure(
	action: Extract<FlowClarificationAction, { kind: "prompt" }>,
	ctx: Pick<ExtensionContext, "ui"> & { cwd: string; sessionManager?: unknown },
) {
	const active = activeGenerationById(ctx, action.flowId);
	if (!active) return;
	recordGenerationFailure(active, ["Flow 计划澄清提示发送失败"]);
	finishGeneration(active, ctx);
}

export async function ensureFlowGenerationPromptModel(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "ui"> & {
		cwd: string;
		sessionManager?: unknown;
	},
	action: Extract<FlowClarificationAction, { kind: "prompt" }>,
) {
	const active = activeGenerationById(ctx, action.flowId);
	if (!active) return false;
	if (!needsPlannerSwitch(active, ctx)) return true;
	return switchToRoleModel(pi, ctx, "planner", active.location.flow.language);
}

export function rememberFlowGenerationPromptContext(
	action: Extract<FlowClarificationAction, { kind: "prompt" }>,
	ctx: Pick<ExtensionContext, "ui"> & {
		cwd: string;
		sessionManager?: unknown;
	},
) {
	const active = activeGenerationById(ctx, action.flowId);
	if (!active) return;
	rememberGenerationPromptTarget(active, ctx, action.promptToken);
	if (canStartNewSession(ctx)) rememberGenerationCache(active, ctx);
	else refreshGenerationCache(active);
}

function confirmFlowDraft(
	active: ActiveGeneration,
): FlowClarificationAction | undefined {
	const saved = saveGenerationStage(
		active,
		{ ...active.alignment, stage: "generating" },
		"generating",
		{ errors: [] },
	);
	if (!saved) return undefined;
	const promptToken = nextGenerationPromptToken(saved);
	return {
		kind: "prompt",
		flowId: saved.location.id,
		flowDir: saved.location.dir,
		activityBox: flowPendingBox(saved),
		showUserInput: true,
		prompt: promptWithToken(flowGenerationPrompt(saved), promptToken),
		promptToken,
	};
}

function continueFlowAlignment(
	active: ActiveGeneration,
	clarification: string,
): FlowClarificationAction | undefined {
	const next = mutableAlignment(active);
	const pending = {
		language: active.location.flow.language,
		alignmentTurns: next.alignmentTurns,
		lastAlignmentQuestion: next.lastAlignmentQuestion,
	};
	appendAlignmentAnswer(pending, clarification);
	const saved = saveGenerationStage(
		active,
		{
			...next,
			stage: "aligning",
			alignmentTurns: pending.alignmentTurns ?? [],
			lastAlignmentQuestion: pending.lastAlignmentQuestion ?? null,
		},
		"aligning",
		{ errors: [] },
	);
	if (!saved) return undefined;
	const promptToken = nextGenerationPromptToken(saved);
	return {
		kind: "prompt",
		flowId: saved.location.id,
		flowDir: saved.location.dir,
		activityBox: flowPendingBox(saved),
		showUserInput: true,
		prompt: promptWithToken(
			buildAlignmentFollowUpPrompt({
				language: saved.location.flow.language,
			}),
			promptToken,
		),
		promptToken,
	};
}

function continueFlowPlanGeneration(
	active: ActiveGeneration,
	clarification: string,
): FlowClarificationAction | undefined {
	const originalRequest = appendGenerationClarification(
		active.location.flow.source.originalRequest,
		clarification,
		active.location.flow.language,
	);
	const source = {
		...flowSource(active),
		originalRequest,
	};
	const saved = saveGenerationStage(
		active,
		{ ...active.alignment, stage: "generating" },
		"generating",
		{
			errors: [],
			source,
		},
	);
	if (active.cache) active.cache.source = source;
	if (!saved) return undefined;
	const promptToken = nextGenerationPromptToken(saved);
	return {
		kind: "prompt",
		flowId: saved.location.id,
		flowDir: saved.location.dir,
		activityBox: flowPendingBox(saved),
		showUserInput: true,
		prompt: promptWithToken(flowGenerationPrompt(saved), promptToken),
		promptToken,
	};
}

function cancelPreDraftShell(location: FlowLocation, errors: string[]) {
	writeFlow(location.dir, {
		...location.flow,
		status: "cancelled",
		errors,
	});
}

function rollbackPreDraftShell(location: FlowLocation) {
	rmSync(location.dir, { recursive: true, force: true });
}

function rollbackAlignmentTmp(flowDir: string) {
	rmSync(join(flowDir, "alignment.json.tmp"), {
		recursive: true,
		force: true,
	});
}

function cancelOrphanPreDraft(location: FlowLocation) {
	if (!isActivePreDraftFlow(location.flow)) return false;
	writeFlow(location.dir, {
		...location.flow,
		status: "cancelled",
	});
	generationContexts.delete(generationCacheKey(location.dir));
	forgetGenerationPromptTarget(location.dir);
	forgetGenerationReplyTarget(location.dir);
	return true;
}

function cancelPreDraftFlow(active: ActiveGeneration, errors: string[] = []) {
	const flow = readFlow(active.location.dir);
	if (!isGenerationOwnedStatus(flow.status)) return;
	writeFlow(active.location.dir, {
		schemaVersion: 8,
		language: flow.language,
		id: active.location.id,
		title: safeFlowTitle(flow, active.location.id),
		status: "cancelled",
		source: flowSource(active),
		createdAt: active.cache?.createdAt ?? flow.createdAt,
		updatedAt: Date.now(),
		startedAt: null,
		currentGoal: 0,
		parallelRun: null,
		repairAttempts: flow.repairAttempts,
		errors: errors.length ? errors : flow.errors,
		goals: [],
	});
	generationContexts.delete(generationCacheKey(active.location.dir));
	forgetGenerationPromptTarget(active.location.dir);
	forgetGenerationReplyTarget(active.location.dir);
}

function saveGenerationStage(
	active: ActiveGeneration,
	alignment: AlignmentState,
	status: "aligning" | "generating",
	flowPatch: Partial<FlowLocation["flow"]> = {},
): ActiveGeneration | undefined {
	const flow = readFlow(active.location.dir);
	if (!isActivePreDraftFlow(flow)) return undefined;
	const savedFlow = writeFlow(active.location.dir, {
		...flow,
		...flowPatch,
		status,
	});
	try {
		const savedAlignment = writeAlignmentState(active.location.dir, alignment);
		return {
			...active,
			location: { ...active.location, flow: savedFlow },
			alignment: savedAlignment,
		};
	} catch (error) {
		rollbackAlignmentTmp(active.location.dir);
		writeFlow(active.location.dir, flow);
		throw error;
	}
}

function recordGenerationFailure(active: ActiveGeneration, errors: string[]) {
	const flow = readFlow(active.location.dir);
	if (isActivePreDraftFlow(flow)) {
		writeFlow(active.location.dir, { ...flow, errors });
		return;
	}
	writeRecoverablePreDraft(active, flow, errors, flow.repairAttempts);
}

function isActivePreDraftFlow(flow: FlowLocation["flow"]) {
	return (
		Array.isArray(flow.goals) &&
		flow.goals.length === 0 &&
		(flow.status === "aligning" || flow.status === "generating")
	);
}

async function repairInvalidFlow(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	active: ActiveGeneration,
	location: FlowLocation,
	errors: string[],
) {
	const flow = location.flow;
	const baseAttempts = Number.isInteger(flow.repairAttempts)
		? flow.repairAttempts
		: active.location.flow.repairAttempts;
	const attempts = baseAttempts + 1;
	setGoalActivityBox(ctx, flowDraftBox("计划修复中", `错误：${errors[0]}`));
	const saved = writeRecoverablePreDraft(active, flow, errors, attempts);
	if (!saved) return;
	let savedAlignment: AlignmentState;
	try {
		savedAlignment = writeAlignmentState(active.location.dir, {
			...active.alignment,
			stage: "generating",
		});
	} catch (error) {
		rollbackAlignmentTmp(active.location.dir);
		writeFlow(active.location.dir, active.location.flow);
		notifyUser(
			ctx,
			active.location.flow.language === "en"
				? `Flow repair state save failed: ${formatError(error)}`
				: `Flow 计划修复状态保存失败：${formatError(error)}`,
			"error",
			active.location.flow.language,
		);
		return;
	}
	const nextActive = {
		...active,
		location: { ...active.location, flow: saved },
		alignment: savedAlignment,
	};
	const language = saved.language ?? active.location.flow.language;
	writeFlowErrorHtml(location.dir, {
		title: safeFlowTitle(flow, location.id),
		errors,
		originalRequest: safeOriginalRequest(
			saved,
			flowSource(active).originalRequest,
		),
		language,
	});
	if (attempts > 3) {
		ctx.ui.notify(
			`Flow 校验失败，自动修复已达 3 轮：\n${errors.join("\n")}`,
			"error",
		);
		finishGeneration(nextActive, ctx);
		return;
	}
	if (!(await switchToRoleModel(pi, ctx, "planner", language))) {
		finishGeneration(nextActive, ctx);
		return;
	}
	if (!isStillActive(nextActive)) return;
	const promptToken = nextGenerationPromptToken(nextActive);
	const sent = await sendOrchestrationPrompt(
		pi,
		ctx,
		promptWithToken(
			repairPrompt({
				errors,
				originalRequest: safeOriginalRequest(
					saved,
					flowSource(active).originalRequest,
				),
				flowPath: location.dir,
				language,
			}),
			promptToken,
		),
		{ followUp: true, errorPrefix: "Flow 计划修复提示发送失败", language },
	);
	if (sent) {
		refreshGenerationCache(nextActive);
		rememberGenerationPromptTarget(nextActive, ctx, promptToken);
		return;
	}
	recordGenerationFailure(nextActive, ["Flow 计划修复提示发送失败", ...errors]);
	finishGeneration(nextActive, ctx);
}

function writeRecoverablePreDraft(
	active: ActiveGeneration,
	flow: FlowLocation["flow"],
	errors: string[],
	repairAttempts: number,
) {
	const current = readFlow(active.location.dir);
	if (current.status === "cancelled") return undefined;
	return writeFlow(active.location.dir, {
		schemaVersion: 8,
		language: flow.language ?? active.location.flow.language,
		id: active.location.id,
		title: safeFlowTitle(flow, active.location.id),
		status: "generating",
		source: flowSource(active),
		createdAt:
			active.cache?.createdAt ??
			(Number.isFinite(current.createdAt)
				? current.createdAt
				: active.location.flow.createdAt),
		updatedAt: Date.now(),
		startedAt: null,
		currentGoal: 0,
		parallelRun: null,
		repairAttempts,
		errors,
		goals: [],
	});
}

function activeGenerationForSession(ctx: {
	cwd: string;
	sessionManager?: unknown;
}) {
	const matches = activeGenerationsForSession(ctx);
	return matches.length === 1 ? matches[0] : undefined;
}

function blockGenerationPromptIfPending(
	ctx: Pick<ExtensionContext, "ui"> & { sessionManager?: unknown },
	language: Language,
) {
	const sessionFile = safeCurrentSessionFile(ctx);
	const targets = sessionFile
		? generationPromptTargets.get(sessionFile)
		: undefined;
	if (!sessionFile || !targets?.length) return false;
	if (
		!normalizePromptTargets(sessionFile, targets).some(
			(target) => !target.stale,
		)
	)
		return false;
	notifyUser(
		ctx,
		language === "en"
			? "A Flow plan request is already waiting for AI output in this conversation. Wait for it to finish, or use another conversation before continuing."
			: "当前对话已有 Flow 计划提示正在等待 AI 返回；请等它收口后再继续，或换一个对话。",
		"warning",
		language,
	);
	return true;
}

function consumeGenerationPromptTarget(
	ctx: { sessionManager?: unknown },
	event?: { messages?: unknown[] },
): ActiveGeneration | null | undefined {
	const sessionFile = safeCurrentSessionFile(ctx);
	const targets = sessionFile
		? generationPromptTargets.get(sessionFile)
		: undefined;
	if (!sessionFile || !targets?.length) return undefined;
	const normalized = normalizePromptTargets(sessionFile, targets);
	const liveIndex = normalized.findIndex((target) => !target.stale);
	if (liveIndex >= 0) {
		const target = normalized[liveIndex];
		const active = activePromptTarget(target, sessionFile);
		if (!active) {
			forgetPromptTargetAt(sessionFile, normalized, liveIndex);
			return null;
		}
		if (liveIndex === 0 || livePromptHasResult(active, target, event)) {
			forgetPromptTargetAt(sessionFile, normalized, liveIndex);
			return active;
		}
	}
	const staleIndex = normalized.findIndex((target) => target.stale);
	if (staleIndex >= 0) {
		forgetPromptTargetAt(sessionFile, normalized, staleIndex);
		return null;
	}
	return undefined;
}

function activePromptTarget(
	target: GenerationPromptTarget | undefined,
	sessionFile: string,
) {
	if (!target) return undefined;
	const active = activeGenerationFromDir(target.dir);
	if (!active || active.alignment.sessionFile !== sessionFile) return undefined;
	return active;
}

function livePromptHasResult(
	active: ActiveGeneration,
	target: GenerationPromptTarget,
	event?: { messages?: unknown[] },
) {
	if (existsSync(join(active.location.dir, "flow.semantic.json"))) return true;
	const assistantText = finalAssistantText(event?.messages ?? []);
	if (!assistantText.trim()) return false;
	return promptTokenInText(assistantText) === target.token;
}

function promptTokenInText(text: string) {
	return PROMPT_TOKEN_PATTERN.exec(text)?.[1];
}

function normalizePromptTargets(
	sessionFile: string,
	targets: GenerationPromptTarget[],
) {
	let changed = false;
	const normalized = targets.map((target) => {
		if (target.stale || activePromptTarget(target, sessionFile)) return target;
		changed = true;
		return { ...target, stale: true };
	});
	if (changed) generationPromptTargets.set(sessionFile, normalized);
	return normalized;
}

function forgetPromptTargetAt(
	sessionFile: string,
	targets: GenerationPromptTarget[],
	index: number,
) {
	const remaining = targets.filter((_target, offset) => offset !== index);
	if (remaining.length) generationPromptTargets.set(sessionFile, remaining);
	else generationPromptTargets.delete(sessionFile);
}

function generationReplyTarget(ctx: { sessionManager?: unknown }) {
	const sessionFile = safeCurrentSessionFile(ctx);
	if (!sessionFile) return undefined;
	const dir = generationReplyTargets.get(sessionFile);
	if (!dir) return undefined;
	const active = activeGenerationFromDir(dir);
	if (!active || active.alignment.sessionFile !== sessionFile) {
		generationReplyTargets.delete(sessionFile);
		return undefined;
	}
	return active;
}

function rememberGenerationPromptTarget(
	active: ActiveGeneration,
	ctx: { sessionManager?: unknown },
	token: string,
) {
	const sessionFile = safeCurrentSessionFile(ctx);
	if (!sessionFile) return;
	generationPromptTargets.set(sessionFile, [
		...(generationPromptTargets.get(sessionFile) ?? []),
		{ dir: active.location.dir, stale: false, token },
	]);
}

function rememberGenerationReplyTarget(
	active: ActiveGeneration,
	ctx: { sessionManager?: unknown },
) {
	const sessionFile = safeCurrentSessionFile(ctx);
	if (sessionFile) generationReplyTargets.set(sessionFile, active.location.dir);
}

function forgetGenerationPromptTarget(dir: string) {
	for (const [sessionFile, targets] of generationPromptTargets) {
		generationPromptTargets.set(
			sessionFile,
			targets.map((target) =>
				target.dir === dir ? { ...target, stale: true } : target,
			),
		);
	}
}

function forgetGenerationReplyTarget(dir: string) {
	for (const [sessionFile, targetDir] of generationReplyTargets) {
		if (targetDir === dir) generationReplyTargets.delete(sessionFile);
	}
}

function activeGenerationsForSession(ctx: {
	cwd: string;
	sessionManager?: unknown;
}) {
	const sessionFile = safeCurrentSessionFile(ctx);
	try {
		return listFlows(ctx.cwd)
			.flatMap((location) => activeGenerationFromLocation(location))
			.filter(
				(active): active is ActiveGeneration =>
					active !== undefined && active.alignment.sessionFile === sessionFile,
			);
	} catch {
		return [];
	}
}

function activeGenerationById(ctx: { cwd: string }, id: string) {
	try {
		const location = findFlow(ctx.cwd, id);
		return location ? activeGenerationFromLocation(location) : undefined;
	} catch {
		return undefined;
	}
}

function activeGenerationFromDir(dir: string) {
	try {
		const flow = readFlow(dir);
		return activeGenerationFromLocation({
			id: flow.id,
			dir,
			jsonPath: flowJsonPath(dir),
			flow,
		});
	} catch {
		return undefined;
	}
}

function generationTarget(
	ctx: { cwd: string; sessionManager?: unknown },
	id?: string,
) {
	if (id) {
		const active = activeGenerationById(ctx, id);
		return active && isActivePreDraftFlow(active.location.flow)
			? active
			: undefined;
	}
	const target = preDraftTarget(ctx);
	return target ? activeGenerationFromLocation(target.location) : undefined;
}

function preDraftTarget(
	ctx: { cwd: string; sessionManager?: unknown },
	id?: string,
) {
	try {
		const target = resolveFlowTarget(ctx, id);
		if (!target.ok) return undefined;
		return isActivePreDraftFlow(target.location.flow) ? target : undefined;
	} catch {
		return undefined;
	}
}

function activeGenerationFromLocation(
	location: FlowLocation,
): ActiveGeneration | undefined {
	const alignment = tryReadAlignmentState(location.dir);
	if (!alignment || !isGenerationOwnedStatus(location.flow.status))
		return undefined;
	const cache = generationContexts.get(generationCacheKey(location.dir));
	return {
		location,
		alignment,
		cache,
		startContext: cache?.startContext,
	};
}

function rebindGenerationSession(
	ctx: Pick<ExtensionContext, "ui"> & { sessionManager?: unknown },
	active: ActiveGeneration,
): ActiveGeneration | undefined {
	const sessionFile = safeCurrentSessionFile(ctx);
	if (active.alignment.sessionFile === sessionFile) return active;
	try {
		const alignment = writeAlignmentState(active.location.dir, {
			...active.alignment,
			sessionFile,
		});
		forgetGenerationPromptTarget(active.location.dir);
		return { ...active, alignment };
	} catch (error) {
		notifyUser(
			ctx,
			active.location.flow.language === "en"
				? `Flow generation state save failed: ${formatError(error)}`
				: `Flow 生成状态保存失败：${formatError(error)}`,
			"error",
			active.location.flow.language,
		);
		return undefined;
	}
}

function isGenerationOwnedStatus(status: FlowLocation["flow"]["status"]) {
	return status === "aligning" || status === "generating" || status === "draft";
}

function isStillActive(active: ActiveGeneration) {
	const flow = readFlow(active.location.dir);
	if (!isActivePreDraftFlow(flow)) return false;
	const alignment = tryReadAlignmentState(active.location.dir);
	return alignment?.sessionFile === active.alignment.sessionFile;
}

function safeCurrentSessionFile(ctx: { sessionManager?: unknown }) {
	try {
		return currentSessionFile(ctx) ?? null;
	} catch {
		return null;
	}
}

function persistedOriginalRequest(
	ctx: { sessionManager?: unknown },
	originalRequest: string,
	sourceType: FlowSourceType,
	language: Language,
) {
	if (originalRequest.trim() || sourceType !== "conversation")
		return originalRequest;
	return (
		buildTranscript(sessionEntries(ctx), {
			maxUser: 2000,
			maxAssistant: 2000,
			maxTranscript: 6000,
		}) || defaultConversationRequest(language)
	);
}

function defaultConversationRequest(language: Language) {
	return language === "en"
		? "(no explicit argument; generate from the current conversation context)"
		: "（无显式参数；根据当前会话上下文生成）";
}

function recoveryPrompt(active: ActiveGeneration) {
	if (active.alignment.stage === "aligning") {
		if (active.alignment.alignmentTurns.length > 0)
			return {
				prompt: buildAlignmentFollowUpPrompt({
					language: active.location.flow.language,
				}),
				errorPrefix: "Flow 计划澄清提示发送失败",
			};
		return {
			prompt: buildAlignmentPrompt({
				kind: "flow",
				language: active.location.flow.language,
				originalRequest: flowSource(active).originalRequest,
				source: sourceLabel({
					sourceType: flowSource(active).type,
					sourcePath: flowSource(active).path ?? undefined,
				}),
			}),
			errorPrefix: "Flow 计划提示发送失败",
		};
	}
	if (shouldRepairOnContinue(active))
		return {
			prompt: repairPrompt({
				errors: active.location.flow.errors,
				originalRequest: flowSource(active).originalRequest,
				flowPath: active.location.dir,
				language: active.location.flow.language,
			}),
			errorPrefix: "Flow 计划修复提示发送失败",
		};
	return {
		prompt: flowGenerationPrompt(active),
		errorPrefix: "Flow 计划提示发送失败",
	};
}

function shouldRepairOnContinue(active: ActiveGeneration) {
	return active.location.flow.repairAttempts > 0;
}

function needsPlannerSwitch(
	active: ActiveGeneration,
	ctx: { sessionManager?: unknown },
) {
	if (!active.cache || active.cache.plannerReady === false) return true;
	return (
		safeCurrentSessionFile(active.cache.startContext) !==
		safeCurrentSessionFile(ctx)
	);
}

function canStartNewSession(ctx: unknown): ctx is ExtensionCommandContext {
	return typeof (ctx as { newSession?: unknown }).newSession === "function";
}

function refreshGenerationCache(active: ActiveGeneration) {
	if (!active.cache) return;
	generationContexts.set(generationCacheKey(active.location.dir), {
		...active.cache,
		source: flowSource(active),
		plannerReady: true,
	});
}

function isPromptedRecoveryStage(stage: AlignmentState["stage"]) {
	return stage === "aligning" || stage === "generating";
}

function rememberGenerationCache(
	active: ActiveGeneration,
	startContext: ExtensionCommandContext,
	restoredAlignmentContext = false,
	plannerReady = true,
) {
	generationContexts.set(generationCacheKey(active.location.dir), {
		startContext,
		source: flowSource(active),
		createdAt: active.location.flow.createdAt,
		restoredAlignmentContext,
		plannerReady,
	});
}

function flowGenerationPrompt(active: ActiveGeneration) {
	const source = flowSource(active);
	return generationPrompt({
		originalRequest: source.originalRequest,
		sourceType: source.type,
		sourcePath: source.path ?? undefined,
		language: active.location.flow.language,
		flowPath: active.location.dir,
		restoredAlignmentContext: restoredAlignmentContext(active),
	});
}

function restoredAlignmentContext(active: ActiveGeneration) {
	if (active.alignment.alignmentTurns.length === 0) return undefined;
	if (!active.cache || active.cache.restoredAlignmentContext)
		return active.alignment.alignmentTurns;
	return safeCurrentSessionFile(active.cache.startContext) ===
		active.alignment.sessionFile
		? undefined
		: active.alignment.alignmentTurns;
}

function notifyActiveGeneration(
	ctx: Pick<ExtensionContext, "ui">,
	active: ActiveGeneration,
) {
	const language = active.location.flow.language;
	const id = flowCommandId(active.location.id);
	setGoalActivityBox(ctx, flowPendingBox(active));
	notifyUser(
		ctx,
		language === "en"
			? `Current session already has unfinished Flow plan generation: ${id}. Run /flow status ${id}, or /flow cancel ${id} to cancel it.`
			: `当前会话已有未完成的 Flow 计划生成：${id}。运行 /flow status ${id} 查看，或 /flow cancel ${id} 取消。`,
		"warning",
		language,
	);
}

function notifyAmbiguousGeneration(
	ctx: Pick<ExtensionContext, "ui">,
	items: ActiveGeneration[],
) {
	const language = items[0]?.location.flow.language ?? runtimeLanguage();
	const choices = items
		.map((active) => {
			const id = flowCommandId(active.location.id);
			return `- ${id} · /flow continue ${id}`;
		})
		.join("\n");
	notifyUser(
		ctx,
		language === "en"
			? `Current session has multiple unfinished Flow generations. Specify one:\n${choices}`
			: `当前会话有多个未完成的 Flow 计划生成，请指定目标：\n${choices}`,
		"warning",
		language,
	);
}

function mutableAlignment(active: ActiveGeneration): AlignmentState {
	return {
		...active.alignment,
		alignmentTurns: [...active.alignment.alignmentTurns],
	};
}

function rememberQuestion(alignment: AlignmentState, assistantText: string) {
	const pending = {
		language: "zh" as const,
		lastAlignmentQuestion: alignment.lastAlignmentQuestion,
	};
	rememberAlignmentQuestion(pending, stripPromptTokens(assistantText));
	return pending.lastAlignmentQuestion ?? alignment.lastAlignmentQuestion;
}

function startContextFor(active: ActiveGeneration) {
	return active.startContext;
}

function generationActivityId(flowId: string) {
	return `${FLOW_DRAFT_ACTIVITY}:${flowId}`;
}

function generationCacheKey(dir: string) {
	return dir;
}

function nextGenerationPromptToken(active: ActiveGeneration) {
	generationPromptSequence += 1;
	return `${active.location.id.toLowerCase()}-${Date.now().toString(36)}-${generationPromptSequence.toString(36)}`;
}

function promptWithToken(prompt: string, token: string) {
	return `${prompt}\n\n<!-- pi-flow:prompt:${token} -->\nWhen your final response asks for more input or continues alignment, include the exact marker above once. Do not write this marker into files.`;
}

function stripPromptTokens(text: string) {
	return text.replace(PROMPT_TOKEN_PATTERN, "").trim();
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
	active: ActiveGeneration | undefined,
	ctx: Pick<ExtensionContext, "ui">,
) {
	if (!active) return;
	generationContexts.delete(generationCacheKey(active.location.dir));
	forgetGenerationPromptTarget(active.location.dir);
	forgetGenerationReplyTarget(active.location.dir);
	setFlowActivity("goal", false, generationActivityId(active.location.id));
	setGoalActivityBox(ctx, undefined);
}

function flowPendingBox(active: ActiveGeneration) {
	const questionNumber = active.alignment.alignmentTurns.length + 1;
	const copy = generationAlignmentActivityCopy(
		active.alignment.stage,
		active.location.flow.language,
		questionNumber,
	);
	return flowDraftBox(copy.phase, copy.rows);
}

function flowPendingSummary(active: ActiveGeneration) {
	return generationAlignmentSummary(
		active.alignment.stage,
		active.location.flow.language,
		active.alignment.alignmentTurns.length + 1,
	);
}

function flowDraftBox(phase: string, rows: string | string[] = []) {
	return generationDraftBox(`🌊 Flow · ${phase}`, rows);
}

function generatedSummary(flow: {
	id: string;
	language: Language;
	goals: { index: number; title: string }[];
}) {
	const id = flowCommandId(flow.id);
	if (flow.language === "en")
		return [
			`Flow plan generated: ${flow.id}`,
			...flow.goals.map(
				(goal) => `- ${flowStepLabel(goal.index, goal.title, flow.language)}`,
			),
			`Next: /flow start ${id}`,
		].join("\n");
	return [
		`Flow 计划已生成：${flow.id}`,
		...flow.goals.map(
			(goal) => `- ${flowStepLabel(goal.index, goal.title, flow.language)}`,
		),
		`下一步：/flow start ${id}`,
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
