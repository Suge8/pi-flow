import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { auditGoalCompletion, type GoalAuditResult } from "../auditor.js";
import { writeFlowHtml } from "../flow/html.js";
import { flowLockBusyMessage, withFlowLockSync } from "../flow/lock.js";
import { currentSessionFile, flowOwnerForSession } from "../flow/ownership.js";
import { rememberFlowContext } from "../flow/runtime.js";
import { currentGoal, readFlow, writeFlow } from "../flow/store.js";
import { flowCommandId, requireFlowStartedAt } from "../flow/util.js";
import {
	isGoalScopedReviewActive,
	isReviewLoopActive,
	type ReviewLoopStats,
	runConfiguredReview,
	scheduleContinueReviewAfterAgentEnd,
	waitForScheduledReviewAgentEnd,
} from "../review.js";
import {
	agentEndedWithRecoverableTransportStop,
	isPiRetryableAgentError,
} from "../review-agent-event.js";
import {
	activityRows,
	clearFlowActivities,
	currentCancelHint,
	installFlowActivityFrame,
	setFlowActivity,
	setFlowCancelHandler,
	setFlowEditorInputHidden,
	setGoalActivityBox,
	setReviewActivityBox,
} from "../shared/activity-frame.js";
import { type Language, readFlowConfig } from "../shared/config.js";
import { escapeRegExp, formatError } from "../shared/guards.js";
import { sendOrchestrationPrompt } from "../shared/internal-prompt.js";
import { runtimeLanguage } from "../shared/language.js";
import { switchToRoleModel } from "../shared/model-roles.js";
import type { PlanEvidence } from "../shared/plan-evidence.js";
import {
	elapsedLabel,
	flowGoalDisplayLabel,
	flowScope,
	flowStepLabel,
	GOAL_SCOPE,
	roundLabel,
	roundTitle,
} from "../shared/progress-labels.js";
import {
	composeResultCardLines,
	registerResultCardRenderer,
	resultCardElapsedLine,
	sendResultCard,
} from "../shared/result-card.js";
import { formatReviewResultLines } from "../shared/review-format.js";
import type { ReviewHistoryEntry } from "../shared/review-history.js";
import {
	type ReviewerProgress,
	reviewerProgressLines,
	shortModel,
} from "../shared/reviewer-pool.js";
import {
	clearStatus,
	type ElapsedStatus,
	elapsedSeconds,
	setStatusSafe,
	startElapsedStatus,
} from "../shared/status.js";
import {
	formatUserNotice,
	notifyUser,
	setStatusText,
} from "../shared/ui-language.js";
import {
	clearPersistedGoal as clearPersistedGoalEntry,
	GOAL_STATE_ENTRY_TYPE,
	type GoalStateEntryData,
	persistGoal as persistGoalEntry,
	readStepRuntimeState,
	saveActiveGoal as saveActiveGoalEntry,
	syncStandaloneGoalArtifact as syncStandaloneGoalArtifactEntry,
	writeStepRuntimeState,
} from "./persistence.js";
import {
	buildContinuePrompt,
	buildGoalSystemPrompt,
	buildResumePrompt,
	type GoalTodoPromptContext,
} from "./prompts.js";
import {
	cancelCompletionAudit as cancelCompletionAuditState,
	clearCompletionAuditStatus as clearCompletionAuditStatusState,
	finalizeGoalCompletion,
	isCurrentCompletionAudit as isCurrentCompletionAuditState,
	recordGoalQualityReview,
	recordGoalReview,
	startCompletionAudit as startCompletionAuditState,
	syncGoalReviewSurfaces,
	trackCompletionAuditStatus as trackCompletionAuditStatusState,
	yieldForGoalReviewCard,
} from "./review-orchestration.js";
import type { CompletionCursor } from "./types.js";

import { objectiveFromPlan } from "./validator.js";
import { closeGoalPlanWatcher, watchGoalPlan } from "./watcher.js";

export type GoalStatus = "active" | "paused" | "budget_limited" | "complete";
export type { ReviewHistoryEntry } from "../shared/review-history.js";

type AgentStopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface ActiveGoal {
	id: string;
	text: string;
	language: Language;
	status: GoalStatus;
	startedAt: number;
	updatedAt: number;
	iteration: number;
	stateReviewRounds: number;
	stateReviewHistory: ReviewHistoryEntry[];
	qualityReviewHistory: ReviewHistoryEntry[];
	stateReviewStartedAt?: number;
	tokenBudget?: number;
	tokensUsed: number;
	timeUsedSeconds: number;
	baselineTokens: number;
	stepStartedAt: number;
	artifactDir?: string;
	artifactId?: string;
}

interface GoalReviewLive {
	phase: "acceptance" | "quality";
	progress: ReviewerProgress[];
	rounds?: ReviewHistoryEntry[];
}

interface CompletionAuditPending {
	goalId: string;
	generation: number;
	controller: AbortController;
	status?: ElapsedStatus;
}

interface AssistantMessageLike {
	role: "assistant";
	stopReason?: AgentStopReason;
	errorMessage?: string;
}

export type StatusContext = Pick<
	ExtensionContext,
	"cwd" | "ui" | "sessionManager"
> & {
	modelRegistry?: ExtensionContext["modelRegistry"];
} & Partial<Pick<ExtensionContext, "isIdle" | "hasPendingMessages">> &
	Partial<Pick<ExtensionAPI, "sendMessage" | "sendUserMessage">>;

export interface FlowGoalRuntimeState {
	id: string;
	text: string;
	language: Language;
	status: GoalStatus;
}

export type FlowGoalContinueResult =
	| "continued"
	| "resumed"
	| "busy"
	| "no_goal"
	| "not_resumable";

interface FlowGoalStartOptions {
	artifact?: { artifactDir: string; artifactId: string };
	rememberFlowContext?: boolean;
	sendPrompt?: boolean;
}

export { yieldForGoalReviewCard };

export function cancelGoalRecoveryAfterUserAction(ctx?: StatusContext) {
	if (ctx) {
		cancelGoalRecoveryTimers(goalStateForSession(ctx), {
			resetAutoResumeUse: true,
		});
		return;
	}
	for (const state of goalRuntimeState.sessions.values())
		cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
}

const STATUS_KEY = "goal";
const MAX_CANCELLED_CONTINUATION_PROMPTS = 20;
const PI_RETRY_EXHAUSTION_GUARD_MS = 20_000;
const AUTO_RESUME_AFTER_RETRY_EXHAUSTION_MS = 5 * 60 * 1000;
const WEBSOCKET_LIMIT_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;
const RESPONSES_WEBSOCKET_LIMIT_CODE = "websocket_connection_limit_reached";
const CONTINUATION_MARKER_PREFIX = "pi-goal-continuation:";
const handledGoalAgentEndEvents = new WeakSet<object>();
interface ContinuationPending {
	goalId: string;
	iteration: number;
	marker: string;
	prompt: string;
}

interface RetryExhaustionWatch {
	goalId: string;
	generation: number;
	timer: NodeJS.Timeout;
}

interface DeferredAutoResume {
	goalId: string;
	generation: number;
	timer: NodeJS.Timeout;
}

export interface GoalRuntimeState {
	activeGoal?: ActiveGoal;
	completionStatusTimer?: NodeJS.Timeout;
	goalStatusTimer?: ElapsedStatus;
	continuationPending?: ContinuationPending;
	completionAuditPending?: CompletionAuditPending;
	completionAuditGeneration: number;
	cancelledContinuationMarkers: Set<string>;
	websocketLimitRecoveryAt: Map<string, number>;
	goalReviewLive?: GoalReviewLive;
	scheduledGoalStateReview?: Promise<void>;
	retryExhaustionWatch?: RetryExhaustionWatch;
	deferredAutoResume?: DeferredAutoResume;
	retryRecoveryGeneration: number;
	retryAutoResumeUsedGoalIds: Set<string>;
}

interface GoalRuntimeGlobalState {
	extensionApi?: ExtensionAPI;
	sessions: Map<string, GoalRuntimeState>;
}

export const goalRuntimeState: GoalRuntimeGlobalState = {
	sessions: new Map<string, GoalRuntimeState>(),
};

function createGoalSessionState(): GoalRuntimeState {
	return {
		completionAuditGeneration: 0,
		cancelledContinuationMarkers: new Set<string>(),
		websocketLimitRecoveryAt: new Map<string, number>(),
		retryRecoveryGeneration: 0,
		retryAutoResumeUsedGoalIds: new Set<string>(),
	};
}

function resetGoalRuntimeState(pi: ExtensionAPI): void {
	for (const state of goalRuntimeState.sessions.values())
		resetGoalSessionState(state);
	goalRuntimeState.sessions.clear();
	goalRuntimeState.extensionApi = pi;
}

function resetGoalSessionState(state: GoalRuntimeState): void {
	if (state.completionStatusTimer) clearTimeout(state.completionStatusTimer);
	state.goalStatusTimer?.stop();
	state.completionAuditPending?.controller.abort();
	state.completionAuditPending?.status?.stop();
	if (state.retryExhaustionWatch)
		clearTimeout(state.retryExhaustionWatch.timer);
	if (state.deferredAutoResume) clearTimeout(state.deferredAutoResume.timer);
	state.activeGoal = undefined;
	state.completionStatusTimer = undefined;
	state.goalStatusTimer = undefined;
	state.continuationPending = undefined;
	state.completionAuditPending = undefined;
	state.completionAuditGeneration = 0;
	state.cancelledContinuationMarkers = new Set<string>();
	state.websocketLimitRecoveryAt = new Map<string, number>();
	state.goalReviewLive = undefined;
	state.scheduledGoalStateReview = undefined;
	state.retryExhaustionWatch = undefined;
	state.deferredAutoResume = undefined;
	state.retryRecoveryGeneration = 0;
	state.retryAutoResumeUsedGoalIds = new Set<string>();
}

function goalStateForSession(ctx: StatusContext): GoalRuntimeState {
	const key = goalSessionKey(ctx);
	let state = goalRuntimeState.sessions.get(key);
	if (!state) {
		state = createGoalSessionState();
		goalRuntimeState.sessions.set(key, state);
	}
	return state;
}

function goalSessionKey(ctx: StatusContext): string {
	return currentSessionFile(ctx) ?? `${ctx.cwd}:no-session`;
}

function setActiveGoalForSession(
	ctx: StatusContext,
	goal: ActiveGoal | undefined,
) {
	const state = goalStateForSession(ctx);
	state.activeGoal = goal;
	return goal;
}

function activeGoalForSession(ctx: StatusContext): ActiveGoal | undefined {
	const state = goalStateForSession(ctx);
	if (!state.activeGoal) state.activeGoal = loadGoalFromSession(ctx);
	return state.activeGoal;
}

export default function goal(pi: ExtensionAPI) {
	resetGoalRuntimeState(pi);
	registerResultCardRenderer(pi);

	pi.on("session_start", (_event, ctx) => {
		const state = goalStateForSession(ctx);
		installFlowActivityFrame(ctx);
		clearContinuationTracking(state);
		state.activeGoal = loadGoalFromSession(ctx);
		if (state.activeGoal && flowContext(ctx)) rememberFlowContext(ctx);
		if (state.activeGoal) {
			if (state.activeGoal.status === "active" && state.activeGoal.artifactDir)
				watchGoalPlan(state.activeGoal.artifactDir);
			updateStatus(ctx, state.activeGoal);
		} else clearGoalUi(ctx);
		syncGoalStatusTimer(ctx, state, state.activeGoal);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		const state = goalStateForSession(ctx);
		cancelGoalRecoveryTimers(state);
		if (state.activeGoal) persistGoal(state.activeGoal, ctx);
		closeGoalPlanWatcher();
		clearContinuationTracking(state);
		if (state.activeGoal) syncGoalReviewSurfaces(state, ctx, state.activeGoal);
		stopGoalStatusTimer(state);
		clearCompletionStatusTimer(state);
		setGoalActivityBox(ctx, undefined);
		ctx.ui.setStatus(STATUS_KEY, undefined);
		clearFlowActivities();
	});

	pi.on("input", (event, ctx) => {
		const state = goalStateForSession(ctx);
		if (event.source !== "extension") {
			cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
			return;
		}
		if (consumeCancelledContinuationPrompt(state, event.text))
			return { action: "handled" as const };
	});

	pi.on("before_agent_start", (event, ctx) => {
		const state = goalStateForSession(ctx);
		cancelGoalRecoveryTimers(state);
		markContinuationDelivered(state, event.prompt);
		if (!state.activeGoal || state.activeGoal.status !== "active") return;
		state.activeGoal = { ...state.activeGoal, stepStartedAt: Date.now() };
		updateStatusBox(ctx, state.activeGoal);
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildGoalSystemPrompt(state.activeGoal, goalTodoPromptContext(ctx, state.activeGoal))}`,
		};
	});

	pi.on("agent_start", (_event, ctx) => {
		const state = goalStateForSession(ctx);
		cancelGoalRecoveryTimers(state);
		state.activeGoal = state.activeGoal
			? sanitizeLoadedGoal(ctx, state.activeGoal)
			: loadGoalFromSession(ctx);
		if (state.activeGoal?.status === "active")
			updateStatusBox(ctx, state.activeGoal);
	});

	pi.on("turn_start", (_event, ctx) =>
		cancelGoalRecoveryTimers(goalStateForSession(ctx)),
	);
	pi.on("message_start", (event, ctx) => {
		if ((event.message as { role?: unknown }).role === "user")
			cancelGoalRecoveryTimers(goalStateForSession(ctx));
	});

	pi.on("agent_end", async (event, ctx) => {
		const state = goalStateForSession(ctx);
		state.activeGoal = state.activeGoal
			? sanitizeLoadedGoal(ctx, state.activeGoal)
			: loadGoalFromSession(ctx);
		if (!state.activeGoal || state.activeGoal.status !== "active") return;
		const eventKey = agentEndEventKey(event);
		if (eventKey && handledGoalAgentEndEvents.has(eventKey)) return;
		if (eventKey) handledGoalAgentEndEvents.add(eventKey);
		const goalId = state.activeGoal.id;
		const hadPendingContinuation = state.continuationPending?.goalId === goalId;
		const finalAssistant = findFinalAssistantMessage(event.messages);
		if (isReviewLoopActive()) {
			scheduleContinueReviewAfterAgentEnd(pi, event, ctx);
			return saveActiveGoal(ctx, { updateStatus: false });
		}
		if (
			!state.activeGoal ||
			state.activeGoal.id !== goalId ||
			state.activeGoal.status !== "active"
		)
			return;
		if (agentEndedWithRecoverableTransportStop(event)) {
			updateGoalUsage(state.activeGoal, ctx);
			saveActiveGoal(ctx);
			if (finalAssistant)
				scheduleRetryExhaustionWatch(pi, ctx, state.activeGoal, finalAssistant);
			notifyUser(
				ctx,
				goalRetryWaitingNotice(ctx, state.activeGoal),
				"info",
				state.activeGoal.language,
			);
			return;
		}
		if (finalAssistant && isPiRetryableAgentError(finalAssistant)) {
			updateGoalUsage(state.activeGoal, ctx);
			saveActiveGoal(ctx);
			scheduleRetryExhaustionWatch(pi, ctx, state.activeGoal, finalAssistant);
			return;
		}
		if (!hadPendingContinuation)
			state.activeGoal = incrementGoal(state.activeGoal);
		updateGoalUsage(state.activeGoal, ctx);

		if (finalAssistant?.stopReason === "aborted")
			return pauseGoalAfterAgentEnd(ctx, state.activeGoal, finalAssistant);
		if (finalAssistant?.stopReason === "error") {
			saveActiveGoal(ctx);
			if (
				await recoverWebSocketLimitError(
					pi,
					ctx,
					state.activeGoal,
					finalAssistant,
				)
			)
				return;
			await sendContinuationPrompt(pi, ctx, state.activeGoal);
			return;
		}
		if (finalAssistant?.stopReason === "stop") {
			if (ctx.mode === "json" || ctx.mode === "print")
				await startGoalStateReview(ctx, state.activeGoal);
			else scheduleGoalStateReview(ctx, state.activeGoal);
			return;
		}
		if (state.completionAuditPending?.goalId === goalId) return;
		if (stopForBudget(ctx, state.activeGoal)) return;
		saveActiveGoal(ctx);
		if (hadPendingContinuation && !hasPendingMessages(ctx))
			state.continuationPending = undefined;
		if (!hasPendingMessages(ctx))
			await sendContinuationPrompt(pi, ctx, state.activeGoal);
	});
}

function flowStepContentEmptyNotice(language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Flow step content is empty", [
				"Cannot start an empty step",
			])
		: formatUserNotice("⚠️", "Flow 步骤内容为空", ["无法启动空步骤"]);
}

function goalExtensionNotInitializedNotice(language: Language) {
	return language === "en"
		? formatUserNotice("❌", "Goal extension is not initialized", [
				"Cannot start the Flow step",
			])
		: formatUserNotice("❌", "目标扩展尚未初始化", ["无法启动 Flow 步骤"]);
}

function acceptanceStartFailedNotice(language: Language, error: string) {
	return language === "en"
		? formatUserNotice("❌", "Acceptance start failed", [error])
		: formatUserNotice("❌", "完成验收启动失败", [error]);
}

export async function startGoalFromFlow(
	input: string | { objective: string; prompt: string },
	ctx: StatusContext,
	options: FlowGoalStartOptions = {},
) {
	const objective = typeof input === "string" ? input : input.objective;
	const prompt = typeof input === "string" ? input : input.prompt;
	const language = flowContext(ctx)?.flow.language ?? runtimeLanguage();
	const trimmed = objective.trim();
	if (!trimmed) {
		notifyUser(ctx, flowStepContentEmptyNotice(language), "info", language);
		return false;
	}
	const pi = goalRuntimeState.extensionApi;
	if (!pi) {
		notifyUser(
			ctx,
			goalExtensionNotInitializedNotice(language),
			"info",
			language,
		);
		return false;
	}
	if (!(await switchToRoleModel(pi, ctx, "executor", language))) return false;
	const state = goalStateForSession(ctx);
	cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
	cancelContinuationPending(state);
	cancelCompletionAudit(state);
	clearCompletionStatusTimer(state);
	const goal = createGoal(
		trimmed,
		undefined,
		currentTokenTotal(ctx),
		options.artifact,
		language,
	);
	setActiveGoalForSession(ctx, goal);
	if (goal.artifactDir) {
		syncStandaloneGoalArtifact(ctx, goal);
		watchGoalPlan(goal.artifactDir);
	}
	persistGoal(goal, ctx);
	updateStatus(ctx, goal);
	if (options.sendPrompt !== false) {
		const started = await sendRuntimePrompt(pi, ctx, prompt, { language });
		if (!started) {
			clearActiveGoal(ctx);
			return false;
		}
	}
	if (options.rememberFlowContext !== false) rememberFlowContext(ctx);
	return true;
}

export async function resumePausedGoalFromFlow(
	ctx: StatusContext,
): Promise<FlowGoalContinueResult> {
	const state = goalStateForSession(ctx);
	const goal = activeGoalForSession(ctx);
	if (!goal) return "no_goal";
	if (goal.status !== "paused" && goal.status !== "budget_limited")
		return "not_resumable";
	const pi = goalRuntimeState.extensionApi;
	if (!pi) return "busy";
	cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
	const previousGoal = goal;
	const resumedGoal =
		goal.status === "paused" ? { ...goal, id: randomUUID() } : goal;
	state.activeGoal = transitionGoal(resumedGoal, "active");
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	if (state.activeGoal.status !== "active") return "not_resumable";
	const routed = await continueFromCompletionCursor(ctx, state.activeGoal);
	if (routed) return routed;
	const resumed = await sendResumePrompt(pi, ctx, state.activeGoal);
	if (!resumed) {
		state.activeGoal = previousGoal;
		persistGoal(state.activeGoal, ctx);
		updateStatus(ctx, state.activeGoal);
		return "busy";
	}
	return "resumed";
}

async function continueFromCompletionCursor(
	ctx: StatusContext,
	goal: ActiveGoal,
): Promise<FlowGoalContinueResult | undefined> {
	const cursor = readCompletionCursor(ctx, goal);
	if (cursor === undefined) return "not_resumable";
	if (cursor === "acceptance_retry") {
		await startGoalStateReview(ctx as ExtensionContext, goal);
		return "continued";
	}
	if (cursor === "quality_retry") {
		await continueAfterGoalStateReviewPassed(
			ctx as ExtensionContext,
			goal,
			goal.stateReviewRounds,
		);
		return "continued";
	}
	if (cursor === "finalize_retry") {
		completeGoalAfterReviews(
			ctx as ExtensionContext,
			goal,
			goal.stateReviewRounds,
			undefined,
		);
		return "continued";
	}
	return undefined;
}

async function continueAfterRepairCursor(
	ctx: StatusContext,
	goal: ActiveGoal,
): Promise<FlowGoalContinueResult | undefined> {
	const cursor = readCompletionCursor(ctx, goal);
	if (cursor === undefined) return "not_resumable";
	if (cursor === "quality_repair") {
		await continueAfterGoalStateReviewPassed(
			ctx as ExtensionContext,
			goal,
			goal.stateReviewRounds,
		);
		return "continued";
	}
	if (cursor === "acceptance_repair" || cursor === null) {
		await startGoalStateReview(ctx as ExtensionContext, goal);
		return "continued";
	}
	return continueFromCompletionCursor(ctx, goal);
}

export async function continueActiveGoalIfIdle(
	ctx: StatusContext,
): Promise<FlowGoalContinueResult> {
	const state = goalStateForSession(ctx);
	const goal = activeGoalForSession(ctx);
	if (!goal) return "no_goal";
	if (goal.status !== "active") return "not_resumable";
	if (!ctx.isIdle?.() || hasPendingMessages(ctx)) return "busy";
	cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
	const routed = await continueFromCompletionCursor(ctx, goal);
	if (routed) return routed;
	if (latestAssistantFromSession(ctx)?.stopReason === "stop")
		return (await continueAfterRepairCursor(ctx, goal)) ?? "continued";
	const pi = goalRuntimeState.extensionApi;
	if (!pi) return "busy";
	return (await sendContinuationPrompt(pi, ctx, goal)) ? "continued" : "busy";
}

export function pauseGoalFromFlow(ctx: StatusContext) {
	const state = goalStateForSession(ctx);
	const goal = activeGoalForSession(ctx);
	if (!goal || goal.status !== "active") return false;
	cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
	cancelContinuationPending(state);
	cancelCompletionAudit(state);
	state.activeGoal = transitionGoal(goal, "paused");
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	return true;
}

export function clearCompletedGoalFromFlow(ctx: StatusContext, goalId: string) {
	const state = goalStateForSession(ctx);
	if (state.activeGoal?.id === goalId) {
		clearActiveGoal(ctx);
		return true;
	}
	const sessionGoal = loadGoalFromSession(ctx);
	if (!sessionGoal || sessionGoal.id !== goalId) return false;
	setActiveGoalForSession(ctx, sessionGoal);
	clearActiveGoal(ctx);
	return true;
}

export function getGoalState(
	ctx: StatusContext,
): FlowGoalRuntimeState | undefined {
	const goal = activeGoalForSession(ctx);
	return goal
		? {
				id: goal.id,
				text: goal.text,
				language: goal.language,
				status: goal.status,
			}
		: undefined;
}

export function isGoalActiveInSession(ctx: StatusContext) {
	return getGoalState(ctx)?.status === "active";
}

function scheduleGoalStateReview(ctx: ExtensionContext, goal: ActiveGoal) {
	const state = goalStateForSession(ctx);
	const goalId = goal.id;
	state.scheduledGoalStateReview = new Promise((resolve) => {
		setImmediate(() => {
			const current = state.activeGoal ?? loadGoalFromSession(ctx);
			if (!current || current.id !== goalId || current.status !== "active") {
				resolve();
				return;
			}
			void startGoalStateReview(ctx, current)
				.catch((error) =>
					notifyUser(
						ctx,
						acceptanceStartFailedNotice(current.language, notifyError(error)),
						"info",
						current.language,
					),
				)
				.finally(resolve);
		});
	});
}

export async function waitForScheduledGoalStateReview() {
	await Promise.all(
		[...goalRuntimeState.sessions.values()].map(
			(state) => state.scheduledGoalStateReview ?? Promise.resolve(),
		),
	);
	await waitForScheduledReviewAgentEnd();
}

async function startGoalStateReview(ctx: ExtensionContext, goal: ActiveGoal) {
	const state = goalStateForSession(ctx);
	cancelContinuationPending(state);
	updateGoalUsage(goal, ctx);
	const now = Date.now();
	if (!isGoalStateReviewEnabled()) {
		const reviewGoal: ActiveGoal = { ...goal, stepStartedAt: now };
		state.activeGoal = reviewGoal;
		persistGoal(reviewGoal, ctx);
		await continueAfterGoalStateReviewPassed(
			ctx,
			reviewGoal,
			reviewGoal.stateReviewRounds,
		);
		return;
	}
	const round = goal.stateReviewRounds + 1;
	const reviewGoal: ActiveGoal = {
		...goal,
		stateReviewRounds: round,
		stateReviewStartedAt: goal.stateReviewStartedAt ?? now,
		stepStartedAt: now,
	};
	state.activeGoal = reviewGoal;
	setCompletionCursor(ctx, reviewGoal, "acceptance_retry");
	persistGoal(reviewGoal, ctx);
	sendGoalStateReviewStartCard(ctx, reviewGoal, round);
	const run = startCompletionAudit(state, reviewGoal);
	const audit = await runGoalStateReviewWithStatus(
		reviewGoal,
		round,
		ctx,
		run.generation,
		run.signal,
	);
	if (!isCurrentCompletionAudit(state, reviewGoal.id, run.generation)) return;
	state.completionAuditPending = undefined;
	await handleGoalStateReviewResult(reviewGoal, round, audit, ctx);
}

async function handleGoalStateReviewResult(
	goal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
	ctx: ExtensionContext,
) {
	const state = goalStateForSession(ctx);
	const reviewedGoal = recordGoalReview(goal, round, audit);
	state.goalReviewLive = undefined;
	if (!audit.complete) {
		if (audit.systemError)
			return pauseGoalAfterReviewSystemError(ctx, reviewedGoal, audit);
		const repairGoal: ActiveGoal = {
			...reviewedGoal,
			stepStartedAt: Date.now(),
			updatedAt: Date.now(),
		};
		state.activeGoal = repairGoal;
		setCompletionCursor(ctx, repairGoal, "acceptance_repair");
		syncGoalReviewSurfaces(state, ctx, repairGoal);
		persistGoal(repairGoal, ctx);
		updateStatus(ctx, repairGoal);
		sendGoalReviewCard(ctx, reviewedGoal, round, audit, false);
		return;
	}
	state.activeGoal = reviewedGoal;
	syncGoalReviewSurfaces(state, ctx, reviewedGoal);
	sendGoalReviewCard(ctx, reviewedGoal, round, audit, true);
	await continueAfterGoalStateReviewPassed(ctx, reviewedGoal, round);
}

async function continueAfterGoalStateReviewPassed(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	stateReviewRound: number,
) {
	if (!shouldReviewGoalCompletion())
		return completeGoalAfterReviews(ctx, goal, stateReviewRound, undefined);
	const state = goalStateForSession(ctx);
	const flow = flowContext(ctx);
	const plan = goalPlanEvidence(ctx, goal);
	if (stateReviewRound > 0) await yieldForGoalReviewCard();
	stopGoalStatusTimer(state);
	setCompletionCursor(ctx, goal, "quality_retry");
	sendGoalQualityReviewStartCard(ctx, goal);
	let qualityStopHandled = false;
	const review = await runConfiguredReview(
		goalRuntimeState.extensionApi as ExtensionAPI,
		ctx,
		{
			scope: {
				kind: "goal",
				language: goal.language,
				goalText: goal.text,
				plan,
				statusPrefix: flow ? flowScope(flow.label) : GOAL_SCOPE,
				statusKey: STATUS_KEY,
				totalStartedAt: topStartedAt(ctx, goal),
				showTotalElapsed: shouldShowTotalElapsed(ctx, stateReviewRound),
				resumeCommand: goalResumeCommand(ctx),
				activity: flow
					? {
							object: "Flow",
							rows: activityRows(flow.displayLabel, goalDisplayText(ctx, goal)),
						}
					: {
							object: goal.language === "en" ? "Goal" : "目标",
							rows: activityRows(goalDisplayText(ctx, goal)),
						},
			},
			initialHistory: goal.qualityReviewHistory,
			onRoundStart: () => setCompletionCursor(ctx, goal, "quality_retry"),
			onProgress: (progress, history) =>
				publishGoalReviewLive(ctx, goal, {
					phase: "quality",
					progress,
					rounds: history,
				}),
			onPass: (stats, summary) =>
				completeGoalAfterReviews(ctx, goal, stateReviewRound, stats, summary),
			onStop: (message, history) => {
				qualityStopHandled = true;
				pauseGoalAfterQualityReviewStop(ctx, goal.id, message, history);
			},
		},
	);
	if (review.kind === "disabled")
		completeGoalAfterReviews(ctx, goal, stateReviewRound, undefined);
	else if (review.kind === "busy")
		pauseGoalAfterQualityReviewStop(
			ctx,
			goal.id,
			qualityStopMessage("busy", goal.language),
		);
	else if (review.kind === "needs_user")
		pauseGoalAfterQualityReviewStop(
			ctx,
			goal.id,
			qualityStopMessage("needs_user", goal.language),
		);
	else if (review.kind === "awaiting_delivery")
		pauseGoalAfterQualityReviewStop(
			ctx,
			goal.id,
			qualityStopMessage("awaiting_delivery", goal.language),
		);
	else if (review.kind === "awaiting_agent")
		setCompletionCursor(ctx, goal, "quality_repair");
	else if (review.kind === "stopped" && !qualityStopHandled)
		pauseGoalAfterQualityReviewStop(ctx, goal.id, review.message);
}

function pauseGoalAfterReviewSystemError(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	audit: GoalAuditResult,
) {
	const state = goalStateForSession(ctx);
	sendGoalReviewErrorCard(ctx, goal, goal.stateReviewRounds, audit);
	state.activeGoal = transitionGoal(goal, "paused");
	syncGoalReviewSurfaces(state, ctx, state.activeGoal);
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	notifyUser(
		ctx,
		completionErrorPausedNotice(ctx, goal, audit.feedback),
		"info",
		goal.language,
	);
}

function pauseGoalAfterQualityReviewStop(
	ctx: ExtensionContext,
	goalId: string,
	message: string | undefined = undefined,
	history: ReviewHistoryEntry[] = [],
) {
	const state = goalStateForSession(ctx);
	cancelCompletionAudit(state);
	state.goalReviewLive = undefined;
	if (!state.activeGoal || state.activeGoal.id !== goalId) return;
	state.activeGoal = transitionGoal(
		recordGoalQualityReview(state.activeGoal, history),
		"paused",
	);
	syncGoalReviewSurfaces(state, ctx, state.activeGoal);
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	closeGoalPlanWatcher();
	const reason =
		message ?? qualityStopMessage("incomplete", state.activeGoal.language);
	sendGoalQualityReviewBlockedCard(ctx, state.activeGoal, reason);
}

function sendGoalStateReviewStartCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	round: number,
) {
	const flow = flowContext(ctx);
	const title = roundTitle(
		round,
		acceptanceTitle("progress", goal.language),
		goal.language,
	);
	const lines = [
		...(flow ? [flowLine(flow.displayLabel, goal.language)] : []),
		goalLine(ctx, goal),
		modelLine(goalAuditorLabels(goal.language), goal.language),
	];
	const content = [`[${title}]`, ...lines].join("\n");
	sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		icon: "🎯",
		language: goal.language,
	});
}

function sendGoalQualityReviewStartCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
) {
	const flow = flowContext(ctx);
	const title = qualityTitle("progress", goal.language);
	const lines = [
		...(flow ? [flowLine(flow.displayLabel, goal.language)] : []),
		goalLine(ctx, goal),
		modelLine(qualityModelLabels(goal.language), goal.language),
	];
	const content = [`[${title}]`, ...lines].join("\n");
	sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		icon: "💯",
		language: goal.language,
	});
}

function pauseGoalAfterCompletionFactFailure(
	ctx: ExtensionContext,
	goal: ActiveGoal,
) {
	const state = goalStateForSession(ctx);
	state.activeGoal = transitionGoal(goal, "paused");
	syncGoalReviewSurfaces(state, ctx, state.activeGoal);
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	closeGoalPlanWatcher();
	sendGoalCompletionFactErrorCard(ctx, state.activeGoal);
}

function sendGoalQualityReviewBlockedCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	message: string,
) {
	const flow = flowContext(ctx);
	const next = goalResumeCommand(ctx);
	const title = flow
		? goal.language === "en"
			? `Flow ${flow.label} incomplete`
			: `Flow ${flow.label} 未完成`
		: goal.language === "en"
			? "Goal not completed"
			: "目标完成未收口";
	const lines = [
		goal.language === "en"
			? "Blocker: quality check did not close"
			: "卡点：质量检查未收口",
		goal.language === "en" ? `Reason: ${message}` : `原因：${message}`,
		goal.language === "en" ? `Next: ${next}` : `下一步：${next}`,
	];
	const content = [`[${title}]`, goalLine(ctx, goal), ...lines].join("\n");
	sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "quality-review",
		result: "错误",
		title,
		lines,
		language: goal.language,
	});
}

function sendGoalCompletionFactErrorCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
) {
	const flow = flowContext(ctx);
	const next = goalResumeCommand(ctx);
	const title = flow
		? goal.language === "en"
			? `Flow ${flow.label} completion fact write failed`
			: `Flow ${flow.label} 完成事实写入失败`
		: goal.language === "en"
			? "Goal completion fact write failed"
			: "目标完成事实写入失败";
	const lines =
		goal.language === "en"
			? [
					"Blocker: quality check passed, but completion fact was not written",
					"Reason: missing completion fact record",
					`Next: ${next}`,
				]
			: [
					"卡点：质量检查已通过，但完成事实未写入",
					"原因：缺少完成事实记录",
					`下一步：${next}`,
				];
	const content = [`[${title}]`, goalLine(ctx, goal), ...lines].join("\n");
	sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "quality-review",
		result: "错误",
		title,
		lines,
		language: goal.language,
	});
}

function sendGoalReviewErrorCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
) {
	const next = goalResumeCommand(ctx);
	const title = roundTitle(
		round,
		acceptanceTitle("error", goal.language),
		goal.language,
	);
	const bodyLines = [
		goal.language === "en"
			? "Blocker: acceptance did not complete"
			: "卡点：完成验收未完成",
		goal.language === "en"
			? `Reason: ${audit.feedback || audit.raw}`
			: `原因：${audit.feedback || audit.raw}`,
		goal.language === "en" ? `Next: ${next}` : `下一步：${next}`,
	];
	const lines = composeResultCardLines(
		[bodyLines],
		[
			resultCardElapsedLine(
				goalReviewElapsedText(ctx, goal, round),
				goal.language,
			),
		],
	);
	const content = [`[${title}]`, goalLine(ctx, goal), ...bodyLines].join("\n");
	sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "goal-review",
		result: "错误",
		title,
		lines,
		language: goal.language,
	});
}

function sendGoalReviewCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
	passed: boolean,
) {
	const result = passed ? "通过" : "未通过";
	const title = roundTitle(
		round,
		acceptanceTitle(passed ? "passed" : "failed", goal.language),
		goal.language,
	);
	const content = goalReviewContent(goal, round, audit, passed);
	const reviewLines = formatReviewResultLines(audit.raw);
	const bodyLines = [
		...(reviewLines.length
			? reviewLines
			: [
					goal.language === "en"
						? "Completion acceptance passed."
						: "完成验收通过。",
				]),
		...(audit.infraFeedback || !passed
			? infraAuditLines(audit, goal.language)
			: []),
	];
	const lines = composeResultCardLines(
		[bodyLines],
		[
			resultCardElapsedLine(
				goalReviewElapsedText(ctx, goal, round),
				goal.language,
			),
		],
	);
	sendResultCard(
		goalRuntimeState.extensionApi,
		ctx,
		content,
		{ tone: "goal-review", result, title, lines, language: goal.language },
		{ triggerTurn: !passed },
	);
}

function goalReviewContent(
	goal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
	passed: boolean,
) {
	const head = `[${roundTitle(
		round,
		acceptanceTitle(passed ? "passed" : "failed", goal.language),
		goal.language,
	)}]`;
	const lines = [
		head,
		"",
		goal.language === "en" ? "Original goal:" : "原目标：",
		goalObjectiveContent(goal),
		"",
		goal.language === "en" ? "Acceptance result:" : "验收结果：",
		audit.raw,
	];
	if (passed && audit.infraFeedback)
		lines.push(...infraAuditLines(audit, goal.language));
	if (!passed)
		lines.push(
			"",
			goal.language === "en" ? "Next:" : "下一步：",
			acceptanceFeedbackNextStep(goal.language),
		);
	return lines.join("\n");
}

function acceptanceFeedbackNextStep(language: Language) {
	return language === "en"
		? "Treat the completion-acceptance feedback as hypotheses to verify, not facts. Verify it against the original goal, current files, and verification output. When feedback is valid, fill the original-goal gap and verify it. When feedback is invalid, do not apply it and state the basis (file, command output, or constraint). After handling the feedback, continue completing the original Goal; do not only handle the acceptance feedback."
		: "将完成验收反馈视为待核实假设，而非事实；先基于原目标、当前文件和验证输出核实。反馈属实时，补齐原目标缺口并验证；反馈不成立时，不应用该反馈，并说明依据（文件、命令输出或约束）。处理完反馈后继续完成原目标；不要只处理验收反馈。";
}

function infraAuditLines(audit: GoalAuditResult, language: Language) {
	return audit.infraFeedback
		? [
				"",
				"---",
				"",
				language === "en"
					? "Non-fix item: model system error"
					: "非修复项：模型系统错误",
				"",
				...audit.infraFeedback.split(/\r?\n/).filter(Boolean),
			]
		: [];
}

function acceptanceTitle(
	state: "progress" | "passed" | "failed" | "error",
	language: Language,
) {
	if (language === "en") {
		if (state === "progress") return "Completion acceptance in progress";
		if (state === "passed") return "Completion acceptance passed";
		if (state === "failed") return "Completion acceptance failed";
		return "Completion acceptance error";
	}
	if (state === "progress") return "完成验收中";
	if (state === "passed") return "完成验收通过";
	if (state === "failed") return "完成验收未通过";
	return "完成验收错误";
}

function qualityTitle(_state: "progress", language: Language) {
	return language === "en" ? "Quality check in progress" : "质量检查中";
}

function flowLine(label: string, language: Language) {
	return language === "en" ? `Flow: ${label}` : `Flow：${label}`;
}

function goalLine(ctx: StatusContext, goal: ActiveGoal) {
	const text = goalDisplayText(ctx, goal);
	return goal.language === "en" ? `Goal: ${text}` : `目标：${text}`;
}

function modelLine(labels: string, language: Language) {
	return language === "en" ? `Models: ${labels}` : `模型：${labels}`;
}

function goalObjectiveContent(goal: ActiveGoal) {
	const tag = goal.language === "en" ? "goal" : "目标";
	return `<${tag}>\n${escapeXmlTextContent(goal.text)}\n</${tag}>`;
}

function escapeXmlTextContent(value: string) {
	return value
		.replace(/&/gu, "&amp;")
		.replace(/</gu, "&lt;")
		.replace(/>/gu, "&gt;");
}

function completeGoalAfterReviews(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	stateReviewRound: number,
	reviewStats: ReviewLoopStats | undefined,
	qualitySummary = "",
) {
	finalizeGoalCompletion(
		goalStateForSession(ctx),
		ctx,
		goal,
		stateReviewRound,
		reviewStats,
		qualitySummary,
		{
			extensionApi: goalRuntimeState.extensionApi,
			transitionGoal,
			updateGoalUsage,
			persistGoal,
			clearActiveGoal,
			showCompletionStatus,
			onCompletionFactFailure: pauseGoalAfterCompletionFactFailure,
			setCompletionCursor,
		},
	);
}

function goalDisplayText(ctx: StatusContext, goal: ActiveGoal) {
	if (!isLegacyFlowPromptText(goal.text)) return goal.text;
	const flow = flowContext(ctx);
	return flow
		? objectiveFromPlan(flow.plan.snapshot ?? "") || flow.plan.title
		: goal.text;
}

function goalReviewElapsedText(
	ctx: StatusContext,
	goal: ActiveGoal,
	round: number,
) {
	return elapsedLabel(
		elapsedSeconds(goal.stepStartedAt),
		elapsedSeconds(topStartedAt(ctx, goal)),
		shouldShowTotalElapsed(ctx, round),
		goal.language,
	);
}

function createGoal(
	text: string,
	tokenBudget: number | undefined,
	baselineTokens: number,
	artifact?: { artifactDir: string; artifactId: string },
	language: Language = runtimeLanguage(),
): ActiveGoal {
	const now = Date.now();
	return {
		id: randomUUID(),
		text,
		language,
		status: "active",
		startedAt: now,
		updatedAt: now,
		iteration: 0,
		stateReviewRounds: 0,
		stateReviewHistory: [],
		qualityReviewHistory: [],
		tokenBudget,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		baselineTokens,
		stepStartedAt: now,
		...artifact,
	};
}

function transitionGoal(goal: ActiveGoal, status: GoalStatus): ActiveGoal {
	return normalizeGoalForBudget({
		...goal,
		status,
		updatedAt: Date.now(),
		stepStartedAt: Date.now(),
	});
}

function normalizeGoalForBudget(goal: ActiveGoal): ActiveGoal {
	if (
		goal.status === "active" &&
		goal.tokenBudget !== undefined &&
		goal.tokensUsed >= goal.tokenBudget
	)
		return { ...goal, status: "budget_limited" };
	return goal;
}

function incrementGoal(goal: ActiveGoal): ActiveGoal {
	return { ...goal, iteration: goal.iteration + 1, updatedAt: Date.now() };
}

function pauseGoalAfterAgentEnd(
	ctx: StatusContext,
	goal: ActiveGoal,
	assistant: AssistantMessageLike,
) {
	const state = goalStateForSession(ctx);
	cancelGoalRecoveryTimers(state);
	cancelContinuationPending(state);
	cancelCompletionAudit(state);
	state.activeGoal = transitionGoal(goal, "paused");
	syncStandaloneGoalArtifact(ctx, state.activeGoal);
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	closeGoalPlanWatcher();
	notifyUser(
		ctx,
		goalExecutionInterruptedNotice(ctx, goal, assistant.errorMessage),
		"info",
		goal.language,
	);
}

function scheduleRetryExhaustionWatch(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goal: ActiveGoal,
	assistant: AssistantMessageLike,
) {
	const state = goalStateForSession(ctx);
	cancelRetryExhaustionWatch(state);
	const generation = nextRetryRecoveryGeneration(state);
	const errorMessage =
		assistant.errorMessage ??
		(goal.language === "en" ? "unknown network error" : "未知网络错误");
	const timer = setTimeout(() => {
		pauseGoalAfterRetryExhaustion(pi, ctx, goal.id, generation, errorMessage);
	}, PI_RETRY_EXHAUSTION_GUARD_MS);
	timer.unref?.();
	state.retryExhaustionWatch = {
		goalId: goal.id,
		generation,
		timer,
	};
}

function pauseGoalAfterRetryExhaustion(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goalId: string,
	generation: number,
	errorMessage: string,
) {
	const state = goalStateForSession(ctx);
	const watch = state.retryExhaustionWatch;
	if (!watch || watch.goalId !== goalId || watch.generation !== generation)
		return;
	state.retryExhaustionWatch = undefined;
	const goal = state.activeGoal ?? loadGoalFromSession(ctx);
	if (!goal || goal.id !== goalId || goal.status !== "active") return;
	updateGoalUsage(goal, ctx);
	state.activeGoal = transitionGoal(goal, "paused");
	syncStandaloneGoalArtifact(ctx, state.activeGoal);
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	closeGoalPlanWatcher();
	const willAutoResume = !state.retryAutoResumeUsedGoalIds.has(goalId);
	sendRetryExhaustedCard(ctx, state.activeGoal, errorMessage, willAutoResume);
	notifyUser(
		ctx,
		retryExhaustedNotification(
			ctx,
			state.activeGoal,
			errorMessage,
			willAutoResume,
		),
		"info",
		state.activeGoal.language,
	);
	if (willAutoResume)
		scheduleAutoResumeAfterRetryExhaustion(pi, ctx, state.activeGoal);
}

function scheduleAutoResumeAfterRetryExhaustion(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goal: ActiveGoal,
) {
	const state = goalStateForSession(ctx);
	cancelDeferredAutoResume(state);
	const generation = nextRetryRecoveryGeneration(state);
	const timer = setTimeout(() => {
		void resumeGoalAfterRetryBackoff(pi, ctx, goal.id, generation);
	}, AUTO_RESUME_AFTER_RETRY_EXHAUSTION_MS);
	timer.unref?.();
	state.deferredAutoResume = { goalId: goal.id, generation, timer };
}

async function resumeGoalAfterRetryBackoff(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goalId: string,
	generation: number,
) {
	const state = goalStateForSession(ctx);
	const deferred = state.deferredAutoResume;
	if (
		!deferred ||
		deferred.goalId !== goalId ||
		deferred.generation !== generation
	)
		return;
	state.deferredAutoResume = undefined;
	const goal = state.activeGoal ?? loadGoalFromSession(ctx);
	if (!goal || goal.id !== goalId || goal.status !== "paused") return;
	state.retryAutoResumeUsedGoalIds.add(goalId);
	state.activeGoal = transitionGoal(goal, "active");
	syncStandaloneGoalArtifact(ctx, state.activeGoal);
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	if (state.activeGoal.status !== "active") return;
	if (state.activeGoal.artifactDir) watchGoalPlan(state.activeGoal.artifactDir);
	sendRetryAutoResumeCard(ctx, state.activeGoal);
	const resumedGoal = state.activeGoal;
	if (await sendResumePrompt(pi, ctx, resumedGoal)) return;
	state.activeGoal = transitionGoal(resumedGoal, "paused");
	syncStandaloneGoalArtifact(ctx, state.activeGoal);
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
}

function sendRetryExhaustedCard(
	ctx: StatusContext,
	goal: ActiveGoal,
	errorMessage: string,
	willAutoResume: boolean,
) {
	const next = goalResumeCommand(ctx);
	const lines =
		goal.language === "en"
			? [
					"Blocker: Pi automatic retries are exhausted",
					`Reason: ${truncateNotification(errorMessage)}`,
					willAutoResume
						? "Automatic action: resume once after 5 minutes without user action"
						: "Automatic action: already resumed once; will not resume again",
					`Next: ${next}`,
				]
			: [
					"卡点：Pi 自动重试已耗尽",
					`原因：${truncateNotification(errorMessage)}`,
					willAutoResume
						? "自动处理：5 分钟无人操作后自动恢复一次"
						: "自动处理：已自动恢复过一次，本次不再自动恢复",
					`下一步：${next}`,
				];
	const title = flowContext(ctx)
		? goal.language === "en"
			? "Flow retry pause"
			: "Flow 连接重试已暂停"
		: goal.language === "en"
			? "Goal retry pause"
			: "目标连接重试已暂停";
	const content = [`[${title}]`, goalLine(ctx, goal), ...lines].join("\n");
	sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "neutral",
		result: "错误",
		title,
		lines,
		language: goal.language,
	});
}

function sendRetryAutoResumeCard(ctx: StatusContext, goal: ActiveGoal) {
	const title = flowContext(ctx)
		? goal.language === "en"
			? "Flow auto-resuming Goal"
			: "Flow 自动恢复目标"
		: goal.language === "en"
			? "Goal auto-resume"
			: "目标自动恢复";
	const lines =
		goal.language === "en"
			? [
					"Source: 5-minute wait after Pi automatic retries were exhausted",
					"Action: resume once automatically",
				]
			: ["来源：Pi 自动重试耗尽后的 5 分钟等待", "动作：自动恢复一次"];
	const content = [`[${title}]`, goalLine(ctx, goal), ...lines].join("\n");
	sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		language: goal.language,
	});
}

function retryExhaustedNotification(
	ctx: StatusContext,
	goal: ActiveGoal,
	errorMessage: string,
	willAutoResume: boolean,
) {
	if (goal.language === "en") {
		const autoResumeLine = willAutoResume
			? "Automatic action: resume once after 5 minutes without user action"
			: "Automatic action: already resumed once; will not resume again";
		return formatUserNotice("⚠️", goalNoticeTitle(ctx, goal, "paused"), [
			"Pi automatic retries are exhausted",
			`Reason: ${truncateNotification(errorMessage)}`,
			autoResumeLine,
			`Run ${goalResumeCommand(ctx)} to continue`,
		]);
	}
	const autoResumeLine = willAutoResume
		? "自动处理：5 分钟无人操作后自动恢复一次"
		: "自动处理：已自动恢复过一次，本次不再自动恢复";
	return formatUserNotice("⚠️", goalNoticeTitle(ctx, goal, "已暂停"), [
		"Pi 自动重试耗尽",
		`原因：${truncateNotification(errorMessage)}`,
		autoResumeLine,
		`运行 ${goalResumeCommand(ctx)} 继续`,
	]);
}

async function recoverWebSocketLimitError(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goal: ActiveGoal,
	assistant: AssistantMessageLike,
) {
	const state = goalStateForSession(ctx);
	if (!isResponsesWebSocketLimitError(assistant.errorMessage)) return false;
	if (!canAutoRecoverWebSocketLimit(state, goal)) {
		pauseGoalAfterWebSocketLimit(
			ctx,
			goal,
			goal.language === "en"
				? "automatic continuation was too fast; paused to prevent a loop"
				: "自动继续过快，已暂停防止循环",
		);
		return true;
	}
	notifyUser(
		ctx,
		websocketLimitContinuedNotice(ctx, goal),
		"info",
		goal.language,
	);
	if (await sendContinuationPrompt(pi, ctx, goal)) {
		state.websocketLimitRecoveryAt.set(goal.id, Date.now());
		return true;
	}
	pauseGoalAfterWebSocketLimit(
		ctx,
		goal,
		goal.language === "en" ? "automatic continuation failed" : "自动继续失败",
	);
	return true;
}

function canAutoRecoverWebSocketLimit(
	state: GoalRuntimeState,
	goal: ActiveGoal,
) {
	const recoveredAt = state.websocketLimitRecoveryAt.get(goal.id) ?? 0;
	return Date.now() - recoveredAt >= WEBSOCKET_LIMIT_RECOVERY_COOLDOWN_MS;
}

function pauseGoalAfterWebSocketLimit(
	ctx: StatusContext,
	goal: ActiveGoal,
	reason: string,
) {
	const state = goalStateForSession(ctx);
	cancelGoalRecoveryTimers(state);
	cancelContinuationPending(state);
	cancelCompletionAudit(state);
	state.activeGoal = transitionGoal(goal, "paused");
	syncStandaloneGoalArtifact(ctx, state.activeGoal);
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	closeGoalPlanWatcher();
	notifyUser(
		ctx,
		websocketLimitPausedNotice(ctx, goal, reason),
		"info",
		goal.language,
	);
}

function isResponsesWebSocketLimitError(message: string | undefined) {
	return Boolean(
		message?.includes(RESPONSES_WEBSOCKET_LIMIT_CODE) ||
			message?.includes("Responses websocket connection limit reached"),
	);
}

function goalRetryWaitingNotice(ctx: StatusContext, goal: ActiveGoal) {
	return goal.language === "en"
		? formatUserNotice(
				"⏳",
				goalNoticeTitle(ctx, goal, "connection interrupted"),
				["Waiting for Pi to retry automatically"],
			)
		: formatUserNotice("⏳", goalNoticeTitle(ctx, goal, "连接中断"), [
				"等待 Pi 自动重试",
			]);
}

function goalExecutionInterruptedNotice(
	ctx: StatusContext,
	goal: ActiveGoal,
	errorMessage: string | undefined,
) {
	const reason = errorMessage
		? truncateNotification(errorMessage)
		: goal.language === "en"
			? "execution interrupted"
			: "执行中断";
	return goal.language === "en"
		? formatUserNotice("⚠️", goalNoticeTitle(ctx, goal, "paused"), [
				`Reason: ${reason}`,
				`Run ${goalResumeCommand(ctx)} to continue`,
			])
		: formatUserNotice("⚠️", goalNoticeTitle(ctx, goal, "已暂停"), [
				`原因：${reason}`,
				`运行 ${goalResumeCommand(ctx)} 继续`,
			]);
}

function websocketLimitContinuedNotice(ctx: StatusContext, goal: ActiveGoal) {
	return goal.language === "en"
		? formatUserNotice(
				"🔁",
				goalNoticeTitle(ctx, goal, "continued automatically"),
				["Connection reached the 60-minute limit"],
			)
		: formatUserNotice("🔁", goalNoticeTitle(ctx, goal, "已自动继续"), [
				"连接到达 60 分钟上限",
			]);
}

function websocketLimitPausedNotice(
	ctx: StatusContext,
	goal: ActiveGoal,
	reason: string,
) {
	return goal.language === "en"
		? formatUserNotice("⚠️", goalNoticeTitle(ctx, goal, "paused"), [
				"Connection reached the 60-minute limit",
				`Reason: ${reason}`,
				`Run ${goalResumeCommand(ctx)} to continue`,
			])
		: formatUserNotice("⚠️", goalNoticeTitle(ctx, goal, "已暂停"), [
				"连接到达 60 分钟上限",
				`原因：${reason}`,
				`运行 ${goalResumeCommand(ctx)} 继续`,
			]);
}

function goalNoticeTitle(ctx: StatusContext, goal: ActiveGoal, suffix: string) {
	return scopedGoalNoticeTitle(ctx, goal.language, suffix);
}

function scopedGoalNoticeTitle(
	ctx: StatusContext,
	language: Language,
	suffix: string,
) {
	const scope = goalScopeLabel(ctx, language);
	return language === "en" || scope === "Flow"
		? `${scope} ${suffix}`
		: `${scope}${suffix}`;
}

function goalScopeLabel(ctx: StatusContext, language: Language = "zh") {
	if (flowContext(ctx)) return "Flow";
	return language === "en" ? "Goal" : "目标";
}

function goalTokenBudgetReachedNotice(language: Language, budget: string) {
	return language === "en"
		? formatUserNotice("⚠️", "Goal token budget reached", [budget])
		: formatUserNotice("⚠️", "目标令牌预算已达到", [budget]);
}

function completionStateReadFailedNotice(language: Language, error: string) {
	return language === "en"
		? formatUserNotice("❌", "Completion state read failed", [error])
		: formatUserNotice("❌", "完成状态读取失败", [error]);
}

function completionStateSaveFailedNotice(language: Language, error: string) {
	return language === "en"
		? formatUserNotice("❌", "Completion state save failed", [error])
		: formatUserNotice("❌", "完成状态保存失败", [error]);
}

function pausedContinueMessage(ctx: StatusContext, language: Language) {
	return formatUserNotice(
		"⚠️",
		language === "en"
			? scopedGoalNoticeTitle(ctx, language, "paused")
			: scopedGoalNoticeTitle(ctx, language, "已暂停"),
		pausedContinueLines(ctx, language),
	);
}

function completionErrorPausedNotice(
	ctx: StatusContext,
	goal: ActiveGoal,
	feedback: string,
) {
	return formatUserNotice(
		"⚠️",
		goal.language === "en"
			? goalNoticeTitle(ctx, goal, "paused")
			: goalNoticeTitle(ctx, goal, "已暂停"),
		[
			goal.language === "en" ? "Completion acceptance error" : "完成验收错误",
			feedback,
			...pausedContinueLines(ctx, goal.language),
		],
	);
}

function pausedContinueLines(ctx: StatusContext, language: Language) {
	const command = goalResumeCommand(ctx);
	return language === "en"
		? [`Run ${command} to continue`]
		: [`运行 ${command} 继续`];
}

function qualityStopMessage(
	kind: "busy" | "needs_user" | "awaiting_delivery" | "incomplete",
	language: Language,
) {
	if (language === "en") {
		if (kind === "busy")
			return "Quality check loop is already running; the Goal completion chain did not close.";
		if (kind === "needs_user")
			return "Quality check failed and is waiting for manual fixes.";
		if (kind === "awaiting_delivery")
			return "Quality fix prompt is waiting to be delivered; the Goal completion chain did not close.";
		return "Quality check did not complete; the Goal completion chain did not close.";
	}
	if (kind === "busy") return "质量检查循环已在运行，目标完成链未收口。";
	if (kind === "needs_user") return "质量检查未通过，等待手动应用修复建议。";
	if (kind === "awaiting_delivery")
		return "质量检查修复提示等待投递，目标完成链未收口。";
	return "质量检查未完成，目标完成链未收口。";
}

function goalResumeCommand(ctx: StatusContext) {
	return `/flow go${flowCommandSuffix(ctx)}`;
}

function goalClearCommand(ctx: StatusContext) {
	return `/flow go${flowCommandSuffix(ctx)}`;
}

function flowCommandSuffix(ctx: StatusContext) {
	const flow = flowContext(ctx);
	return flow ? ` ${flowCommandId(flow.flow.id)}` : "";
}

function stopForBudget(ctx: StatusContext, goal: ActiveGoal) {
	if (goal.tokenBudget === undefined || goal.tokensUsed < goal.tokenBudget)
		return false;
	const state = goalStateForSession(ctx);
	cancelGoalRecoveryTimers(state);
	cancelContinuationPending(state);
	state.activeGoal = transitionGoal(goal, "budget_limited");
	syncStandaloneGoalArtifact(ctx, state.activeGoal);
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	closeGoalPlanWatcher();
	notifyUser(
		ctx,
		goalTokenBudgetReachedNotice(goal.language, formatBudget(state.activeGoal)),
		"info",
		goal.language,
	);
	return true;
}

function updateGoalUsage(goal: ActiveGoal, ctx: StatusContext) {
	goal.tokensUsed = Math.max(0, currentTokenTotal(ctx) - goal.baselineTokens);
	updateGoalElapsed(goal);
}

function updateGoalElapsed(goal: ActiveGoal) {
	goal.timeUsedSeconds = elapsedSeconds(goal.startedAt);
	goal.updatedAt = Date.now();
}

function updateStatus(ctx: StatusContext, goal: ActiveGoal) {
	const isActive = goal.status === "active";
	setFlowActivity("goal", isActive);
	updateStatusBox(ctx, goal);
	if (isActive) updateGoalElapsed(goal);
	setStatusText(ctx, STATUS_KEY, formatStatus(ctx, goal), goal.language);
	syncGoalStatusTimer(ctx, goalStateForSession(ctx), goal);
}

function updateStatusBox(ctx: StatusContext | undefined, goal: ActiveGoal) {
	const target = ctx;
	if (!target) return;
	if (goal.status === "paused" || goal.status === "budget_limited") {
		setGoalActivityBox(target, pausedGoalActivity(target, goal));
		return;
	}
	if (goal.status !== "active") return setGoalActivityBox(target, undefined);
	if (isGoalScopedReviewActive()) return setGoalActivityBox(target, undefined);
	const phase = goalUiPhase(goal);
	if (phase.kind === "qualityRepair") {
		setGoalActivityBox(target, undefined);
		setReviewActivityBox(target, qualityRepairActivity(target, goal, phase));
		return;
	}
	setGoalActivityBox(target, {
		...activeGoalActivity(target, goal, phase),
		hint: `${currentCancelHint()} ${goal.language === "en" ? "pause" : "暂停"}`,
	});
}

async function runGoalStateReviewWithStatus(
	goal: ActiveGoal,
	round: number,
	ctx: ExtensionContext,
	generation: number,
	signal?: AbortSignal,
) {
	const state = goalStateForSession(ctx);
	stopGoalStatusTimer(state);
	setReviewActivityBox(ctx, undefined);
	setGoalActivityBox(ctx, {
		...goalReviewActivityMessage(ctx, goal, round),
		hint: `${currentCancelHint()} ${goal.language === "en" ? "cancel" : "取消"}`,
	});
	setFlowEditorInputHidden(true);
	setFlowCancelHandler(() => cancelGoalReview(ctx));
	const status = startElapsedStatus(
		ctx,
		STATUS_KEY,
		(seconds) =>
			`${goalReviewStatusPrefix(ctx, goal, round)} · ${elapsedLabel(seconds, elapsedSeconds(topStartedAt(ctx, goal)), shouldShowTotalElapsed(ctx, round), goal.language)}`,
		{
			isActive: () => isCurrentCompletionAudit(state, goal.id, generation),
			language: goal.language,
		},
	);
	trackCompletionAuditStatus(state, goal.id, generation, status);
	try {
		return await auditGoalCompletion(
			{
				text: goal.text,
				language: goal.language,
				plan: goalPlanEvidence(ctx, goal),
			},
			"",
			ctx,
			signal,
			(progress) => {
				if (!isCurrentCompletionAudit(state, goal.id, generation)) return;
				publishGoalReviewLive(ctx, goal, { phase: "acceptance", progress });
				setGoalActivityBox(ctx, {
					...goalReviewActivityMessage(ctx, goal, round, progress),
					hint: `${currentCancelHint()} ${goal.language === "en" ? "cancel" : "取消"}`,
				});
			},
		);
	} finally {
		setFlowEditorInputHidden(false);
		setFlowCancelHandler(undefined);
		setGoalActivityBox(ctx, undefined);
		clearCompletionAuditStatus(state, ctx, goal.id, generation, status);
	}
}

function cancelGoalReview(ctx: ExtensionContext) {
	const state = goalStateForSession(ctx);
	cancelCompletionAudit(state);
	if (!state.activeGoal) return;
	state.activeGoal = transitionGoal(state.activeGoal, "paused");
	syncGoalReviewSurfaces(state, ctx, state.activeGoal);
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	closeGoalPlanWatcher();
	notifyUser(
		ctx,
		pausedContinueMessage(ctx, state.activeGoal.language),
		"info",
		state.activeGoal.language,
	);
}

function startCompletionAudit(state: GoalRuntimeState, goal: ActiveGoal) {
	return startCompletionAuditState(state, goal);
}

function isGoalStateReviewEnabled() {
	try {
		return readFlowConfig().acceptance.enabled;
	} catch {
		return true;
	}
}

function shouldReviewGoalCompletion() {
	try {
		return readFlowConfig().quality.runAfterCompletion;
	} catch {
		return true;
	}
}

function goalReviewActivityMessage(
	ctx: StatusContext,
	goal: ActiveGoal,
	round: number,
	progress: ReviewerProgress[] = [],
) {
	return {
		language: goal.language,
		title: `${goalActivityObject(ctx, goal.language)} · ${roundTitle(
			round,
			acceptanceTitle("progress", goal.language),
			goal.language,
		)}`,
		rows: activityRows(
			goalReviewActivityRows(ctx, goal),
			progress.length > 0
				? reviewerProgressLines(progress)
				: goalAuditLines(goal.language),
		),
	};
}

function goalReviewActivityRows(ctx: StatusContext, goal: ActiveGoal) {
	const flow = flowContext(ctx);
	const goalText = goalDisplayText(ctx, goal);
	return flow
		? activityRows(flow.displayLabel, goalText)
		: activityRows(goalText);
}

function goalAuditLines(_language: Language) {
	try {
		return readFlowConfig().models.map(
			(auditor, index) => `${index + 1}·${shortModel(auditor.model)} …`,
		);
	} catch {
		return ["1·gpt …"];
	}
}

function goalAuditorLabels(language: Language = "zh") {
	try {
		return readFlowConfig()
			.models.map((auditor) => shortModel(auditor.model))
			.join(language === "en" ? ", " : "、");
	} catch {
		return language === "en" ? "config read failed" : "配置读取失败";
	}
}

function qualityModelLabels(language: Language = "zh") {
	try {
		return readFlowConfig()
			.models.map((model) => shortModel(model.model))
			.join(language === "en" ? ", " : "、");
	} catch {
		return language === "en" ? "config read failed" : "配置读取失败";
	}
}

function saveActiveGoal(
	ctx: StatusContext,
	options: { updateStatus?: boolean } = {},
) {
	const state = goalStateForSession(ctx);
	saveActiveGoalEntry({
		ctx,
		goal: state.activeGoal,
		live: state.goalReviewLive,
		pi: goalRuntimeState.extensionApi,
	});
	if (options.updateStatus === false) return;
	if (state.activeGoal) updateStatus(ctx, state.activeGoal);
}

function syncStandaloneGoalArtifact(
	ctx: StatusContext,
	goal: ActiveGoal,
	audit = "",
) {
	syncStandaloneGoalArtifactEntry(
		ctx,
		goal,
		goalStateForSession(ctx).goalReviewLive,
		audit,
	);
}

function readCompletionCursor(
	ctx: StatusContext,
	goal: ActiveGoal,
): CompletionCursor | undefined {
	try {
		if (goal.artifactDir)
			return readStepRuntimeState(goal.artifactDir).completionCursor;
		const flow = flowContext(ctx);
		if (flow) return flow.plan.completionCursor;
		throw new Error(
			goal.language === "en"
				? "active Goal has no artifact"
				: "活动目标缺少 artifact",
		);
	} catch (error) {
		notifyUser(
			ctx,
			completionStateReadFailedNotice(goal.language, notifyError(error)),
			"info",
			goal.language,
		);
		return undefined;
	}
}

function setCompletionCursor(
	ctx: StatusContext,
	goal: ActiveGoal,
	cursor: CompletionCursor,
) {
	try {
		if (goal.artifactDir) {
			const state = readStepRuntimeState(goal.artifactDir);
			writeStepRuntimeState(goal.artifactDir, {
				...state,
				completionCursor: cursor,
			});
			return;
		}
		const owner = flowOwnerForSession(ctx);
		if (!owner)
			throw new Error(
				goal.language === "en"
					? "active Flow Goal has no flow artifact"
					: "活动 Flow 目标缺少 flow artifact",
			);
		const sessionFile = currentSessionFile(ctx);
		const updated = withFlowLockSync(
			owner.dir,
			`completion cursor ${owner.flow.id}`,
			() => {
				const flow = readFlow(owner.dir);
				const current = currentGoal(flow);
				if (!current || current.sessionFile !== sessionFile) return;
				const goals = flow.goals.map((item, index) =>
					index === flow.currentGoal
						? { ...item, completionCursor: cursor }
						: item,
				);
				const saved = writeFlow(owner.dir, { ...flow, goals });
				writeFlowHtml(owner.dir, saved);
			},
		);
		if (!updated.ok)
			throw new Error(flowLockBusyMessage(updated.owner, goal.language));
	} catch (error) {
		notifyUser(
			ctx,
			completionStateSaveFailedNotice(goal.language, notifyError(error)),
			"info",
			goal.language,
		);
	}
}

function publishGoalReviewLive(
	ctx: StatusContext,
	goal: ActiveGoal,
	live: GoalReviewLive,
) {
	const state = goalStateForSession(ctx);
	state.goalReviewLive = live;
	syncGoalReviewSurfaces(state, ctx, goal);
}

function clearGoalUi(ctx: StatusContext) {
	setFlowActivity("goal", false);
	setGoalActivityBox(ctx, undefined);
	ctx.ui.setStatus(STATUS_KEY, undefined);
}

function goalTodoPromptContext(
	ctx: StatusContext,
	goal: ActiveGoal,
): GoalTodoPromptContext {
	if (goal.artifactDir) return {};
	const flow = flowContext(ctx);
	if (!flow) return {};
	return {
		planPath: `.flow/${flow.flow.id}/${flow.plan.file}`,
		recordSection: "Handoff",
		stateFile: "flow.json",
	};
}

async function sendResumePrompt(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goal: ActiveGoal,
) {
	return sendRuntimePrompt(
		pi,
		ctx,
		buildResumePrompt(goal, goalTodoPromptContext(ctx, goal)),
		{ language: goal.language },
	);
}

async function sendContinuationPrompt(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goal: ActiveGoal,
) {
	const state = goalStateForSession(ctx);
	if (state.continuationPending?.goalId === goal.id || hasPendingMessages(ctx))
		return false;
	const marker = continuationMarker(goal);
	const prompt = buildContinuePrompt(
		goal,
		marker,
		goalTodoPromptContext(ctx, goal),
	);
	state.continuationPending = {
		goalId: goal.id,
		iteration: goal.iteration,
		marker,
		prompt,
	};
	const sent = await sendRuntimePrompt(pi, ctx, prompt, {
		deliverAsFollowUp: true,
		language: goal.language,
	});
	if (!sent && state.continuationPending?.marker === marker)
		state.continuationPending = undefined;
	return sent;
}

async function sendRuntimePrompt(
	pi: ExtensionAPI,
	ctx: StatusContext,
	prompt: string,
	options: { deliverAsFollowUp?: boolean; language?: Language } = {},
) {
	const language = options.language ?? runtimeLanguage();
	return sendOrchestrationPrompt(pi, ctx, prompt, {
		customType: "pi-flow-goal-prompt",
		followUp: options.deliverAsFollowUp || !ctx.isIdle?.(),
		errorPrefix:
			language === "en" ? "Goal prompt send failed" : "目标提示发送失败",
		language,
	});
}

function formatStatus(ctx: StatusContext, goal: ActiveGoal | undefined) {
	if (!goal) return undefined;
	if (goal.status === "complete")
		return goal.language === "en" ? "🎯 Goal complete" : "🎯 目标已完成";
	if (goal.status === "paused")
		return goal.language === "en" ? "🎯 Goal paused" : "🎯 目标已暂停";
	if (goal.status === "budget_limited")
		return goal.language === "en"
			? `🎯 Goal budget ${formatBudget(goal)}`
			: `🎯 目标预算 ${formatBudget(goal)}`;
	const prefix = `${goalStatusPrefix(ctx, goal)} · ${elapsedLabel(elapsedSeconds(goal.stepStartedAt), elapsedSeconds(topStartedAt(ctx, goal)), shouldShowGoalTotalElapsed(ctx, goal), goal.language)}`;
	return goal.tokenBudget === undefined
		? prefix
		: `${prefix} ${formatBudget(goal)}`;
}

function goalStatusPrefix(ctx: StatusContext, goal: ActiveGoal) {
	const flow = flowContext(ctx);
	const phase = goalStatusPhase(goal);
	const scope = goal.language === "en" ? "🎯 goal" : GOAL_SCOPE;
	return flow ? `${flowScope(flow.label)}/${phase}` : `${scope}/${phase}`;
}

function goalReviewStatusPrefix(
	ctx: StatusContext,
	goal: ActiveGoal,
	round: number,
) {
	const flow = flowContext(ctx);
	const title = roundTitle(
		round,
		goal.language === "en" ? "completion acceptance" : "完成验收",
		goal.language,
	);
	return flow ? `${flowScope(flow.label)}/${title}` : `🎯 goal/${title}`;
}

function activeGoalActivity(
	ctx: StatusContext,
	goal: ActiveGoal,
	phase: GoalUiPhase,
) {
	const flow = flowContext(ctx);
	const label = goalActivityPhaseLabel(phase, goal.language);
	return flow
		? {
				language: goal.language,
				title: `🌊 Flow · ${label}`,
				rows: flowActivityRows(flow, goal),
			}
		: {
				language: goal.language,
				title: `${goal.language === "en" ? "🎯 Goal" : "🎯 目标"} · ${label}`,
				rows: activityRows(goal.text),
			};
}

function qualityRepairActivity(
	ctx: StatusContext,
	goal: ActiveGoal,
	phase: Extract<GoalUiPhase, { kind: "qualityRepair" }>,
) {
	return {
		language: goal.language,
		title: `${flowContext(ctx) ? "💯 Flow" : goal.language === "en" ? "💯 Goal" : "💯 目标"} · ${goalActivityPhaseLabel(phase, goal.language)}`,
		rows: activityRows(
			goalReviewActivityRows(ctx, goal),
			goal.language === "en"
				? `Repairing ${roundLabel(phase.round, goal.language)} quality feedback`
				: `正在修复${roundLabel(phase.round, goal.language)}质量反馈`,
		),
	};
}

function pausedGoalActivity(ctx: StatusContext, goal: ActiveGoal) {
	const flow = flowContext(ctx);
	const phase =
		goal.status === "budget_limited"
			? goal.language === "en"
				? "budget limited"
				: "预算受限"
			: goal.language === "en"
				? "paused"
				: "已暂停";
	const resume = goalResumeCommand(ctx);
	const next = flow
		? goal.language === "en"
			? `Next: ${resume}`
			: `下一步：${resume}`
		: goal.language === "en"
			? `Next: ${resume} · ${goalClearCommand(ctx)}`
			: `下一步：${resume} · ${goalClearCommand(ctx)}`;
	const controls =
		goal.status === "budget_limited"
			? [
					goal.language === "en"
						? `Budget: ${formatBudget(goal)}`
						: `预算：${formatBudget(goal)}`,
					next,
				]
			: next;
	return {
		language: goal.language,
		title: flow
			? `🌊 Flow · ${phase}`
			: `${goal.language === "en" ? "🎯 Goal" : "🎯 目标"} · ${phase}`,
		rows: activityRows(
			flow ? flowActivityRows(flow, goal) : goal.text,
			controls,
		),
	};
}

function flowActivityRows(
	flow: NonNullable<ReturnType<typeof flowContext>>,
	goal: ActiveGoal,
) {
	return activityRows(
		flow.displayLabel,
		goal.text,
		goal.language === "en"
			? `Progress: ${flow.plan.index + 1}/${flow.flow.goals.length}`
			: `进度：${flow.plan.index + 1}/${flow.flow.goals.length}`,
	);
}

type GoalUiPhase =
	| { kind: "execution" }
	| { kind: "acceptanceRepair"; round: number }
	| { kind: "qualityRepair"; round: number }
	| { kind: "waitingQuality" };

function goalUiPhase(goal: ActiveGoal): GoalUiPhase {
	const lastAcceptance = goal.stateReviewHistory.at(-1);
	if (lastAcceptance?.result === "failed")
		return { kind: "acceptanceRepair", round: lastAcceptance.round };
	const lastQuality = goal.qualityReviewHistory.at(-1);
	if (lastQuality?.result === "failed")
		return { kind: "qualityRepair", round: lastQuality.round };
	if (lastAcceptance?.result === "passed") return { kind: "waitingQuality" };
	return { kind: "execution" };
}

function goalActivityPhaseLabel(phase: GoalUiPhase, language: Language) {
	if (phase.kind === "acceptanceRepair")
		return roundTitle(
			phase.round,
			language === "en" ? "acceptance repair" : "验收补完中",
			language,
		);
	if (phase.kind === "qualityRepair")
		return roundTitle(
			phase.round,
			language === "en" ? "quality fix" : "质量修复中",
			language,
		);
	if (phase.kind === "waitingQuality")
		return language === "en" ? "waiting for quality check" : "等待质量检查";
	return language === "en" ? "running" : "执行中";
}

function goalStatusPhase(goal: ActiveGoal) {
	const phase = goalUiPhase(goal);
	if (phase.kind === "waitingQuality")
		return goal.language === "en"
			? "waiting for quality check"
			: "等待质量检查收口";
	if (phase.kind === "execution")
		return goal.language === "en" ? "running" : "目标进行中";
	return goalActivityPhaseLabel(phase, goal.language);
}

function goalActivityObject(ctx: StatusContext, language: Language) {
	return flowContext(ctx)
		? "🌊 Flow"
		: language === "en"
			? "🎯 Goal"
			: "🎯 目标";
}

function flowContext(ctx: StatusContext) {
	let owner: ReturnType<typeof flowOwnerForSession>;
	try {
		owner = flowOwnerForSession(ctx);
	} catch {
		return undefined;
	}
	if (!owner) return undefined;
	const goal = currentGoal(owner.flow);
	if (!goal) return undefined;
	return {
		dir: owner.dir,
		label: flowStepLabel(goal.index, goal.title, owner.flow.language),
		displayLabel: flowGoalDisplayLabel(
			goal.index,
			goal.title,
			owner.flow.goals.length,
			owner.flow.language,
		),
		startedAt: requireFlowStartedAt(owner.flow),
		flow: owner.flow,
		plan: goal,
	};
}

function goalPlanEvidence(
	ctx: StatusContext,
	goal: ActiveGoal,
): PlanEvidence | undefined {
	if (goal.artifactDir)
		return readPlanEvidence(
			join(goal.artifactDir, "plan.md"),
			`${goal.artifactDir}/plan.md`,
		);
	const flow = flowContext(ctx);
	if (!flow) return undefined;
	const text =
		readPlanText(join(flow.dir, flow.plan.file)) ?? flow.plan.snapshot ?? "";
	if (!text.trim()) return undefined;
	return {
		path: `.flow/${flow.flow.id}/${flow.plan.file}`,
		text,
	};
}

function readPlanEvidence(
	path: string,
	label: string,
): PlanEvidence | undefined {
	const text = readPlanText(path);
	return text?.trim() ? { path: label, text } : undefined;
}

function readPlanText(path: string) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

function topStartedAt(ctx: StatusContext, goal: ActiveGoal) {
	return flowContext(ctx)?.startedAt ?? goal.startedAt;
}

function shouldShowTotalElapsed(ctx: StatusContext, round: number) {
	return Boolean(flowContext(ctx)) || round > 1;
}

function shouldShowGoalTotalElapsed(ctx: StatusContext, goal: ActiveGoal) {
	return Boolean(flowContext(ctx)) || goal.stateReviewRounds > 0;
}

function formatBudget(goal: ActiveGoal) {
	return `${formatTokenCount(goal.tokensUsed)}/${formatTokenCount(goal.tokenBudget ?? 0)}`;
}

function formatTokenCount(value: number) {
	if (value < 1_000) return `${value}`;
	if (value < 1_000_000)
		return `${Number.isInteger(value / 1_000) ? value / 1_000 : (value / 1_000).toFixed(1)}k`;
	return `${Number.isInteger(value / 1_000_000) ? value / 1_000_000 : (value / 1_000_000).toFixed(1)}m`;
}

function hasPendingMessages(ctx: StatusContext) {
	return ctx.hasPendingMessages?.() ?? false;
}

function clearContinuationTracking(state: GoalRuntimeState) {
	state.continuationPending = undefined;
	cancelCompletionAudit(state);
	cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
	state.cancelledContinuationMarkers.clear();
	state.websocketLimitRecoveryAt.clear();
}

function cancelGoalRecoveryTimers(
	state: GoalRuntimeState,
	options: { resetAutoResumeUse?: boolean } = {},
) {
	cancelRetryExhaustionWatch(state);
	cancelDeferredAutoResume(state);
	if (options.resetAutoResumeUse) state.retryAutoResumeUsedGoalIds.clear();
}

function cancelRetryExhaustionWatch(state: GoalRuntimeState) {
	const watch = state.retryExhaustionWatch;
	if (!watch) return;
	clearTimeout(watch.timer);
	state.retryExhaustionWatch = undefined;
	nextRetryRecoveryGeneration(state);
}

function cancelDeferredAutoResume(state: GoalRuntimeState) {
	const deferred = state.deferredAutoResume;
	if (!deferred) return;
	clearTimeout(deferred.timer);
	state.deferredAutoResume = undefined;
	nextRetryRecoveryGeneration(state);
}

function nextRetryRecoveryGeneration(state: GoalRuntimeState) {
	state.retryRecoveryGeneration += 1;
	return state.retryRecoveryGeneration;
}

function cancelCompletionAudit(state: GoalRuntimeState) {
	cancelCompletionAuditState(state);
}

function trackCompletionAuditStatus(
	state: GoalRuntimeState,
	goalId: string,
	generation: number,
	status: ElapsedStatus,
) {
	trackCompletionAuditStatusState(state, goalId, generation, status);
}

function clearCompletionAuditStatus(
	state: GoalRuntimeState,
	ctx: StatusContext,
	goalId: string,
	generation: number,
	status: ElapsedStatus,
) {
	clearCompletionAuditStatusState(state, ctx, goalId, generation, status);
}

function isCurrentCompletionAudit(
	state: GoalRuntimeState,
	goalId: string,
	generation: number,
) {
	return isCurrentCompletionAuditState(state, goalId, generation);
}

function cancelContinuationPending(state: GoalRuntimeState) {
	if (state.continuationPending)
		rememberCancelledContinuationMarker(
			state,
			state.continuationPending.marker,
		);
	state.continuationPending = undefined;
}

function rememberCancelledContinuationMarker(
	state: GoalRuntimeState,
	marker: string,
) {
	state.cancelledContinuationMarkers.add(marker);
	if (
		state.cancelledContinuationMarkers.size <=
		MAX_CANCELLED_CONTINUATION_PROMPTS
	)
		return;
	const oldest = state.cancelledContinuationMarkers.values().next().value;
	if (oldest) state.cancelledContinuationMarkers.delete(oldest);
}

function consumeCancelledContinuationPrompt(
	state: GoalRuntimeState,
	prompt: string,
) {
	const marker = extractContinuationMarker(prompt);
	return marker ? state.cancelledContinuationMarkers.delete(marker) : false;
}

function markContinuationDelivered(state: GoalRuntimeState, prompt: string) {
	const marker = extractContinuationMarker(prompt);
	if (marker && state.continuationPending?.marker === marker)
		state.continuationPending = undefined;
}

function continuationMarker(goal: ActiveGoal) {
	return `${goal.id}:${goal.iteration}`;
}

const CONTINUATION_MARKER_PATTERN = new RegExp(
	`<!--\\s*${escapeRegExp(CONTINUATION_MARKER_PREFIX)}([^\\s>]+)\\s*-->`,
);

function extractContinuationMarker(prompt: string) {
	return CONTINUATION_MARKER_PATTERN.exec(prompt)?.[1];
}

function agentEndEventKey(event: unknown) {
	return typeof event === "object" && event !== null ? event : undefined;
}

function findFinalAssistantMessage(
	messages: unknown[],
): AssistantMessageLike | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const parsed = parseAssistantMessage(messages[index]);
		if (parsed) return parsed;
	}
	return undefined;
}

function latestAssistantFromSession(
	ctx: StatusContext,
): AssistantMessageLike | undefined {
	const sessionManager = ctx.sessionManager as
		| { getBranch?: () => unknown[]; getEntries?: () => unknown[] }
		| undefined;
	const entries =
		sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry || typeof entry !== "object") continue;
		const message = (entry as { message?: unknown }).message;
		const parsed = parseAssistantMessage(message);
		if (parsed) return parsed;
	}
	return undefined;
}

function parseAssistantMessage(
	message: unknown,
): AssistantMessageLike | undefined {
	if (!message || typeof message !== "object") return undefined;
	const candidate = message as Record<string, unknown>;
	if (candidate.role !== "assistant") return undefined;
	const errorMessage = assistantErrorMessage(candidate);
	return {
		role: "assistant",
		stopReason: isAgentStopReason(candidate.stopReason)
			? candidate.stopReason
			: undefined,
		errorMessage,
	};
}

function assistantErrorMessage(candidate: Record<string, unknown>) {
	const parts = [
		typeof candidate.errorMessage === "string" ? candidate.errorMessage : "",
		diagnosticErrorText(candidate.diagnostics),
	].filter(Boolean);
	return parts.length ? parts.join("\n") : undefined;
}

function diagnosticErrorText(diagnostics: unknown) {
	if (diagnostics === undefined) return "";
	try {
		return JSON.stringify(diagnostics);
	} catch {
		return String(diagnostics);
	}
}

function isAgentStopReason(value: unknown): value is AgentStopReason {
	return ["stop", "length", "toolUse", "error", "aborted"].includes(
		String(value),
	);
}

function notifyError(error: unknown) {
	return truncateNotification(formatError(error));
}

function truncateNotification(value: string) {
	return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function currentTokenTotal(ctx: StatusContext): number {
	const sessionManager = ctx.sessionManager as
		| {
				getBranch?: () => Array<{
					type?: string;
					message?: { role?: string; usage?: unknown };
				}>;
		  }
		| undefined;
	const branch = sessionManager?.getBranch?.() ?? [];
	let total = 0;
	for (const entry of branch) {
		if (entry.type !== "message" || entry.message?.role !== "assistant")
			continue;
		const usage = entry.message.usage as
			| { input?: number; output?: number }
			| undefined;
		total += usage?.input ?? 0;
		total += usage?.output ?? 0;
	}
	return total;
}

function persistGoal(goal: ActiveGoal, ctx?: StatusContext) {
	persistGoalEntry(goal, ctx, goalRuntimeState.extensionApi);
}

function clearPersistedGoal(cwd: string, ctx?: StatusContext) {
	clearPersistedGoalEntry(cwd, ctx, goalRuntimeState.extensionApi);
}

function loadGoalFromSession(ctx: StatusContext): ActiveGoal | undefined {
	const sessionManager = ctx.sessionManager as
		| {
				getBranch?: () => Array<{
					type?: string;
					customType?: string;
					data?: unknown;
				}>;
				getEntries?: () => Array<{
					type?: string;
					customType?: string;
					data?: unknown;
				}>;
		  }
		| undefined;
	const entries =
		sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
	const entry = entries
		.filter(
			(entry) =>
				entry.type === "custom" && entry.customType === GOAL_STATE_ENTRY_TYPE,
		)
		.pop();
	const data = entry?.data as GoalStateEntryData | undefined;
	return sanitizeLoadedGoal(ctx, normalizeLoadedGoal(data?.goal));
}

function sanitizeLoadedGoal(
	ctx: StatusContext,
	goal: ActiveGoal | undefined,
): ActiveGoal | undefined {
	if (!goal || !isLegacyFlowPromptText(goal.text)) return goal;
	const flow = flowContext(ctx);
	if (!flow) return goal;
	const text = objectiveFromPlan(flow.plan.snapshot ?? "") || flow.plan.title;
	return { ...goal, text };
}

function isLegacyFlowPromptText(text: string) {
	return (
		text.includes("Flow Goal session 已启动") ||
		text.includes("当前 Goal plan 完整 snapshot")
	);
}

function normalizeLoadedGoal(value: unknown): ActiveGoal | undefined {
	if (!isGoal(value) || value.status === "complete") return undefined;
	return {
		...value,
		language: value.language ?? runtimeLanguage(),
		stateReviewRounds: value.stateReviewRounds ?? 0,
		stateReviewHistory: value.stateReviewHistory ?? [],
		qualityReviewHistory: value.qualityReviewHistory ?? [],
		stateReviewStartedAt: value.stateReviewStartedAt,
		stepStartedAt: value.stepStartedAt ?? Date.now(),
	};
}

function clearActiveGoal(ctx: StatusContext) {
	const state = goalStateForSession(ctx);
	setFlowActivity("goal", false);
	setGoalActivityBox(ctx, undefined);
	closeGoalPlanWatcher();
	cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
	cancelContinuationPending(state);
	cancelCompletionAudit(state);
	state.activeGoal = undefined;
	clearPersistedGoal(ctx.cwd, ctx);
	stopGoalStatusTimer(state);
	clearCompletionStatusTimer(state);
	clearStatus(ctx, STATUS_KEY);
}

function showCompletionStatus(ctx: StatusContext) {
	const state = goalStateForSession(ctx);
	clearCompletionStatusTimer(state);
	const language = state.activeGoal?.language ?? runtimeLanguage();
	const text = language === "en" ? "🎯 Goal complete" : "🎯 目标已完成";
	if (!setStatusSafe(ctx, STATUS_KEY, text, language)) return;
	state.completionStatusTimer = setTimeout(
		() => clearStatus(ctx, STATUS_KEY),
		8_000,
	);
}

function clearCompletionStatusTimer(state: GoalRuntimeState) {
	if (!state.completionStatusTimer) return;
	clearTimeout(state.completionStatusTimer);
	state.completionStatusTimer = undefined;
}

function syncGoalStatusTimer(
	ctx: StatusContext,
	state: GoalRuntimeState,
	goal: ActiveGoal | undefined,
) {
	if (goal?.status !== "active") {
		stopGoalStatusTimer(state);
		return;
	}
	if (state.goalStatusTimer) return;
	state.goalStatusTimer = startElapsedStatus(
		ctx,
		STATUS_KEY,
		() => {
			if (state.activeGoal) updateGoalElapsed(state.activeGoal);
			return formatStatus(ctx, state.activeGoal) ?? "";
		},
		{
			isActive: () => state.activeGoal?.status === "active",
			language: goal.language,
		},
	);
}

function stopGoalStatusTimer(state: GoalRuntimeState) {
	if (!state.goalStatusTimer) return;
	state.goalStatusTimer.stop();
	state.goalStatusTimer = undefined;
}

function isGoal(value: unknown): value is ActiveGoal {
	if (!value || typeof value !== "object") return false;
	const goal = value as Partial<ActiveGoal>;
	return (
		typeof goal.id === "string" &&
		typeof goal.text === "string" &&
		["active", "paused", "budget_limited", "complete"].includes(
			String(goal.status),
		) &&
		typeof goal.startedAt === "number" &&
		typeof goal.updatedAt === "number" &&
		typeof goal.iteration === "number" &&
		typeof goal.tokensUsed === "number" &&
		typeof goal.timeUsedSeconds === "number" &&
		typeof goal.baselineTokens === "number"
	);
}
