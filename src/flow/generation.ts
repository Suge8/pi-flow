import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
import { requestPiAttention } from "../shared/activity-signal.js";
import { type Language, readFlowConfig } from "../shared/config.js";
import {
	buildContextEvidence,
	formatTranscript,
} from "../shared/context-evidence.js";
import {
	buildAlignmentFollowUpPrompt,
	buildAlignmentPrompt,
	type GenerationStartOptions,
	generationAlignmentActivityCopy,
	generationAlignmentSummary,
	hasNeedInput,
	hasReadyToDraft,
} from "../shared/generation-alignment.js";
import { sendAlignmentStartCard } from "../shared/generation-card.js";
import {
	type AlignmentState,
	appendAlignmentAnswer,
	appendGenerationClarification,
	deleteAlignmentState,
	generationDraftBox,
	readAlignmentStateIfExists,
	rememberAlignmentQuestion,
	writeAlignmentState,
} from "../shared/generation-state.js";
import { formatError, isRecord } from "../shared/guards.js";
import { sendOrchestrationPrompt } from "../shared/internal-prompt.js";
import { runtimeLanguage } from "../shared/language.js";
import {
	currentSessionModel,
	switchToRoleModel,
} from "../shared/model-roles.js";
import { flowStepLabel } from "../shared/progress-labels.js";
import { openLiveHtmlInBackgroundOnce } from "../shared/report-client.js";
import {
	assistantMessageText,
	currentSessionFile,
	finalAssistantText,
	sessionEntries,
} from "../shared/session.js";
import { formatUserNotice, notifyUser } from "../shared/ui-language.js";
import { buildFlowArtifact, type FlowSemanticInput } from "./builder.js";
import {
	refreshFlowErrorHtmlProjection,
	refreshFlowHtmlProjection,
} from "./html.js";
import {
	type FlowLockOwner,
	flowLockBusyMessage,
	watchFlowLockRelease,
	withFlowLockSync,
} from "./lock.js";
import { quoteCommand } from "./parallel/console.js";
import { rememberGenerationSession } from "./prewalk.js";
import { generationPrompt, repairPrompt } from "./prompt.js";
import {
	createPreDraftFlow,
	findFlow,
	flowDir,
	flowJsonPath,
	listFlows,
	readFlow,
	writeFlow,
} from "./store.js";
import { resolveFlowTarget } from "./target.js";
import type {
	FlowAlignment,
	FlowLocation,
	FlowSource,
	FlowSourceType,
	FlowStatus,
} from "./types.js";
import { FLOW_SCHEMA_VERSION } from "./types.js";
import { flowCommandId } from "./util.js";
import { validateFlowDir } from "./validator.js";
import { flowWorkspaceHint } from "./workspace-hint.js";

interface ActiveGeneration {
	location: FlowLocation;
	alignment: AlignmentState;
	cache?: GenerationCache;
}

interface GenerationCache {
	sessionFile: string | null;
	source: FlowSource;
	createdAt: number;
	restoredAlignmentContext?: boolean;
	plannerReady?: boolean;
}

interface GenerationPromptTarget {
	dir: string;
	revision: number;
	stale: boolean;
	token: string;
}

interface GenerationReplyTarget {
	dir: string;
	revision: number;
}

interface GenerationDeliveryToken {
	revision: number;
	sessionFile: string | null;
	token: string;
}

type GenerationMutationResult<Value> =
	| { kind: "applied"; value: Value }
	| { kind: "stale" }
	| { kind: "locked"; owner: FlowLockOwner | undefined };

interface GenerationMutationOptions {
	promptToken?: string;
	statuses?: readonly FlowStatus[];
}

type FlowGenerationPromptAction = {
	kind: "prompt";
	prompt: string;
	promptToken: string;
	flowId: string;
	flowDir: string;
	revision: number;
	activityBox?: ReturnType<typeof generationDraftBox>;
	showUserInput?: boolean;
};

export type FlowClarificationAction =
	| FlowGenerationPromptAction
	| {
			kind: "pending";
			continuation: Promise<FlowGenerationPromptAction | undefined>;
			activityBox?: ReturnType<typeof generationDraftBox>;
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
}

const FLOW_DRAFT_ACTIVITY = "flow-draft";
const PROMPT_TOKEN_PATTERN = /<!--\s*pi-flow:prompt:([a-z0-9_-]+)\s*-->/iu;
const PROMPT_TOKEN_STRIP_PATTERN = /<!--\s*pi-flow:prompt:[a-z0-9_-]+\s*-->/giu;
const generationContexts = new Map<string, GenerationCache>();
const generationPromptTargets = new Map<string, GenerationPromptTarget[]>();
const generationReplyTargets = new Map<string, GenerationReplyTarget>();
const generationPromptResultTokens = new Map<string, string[]>();
const generationDeliveryTokens = new Map<string, GenerationDeliveryToken>();
const generationLockWaiters = new Map<string, Promise<void>>();
let generationPromptSequence = 0;

export function resetFlowGenerationRuntime() {
	for (const dir of generationContexts.keys()) {
		const flowId = activeGenerationFromDir(dir)?.location.id;
		if (flowId) setFlowActivity("goal", false, generationActivityId(flowId));
	}
	generationContexts.clear();
	generationPromptTargets.clear();
	generationReplyTargets.clear();
	generationPromptResultTokens.clear();
	generationDeliveryTokens.clear();
	generationLockWaiters.clear();
	generationPromptSequence = 0;
}

export function flowGenerationResourceCounts() {
	return {
		contexts: generationContexts.size,
		promptTargets: [...generationPromptTargets.values()].reduce(
			(count, targets) => count + targets.length,
			0,
		),
		stalePromptTargets: [...generationPromptTargets.values()].reduce(
			(count, targets) =>
				count + targets.filter((target) => target.stale).length,
			0,
		),
		replyTargets: generationReplyTargets.size,
		resultTokens: [...generationPromptResultTokens.values()].reduce(
			(count, tokens) => count + tokens.length,
			0,
		),
	};
}

function withGenerationMutation<Value>(
	expected: ActiveGeneration,
	action: string,
	mutate: (current: ActiveGeneration) => Value,
	options: GenerationMutationOptions = {},
): GenerationMutationResult<Value> {
	const locked = withFlowLockSync(expected.location.dir, action, () => {
		const flow = readFlow(expected.location.dir);
		const alignment = readAlignmentStateIfExists(expected.location.dir);
		const statuses = options.statuses ?? ["aligning", "generating"];
		if (
			flow.id !== expected.location.id ||
			!alignment ||
			alignment.updatedAt !== expected.alignment.updatedAt ||
			alignment.sessionFile !== expected.alignment.sessionFile ||
			!statuses.includes(flow.status) ||
			(options.promptToken !== undefined &&
				!generationDeliveryTokenMatches(expected, options.promptToken))
		)
			return { kind: "stale" } as const;
		const current = {
			...expected,
			location: { ...expected.location, flow },
			alignment,
		};
		try {
			return { kind: "applied", value: mutate(current) } as const;
		} catch (error) {
			for (const name of ["alignment.json.tmp", "flow.json.tmp"])
				rmSync(join(expected.location.dir, name), {
					recursive: true,
					force: true,
				});
			throw error;
		}
	});
	return locked.ok ? locked.value : { kind: "locked", owner: locked.owner };
}

async function retryGenerationMutation<Value>(
	expected: ActiveGeneration,
	ctx: Pick<ExtensionContext, "ui">,
	action: string,
	mutate: (current: ActiveGeneration) => Value,
	options: GenerationMutationOptions = {},
) {
	let result = withGenerationMutation(expected, action, mutate, options);
	if (result.kind !== "locked") return result;
	await waitForGenerationLock(expected);
	result = withGenerationMutation(expected, action, mutate, options);
	if (result.kind === "locked")
		notifyUser(
			ctx,
			flowLockBusyMessage(result.owner, expected.location.flow.language),
			"info",
			expected.location.flow.language,
		);
	return result;
}

async function sendGenerationPrompt(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "ui">,
	active: ActiveGeneration,
	promptToken: string,
	prompt: string,
	input: Parameters<typeof sendOrchestrationPrompt>[3],
	action: string,
) {
	try {
		return await retryGenerationMutation(
			active,
			ctx,
			action,
			(current) => {
				const alignment = writeAlignmentState(
					current.location.dir,
					current.alignment,
				);
				const claimed = { ...current, alignment };
				return {
					active: claimed,
					sent: sendOrchestrationPrompt(pi, ctx, prompt, input),
				};
			},
			{ promptToken },
		);
	} finally {
		forgetGenerationDeliveryToken(active.location.dir, promptToken);
	}
}

function queueGenerationMutation<Value>(
	expected: ActiveGeneration,
	ctx: Pick<ExtensionContext, "ui">,
	action: string,
	mutate: (current: ActiveGeneration) => Value,
	options: GenerationMutationOptions = {},
) {
	const result = withGenerationMutation(expected, action, mutate, options);
	if (result.kind !== "locked") return result;
	const continuation = waitForGenerationLock(expected)
		.then(() => withGenerationMutation(expected, action, mutate, options))
		.then((retried) => {
			if (retried.kind === "locked")
				notifyUser(
					ctx,
					flowLockBusyMessage(retried.owner, expected.location.flow.language),
					"info",
					expected.location.flow.language,
				);
			return retried;
		})
		.catch((error) => {
			notifyUser(
				ctx,
				flowGenerationStateSaveFailedNotice(
					formatError(error),
					expected.location.flow.language,
				),
				"info",
				expected.location.flow.language,
			);
			return { kind: "stale" } as const;
		});
	return { ...result, continuation };
}

function waitForGenerationLock(expected: ActiveGeneration) {
	const key = `${expected.location.dir}:${expected.alignment.updatedAt}`;
	const waiting = generationLockWaiters.get(key);
	if (waiting) return waiting;
	const created = new Promise<void>((resolveWait, rejectWait) => {
		try {
			watchFlowLockRelease(expected.location.dir, resolveWait);
		} catch (error) {
			rejectWait(error);
		}
	}).finally(() => generationLockWaiters.delete(key));
	generationLockWaiters.set(key, created);
	return created;
}

export function cancelFlowGeneration(
	ctx: Pick<ExtensionContext, "ui">,
	dir: string,
	flowId: string,
) {
	if (!hasGenerationState(dir)) return false;
	cleanupGenerationState(dir);
	setFlowActivity("goal", false, generationActivityId(flowId));
	setGoalActivityBox(ctx, undefined);
	return true;
}

export function releaseFlowGenerationSession(
	ctx: Pick<ExtensionContext, "ui"> & { sessionManager?: unknown },
) {
	const sessionFile = safeCurrentSessionFile(ctx);
	if (!sessionFile) return;
	let released = false;
	for (const dir of generationContexts.keys()) {
		if (!generationCacheBelongsToSession(dir, sessionFile)) continue;
		const flowId = activeGenerationFromDir(dir)?.location.id;
		generationContexts.delete(dir);
		forgetGenerationDeliveryToken(dir);
		if (flowId) setFlowActivity("goal", false, generationActivityId(flowId));
		released = true;
	}
	const promptTargets = generationPromptTargets.get(sessionFile);
	if (promptTargets?.length) {
		released = true;
		storeGenerationPromptTargets(
			sessionFile,
			promptTargets.map((target) => ({ ...target, stale: true })),
		);
	}
	if (generationReplyTargets.delete(sessionFile)) released = true;
	generationPromptResultTokens.delete(sessionFile);
	if (released) setGoalActivityBox(ctx, undefined);
}

export async function startGeneration(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	requestText: string,
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
	const requestResult = generationRequests(
		ctx,
		requestText,
		sourceType,
		sourcePath,
		language,
		options,
	);
	if (!requestResult.ok) {
		notifyUser(
			ctx,
			flowContextEvidenceUnavailableNotice(requestResult.message, language),
			"info",
			language,
		);
		return false;
	}
	let shell: FlowLocation;
	let alignment: AlignmentState;
	try {
		const created = createPreDraftFlow(ctx.cwd, {
			language,
			status: stage,
			source: requestResult.source,
			sessionFile: safeCurrentSessionFile(ctx),
			autoStart: options.autoStart,
			depth: options.depth ?? "standard",
		});
		shell = created;
		alignment = created.alignment;
	} catch (error) {
		notifyUser(
			ctx,
			flowDirUnavailableNotice(formatError(error), language),
			"info",
			language,
		);
		return false;
	}
	const workspaceHint = flowWorkspaceHint(ctx.cwd, language);
	if (workspaceHint) notifyUser(ctx, workspaceHint, "info", language);
	const cache = {
		sessionFile: safeCurrentSessionFile(ctx),
		source: shell.flow.source,
		createdAt: shell.flow.createdAt,
	};
	const active = { location: shell, alignment, cache };
	generationContexts.set(generationCacheKey(shell.dir), cache);
	if (!(await switchToRoleModel(pi, ctx, "advisor", language))) {
		await cancelPreDraftFlow(active, ctx, [
			language === "en" ? "Planner model unavailable" : "计划模型不可用",
		]);
		generationContexts.delete(generationCacheKey(shell.dir));
		return false;
	}
	setFlowActivity("goal", true, generationActivityId(shell.id));
	setGoalActivityBox(ctx, flowPendingBox(active));
	const prompt =
		options.mode === "align"
			? buildAlignmentPrompt({
					kind: "flow",
					language,
					requestText: requestResult.requestText,
					source: sourceLabel({ sourceType, sourcePath }),
					depth: alignment.depth,
				})
			: flowGenerationPrompt(active);
	if (options.mode === "align")
		sendAlignmentStartCard(pi, ctx, "flow", flowCommandId(shell.id));
	const promptToken = nextGenerationPromptToken(active);
	const delivered = await sendGenerationPrompt(
		pi,
		ctx,
		active,
		promptToken,
		promptWithToken(prompt, promptToken),
		{
			errorPrefix: "Flow 计划提示发送失败",
			errorDetails: [flowIdLine(shell.id, language)],
			language,
		},
		`send generation prompt ${active.location.id}`,
	);
	if (delivered.kind !== "applied") return false;
	if (!delivered.value.sent) {
		await recordGenerationFailure(delivered.value.active, ctx, [
			"Flow 计划提示发送失败",
		]);
		finishGeneration(delivered.value.active, ctx);
		return false;
	}
	rememberGenerationPromptTarget(delivered.value.active, ctx, promptToken);
	if (options.mode === "align") return true;
	notifyUser(
		ctx,
		flowDraftingStartedNotice(shell.id, language),
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
		return notifyUser(
			ctx,
			formatUserNotice("⚠️", "用法", ["/flow <path.md>"]),
			"info",
		);
	const path = resolve(ctx.cwd, args[0]);
	let requestText: string;
	try {
		requestText = readFileSync(path, "utf8");
	} catch (error) {
		return notifyUser(
			ctx,
			formatUserNotice("❌", "读取失败", [formatError(error)]),
			"info",
		);
	}
	await startGeneration(pi, ctx, requestText, "file", path, options);
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
	const semanticPath = join(active.location.dir, "flow.semantic.json");
	if (!existsSync(semanticPath)) {
		await handleMissingFlow(
			ctx,
			active,
			finalAssistantText(event?.messages ?? []),
		);
		return;
	}
	if (active.location.flow.status === "draft" && active.location.flow.meta) {
		await reconcileGenerationState(ctx, active);
		return;
	}
	if (flowStatusForAlignment(active.alignment.stage) === "aligning") {
		notifyUser(
			ctx,
			alignmentRejectsFlowPlanNotice(active.location.flow.language),
			"info",
			active.location.flow.language,
		);
		await cancelPreDraftFlow(active, ctx, ["对齐阶段不接受 Flow 计划"]);
		finishGeneration(active, ctx);
		return;
	}
	let committed: GenerationMutationResult<GenerationBuildResult>;
	try {
		committed = await retryGenerationMutation(
			active,
			ctx,
			`finish generation ${active.location.id}`,
			(current) => buildGenerationResult(pi, ctx, current, semanticPath),
			{ statuses: ["aligning", "generating", "draft"] },
		);
	} catch (error) {
		if (error instanceof GenerationRepairStateError) {
			notifyUser(
				ctx,
				flowRepairStateSaveFailedNotice(
					error.message,
					active.location.flow.language,
				),
				"info",
				active.location.flow.language,
			);
			return;
		}
		notifyUser(
			ctx,
			flowJsonReadFailedNotice(
				formatError(error),
				active.location.flow.language,
			),
			"info",
			active.location.flow.language,
		);
		await recordGenerationFailure(active, ctx, [
			`flow.json 读取失败：${formatError(error)}`,
		]);
		finishGeneration(active, ctx);
		return;
	}
	if (committed.kind !== "applied") return;
	if (committed.value.kind === "repair") {
		await continueInvalidFlowRepair(pi, ctx, committed.value);
		return;
	}
	const { flow, alignment } = committed.value;
	rememberGenerationSession(active.location.dir, ctx);
	const html = refreshFlowHtmlProjection(ctx, active.location.dir, flow);
	if (html) openLiveHtmlInBackgroundOnce(pi, ctx, html, flow.language);
	if (!alignment.autoStart)
		notifyUser(ctx, generatedSummary(flow), "info", flow.language);
	finishGeneration(active, ctx);
	return {
		kind: "ready",
		id: flow.id,
		language: flow.language,
		autoStart: alignment.autoStart,
	};
}

type GenerationBuildResult =
	| { kind: "ready"; flow: FlowLocation["flow"]; alignment: AlignmentState }
	| GenerationRepairResult;

interface GenerationRepairResult {
	kind: "repair";
	active: ActiveGeneration;
	assemblyError?: string;
	errors: string[];
	title: string;
}

class GenerationRepairStateError extends Error {
	constructor(error: unknown) {
		super(formatError(error));
		this.name = "GenerationRepairStateError";
	}
}

function buildGenerationResult(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	active: ActiveGeneration,
	semanticPath: string,
): GenerationBuildResult {
	let alignment: AlignmentState;
	try {
		alignment = writeAlignmentState(active.location.dir, {
			...active.alignment,
			stage: "generating",
		});
	} catch (error) {
		throw new GenerationRepairStateError(error);
	}
	const staged = { ...active, alignment };
	let built: FlowLocation["flow"];
	try {
		built = buildFlowArtifact(
			staged.location.dir,
			semanticInput(semanticPath),
			staged.location.flow.language,
			flowSource(staged),
		);
	} catch (error) {
		const assemblyError = formatError(error);
		const message = `Flow 计划草稿组装失败（${staged.location.id}）：${assemblyError}`;
		return saveGenerationRepair(
			staged,
			staged.location.flow,
			[message],
			assemblyError,
		);
	}
	const validation = validateFlowDir(
		staged.location.dir,
		staged.location.flow.language,
	);
	if (!validation.ok || !validation.flow)
		return saveGenerationRepair(staged, built, validation.errors);
	const flow = writeFlow(staged.location.dir, {
		...validation.flow,
		createdAt: staged.cache?.createdAt ?? staged.location.flow.createdAt,
		errors: [],
		meta: {
			plannedBy: currentSessionModel(pi, ctx) ?? null,
			alignment: recordedAlignment(staged.alignment.alignmentTurns),
		},
	});
	deleteAlignmentState(staged.location.dir);
	return { kind: "ready", flow, alignment: staged.alignment };
}

function saveGenerationRepair(
	active: ActiveGeneration,
	candidate: FlowLocation["flow"],
	errors: string[],
	assemblyError?: string,
): GenerationRepairResult {
	try {
		const attempts = active.location.flow.repairAttempts + 1;
		const flow = writeFlow(
			active.location.dir,
			recoverablePreDraftState(active, candidate, errors, attempts),
		);
		return {
			kind: "repair",
			active: {
				...active,
				location: { ...active.location, flow },
			},
			...(assemblyError ? { assemblyError } : {}),
			errors,
			title: safeFlowTitle(candidate, active.location.id),
		};
	} catch (error) {
		throw new GenerationRepairStateError(error);
	}
}

function recordedAlignment(
	turns: AlignmentState["alignmentTurns"],
): FlowAlignment | null {
	if (turns.length === 0) return null;
	return {
		kind: "recorded",
		turns: turns.map((turn) => ({ ...turn })),
	};
}

function semanticInput(path: string): FlowSemanticInput {
	return JSON.parse(readFileSync(path, "utf8")) as FlowSemanticInput;
}

function flowSource(active: ActiveGeneration): FlowSource {
	return active.cache?.source ?? active.location.flow.source;
}

async function handleMissingFlow(
	ctx: Pick<ExtensionContext, "ui">,
	active: ActiveGeneration,
	assistantText: string,
) {
	if (flowStatusForAlignment(active.alignment.stage) === "aligning")
		return waitForAlignment(ctx, active, assistantText);
	if (hasNeedInput(assistantText)) return waitForBlockingInput(ctx, active);
	if (isGoalFlowRecommendation(assistantText)) return;
	notifyUser(
		ctx,
		invalidFlowPlanNotice(active.location.flow.language),
		"info",
		active.location.flow.language,
	);
	await recordGenerationFailure(active, ctx, ["AI 未生成有效 Flow 计划"]);
	finishGeneration(active, ctx);
}

async function waitForAlignment(
	ctx: Pick<ExtensionContext, "ui"> & { sessionManager?: unknown },
	active: ActiveGeneration,
	assistantText: string,
) {
	const next = mutableAlignment(active);
	const remembered = rememberQuestion(next, assistantText);
	const saved = await saveGenerationStage(
		active,
		ctx,
		{
			...next,
			lastAlignmentQuestion: remembered,
			stage: hasReadyToDraft(assistantText)
				? "awaiting_final_confirm"
				: "awaiting_alignment_input",
		},
		"aligning",
	);
	publishGenerationWait(ctx, active, saved);
}

async function waitForBlockingInput(
	ctx: Pick<ExtensionContext, "ui"> & { sessionManager?: unknown },
	active: ActiveGeneration,
) {
	const saved = await saveGenerationStage(
		active,
		ctx,
		{ ...active.alignment, stage: "awaiting_blocking_input" },
		"generating",
	);
	publishGenerationWait(ctx, active, saved);
}

function publishGenerationWait(
	ctx: Pick<ExtensionContext, "ui"> & { sessionManager?: unknown },
	active: ActiveGeneration,
	saved: ActiveGeneration | undefined,
) {
	if (!saved) return;
	rememberGenerationReplyTarget(saved, ctx);
	const source = generationActivityId(active.location.id);
	setFlowActivity("goal", false, source);
	setGoalActivityBox(ctx, flowPendingBox(saved));
	requestPiAttention(source);
}

export async function goFlowGeneration(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	id?: string,
) {
	return recoverFlowGeneration(pi, ctx, id, true);
}

async function recoverFlowGeneration(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	id: string | undefined,
	confirmReady: boolean,
) {
	const found = await generationTarget(ctx, id);
	if (!found) return false;
	if (
		isPromptedRecoveryStage(found.alignment.stage) &&
		blockGenerationPromptIfPending(ctx, found.location.flow.language)
	)
		return true;
	const restoresOtherSession =
		found.alignment.sessionFile !== safeCurrentSessionFile(ctx);
	const active = await takeOverGeneration(ctx, found);
	if (!active) return true;
	setFlowActivity("goal", true, generationActivityId(active.location.id));
	setGoalActivityBox(ctx, flowPendingBox(active));
	if (confirmReady && shouldDraftFromAlignment(active, restoresOtherSession)) {
		rememberGenerationCache(active, ctx, restoresOtherSession, false);
		try {
			const action = await confirmFlowDraft(active, ctx);
			return action ? sendFlowGenerationAction(pi, ctx, action) : true;
		} catch (error) {
			notifyUser(
				ctx,
				flowGenerationStateSaveFailedNotice(
					formatError(error),
					active.location.flow.language,
				),
				"info",
				active.location.flow.language,
			);
			return true;
		}
	}
	if (!isPromptedRecoveryStage(active.alignment.stage)) {
		rememberGenerationCache(active, ctx, restoresOtherSession, false);
		rememberGenerationReplyTarget(active, ctx);
		notifyUser(
			ctx,
			flowPendingNotice(active),
			"info",
			active.location.flow.language,
		);
		return true;
	}
	if (
		!(await switchToRoleModel(
			pi,
			ctx,
			"advisor",
			active.location.flow.language,
		))
	)
		return true;
	const input = recoveryPrompt(active);
	const promptToken = nextGenerationPromptToken(active);
	const delivered = await sendGenerationPrompt(
		pi,
		ctx,
		active,
		promptToken,
		promptWithToken(input.prompt, promptToken),
		{
			followUp: true,
			errorPrefix: input.errorPrefix,
			language: active.location.flow.language,
		},
		`send recovered generation ${active.location.id}`,
	);
	if (delivered.kind !== "applied") return true;
	if (delivered.value.sent) {
		rememberGenerationCache(delivered.value.active, ctx);
		rememberGenerationPromptTarget(delivered.value.active, ctx, promptToken);
		rememberGenerationReplyTarget(delivered.value.active, ctx);
	} else
		await recordGenerationFailure(delivered.value.active, ctx, [
			input.errorPrefix,
			...delivered.value.active.location.flow.errors,
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
		if (active.alignment.stage === "awaiting_final_confirm")
			return continueFlowAlignment(active, clarification, ctx);
		if (active.alignment.stage === "awaiting_alignment_input")
			return continueFlowAlignment(active, clarification, ctx);
		if (active.alignment.stage === "awaiting_blocking_input")
			return continueFlowPlanGeneration(active, clarification, ctx);
		return undefined;
	} catch (error) {
		notifyUser(
			ctx,
			flowGenerationStateSaveFailedNotice(
				formatError(error),
				active.location.flow.language,
			),
			"info",
			active.location.flow.language,
		);
		return { kind: "handled", activityBox: flowPendingBox(active) };
	}
}

async function ensureFlowGenerationPromptModel(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "ui"> & {
		cwd: string;
		sessionManager?: unknown;
	},
	action: Extract<FlowClarificationAction, { kind: "prompt" }>,
) {
	const active = activeGenerationForAction(ctx, action);
	if (!active) return false;
	if (
		needsPlannerSwitch(active, ctx) &&
		!(await switchToRoleModel(
			pi,
			ctx,
			"advisor",
			active.location.flow.language,
		))
	)
		return false;
	return activeGenerationForAction(ctx, action) !== undefined;
}

export async function deliverFlowGenerationPrompt(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "ui"> & {
		cwd: string;
		sessionManager?: unknown;
	},
	action: Extract<FlowClarificationAction, { kind: "prompt" }>,
	errorPrefix: string,
) {
	if (!(await ensureFlowGenerationPromptModel(pi, ctx, action))) return false;
	const active = activeGenerationForAction(ctx, action);
	if (!active) return false;
	const delivered = await sendGenerationPrompt(
		pi,
		ctx,
		active,
		action.promptToken,
		action.prompt,
		{ followUp: true, errorPrefix },
		`send generation input ${active.location.id}`,
	);
	if (delivered.kind !== "applied") return false;
	if (delivered.value.sent) {
		rememberGenerationPromptTarget(
			delivered.value.active,
			ctx,
			action.promptToken,
		);
		rememberGenerationCache(delivered.value.active, ctx);
		return true;
	}
	await recordGenerationFailure(delivered.value.active, ctx, [errorPrefix]);
	finishGeneration(delivered.value.active, ctx);
	return false;
}

async function sendFlowGenerationAction(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	action: Extract<FlowClarificationAction, { kind: "prompt" }>,
) {
	setGoalActivityBox(ctx, action.activityBox);
	await deliverFlowGenerationPrompt(pi, ctx, action, "Flow 计划提示发送失败");
	return true;
}

async function confirmFlowDraft(
	active: ActiveGeneration,
	ctx: Pick<ExtensionContext, "ui">,
): Promise<Extract<FlowClarificationAction, { kind: "prompt" }> | undefined> {
	const saved = await saveGenerationStage(
		active,
		ctx,
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
		revision: saved.alignment.updatedAt,
		activityBox: flowPendingBox(saved),
		showUserInput: true,
		prompt: promptWithToken(flowGenerationPrompt(saved), promptToken),
		promptToken,
	};
}

function continueFlowAlignment(
	active: ActiveGeneration,
	clarification: string,
	ctx: Pick<ExtensionContext, "ui">,
): FlowClarificationAction | undefined {
	const next = mutableAlignment(active);
	const pending = {
		language: active.location.flow.language,
		alignmentTurns: next.alignmentTurns,
		lastAlignmentQuestion: next.lastAlignmentQuestion,
	};
	appendAlignmentAnswer(pending, clarification);
	return queueGenerationStage(
		active,
		ctx,
		{
			...next,
			stage: "aligning",
			alignmentTurns: pending.alignmentTurns ?? [],
			lastAlignmentQuestion: pending.lastAlignmentQuestion ?? null,
		},
		"aligning",
		{ errors: [] },
		(saved) => {
			const promptToken = nextGenerationPromptToken(saved);
			return {
				kind: "prompt",
				flowId: saved.location.id,
				flowDir: saved.location.dir,
				revision: saved.alignment.updatedAt,
				activityBox: flowPendingBox(saved),
				showUserInput: true,
				prompt: promptWithToken(
					buildAlignmentFollowUpPrompt({
						language: saved.location.flow.language,
						depth: saved.alignment.depth,
					}),
					promptToken,
				),
				promptToken,
			};
		},
	);
}

function continueFlowPlanGeneration(
	active: ActiveGeneration,
	clarification: string,
	ctx: Pick<ExtensionContext, "ui">,
): FlowClarificationAction | undefined {
	const source = appendSourceClarification(
		flowSource(active),
		clarification,
		active.location.flow.language,
	);
	return queueGenerationStage(
		active,
		ctx,
		{ ...active.alignment, stage: "generating" },
		"generating",
		{
			errors: [],
			source,
		},
		(saved) => {
			if (saved.cache) saved.cache.source = source;
			const promptToken = nextGenerationPromptToken(saved);
			return {
				kind: "prompt",
				flowId: saved.location.id,
				flowDir: saved.location.dir,
				revision: saved.alignment.updatedAt,
				activityBox: flowPendingBox(saved),
				showUserInput: true,
				prompt: promptWithToken(flowGenerationPrompt(saved), promptToken),
				promptToken,
			};
		},
	);
}

async function cancelPreDraftFlow(
	active: ActiveGeneration,
	ctx: Pick<ExtensionContext, "ui">,
	errors: string[] = [],
) {
	return retryGenerationMutation(
		active,
		ctx,
		`pause generation ${active.location.id}`,
		(current) => {
			const alignment = writeAlignmentState(
				current.location.dir,
				current.alignment,
			);
			const flow = writeFlow(current.location.dir, {
				...recoverablePreDraftState(
					current,
					current.location.flow,
					errors.length ? errors : current.location.flow.errors,
					current.location.flow.repairAttempts,
				),
				status: "paused",
			});
			return {
				...current,
				location: { ...current.location, flow },
				alignment,
			};
		},
	);
}

async function takeOverGeneration(
	ctx: Pick<ExtensionContext, "ui"> & { sessionManager?: unknown },
	active: ActiveGeneration,
) {
	const sessionFile = safeCurrentSessionFile(ctx);
	const result = await retryGenerationMutation(
		active,
		ctx,
		`resume generation ${active.location.id}`,
		(current) => {
			const status = flowStatusForAlignment(current.alignment.stage);
			const changesOwner = current.alignment.sessionFile !== sessionFile;
			const resumes = current.location.flow.status === "paused";
			const alignment =
				changesOwner || resumes
					? writeAlignmentState(current.location.dir, {
							...current.alignment,
							sessionFile,
						})
					: current.alignment;
			if ((changesOwner || resumes) && status === "generating")
				cleanupPreDraftDraftArtifacts(current.location.dir);
			const flow =
				current.location.flow.status === status
					? current.location.flow
					: writeFlow(current.location.dir, {
							...current.location.flow,
							status,
						});
			return {
				...current,
				location: { ...current.location, flow },
				alignment,
			};
		},
		{ statuses: ["aligning", "generating", "paused"] },
	);
	if (result.kind !== "applied") return undefined;
	if (active.alignment.sessionFile !== sessionFile)
		forgetGenerationPromptTarget(active.location.dir);
	return result.value;
}

function cleanupPreDraftDraftArtifacts(dir: string) {
	rmSync(join(dir, "flow.semantic.json"), { force: true });
	for (const name of readdirSync(dir)) {
		if (/^G[1-9]\d*-.*\.md$/u.test(name))
			rmSync(join(dir, name), { force: true });
	}
}

function flowStatusForAlignment(stage: AlignmentState["stage"]) {
	return stage === "aligning" ||
		stage === "awaiting_alignment_input" ||
		stage === "awaiting_final_confirm"
		? "aligning"
		: "generating";
}

async function saveGenerationStage(
	active: ActiveGeneration,
	ctx: Pick<ExtensionContext, "ui">,
	alignment: AlignmentState,
	status: "aligning" | "generating",
	flowPatch: Partial<FlowLocation["flow"]> = {},
) {
	const result = await retryGenerationMutation(
		active,
		ctx,
		`save generation stage ${active.location.id}`,
		(current) =>
			saveGenerationStageState(current, alignment, status, flowPatch),
	);
	return result.kind === "applied" ? result.value : undefined;
}

function queueGenerationStage(
	active: ActiveGeneration,
	ctx: Pick<ExtensionContext, "ui">,
	alignment: AlignmentState,
	status: "aligning" | "generating",
	flowPatch: Partial<FlowLocation["flow"]>,
	promptAction: (saved: ActiveGeneration) => FlowGenerationPromptAction,
): FlowClarificationAction | undefined {
	const result = queueGenerationMutation(
		active,
		ctx,
		`save generation input ${active.location.id}`,
		(current) =>
			saveGenerationStageState(current, alignment, status, flowPatch),
	);
	if (result.kind === "stale") return undefined;
	if (result.kind === "applied") return promptAction(result.value);
	return {
		kind: "pending",
		activityBox: flowPendingBox(active),
		continuation: result.continuation.then((retried) =>
			retried.kind === "applied" ? promptAction(retried.value) : undefined,
		),
	};
}

function saveGenerationStageState(
	active: ActiveGeneration,
	alignment: AlignmentState,
	status: "aligning" | "generating",
	flowPatch: Partial<FlowLocation["flow"]>,
) {
	const savedAlignment = writeAlignmentState(active.location.dir, alignment);
	const flow = writeFlow(active.location.dir, {
		...active.location.flow,
		...flowPatch,
		status,
	});
	return {
		...active,
		location: { ...active.location, flow },
		alignment: savedAlignment,
	};
}

async function recordGenerationFailure(
	active: ActiveGeneration,
	ctx: Pick<ExtensionContext, "ui">,
	errors: string[],
) {
	return retryGenerationMutation(
		active,
		ctx,
		`save generation failure ${active.location.id}`,
		(current) =>
			saveGenerationStageState(
				current,
				current.alignment,
				flowStatusForAlignment(current.alignment.stage),
				{ errors },
			),
	);
}

function isRecoverablePreDraftFlow(flow: FlowLocation["flow"]) {
	return (
		Array.isArray(flow.goals) &&
		flow.goals.length === 0 &&
		(flow.status === "aligning" ||
			flow.status === "generating" ||
			flow.status === "paused")
	);
}

async function continueInvalidFlowRepair(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	repair: GenerationRepairResult,
) {
	const { active, assemblyError, errors, title } = repair;
	const language = active.location.flow.language;
	if (assemblyError)
		notifyUser(
			ctx,
			flowDraftAssemblyFailedNotice(
				active.location.id,
				assemblyError,
				language,
			),
			"info",
			language,
		);
	setGoalActivityBox(
		ctx,
		flowDraftBox("计划修复中", `错误：${errors[0]}`, true),
	);
	refreshFlowErrorHtmlProjection(ctx, active.location.dir, {
		title,
		errors,
		requestText: sourceText(active.location.flow.source, language),
		language,
	});
	if (active.location.flow.repairAttempts > 3) {
		notifyUser(
			ctx,
			flowRepairExhaustedNotice(errors, language),
			"info",
			language,
		);
		finishGeneration(active, ctx);
		return;
	}
	if (!(await switchToRoleModel(pi, ctx, "advisor", language))) {
		finishGeneration(active, ctx);
		return;
	}
	const promptToken = nextGenerationPromptToken(active);
	const delivered = await sendGenerationPrompt(
		pi,
		ctx,
		active,
		promptToken,
		promptWithToken(
			repairPrompt({
				errors,
				requestText: generationPromptRequest(active),
				flowPath: active.location.dir,
				language,
			}),
			promptToken,
		),
		{
			followUp: true,
			errorPrefix: "Flow 计划修复提示发送失败",
			language,
		},
		`send generation repair ${active.location.id}`,
	);
	if (delivered.kind !== "applied") return;
	if (delivered.value.sent) {
		refreshGenerationCache(delivered.value.active);
		rememberGenerationPromptTarget(delivered.value.active, ctx, promptToken);
		return;
	}
	await recordGenerationFailure(delivered.value.active, ctx, [
		"Flow 计划修复提示发送失败",
		...errors,
	]);
	finishGeneration(delivered.value.active, ctx);
}

function recoverablePreDraftState(
	active: ActiveGeneration,
	candidate: FlowLocation["flow"],
	errors: string[],
	repairAttempts: number,
): FlowLocation["flow"] {
	return {
		schemaVersion: FLOW_SCHEMA_VERSION,
		language: active.location.flow.language,
		id: active.location.id,
		title: safeFlowTitle(candidate, active.location.id),
		status: "generating",
		source: active.location.flow.source,
		createdAt: active.cache?.createdAt ?? active.location.flow.createdAt,
		updatedAt: Date.now(),
		startedAt: null,
		completedAt: null,
		currentGoal: 0,
		meta: active.location.flow.meta ?? null,
		attention: null,
		parallelRun: null,
		repairAttempts,
		errors,
		goals: [],
	};
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
	notifyUser(ctx, flowPromptAlreadyWaitingNotice(language), "info", language);
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
		if (
			liveIndex === 0 ||
			livePromptHasResult(active, target, sessionFile, event)
		) {
			consumePromptResultToken(sessionFile, target.token);
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
	if (
		!active ||
		active.alignment.sessionFile !== sessionFile ||
		active.alignment.updatedAt !== target.revision
	)
		return undefined;
	return active;
}

function livePromptHasResult(
	active: ActiveGeneration,
	target: GenerationPromptTarget,
	sessionFile: string,
	event?: { messages?: unknown[] },
) {
	if (existsSync(join(active.location.dir, "flow.semantic.json"))) return true;
	const assistantText = finalAssistantText(event?.messages ?? []);
	if (!assistantText.trim()) return false;
	return (
		promptTokenInText(assistantText) === target.token ||
		consumePromptResultToken(sessionFile, target.token)
	);
}

function promptTokenInText(text: string) {
	return PROMPT_TOKEN_PATTERN.exec(text)?.[1];
}

function rememberPromptResultToken(
	ctx: { sessionManager?: unknown },
	token: string,
) {
	const sessionFile = safeCurrentSessionFile(ctx);
	if (!sessionFile) return;
	const tokens = [
		...(generationPromptResultTokens.get(sessionFile) ?? []),
		token,
	];
	generationPromptResultTokens.set(sessionFile, tokens.slice(-8));
}

function consumePromptResultToken(sessionFile: string, token: string) {
	const tokens = generationPromptResultTokens.get(sessionFile);
	const index = tokens?.indexOf(token) ?? -1;
	if (!tokens || index < 0) return false;
	const remaining = tokens.filter((_item, offset) => offset !== index);
	if (remaining.length)
		generationPromptResultTokens.set(sessionFile, remaining);
	else generationPromptResultTokens.delete(sessionFile);
	return true;
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
	return changed
		? storeGenerationPromptTargets(sessionFile, normalized)
		: normalized;
}

function forgetPromptTargetAt(
	sessionFile: string,
	targets: GenerationPromptTarget[],
	index: number,
) {
	const target = targets[index];
	if (target) consumePromptResultToken(sessionFile, target.token);
	storeGenerationPromptTargets(
		sessionFile,
		targets.filter((_target, offset) => offset !== index),
	);
}

function generationReplyTarget(ctx: { sessionManager?: unknown }) {
	const sessionFile = safeCurrentSessionFile(ctx);
	if (!sessionFile) return undefined;
	const target = generationReplyTargets.get(sessionFile);
	if (!target) return undefined;
	const active = activeGenerationFromDir(target.dir);
	if (
		!active ||
		active.alignment.sessionFile !== sessionFile ||
		active.alignment.updatedAt !== target.revision
	) {
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
		{
			dir: active.location.dir,
			revision: active.alignment.updatedAt,
			stale: false,
			token,
		},
	]);
}

function rememberGenerationReplyTarget(
	active: ActiveGeneration,
	ctx: { sessionManager?: unknown },
) {
	const sessionFile = safeCurrentSessionFile(ctx);
	if (sessionFile)
		generationReplyTargets.set(sessionFile, {
			dir: active.location.dir,
			revision: active.alignment.updatedAt,
		});
}

function forgetGenerationPromptTarget(dir: string) {
	forgetGenerationDeliveryToken(dir);
	for (const [sessionFile, targets] of generationPromptTargets) {
		if (!targets.some((target) => target.dir === dir)) continue;
		storeGenerationPromptTargets(
			sessionFile,
			targets.map((target) =>
				target.dir === dir ? { ...target, stale: true } : target,
			),
		);
	}
}

function forgetGenerationReplyTarget(dir: string) {
	for (const [sessionFile, target] of generationReplyTargets) {
		if (target.dir === dir) generationReplyTargets.delete(sessionFile);
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

function activeGenerationById(
	ctx: { cwd: string },
	id: string,
	includePaused = false,
) {
	try {
		const location = findFlow(ctx.cwd, id);
		return location
			? activeGenerationFromLocation(location, includePaused)
			: undefined;
	} catch {
		return undefined;
	}
}

function activeGenerationForAction(
	ctx: { cwd: string },
	action: Extract<FlowClarificationAction, { kind: "prompt" }>,
) {
	const active = activeGenerationById(ctx, action.flowId);
	return active?.location.dir === action.flowDir &&
		active.alignment.updatedAt === action.revision
		? active
		: undefined;
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

async function generationTarget(
	ctx: Pick<ExtensionContext, "ui"> & {
		cwd: string;
		sessionManager?: unknown;
	},
	id?: string,
) {
	let location: FlowLocation | undefined;
	try {
		const target = resolveFlowTarget(ctx, id);
		if (target.ok) location = target.location;
	} catch {
		return undefined;
	}
	if (!location) return undefined;
	const active = activeGenerationFromLocation(location, true);
	if (!active) return undefined;
	return reconcileGenerationState(ctx, active);
}

async function reconcileGenerationState(
	ctx: Pick<ExtensionContext, "ui">,
	active: ActiveGeneration,
) {
	if (active.location.flow.status === "draft") {
		const reconciled = await retryGenerationMutation(
			active,
			ctx,
			`reconcile draft ${active.location.id}`,
			(current) => reconcileDraftGeneration(current),
			{ statuses: ["draft"] },
		);
		return reconciled.kind === "applied" ? reconciled.value : undefined;
	}
	if (!isRecoverablePreDraftFlow(active.location.flow)) return undefined;
	if (active.location.flow.status === "paused") return active;
	const status = flowStatusForAlignment(active.alignment.stage);
	if (active.location.flow.status === status) return active;
	const reconciled = await retryGenerationMutation(
		active,
		ctx,
		`reconcile generation ${active.location.id}`,
		(current) => {
			const flow = writeFlow(current.location.dir, {
				...current.location.flow,
				status,
			});
			return {
				...current,
				location: { ...current.location, flow },
			};
		},
	);
	return reconciled.kind === "applied" ? reconciled.value : undefined;
}

function reconcileDraftGeneration(active: ActiveGeneration) {
	if (active.location.flow.meta) {
		deleteAlignmentState(active.location.dir);
		return undefined;
	}
	const semanticPath = join(active.location.dir, "flow.semantic.json");
	let semanticAvailable = false;
	try {
		semanticInput(semanticPath);
		semanticAvailable = true;
	} catch {}
	const validation = validateFlowDir(
		active.location.dir,
		active.location.flow.language,
	);
	if (!semanticAvailable || !validation.ok || !validation.flow) {
		const errors = semanticAvailable
			? validation.errors
			: [
					active.location.flow.language === "en"
						? "flow.semantic.json is missing or invalid after an interrupted draft commit"
						: "草稿提交中断后 flow.semantic.json 缺失或损坏",
				];
		return saveGenerationRepair(active, active.location.flow, errors).active;
	}
	writeFlow(active.location.dir, {
		...validation.flow,
		errors: [],
		meta: {
			plannedBy: null,
			alignment: recordedAlignment(active.alignment.alignmentTurns),
		},
	});
	deleteAlignmentState(active.location.dir);
	return undefined;
}

function activeGenerationFromLocation(
	location: FlowLocation,
	includePaused = false,
): ActiveGeneration | undefined {
	const alignment = readAlignmentStateIfExists(location.dir);
	if (!alignment) return undefined;
	const owned = isGenerationOwnedStatus(location.flow.status);
	if (!owned && !(includePaused && isRecoverablePreDraftFlow(location.flow)))
		return undefined;
	const cache = generationContexts.get(generationCacheKey(location.dir));
	return { location, alignment, cache };
}

function isGenerationOwnedStatus(status: FlowLocation["flow"]["status"]) {
	return status === "aligning" || status === "generating" || status === "draft";
}

function safeCurrentSessionFile(ctx: { sessionManager?: unknown }) {
	try {
		return currentSessionFile(ctx) ?? null;
	} catch {
		return null;
	}
}

function generationRequests(
	ctx: ExtensionCommandContext,
	requestText: string,
	sourceType: FlowSourceType,
	sourcePath: string | undefined,
	language: Language,
	options: GenerationStartOptions,
):
	| { ok: true; source: FlowSource; requestText: string }
	| { ok: false; message: string } {
	if (sourceType === "prompt")
		return {
			ok: true,
			source: { type: "prompt", text: requestText },
			requestText,
		};
	if (sourceType === "file") {
		if (!sourcePath?.trim())
			return {
				ok: false,
				message:
					language === "en"
						? "Flow file source path is missing."
						: "Flow 文件来源缺少路径。",
			};
		return {
			ok: true,
			source: { type: "file", path: sourcePath, text: requestText },
			requestText,
		};
	}
	let modelReference: string | undefined;
	try {
		const advisor = readFlowConfig().modelRoles.advisor;
		modelReference =
			advisor === "current"
				? ctx.model
					? `${ctx.model.provider}/${ctx.model.id}`
					: undefined
				: advisor.model;
	} catch (error) {
		return { ok: false, message: formatError(error) };
	}
	const evidence = buildContextEvidence({
		entries: sessionEntries(ctx),
		projection: "requirements",
		language,
		modelReferences: modelReference ? [modelReference] : [],
		modelRegistry: ctx.modelRegistry,
		fixedPrompt: generationFixedPrompt(
			ctx.cwd,
			sourceType,
			sourcePath,
			language,
			options,
		),
	});
	if (!evidence.ok) return { ok: false, message: evidence.error.message };
	if (evidence.packet.conversation.length === 0)
		return {
			ok: false,
			message:
				language === "en"
					? "No conversation requirements were found."
					: "未找到可记录的会话需求。",
		};
	// Evidence packet 已冻结；解冻为可写入 canonical JSON 的独立副本。
	const transcript = evidence.packet.conversation.map((turn) => ({ ...turn }));
	return {
		ok: true,
		source: { type: "conversation", transcript },
		requestText: formatTranscript(transcript, language),
	};
}

function generationFixedPrompt(
	cwd: string,
	sourceType: FlowSourceType,
	sourcePath: string | undefined,
	language: Language,
	options: GenerationStartOptions,
) {
	if (options.mode === "align")
		return buildAlignmentPrompt({
			kind: "flow",
			language,
			requestText: "",
			source: sourceLabel({ sourceType, sourcePath }),
			depth: options.depth ?? "standard",
		});
	return generationPrompt({
		requestText: "",
		sourceType,
		sourcePath,
		language,
		flowPath: flowDir(cwd, "F999999"),
	});
}

function flowContextEvidenceUnavailableNotice(
	reason: string,
	language: Language,
) {
	return language === "en"
		? formatUserNotice("❌", "Flow planning could not start", [reason])
		: formatUserNotice("❌", "Flow 计划无法启动", [reason]);
}

function recoveryPrompt(active: ActiveGeneration) {
	if (active.alignment.stage === "aligning") {
		if (active.alignment.alignmentTurns.length > 0)
			return {
				prompt: buildAlignmentFollowUpPrompt({
					language: active.location.flow.language,
					depth: active.alignment.depth,
				}),
				errorPrefix: "Flow 计划澄清提示发送失败",
			};
		return {
			prompt: buildAlignmentPrompt({
				kind: "flow",
				language: active.location.flow.language,
				requestText: generationPromptRequest(active),
				source: sourceLabel({
					sourceType: flowSource(active).type,
					sourcePath: flowSourcePath(active),
				}),
				depth: active.alignment.depth,
			}),
			errorPrefix: "Flow 计划提示发送失败",
		};
	}
	if (shouldRepairOnContinue(active))
		return {
			prompt: repairPrompt({
				errors: active.location.flow.errors,
				requestText: generationPromptRequest(active),
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

function shouldDraftFromAlignment(
	active: ActiveGeneration,
	restoresOtherSession: boolean,
) {
	return (
		active.alignment.stage === "awaiting_final_confirm" ||
		(active.alignment.stage === "awaiting_alignment_input" &&
			!restoresOtherSession)
	);
}

function needsPlannerSwitch(
	active: ActiveGeneration,
	ctx: { sessionManager?: unknown },
) {
	if (!active.cache || active.cache.plannerReady === false) return true;
	return active.cache.sessionFile !== safeCurrentSessionFile(ctx);
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
	ctx: { sessionManager?: unknown },
	restoredAlignmentContext = false,
	plannerReady = true,
) {
	generationContexts.set(generationCacheKey(active.location.dir), {
		sessionFile: safeCurrentSessionFile(ctx),
		source: flowSource(active),
		createdAt: active.location.flow.createdAt,
		restoredAlignmentContext,
		plannerReady,
	});
}

function flowGenerationPrompt(active: ActiveGeneration) {
	const source = flowSource(active);
	return generationPrompt({
		requestText: generationPromptRequest(active),
		sourceType: source.type,
		sourcePath: flowSourcePath(active),
		language: active.location.flow.language,
		flowPath: active.location.dir,
		restoredAlignmentContext: restoredAlignmentContext(active),
	});
}

function generationPromptRequest(active: ActiveGeneration) {
	return sourceText(flowSource(active), active.location.flow.language);
}

function flowSourcePath(active: ActiveGeneration) {
	const source = flowSource(active);
	return source.type === "file" ? source.path : undefined;
}

function sourceText(source: FlowSource, language: Language) {
	return source.type === "conversation"
		? formatTranscript(source.transcript, language)
		: source.text;
}

function appendSourceClarification(
	source: FlowSource,
	clarification: string,
	language: Language,
): FlowSource {
	if (source.type !== "conversation")
		return {
			...source,
			text: appendGenerationClarification(source.text, clarification, language),
		};
	const text = clarification.trim();
	if (!text || source.transcript.some((turn) => turn.text.trim() === text))
		return source;
	return {
		type: "conversation",
		transcript: [
			...source.transcript,
			{
				kind: "visible_supplement",
				at: new Date().toISOString(),
				text: clarification,
			},
		],
	};
}

function restoredAlignmentContext(active: ActiveGeneration) {
	if (active.alignment.alignmentTurns.length === 0) return undefined;
	if (!active.cache || active.cache.restoredAlignmentContext)
		return active.alignment.alignmentTurns;
	return active.cache.sessionFile === active.alignment.sessionFile
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
	notifyUser(ctx, activeGenerationNotice(id, language), "info", language);
}

function notifyAmbiguousGeneration(
	ctx: Pick<ExtensionContext, "ui">,
	items: ActiveGeneration[],
) {
	const language = items[0]?.location.flow.language ?? runtimeLanguage();
	const choices = items
		.map((active) => {
			const id = flowCommandId(active.location.id);
			return `- ${id} · ${quoteCommand(`/flow go ${id}`)}`;
		})
		.join("\n");
	notifyUser(
		ctx,
		ambiguousGenerationNotice(choices, language),
		"info",
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

function generationActivityId(flowId: string) {
	return `${FLOW_DRAFT_ACTIVITY}:${flowId}`;
}

function generationCacheKey(dir: string) {
	return dir;
}

function nextGenerationPromptToken(active: ActiveGeneration) {
	generationPromptSequence += 1;
	const token = `${active.location.id.toLowerCase()}-${Date.now().toString(36)}-${generationPromptSequence.toString(36)}`;
	generationDeliveryTokens.set(active.location.dir, {
		revision: active.alignment.updatedAt,
		sessionFile: active.alignment.sessionFile,
		token,
	});
	return token;
}

function generationDeliveryTokenMatches(
	active: ActiveGeneration,
	promptToken: string,
) {
	const current = generationDeliveryTokens.get(active.location.dir);
	return (
		current?.token === promptToken &&
		current.revision === active.alignment.updatedAt &&
		current.sessionFile === active.alignment.sessionFile
	);
}

function forgetGenerationDeliveryToken(dir: string, promptToken?: string) {
	if (
		promptToken === undefined ||
		generationDeliveryTokens.get(dir)?.token === promptToken
	)
		generationDeliveryTokens.delete(dir);
}

function promptWithToken(prompt: string, token: string) {
	return `${prompt}\n\n<!-- pi-flow:prompt:${token} -->\nWhen your final response asks for more input or continues alignment, include the exact marker above once. Do not write this marker into files.`;
}

export function stripGenerationPromptMarkerFromMessage<
	T extends { message: unknown },
>(
	event: T,
	ctx: { sessionManager?: unknown },
): { message: T["message"] } | undefined {
	const message = event.message;
	if (!isRecord(message) || message.role !== "assistant") return undefined;
	const token = promptTokenInText(assistantMessageText(message.content));
	if (!token) return undefined;
	rememberPromptResultToken(ctx, token);
	return {
		message: {
			...message,
			content: stripPromptTokenContent(message.content),
		} as T["message"],
	};
}

function stripPromptTokenContent(content: unknown) {
	if (typeof content === "string") return stripPromptTokens(content);
	if (!Array.isArray(content)) return content;
	return content.map((item) => {
		if (!isRecord(item) || typeof item.text !== "string") return item;
		return { ...item, text: stripPromptTokens(item.text) };
	});
}

function stripPromptTokens(text: string) {
	return text.replace(PROMPT_TOKEN_STRIP_PATTERN, "").trim();
}

function isGoalFlowRecommendation(text: string) {
	return /<!--\s*pi-flow:recommend-flow\s*-->/iu.test(text);
}

function safeFlowTitle(flow: unknown, fallback: string) {
	return isRecord(flow) && typeof flow.title === "string" && flow.title.trim()
		? flow.title
		: fallback;
}

function finishGeneration(
	active: ActiveGeneration | undefined,
	ctx: Pick<ExtensionContext, "ui">,
) {
	if (!active) return;
	cleanupGenerationState(active.location.dir);
	setFlowActivity("goal", false, generationActivityId(active.location.id));
	setGoalActivityBox(ctx, undefined);
}

function hasGenerationState(dir: string) {
	if (
		generationContexts.has(dir) ||
		generationDeliveryTokens.has(dir) ||
		hasAlignmentState(dir)
	)
		return true;
	if ([...generationReplyTargets.values()].some((target) => target.dir === dir))
		return true;
	return [...generationPromptTargets.values()].some((targets) =>
		targets.some((target) => target.dir === dir),
	);
}

function cleanupGenerationState(dir: string) {
	generationContexts.delete(generationCacheKey(dir));
	forgetGenerationPromptTarget(dir);
	forgetGenerationReplyTarget(dir);
}

function generationCacheBelongsToSession(dir: string, sessionFile: string) {
	try {
		if (readAlignmentStateIfExists(dir)?.sessionFile === sessionFile)
			return true;
	} catch {}
	return generationContexts.get(dir)?.sessionFile === sessionFile;
}

function hasAlignmentState(dir: string) {
	try {
		return readAlignmentStateIfExists(dir) !== undefined;
	} catch {
		return false;
	}
}

function storeGenerationPromptTargets(
	sessionFile: string,
	targets: GenerationPromptTarget[],
) {
	const lastStaleIndex = targets
		.map((target) => target.stale)
		.lastIndexOf(true);
	const compacted = targets.filter(
		(target, index) => !target.stale || index === lastStaleIndex,
	);
	const retained = new Set(compacted.map((target) => target.token));
	for (const target of targets) {
		if (!retained.has(target.token))
			consumePromptResultToken(sessionFile, target.token);
	}
	if (compacted.length) generationPromptTargets.set(sessionFile, compacted);
	else generationPromptTargets.delete(sessionFile);
	const resultTokens = generationPromptResultTokens
		.get(sessionFile)
		?.filter((token) => retained.has(token));
	if (resultTokens?.length)
		generationPromptResultTokens.set(sessionFile, resultTokens);
	else generationPromptResultTokens.delete(sessionFile);
	return compacted;
}

function flowPendingBox(active: ActiveGeneration) {
	const questionNumber = active.alignment.alignmentTurns.length + 1;
	const copy = generationAlignmentActivityCopy(
		active.alignment.stage,
		active.location.flow.language,
		questionNumber,
		`/flow go ${flowCommandId(active.location.id)}`,
		active.alignment.depth,
	);
	return flowDraftBox(
		copy.phase,
		copy.rows,
		active.alignment.stage === "aligning" ||
			active.alignment.stage === "generating",
	);
}

function flowPendingNotice(active: ActiveGeneration) {
	const language = active.location.flow.language;
	return language === "en"
		? formatUserNotice("⏳", "Flow generation is waiting", [
				flowPendingSummary(active),
			])
		: formatUserNotice("⏳", "Flow 计划生成等待继续", [
				flowPendingSummary(active),
			]);
}

function flowPendingSummary(active: ActiveGeneration) {
	return generationAlignmentSummary(
		active.alignment.stage,
		active.location.flow.language,
		active.alignment.alignmentTurns.length + 1,
		`/flow go ${flowCommandId(active.location.id)}`,
		active.alignment.depth,
	);
}

function flowDraftBox(phase: string, rows: string | string[], flame: boolean) {
	return { ...generationDraftBox(`🌊 Flow · ${phase}`, rows), flame };
}

function flowDirUnavailableNotice(error: string, language: Language) {
	return language === "en"
		? formatUserNotice("❌", ".flow directory unavailable", [error])
		: formatUserNotice("❌", ".flow 目录不可用", [error]);
}

function flowIdLine(id: string, language: Language) {
	return language === "en"
		? `ID: ${flowCommandId(id)}`
		: `编号：${flowCommandId(id)}`;
}

function flowDraftingStartedNotice(id: string, language: Language) {
	const flowId = flowCommandId(id);
	return language === "en"
		? formatUserNotice("📝", `Flow ${flowId} plan generating`, [
				"Starts automatically when done",
			])
		: formatUserNotice("📝", `Flow ${flowId} 计划生成中`, ["完成后自动启动"]);
}

function flowDraftAssemblyFailedNotice(
	id: string,
	error: string,
	language: Language,
) {
	return language === "en"
		? formatUserNotice("⚠️", "Flow draft assembly failed", [
				`ID: ${id}`,
				error,
				"Will keep looking for an existing plan",
			])
		: formatUserNotice("⚠️", "Flow 计划草稿组装失败", [
				`编号：${id}`,
				error,
				"将继续查找已有计划",
			]);
}

function flowJsonReadFailedNotice(error: string, language: Language) {
	return language === "en"
		? formatUserNotice("❌", "flow.json read failed", [error])
		: formatUserNotice("❌", "flow.json 读取失败", [error]);
}

function alignmentRejectsFlowPlanNotice(language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Alignment cannot accept a Flow plan", [
				"Continue alignment before generating",
			])
		: formatUserNotice("⚠️", "对齐阶段不接受 Flow 计划", ["请继续对齐后再生成"]);
}

function invalidFlowPlanNotice(language: Language) {
	return language === "en"
		? formatUserNotice("❌", "AI did not generate a valid Flow plan", [
				"Retry /flow",
			])
		: formatUserNotice("❌", "AI 未生成有效 Flow 计划", ["请重试 /flow"]);
}

function flowRepairExhaustedNotice(
	errors: readonly string[],
	language: Language,
) {
	return language === "en"
		? formatUserNotice("❌", "Flow validation repair exhausted", [
				"Tried 3 automatic repair rounds",
				...errors,
			])
		: formatUserNotice("❌", "Flow 校验自动修复耗尽", [
				"已尝试 3 轮",
				...errors,
			]);
}

function flowGenerationStateSaveFailedNotice(
	error: string,
	language: Language,
) {
	return language === "en"
		? formatUserNotice("❌", "Flow generation state save failed", [error])
		: formatUserNotice("❌", "Flow 生成状态保存失败", [error]);
}

function flowRepairStateSaveFailedNotice(error: string, language: Language) {
	return language === "en"
		? formatUserNotice("❌", "Flow repair state save failed", [error])
		: formatUserNotice("❌", "Flow 计划修复状态保存失败", [error]);
}

function flowPromptAlreadyWaitingNotice(language: Language) {
	return language === "en"
		? formatUserNotice("⏳", "Flow plan request is already waiting", [
				"Wait for it to finish",
				"Or use another conversation before continuing",
			])
		: formatUserNotice("⏳", "Flow 计划提示正在等待 AI 返回", [
				"请等它收口后再继续",
				"或换一个对话",
			]);
}

function activeGenerationNotice(id: string, language: Language) {
	return language === "en"
		? formatUserNotice("⏳", "Current session has unfinished Flow generation", [
				`ID: ${id}`,
				`Run ${quoteCommand(`/flow go ${id}`)} to continue`,
			])
		: formatUserNotice("⏳", "当前会话已有未完成的 Flow 计划生成", [
				`编号：${id}`,
				`运行 ${quoteCommand(`/flow go ${id}`)} 继续`,
			]);
}

function ambiguousGenerationNotice(choices: string, language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Multiple unfinished Flow generations", [
				"Specify one",
				choices,
			])
		: formatUserNotice("⚠️", "多个未完成的 Flow 计划生成", [
				"请指定目标",
				choices,
			]);
}

function generatedSummary(flow: {
	id: string;
	language: Language;
	goals: { index: number; title: string }[];
}) {
	const id = flowCommandId(flow.id);
	const steps = flow.goals.map(
		(goal) => `- ${flowStepLabel(goal.index, goal.title, flow.language)}`,
	);
	return flow.language === "en"
		? formatUserNotice("✅", "Flow plan generated", [
				`ID: ${id}`,
				...steps,
				`Next: ${quoteCommand(`/flow go ${id}`)}`,
			])
		: formatUserNotice("✅", "Flow 计划已生成", [
				`编号：${id}`,
				...steps,
				`下一步：${quoteCommand(`/flow go ${id}`)}`,
			]);
}

function sourceLabel(input: {
	sourceType: FlowSourceType;
	sourcePath?: string;
}) {
	return input.sourcePath
		? `${input.sourceType}: ${input.sourcePath}`
		: input.sourceType;
}
