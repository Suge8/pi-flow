import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { auditGoalCompletion, type GoalAuditResult } from "../auditor.js";
import { writeFlowHtml } from "../flow/html.js";
import { currentSessionFile, flowOwnerForSession } from "../flow/ownership.js";
import { rememberFlowContext } from "../flow/runtime.js";
import { currentGoal, writeFlow } from "../flow/store.js";
import { clip, requireFlowStartedAt } from "../flow/util.js";
import { planSnapshotHash } from "../plan/snapshot.js";
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
import {
	appendVisibleUserInput,
	sendOrchestrationPrompt,
} from "../shared/internal-prompt.js";
import { runtimeLanguage } from "../shared/language.js";
import type { PlanEvidence } from "../shared/plan-evidence.js";
import {
	elapsedLabel,
	flowScope,
	flowStepLabel,
	GOAL_SCOPE,
	roundLabel,
	roundTitle,
} from "../shared/progress-labels.js";
import { liveReportUrl } from "../shared/report-server.js";
import {
	registerResultCardRenderer,
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
	formatDuration,
	setStatusSafe,
	startElapsedStatus,
} from "../shared/status.js";
import {
	installLocalizedUi,
	localizeUserText,
	notifyUser,
	setStatusText,
} from "../shared/ui-language.js";
import { handleGoalCommand } from "./command.js";
import {
	clearGoalGeneration,
	consumeGoalClarificationInput,
	handleGoalGenerationEnd,
	showGoalGenerationStatus,
} from "./generation.js";
import {
	goalArtifactStatusLabel,
	writeGoalErrorHtml,
	writeGoalHtml,
} from "./html.js";
import {
	artifactChecks,
	cancelStandaloneGoalArtifact as cancelStandaloneGoalArtifactEntry,
	clearPersistedGoal as clearPersistedGoalEntry,
	GOAL_STATE_ENTRY_TYPE,
	type GoalStateEntryData,
	persistGoal as persistGoalEntry,
	saveActiveGoal as saveActiveGoalEntry,
	syncStandaloneGoalArtifact as syncStandaloneGoalArtifactEntry,
} from "./persistence.js";
import {
	buildContinuePrompt,
	buildGoalPrompt,
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
import {
	findGoalArtifact,
	goalPlanPath,
	latestGoalArtifact,
	readGoalArtifact,
	writeGoalArtifact,
} from "./store.js";
import type { CompletionCursor } from "./types.js";

import { objectiveFromPlan, validateGoalDir } from "./validator.js";
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
> &
	Partial<Pick<ExtensionContext, "isIdle" | "hasPendingMessages">> &
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

export { yieldForGoalReviewCard };

export function cancelGoalRecoveryAfterUserAction() {
	cancelGoalRecoveryTimers({ resetAutoResumeUse: true });
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
	extensionApi?: ExtensionAPI;
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

export const goalRuntimeState: GoalRuntimeState = {
	completionAuditGeneration: 0,
	cancelledContinuationMarkers: new Set<string>(),
	websocketLimitRecoveryAt: new Map<string, number>(),
	retryRecoveryGeneration: 0,
	retryAutoResumeUsedGoalIds: new Set<string>(),
};

function resetGoalRuntimeState(pi: ExtensionAPI): void {
	if (goalRuntimeState.completionStatusTimer)
		clearTimeout(goalRuntimeState.completionStatusTimer);
	goalRuntimeState.goalStatusTimer?.stop();
	goalRuntimeState.completionAuditPending?.controller.abort();
	goalRuntimeState.completionAuditPending?.status?.stop();
	goalRuntimeState.activeGoal = undefined;
	goalRuntimeState.completionStatusTimer = undefined;
	goalRuntimeState.goalStatusTimer = undefined;
	goalRuntimeState.extensionApi = pi;
	goalRuntimeState.continuationPending = undefined;
	goalRuntimeState.completionAuditPending = undefined;
	goalRuntimeState.completionAuditGeneration = 0;
	cancelGoalRecoveryTimers({ resetAutoResumeUse: true });
	goalRuntimeState.cancelledContinuationMarkers = new Set<string>();
	goalRuntimeState.websocketLimitRecoveryAt = new Map<string, number>();
	goalRuntimeState.goalReviewLive = undefined;
	goalRuntimeState.scheduledGoalStateReview = undefined;
}

export default function goal(pi: ExtensionAPI) {
	resetGoalRuntimeState(pi);
	registerResultCardRenderer(pi);

	pi.registerCommand("goal", {
		description:
			localizeUserText(
				"生成并执行单会话目标：/goal [需求|path.md] → /goal start [id]",
			) ?? "生成并执行单会话目标：/goal [需求|path.md] → /goal start [id]",
		handler: async (args, ctx) => {
			installLocalizedUi(ctx);
			cancelGoalRecoveryTimers({ resetAutoResumeUse: true });
			return handleGoalCommand(pi, args, ctx, {
				show: showGoal,
				pause: pauseGoal,
				continue: continueGoal,
				cancel: cancelGoal,
				startFromDraft: startGoalFromDraft,
			});
		},
	});

	pi.on("session_start", (_event, ctx) => {
		installFlowActivityFrame(ctx);
		clearContinuationTracking();
		goalRuntimeState.activeGoal = loadGoalFromSession(ctx);
		if (goalRuntimeState.activeGoal && flowContext(ctx))
			rememberFlowContext(ctx);
		if (goalRuntimeState.activeGoal) {
			if (
				goalRuntimeState.activeGoal.status === "active" &&
				goalRuntimeState.activeGoal.artifactDir
			)
				watchGoalPlan(goalRuntimeState.activeGoal.artifactDir);
			updateStatus(ctx, goalRuntimeState.activeGoal);
		} else clearGoalUi(ctx);
		syncGoalStatusTimer(ctx, goalRuntimeState.activeGoal);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		cancelGoalRecoveryTimers();
		if (goalRuntimeState.activeGoal)
			persistGoal(goalRuntimeState.activeGoal, ctx);
		closeGoalPlanWatcher();
		clearContinuationTracking();
		if (goalRuntimeState.activeGoal)
			syncGoalReviewSurfaces(
				goalRuntimeState,
				ctx,
				goalRuntimeState.activeGoal,
			);
		stopGoalStatusTimer();
		clearCompletionStatusTimer();
		setGoalActivityBox(ctx, undefined);
		ctx.ui.setStatus(STATUS_KEY, undefined);
		clearFlowActivities();
	});

	pi.on("input", async (event, ctx) => {
		if (event.source !== "extension") {
			cancelGoalRecoveryTimers({ resetAutoResumeUse: true });
			const action = consumeGoalClarificationInput(event.text, ctx);
			if (action?.kind === "prompt") {
				setGoalActivityBox(ctx, action.activityBox);
				if (action.showUserInput) appendVisibleUserInput(pi, event.text);
				const sent = await sendOrchestrationPrompt(pi, ctx, action.prompt, {
					followUp: true,
					errorPrefix: "计划澄清提示发送失败",
				});
				if (!sent) clearGoalGeneration(ctx);
				return { action: "handled" as const };
			}
			return;
		}
		if (consumeCancelledContinuationPrompt(event.text))
			return { action: "handled" as const };
	});

	pi.on("before_agent_start", (event, ctx) => {
		cancelGoalRecoveryTimers();
		markContinuationDelivered(event.prompt);
		if (
			!goalRuntimeState.activeGoal ||
			goalRuntimeState.activeGoal.status !== "active"
		)
			return;
		const active = goalRuntimeState.activeGoal;
		goalRuntimeState.activeGoal = { ...active, stepStartedAt: Date.now() };
		updateStatusBox(ctx, goalRuntimeState.activeGoal);
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildGoalSystemPrompt(goalRuntimeState.activeGoal, goalTodoPromptContext(ctx, goalRuntimeState.activeGoal))}`,
		};
	});

	pi.on("agent_start", (_event, ctx) => {
		cancelGoalRecoveryTimers();
		goalRuntimeState.activeGoal = goalRuntimeState.activeGoal
			? sanitizeLoadedGoal(ctx, goalRuntimeState.activeGoal)
			: loadGoalFromSession(ctx);
		if (goalRuntimeState.activeGoal?.status === "active")
			updateStatusBox(ctx, goalRuntimeState.activeGoal);
	});

	pi.on("turn_start", () => cancelGoalRecoveryTimers());
	pi.on("message_start", (event) => {
		if ((event.message as { role?: unknown }).role === "user")
			cancelGoalRecoveryTimers();
	});

	pi.on("agent_end", async (event, ctx) => {
		const generated = await handleGoalGenerationEnd(pi, ctx, event);
		if (generated?.autoStart) {
			const started = await startGoalFromDraft(generated.id, pi, ctx);
			notifyUser(
				ctx,
				generated.language === "en"
					? started
						? `Goal plan generated and started: ${generated.id}`
						: `Goal plan generated, but auto-start failed. Run /goal start ${generated.id}.`
					: started
						? `目标计划已生成并启动：${generated.id}`
						: `目标计划已生成，但自动启动失败。运行 /goal start ${generated.id}。`,
				started ? "info" : "warning",
				generated.language,
			);
			return;
		}
		goalRuntimeState.activeGoal = goalRuntimeState.activeGoal
			? sanitizeLoadedGoal(ctx, goalRuntimeState.activeGoal)
			: loadGoalFromSession(ctx);
		if (
			!goalRuntimeState.activeGoal ||
			goalRuntimeState.activeGoal.status !== "active"
		)
			return;
		const eventKey = agentEndEventKey(event);
		if (eventKey && handledGoalAgentEndEvents.has(eventKey)) return;
		if (eventKey) handledGoalAgentEndEvents.add(eventKey);
		const goalId = goalRuntimeState.activeGoal.id;
		const hadPendingContinuation =
			goalRuntimeState.continuationPending?.goalId === goalId;
		const finalAssistant = findFinalAssistantMessage(event.messages);
		if (isReviewLoopActive()) {
			scheduleContinueReviewAfterAgentEnd(pi, event, ctx);
			return saveActiveGoal(ctx, { updateStatus: false });
		}
		if (
			!goalRuntimeState.activeGoal ||
			goalRuntimeState.activeGoal.id !== goalId ||
			goalRuntimeState.activeGoal.status !== "active"
		)
			return;
		if (agentEndedWithRecoverableTransportStop(event)) {
			updateGoalUsage(goalRuntimeState.activeGoal, ctx);
			saveActiveGoal(ctx);
			if (finalAssistant)
				scheduleRetryExhaustionWatch(
					pi,
					ctx,
					goalRuntimeState.activeGoal,
					finalAssistant,
				);
			notifyUser(
				ctx,
				goalRuntimeState.activeGoal.language === "en"
					? `${goalScopeLabel(ctx, goalRuntimeState.activeGoal.language)} connection interrupted; waiting for Pi to retry automatically.`
					: `${goalScopeLabel(ctx, goalRuntimeState.activeGoal.language)}连接中断，等待 Pi 自动重试。`,
				"warning",
				goalRuntimeState.activeGoal.language,
			);
			return;
		}
		if (finalAssistant && isPiRetryableAgentError(finalAssistant)) {
			updateGoalUsage(goalRuntimeState.activeGoal, ctx);
			saveActiveGoal(ctx);
			scheduleRetryExhaustionWatch(
				pi,
				ctx,
				goalRuntimeState.activeGoal,
				finalAssistant,
			);
			return;
		}
		if (!hadPendingContinuation)
			goalRuntimeState.activeGoal = incrementGoal(goalRuntimeState.activeGoal);
		updateGoalUsage(goalRuntimeState.activeGoal, ctx);

		if (finalAssistant?.stopReason === "aborted")
			return pauseGoalAfterAgentEnd(
				ctx,
				goalRuntimeState.activeGoal,
				finalAssistant,
			);
		if (finalAssistant?.stopReason === "error") {
			saveActiveGoal(ctx);
			if (
				await recoverWebSocketLimitError(
					pi,
					ctx,
					goalRuntimeState.activeGoal,
					finalAssistant,
				)
			)
				return;
			await sendContinuationPrompt(pi, ctx, goalRuntimeState.activeGoal);
			return;
		}
		if (finalAssistant?.stopReason === "stop") {
			scheduleGoalStateReview(ctx, goalRuntimeState.activeGoal);
			return;
		}
		if (goalRuntimeState.completionAuditPending?.goalId === goalId) return;
		if (stopForBudget(ctx, goalRuntimeState.activeGoal)) return;
		saveActiveGoal(ctx);
		if (hadPendingContinuation && !hasPendingMessages(ctx))
			goalRuntimeState.continuationPending = undefined;
		if (!hasPendingMessages(ctx))
			await sendContinuationPrompt(pi, ctx, goalRuntimeState.activeGoal);
	});
}

export async function startGoalFromFlow(
	input: string | { objective: string; prompt: string },
	ctx: StatusContext,
) {
	const objective = typeof input === "string" ? input : input.objective;
	const prompt = typeof input === "string" ? input : input.prompt;
	const language = flowContext(ctx)?.flow.language ?? runtimeLanguage();
	const trimmed = objective.trim();
	if (!trimmed) {
		notifyUser(
			ctx,
			language === "en" ? "Flow step content is empty." : "Flow 步骤内容为空。",
			"warning",
			language,
		);
		return false;
	}
	const pi = goalRuntimeState.extensionApi;
	if (!pi) {
		notifyUser(
			ctx,
			language === "en"
				? "Goal extension is not initialized."
				: "目标扩展尚未初始化。",
			"error",
			language,
		);
		return false;
	}
	cancelGoalRecoveryTimers({ resetAutoResumeUse: true });
	cancelContinuationPending();
	cancelCompletionAudit();
	clearCompletionStatusTimer();
	goalRuntimeState.activeGoal = createGoal(
		trimmed,
		undefined,
		currentTokenTotal(ctx),
		undefined,
		language,
	);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	const started = await sendRuntimePrompt(pi, ctx, prompt, { language });
	if (!started) {
		clearActiveGoal(ctx);
		return false;
	}
	rememberFlowContext(ctx);
	return true;
}

export async function resumePausedGoalFromFlow(
	ctx: StatusContext,
): Promise<FlowGoalContinueResult> {
	if (!goalRuntimeState.activeGoal)
		goalRuntimeState.activeGoal = loadGoalFromSession(ctx);
	if (!goalRuntimeState.activeGoal) return "no_goal";
	if (
		goalRuntimeState.activeGoal.status !== "paused" &&
		goalRuntimeState.activeGoal.status !== "budget_limited"
	)
		return "not_resumable";
	const pi = goalRuntimeState.extensionApi;
	if (!pi) return "busy";
	cancelGoalRecoveryTimers({ resetAutoResumeUse: true });
	const previousGoal = goalRuntimeState.activeGoal;
	goalRuntimeState.activeGoal = transitionGoal(
		goalRuntimeState.activeGoal,
		"active",
	);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	if (goalRuntimeState.activeGoal.status !== "active") return "not_resumable";
	const routed = await continueFromCompletionCursor(
		ctx,
		goalRuntimeState.activeGoal,
	);
	if (routed) return routed;
	const resumed = await sendResumePrompt(pi, ctx, goalRuntimeState.activeGoal);
	if (!resumed) {
		goalRuntimeState.activeGoal = previousGoal;
		persistGoal(goalRuntimeState.activeGoal, ctx);
		updateStatus(ctx, goalRuntimeState.activeGoal);
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
	if (!goalRuntimeState.activeGoal)
		goalRuntimeState.activeGoal = loadGoalFromSession(ctx);
	if (!goalRuntimeState.activeGoal) return "no_goal";
	if (goalRuntimeState.activeGoal.status !== "active") return "not_resumable";
	if (!ctx.isIdle?.() || hasPendingMessages(ctx)) return "busy";
	cancelGoalRecoveryTimers({ resetAutoResumeUse: true });
	const routed = await continueFromCompletionCursor(
		ctx,
		goalRuntimeState.activeGoal,
	);
	if (routed) return routed;
	if (latestAssistantFromSession(ctx)?.stopReason === "stop")
		return (
			(await continueAfterRepairCursor(ctx, goalRuntimeState.activeGoal)) ??
			"continued"
		);
	const pi = goalRuntimeState.extensionApi;
	if (!pi) return "busy";
	return (await sendContinuationPrompt(pi, ctx, goalRuntimeState.activeGoal))
		? "continued"
		: "busy";
}

export function pauseGoalFromFlow(ctx: StatusContext) {
	if (!goalRuntimeState.activeGoal)
		goalRuntimeState.activeGoal = loadGoalFromSession(ctx);
	if (
		!goalRuntimeState.activeGoal ||
		goalRuntimeState.activeGoal.status !== "active"
	)
		return false;
	cancelGoalRecoveryTimers({ resetAutoResumeUse: true });
	cancelContinuationPending();
	cancelCompletionAudit();
	goalRuntimeState.activeGoal = transitionGoal(
		goalRuntimeState.activeGoal,
		"paused",
	);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	return true;
}

export function clearCompletedGoalFromFlow(ctx: StatusContext) {
	clearActiveGoal(ctx);
}

export function getGoalState(
	ctx: StatusContext,
): FlowGoalRuntimeState | undefined {
	const goal = goalRuntimeState.activeGoal ?? loadGoalFromSession(ctx);
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

async function startGoalFromDraft(
	id: string | undefined,
	pi: ExtensionAPI,
	ctx: StatusContext,
) {
	let location: ReturnType<typeof latestGoalArtifact>;
	try {
		location = id
			? findGoalArtifact(ctx.cwd, id)
			: latestGoalArtifact(ctx.cwd, (goal) => goal.status === "draft");
	} catch (error) {
		const language = runtimeLanguage();
		notifyUser(
			ctx,
			language === "en"
				? `goal.json read failed: ${notifyError(error)}`
				: `goal.json 读取失败：${notifyError(error)}`,
			"error",
			language,
		);
		return false;
	}
	if (!location) {
		const language = runtimeLanguage();
		notifyUser(ctx, noDraftGoalMessage(language), "warning", language);
		return false;
	}
	const validation = validateGoalDir(
		location.dir,
		location.goal?.language ?? runtimeLanguage(),
	);
	if (!validation.ok || !validation.goal) {
		if (location.goal)
			writeGoalArtifact(location.dir, {
				...location.goal,
				errors: validation.errors,
			});
		writeGoalErrorHtml(location.dir, {
			title: location.goal?.title || location.id,
			errors: validation.errors,
			originalRequest: location.goal?.source?.originalRequest,
			language: location.goal?.language ?? runtimeLanguage(),
		});
		const language = location.goal?.language ?? runtimeLanguage();
		notifyUser(
			ctx,
			language === "en"
				? `Goal validation failed:\n${validation.errors.join("\n")}`
				: `目标校验失败：\n${validation.errors.join("\n")}`,
			"error",
			language,
		);
		return false;
	}
	if (validation.goal.status !== "draft") {
		notifyUser(
			ctx,
			goalCannotStartMessage(validation.goal),
			"warning",
			validation.goal.language,
		);
		return false;
	}
	const existingGoal =
		goalRuntimeState.activeGoal?.status !== "complete"
			? goalRuntimeState.activeGoal
			: undefined;
	if (existingGoal) {
		notifyUser(
			ctx,
			activeGoalExistsMessage(existingGoal),
			"warning",
			existingGoal.language,
		);
		return false;
	}
	const markdown = readFileSync(goalPlanPath(location.dir), "utf8");
	const objective = objectiveFromPlan(markdown);
	if (!objective) {
		notifyUser(
			ctx,
			missingObjectiveMessage(validation.goal.language),
			"warning",
			validation.goal.language,
		);
		return false;
	}
	cancelContinuationPending();
	cancelCompletionAudit();
	goalRuntimeState.activeGoal = createGoal(
		objective,
		undefined,
		currentTokenTotal(ctx),
		{
			artifactDir: location.dir,
			artifactId: validation.goal.id,
		},
		validation.goal.language,
	);
	const sessionName = `${goalIdPrefix(validation.goal.id)} ${clip(validation.goal.title, 18)}`;
	pi.setSessionName?.(sessionName);
	const saved = writeGoalArtifact(location.dir, {
		...validation.goal,
		status: "running",
		sessionFile: currentSessionFile(ctx) ?? null,
		sessionName,
		snapshot: markdown,
		snapshotHash: planSnapshotHash(markdown),
		runtimeGoalId: goalRuntimeState.activeGoal.id,
		errors: [],
		checks: artifactChecks([], [], validation.goal.checks),
	});
	writeGoalHtml(location.dir, saved);
	watchGoalPlan(location.dir);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	const sent = await sendGoalPrompt(pi, ctx, goalRuntimeState.activeGoal);
	if (!sent) {
		const reverted = writeGoalArtifact(location.dir, validation.goal);
		writeGoalHtml(location.dir, reverted);
		closeGoalPlanWatcher();
		clearActiveGoal(ctx);
		return false;
	}
	return true;
}

function noDraftGoalMessage(language: Language) {
	return language === "en"
		? "No draft Goal to start. Run /goal <request> first."
		: "没有待启动的目标计划。先运行 /goal <需求> 生成。";
}

function goalCannotStartMessage(goal: {
	id: string;
	status: string;
	language: Language;
}) {
	const status = goalArtifactStatusLabel(goal.status, goal.language);
	return goal.language === "en"
		? `${goal.id} status: ${status}; cannot start.`
		: `${goal.id} 当前状态：${status}，不能启动。`;
}

function activeGoalExistsMessage(goal: ActiveGoal) {
	return goal.language === "en"
		? `Active Goal already exists: ${goal.text}`
		: `已有活动目标：${goal.text}`;
}

function missingObjectiveMessage(language: Language) {
	return language === "en"
		? "plan.md Objective cannot be empty."
		: "plan.md 的 Objective（目标）不能为空。";
}

function goalIdPrefix(id: string) {
	return /^G[0-9]+/u.exec(id)?.[0] ?? id;
}

function pauseGoal(ctx: StatusContext) {
	if (!goalRuntimeState.activeGoal)
		return notifyUser(
			ctx,
			noActiveGoalMessage(runtimeLanguage()),
			"info",
			runtimeLanguage(),
		);
	if (goalRuntimeState.activeGoal.status !== "active") {
		const goal = goalRuntimeState.activeGoal;
		return notifyUser(
			ctx,
			goalCannotPauseMessage(goal),
			"warning",
			goal.language,
		);
	}
	cancelContinuationPending();
	cancelCompletionAudit();
	goalRuntimeState.activeGoal = transitionGoal(
		goalRuntimeState.activeGoal,
		"paused",
	);
	syncStandaloneGoalArtifact(ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	closeGoalPlanWatcher();
	notifyUser(
		ctx,
		goalPausedMessage(goalRuntimeState.activeGoal),
		"info",
		goalRuntimeState.activeGoal.language,
	);
}

async function resumeGoal(pi: ExtensionAPI, ctx: StatusContext) {
	if (!goalRuntimeState.activeGoal)
		return notifyUser(
			ctx,
			noActiveGoalMessage(runtimeLanguage()),
			"info",
			runtimeLanguage(),
		);
	if (
		goalRuntimeState.activeGoal.status !== "paused" &&
		goalRuntimeState.activeGoal.status !== "budget_limited"
	) {
		const goal = goalRuntimeState.activeGoal;
		return notifyUser(
			ctx,
			goalCannotResumeMessage(goal),
			"warning",
			goal.language,
		);
	}
	if (!validateCompletionArtifact(ctx, goalRuntimeState.activeGoal)) return;
	goalRuntimeState.activeGoal = transitionGoal(
		goalRuntimeState.activeGoal,
		"active",
	);
	syncStandaloneGoalArtifact(ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	if (
		goalRuntimeState.activeGoal.status === "active" &&
		goalRuntimeState.activeGoal.artifactDir
	)
		watchGoalPlan(goalRuntimeState.activeGoal.artifactDir);
	if (goalRuntimeState.activeGoal.status !== "active") {
		const goal = goalRuntimeState.activeGoal;
		return notifyUser(
			ctx,
			goal.language === "en"
				? `Goal token budget is still reached: ${formatBudget(goal)}`
				: `目标令牌预算仍已达到：${formatBudget(goal)}`,
			"warning",
			goal.language,
		);
	}
	const resumedGoal = goalRuntimeState.activeGoal;
	const routed = await continueFromCompletionCursor(ctx, resumedGoal);
	if (routed) {
		notifyUser(
			ctx,
			goalContinueResultMessage(routed, resumedGoal.language),
			routed === "not_resumable" ? "warning" : "info",
			resumedGoal.language,
		);
		return;
	}
	const sent = await sendResumePrompt(pi, ctx, resumedGoal);
	if (!sent) {
		goalRuntimeState.activeGoal = transitionGoal(resumedGoal, "paused");
		syncStandaloneGoalArtifact(ctx, goalRuntimeState.activeGoal);
		persistGoal(goalRuntimeState.activeGoal, ctx);
		updateStatus(ctx, goalRuntimeState.activeGoal);
		return;
	}
	notifyUser(
		ctx,
		goalResumedMessage(goalRuntimeState.activeGoal),
		"info",
		goalRuntimeState.activeGoal.language,
	);
}

async function continueGoal(pi: ExtensionAPI, ctx: StatusContext) {
	const goal = goalRuntimeState.activeGoal ?? loadGoalFromSession(ctx);
	if (goal?.status === "paused" || goal?.status === "budget_limited")
		return resumeGoal(pi, ctx);
	const result = await continueActiveGoalIfIdle(ctx);
	const language = goal?.language ?? runtimeLanguage();
	return notifyUser(
		ctx,
		goalContinueResultMessage(result, language),
		result === "not_resumable" ? "warning" : "info",
		language,
	);
}

function cancelGoal(ctx: StatusContext) {
	if (clearGoalGeneration(ctx)) {
		ctx.ui.notify("目标计划生成已取消。", "warning");
		return;
	}
	if (!goalRuntimeState.activeGoal) {
		notifyUser(
			ctx,
			noActiveGoalMessage(runtimeLanguage()),
			"info",
			runtimeLanguage(),
		);
		cancelContinuationPending();
		clearPersistedGoal(ctx.cwd, ctx);
		clearGoalUi(ctx);
		return;
	}
	const stoppedGoal = goalRuntimeState.activeGoal.text;
	const language = goalRuntimeState.activeGoal.language;
	cancelStandaloneGoalArtifact(ctx, goalRuntimeState.activeGoal);
	clearActiveGoal(ctx);
	notifyUser(
		ctx,
		goalCancelledMessage(stoppedGoal, language),
		"warning",
		language,
	);
}

async function showGoal(ctx: StatusContext, id: string | undefined) {
	if (id) return showGoalArtifact(ctx, id);
	if (showGoalGenerationStatus(ctx)) return;
	if (!goalRuntimeState.activeGoal) {
		const latest = latestGoalArtifact(
			ctx.cwd,
			(goal) => goal.status !== "cancelled",
		);
		if (latest) return showGoalArtifact(ctx, latest.id);
		ctx.ui.notify("用法：/goal | /goal start [id]\n当前没有目标。", "info");
		clearGoalUi(ctx);
		return;
	}
	updateGoalUsage(goalRuntimeState.activeGoal, ctx);
	if (goalRuntimeState.activeGoal.artifactDir)
		syncStandaloneGoalArtifact(ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	if (!isGoalScopedReviewActive())
		updateStatus(ctx, goalRuntimeState.activeGoal);
	const report = await goalReportUrl(
		ctx,
		goalRuntimeState.activeGoal.artifactDir,
		goalRuntimeState.activeGoal.language,
	);
	notifyUser(
		ctx,
		goalSummary(goalRuntimeState.activeGoal, report),
		"info",
		goalRuntimeState.activeGoal.language,
	);
}

async function showGoalArtifact(ctx: StatusContext, id: string) {
	let location: ReturnType<typeof findGoalArtifact>;
	try {
		location = findGoalArtifact(ctx.cwd, id);
	} catch (error) {
		const language = runtimeLanguage();
		return notifyUser(
			ctx,
			language === "en"
				? `goal.json read failed: ${notifyError(error)}`
				: `goal.json 读取失败：${notifyError(error)}`,
			"error",
			language,
		);
	}
	if (!location) {
		const language = runtimeLanguage();
		return notifyUser(
			ctx,
			language === "en"
				? "No Goal in the current directory."
				: "当前目录没有目标。",
			"info",
			language,
		);
	}
	const validation = validateGoalDir(
		location.dir,
		location.goal?.language ?? runtimeLanguage(),
	);
	if (!validation.ok || !validation.goal) {
		const language = location.goal?.language ?? runtimeLanguage();
		return notifyUser(
			ctx,
			language === "en"
				? `Goal validation failed:\n${validation.errors.join("\n")}`
				: `目标校验失败：\n${validation.errors.join("\n")}`,
			"error",
			language,
		);
	}
	const htmlPath = writeGoalHtml(location.dir, validation.goal);
	const report = await liveReportUrl(
		ctx,
		htmlPath,
		validation.goal.language,
	).catch(() => undefined);
	notifyUser(
		ctx,
		goalArtifactSummary(validation.goal, report),
		"info",
		validation.goal.language,
	);
}

function scheduleGoalStateReview(ctx: ExtensionContext, goal: ActiveGoal) {
	const goalId = goal.id;
	goalRuntimeState.scheduledGoalStateReview = new Promise((resolve) => {
		setImmediate(() => {
			const current = goalRuntimeState.activeGoal ?? loadGoalFromSession(ctx);
			if (!current || current.id !== goalId || current.status !== "active") {
				resolve();
				return;
			}
			void startGoalStateReview(ctx, current)
				.catch((error) =>
					notifyUser(
						ctx,
						current.language === "en"
							? `Acceptance start failed: ${notifyError(error)}`
							: `完成验收启动失败：${notifyError(error)}`,
						"error",
						current.language,
					),
				)
				.finally(resolve);
		});
	});
}

export async function waitForScheduledGoalStateReview() {
	await (goalRuntimeState.scheduledGoalStateReview ?? Promise.resolve());
	await waitForScheduledReviewAgentEnd();
}

async function startGoalStateReview(ctx: ExtensionContext, goal: ActiveGoal) {
	cancelContinuationPending();
	updateGoalUsage(goal, ctx);
	const now = Date.now();
	if (!isGoalStateReviewEnabled()) {
		const reviewGoal: ActiveGoal = { ...goal, stepStartedAt: now };
		goalRuntimeState.activeGoal = reviewGoal;
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
	goalRuntimeState.activeGoal = reviewGoal;
	setCompletionCursor(ctx, reviewGoal, "acceptance_retry");
	persistGoal(reviewGoal, ctx);
	sendGoalStateReviewStartCard(ctx, reviewGoal, round);
	const run = startCompletionAudit(reviewGoal);
	const audit = await runGoalStateReviewWithStatus(
		reviewGoal,
		round,
		ctx,
		run.generation,
		run.signal,
	);
	if (!isCurrentCompletionAudit(reviewGoal.id, run.generation)) return;
	goalRuntimeState.completionAuditPending = undefined;
	await handleGoalStateReviewResult(reviewGoal, round, audit, ctx);
}

async function handleGoalStateReviewResult(
	goal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
	ctx: ExtensionContext,
) {
	const reviewedGoal = recordGoalReview(goal, round, audit);
	goalRuntimeState.goalReviewLive = undefined;
	if (!audit.complete) {
		if (audit.systemError)
			return pauseGoalAfterReviewSystemError(ctx, reviewedGoal, audit);
		const repairGoal: ActiveGoal = {
			...reviewedGoal,
			stepStartedAt: Date.now(),
			updatedAt: Date.now(),
		};
		goalRuntimeState.activeGoal = repairGoal;
		setCompletionCursor(ctx, repairGoal, "acceptance_repair");
		syncGoalReviewSurfaces(goalRuntimeState, ctx, repairGoal);
		persistGoal(repairGoal, ctx);
		updateStatus(ctx, repairGoal);
		sendGoalReviewCard(ctx, reviewedGoal, round, audit, false);
		return;
	}
	goalRuntimeState.activeGoal = reviewedGoal;
	syncGoalReviewSurfaces(goalRuntimeState, ctx, reviewedGoal);
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
	const flow = flowContext(ctx);
	const plan = goalPlanEvidence(ctx, goal);
	if (stateReviewRound > 0) await yieldForGoalReviewCard();
	stopGoalStatusTimer();
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
				resumeCommand: flow ? "/flow continue" : "/goal continue",
				activity: flow
					? {
							object: "Flow",
							rows: activityRows(flow.label, goalDisplayText(ctx, goal)),
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
	sendGoalReviewErrorCard(ctx, goal, goal.stateReviewRounds, audit);
	goalRuntimeState.activeGoal = transitionGoal(goal, "paused");
	syncGoalReviewSurfaces(goalRuntimeState, ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	notifyUser(
		ctx,
		`${audit.feedback} ${pausedContinueMessage(ctx, goal.language)}`,
		"error",
		goal.language,
	);
}

function pauseGoalAfterQualityReviewStop(
	ctx: ExtensionContext,
	goalId: string,
	message: string | undefined = undefined,
	history: ReviewHistoryEntry[] = [],
) {
	cancelCompletionAudit();
	goalRuntimeState.goalReviewLive = undefined;
	if (!goalRuntimeState.activeGoal || goalRuntimeState.activeGoal.id !== goalId)
		return;
	goalRuntimeState.activeGoal = transitionGoal(
		recordGoalQualityReview(goalRuntimeState.activeGoal, history),
		"paused",
	);
	syncGoalReviewSurfaces(goalRuntimeState, ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	closeGoalPlanWatcher();
	const reason =
		message ??
		qualityStopMessage("incomplete", goalRuntimeState.activeGoal.language);
	sendGoalQualityReviewBlockedCard(ctx, goalRuntimeState.activeGoal, reason);
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
		...(flow ? [flowLine(flow.label, goal.language)] : []),
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
		...(flow ? [flowLine(flow.label, goal.language)] : []),
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
	goalRuntimeState.activeGoal = transitionGoal(goal, "paused");
	syncGoalReviewSurfaces(goalRuntimeState, ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	closeGoalPlanWatcher();
	sendGoalCompletionFactErrorCard(ctx, goalRuntimeState.activeGoal);
}

function sendGoalQualityReviewBlockedCard(
	ctx: ExtensionContext,
	goal: ActiveGoal,
	message: string,
) {
	const flow = flowContext(ctx);
	const next = flow ? "/flow continue" : "/goal continue";
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
	const next = flow ? "/flow continue" : "/goal continue";
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
	const next = flowContext(ctx) ? "/flow continue" : "/goal continue";
	const title = roundTitle(
		round,
		acceptanceTitle("error", goal.language),
		goal.language,
	);
	const lines = [
		goal.language === "en"
			? "Blocker: acceptance did not complete"
			: "卡点：完成验收未完成",
		goal.language === "en"
			? `Reason: ${audit.feedback || audit.raw}`
			: `原因：${audit.feedback || audit.raw}`,
		goal.language === "en" ? `Next: ${next}` : `下一步：${next}`,
		elapsedLine(goalReviewElapsedText(ctx, goal, round), goal.language),
	];
	const content = [
		`[${title}]`,
		goalLine(ctx, goal),
		...lines.filter((line) => !line.startsWith("⏱ ")),
	].join("\n");
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
	const lines = [
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
		elapsedLine(goalReviewElapsedText(ctx, goal, round), goal.language),
	];
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

function elapsedLine(text: string, language: Language) {
	return language === "en" ? `⏱ Elapsed: ${text}` : `⏱ 用时：${text}`;
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
		goalRuntimeState,
		ctx,
		goal,
		stateReviewRound,
		reviewStats,
		qualitySummary,
		{
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
	cancelGoalRecoveryTimers();
	cancelContinuationPending();
	cancelCompletionAudit();
	goalRuntimeState.activeGoal = transitionGoal(goal, "paused");
	syncStandaloneGoalArtifact(ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	closeGoalPlanWatcher();
	const details = assistant.errorMessage
		? ` (${truncateNotification(assistant.errorMessage)})`
		: "";
	notifyUser(
		ctx,
		goal.language === "en"
			? `${goalScopeLabel(ctx, goal.language)} paused after execution interruption${details}. Run ${goalResumeCommand(ctx)} to continue.`
			: `${goalScopeLabel(ctx, goal.language)}已因执行中断${details}暂停。运行 ${goalResumeCommand(ctx)} 继续。`,
		"warning",
		goal.language,
	);
}

function scheduleRetryExhaustionWatch(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goal: ActiveGoal,
	assistant: AssistantMessageLike,
) {
	cancelRetryExhaustionWatch();
	const generation = nextRetryRecoveryGeneration();
	const errorMessage =
		assistant.errorMessage ??
		(goal.language === "en" ? "unknown network error" : "未知网络错误");
	const timer = setTimeout(() => {
		pauseGoalAfterRetryExhaustion(pi, ctx, goal.id, generation, errorMessage);
	}, PI_RETRY_EXHAUSTION_GUARD_MS);
	timer.unref?.();
	goalRuntimeState.retryExhaustionWatch = {
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
	const watch = goalRuntimeState.retryExhaustionWatch;
	if (!watch || watch.goalId !== goalId || watch.generation !== generation)
		return;
	goalRuntimeState.retryExhaustionWatch = undefined;
	const goal = goalRuntimeState.activeGoal ?? loadGoalFromSession(ctx);
	if (!goal || goal.id !== goalId || goal.status !== "active") return;
	updateGoalUsage(goal, ctx);
	goalRuntimeState.activeGoal = transitionGoal(goal, "paused");
	syncStandaloneGoalArtifact(ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	closeGoalPlanWatcher();
	const willAutoResume =
		!goalRuntimeState.retryAutoResumeUsedGoalIds.has(goalId);
	sendRetryExhaustedCard(
		ctx,
		goalRuntimeState.activeGoal,
		errorMessage,
		willAutoResume,
	);
	notifyUser(
		ctx,
		retryExhaustedNotification(
			ctx,
			goalRuntimeState.activeGoal,
			errorMessage,
			willAutoResume,
		),
		"warning",
		goalRuntimeState.activeGoal.language,
	);
	if (willAutoResume)
		scheduleAutoResumeAfterRetryExhaustion(
			pi,
			ctx,
			goalRuntimeState.activeGoal,
		);
}

function scheduleAutoResumeAfterRetryExhaustion(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goal: ActiveGoal,
) {
	cancelDeferredAutoResume();
	const generation = nextRetryRecoveryGeneration();
	const timer = setTimeout(() => {
		void resumeGoalAfterRetryBackoff(pi, ctx, goal.id, generation);
	}, AUTO_RESUME_AFTER_RETRY_EXHAUSTION_MS);
	timer.unref?.();
	goalRuntimeState.deferredAutoResume = { goalId: goal.id, generation, timer };
}

async function resumeGoalAfterRetryBackoff(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goalId: string,
	generation: number,
) {
	const deferred = goalRuntimeState.deferredAutoResume;
	if (
		!deferred ||
		deferred.goalId !== goalId ||
		deferred.generation !== generation
	)
		return;
	goalRuntimeState.deferredAutoResume = undefined;
	const goal = goalRuntimeState.activeGoal ?? loadGoalFromSession(ctx);
	if (!goal || goal.id !== goalId || goal.status !== "paused") return;
	goalRuntimeState.retryAutoResumeUsedGoalIds.add(goalId);
	goalRuntimeState.activeGoal = transitionGoal(goal, "active");
	syncStandaloneGoalArtifact(ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	if (goalRuntimeState.activeGoal.status !== "active") return;
	if (goalRuntimeState.activeGoal.artifactDir)
		watchGoalPlan(goalRuntimeState.activeGoal.artifactDir);
	sendRetryAutoResumeCard(ctx, goalRuntimeState.activeGoal);
	const resumedGoal = goalRuntimeState.activeGoal;
	if (await sendResumePrompt(pi, ctx, resumedGoal)) return;
	goalRuntimeState.activeGoal = transitionGoal(resumedGoal, "paused");
	syncStandaloneGoalArtifact(ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
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
		const retryText = willAutoResume
			? "will resume once after 5 minutes without user action;"
			: "already resumed once; will not resume again;";
		return `${goalScopeLabel(ctx, goal.language)} paused: Pi automatic retries are exhausted (${truncateNotification(errorMessage)}). ${retryText} run ${goalResumeCommand(ctx)} to continue.`;
	}
	const retryText = willAutoResume
		? "5 分钟无人操作后自动恢复一次；"
		: "已自动恢复过一次；";
	return `${goalScopeLabel(ctx, goal.language)}已暂停：Pi 自动重试耗尽（${truncateNotification(errorMessage)}）。${retryText}运行 ${goalResumeCommand(ctx)} 继续。`;
}

async function recoverWebSocketLimitError(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goal: ActiveGoal,
	assistant: AssistantMessageLike,
) {
	if (!isResponsesWebSocketLimitError(assistant.errorMessage)) return false;
	if (!canAutoRecoverWebSocketLimit(goal)) {
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
		goal.language === "en"
			? `${goalScopeLabel(ctx, goal.language)} connection reached the 60-minute limit and continued automatically.`
			: `${goalScopeLabel(ctx, goal.language)}连接到达 60 分钟上限，已自动继续。`,
		"warning",
		goal.language,
	);
	if (await sendContinuationPrompt(pi, ctx, goal)) {
		goalRuntimeState.websocketLimitRecoveryAt.set(goal.id, Date.now());
		return true;
	}
	pauseGoalAfterWebSocketLimit(
		ctx,
		goal,
		goal.language === "en" ? "automatic continuation failed" : "自动继续失败",
	);
	return true;
}

function canAutoRecoverWebSocketLimit(goal: ActiveGoal) {
	const recoveredAt =
		goalRuntimeState.websocketLimitRecoveryAt.get(goal.id) ?? 0;
	return Date.now() - recoveredAt >= WEBSOCKET_LIMIT_RECOVERY_COOLDOWN_MS;
}

function pauseGoalAfterWebSocketLimit(
	ctx: StatusContext,
	goal: ActiveGoal,
	reason: string,
) {
	cancelGoalRecoveryTimers();
	cancelContinuationPending();
	cancelCompletionAudit();
	goalRuntimeState.activeGoal = transitionGoal(goal, "paused");
	syncStandaloneGoalArtifact(ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	closeGoalPlanWatcher();
	notifyUser(
		ctx,
		goal.language === "en"
			? `${goalScopeLabel(ctx, goal.language)} connection reached the 60-minute limit; ${reason}. Run ${goalResumeCommand(ctx)} to continue.`
			: `${goalScopeLabel(ctx, goal.language)}连接到达 60 分钟上限，${reason}。运行 ${goalResumeCommand(ctx)} 继续。`,
		"warning",
		goal.language,
	);
}

function isResponsesWebSocketLimitError(message: string | undefined) {
	return Boolean(
		message?.includes(RESPONSES_WEBSOCKET_LIMIT_CODE) ||
			message?.includes("Responses websocket connection limit reached"),
	);
}

function goalScopeLabel(ctx: StatusContext, language: Language = "zh") {
	if (flowContext(ctx)) return "Flow";
	return language === "en" ? "Goal" : "目标";
}

function pausedContinueMessage(ctx: StatusContext, language: Language) {
	const command = goalResumeCommand(ctx);
	if (flowContext(ctx))
		return language === "en"
			? `Flow paused. Run ${command} to continue.`
			: `Flow 已暂停。运行 ${command} 继续。`;
	return language === "en"
		? `Goal paused. Run ${command} to continue.`
		: `目标已暂停。运行 ${command} 继续。`;
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
	return flowContext(ctx) ? "/flow continue" : "/goal continue";
}

function goalClearCommand(ctx: StatusContext) {
	return flowContext(ctx) ? "/flow cancel" : "/goal cancel";
}

function stopForBudget(ctx: StatusContext, goal: ActiveGoal) {
	if (goal.tokenBudget === undefined || goal.tokensUsed < goal.tokenBudget)
		return false;
	cancelGoalRecoveryTimers();
	cancelContinuationPending();
	goalRuntimeState.activeGoal = transitionGoal(goal, "budget_limited");
	syncStandaloneGoalArtifact(ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	closeGoalPlanWatcher();
	notifyUser(
		ctx,
		goal.language === "en"
			? `Goal token budget reached: ${formatBudget(goalRuntimeState.activeGoal)}`
			: `目标令牌预算已达到：${formatBudget(goalRuntimeState.activeGoal)}`,
		"warning",
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
	syncGoalStatusTimer(ctx, goal);
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
	stopGoalStatusTimer();
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
			isActive: () => isCurrentCompletionAudit(goal.id, generation),
			language: goal.language,
		},
	);
	trackCompletionAuditStatus(goal.id, generation, status);
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
				if (!isCurrentCompletionAudit(goal.id, generation)) return;
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
		clearCompletionAuditStatus(ctx, goal.id, generation, status);
	}
}

function cancelGoalReview(ctx: ExtensionContext) {
	cancelCompletionAudit();
	if (!goalRuntimeState.activeGoal) return;
	goalRuntimeState.activeGoal = transitionGoal(
		goalRuntimeState.activeGoal,
		"paused",
	);
	syncGoalReviewSurfaces(goalRuntimeState, ctx, goalRuntimeState.activeGoal);
	persistGoal(goalRuntimeState.activeGoal, ctx);
	updateStatus(ctx, goalRuntimeState.activeGoal);
	closeGoalPlanWatcher();
	notifyUser(
		ctx,
		pausedContinueMessage(ctx, goalRuntimeState.activeGoal.language),
		"info",
		goalRuntimeState.activeGoal.language,
	);
}

function startCompletionAudit(goal: ActiveGoal) {
	return startCompletionAuditState(goalRuntimeState, goal);
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
	return flow ? activityRows(flow.label, goalText) : activityRows(goalText);
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
	saveActiveGoalEntry({
		ctx,
		goal: goalRuntimeState.activeGoal,
		live: goalRuntimeState.goalReviewLive,
		pi: goalRuntimeState.extensionApi,
	});
	if (options.updateStatus === false) return;
	if (goalRuntimeState.activeGoal)
		updateStatus(ctx, goalRuntimeState.activeGoal);
}

function syncStandaloneGoalArtifact(
	ctx: StatusContext,
	goal: ActiveGoal,
	audit = "",
) {
	syncStandaloneGoalArtifactEntry(
		ctx,
		goal,
		goalRuntimeState.goalReviewLive,
		audit,
	);
}

function readCompletionCursor(
	ctx: StatusContext,
	goal: ActiveGoal,
): CompletionCursor | undefined {
	try {
		if (goal.artifactDir) {
			const validation = validateGoalDir(goal.artifactDir, goal.language);
			if (!validation.ok || !validation.goal) {
				notifyGoalValidationFailed(ctx, goal, validation.errors);
				return undefined;
			}
			return validation.goal.completionCursor;
		}
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
			goal.language === "en"
				? `Completion state read failed: ${notifyError(error)}`
				: `完成状态读取失败：${notifyError(error)}`,
			"error",
			goal.language,
		);
		return undefined;
	}
}

function validateCompletionArtifact(ctx: StatusContext, goal: ActiveGoal) {
	if (!goal.artifactDir) return true;
	const validation = validateGoalDir(goal.artifactDir, goal.language);
	if (validation.ok && validation.goal) return true;
	notifyGoalValidationFailed(ctx, goal, validation.errors);
	return false;
}

function notifyGoalValidationFailed(
	ctx: StatusContext,
	goal: ActiveGoal,
	errors: string[],
) {
	notifyUser(
		ctx,
		goal.language === "en"
			? `Goal validation failed:\n${errors.join("\n")}`
			: `目标校验失败：\n${errors.join("\n")}`,
		"error",
		goal.language,
	);
}

function setCompletionCursor(
	ctx: StatusContext,
	goal: ActiveGoal,
	cursor: CompletionCursor,
) {
	try {
		if (goal.artifactDir) {
			const artifact = readGoalArtifact(goal.artifactDir);
			const saved = writeGoalArtifact(goal.artifactDir, {
				...artifact,
				completionCursor: cursor,
			});
			writeGoalHtml(goal.artifactDir, saved);
			return;
		}
		const owner = flowOwnerForSession(ctx);
		if (!owner)
			throw new Error(
				goal.language === "en"
					? "active Flow Goal has no flow artifact"
					: "活动 Flow 目标缺少 flow artifact",
			);
		const current = currentGoal(owner.flow);
		if (!current) return;
		const goals = owner.flow.goals.map((item, index) =>
			index === owner.flow.currentGoal
				? { ...item, completionCursor: cursor }
				: item,
		);
		const saved = writeFlow(owner.dir, { ...owner.flow, goals });
		writeFlowHtml(owner.dir, saved);
	} catch (error) {
		notifyUser(
			ctx,
			goal.language === "en"
				? `Completion state save failed: ${notifyError(error)}`
				: `完成状态保存失败：${notifyError(error)}`,
			"error",
			goal.language,
		);
	}
}

function publishGoalReviewLive(
	ctx: StatusContext,
	goal: ActiveGoal,
	live: GoalReviewLive,
) {
	goalRuntimeState.goalReviewLive = live;
	syncGoalReviewSurfaces(goalRuntimeState, ctx, goal);
}

function cancelStandaloneGoalArtifact(ctx: StatusContext, goal: ActiveGoal) {
	cancelStandaloneGoalArtifactEntry(ctx, goal);
}

function clearGoalUi(ctx: StatusContext) {
	setFlowActivity("goal", false);
	setGoalActivityBox(ctx, undefined);
	ctx.ui.setStatus(STATUS_KEY, undefined);
}

function goalTodoPromptContext(
	ctx: StatusContext,
	_goal: ActiveGoal,
): GoalTodoPromptContext {
	const flow = flowContext(ctx);
	if (!flow) return {};
	return {
		planPath: `.flow/flows/${flow.flow.id}/${flow.plan.file}`,
		recordSection: "Handoff",
		stateFile: "flow.json",
	};
}

async function sendGoalPrompt(
	pi: ExtensionAPI,
	ctx: StatusContext,
	goal: ActiveGoal,
) {
	return sendRuntimePrompt(
		pi,
		ctx,
		buildGoalPrompt(goal, goalTodoPromptContext(ctx, goal)),
		{ language: goal.language },
	);
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
	if (
		goalRuntimeState.continuationPending?.goalId === goal.id ||
		hasPendingMessages(ctx)
	)
		return false;
	const marker = continuationMarker(goal);
	const prompt = buildContinuePrompt(
		goal,
		marker,
		goalTodoPromptContext(ctx, goal),
	);
	goalRuntimeState.continuationPending = {
		goalId: goal.id,
		iteration: goal.iteration,
		marker,
		prompt,
	};
	const sent = await sendRuntimePrompt(pi, ctx, prompt, {
		deliverAsFollowUp: true,
		language: goal.language,
	});
	if (!sent && goalRuntimeState.continuationPending?.marker === marker)
		goalRuntimeState.continuationPending = undefined;
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
	const next =
		goal.language === "en"
			? `Next: ${goalResumeCommand(ctx)} · ${goalClearCommand(ctx)}`
			: `下一步：${goalResumeCommand(ctx)} · ${goalClearCommand(ctx)}`;
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
		flow.label,
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
			goalPlanPath(goal.artifactDir),
			`${goal.artifactDir}/plan.md`,
		);
	const flow = flowContext(ctx);
	if (!flow) return undefined;
	const text =
		readPlanText(join(flow.dir, flow.plan.file)) ?? flow.plan.snapshot ?? "";
	if (!text.trim()) return undefined;
	return {
		path: `.flow/flows/${flow.flow.id}/${flow.plan.file}`,
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

function goalSummary(goal: ActiveGoal, report: string | undefined) {
	if (goal.language === "en")
		return [
			`Goal: ${goal.text}`,
			`Status: ${formatGoalStatus(goal.status, goal.language)}`,
			`Worked: ${formatDuration(goal.timeUsedSeconds)}`,
			`Tokens: ${goal.tokenBudget === undefined ? formatTokenCount(goal.tokensUsed) : formatBudget(goal)}`,
			...(report ? [`🌐 Web report: ${report}`] : []),
			`Commands: ${goalCommandHint(goal.status)}`,
		].join("\n");
	return [
		`目标：${goal.text}`,
		`状态：${formatGoalStatus(goal.status, goal.language)}`,
		`已工作：${formatDuration(goal.timeUsedSeconds)}`,
		`令牌：${goal.tokenBudget === undefined ? formatTokenCount(goal.tokensUsed) : formatBudget(goal)}`,
		...(report ? [`🌐 网页报告: ${report}`] : []),
		`命令：${goalCommandHint(goal.status)}`,
	].join("\n");
}

function goalArtifactSummary(
	goal: {
		id: string;
		title: string;
		status: string;
		language: Language;
	},
	report: string | undefined,
) {
	const nextCommand =
		goal.status === "draft" ? `/goal start ${goal.id}` : "/goal status";
	if (goal.language === "en")
		return [
			`Goal: ${goal.id}`,
			`Title: ${goal.title}`,
			`Status: ${goalArtifactStatusLabel(goal.status, goal.language)}`,
			...(report ? [`🌐 Web report: ${report}`] : []),
			`Next: ${nextCommand}`,
		].join("\n");
	return [
		`目标: ${goal.id}`,
		`标题: ${goal.title}`,
		`状态: ${goalArtifactStatusLabel(goal.status, goal.language)}`,
		...(report ? [`🌐 网页报告: ${report}`] : []),
		`下一步: ${nextCommand}`,
	].join("\n");
}

async function goalReportUrl(
	ctx: StatusContext,
	dir: string | undefined,
	language?: Language,
) {
	return dir
		? liveReportUrl(ctx, join(dir, "goal.html"), language).catch(
				() => undefined,
			)
		: undefined;
}

function goalCommandHint(status: GoalStatus) {
	if (status === "active") return "/goal continue, /goal pause, /goal cancel";
	if (status === "paused") return "/goal continue, /goal cancel";
	return "/goal cancel";
}

function formatGoalStatus(status: GoalStatus, language: Language = "zh") {
	if (status === "active") return language === "en" ? "active" : "活动";
	if (status === "paused") return language === "en" ? "paused" : "已暂停";
	if (status === "budget_limited")
		return language === "en" ? "budget limited" : "预算受限";
	return language === "en" ? "complete" : "已完成";
}

function noActiveGoalMessage(language: Language) {
	return language === "en" ? "No active Goal." : "没有活动目标。";
}

function goalCannotPauseMessage(goal: ActiveGoal) {
	const status = formatGoalStatus(goal.status, goal.language);
	return goal.language === "en"
		? `Goal status is ${status}; only an active Goal can be paused.`
		: `目标状态为 ${status}；只有活动目标可以暂停。`;
}

function goalCannotResumeMessage(goal: ActiveGoal) {
	const status = formatGoalStatus(goal.status, goal.language);
	return goal.language === "en"
		? `Goal status is ${status}; only a paused or budget-limited Goal can be resumed.`
		: `目标状态为 ${status}；只有已暂停或预算受限的目标可以恢复。`;
}

function goalPausedMessage(goal: ActiveGoal) {
	return goal.language === "en"
		? `Goal paused: ${goal.text}`
		: `目标已暂停：${goal.text}`;
}

function goalResumedMessage(goal: ActiveGoal) {
	return goal.language === "en"
		? `Goal resumed: ${goal.text}`
		: `目标已恢复：${goal.text}`;
}

function goalCancelledMessage(goalText: string, language: Language) {
	return language === "en"
		? `Goal cancelled: ${goalText}`
		: `目标已取消：${goalText}`;
}

function goalContinueResultMessage(
	result: FlowGoalContinueResult,
	language: Language,
) {
	if (result === "continued")
		return language === "en" ? "Goal continued." : "目标已继续执行。";
	if (result === "busy")
		return language === "en"
			? "AI is running; try again later."
			: "AI 正在运行，稍后再试。";
	if (result === "no_goal") return noActiveGoalMessage(language);
	return language === "en"
		? "The current Goal cannot be continued with /goal continue."
		: "当前目标不能用 /goal continue 继续。";
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

function clearContinuationTracking() {
	goalRuntimeState.continuationPending = undefined;
	cancelCompletionAudit();
	cancelGoalRecoveryTimers({ resetAutoResumeUse: true });
	goalRuntimeState.cancelledContinuationMarkers.clear();
	goalRuntimeState.websocketLimitRecoveryAt.clear();
}

function cancelGoalRecoveryTimers(
	options: { resetAutoResumeUse?: boolean } = {},
) {
	cancelRetryExhaustionWatch();
	cancelDeferredAutoResume();
	if (options.resetAutoResumeUse)
		goalRuntimeState.retryAutoResumeUsedGoalIds.clear();
}

function cancelRetryExhaustionWatch() {
	const watch = goalRuntimeState.retryExhaustionWatch;
	if (!watch) return;
	clearTimeout(watch.timer);
	goalRuntimeState.retryExhaustionWatch = undefined;
	nextRetryRecoveryGeneration();
}

function cancelDeferredAutoResume() {
	const deferred = goalRuntimeState.deferredAutoResume;
	if (!deferred) return;
	clearTimeout(deferred.timer);
	goalRuntimeState.deferredAutoResume = undefined;
	nextRetryRecoveryGeneration();
}

function nextRetryRecoveryGeneration() {
	goalRuntimeState.retryRecoveryGeneration += 1;
	return goalRuntimeState.retryRecoveryGeneration;
}

function cancelCompletionAudit() {
	cancelCompletionAuditState(goalRuntimeState);
}

function trackCompletionAuditStatus(
	goalId: string,
	generation: number,
	status: ElapsedStatus,
) {
	trackCompletionAuditStatusState(goalRuntimeState, goalId, generation, status);
}

function clearCompletionAuditStatus(
	ctx: StatusContext,
	goalId: string,
	generation: number,
	status: ElapsedStatus,
) {
	clearCompletionAuditStatusState(
		goalRuntimeState,
		ctx,
		goalId,
		generation,
		status,
	);
}

function isCurrentCompletionAudit(goalId: string, generation: number) {
	return isCurrentCompletionAuditState(goalRuntimeState, goalId, generation);
}

function cancelContinuationPending() {
	if (goalRuntimeState.continuationPending)
		rememberCancelledContinuationMarker(
			goalRuntimeState.continuationPending.marker,
		);
	goalRuntimeState.continuationPending = undefined;
}

function rememberCancelledContinuationMarker(marker: string) {
	goalRuntimeState.cancelledContinuationMarkers.add(marker);
	if (
		goalRuntimeState.cancelledContinuationMarkers.size <=
		MAX_CANCELLED_CONTINUATION_PROMPTS
	)
		return;
	const oldest = goalRuntimeState.cancelledContinuationMarkers
		.values()
		.next().value;
	if (oldest) goalRuntimeState.cancelledContinuationMarkers.delete(oldest);
}

function consumeCancelledContinuationPrompt(prompt: string) {
	const marker = extractContinuationMarker(prompt);
	return marker
		? goalRuntimeState.cancelledContinuationMarkers.delete(marker)
		: false;
}

function markContinuationDelivered(prompt: string) {
	const marker = extractContinuationMarker(prompt);
	if (marker && goalRuntimeState.continuationPending?.marker === marker)
		goalRuntimeState.continuationPending = undefined;
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
	setFlowActivity("goal", false);
	setGoalActivityBox(ctx, undefined);
	closeGoalPlanWatcher();
	cancelGoalRecoveryTimers({ resetAutoResumeUse: true });
	cancelContinuationPending();
	cancelCompletionAudit();
	goalRuntimeState.activeGoal = undefined;
	clearPersistedGoal(ctx.cwd, ctx);
	stopGoalStatusTimer();
	clearCompletionStatusTimer();
	clearStatus(ctx, STATUS_KEY);
}

function showCompletionStatus(ctx: StatusContext) {
	clearCompletionStatusTimer();
	const language = goalRuntimeState.activeGoal?.language ?? runtimeLanguage();
	const text = language === "en" ? "🎯 Goal complete" : "🎯 目标已完成";
	if (!setStatusSafe(ctx, STATUS_KEY, text, language)) return;
	goalRuntimeState.completionStatusTimer = setTimeout(
		() => clearStatus(ctx, STATUS_KEY),
		8_000,
	);
}

function clearCompletionStatusTimer() {
	if (!goalRuntimeState.completionStatusTimer) return;
	clearTimeout(goalRuntimeState.completionStatusTimer);
	goalRuntimeState.completionStatusTimer = undefined;
}

function syncGoalStatusTimer(ctx: StatusContext, goal: ActiveGoal | undefined) {
	if (goal?.status !== "active") {
		stopGoalStatusTimer();
		return;
	}
	if (goalRuntimeState.goalStatusTimer) return;
	goalRuntimeState.goalStatusTimer = startElapsedStatus(
		ctx,
		STATUS_KEY,
		() => {
			if (goalRuntimeState.activeGoal)
				updateGoalElapsed(goalRuntimeState.activeGoal);
			return formatStatus(ctx, goalRuntimeState.activeGoal) ?? "";
		},
		{
			isActive: () => goalRuntimeState.activeGoal?.status === "active",
			language: goal.language,
		},
	);
}

function stopGoalStatusTimer() {
	if (!goalRuntimeState.goalStatusTimer) return;
	goalRuntimeState.goalStatusTimer.stop();
	goalRuntimeState.goalStatusTimer = undefined;
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
