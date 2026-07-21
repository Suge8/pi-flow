import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { auditGoalCompletion, type GoalAuditResult } from "../auditor.js";
import { recordFlowGoalCompletionBoundary } from "../flow/completion.js";
import { isPrivateWorkerProcess } from "../flow/execution/worker-protocol.js";
import { emitFlowGoalBlocked } from "../flow/goal-events.js";
import {
	flowLockBusyMessage,
	watchFlowLockRelease,
	withFlowLockSync,
} from "../flow/lock.js";
import { currentSessionFile, flowOwnerForSession } from "../flow/ownership.js";
import { quoteCommand } from "../flow/parallel/console.js";
import { rememberFlowContext } from "../flow/runtime.js";
import {
	currentGoal,
	readFlow,
	tryReadFlow,
	writeFlow,
} from "../flow/store.js";
import type {
	CheckboxAttribution,
	FlowAttention,
	PendingAdvisor,
} from "../flow/types.js";
import { flowCommandId, requireFlowStartedAt } from "../flow/util.js";
import {
	type PlanCheckboxState,
	planCheckboxStates,
} from "../plan/markdown.js";
import type { ReviewRoundFailedDirective } from "../review/types.js";
import {
	isGoalScopedReviewActive,
	isReviewLoopActive,
	type ReviewLoopStats,
	type ReviewStop,
	runConfiguredReview,
	scheduleContinueReviewAfterAgentEnd,
	stopGoalScopedReview,
	waitForScheduledReviewAgentEnd,
} from "../review.js";
import {
	agentEndedWithRecoverableTransportStop,
	isPiRetryableAgentError,
} from "../review-agent-event.js";
import {
	type ActivityWidgetMessage,
	activityRows,
	clearFlowActivities,
	currentCancelHint,
	installFlowActivityFrame,
	isFlowEditorInputHidden,
	setFlowActivity,
	setFlowCancelHandler,
	setFlowEditorInputHidden,
	setGoalActivityBox,
	setReviewActivityBox,
} from "../shared/activity-frame.js";
import {
	requestPiAttention,
	setPiActivity,
} from "../shared/activity-signal.js";
import { advisorCardAdvice, sendAdvisorCard } from "../shared/advisor-card.js";
import type { AgentProgress } from "../shared/agent-progress.js";
import {
	acceptanceFeedbackInstruction,
	advisorConsultingLine,
	advisorDirectionLines,
	blockedOnUserRequest,
} from "../shared/check-feedback.js";
import { clipText } from "../shared/clip.js";
import {
	advisorConsultModel,
	type Language,
	type ReviewerConfig,
	readFlowConfig,
} from "../shared/config.js";
import { escapeRegExp, formatError, isRecord } from "../shared/guards.js";
import {
	ADVISOR_DIRECTION_PROMPT_TYPE,
	sendOrchestrationPrompt,
} from "../shared/internal-prompt.js";
import { runtimeLanguage } from "../shared/language.js";
import {
	currentSessionModel,
	switchToRoleModel,
} from "../shared/model-roles.js";
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
	checkResultDeliveryId,
	composeResultCardLines,
	registerResultCardRenderer,
	resultCardDelivered,
	resultCardElapsedLine,
	sendResultCard,
} from "../shared/result-card.js";
import { formatReviewResultLines } from "../shared/review-format.js";
import type { ReviewHistoryEntry } from "../shared/review-history.js";
import {
	type ReviewerProgress,
	reviewerActivityLine,
	reviewerProgressLines,
	shortModel,
} from "../shared/reviewer-pool.js";
import { registerRuntimePart } from "../shared/runtime-registration.js";
import { finalAssistantText, sessionLeafId } from "../shared/session.js";
import {
	clearStatus,
	type ElapsedStatus,
	elapsedSeconds,
	formatDuration,
	setStatusSafe,
	startElapsedStatus,
} from "../shared/status.js";
import {
	formatUserNotice,
	monitorDetailsHint,
	notifyUser,
	setStatusText,
} from "../shared/ui-language.js";
import {
	type AdvisorConsultResult,
	type AdvisorFailureRound,
	advisorUnavailableNotice,
	consultAdvisor,
	isAdvisorEnabled,
} from "./advisor.js";
import {
	hardCapStopReason,
	MAX_CONSECUTIVE_CHECK_FAILURES,
	planChangeNote,
	planCheckboxSignature,
	planRevisionDiff,
	REVISION_PERMISSION_AFTER_FAILURES,
	revisionPermissionClause,
	shouldConsultAdvisor,
	todoClosureReminder,
	todoUpdateReminder,
	trailingFailures,
	unfinishedCheckboxItems,
} from "./check-discipline.js";
import {
	appendCustomEntry,
	clearPersistedGoal as clearPersistedGoalEntry,
	GOAL_STATE_ENTRY_TYPE,
	type GoalStateEntryData,
	persistGoal as persistGoalEntry,
	readGoalRuntimeState,
	saveActiveGoal as saveActiveGoalEntry,
	syncStandaloneGoalArtifact as syncStandaloneGoalArtifactEntry,
	writeGoalRuntimeState,
} from "./persistence.js";
import {
	buildContinuePrompt,
	buildGoalSystemPrompt,
	buildResumePrompt,
	type GoalTodoPromptContext,
	manualAdvisorDirection,
} from "./prompts.js";
import {
	type CheckboxAttributionChange,
	cancelCompletionAudit as cancelCompletionAuditState,
	clearCompletionAuditStatus as clearCompletionAuditStatusState,
	type FlowCheckboxAttributionCommit,
	type FlowCheckboxAttributionTarget,
	finalizeGoalCompletion,
	type GoalReviewSurfaceSyncResult,
	isCurrentCompletionAudit as isCurrentCompletionAuditState,
	publishFlowReportProjection,
	recordGoalQualityReview,
	recordGoalReview,
	setFlowAttention,
	startCompletionAudit as startCompletionAuditState,
	syncGoalCheckboxAttribution,
	syncGoalReviewSurfaces,
	trackCompletionAuditStatus as trackCompletionAuditStatusState,
	yieldForGoalReviewCard,
} from "./review-orchestration.js";
import type {
	ActiveCheckRun,
	CheckRoundAdvisor,
	CompletionCursor,
	GoalChecks,
} from "./types.js";

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
	consecutiveCheckFailures: number;
	stateReviewHistory: ReviewHistoryEntry[];
	qualityReviewHistory: ReviewHistoryEntry[];
	stateReviewStartedAt?: number;
	tokenBudget?: number;
	tokensUsed: number;
	timeUsedSeconds: number;
	baselineTokens: number;
	stepStartedAt: number;
	artifactId?: string;
	artifactPlanPath?: string;
	artifactPlanDisplayPath?: string;
	artifactStatePath?: string;
	artifactStateDisplayPath?: string;
	/** 勾级归因：哪个模型在何时把计划 checkbox 写成完成。 */
	checkAttribution?: Record<string, CheckboxAttribution>;
	/** 证据锚点：goal 创建时的会话 leaf entry；验收/质检/顾问证据只取锚点之后（fork 会话不吃计划期前缀）。 */
	sessionAnchorId?: string;
}

interface GoalReviewLive {
	phase: "acceptance" | "quality";
	active: ActiveCheckRun | null;
	rounds?: ReviewHistoryEntry[];
	consulting?: boolean;
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

export type ManualAdvisorResult =
	| {
			kind: "advice";
			advice: CheckRoundAdvisor;
			flowId: string;
			language: Language;
	  }
	| { kind: "pending"; flowId: string; language: Language }
	| { kind: "already_advised"; flowId: string; language: Language }
	| { kind: "parallel"; language: Language }
	| { kind: "disabled"; language: Language }
	| { kind: "no_flow"; language: Language }
	| { kind: "no_failure"; language: Language }
	| { kind: "busy"; language: Language }
	| { kind: "aborted"; language: Language }
	| { kind: "unavailable"; reason: string; language: Language };

interface FlowGoalResumeOptions {
	onGoalIdChanged?: (goalId: string) => boolean;
}

interface FlowGoalStartOptions {
	artifact?: {
		artifactId: string;
		artifactPlanPath: string;
		artifactPlanDisplayPath: string;
		artifactStatePath: string;
		artifactStateDisplayPath: string;
	};
	rememberFlowContext?: boolean;
	sendPrompt?: boolean;
	/** runtime 已持久化、执行 prompt 尚未投递时同步 canonical owner。 */
	onGoalCreated?: (goalId: string) => void;
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
const GOAL_AUDIT_ACTIVITY_PREFIX = "pi-flow:audit";
const GOAL_ATTENTION_PREFIX = "pi-flow:goal";
const MAX_CANCELLED_CONTINUATION_PROMPTS = 20;
const PI_RETRY_EXHAUSTION_GUARD_MS = 20_000;
const AUTO_RESUME_AFTER_RETRY_EXHAUSTION_MS = 5 * 60 * 1000;
const WEBSOCKET_LIMIT_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;
const RESPONSES_WEBSOCKET_LIMIT_CODE = "websocket_connection_limit_reached";
const CONTINUATION_MARKER_PREFIX = "pi-goal-continuation:";
const BLOCKED_PAUSE_OUTBOX_ENTRY_TYPE = "blocked-pause-outbox";
const CHECKBOX_ATTRIBUTION_OUTBOX_ENTRY_TYPE = "checkbox-attribution-outbox";
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

interface PendingCheckboxEdit {
	goalId: string;
	planPath: string;
	beforeText: string;
	attributionTarget?: FlowCheckboxAttributionTarget;
}

interface PendingCheckboxAttribution extends FlowCheckboxAttributionCommit {
	lockNoticeSent: boolean;
}

interface CheckboxAttributionOutboxEntry {
	pending: PendingCheckboxAttribution[];
}

interface PendingBlockedPause {
	goalId: string;
	reason: string;
}

interface BlockedPauseOutboxEntry {
	pending: PendingBlockedPause | null;
}

export interface GoalRuntimeState {
	activeGoal?: ActiveGoal;
	turnFileWrites: boolean;
	planCheckboxBaseline?: string;
	checkboxEditCalls: Map<string, PendingCheckboxEdit>;
	pendingCheckboxAttributions: PendingCheckboxAttribution[];
	checkboxAttributionLockWatchers: Map<string, () => void>;
	pendingBlockedPause?: PendingBlockedPause;
	blockedPauseLockWatcher?: () => void;
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
	pendingCheckResumeGoalId?: string;
	retryRecoveryGeneration: number;
	retryAutoResumeUsedGoalIds: Set<string>;
	todoGate?: { goalId: string; round: number };
	todoGateAttentionGoalId?: string;
}

interface GoalRuntimeGlobalState {
	extensionApi?: ExtensionAPI;
	sessions: Map<string, GoalRuntimeState>;
}

export const goalRuntimeState: GoalRuntimeGlobalState = {
	sessions: new Map<string, GoalRuntimeState>(),
};

function setGoalAuditActivity(goalId: string, active: boolean) {
	setPiActivity(`${GOAL_AUDIT_ACTIVITY_PREFIX}:${goalId}`, active);
}

function requestGoalAttention(goalId: string) {
	requestPiAttention(`${GOAL_ATTENTION_PREFIX}:${goalId}`);
}

function createGoalSessionState(): GoalRuntimeState {
	return {
		turnFileWrites: false,
		checkboxEditCalls: new Map(),
		pendingCheckboxAttributions: [],
		checkboxAttributionLockWatchers: new Map(),
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
	closeCheckboxAttributionLockWatchers(state);
	state.blockedPauseLockWatcher?.();
	state.goalStatusTimer?.stop();
	state.completionAuditPending?.controller.abort();
	state.completionAuditPending?.status?.stop();
	if (state.retryExhaustionWatch)
		clearTimeout(state.retryExhaustionWatch.timer);
	if (state.deferredAutoResume) clearTimeout(state.deferredAutoResume.timer);
	state.activeGoal = undefined;
	state.turnFileWrites = false;
	state.planCheckboxBaseline = undefined;
	state.checkboxEditCalls = new Map();
	state.pendingCheckboxAttributions = [];
	state.checkboxAttributionLockWatchers = new Map();
	state.pendingBlockedPause = undefined;
	state.blockedPauseLockWatcher = undefined;
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
	state.pendingCheckResumeGoalId = undefined;
	state.retryRecoveryGeneration = 0;
	state.retryAutoResumeUsedGoalIds = new Set<string>();
	state.todoGate = undefined;
	state.todoGateAttentionGoalId = undefined;
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
	if (state.activeGoal)
		state.activeGoal = reconcileGoalChecks(ctx, state.activeGoal);
	return state.activeGoal;
}

function reconcileGoalChecks(
	ctx: StatusContext,
	goal: ActiveGoal,
	reconcilePausedStatus = false,
): ActiveGoal {
	const canonical = canonicalGoalRuntime(ctx, goal);
	if (!canonical) return goal;
	const acceptanceHistory = reviewHistory(canonical.checks.acceptance.rounds);
	const qualityHistory = reviewHistory(canonical.checks.quality.rounds);
	const acceptanceRounds = [
		...acceptanceHistory.map((entry) => entry.round),
		...(canonical.checks.acceptance.active
			? [canonical.checks.acceptance.active.round]
			: []),
	];
	const currentHistory =
		qualityHistory.length > 0 || canonical.checks.quality.active
			? qualityHistory
			: acceptanceHistory;
	return {
		...goal,
		status:
			reconcilePausedStatus && canonical.paused && goal.status === "active"
				? "paused"
				: goal.status,
		stateReviewRounds: Math.max(0, ...acceptanceRounds),
		stateReviewHistory: acceptanceHistory,
		qualityReviewHistory: qualityHistory,
		consecutiveCheckFailures: trailingFailures(currentHistory),
	};
}

function reviewHistory(
	rounds: GoalChecks["acceptance"]["rounds"],
): ReviewHistoryEntry[] {
	return rounds.map((round) => {
		const models = round.models?.flatMap((model) =>
			model.status === "running"
				? []
				: [
						{
							label: model.label,
							status: model.status,
							...(model.summary ? { summary: model.summary } : {}),
							...(model.thinking ? { thinking: model.thinking } : {}),
						},
					],
		);
		return {
			round: round.round,
			result: round.result,
			summary: round.summary,
			...(round.details ? { details: round.details } : {}),
			...(models ? { models } : {}),
			...(round.advisor ? { advisor: round.advisor } : {}),
			...(round.elapsedMs !== undefined ? { elapsedMs: round.elapsedMs } : {}),
		};
	});
}

function canonicalGoalRuntime(
	ctx: StatusContext,
	goal: ActiveGoal,
): { checks: GoalChecks; paused: boolean } | undefined {
	try {
		if (goal.artifactStatePath) {
			const state = readGoalRuntimeState(goal);
			return { checks: state.checks, paused: state.status === "paused" };
		}
		const flow = flowContext(ctx);
		return flow
			? { checks: flow.plan.checks, paused: flow.flow.status === "paused" }
			: undefined;
	} catch {
		return undefined;
	}
}

export default function goal(pi: ExtensionAPI) {
	registerGoalRuntime(pi);
	pi.on("session_start", (_event, ctx) => handleGoalSessionStart(ctx));
}

export function registerGoalRuntime(pi: ExtensionAPI) {
	registerRuntimePart(pi, "goal:initialize", () => resetGoalRuntimeState(pi));
	registerResultCardRenderer(pi);

	registerRuntimePart(pi, "goal:session_shutdown", () => {
		pi.on("session_shutdown", (_event, ctx) => {
			const sessionKey = goalSessionKey(ctx);
			const state = goalStateForSession(ctx);
			flushPendingCheckboxAttribution(state, ctx);
			closeCheckboxAttributionLockWatchers(state);
			state.blockedPauseLockWatcher?.();
			state.blockedPauseLockWatcher = undefined;
			cancelGoalRecoveryTimers(state);
			if (state.activeGoal) setGoalAuditActivity(state.activeGoal.id, false);
			if (state.activeGoal) persistGoal(state.activeGoal, ctx);
			clearContinuationTracking(state);
			stopGoalStatusTimer(state);
			clearCompletionStatusTimer(state);
			setGoalActivityBox(ctx, undefined);
			ctx.ui.setStatus(STATUS_KEY, undefined);
			clearFlowActivities();
			resetGoalSessionState(state);
			if (goalRuntimeState.sessions.get(sessionKey) === state)
				goalRuntimeState.sessions.delete(sessionKey);
		});
	});

	registerRuntimePart(pi, "goal:input", () => {
		pi.on("input", (event, ctx) => {
			const state = goalStateForSession(ctx);
			if (event.source !== "extension") {
				cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
				return;
			}
			if (consumeCancelledContinuationPrompt(state, event.text))
				return { action: "handled" as const };
		});
	});

	registerRuntimePart(pi, "goal:before_agent_start", () => {
		pi.on("before_agent_start", (event, ctx) => {
			const state = goalStateForSession(ctx);
			cancelGoalRecoveryTimers(state);
			markContinuationDelivered(state, event.prompt);
			if (!state.activeGoal || state.activeGoal.status !== "active") return;
			if (state.pendingBlockedPause?.goalId === state.activeGoal.id) {
				showPendingBlockedPause(
					ctx,
					state.activeGoal,
					state.pendingBlockedPause.reason,
				);
				ctx.abort();
				return;
			}
			state.activeGoal = { ...state.activeGoal, stepStartedAt: Date.now() };
			updateStatusBox(ctx, state.activeGoal);
			return {
				systemPrompt: `${event.systemPrompt}\n\n${buildGoalSystemPrompt(state.activeGoal, goalTodoPromptContext(ctx, state.activeGoal))}`,
			};
		});
	});

	registerRuntimePart(pi, "goal:agent_start", () => {
		pi.on("agent_start", (_event, ctx) => {
			const state = goalStateForSession(ctx);
			cancelGoalRecoveryTimers(state);
			const loadedGoal = state.activeGoal ?? loadGoalFromSession(ctx);
			state.activeGoal = loadedGoal
				? reconcileGoalChecks(ctx, loadedGoal)
				: undefined;
			flushPendingCheckboxAttribution(state, ctx);
			if (
				state.activeGoal?.status === "active" &&
				state.pendingBlockedPause?.goalId === state.activeGoal.id
			) {
				showPendingBlockedPause(
					ctx,
					state.activeGoal,
					state.pendingBlockedPause.reason,
				);
				return;
			}
			state.turnFileWrites = false;
			const planText =
				state.activeGoal?.status === "active"
					? (goalPlanEvidence(ctx, state.activeGoal)?.text ?? undefined)
					: undefined;
			state.planCheckboxBaseline = planCheckboxSignature(planText);
			state.checkboxEditCalls.clear();
			if (state.activeGoal?.status === "active")
				updateStatusBox(ctx, state.activeGoal);
		});
	});

	registerRuntimePart(pi, "goal:tool_execution_end", () => {
		pi.on("tool_execution_end", (event, ctx) => {
			if (event.isError) return;
			if (event.toolName !== "write" && event.toolName !== "edit") return;
			const state = goalStateForSession(ctx);
			if (state.activeGoal?.status === "active") state.turnFileWrites = true;
		});
	});

	registerRuntimePart(pi, "goal:tool_call", () => {
		pi.on("tool_call", (event, ctx) => {
			if (event.toolName !== "edit" && event.toolName !== "write") return;
			const state = goalStateForSession(ctx);
			const goal = state.activeGoal;
			if (!goal) return;
			const planPath = activeGoalPlanPath(ctx, goal);
			if (!planPath || !toolResultWritesPath(event.input, ctx, planPath))
				return;
			if (event.toolName === "write")
				return { block: true, reason: precisePlanEditRequired(goal.language) };
			const beforeText = readPlanText(planPath);
			if (beforeText === undefined) return;
			if (applyExactPlanEdit(beforeText, event.input) === undefined)
				return { block: true, reason: precisePlanEditRequired(goal.language) };
			const attributionTarget = flowCheckboxAttributionTarget(ctx, goal);
			state.checkboxEditCalls.set(event.toolCallId, {
				goalId: goal.id,
				planPath,
				beforeText,
				...(attributionTarget ? { attributionTarget } : {}),
			});
		});
	});

	registerRuntimePart(pi, "goal:tool_result", () => {
		pi.on("tool_result", (event, ctx) => {
			const state = goalStateForSession(ctx);
			flushPendingCheckboxAttribution(state, ctx);
			if (event.toolName !== "edit") return;
			const pending = state.checkboxEditCalls.get(event.toolCallId);
			state.checkboxEditCalls.delete(event.toolCallId);
			if (!pending || event.isError) return;
			const goal = state.activeGoal;
			if (
				!goal ||
				goal.id !== pending.goalId ||
				!toolResultWritesPath(event.input, ctx, pending.planPath)
			)
				return;
			const recorded = recordCheckboxAttribution(
				pi,
				ctx,
				state,
				pending.beforeText,
				event.input,
			);
			if (!recorded) return;
			if (pending.attributionTarget) {
				queueCheckboxAttributionSync(state, ctx, {
					...pending.attributionTarget,
					language: recorded.goal.language,
					changes: recorded.changes,
				});
				flushPendingCheckboxAttribution(state, ctx);
				return;
			}
			syncGoalReviewSurfaces(state, ctx, recorded.goal);
		});
	});

	registerRuntimePart(pi, "goal:turn_start", () => {
		pi.on("turn_start", (_event, ctx) => {
			const state = goalStateForSession(ctx);
			flushPendingCheckboxAttribution(state, ctx);
			cancelGoalRecoveryTimers(state);
		});
	});
	registerRuntimePart(pi, "goal:message_start", () => {
		pi.on("message_start", (event, ctx) => {
			if ((event.message as { role?: unknown }).role === "user")
				cancelGoalRecoveryTimers(goalStateForSession(ctx));
		});
	});

	registerRuntimePart(pi, "goal:agent_end", () => {
		pi.on("agent_end", async (event, ctx) => {
			const state = goalStateForSession(ctx);
			const loadedGoal = state.activeGoal ?? loadGoalFromSession(ctx);
			state.activeGoal = loadedGoal
				? reconcileGoalChecks(ctx, loadedGoal)
				: undefined;
			flushPendingCheckboxAttribution(state, ctx);
			if (!state.activeGoal || state.activeGoal.status !== "active") return;
			if (state.pendingBlockedPause?.goalId === state.activeGoal.id) {
				retryPendingBlockedPause(ctx);
				return;
			}
			const eventKey = agentEndEventKey(event);
			if (eventKey && handledGoalAgentEndEvents.has(eventKey)) return;
			if (eventKey) handledGoalAgentEndEvents.add(eventKey);
			if (state.pendingCheckResumeGoalId === state.activeGoal.id) {
				await resumeGoalCheckAfterRestart(ctx, state.activeGoal.id);
				return;
			}
			const goalId = state.activeGoal.id;
			const hadPendingContinuation =
				state.continuationPending?.goalId === goalId;
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
					scheduleRetryExhaustionWatch(
						pi,
						ctx,
						state.activeGoal,
						finalAssistant,
					);
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
					recoverWebSocketLimitError(pi, ctx, state.activeGoal, finalAssistant)
				)
					return;
				sendContinuationPrompt(pi, ctx, state.activeGoal);
				return;
			}
			if (finalAssistant?.stopReason === "stop") {
				const blockedReason = blockedOnUserRequest(
					finalAssistantText(event.messages ?? []),
				);
				if (blockedReason)
					return pauseGoalBlockedOnUser(ctx, state.activeGoal, blockedReason);
				if (ctx.mode === "json" || ctx.mode === "print")
					await continueAfterRepairCursor(ctx, state.activeGoal);
				else scheduleGoalStateReview(ctx, state.activeGoal);
				return;
			}
			if (state.completionAuditPending?.goalId === goalId) return;
			if (stopForBudget(ctx, state.activeGoal)) return;
			saveActiveGoal(ctx);
			if (hadPendingContinuation && !hasPendingMessages(ctx))
				state.continuationPending = undefined;
			if (!hasPendingMessages(ctx))
				sendContinuationPrompt(pi, ctx, state.activeGoal);
		});
	});
}

export function handleGoalSessionStart(ctx: ExtensionContext) {
	const state = goalStateForSession(ctx);
	installFlowActivityFrame(ctx);
	clearContinuationTracking(state);
	const loadedGoal = loadGoalFromSession(ctx);
	state.activeGoal = loadedGoal
		? reconcileGoalChecks(ctx, loadedGoal, true)
		: undefined;
	state.pendingCheckboxAttributions = loadCheckboxAttributionOutbox(ctx);
	state.pendingBlockedPause = loadBlockedPauseOutbox(ctx);
	flushPendingCheckboxAttribution(state, ctx);
	if (state.activeGoal && flowContext(ctx)) rememberFlowContext(ctx);
	if (state.activeGoal) updateStatus(ctx, state.activeGoal);
	else clearGoalUi(ctx);
	syncGoalStatusTimer(ctx, state, state.activeGoal);
	retryPendingBlockedPause(ctx);
	if (!state.pendingBlockedPause) scheduleGoalRestartRecovery(ctx, state);
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
		: formatUserNotice("❌", "验收启动失败", [error]);
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
	const goal = restoreCheckboxAttribution(
		{
			...createGoal(
				trimmed,
				undefined,
				currentTokenTotal(ctx),
				options.artifact,
				language,
			),
			sessionAnchorId: sessionLeafId(ctx),
		},
		ctx,
		options.artifact,
	);
	setActiveGoalForSession(ctx, goal);
	if (goal.artifactStatePath)
		syncStandaloneGoalArtifactEntry(ctx, goal, undefined, {
			preserveChecks: true,
		});
	persistGoal(goal, ctx);
	try {
		options.onGoalCreated?.(goal.id);
	} catch (error) {
		clearActiveGoal(ctx);
		throw error;
	}
	updateStatus(ctx, goal);
	if (options.sendPrompt !== false) {
		const started = sendRuntimePrompt(pi, ctx, prompt, { language });
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
	options: FlowGoalResumeOptions = {},
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
	if (
		state.activeGoal.id !== previousGoal.id &&
		options.onGoalIdChanged &&
		!options.onGoalIdChanged(state.activeGoal.id)
	) {
		state.activeGoal = previousGoal;
		persistGoal(state.activeGoal, ctx);
		updateStatus(ctx, state.activeGoal);
		return "busy";
	}
	updateStatus(ctx, state.activeGoal);
	if (state.activeGoal.status !== "active") return "not_resumable";
	const routed = pendingAdvisorForPrompt(ctx)
		? undefined
		: await continueFromCompletionCursor(ctx, state.activeGoal);
	if (routed) return routed;
	const resumed = sendResumePrompt(pi, ctx, state.activeGoal, {
		allowRepairShortPrompt: true,
	});
	if (!resumed) {
		const rollbackSynced =
			state.activeGoal.id === previousGoal.id ||
			!options.onGoalIdChanged ||
			options.onGoalIdChanged(previousGoal.id);
		state.activeGoal = rollbackSynced
			? previousGoal
			: { ...previousGoal, id: state.activeGoal.id };
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
	if (isCompletionChainBusy(ctx, goal)) return "continued";
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
		recordFlowGoalCompletionBoundary(ctx, {
			reason: "resume",
			expectedGoalId: goal.id,
		});
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

/** 同一目标的验收/质检已在跑时，恢复入口幂等返回，禁止双触发重启检查。 */
function isCompletionChainBusy(ctx: StatusContext, goal: ActiveGoal) {
	const state = goalStateForSession(ctx);
	return (
		state.completionAuditPending?.goalId === goal.id ||
		isGoalScopedReviewActive()
	);
}

async function continueAfterRepairCursor(
	ctx: StatusContext,
	goal: ActiveGoal,
): Promise<FlowGoalContinueResult | undefined> {
	if (isCompletionChainBusy(ctx, goal)) return "continued";
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
		if (gateAcceptanceOnOpenTodos(ctx, goal)) return "continued";
		await startGoalStateReview(ctx as ExtensionContext, goal);
		return "continued";
	}
	return continueFromCompletionCursor(ctx, goal);
}

export async function continueActiveGoalFromCheckpoint(
	ctx: StatusContext,
): Promise<FlowGoalContinueResult> {
	const state = goalStateForSession(ctx);
	const goal = activeGoalForSession(ctx);
	if (!goal) return "no_goal";
	if (goal.status !== "active") return "not_resumable";
	state.pendingCheckResumeGoalId = undefined;
	cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
	return (await continueFromCompletionCursor(ctx, goal)) ?? "not_resumable";
}

export async function continueActiveGoalIfIdle(
	ctx: StatusContext,
): Promise<FlowGoalContinueResult> {
	const state = goalStateForSession(ctx);
	const goal = activeGoalForSession(ctx);
	if (!goal) return "no_goal";
	if (goal.status !== "active") return "not_resumable";
	if (!ctx.isIdle?.() || hasPendingMessages(ctx)) return "busy";
	state.pendingCheckResumeGoalId = undefined;
	cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
	const pi = goalRuntimeState.extensionApi;
	if (!pi) return "busy";
	// 手动顾问 outbox 必须先送修复者，不能被 repair cursor 直接重跑检查绕过。
	if (pendingAdvisorForPrompt(ctx))
		return sendContinuationPrompt(pi, ctx, goal) ? "continued" : "busy";
	const routed = await continueFromCompletionCursor(ctx, goal);
	if (routed) return routed;
	if (latestAssistantFromSession(ctx)?.stopReason === "stop")
		return (await continueAfterRepairCursor(ctx, goal)) ?? "continued";
	return sendContinuationPrompt(pi, ctx, goal) ? "continued" : "busy";
}

export async function pauseGoalFromFlow(ctx: StatusContext) {
	const state = goalStateForSession(ctx);
	const goal = activeGoalForSession(ctx);
	if (!goal || goal.status !== "active") return false;
	cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
	cancelContinuationPending(state);
	cancelCompletionAudit(state);
	await stopGoalScopedReview(goal.id);
	const current = activeGoalForSession(ctx);
	if (!current || current.id !== goal.id) return false;
	if (current.status === "active") {
		state.activeGoal = transitionGoal(current, "paused");
		persistGoal(state.activeGoal, ctx);
		updateStatus(ctx, state.activeGoal);
	}
	return state.activeGoal?.status === "paused";
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
			void continueAfterRepairCursor(ctx, current)
				.catch((error) => {
					notifyUser(
						ctx,
						acceptanceStartFailedNotice(current.language, notifyError(error)),
						"info",
						current.language,
					);
					const message = clipText(
						current.language === "en"
							? `Acceptance start failed: ${notifyError(error)}`
							: `验收启动失败：${notifyError(error)}`,
						200,
					);
					// worker：单写者约束，经自身 artifact 暂停收口并退出，父控制台提交 attention。
					if (current.artifactStatePath) {
						commitGoalPause(ctx, current, {
							kind: "user_action_required",
							message,
						});
						return;
					}
					setFlowAttention(ctx, { kind: "system_error", message });
					requestGoalAttention(current.id);
				})
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
	try {
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
		const activeCheck = readActiveCheckRun(ctx, goal, "acceptance");
		const round = activeCheck?.round ?? goal.stateReviewRounds + 1;
		const reviewGoal: ActiveGoal = {
			...goal,
			stateReviewRounds: Math.max(goal.stateReviewRounds, round),
			stateReviewStartedAt: goal.stateReviewStartedAt ?? now,
			stepStartedAt: now,
		};
		state.activeGoal = reviewGoal;
		setCompletionCursor(ctx, reviewGoal, "acceptance_retry", false);
		persistGoal(reviewGoal, ctx);
		const run = startCompletionAudit(state, reviewGoal);
		const auditRun = await runGoalStateReviewWithStatus(
			reviewGoal,
			round,
			ctx,
			run.generation,
			run.signal,
			activeCheck,
		);
		if (!isCurrentCompletionAudit(state, reviewGoal.id, run.generation)) return;
		if (auditRun.kind === "checkpoint_deferred") {
			state.completionAuditPending = undefined;
			state.goalReviewLive = undefined;
			state.activeGoal = {
				...reviewGoal,
				stateReviewRounds: goal.stateReviewRounds,
				stateReviewStartedAt: goal.stateReviewStartedAt,
			};
			persistGoal(state.activeGoal, ctx);
			updateStatus(ctx, state.activeGoal);
			return;
		}
		if (auditRun.kind === "config_error") {
			state.completionAuditPending = undefined;
			pauseGoalAfterAcceptanceConfigError(
				ctx,
				reviewGoal,
				round,
				auditRun.message,
			);
			return;
		}
		await handleGoalStateReviewResult(
			reviewGoal,
			round,
			auditRun.audit,
			ctx,
			run,
		);
	} finally {
		setGoalAuditActivity(goal.id, false);
	}
}

async function handleGoalStateReviewResult(
	goal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
	ctx: ExtensionContext,
	run: { generation: number; signal: AbortSignal },
) {
	const state = goalStateForSession(ctx);
	const reviewedGoal = recordGoalReview(goal, round, audit);
	if (!audit.complete && !audit.systemError)
		return handleGoalStateReviewFailure(ctx, reviewedGoal, round, audit, run);
	if (audit.systemError) {
		const deliveryId = activeGoalReviewDeliveryId(
			state,
			"acceptance",
			"stopped",
		);
		if (
			!resultCardDelivered(ctx, deliveryId) &&
			!sendGoalReviewErrorCard(ctx, reviewedGoal, round, audit, deliveryId)
				.delivered
		) {
			state.completionAuditPending = undefined;
			updateStatus(ctx, goal);
			return;
		}
	}
	// 验收 PASS 卡先幂等投递、成功后再结算：投递失败保留 active checkpoint，恢复只重投不重跑。
	if (!audit.systemError) {
		const passDeliveryId = activeGoalReviewDeliveryId(
			state,
			"acceptance",
			"passed",
		);
		if (
			!resultCardDelivered(ctx, passDeliveryId) &&
			!sendGoalReviewCard(ctx, reviewedGoal, round, audit, true, passDeliveryId)
				.delivered
		) {
			state.completionAuditPending = undefined;
			updateStatus(ctx, goal);
			return;
		}
	}
	// 验收通过的结算事务同步推进 quality_retry；系统错误的结算与暂停合并为同一次
	// canonical 写，消除两写之间的崩溃窗口。
	const settleGoal = audit.systemError
		? transitionGoal(reviewedGoal, "paused")
		: reviewedGoal;
	const systemErrorAttention = {
		kind: "system_error" as const,
		message: clipText(audit.feedback, 200),
	};
	if (
		!settleAcceptanceCheckpoint(
			state,
			ctx,
			settleGoal,
			audit.systemError ? undefined : "quality_retry",
			audit.systemError ? systemErrorAttention : undefined,
		)
	) {
		state.completionAuditPending = undefined;
		updateStatus(ctx, goal);
		return;
	}
	state.completionAuditPending = undefined;
	if (audit.systemError) {
		emitWorkerPauseHandoff(ctx, settleGoal, systemErrorAttention.message);
		return finishGoalPauseAfterCanonical(ctx, settleGoal);
	}
	const completedReviewGoal: ActiveGoal = {
		...reviewedGoal,
		consecutiveCheckFailures: 0,
	};
	state.activeGoal = completedReviewGoal;
	await continueAfterGoalStateReviewPassed(ctx, completedReviewGoal, round);
}

async function handleGoalStateReviewFailure(
	ctx: ExtensionContext,
	reviewedGoal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
	run: { generation: number; signal: AbortSignal },
) {
	const state = goalStateForSession(ctx);
	const priorHistory = reviewedGoal.stateReviewHistory.filter(
		(entry) => entry.round !== round,
	);
	const failures = trailingFailures(priorHistory) + 1;
	const repairGoal: ActiveGoal = {
		...reviewedGoal,
		consecutiveCheckFailures: failures,
		stepStartedAt: Date.now(),
		updatedAt: Date.now(),
	};
	if (repairGoal.consecutiveCheckFailures >= MAX_CONSECUTIVE_CHECK_FAILURES) {
		state.completionAuditPending = undefined;
		const deliveryId = activeGoalReviewDeliveryId(
			state,
			"acceptance",
			"stopped",
		);
		if (!sendGoalCheckHardCapCard(ctx, repairGoal, deliveryId).delivered) {
			updateStatus(ctx, reviewedGoal);
			return;
		}
		// 硬上限的结算、暂停与接管事实合并为同一次 canonical 写。
		const pausedGoal = transitionGoal(repairGoal, "paused");
		const hardCapAttention = {
			kind: "check_hard_cap" as const,
			message: hardCapStopReason(
				pausedGoal.consecutiveCheckFailures,
				pausedGoal.language,
			),
		};
		if (
			!settleAcceptanceCheckpoint(
				state,
				ctx,
				pausedGoal,
				undefined,
				hardCapAttention,
			)
		)
			return updateStatus(ctx, reviewedGoal);
		cancelContinuationPending(state);
		cancelCompletionAudit(state);
		emitWorkerPauseHandoff(ctx, pausedGoal, hardCapAttention.message);
		return finishGoalPauseAfterCanonical(ctx, pausedGoal);
	}
	const consult = shouldConsultAdvisor(failures) && isAdvisorEnabled();
	const failureDeliveryId = activeGoalReviewDeliveryId(
		state,
		"acceptance",
		"failed",
	);
	if (
		!resultCardDelivered(ctx, failureDeliveryId) &&
		!sendGoalReviewCard(
			ctx,
			repairGoal,
			round,
			audit,
			false,
			failureDeliveryId,
			consult ? failures : undefined,
		).delivered
	) {
		state.completionAuditPending = undefined;
		updateStatus(ctx, reviewedGoal);
		return;
	}
	if (!consult) {
		state.completionAuditPending = undefined;
		return settleGoalStateReviewFailure(ctx, state, reviewedGoal, repairGoal);
	}
	// 咨询期间保留 completionAuditPending：暂停/停止会 abort 同一 controller，随之终止顾问子进程。
	const repairDeliveryId = activeGoalReviewDeliveryId(
		state,
		"acceptance",
		"repair",
	);
	const recoveredAdvice = advisorCardAdvice(ctx, repairDeliveryId);
	const advice =
		recoveredAdvice ??
		(await maybeConsultAdvisor(
			ctx,
			repairGoal,
			failures,
			"acceptance",
			[],
			run.signal,
		));
	state.completionAuditPending = undefined;
	// 咨询期间步骤可能已被暂停或取消：迟到结果直接丢弃，不得覆盖状态。
	if (!isCurrentCompletionAudit(state, reviewedGoal.id, run.generation)) return;
	const advisedGoal = advice
		? withAcceptanceAdvice(repairGoal, round, advice)
		: repairGoal;
	const repairPrompt = goalReviewRepairPrompt(
		advisedGoal,
		round,
		audit,
		advice,
	);
	if (advice) {
		if (
			!recoveredAdvice &&
			!sendAdvisorCard(goalRuntimeState.extensionApi, ctx, {
				advice,
				language: advisedGoal.language,
				content: repairPrompt,
				deliveryId: repairDeliveryId,
				triggerTurn: true,
			}).delivered
		) {
			updateStatus(ctx, reviewedGoal);
			return;
		}
	} else if (
		!sendRuntimePrompt(
			goalRuntimeState.extensionApi as ExtensionAPI,
			ctx,
			repairPrompt,
			{ language: advisedGoal.language },
		)
	) {
		updateStatus(ctx, reviewedGoal);
		return;
	}
	settleGoalStateReviewFailure(ctx, state, reviewedGoal, advisedGoal);
}

function settleGoalStateReviewFailure(
	ctx: ExtensionContext,
	state: GoalRuntimeState,
	reviewedGoal: ActiveGoal,
	repairGoal: ActiveGoal,
) {
	if (
		!settleAcceptanceCheckpoint(state, ctx, repairGoal, "acceptance_repair")
	) {
		updateStatus(ctx, reviewedGoal);
		return;
	}
	state.activeGoal = repairGoal;
	persistGoal(repairGoal, ctx);
	updateStatus(ctx, repairGoal);
}

function activeGoalReviewDeliveryId(
	state: GoalRuntimeState,
	phase: "acceptance" | "quality",
	kind: "passed" | "failed" | "repair" | "stopped",
) {
	const active = state.goalReviewLive?.active;
	if (!active) throw new Error("检查反馈缺少 active checkpoint");
	return checkResultDeliveryId(phase, active.runId, kind);
}

function settleAcceptanceCheckpoint(
	state: GoalRuntimeState,
	ctx: ExtensionContext,
	goal: ActiveGoal,
	completionCursor?: CompletionCursor,
	attention?: Omit<FlowAttention, "at">,
) {
	const active =
		state.goalReviewLive?.phase === "acceptance"
			? state.goalReviewLive.active
			: null;
	if (!active) return false;
	state.goalReviewLive = { phase: "acceptance", active: null };
	const settled = syncGoalReviewSurfaces(state, ctx, goal, {
		expectedGeneration: active.generation,
		completionCursor,
		attention,
	});
	state.goalReviewLive = undefined;
	return settled.kind === "saved";
}

/**
 * 暂停与 handoff 已随 canonical 事务落盘后，worker 需要 blocked 事件驱动退出；
 * 串行进程无 worker context，emit 是 no-op。
 */
function emitWorkerPauseHandoff(
	ctx: StatusContext,
	goal: ActiveGoal,
	message: string,
) {
	if (goal.artifactStatePath)
		emitFlowGoalBlocked({ goalId: goal.id, message }, ctx);
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
	setCompletionCursor(ctx, goal, "quality_retry", false);
	const activeCheck = readActiveCheckRun(ctx, goal, "quality");
	let qualityStopHandled = false;
	const review = await runConfiguredReview(
		goalRuntimeState.extensionApi as ExtensionAPI,
		ctx,
		{
			scope: {
				kind: "goal",
				goalId: goal.id,
				language: goal.language,
				goalText: goal.text,
				plan,
				planChangeNote: planChangeNoteFor(ctx, goal),
				sessionAnchorId: goal.sessionAnchorId,
				statusPrefix: flow ? flowScope(flow.label) : GOAL_SCOPE,
				statusKey: STATUS_KEY,
				totalStartedAt: topStartedAt(ctx, goal),
				showTotalElapsed: shouldShowTotalElapsed(ctx, stateReviewRound),
				resumeCommand: goalResumeCommand(ctx),
				activity: flow
					? {
							object: "Flow",
							rows: activityRows(flow.displayLabel),
						}
					: {
							object: goal.language === "en" ? "Goal" : "目标",
							rows: activityRows(clippedGoalDisplayText(goal)),
						},
			},
			initialHistory: goal.qualityReviewHistory,
			activeCheck,
			onStart: (config) =>
				sendGoalQualityReviewStartCard(ctx, goal, config.modelRoles.reviewers),
			// PASS 结算（active/phase 清空且末轮通过）必须同一事务推进 finalize_retry，
			// 否则 onPass 收口前崩溃会按 quality_retry 重跑已通过的质检。
			onCheckRun: (active, history, expectedGeneration, phase) =>
				publishGoalReviewLive(
					ctx,
					goal,
					{ phase: "quality", active, rounds: history },
					expectedGeneration,
					phase === "awaiting_agent"
						? "quality_repair"
						: !active && !phase && history.at(-1)?.result === "passed"
							? "finalize_retry"
							: undefined,
				)
					? "saved"
					: "deferred",
			onRoundStart: () =>
				setCompletionCursor(ctx, goal, "quality_retry", false),
			onRoundFailed: async (_round, history) => {
				const current = state.activeGoal;
				if (!current || current.id !== goal.id) return {};
				const failures = current.consecutiveCheckFailures + 1;
				if (failures >= MAX_CONSECUTIVE_CHECK_FAILURES)
					return { stopMessage: hardCapStopReason(failures, current.language) };
				const directive: ReviewRoundFailedDirective = {};
				if (failures >= REVISION_PERMISSION_AFTER_FAILURES)
					directive.extraPromptLines = [
						revisionPermissionClause(failures, current.language),
					];
				if (shouldConsultAdvisor(failures) && isAdvisorEnabled())
					directive.consultAdvisor = (signal) =>
						maybeConsultAdvisor(
							ctx,
							current,
							failures,
							"quality",
							history,
							signal,
						);
				return directive;
			},
			onRoundFailedDelivered: (_round, history) => {
				const current = state.activeGoal;
				if (!current || current.id !== goal.id) return;
				state.activeGoal = {
					...recordGoalQualityReview(current, history),
					consecutiveCheckFailures: current.consecutiveCheckFailures + 1,
				};
				persistGoal(state.activeGoal, ctx);
			},
			onProgress: (_progress, history) =>
				publishGoalReviewLive(ctx, goal, {
					phase: "quality",
					active:
						state.goalReviewLive?.phase === "quality"
							? state.goalReviewLive.active
							: null,
					rounds: history,
				}),
			onPass: (stats, summary) =>
				completeGoalAfterReviews(ctx, goal, stateReviewRound, stats, summary),
			onStopFeedback: (stop, history, deliveryId) => {
				const current = state.activeGoal;
				if (!current || current.id !== goal.id) return false;
				return (
					(deliveryId ? resultCardDelivered(ctx, deliveryId) : false) ||
					sendGoalQualityReviewBlockedCard(
						ctx,
						current,
						stop,
						history,
						deliveryId,
					).delivered
				);
			},
			onStop: (stop, history) => {
				qualityStopHandled = true;
				pauseGoalAfterQualityReviewStop(ctx, goal.id, stop, history);
			},
		},
	);
	if (review.kind === "disabled")
		completeGoalAfterReviews(ctx, goal, stateReviewRound, undefined);
	else if (
		review.kind === "checkpoint_deferred" ||
		review.kind === "awaiting_delivery"
	) {
		state.goalReviewLive = undefined;
		if (state.activeGoal?.id === goal.id) updateStatus(ctx, state.activeGoal);
	} else if (review.kind === "busy")
		pauseGoalAfterQualityReviewStop(ctx, goal.id, {
			kind: "blocked",
			message: qualityStopMessage("busy", goal.language),
		});
	else if (review.kind === "needs_user")
		pauseGoalAfterQualityReviewStop(ctx, goal.id, {
			kind: "blocked",
			message: qualityStopMessage("needs_user", goal.language),
		});
	else if (review.kind === "stopped" && !qualityStopHandled)
		pauseGoalAfterQualityReviewStop(ctx, goal.id, review.stop);
}

/** canonical 暂停已提交后的 session 收口：持久化、UI、watcher 与接管提示。 */
function finishGoalPauseAfterCanonical(
	ctx: StatusContext,
	pausedGoal: ActiveGoal,
) {
	const state = goalStateForSession(ctx);
	state.activeGoal = pausedGoal;
	persistGoal(pausedGoal, ctx);
	updateStatus(ctx, pausedGoal);
	requestGoalAttention(pausedGoal.id);
}

/** 单事务暂停：canonical 提交成功才推进 session；BLOCKED 锁忙时持久化事实并等待锁释放。 */
function commitGoalPause(
	ctx: StatusContext,
	goal: ActiveGoal,
	attention?: Omit<FlowAttention, "at">,
): ActiveGoal | undefined {
	const state = goalStateForSession(ctx);
	const pausedGoal = transitionGoal(goal, "paused");
	const synced = syncGoalReviewSurfaces(state, ctx, pausedGoal, { attention });
	if (synced.kind === "saved") {
		clearPendingBlockedPause(state, ctx);
		if (attention)
			emitFlowGoalBlocked(
				{ goalId: pausedGoal.id, message: attention.message },
				ctx,
			);
		finishGoalPauseAfterCanonical(ctx, pausedGoal);
		return pausedGoal;
	}
	if (attention) {
		queuePendingBlockedPause(ctx, goal, attention.message, synced);
		return undefined;
	}
	updateStatus(ctx, goal);
	requestGoalAttention(goal.id);
	return undefined;
}

function queuePendingBlockedPause(
	ctx: StatusContext,
	goal: ActiveGoal,
	reason: string,
	synced: Exclude<GoalReviewSurfaceSyncResult, { kind: "saved" }>,
) {
	const state = goalStateForSession(ctx);
	state.pendingBlockedPause = { goalId: goal.id, reason };
	persistBlockedPauseOutbox(state, ctx);
	showPendingBlockedPause(ctx, goal, reason);
	state.blockedPauseLockWatcher?.();
	state.blockedPauseLockWatcher = undefined;
	if (synced.kind === "locked")
		try {
			state.blockedPauseLockWatcher = watchFlowLockRelease(synced.dir, () => {
				state.blockedPauseLockWatcher = undefined;
				retryPendingBlockedPause(ctx);
			});
		} catch {
			// session_start 会从 durable outbox 重试。
		}
	requestGoalAttention(goal.id);
}

function retryPendingBlockedPause(ctx: StatusContext) {
	const state = goalStateForSession(ctx);
	const pending = state.pendingBlockedPause;
	const goal = state.activeGoal;
	if (!pending) return;
	if (!goal || goal.id !== pending.goalId || goal.status !== "active") {
		clearPendingBlockedPause(state, ctx);
		return;
	}
	commitGoalPause(ctx, goal, {
		kind: "user_action_required",
		message: pending.reason,
	});
}

function clearPendingBlockedPause(state: GoalRuntimeState, ctx: StatusContext) {
	if (!state.pendingBlockedPause && !state.blockedPauseLockWatcher) return;
	state.pendingBlockedPause = undefined;
	state.blockedPauseLockWatcher?.();
	state.blockedPauseLockWatcher = undefined;
	persistBlockedPauseOutbox(state, ctx);
}

function persistBlockedPauseOutbox(
	state: GoalRuntimeState,
	ctx: StatusContext,
) {
	try {
		appendCustomEntry<BlockedPauseOutboxEntry>(
			ctx,
			goalRuntimeState.extensionApi,
			BLOCKED_PAUSE_OUTBOX_ENTRY_TYPE,
			{ pending: state.pendingBlockedPause ?? null },
		);
	} catch (error) {
		const language = state.activeGoal?.language ?? runtimeLanguage();
		notifyUser(
			ctx,
			formatUserNotice(
				"⚠️",
				language === "en" ? "Takeover state save failed" : "接管状态保存失败",
				[formatError(error)],
			),
			"info",
			language,
		);
	}
}

function loadBlockedPauseOutbox(
	ctx: StatusContext,
): PendingBlockedPause | undefined {
	const sessionManager = ctx.sessionManager as
		| {
				getBranch?: () => unknown[];
				getEntries?: () => unknown[];
		  }
		| undefined;
	const entries =
		sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
	const entry = [...entries]
		.reverse()
		.find(
			(item) =>
				isRecord(item) &&
				item.type === "custom" &&
				item.customType === BLOCKED_PAUSE_OUTBOX_ENTRY_TYPE,
		);
	if (!isRecord(entry) || !isRecord(entry.data)) return undefined;
	const pending = entry.data.pending;
	if (!isRecord(pending)) return undefined;
	const goalId = pending.goalId;
	const reason = pending.reason;
	return typeof goalId === "string" && typeof reason === "string" && reason
		? { goalId, reason }
		: undefined;
}

function showPendingBlockedPause(
	ctx: StatusContext,
	goal: ActiveGoal,
	reason: string,
) {
	const state = goalStateForSession(ctx);
	setFlowActivity("goal", false);
	stopGoalStatusTimer(state);
	setReviewActivityBox(ctx, undefined);
	setGoalActivityBox(ctx, pausedGoalActivity(ctx, goal, reason));
	setStatusText(
		ctx,
		STATUS_KEY,
		goal.language === "en"
			? "🌊 Flow · waiting for your action"
			: "🌊 Flow · 等待你接管",
		goal.language,
	);
}

/** BLOCKED 接管：执行模型声明阻塞于用户操作，不送检查，原子暂停并请求接管。 */
function pauseGoalBlockedOnUser(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	reason: string,
) {
	commitGoalPause(ctx, goal, {
		kind: "user_action_required",
		message: clipText(reason, 300),
	});
}

function pauseGoalAfterAcceptanceConfigError(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	round: number,
	reason: string,
) {
	const paused = commitGoalPause(ctx, goal, {
		kind: "system_error",
		message: clipText(reason, 200),
	});
	if (!paused) return;
	sendGoalAcceptanceConfigErrorCard(ctx, paused, round, reason);
}

function pauseGoalAfterQualityReviewStop(
	ctx: ExtensionContext,
	goalId: string,
	stop: ReviewStop,
	history: ReviewHistoryEntry[] = [],
) {
	const state = goalStateForSession(ctx);
	cancelCompletionAudit(state);
	if (!state.activeGoal || state.activeGoal.id !== goalId) return;
	const reviewedGoal = recordGoalQualityReview(state.activeGoal, history);
	if (stop.kind === "cancelled" && stop.source === "user") {
		const paused = pauseGoalAfterUserCheckCancellation(
			ctx,
			reviewedGoal,
			"quality",
			stop.expectedGeneration,
			history,
		);
		if (paused)
			notifyUser(
				ctx,
				qualityCancelledNotice(ctx, paused),
				"info",
				paused.language,
			);
		return;
	}
	const pausedGoal = transitionGoal(reviewedGoal, "paused");
	const stopAttention =
		stop.kind === "cancelled"
			? undefined
			: {
					kind:
						stop.kind === "check_limit"
							? ("check_hard_cap" as const)
							: stop.kind === "user_action"
								? ("user_action_required" as const)
								: ("system_error" as const),
					message: clipText(stop.message, 300),
				};
	if (stop.kind !== "cancelled") {
		state.goalReviewLive = {
			phase: "quality",
			active: null,
			...(history.length > 0 ? { rounds: history } : {}),
		};
		const synced = syncGoalReviewSurfaces(state, ctx, pausedGoal, {
			expectedGeneration: stop.expectedGeneration,
			attention: stopAttention,
		});
		state.goalReviewLive = undefined;
		if (synced.kind !== "saved") {
			updateStatus(ctx, state.activeGoal);
			return;
		}
	}
	state.goalReviewLive = undefined;
	state.activeGoal = pausedGoal;
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	if (stop.kind === "cancelled" || !stopAttention) return;
	emitWorkerPauseHandoff(ctx, pausedGoal, stopAttention.message);
	if (!stop.feedbackDelivered)
		sendGoalQualityReviewBlockedCard(ctx, state.activeGoal, stop, history);
	requestGoalAttention(goalId);
}

function pauseGoalAfterUserCheckCancellation(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	phase: "acceptance" | "quality",
	expectedGeneration: string | undefined,
	history: ReviewHistoryEntry[] = [],
) {
	const state = goalStateForSession(ctx);
	const pausedGoal = transitionGoal(goal, "paused");
	state.goalReviewLive = {
		phase,
		active: null,
		...(history.length > 0 ? { rounds: history } : {}),
	};
	const synced = syncGoalReviewSurfaces(state, ctx, pausedGoal, {
		expectedGeneration,
		completionCursor:
			phase === "acceptance" ? "acceptance_retry" : "quality_retry",
	});
	state.goalReviewLive = undefined;
	if (synced.kind !== "saved") {
		updateStatus(ctx, goal);
		requestGoalAttention(goal.id);
		return undefined;
	}
	state.activeGoal = pausedGoal;
	persistGoal(pausedGoal, ctx);
	updateStatus(ctx, pausedGoal);
	return pausedGoal;
}

function sendGoalCheckHardCapCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	deliveryId: string,
) {
	if (resultCardDelivered(ctx, deliveryId)) return { delivered: true } as const;
	const reason = hardCapStopReason(
		goal.consecutiveCheckFailures,
		goal.language,
	);
	const next = quoteCommand(goalResumeCommand(ctx));
	const flow = flowContext(ctx);
	const title = flow
		? goal.language === "en"
			? `Flow ${flow.displayLabel} paused`
			: `Flow ${flow.displayLabel} 已暂停`
		: goal.language === "en"
			? "Goal paused"
			: "目标已暂停";
	const lines =
		goal.language === "en"
			? [`Blocker: ${reason}`, `Next: ${next}`]
			: [`卡点：${reason}`, `下一步：${next}`];
	const content = [`[${title}]`, goalLine(goal), ...lines].join("\n");
	return sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "goal-review",
		result: "错误",
		title,
		lines,
		language: goal.language,
		context: "check-result",
		deliveryId,
	});
}

function sendGoalStateReviewStartCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	round: number,
	models: ReviewerConfig[],
) {
	const flow = flowContext(ctx);
	const title = roundTitle(
		round,
		acceptanceTitle("progress", goal.language),
		goal.language,
	);
	const lines = [
		...(flow ? [flowLine(flow.displayLabel, goal.language)] : []),
		goalLine(goal),
		modelLine(goalAuditorLabels(models, goal.language), goal.language),
	];
	const content = [`[${title}]`, ...lines].join("\n");
	sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		icon: "🎯",
		language: goal.language,
		context: "check-start",
	});
}

function sendGoalQualityReviewStartCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	models: ReviewerConfig[],
) {
	const flow = flowContext(ctx);
	const title = qualityTitle("progress", goal.language);
	const lines = [
		...(flow ? [flowLine(flow.displayLabel, goal.language)] : []),
		goalLine(goal),
		modelLine(qualityModelLabels(models, goal.language), goal.language),
	];
	const content = [`[${title}]`, ...lines].join("\n");
	sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		icon: "💯",
		language: goal.language,
		context: "check-start",
	});
}

function pauseGoalAfterCompletionFactFailure(
	ctx: ExtensionContext,
	goal: ActiveGoal,
) {
	const paused = commitGoalPause(ctx, goal);
	if (!paused) return;
	sendGoalCompletionFactErrorCard(ctx, paused);
}

function sendGoalQualityReviewBlockedCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	stop: Exclude<ReviewStop, { kind: "cancelled" }>,
	history: ReviewHistoryEntry[],
	deliveryId?: string,
) {
	if (stop.kind === "check_limit" && history.length > 0)
		return sendGoalQualityLimitCard(
			ctx,
			goal,
			stop.message,
			history.at(-1),
			deliveryId,
		);
	const flow = flowContext(ctx);
	const next = quoteCommand(goalResumeCommand(ctx));
	const title = flow
		? goal.language === "en"
			? `Flow ${flow.label} paused`
			: `Flow ${flow.label} 已暂停`
		: goal.language === "en"
			? "Goal paused"
			: "目标已暂停";
	const lines = [
		stop.kind === "config_error"
			? goal.language === "en"
				? "Blocker: quality check could not start"
				: "卡点：质检无法启动"
			: goal.language === "en"
				? "Blocker: quality check did not complete"
				: "卡点：质检未完成",
		goal.language === "en"
			? `Reason: ${qualityReviewStopReason(stop, goal.language)}`
			: `原因：${qualityReviewStopReason(stop, goal.language)}`,
		goal.language === "en" ? `Next: ${next}` : `下一步：${next}`,
	];
	const content = [`[${title}]`, goalLine(goal), ...lines].join("\n");
	return sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "quality-review",
		result: "错误",
		title,
		lines,
		language: goal.language,
		...(deliveryId ? { context: "check-result", deliveryId } : {}),
	});
}

function sendGoalQualityLimitCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	reason: string,
	latest: ReviewHistoryEntry | undefined,
	deliveryId?: string,
) {
	const next = quoteCommand(goalResumeCommand(ctx));
	const title = roundTitle(
		latest?.round ?? 1,
		goal.language === "en" ? "Quality check failed" : "质检未通过",
		goal.language,
	);
	const review = formatReviewResultLines(
		latest?.details ?? latest?.summary ?? "",
	);
	const scope = flowContext(ctx)
		? "Flow"
		: goal.language === "en"
			? "Goal"
			: "目标";
	const paused =
		goal.language === "en"
			? [`${scope} paused: ${reason}`, `Next: ${next}`]
			: [
					`${scope === "Flow" ? "Flow " : scope}已暂停：${reason}`,
					`下一步：${next}`,
				];
	const lines = composeResultCardLines([review, paused]);
	const content = [`[${title}]`, goalLine(goal), ...lines].join("\n");
	return sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "quality-review",
		result: "未通过",
		title,
		lines,
		language: goal.language,
		...(deliveryId ? { context: "check-result", deliveryId } : {}),
	});
}

function qualityReviewStopReason(
	stop: Exclude<ReviewStop, { kind: "cancelled" }>,
	language: Language,
) {
	if (stop.kind !== "config_error") return stop.message;
	return language === "en"
		? `Quality check config read failed: ${stop.message}`
		: `质检配置读取失败：${stop.message}`;
}

function sendGoalCompletionFactErrorCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
) {
	const flow = flowContext(ctx);
	const next = quoteCommand(goalResumeCommand(ctx));
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
					"卡点：质检已通过，但完成事实未写入",
					"原因：缺少完成事实记录",
					`下一步：${next}`,
				];
	const content = [`[${title}]`, goalLine(goal), ...lines].join("\n");
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
	deliveryId?: string,
) {
	return sendGoalAcceptanceBlockedCard(
		ctx,
		goal,
		round,
		goal.language === "en"
			? "Blocker: acceptance did not complete"
			: "卡点：验收未完成",
		audit.feedback || audit.raw,
		deliveryId,
	);
}

function sendGoalAcceptanceConfigErrorCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	round: number,
	reason: string,
) {
	return sendGoalAcceptanceBlockedCard(
		ctx,
		goal,
		round,
		goal.language === "en"
			? "Blocker: acceptance could not start"
			: "卡点：验收无法启动",
		reason,
	);
}

function sendGoalAcceptanceBlockedCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	round: number,
	blocker: string,
	reason: string,
	deliveryId?: string,
) {
	const next = quoteCommand(goalResumeCommand(ctx));
	const title = roundTitle(
		round,
		acceptanceTitle("error", goal.language),
		goal.language,
	);
	const bodyLines = [
		blocker,
		goal.language === "en" ? `Reason: ${reason}` : `原因：${reason}`,
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
	const content = [`[${title}]`, goalLine(goal), ...bodyLines].join("\n");
	return sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "goal-review",
		result: "错误",
		title,
		lines,
		language: goal.language,
		...(deliveryId ? { context: "check-result", deliveryId } : {}),
	});
}

/** 达到咨询节奏（2/4/6/8 轮）时咨询顾问模型；失败只 notify，不阻塞反馈投递。 */
async function maybeConsultAdvisor(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	failures: number,
	phase: "acceptance" | "quality",
	qualityHistory: ReviewHistoryEntry[] = [],
	signal?: AbortSignal,
): Promise<CheckRoundAdvisor | undefined> {
	if (!shouldConsultAdvisor(failures) || !isAdvisorEnabled()) return undefined;
	const result = await runAdvisorConsultation(
		ctx,
		goal,
		failures,
		phase,
		qualityHistory,
		signal,
	);
	if (result.kind === "advice") return result.advice;
	if (result.kind === "unavailable")
		notifyUser(
			ctx,
			advisorUnavailableNotice(result.reason, goal.language),
			"info",
			goal.language,
		);
	return undefined;
}

/** 自动与手动咨询共用同一活动态、输入锁和 Esc 取消边界。 */
async function runAdvisorConsultation(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	failures: number,
	phase: "acceptance" | "quality",
	qualityHistory: ReviewHistoryEntry[] = [],
	signal?: AbortSignal,
): Promise<AdvisorConsultResult> {
	const state = goalStateForSession(ctx);
	const skip = new AbortController();
	const consultSignal = signal
		? AbortSignal.any([signal, skip.signal])
		: skip.signal;
	const restoreInputHidden = isFlowEditorInputHidden();
	const setBox =
		phase === "quality" ? setReviewActivityBox : setGoalActivityBox;
	setBox(ctx, advisorConsultingActivity(ctx, goal, failures));
	setFlowEditorInputHidden(true);
	setFlowCancelHandler(() => skip.abort());
	const priorLive = state.goalReviewLive;
	if (priorLive && priorLive.phase === phase)
		publishGoalReviewLive(ctx, goal, { ...priorLive, consulting: true });
	const status = startElapsedStatus(
		ctx,
		STATUS_KEY,
		(seconds) =>
			`${advisorStatusScope(ctx, goal)} · ${formatDuration(seconds)}`,
		{ language: goal.language },
	);
	try {
		return await consultAdvisor({
			goalText: goal.text,
			language: goal.language,
			plan: goalPlanEvidence(ctx, goal),
			planChangeNote: planChangeNoteFor(ctx, goal),
			failureHistory: advisorFailureHistory(goal, qualityHistory),
			sessionAnchorId: goal.sessionAnchorId,
			ctx,
			signal: consultSignal,
			onProgress: (progress) =>
				setBox(ctx, advisorConsultingActivity(ctx, goal, failures, progress)),
		});
	} finally {
		status.stop();
		clearStatus(ctx, STATUS_KEY);
		setFlowCancelHandler(undefined);
		setFlowEditorInputHidden(restoreInputHidden);
		setBox(ctx, undefined);
		if (priorLive && state.goalReviewLive?.consulting)
			publishGoalReviewLive(ctx, goal, priorLive);
	}
}

export async function consultActiveFlowAdvisor(
	ctx: ExtensionContext,
): Promise<ManualAdvisorResult> {
	const flow = flowContext(ctx);
	const language = flow?.flow.language ?? runtimeLanguage();
	if (flow?.flow.parallelRun) return { kind: "parallel", language };
	const goal = activeGoalForSession(ctx);
	if (!flow || !goal || goal.artifactStatePath)
		return { kind: "no_flow", language };
	if (flow.plan.pendingAdvisor)
		return { kind: "pending", flowId: flow.flow.id, language };
	if (!isAdvisorEnabled()) return { kind: "disabled", language };
	if (isCompletionChainBusy(ctx, goal) || isReviewLoopActive())
		return { kind: "busy", language };
	const target = manualAdvisorTarget(goal);
	if (!target) return { kind: "no_failure", language };
	if (target.advisor)
		return { kind: "already_advised", flowId: flow.flow.id, language };
	const result = await runAdvisorConsultation(
		ctx,
		goal,
		target.failures,
		target.phase,
		goal.qualityReviewHistory,
	);
	if (result.kind !== "advice") return { ...result, language };
	const saveError = persistManualAdvisor(ctx, goal, target, result.advice);
	if (saveError) return { kind: "unavailable", reason: saveError, language };
	return {
		kind: "advice",
		advice: result.advice,
		flowId: flow.flow.id,
		language,
	};
}

function manualAdvisorTarget(goal: ActiveGoal) {
	const phase: PendingAdvisor["phase"] =
		goal.qualityReviewHistory.length > 0 ? "quality" : "acceptance";
	const history =
		phase === "quality" ? goal.qualityReviewHistory : goal.stateReviewHistory;
	const failures = trailingFailures(history);
	const latest = history.at(-1);
	return failures > 0 && latest
		? { phase, round: latest.round, failures, advisor: latest.advisor }
		: undefined;
}

function persistManualAdvisor(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	target: PendingAdvisor & { failures: number },
	advice: CheckRoundAdvisor,
): string | undefined {
	try {
		const owner = flowOwnerForSession(ctx);
		if (!owner)
			return goal.language === "en"
				? "The current session no longer owns a Flow"
				: "当前会话已不再归属该 Flow";
		const sessionFile = currentSessionFile(ctx);
		const saved = withFlowLockSync(
			owner.dir,
			`save manual advisor ${owner.flow.id}`,
			() => {
				const flow = readFlow(owner.dir);
				const current = currentGoal(flow);
				if (
					!current ||
					current.sessionFile !== sessionFile ||
					current.status !== "running" ||
					flow.parallelRun ||
					current.pendingAdvisor
				)
					return undefined;
				const phase = current.checks[target.phase];
				const latest = phase.rounds.at(-1);
				if (
					!latest ||
					latest.round !== target.round ||
					latest.result !== "failed" ||
					latest.advisor ||
					trailingFailures(phase.rounds) !== target.failures
				)
					return undefined;
				const checks: GoalChecks = {
					...current.checks,
					[target.phase]: {
						...phase,
						rounds: phase.rounds.map((round) =>
							round.round === target.round
								? { ...round, advisor: advice }
								: round,
						),
					},
				};
				const goals = flow.goals.map((item, index) =>
					index === flow.currentGoal
						? {
								...item,
								checks,
								pendingAdvisor: {
									phase: target.phase,
									round: target.round,
								},
							}
						: item,
				);
				return writeFlow(owner.dir, { ...flow, goals });
			},
		);
		if (!saved.ok) return flowLockBusyMessage(saved.owner, goal.language);
		if (!saved.value)
			return goal.language === "en"
				? "The failed check changed while the advisor was running"
				: "顾问运行期间失败检查已发生变化";
		publishFlowReportProjection(ctx, owner.dir, saved.value, goal.language);
		const state = goalStateForSession(ctx);
		state.activeGoal = reconcileGoalChecks(ctx, goal);
		persistGoal(state.activeGoal, ctx);
		return undefined;
	} catch (error) {
		return formatError(error);
	}
}

function advisorConsultingLabel(language: Language) {
	return language === "en" ? "Advisor consulting" : "顾问介入中";
}

function advisorStatusScope(ctx: ExtensionContext, goal: ActiveGoal) {
	const flow = flowContext(ctx);
	const label = advisorConsultingLabel(goal.language);
	return flow ? `${flowScope(flow.label)}/${label}` : `${GOAL_SCOPE}/${label}`;
}

/** 顾问咨询期间的活动态固定框：与其他活动框同一套规则（宽 ≥60 显示火焰）。 */
function advisorConsultingActivity(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	failures: number,
	progress?: AgentProgress,
): ActivityWidgetMessage {
	const flow = flowContext(ctx);
	const subject = flow ? flow.displayLabel : clippedGoalDisplayText(goal);
	const model = advisorDisplayModel();
	const rows = activityRows(subject, [
		...(model && progress
			? [
					reviewerActivityLine(
						shortModel(model.model),
						progress,
						goal.language,
						ctx.cwd,
					),
				]
			: []),
		goal.language === "en"
			? `Checks failed ${failures} rounds in a row`
			: `已连续 ${failures} 轮检查未通过`,
	]);
	return {
		title: `🧭 ${advisorConsultingLabel(goal.language)}`,
		rows,
		hint: `${currentCancelHint()} ${goal.language === "en" ? "skip consult" : "跳过咨询"} · ${monitorDetailsHint(goal.language)}`,
		flame: true,
		language: goal.language,
	};
}

function advisorDisplayModel() {
	try {
		return advisorConsultModel(readFlowConfig());
	} catch {
		return undefined;
	}
}

function advisorFailureHistory(
	goal: ActiveGoal,
	qualityHistory: ReviewHistoryEntry[],
): AdvisorFailureRound[] {
	return [
		...goal.stateReviewHistory
			.filter((entry) => entry.result === "failed")
			.map((entry) => ({ phase: "acceptance" as const, entry })),
		...qualityHistory
			.filter((entry) => entry.result === "failed")
			.map((entry) => ({ phase: "quality" as const, entry })),
	];
}

/** 把顾问建议结构化记入该轮验收历史，随检查历史落盘到 flow.json 与 HTML 报告。 */
function withAcceptanceAdvice(
	goal: ActiveGoal,
	round: number,
	advice: CheckRoundAdvisor,
): ActiveGoal {
	return {
		...goal,
		stateReviewHistory: goal.stateReviewHistory.map((entry) =>
			entry.round === round ? { ...entry, advisor: advice } : entry,
		),
	};
}

function sendGoalReviewCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
	passed: boolean,
	deliveryId?: string,
	consultingFailures?: number,
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
			: [goal.language === "en" ? "Acceptance passed." : "验收通过。"]),
		...(audit.infraFeedback || !passed
			? infraAuditLines(audit, goal.language)
			: []),
	];
	const lines = composeResultCardLines(
		[bodyLines],
		[
			...(consultingFailures
				? [advisorConsultingLine(consultingFailures, goal.language)]
				: []),
			resultCardElapsedLine(
				goalReviewElapsedText(ctx, goal, round),
				goal.language,
			),
		],
	);
	return sendResultCard(
		goalRuntimeState.extensionApi,
		ctx,
		content,
		{
			tone: "goal-review",
			result,
			title,
			lines,
			language: goal.language,
			...(deliveryId ? { context: "check-result" as const, deliveryId } : {}),
		},
		{ triggerTurn: !passed && !consultingFailures },
	);
}

function goalReviewContent(
	goal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
	passed: boolean,
) {
	if (!passed) return goalReviewRepairPrompt(goal, round, audit);
	const lines = goalReviewHeader(goal, round, audit, true);
	if (audit.infraFeedback) lines.push(...infraAuditLines(audit, goal.language));
	return lines.join("\n");
}

function goalReviewRepairPrompt(
	goal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
	advice?: CheckRoundAdvisor,
) {
	const lines = goalReviewHeader(goal, round, audit, false);
	if (advice)
		lines.push("", ...advisorDirectionLines(advice.advice, goal.language));
	lines.push(
		"",
		goal.language === "en" ? "Next:" : "下一步：",
		acceptanceFeedbackInstruction(goal.language),
	);
	if (goal.consecutiveCheckFailures >= REVISION_PERMISSION_AFTER_FAILURES)
		lines.push(
			"",
			revisionPermissionClause(goal.consecutiveCheckFailures, goal.language),
		);
	return lines.join("\n");
}

function goalReviewHeader(
	goal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
	passed: boolean,
) {
	return [
		`[${roundTitle(
			round,
			acceptanceTitle(passed ? "passed" : "failed", goal.language),
			goal.language,
		)}]`,
		"",
		goal.language === "en" ? "Original goal:" : "原目标：",
		goalObjectiveContent(goal),
		"",
		goal.language === "en" ? "Acceptance result:" : "验收结果：",
		audit.raw,
	];
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
		if (state === "progress") return "Acceptance in progress";
		if (state === "passed") return "Acceptance passed";
		if (state === "failed") return "Acceptance failed";
		return "Acceptance incomplete";
	}
	if (state === "progress") return "验收中";
	if (state === "passed") return "验收通过";
	if (state === "failed") return "验收未通过";
	return "验收未完成";
}

function qualityTitle(_state: "progress", language: Language) {
	return language === "en" ? "Quality check in progress" : "质检中";
}

function flowLine(label: string, language: Language) {
	return language === "en" ? `Flow: ${label}` : `Flow：${label}`;
}

function goalLine(goal: ActiveGoal) {
	const text = clippedGoalDisplayText(goal);
	return goal.language === "en" ? `Goal: ${text}` : `目标：${text}`;
}

function clippedGoalDisplayText(goal: ActiveGoal) {
	return clipText(goal.text.replace(/\s+/g, " ").trim(), 120);
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

function restoreCheckboxAttribution(
	goal: ActiveGoal,
	ctx: StatusContext,
	artifact: FlowGoalStartOptions["artifact"],
) {
	if (!artifact) {
		const checkAttribution = flowContext(ctx)?.plan.checkAttribution;
		return checkAttribution === undefined
			? goal
			: { ...goal, checkAttribution };
	}
	try {
		const checkAttribution = readGoalRuntimeState(artifact).checkAttribution;
		return checkAttribution === undefined
			? goal
			: { ...goal, checkAttribution };
	} catch {
		// The artifact sync immediately below owns the user-visible read error.
		return goal;
	}
}

function createGoal(
	text: string,
	tokenBudget: number | undefined,
	baselineTokens: number,
	artifact?: FlowGoalStartOptions["artifact"],
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
		consecutiveCheckFailures: 0,
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
	const willAutoResume = !state.retryAutoResumeUsedGoalIds.has(goalId);
	sendRetryExhaustedCard(ctx, state.activeGoal, errorMessage, willAutoResume);
	if (willAutoResume)
		scheduleAutoResumeAfterRetryExhaustion(pi, ctx, state.activeGoal);
	else requestGoalAttention(goalId);
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
		resumeGoalAfterRetryBackoff(pi, ctx, goal.id, generation);
	}, AUTO_RESUME_AFTER_RETRY_EXHAUSTION_MS);
	timer.unref?.();
	state.deferredAutoResume = { goalId: goal.id, generation, timer };
}

function resumeGoalAfterRetryBackoff(
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
	sendRetryAutoResumeCard(ctx, state.activeGoal);
	const resumedGoal = state.activeGoal;
	if (sendResumePrompt(pi, ctx, resumedGoal)) return;
	state.activeGoal = transitionGoal(resumedGoal, "paused");
	syncStandaloneGoalArtifact(ctx, state.activeGoal);
	persistGoal(state.activeGoal, ctx);
	updateStatus(ctx, state.activeGoal);
	requestGoalAttention(goalId);
}

function sendRetryExhaustedCard(
	ctx: StatusContext,
	goal: ActiveGoal,
	errorMessage: string,
	willAutoResume: boolean,
) {
	const next = quoteCommand(goalResumeCommand(ctx));
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
	const content = [`[${title}]`, goalLine(goal), ...lines].join("\n");
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
	const content = [`[${title}]`, goalLine(goal), ...lines].join("\n");
	sendResultCard(goalRuntimeState.extensionApi, ctx, content, {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		language: goal.language,
	});
}

function recoverWebSocketLimitError(
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
	if (sendContinuationPrompt(pi, ctx, goal)) {
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
	notifyUser(
		ctx,
		websocketLimitPausedNotice(ctx, goal, reason),
		"info",
		goal.language,
	);
	requestGoalAttention(goal.id);
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
				`Run ${quoteCommand(goalResumeCommand(ctx))} to continue`,
			])
		: formatUserNotice("⚠️", goalNoticeTitle(ctx, goal, "已暂停"), [
				`原因：${reason}`,
				`运行 ${quoteCommand(goalResumeCommand(ctx))} 继续`,
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
				`Run ${quoteCommand(goalResumeCommand(ctx))} to continue`,
			])
		: formatUserNotice("⚠️", goalNoticeTitle(ctx, goal, "已暂停"), [
				"连接到达 60 分钟上限",
				`原因：${reason}`,
				`运行 ${quoteCommand(goalResumeCommand(ctx))} 继续`,
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

function acceptanceCancelledNotice(ctx: StatusContext, goal: ActiveGoal) {
	return checkCancelledNotice(ctx, goal, "Acceptance cancelled", "验收已取消");
}

function qualityCancelledNotice(ctx: StatusContext, goal: ActiveGoal) {
	return checkCancelledNotice(
		ctx,
		goal,
		"Quality check cancelled",
		"质检已取消",
	);
}

function checkCancelledNotice(
	ctx: StatusContext,
	goal: ActiveGoal,
	english: string,
	chinese: string,
) {
	return formatUserNotice(
		"⏸",
		goal.language === "en"
			? goalNoticeTitle(ctx, goal, "paused")
			: goalNoticeTitle(ctx, goal, "已暂停"),
		[goal.language === "en" ? english : chinese],
	);
}

function qualityStopMessage(kind: "busy" | "needs_user", language: Language) {
	if (language === "en")
		return kind === "busy"
			? "Quality check loop is already running; the Goal completion chain did not close."
			: "Quality check failed and is waiting for manual fixes.";
	return kind === "busy"
		? "质检循环已在运行，目标完成链未收口。"
		: "质检未通过，等待手动应用修复建议。";
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
	notifyUser(
		ctx,
		goalTokenBudgetReachedNotice(goal.language, formatBudget(state.activeGoal)),
		"info",
		goal.language,
	);
	requestGoalAttention(goal.id);
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
		setReviewActivityBox(target, undefined);
		setGoalActivityBox(target, pausedGoalActivity(target, goal));
		return;
	}
	if (goal.status !== "active") {
		setReviewActivityBox(target, undefined);
		setGoalActivityBox(target, undefined);
		return;
	}
	if (isGoalScopedReviewActive()) return setGoalActivityBox(target, undefined);
	const phase = goalUiPhase(goal);
	if (phase.kind === "qualityRepair") {
		setGoalActivityBox(target, undefined);
		setReviewActivityBox(target, qualityRepairActivity(target, goal, phase));
		return;
	}
	setReviewActivityBox(target, undefined);
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
	signal: AbortSignal,
	activeCheck: ActiveCheckRun | null | undefined,
) {
	const state = goalStateForSession(ctx);
	stopGoalStatusTimer(state);
	let reviewStarted = false;
	let status: ElapsedStatus | undefined;
	try {
		return await auditGoalCompletion(
			{
				text: goal.text,
				language: goal.language,
				plan: goalPlanEvidence(ctx, goal),
				planChangeNote: planChangeNoteFor(ctx, goal),
				priorRounds: goal.stateReviewHistory,
				sessionAnchorId: goal.sessionAnchorId,
			},
			"",
			ctx,
			{
				round,
				signal,
				active: activeCheck,
				onCheckRun: (active, expectedGeneration) => {
					if (!isCurrentCompletionAudit(state, goal.id, generation))
						return "deferred";
					return publishGoalReviewLive(
						ctx,
						goal,
						{ phase: "acceptance", active },
						expectedGeneration,
					)
						? "saved"
						: "deferred";
				},
				onStart: (models) => {
					setGoalAuditActivity(goal.id, true);
					sendGoalStateReviewStartCard(ctx, goal, round, models);
					setReviewActivityBox(ctx, undefined);
					setGoalActivityBox(ctx, {
						...goalReviewActivityMessage(ctx, goal, round),
						hint: `${currentCancelHint()} ${goal.language === "en" ? "cancel" : "取消"} · ${monitorDetailsHint(goal.language)}`,
					});
					setFlowEditorInputHidden(true);
					setFlowCancelHandler(() => cancelGoalReview(ctx));
					reviewStarted = true;
					status = startElapsedStatus(
						ctx,
						STATUS_KEY,
						(seconds) =>
							`${goalReviewStatusPrefix(ctx, goal, round)} · ${elapsedLabel(seconds, elapsedSeconds(topStartedAt(ctx, goal)), shouldShowTotalElapsed(ctx, round), goal.language)}`,
						{
							isActive: () =>
								isCurrentCompletionAudit(state, goal.id, generation),
							language: goal.language,
						},
					);
					trackCompletionAuditStatus(state, goal.id, generation, status);
				},
				onProgress: (progress) => {
					if (!isCurrentCompletionAudit(state, goal.id, generation)) return;
					setGoalActivityBox(ctx, {
						...goalReviewActivityMessage(ctx, goal, round, progress),
						hint: `${currentCancelHint()} ${goal.language === "en" ? "cancel" : "取消"} · ${monitorDetailsHint(goal.language)}`,
					});
				},
			},
		);
	} finally {
		const reviewStillCurrent = isCurrentCompletionAudit(
			state,
			goal.id,
			generation,
		);
		if (reviewStarted) {
			setFlowEditorInputHidden(false);
			setFlowCancelHandler(undefined);
			if (reviewStillCurrent) setGoalActivityBox(ctx, undefined);
		}
		if (status)
			clearCompletionAuditStatus(state, ctx, goal.id, generation, status);
	}
}

function cancelGoalReview(ctx: ExtensionContext) {
	const state = goalStateForSession(ctx);
	const active =
		state.goalReviewLive?.phase === "acceptance"
			? state.goalReviewLive.active
			: null;
	cancelCompletionAudit(state);
	if (!state.activeGoal || !active) return;
	const paused = pauseGoalAfterUserCheckCancellation(
		ctx,
		state.activeGoal,
		"acceptance",
		active.generation,
	);
	if (!paused) return;
	notifyUser(
		ctx,
		acceptanceCancelledNotice(ctx, paused),
		"info",
		paused.language,
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
		flame: true,
		title: `${goalActivityObject(ctx, goal.language)} · ${roundTitle(
			round,
			acceptanceTitle("progress", goal.language),
			goal.language,
		)}`,
		rows: activityRows(
			goalReviewActivityRows(ctx, goal),
			progress.length > 0
				? reviewerProgressLines(progress, goal.language, ctx.cwd)
				: [],
		),
	};
}

function goalReviewActivityRows(ctx: StatusContext, goal: ActiveGoal) {
	const flow = flowContext(ctx);
	return flow
		? activityRows(flow.displayLabel)
		: activityRows(clippedGoalDisplayText(goal));
}

function goalAuditorLabels(
	models: ReviewerConfig[],
	language: Language = "zh",
) {
	return models
		.map((auditor) => shortModel(auditor.model))
		.join(language === "en" ? ", " : "、");
}

function qualityModelLabels(
	models: ReviewerConfig[],
	language: Language = "zh",
) {
	return models
		.map((model) => shortModel(model.model))
		.join(language === "en" ? ", " : "、");
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
		{ acceptance: audit },
	);
}

function readActiveCheckRun(
	ctx: StatusContext,
	goal: ActiveGoal,
	phase: "acceptance" | "quality",
): ActiveCheckRun | null | undefined {
	try {
		if (goal.artifactStatePath)
			return readGoalRuntimeState(goal).checks[phase].active;
		return flowContext(ctx)?.plan.checks[phase].active;
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

function readCompletionCursor(
	ctx: StatusContext,
	goal: ActiveGoal,
): CompletionCursor | undefined {
	try {
		if (goal.artifactStatePath)
			return readGoalRuntimeState(goal).completionCursor;
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
	notifyFailure = true,
) {
	try {
		if (goal.artifactStatePath) {
			const state = readGoalRuntimeState(goal);
			writeGoalRuntimeState(goal, {
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
				return writeFlow(owner.dir, { ...flow, goals });
			},
		);
		if (!updated.ok)
			throw new Error(flowLockBusyMessage(updated.owner, goal.language));
		if (updated.value)
			publishFlowReportProjection(ctx, owner.dir, updated.value, goal.language);
	} catch (error) {
		if (notifyFailure)
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
	expectedGeneration?: string | null,
	completionCursor?: CompletionCursor,
) {
	const state = goalStateForSession(ctx);
	state.goalReviewLive = live;
	return (
		syncGoalReviewSurfaces(state, ctx, goal, {
			expectedGeneration,
			completionCursor,
		}).kind === "saved"
	);
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
	if (goal.artifactPlanDisplayPath || goal.artifactStateDisplayPath)
		return {
			planPath: goal.artifactPlanDisplayPath,
			recordSection: "Handoff",
			stateFile: goal.artifactStateDisplayPath,
		};
	const flow = flowContext(ctx);
	if (!flow) return {};
	return {
		planPath: `.flow/${flow.flow.id}/${flow.plan.file}`,
		recordSection: "Handoff",
		stateFile: "flow.json",
	};
}

function sendResumePrompt(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goal: ActiveGoal,
	options?: { allowRepairShortPrompt?: boolean },
) {
	const pending = pendingAdvisorForPrompt(ctx);
	const cursor = completionCursorQuiet(ctx, goal);
	// 短提示仅用户 /flow go 路径；网络重试耗尽后的自动恢复仍走完整 resume。
	const repair =
		options?.allowRepairShortPrompt === true &&
		(cursor === "acceptance_repair" || cursor === "quality_repair");
	const sent = sendRuntimePrompt(
		pi,
		ctx,
		buildResumePrompt(
			goal,
			goalTodoPromptContext(ctx, goal),
			pending?.advice.advice,
			repair ? { repair: true } : undefined,
		),
		{
			language: goal.language,
			hideFromChecks: Boolean(pending),
		},
	);
	if (sent && pending) clearPendingAdvisor(ctx, pending.ref, goal.language);
	return sent;
}

function sendContinuationPrompt(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goal: ActiveGoal,
	closureReminder?: string,
) {
	const state = goalStateForSession(ctx);
	if (state.continuationPending?.goalId === goal.id || hasPendingMessages(ctx))
		return false;
	const marker = continuationMarker(goal);
	const pending = pendingAdvisorForPrompt(ctx);
	const reminder = [
		pending
			? manualAdvisorDirection(pending.advice.advice, goal.language)
			: undefined,
		closureReminder ?? todoStalenessReminder(ctx, state, goal),
	]
		.filter(Boolean)
		.join("\n\n");
	const prompt = buildContinuePrompt(
		goal,
		marker,
		goalTodoPromptContext(ctx, goal),
		reminder || undefined,
	);
	state.continuationPending = {
		goalId: goal.id,
		iteration: goal.iteration,
		marker,
		prompt,
	};
	const sent = sendRuntimePrompt(pi, ctx, prompt, {
		deliverAsFollowUp: true,
		language: goal.language,
		hideFromChecks: Boolean(pending),
	});
	if (!sent && state.continuationPending?.marker === marker)
		state.continuationPending = undefined;
	if (sent && pending) clearPendingAdvisor(ctx, pending.ref, goal.language);
	return sent;
}

function pendingAdvisorForPrompt(ctx: StatusContext) {
	const flow = flowContext(ctx);
	const ref = flow?.plan.pendingAdvisor;
	if (!flow || !ref) return undefined;
	const advice = flow.plan.checks[ref.phase].rounds.find(
		(round) => round.round === ref.round,
	)?.advisor;
	return advice ? { ref, advice } : undefined;
}

function clearPendingAdvisor(
	ctx: StatusContext,
	ref: PendingAdvisor,
	language: Language,
) {
	try {
		const owner = flowOwnerForSession(ctx);
		if (!owner) throw new Error("Flow owner not found");
		const cleared = withFlowLockSync(
			owner.dir,
			`deliver manual advisor ${owner.flow.id}`,
			() => {
				const flow = readFlow(owner.dir);
				const current = currentGoal(flow);
				if (
					!current ||
					current.pendingAdvisor?.phase !== ref.phase ||
					current.pendingAdvisor.round !== ref.round
				)
					return;
				const goals = flow.goals.map((goal, index) =>
					index === flow.currentGoal ? { ...goal, pendingAdvisor: null } : goal,
				);
				return writeFlow(owner.dir, { ...flow, goals });
			},
		);
		if (!cleared.ok)
			throw new Error(flowLockBusyMessage(cleared.owner, language));
		if (cleared.value)
			publishFlowReportProjection(ctx, owner.dir, cleared.value, language);
	} catch (error) {
		notifyUser(
			ctx,
			language === "en"
				? formatUserNotice("⚠️", "Advisor delivery state save failed", [
						formatError(error),
					])
				: formatUserNotice("⚠️", "顾问建议投递状态保存失败", [
						formatError(error),
					]),
			"info",
			language,
		);
	}
}

function sendRuntimePrompt(
	pi: ExtensionAPI,
	ctx: StatusContext,
	prompt: string,
	options: {
		deliverAsFollowUp?: boolean;
		language?: Language;
		hideFromChecks?: boolean;
	} = {},
) {
	const language = options.language ?? runtimeLanguage();
	return sendOrchestrationPrompt(pi, ctx, prompt, {
		customType: options.hideFromChecks
			? ADVISOR_DIRECTION_PROMPT_TYPE
			: "pi-flow-goal-prompt",
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
		goal.language === "en" ? "acceptance" : "验收",
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
				flame: true,
				title: `🌊 Flow · ${label}`,
				rows: flowActivityRows(flow, goal),
			}
		: {
				language: goal.language,
				flame: true,
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
		flame: true,
		title: `${flowContext(ctx) ? "💯 Flow" : goal.language === "en" ? "💯 Goal" : "💯 目标"} · ${goalActivityPhaseLabel(phase, goal.language)}`,
		rows: activityRows(
			goalReviewActivityRows(ctx, goal),
			goal.language === "en"
				? `Repairing ${roundLabel(phase.round, goal.language)} quality feedback`
				: `正在修复${roundLabel(phase.round, goal.language)}质检反馈`,
		),
	};
}

/** 重启后真实状态：没有任何检查或模型在跑，不显示火焰，给出恢复入口。 */
function interruptedGoalActivity(ctx: StatusContext, goal: ActiveGoal) {
	const flow = flowContext(ctx);
	const phase = goal.language === "en" ? "interrupted" : "已中断";
	const resume = quoteCommand(goalResumeCommand(ctx));
	const next = goal.language === "en" ? `Next: ${resume}` : `下一步：${resume}`;
	return {
		language: goal.language,
		title: flow
			? `🌊 Flow · ${phase}`
			: `${goal.language === "en" ? "🎯 Goal" : "🎯 目标"} · ${phase}`,
		rows: activityRows(flow ? flowActivityRows(flow, goal) : goal.text, next),
	};
}

/**
 * 重启恢复：先统一展示真实「已中断」状态（此刻没有任何检查或模型在跑）；
 * 检查/收口阶段（*_retry / finalize）再自动续跑，启动后自然覆盖中断框；
 * 修复/执行阶段不自动触发模型，保留中断框与恢复入口。
 */
function scheduleGoalRestartRecovery(
	ctx: StatusContext,
	state: GoalRuntimeState,
) {
	const goal = state.activeGoal;
	if (!goal || goal.status !== "active") return;
	if (isPrivateWorkerProcess()) return;
	setGoalActivityBox(ctx, interruptedGoalActivity(ctx, goal));
	const cursor = completionCursorQuiet(ctx, goal);
	if (
		cursor === "acceptance_retry" ||
		cursor === "quality_retry" ||
		cursor === "finalize_retry"
	) {
		const goalId = goal.id;
		setImmediate(() => {
			void resumeGoalCheckAfterRestart(ctx, goalId);
		});
		return;
	}
	// 修复/执行阶段不自动续跑：记录中断事实，需要用户 /flow go 接管。
	setFlowAttention(ctx, {
		kind: "interrupted",
		message:
			goal.language === "en"
				? "Session interrupted mid-execution; the step did not finish"
				: "会话在执行中断，步骤未完成",
	});
}

async function resumeGoalCheckAfterRestart(ctx: StatusContext, goalId: string) {
	const state = goalStateForSession(ctx);
	const goal = state.activeGoal;
	if (!goal || goal.id !== goalId || goal.status !== "active") {
		if (state.pendingCheckResumeGoalId === goalId)
			state.pendingCheckResumeGoalId = undefined;
		return;
	}
	if ((ctx.isIdle && !ctx.isIdle()) || hasPendingMessages(ctx)) {
		state.pendingCheckResumeGoalId = goalId;
		return;
	}
	state.pendingCheckResumeGoalId = undefined;
	try {
		await continueActiveGoalFromCheckpoint(ctx);
	} catch (error) {
		notifyUser(
			ctx,
			acceptanceStartFailedNotice(goal.language, notifyError(error)),
			"info",
			goal.language,
		);
	}
}

function completionCursorQuiet(
	ctx: StatusContext,
	goal: ActiveGoal,
): CompletionCursor | undefined {
	try {
		if (goal.artifactStatePath)
			return readGoalRuntimeState(goal).completionCursor;
		return flowContext(ctx)?.plan.completionCursor;
	} catch {
		return undefined;
	}
}

function pausedGoalActivity(
	ctx: StatusContext,
	goal: ActiveGoal,
	pendingReason?: string,
) {
	const flow = flowContext(ctx);
	const takeoverReason =
		pendingReason ??
		(goal.status === "paused" &&
		flow?.flow.attention?.kind === "user_action_required"
			? flow.flow.attention.message
			: undefined);
	const phase =
		goal.status === "budget_limited"
			? goal.language === "en"
				? "budget limited"
				: "预算受限"
			: takeoverReason
				? goal.language === "en"
					? "waiting for your action"
					: "等待你接管"
				: goal.language === "en"
					? "paused"
					: "已暂停";
	const resume = quoteCommand(goalResumeCommand(ctx));
	const clear = quoteCommand(goalClearCommand(ctx));
	const next = flow
		? goal.language === "en"
			? `Next: ${resume}`
			: `下一步：${resume}`
		: goal.language === "en"
			? `Next: ${resume} · ${clear}`
			: `下一步：${resume} · ${clear}`;
	const controls =
		goal.status === "budget_limited"
			? [
					goal.language === "en"
						? `Budget: ${formatBudget(goal)}`
						: `预算：${formatBudget(goal)}`,
					next,
				]
			: takeoverReason
				? [
						goal.language === "en"
							? `To do: ${takeoverReason}`
							: `待办：${takeoverReason}`,
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
		flow.flow.goals.length === 1
			? undefined
			: goal.language === "en"
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
			language === "en" ? "quality fix" : "优化中",
			language,
		);
	if (phase.kind === "waitingQuality")
		return language === "en" ? "waiting for quality check" : "等待质检";
	return language === "en" ? "running" : "执行中";
}

function goalStatusPhase(goal: ActiveGoal) {
	const phase = goalUiPhase(goal);
	if (phase.kind === "waitingQuality")
		return goal.language === "en"
			? "waiting for quality check"
			: "等待质检收口";
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

/**
 * 修订仲裁基线：flow.json 持久化的步骤启动快照，跨进程、跨重启不可漂白。
 * 串行取归属 Flow 的当前步骤；并行 worker 从自身 artifact 所在 Flow 目录只读对应步骤。
 */
function goalPlanBaseline(
	ctx: StatusContext,
	goal: ActiveGoal,
): string | undefined {
	if (goal.artifactStatePath) {
		const index = Number(goal.artifactId?.slice(1)) - 1;
		if (!Number.isInteger(index) || index < 0) return undefined;
		return (
			tryReadFlow(dirname(goal.artifactStatePath))?.goals[index]?.snapshot ??
			undefined
		);
	}
	return flowContext(ctx)?.plan.snapshot ?? undefined;
}

function planChangeNoteFor(
	ctx: StatusContext,
	goal: ActiveGoal,
): string | undefined {
	const baseline = goalPlanBaseline(ctx, goal);
	if (baseline === undefined) return undefined;
	const current = goalPlanEvidence(ctx, goal)?.text ?? undefined;
	if (current === undefined) return undefined;
	const diff = planRevisionDiff(baseline, current);
	return diff ? planChangeNote(diff, goal.language) : undefined;
}

function toolResultWritesPath(
	input: Record<string, unknown>,
	ctx: StatusContext,
	planPath: string,
) {
	return (
		typeof input.path === "string" &&
		resolve(ctx.cwd, input.path) === resolve(ctx.cwd, planPath)
	);
}

function activeGoalPlanPath(ctx: StatusContext, goal: ActiveGoal) {
	if (goal.artifactPlanPath) return goal.artifactPlanPath;
	const flow = flowContext(ctx);
	return flow ? join(flow.dir, flow.plan.file) : undefined;
}

function flowCheckboxAttributionTarget(
	ctx: StatusContext,
	goal: ActiveGoal,
): FlowCheckboxAttributionTarget | undefined {
	if (goal.artifactStatePath) return undefined;
	const flow = flowContext(ctx);
	return flow
		? {
				flowId: flow.flow.id,
				goalIndex: flow.plan.index,
				goalFile: flow.plan.file,
			}
		: undefined;
}

interface PlanTextReplacement {
	start: number;
	end: number;
	text: string;
}

interface AppliedPlanReplacement {
	beforeStart: number;
	beforeEnd: number;
	afterStart: number;
	afterEnd: number;
}

interface AppliedPlanEdit {
	text: string;
	replacements: AppliedPlanReplacement[];
}

interface CheckboxStatePair {
	before?: PlanCheckboxState;
	after?: PlanCheckboxState;
}

function precisePlanEditRequired(language: Language) {
	return language === "en"
		? "Update the active Flow plan with a unique, non-overlapping precise edit; do not rewrite the file."
		: "请用唯一、互不重叠的精确 edit 更新当前 Flow 计划，禁止重写整个文件。";
}

function applyExactPlanEdit(
	beforeText: string,
	input: Record<string, unknown>,
): AppliedPlanEdit | undefined {
	if (!Array.isArray(input.edits) || input.edits.length === 0) return undefined;
	const before = normalizeLineEndings(beforeText);
	const replacements: PlanTextReplacement[] = [];
	for (const value of input.edits) {
		if (!value || typeof value !== "object") return undefined;
		const edit = value as { oldText?: unknown; newText?: unknown };
		if (typeof edit.oldText !== "string" || typeof edit.newText !== "string")
			return undefined;
		const oldText = normalizeLineEndings(edit.oldText);
		if (!oldText) return undefined;
		const start = before.indexOf(oldText);
		if (start < 0 || before.indexOf(oldText, start + oldText.length) >= 0)
			return undefined;
		const replacement = {
			start,
			end: start + oldText.length,
			text: normalizeLineEndings(edit.newText),
		};
		if (
			replacements.some(
				(current) =>
					replacement.start < current.end && replacement.end > current.start,
			)
		)
			return undefined;
		replacements.push(replacement);
	}
	const ordered = replacements.sort((left, right) => left.start - right.start);
	let shift = 0;
	const applied = ordered.map((replacement) => {
		const afterStart = replacement.start + shift;
		const afterEnd = afterStart + replacement.text.length;
		shift += replacement.text.length - (replacement.end - replacement.start);
		return {
			beforeStart: replacement.start,
			beforeEnd: replacement.end,
			afterStart,
			afterEnd,
		};
	});
	let after = before;
	for (let index = ordered.length - 1; index >= 0; index -= 1) {
		const replacement = ordered[index];
		after = `${after.slice(0, replacement.start)}${replacement.text}${after.slice(replacement.end)}`;
	}
	return after === before ? undefined : { text: after, replacements: applied };
}

function normalizeLineEndings(text: string) {
	return text.replace(/\r\n?/gu, "\n");
}

function changedCheckboxPairs(
	beforeText: string,
	edit: AppliedPlanEdit,
): CheckboxStatePair[] {
	const before = planCheckboxStates(normalizeLineEndings(beforeText));
	const after = planCheckboxStates(edit.text);
	const matchedBefore = new Set<PlanCheckboxState>();
	const matchedAfter = new Set<PlanCheckboxState>();
	const pairs: CheckboxStatePair[] = [];
	const afterByStart = new Map(after.map((state) => [state.start, state]));

	for (const state of before) {
		if (replacementSignature(state, edit.replacements, "before")) continue;
		const next = afterByStart.get(
			mappedPlanOffset(state.start, edit.replacements),
		);
		if (!next) continue;
		pairCheckboxStates(state, next, pairs, matchedBefore, matchedAfter);
	}
	const positionRequiredIdentities = pairCheckboxStatesByReplacementPosition(
		before,
		after,
		edit.replacements,
		pairs,
		matchedBefore,
		matchedAfter,
	);
	pairUniqueCheckboxStates(
		before,
		after,
		pairs,
		matchedBefore,
		matchedAfter,
		positionRequiredIdentities,
	);
	pairRenamedCheckboxStates(
		before,
		after,
		edit.replacements,
		pairs,
		matchedBefore,
		matchedAfter,
	);

	return [
		...pairs.filter(
			(pair) =>
				pair.before &&
				pair.after &&
				checkboxStateChanged(pair.before, pair.after),
		),
		...before
			.filter((state) => !matchedBefore.has(state))
			.map((state) => ({ before: state })),
		...after
			.filter((state) => !matchedAfter.has(state))
			.map((state) => ({ after: state })),
	];
}

function pairCheckboxStatesByReplacementPosition(
	before: PlanCheckboxState[],
	after: PlanCheckboxState[],
	replacements: AppliedPlanReplacement[],
	pairs: CheckboxStatePair[],
	matchedBefore: Set<PlanCheckboxState>,
	matchedAfter: Set<PlanCheckboxState>,
) {
	const evidence = mixedStatusReplacementEvidence(
		before,
		after,
		replacements,
		matchedBefore,
		matchedAfter,
	);
	pairUniqueCheckboxGroups(
		unmatchedCheckboxesByReplacementPosition(
			before,
			replacements,
			"before",
			matchedBefore,
			evidence.mixedIdentities,
		),
		unmatchedCheckboxesByReplacementPosition(
			after,
			replacements,
			"after",
			matchedAfter,
			evidence.mixedIdentities,
		),
		pairs,
		matchedBefore,
		matchedAfter,
	);
	return evidence.positionRequiredIdentities;
}

function pairUniqueCheckboxStates(
	before: PlanCheckboxState[],
	after: PlanCheckboxState[],
	pairs: CheckboxStatePair[],
	matchedBefore: Set<PlanCheckboxState>,
	matchedAfter: Set<PlanCheckboxState>,
	excludedIdentities: Set<string>,
) {
	pairUniqueCheckboxGroups(
		unmatchedCheckboxesByIdentity(before, matchedBefore, excludedIdentities),
		unmatchedCheckboxesByIdentity(after, matchedAfter, excludedIdentities),
		pairs,
		matchedBefore,
		matchedAfter,
	);
}

function pairUniqueCheckboxGroups(
	before: Map<string, PlanCheckboxState[]>,
	after: Map<string, PlanCheckboxState[]>,
	pairs: CheckboxStatePair[],
	matchedBefore: Set<PlanCheckboxState>,
	matchedAfter: Set<PlanCheckboxState>,
) {
	for (const [identity, candidates] of before) {
		const matches = after.get(identity);
		if (candidates.length !== 1 || matches?.length !== 1) continue;
		pairCheckboxStates(
			candidates[0],
			matches[0],
			pairs,
			matchedBefore,
			matchedAfter,
		);
	}
}

function mixedStatusReplacementEvidence(
	before: PlanCheckboxState[],
	after: PlanCheckboxState[],
	replacements: AppliedPlanReplacement[],
	matchedBefore: Set<PlanCheckboxState>,
	matchedAfter: Set<PlanCheckboxState>,
) {
	const statuses = new Map<string, Set<string>>();
	const beforeCounts = new Map<string, number>();
	const afterCounts = new Map<string, number>();
	const collect = (
		states: PlanCheckboxState[],
		side: "before" | "after",
		matched: Set<PlanCheckboxState>,
		counts: Map<string, number>,
	) => {
		for (const state of states) {
			if (
				matched.has(state) ||
				!replacementSignature(state, replacements, side)
			)
				continue;
			const identity = checkboxTextIdentity(state);
			const values = statuses.get(identity) ?? new Set();
			values.add(state.status);
			statuses.set(identity, values);
			counts.set(identity, (counts.get(identity) ?? 0) + 1);
		}
	};
	collect(before, "before", matchedBefore, beforeCounts);
	collect(after, "after", matchedAfter, afterCounts);
	const mixedIdentities = new Set(
		[...statuses].flatMap(([identity, values]) =>
			values.size > 1 ? [identity] : [],
		),
	);
	return {
		mixedIdentities,
		positionRequiredIdentities: new Set(
			[...mixedIdentities].filter(
				(identity) => beforeCounts.get(identity) === afterCounts.get(identity),
			),
		),
	};
}

function unmatchedCheckboxesByReplacementPosition(
	states: PlanCheckboxState[],
	replacements: AppliedPlanReplacement[],
	side: "before" | "after",
	matched: Set<PlanCheckboxState>,
	allowedIdentities: Set<string>,
) {
	const groups = new Map<string, PlanCheckboxState[]>();
	for (const state of states) {
		if (matched.has(state)) continue;
		const textIdentity = checkboxTextIdentity(state);
		if (!allowedIdentities.has(textIdentity)) continue;
		const positions = replacements.flatMap((replacement, index) => {
			if (!replacementTouchesCheckbox(replacement, state, side)) return [];
			const start =
				side === "before" ? replacement.beforeStart : replacement.afterStart;
			return [`${index}:${state.start - start}`];
		});
		if (positions.length === 0) continue;
		const checkboxStatus = state.status;
		const identity = `${textIdentity}\u0000${checkboxStatus}\u0000${positions.join(",")}`;
		const group = groups.get(identity) ?? [];
		group.push(state);
		groups.set(identity, group);
	}
	return groups;
}

function unmatchedCheckboxesByIdentity(
	states: PlanCheckboxState[],
	matched: Set<PlanCheckboxState>,
	excludedIdentities: Set<string>,
) {
	const groups = new Map<string, PlanCheckboxState[]>();
	for (const state of states) {
		if (matched.has(state)) continue;
		const textIdentity = checkboxTextIdentity(state);
		if (excludedIdentities.has(textIdentity)) continue;
		const checkboxStatus = state.status;
		const identity = `${textIdentity}\u0000${checkboxStatus}`;
		const group = groups.get(identity) ?? [];
		group.push(state);
		groups.set(identity, group);
	}
	return groups;
}

function checkboxTextIdentity(state: PlanCheckboxState) {
	return `${state.section}\u0000${state.text}`;
}

function pairRenamedCheckboxStates(
	before: PlanCheckboxState[],
	after: PlanCheckboxState[],
	replacements: AppliedPlanReplacement[],
	pairs: CheckboxStatePair[],
	matchedBefore: Set<PlanCheckboxState>,
	matchedAfter: Set<PlanCheckboxState>,
) {
	const beforeByReplacement = unmatchedCheckboxesByReplacement(
		before,
		replacements,
		"before",
		matchedBefore,
	);
	const afterByReplacement = unmatchedCheckboxesByReplacement(
		after,
		replacements,
		"after",
		matchedAfter,
	);
	for (const [signature, previous] of beforeByReplacement) {
		const next = afterByReplacement.get(signature);
		if (previous.length !== 1 || next?.length !== 1) continue;
		pairCheckboxStates(
			previous[0],
			next[0],
			pairs,
			matchedBefore,
			matchedAfter,
		);
	}
}

function unmatchedCheckboxesByReplacement(
	states: PlanCheckboxState[],
	replacements: AppliedPlanReplacement[],
	side: "before" | "after",
	matched: Set<PlanCheckboxState>,
) {
	const groups = new Map<string, PlanCheckboxState[]>();
	for (const state of states) {
		if (matched.has(state)) continue;
		const signature = replacementSignature(state, replacements, side);
		if (!signature) continue;
		const group = groups.get(signature) ?? [];
		group.push(state);
		groups.set(signature, group);
	}
	return groups;
}

function pairCheckboxStates(
	before: PlanCheckboxState,
	after: PlanCheckboxState,
	pairs: CheckboxStatePair[],
	matchedBefore: Set<PlanCheckboxState>,
	matchedAfter: Set<PlanCheckboxState>,
) {
	if (matchedBefore.has(before) || matchedAfter.has(after)) return;
	matchedBefore.add(before);
	matchedAfter.add(after);
	pairs.push({ before, after });
}

function replacementSignature(
	state: PlanCheckboxState,
	replacements: AppliedPlanReplacement[],
	side: "before" | "after",
) {
	return replacements
		.flatMap((replacement, index) =>
			replacementTouchesCheckbox(replacement, state, side) ? [index] : [],
		)
		.join(",");
}

function replacementTouchesCheckbox(
	replacement: AppliedPlanReplacement,
	state: PlanCheckboxState,
	side: "before" | "after",
) {
	const start =
		side === "before" ? replacement.beforeStart : replacement.afterStart;
	const end = side === "before" ? replacement.beforeEnd : replacement.afterEnd;
	if (start === end) return state.start < start && start <= state.end;
	return start < state.end && end > state.start;
}

function mappedPlanOffset(
	offset: number,
	replacements: AppliedPlanReplacement[],
) {
	let mapped = offset;
	for (const replacement of replacements) {
		if (replacement.beforeEnd > offset) break;
		mapped +=
			replacement.afterEnd -
			replacement.afterStart -
			(replacement.beforeEnd - replacement.beforeStart);
	}
	return mapped;
}

function checkboxStateChanged(
	before: PlanCheckboxState,
	after: PlanCheckboxState,
) {
	return before.status !== after.status || before.key !== after.key;
}

function queueCheckboxAttributionSync(
	state: GoalRuntimeState,
	ctx: StatusContext,
	commit: FlowCheckboxAttributionCommit,
) {
	const key = checkboxAttributionTargetKey(commit);
	const index = state.pendingCheckboxAttributions.findIndex(
		(pending) => checkboxAttributionTargetKey(pending) === key,
	);
	const pending: PendingCheckboxAttribution =
		index < 0
			? { ...commit, lockNoticeSent: false }
			: {
					...state.pendingCheckboxAttributions[index],
					changes: [
						...state.pendingCheckboxAttributions[index].changes,
						...commit.changes,
					],
				};
	state.pendingCheckboxAttributions =
		index < 0
			? [...state.pendingCheckboxAttributions, pending]
			: state.pendingCheckboxAttributions.map((current, currentIndex) =>
					currentIndex === index ? pending : current,
				);
	persistCheckboxAttributionOutbox(state, ctx);
}

function flushPendingCheckboxAttribution(
	state: GoalRuntimeState,
	ctx: StatusContext,
) {
	const remaining: PendingCheckboxAttribution[] = [];
	const lockedDirs = new Set<string>();
	let outboxChanged = false;
	for (const pending of state.pendingCheckboxAttributions) {
		const result = syncGoalCheckboxAttribution(ctx, pending);
		if (result.kind === "saved") {
			outboxChanged = true;
			continue;
		}
		if (result.kind !== "locked") {
			remaining.push(pending);
			continue;
		}
		lockedDirs.add(result.dir);
		if (pending.lockNoticeSent) {
			remaining.push(pending);
			continue;
		}
		notifyUser(
			ctx,
			flowLockBusyMessage(result.owner, pending.language),
			"info",
			pending.language,
		);
		remaining.push({ ...pending, lockNoticeSent: true });
	}
	state.pendingCheckboxAttributions = remaining;
	reconcileCheckboxAttributionLockWatchers(state, ctx, lockedDirs);
	if (outboxChanged) persistCheckboxAttributionOutbox(state, ctx);
}

function reconcileCheckboxAttributionLockWatchers(
	state: GoalRuntimeState,
	ctx: StatusContext,
	lockedDirs: Set<string>,
) {
	for (const [dir, close] of state.checkboxAttributionLockWatchers) {
		if (lockedDirs.has(dir)) continue;
		close();
		state.checkboxAttributionLockWatchers.delete(dir);
	}
	for (const dir of lockedDirs) {
		if (state.checkboxAttributionLockWatchers.has(dir)) continue;
		try {
			const close = watchFlowLockRelease(dir, () => {
				state.checkboxAttributionLockWatchers.delete(dir);
				flushPendingCheckboxAttribution(state, ctx);
			});
			state.checkboxAttributionLockWatchers.set(dir, close);
		} catch {
			// 生命周期事件与 session_start 仍会重试 durable outbox。
		}
	}
}

function closeCheckboxAttributionLockWatchers(state: GoalRuntimeState) {
	for (const close of state.checkboxAttributionLockWatchers.values()) close();
	state.checkboxAttributionLockWatchers.clear();
}

function persistCheckboxAttributionOutbox(
	state: GoalRuntimeState,
	ctx: StatusContext,
) {
	appendCustomEntry<CheckboxAttributionOutboxEntry>(
		ctx,
		goalRuntimeState.extensionApi,
		CHECKBOX_ATTRIBUTION_OUTBOX_ENTRY_TYPE,
		{ pending: state.pendingCheckboxAttributions },
	);
}

function loadCheckboxAttributionOutbox(
	ctx: StatusContext,
): PendingCheckboxAttribution[] {
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
			(item) =>
				item.type === "custom" &&
				item.customType === CHECKBOX_ATTRIBUTION_OUTBOX_ENTRY_TYPE,
		)
		.pop();
	const data = entry?.data as CheckboxAttributionOutboxEntry | undefined;
	return Array.isArray(data?.pending) ? data.pending : [];
}

function checkboxAttributionTargetKey(target: FlowCheckboxAttributionTarget) {
	return `${target.flowId}\u0000${target.goalIndex}\u0000${target.goalFile}`;
}

/** 成功 edit 的调用级快照只归因该操作本身；新增、删除与改文均按替换范围迁移。 */
function recordCheckboxAttribution(
	pi: Pick<ExtensionAPI, "getThinkingLevel">,
	ctx: ExtensionContext,
	state: GoalRuntimeState,
	beforeText: string,
	input: Record<string, unknown>,
): { goal: ActiveGoal; changes: CheckboxAttributionChange[] } | undefined {
	const goal = state.activeGoal;
	if (!goal || goal.status !== "active") return undefined;
	const edit = applyExactPlanEdit(beforeText, input);
	if (!edit) return undefined;
	const pairs = changedCheckboxPairs(beforeText, edit);
	if (pairs.length === 0) return undefined;
	const previous = goal.checkAttribution ?? {};
	const attribution = { ...previous };
	let changed = false;

	for (const pair of pairs) {
		const before = pair.before;
		if (before?.status !== "x" || !before.key) continue;
		if (pair.after?.status === "x" && pair.after.key === before.key) continue;
		if (before.key in attribution) {
			delete attribution[before.key];
			changed = true;
		}
	}
	for (const pair of pairs) {
		const before = pair.before;
		const after = pair.after;
		if (
			before?.status !== "x" ||
			after?.status !== "x" ||
			!before.key ||
			!after.key ||
			before.key === after.key
		)
			continue;
		const prior = previous[before.key];
		if (prior) {
			attribution[after.key] = prior;
			changed = true;
		}
	}
	const completedKeys = pairs.flatMap((pair) =>
		pair.before?.status !== "x" && pair.after?.status === "x" && pair.after.key
			? [pair.after.key]
			: [],
	);
	const attributor =
		completedKeys.length > 0 ? currentSessionModel(pi, ctx) : undefined;
	if (attributor) {
		const at = Date.now();
		for (const key of completedKeys) {
			attribution[key] = {
				model: attributor.model,
				thinking: attributor.thinking,
				at,
			};
			changed = true;
		}
	}
	if (!changed) return undefined;
	const changes = checkboxAttributionChanges(previous, attribution);
	if (changes.length === 0) return undefined;
	const attributedGoal = { ...goal, checkAttribution: attribution };
	state.activeGoal = attributedGoal;
	persistGoal(attributedGoal, ctx);
	return { goal: attributedGoal, changes };
}

function checkboxAttributionChanges(
	before: Record<string, CheckboxAttribution>,
	after: Record<string, CheckboxAttribution>,
): CheckboxAttributionChange[] {
	return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(
		(key) => {
			const previous = before[key];
			const next = after[key];
			if (checkboxAttributionValueEqual(previous, next)) return [];
			return [
				{
					key,
					...(previous ? { before: previous } : {}),
					...(next ? { after: next } : {}),
				},
			];
		},
	);
}

function checkboxAttributionValueEqual(
	left: CheckboxAttribution | undefined,
	right: CheckboxAttribution | undefined,
) {
	return (
		left?.model === right?.model &&
		left?.thinking === right?.thinking &&
		left?.at === right?.at
	);
}

/**
 * 验收前收口闸门：计划仍有 [ ]/[~] 时先把执行模型顶回去收口，每个验收轮最多一次；
 * 闸门状态只在内存，重启后最多多拦一次，无害且自愈。
 * 发现未收口项后一律不放行验收：排队消息/待投延续会驱动下一回合，推迟验收且不消耗闸门；
 * 真实发送失败时通知并请求接管，「/flow go」重试闸门。
 */
function gateAcceptanceOnOpenTodos(
	ctx: StatusContext,
	goal: ActiveGoal,
): boolean {
	const state = goalStateForSession(ctx);
	const round = goal.stateReviewRounds + 1;
	if (state.todoGate?.goalId === goal.id && state.todoGate.round >= round)
		return false;
	const planText = goalPlanEvidence(ctx, goal)?.text;
	if (!planText) return false;
	const items = unfinishedCheckboxItems(planText);
	if (items.length === 0) return false;
	if (state.continuationPending?.goalId === goal.id || hasPendingMessages(ctx))
		return true;
	const pi = goalRuntimeState.extensionApi;
	const reminder = todoClosureReminder(
		items,
		goalTodoPromptContext(ctx, goal).recordSection ?? "Outcome",
		goal.language,
	);
	if (!pi || !sendContinuationPrompt(pi, ctx, goal, reminder)) {
		notifyUser(
			ctx,
			todoGateSendFailedNotice(goal.language),
			"info",
			goal.language,
		);
		const message =
			goal.language === "en"
				? "Closure reminder delivery failed; run /flow go to retry"
				: "收口提醒发送失败，用 /flow go 重试";
		// worker：单写者约束，经自身 artifact 的 paused+handoff 收口并退出，父控制台提交 attention；「/flow go」恢复 lane 后闸门重试。
		if (goal.artifactStatePath) {
			commitGoalPause(ctx, goal, {
				kind: "user_action_required",
				message,
			});
			return true;
		}
		// 串行：异常事实落盘单一状态源；「/flow go」推进前统一清空，闸门成功重投时也自清。
		setFlowAttention(ctx, { kind: "system_error", message });
		state.todoGateAttentionGoalId = goal.id;
		requestGoalAttention(goal.id);
		return true;
	}
	if (state.todoGateAttentionGoalId === goal.id) {
		setFlowAttention(ctx, null);
		state.todoGateAttentionGoalId = undefined;
	}
	state.todoGate = { goalId: goal.id, round };
	return true;
}

function todoGateSendFailedNotice(language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Closure reminder delivery failed", [
				"Acceptance is deferred because the plan still has open checkboxes",
				"Run /flow go to retry when the session is idle",
			])
		: formatUserNotice("⚠️", "收口提醒发送失败", [
				"计划仍有未收口 checkbox，验收已推迟",
				"会话空闲后用 /flow go 重试",
			]);
}

function todoStalenessReminder(
	ctx: StatusContext,
	state: GoalRuntimeState,
	goal: ActiveGoal,
): string | undefined {
	if (!state.turnFileWrites) return undefined;
	if (state.planCheckboxBaseline === undefined) return undefined;
	const signature = planCheckboxSignature(
		goalPlanEvidence(ctx, goal)?.text ?? undefined,
	);
	if (signature === undefined) return undefined;
	return signature === state.planCheckboxBaseline
		? todoUpdateReminder(goal.language)
		: undefined;
}

function goalPlanEvidence(
	ctx: StatusContext,
	goal: ActiveGoal,
): PlanEvidence | undefined {
	if (goal.artifactPlanPath)
		return readPlanEvidence(
			goal.artifactPlanPath,
			goal.artifactPlanDisplayPath ?? goal.artifactPlanPath,
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
	const flow = flowContext(ctx);
	if (flow?.flow.goals.length === 1) return false;
	return Boolean(flow) || round > 1;
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
	return value.length > 160 ? `${value.slice(0, 157)}…` : value;
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

function clearPersistedGoal(ctx?: StatusContext) {
	clearPersistedGoalEntry(ctx, goalRuntimeState.extensionApi);
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
	const goal = data?.goal;
	return isGoal(goal) && goal.status !== "complete" ? goal : undefined;
}

function clearActiveGoal(ctx: StatusContext) {
	const state = goalStateForSession(ctx);
	setFlowActivity("goal", false);
	setGoalActivityBox(ctx, undefined);
	cancelGoalRecoveryTimers(state, { resetAutoResumeUse: true });
	cancelContinuationPending(state);
	cancelCompletionAudit(state);
	state.activeGoal = undefined;
	clearPersistedGoal(ctx);
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
	if (!isRecord(value)) return false;
	const goal = value as Partial<ActiveGoal>;
	return (
		typeof goal.id === "string" &&
		typeof goal.text === "string" &&
		(goal.language === "zh" || goal.language === "en") &&
		["active", "paused", "budget_limited", "complete"].includes(
			String(goal.status),
		) &&
		typeof goal.startedAt === "number" &&
		typeof goal.updatedAt === "number" &&
		typeof goal.iteration === "number" &&
		Number.isInteger(goal.stateReviewRounds) &&
		Number.isInteger(goal.consecutiveCheckFailures) &&
		Array.isArray(goal.stateReviewHistory) &&
		Array.isArray(goal.qualityReviewHistory) &&
		(goal.stateReviewStartedAt === undefined ||
			typeof goal.stateReviewStartedAt === "number") &&
		(goal.tokenBudget === undefined || typeof goal.tokenBudget === "number") &&
		typeof goal.tokensUsed === "number" &&
		typeof goal.timeUsedSeconds === "number" &&
		typeof goal.baselineTokens === "number" &&
		typeof goal.stepStartedAt === "number" &&
		hasCurrentArtifactShape(goal)
	);
}

function hasCurrentArtifactShape(goal: Partial<ActiveGoal>) {
	const fields = [
		goal.artifactId,
		goal.artifactPlanPath,
		goal.artifactPlanDisplayPath,
		goal.artifactStatePath,
		goal.artifactStateDisplayPath,
	];
	if (fields.every((field) => field === undefined)) return true;
	return fields.every((field) => typeof field === "string" && field.length > 0);
}
