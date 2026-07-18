import { existsSync } from "node:fs";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	advisorUnavailableNotice,
	consultAdvisor,
	isAdvisorEnabled,
} from "./goal/advisor.js";
import {
	hardCapStopReason,
	MAX_CONSECUTIVE_CHECK_FAILURES,
	shouldConsultAdvisor,
	trailingFailures,
} from "./goal/check-discipline.js";
import type { CheckModelOutcome, CheckRoundAdvisor } from "./goal/types.js";
import { aggregateReviewOutcomes } from "./review/aggregate.js";
import {
	REVIEW_CHECKPOINT_ENTRY_TYPE,
	ReviewCheckpointConflictError,
	type ReviewCheckpointState,
	readReviewCheckpoint,
	writeReviewCheckpoint,
} from "./review/checkpoint.js";
import { emptyReviewOutputOutcome } from "./review/outcome.js";
import { reviewReportPath, writeReviewReport } from "./review/report.js";
import type {
	FlowConfig,
	ReviewAgentEndResult,
	ReviewCancellationSource,
	ReviewHistoryEntry,
	ReviewLoop,
	ReviewLoopOptions,
	ReviewLoopStats,
	ReviewRoundFailedDirective,
	ReviewRunResult,
	ReviewStop,
} from "./review/types.js";
import {
	cancelNotification,
	cancelReview,
	displayPassReview,
	displayReviewWithInfra,
	reviewActivity,
	reviewErrorContent,
	reviewFailContent,
	reviewPassContent,
	sendReviewCard,
	sendReviewStartCard,
	startReviewStatus,
} from "./review/view.js";
import {
	agentEndedWithHardStop,
	agentEndedWithPiRetryableStop,
	agentEndedWithRecoverableTransportStop,
} from "./review-agent-event.js";
import {
	parseReviewOutcome,
	type ReviewOutcome,
	reviewAbortedOutcome,
	reviewFeedbackInstruction,
	reviewTimeoutOutcome,
} from "./review-outcome.js";
import {
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
} from "./shared/activity-frame.js";
import { requestPiAttention, setPiActivity } from "./shared/activity-signal.js";
import { advisorCardAdvice, sendAdvisorCard } from "./shared/advisor-card.js";
import {
	type AgentProgress,
	openProgressScope,
} from "./shared/agent-progress.js";
import {
	advisorConsultingLine,
	blockedOnUserRequest,
} from "./shared/check-feedback.js";
import {
	checkInputHash,
	settleCheckModel,
	startCheckRun,
} from "./shared/check-run.js";
import { clipSummary } from "./shared/clip.js";
import {
	advisorConsultModel,
	type Language,
	type ReviewerConfig,
	readFlowConfig,
} from "./shared/config.js";
import { buildContextEvidence } from "./shared/context-evidence.js";
import { formatError, isRecord } from "./shared/guards.js";
import { sendOrchestrationPrompt } from "./shared/internal-prompt.js";
import { runtimeLanguage } from "./shared/language.js";
import { autoOpenMonitorOverlay } from "./shared/monitor-overlay.js";
import { formatPlanEvidence } from "./shared/plan-evidence.js";
import { readPrompt } from "./shared/prompts.js";
import {
	liveReportUrl,
	releaseReportStatusContext,
} from "./shared/report-client.js";
import {
	checkResultDeliveryId,
	registerResultCardRenderer,
	resultCardDelivered,
	sendResultCard,
} from "./shared/result-card.js";
import {
	normalizedReviewLines,
	singleLineSummary,
	summarizeReviewText,
} from "./shared/review-format.js";
import { priorRoundsSection } from "./shared/review-history.js";
import {
	type ReviewProcessResult,
	runReviewProcessResult,
} from "./shared/review-process.js";
import {
	type ReviewerResult,
	type ReviewerStatus,
	reviewerActivityLine,
	reviewerLabel,
	runReviewerPool,
	shortModel,
} from "./shared/reviewer-pool.js";
import { registerRuntimePart } from "./shared/runtime-registration.js";
import {
	finalAssistantText,
	sessionEntries,
	sessionEntriesSince,
} from "./shared/session.js";
import {
	clearStatus,
	elapsedSeconds,
	formatDuration,
} from "./shared/status.js";
import {
	formatUserNotice,
	installLocalizedUi,
	localizeUserText,
	monitorDetailsHint,
	notifyUser,
} from "./shared/ui-language.js";

const REVIEW_STATUS_KEY = "review";
const REVIEW_ACTIVITY_SOURCE = "pi-flow:review";
const REVIEW_ATTEMPTS = 3;
const PI_RETRY_EXHAUSTION_GUARD_MS = 20_000;
let reviewRunning = false;
let runningReviewLoop: ReviewLoop | undefined;
let activeReviewLoop: ReviewLoop | undefined;
let reviewRetryExhaustionWatch: ReviewRetryExhaustionWatch | undefined;
let reviewRetryExhaustionGeneration = 0;
const handledReviewAgentEndEvents = new WeakMap<object, ReviewAgentEndResult>();
const reviewAgentEndSnapshots = new WeakMap<object, ReviewAgentEndSnapshot>();
const standaloneReviewReportFiles = new WeakMap<object, string>();
const standaloneReviewReportStatus = new WeakMap<object, Promise<void>>();
const standaloneReviewReportErrors = new WeakMap<object, string>();

function reviewNeedsInteractiveNotice(language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Quality check cannot start", [
				"Interactive mode is required",
			])
		: formatUserNotice("⚠️", "质检无法启动", ["需要交互模式"]);
}

function reviewRequestSendFailedNotice(error: string, language: Language) {
	return language === "en"
		? formatUserNotice("❌", "Review request send failed", [
				error,
				"Automatic quality check was cancelled",
			])
		: formatUserNotice("❌", "质检需求发送失败", [error, "已取消自动质检"]);
}

function reviewArmSaveFailedNotice(error: string, language: Language) {
	return language === "en"
		? formatUserNotice("❌", "Automatic quality check could not be enabled", [
				error,
				"No automatic quality check was scheduled",
			])
		: formatUserNotice("❌", "自动质检开启失败", [error, "未安排自动质检"]);
}

function reviewBusyNotice(language: Language) {
	return language === "en"
		? formatUserNotice("⏳", "Quality check is already running", [
				"Wait for the result",
			])
		: formatUserNotice("⏳", "质检循环已在运行", ["请等待结果"]);
}

function reviewDisabledNotice(language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Quality check is disabled", [])
		: formatUserNotice("⚠️", "质检已禁用", []);
}

interface ReviewRetryExhaustionWatch {
	loop: ReviewLoop;
	generation: number;
	timer: NodeJS.Timeout;
}

interface ReviewAgentEndSnapshot {
	loop: ReviewLoop | undefined;
	skip: boolean;
}

export default function reviewExtension(pi: ExtensionAPI) {
	registerReviewRuntime(pi);
	pi.on("session_start", (_event, ctx) => handleReviewSessionStart(pi, ctx));
	pi.registerCommand("review", {
		description:
			localizeUserText("运行质检或执行后自动质检") ??
			"运行质检或执行后自动质检",
		handler: (args, ctx) => handleReviewCommand(pi, args, ctx),
	});
}

export function registerReviewRuntime(pi: ExtensionAPI) {
	registerResultCardRenderer(pi);
	registerRuntimePart(pi, "review:session_shutdown", () => {
		pi.on("session_shutdown", async (_event, ctx) => {
			cancelReviewRetryExhaustionWatch();
			pendingReviewCheckResume = false;
			pendingReviewRestartRecovery = false;
			await stopReviewLoopsForShutdown();
			setPiActivity(REVIEW_ACTIVITY_SOURCE, false);
			setReviewActivityBox(ctx, undefined);
			clearFlowActivities();
			clearStatus(ctx, REVIEW_STATUS_KEY);
			releaseReportStatusContext(ctx);
		});
	});
	registerRuntimePart(pi, "review:agent_start", () => {
		pi.on("agent_start", (_event, ctx) => {
			cancelReviewRetryExhaustionWatch();
			const loop = activeReviewLoop;
			if (loop && isArmedStandaloneReview(loop))
				activateArmedStandaloneReview(ctx, loop);
		});
	});
	registerRuntimePart(pi, "review:turn_start", () => {
		pi.on("turn_start", () => cancelReviewRetryExhaustionWatch());
	});
	registerRuntimePart(pi, "review:message_start", () => {
		pi.on("message_start", (event) => {
			cancelReviewRetryExhaustionWatch();
			const loop = activeReviewLoop;
			if (
				loop &&
				isArmedStandaloneReview(loop) &&
				loop.skipNextAgentEnd &&
				event.message.role === "user"
			)
				loop.skipNextAgentEnd = false;
		});
	});
	registerRuntimePart(pi, "review:agent_end", () => {
		pi.on("agent_end", (event, ctx) => {
			scheduleContinueReviewAfterAgentEnd(pi, event, ctx);
		});
	});
}

export async function handleReviewSessionStart(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
) {
	cancelReviewRetryExhaustionWatch();
	await stopReviewLoopsForShutdown();
	clearStatus(ctx, REVIEW_STATUS_KEY);
	installFlowActivityFrame(ctx);
	pendingReviewCheckResume = false;
	pendingReviewRestartRecovery = false;
	if (readReviewCheckpoint(ctx))
		await restoreStandaloneReviewReportStatus(ctx, runtimeLanguage());
	resumeStandaloneReviewAfterRestart(pi, ctx);
}

export async function handleReviewCommand(
	pi: ExtensionAPI,
	args: string,
	ctx: ExtensionContext,
) {
	installLocalizedUi(ctx);
	installFlowActivityFrame(ctx);
	const language = runtimeLanguage();
	if (!ctx.hasUI)
		return notifyUser(
			ctx,
			reviewNeedsInteractiveNotice(language),
			"info",
			language,
		);
	if (reviewRunning || activeReviewLoop)
		return notifyUser(ctx, reviewBusyNotice(language), "info", language);

	const request = args.trim();
	const idle = ctx.isIdle();
	const shouldArm = request.length > 0 || !idle;
	const result = shouldArm
		? armStandaloneReview(pi, ctx, language)
		: await runConfiguredReview(pi, ctx, standaloneReviewOptions(pi, ctx));
	if (result.kind === "armed") {
		if (!request) return;
		result.loop.skipNextAgentEnd = !idle;
		try {
			pi.sendUserMessage(request, idle ? undefined : { deliverAs: "followUp" });
		} catch (error) {
			cancelReview(result.loop);
			await stopCancelledReview(
				ctx,
				result.loop,
				reviewRequestSendFailedNotice(formatError(error), language),
			);
		}
		return;
	}
	if (result.kind === "disabled")
		notifyUser(ctx, reviewDisabledNotice(language), "info", language);
	if (result.kind === "busy")
		notifyUser(ctx, reviewBusyNotice(language), "info", language);
	if (result.kind === "stopped" && result.stop.kind === "config_error")
		notifyUser(
			ctx,
			reviewConfigReadFailedNotice(result.stop.message, language),
			"info",
			language,
		);
}

function standaloneReviewOptions(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): ReviewLoopOptions {
	return {
		scope: { kind: "review" },
		onStart: (config) => sendReviewStartCard(pi, ctx, config),
		onRoundFailed: standaloneReviewRoundFailed(ctx),
	};
}

type ArmStandaloneReviewResult =
	| { kind: "armed"; loop: ReviewLoop }
	| { kind: "disabled" | "busy" | "checkpoint_error" }
	| {
			kind: "stopped";
			stop: { kind: "config_error"; message: string };
	  };

function armStandaloneReview(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	language: Language,
): ArmStandaloneReviewResult {
	let flowConfig: FlowConfig;
	try {
		flowConfig = readFlowConfig();
	} catch (error) {
		return {
			kind: "stopped",
			stop: { kind: "config_error", message: formatError(error) },
		};
	}
	if (!flowConfig.quality.enabled) return { kind: "disabled" };
	const checkpoint = readReviewCheckpoint(ctx);
	if (checkpoint?.phase || checkpoint?.active) return { kind: "busy" };
	const armed: ReviewCheckpointState = {
		active: null,
		round: 0,
		phase: "awaiting_agent",
		history: [],
	};
	try {
		writeReviewCheckpoint(pi, ctx, armed, null);
		void refreshStandaloneReviewReport(ctx, armed, language, flowConfig);
	} catch (error) {
		notifyUser(
			ctx,
			reviewArmSaveFailedNotice(formatError(error), language),
			"info",
			language,
		);
		return { kind: "checkpoint_error" };
	}
	const loop = restoreAwaitingStandaloneReview(pi, ctx, flowConfig, armed);
	activateArmedStandaloneReview(ctx, loop);
	sendReviewArmedCard(pi, ctx, language);
	return { kind: "armed", loop };
}

function restoreAwaitingStandaloneReview(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	flowConfig: FlowConfig,
	checkpoint: ReviewCheckpointState,
) {
	const loop = resumedAwaitingReviewLoop(
		pi,
		ctx,
		flowConfig,
		checkpoint.round,
		checkpoint.history,
	);
	activeReviewLoop = loop;
	return loop;
}

function isArmedStandaloneReview(loop: ReviewLoop) {
	return (
		loop.options.scope?.kind === "review" &&
		loop.round === 0 &&
		loop.awaitingAgent
	);
}

function activateArmedStandaloneReview(
	ctx: ExtensionContext,
	loop: ReviewLoop,
) {
	loop.stepStartedAt = Date.now();
	setPiActivity(REVIEW_ACTIVITY_SOURCE, true);
	setFlowActivity("review", true);
	setFlowEditorInputHidden(true);
	if (!loop.status) startReviewStatus(ctx, loop);
	else loop.status.refresh();
	setArmedStandaloneReviewCancelHandler(ctx, loop);
	setReviewActivityBox(ctx, reviewActivity(loop));
}

function setArmedStandaloneReviewCancelHandler(
	ctx: ExtensionContext,
	loop: ReviewLoop,
	captureWhenInputVisible = false,
) {
	setFlowCancelHandler(
		() => {
			cancelReview(loop);
			void stopCancelledReview(ctx, loop);
		},
		{ captureWhenInputVisible },
	);
}

function sendReviewArmedCard(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	language: Language,
) {
	const title =
		language === "en" ? "Automatic quality check enabled" : "已开启自动质检";
	const summary =
		language === "en"
			? "Automatically starts the quality-check loop after this request finishes"
			: "完成本次需求后自动进入质检循环";
	sendResultCard(pi, ctx, `[${title}]\n${summary}`, {
		tone: "neutral",
		result: "启动",
		title,
		lines: [summary],
		icon: "💯",
		language,
		context: "check-start",
	});
}

export async function runConfiguredReview(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: ReviewLoopOptions = {},
): Promise<ReviewRunResult> {
	if (reviewRunning || activeReviewLoop) return { kind: "busy" };
	let flowConfig: FlowConfig;
	try {
		flowConfig = readFlowConfig();
	} catch (error) {
		return {
			kind: "stopped",
			stop: { kind: "config_error", message: formatError(error) },
		};
	}
	if (!flowConfig.quality.enabled) return { kind: "disabled" };
	const resolvedOptions = reviewCheckpointOptions(pi, ctx, options);
	const initialHistory = resolvedOptions.initialHistory ?? [];
	let resolveFinished: () => void = () => undefined;
	const finished = new Promise<void>((resolve) => {
		resolveFinished = resolve;
	});
	const loop: ReviewLoop = {
		context: ctx,
		flowConfig,
		round:
			resolvedOptions.activeCheck?.round ?? nextReviewRound(initialHistory),
		repairs: 0,
		startedAt: Date.now(),
		stepStartedAt: Date.now(),
		awaitingAgent: false,
		skipNextAgentEnd: false,
		options: resolvedOptions,
		controller: new AbortController(),
		history: [...initialHistory],
		reviewerProgress: [],
		finished,
		resolveFinished,
	};
	if (flowConfig.quality.mode === "autoFix") activeReviewLoop = loop;
	try {
		await resolvedOptions.onRoundStart?.(loop.round);
	} catch (error) {
		completeReviewLoop(ctx, loop);
		throw error;
	}
	return runReviewRound(pi, ctx, loop);
}

function nextReviewRound(history: ReviewHistoryEntry[]) {
	return Math.max(0, ...history.map((item) => item.round)) + 1;
}

/** 重读并应用当前配置；非法或已停用时不更新循环。 */
function refreshReviewLoopConfig(
	loop: ReviewLoop,
): "ok" | "disabled" | { message: string } {
	try {
		const flowConfig = readFlowConfig();
		if (!flowConfig.quality.enabled) return "disabled";
		loop.flowConfig = flowConfig;
		return "ok";
	} catch (error) {
		return { message: formatError(error) };
	}
}

function reviewCheckpointOptions(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: ReviewLoopOptions,
): ReviewLoopOptions {
	void pi;
	if (options.scope?.kind === "goal") return options;
	const checkpoint = readReviewCheckpoint(ctx);
	const activeCheck = options.activeCheck ?? checkpoint?.active;
	// 只有接续在跑检查或中断的修复回合才继承历史；终态后的全新 /review 从空历史第 1 轮开始。
	const resumable = activeCheck || checkpoint?.phase === "awaiting_agent";
	return {
		...options,
		activeCheck,
		initialHistory:
			options.initialHistory ?? (resumable ? checkpoint?.history : undefined),
	};
}

/**
 * 重启后恢复独立 /review autoFix 循环：
 * - awaiting_agent：重建循环骨架，下一次 agent_end 自动进入下一轮质检。
 * - checking：在空闲时自动续跑未完成的 reviewer（durable checkpoint 幂等）。
 */
function resumeStandaloneReviewAfterRestart(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
) {
	let checkpoint: ReturnType<typeof readReviewCheckpoint>;
	try {
		checkpoint = readReviewCheckpoint(ctx);
	} catch {
		return;
	}
	if (!checkpoint || checkpoint.phase === null) return;
	let flowConfig: FlowConfig;
	try {
		flowConfig = readFlowConfig();
	} catch (error) {
		// 配置非法：保留 checkpoint 并显式报错；配置修复后由 agent_end 或 /review 幂等恢复。
		const language = runtimeLanguage();
		if (!pendingReviewRestartRecovery) {
			notifyUser(
				ctx,
				reviewConfigReadFailedNotice(formatError(error), language),
				"info",
				language,
			);
			requestPiAttention(REVIEW_ACTIVITY_SOURCE);
		}
		pendingReviewRestartRecovery = true;
		return;
	}
	pendingReviewRestartRecovery = false;
	if (!flowConfig.quality.enabled)
		return discardInterruptedReviewCheckpoint(
			ctx,
			checkpoint,
			"disabled",
			flowConfig,
		);
	if (checkpoint.phase === "awaiting_agent") {
		if (flowConfig.quality.mode !== "autoFix" && checkpoint.round !== 0)
			return discardInterruptedReviewCheckpoint(
				ctx,
				checkpoint,
				"mode",
				flowConfig,
			);
		if (reviewRunning || activeReviewLoop) return;
		const loop = restoreAwaitingStandaloneReview(
			pi,
			ctx,
			flowConfig,
			checkpoint,
		);
		if (isArmedStandaloneReview(loop))
			setArmedStandaloneReviewCancelHandler(ctx, loop, true);
		setReviewActivityBox(ctx, interruptedReviewActivity(loop));
		return;
	}
	setImmediate(() => {
		void resumeStandaloneReviewCheck(pi, ctx);
	});
}

/** checking 恢复被 busy 跳过后的待重试标记；由下一次 agent_end 幂等重试，不轮询。 */
let pendingReviewCheckResume = false;
/** 重启恢复因配置非法跳过后的待重试标记；配置修复后由下一次 agent_end 幂等重试，不轮询。 */
let pendingReviewRestartRecovery = false;

/** 停用或切换模式后中断的质检不再可恢复：清理 checkpoint，禁止旧循环意外复活。 */
function discardInterruptedReviewCheckpoint(
	ctx: ExtensionContext,
	checkpoint: ReviewCheckpointState,
	reason: "disabled" | "mode",
	flowConfig: FlowConfig,
) {
	const language = runtimeLanguage();
	try {
		const state: ReviewCheckpointState = {
			active: null,
			round: checkpoint.round,
			phase: null,
			history: checkpoint.history,
		};
		writeReviewCheckpoint(
			undefined,
			ctx,
			state,
			checkpoint.active?.generation ?? null,
		);
		void refreshStandaloneReviewReport(ctx, state, language, flowConfig);
	} catch (error) {
		notifyUser(
			ctx,
			reviewCheckpointSaveFailedNotice(formatError(error), language),
			"info",
			language,
		);
		return;
	}
	notifyUser(
		ctx,
		interruptedReviewDiscardedNotice(reason, language),
		"info",
		language,
	);
}

function interruptedReviewDiscardedNotice(
	reason: "disabled" | "mode",
	language: Language,
) {
	if (reason === "disabled")
		return language === "en"
			? formatUserNotice("⚠️", "Quality checks are disabled in config", [
					"The interrupted quality check was discarded",
				])
			: formatUserNotice("⚠️", "质检已在配置中停用", ["已终止中断的质检"]);
	return language === "en"
		? formatUserNotice("⚠️", "Quality mode changed in config", [
				"The interrupted auto-fix quality check was discarded",
			])
		: formatUserNotice("⚠️", "质检模式已在配置中切换", [
				"已终止中断的自动修复质检",
			]);
}

function resumedAwaitingReviewLoop(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	flowConfig: FlowConfig,
	round: number,
	history: ReviewHistoryEntry[],
): ReviewLoop {
	let resolveFinished: () => void = () => undefined;
	const finished = new Promise<void>((resolve) => {
		resolveFinished = resolve;
	});
	return {
		context: ctx,
		flowConfig,
		round: Math.max(0, round),
		repairs: 0,
		startedAt: Date.now(),
		stepStartedAt: Date.now(),
		awaitingAgent: true,
		skipNextAgentEnd: false,
		options: reviewCheckpointOptions(pi, ctx, {
			scope: { kind: "review" },
			onRoundFailed: standaloneReviewRoundFailed(ctx),
		}),
		controller: new AbortController(),
		history: [...history],
		reviewerProgress: [],
		finished,
		resolveFinished,
	};
}

/** 重启后真实状态：修复回合尚未继续，不显示火焰，提示恢复方式。 */
function interruptedReviewActivity(loop: ReviewLoop) {
	const language = reviewLanguage(loop);
	if (loop.round === 0)
		return {
			language,
			title:
				language === "en"
					? "💯 Automatic quality check · interrupted"
					: "💯 自动质检 · 已中断",
			rows: [
				language === "en"
					? "The request execution was interrupted"
					: "本次执行已中断",
				language === "en"
					? "Reply to continue; quality checks run automatically when done"
					: "直接回复继续，回复后自动质检",
			],
			hint: `${currentCancelHint()} ${
				language === "en" ? "cancel automatic quality check" : "取消自动质检"
			}`,
		};
	return {
		language,
		title:
			language === "en" ? "💯 Quality check · interrupted" : "💯 质检 · 已中断",
		rows: [
			language === "en"
				? `Round ${loop.round} fix is pending`
				: `第 ${loop.round} 轮修复待继续`,
			language === "en"
				? "Reply to continue; the next round runs automatically"
				: "直接回复继续修复，完成后自动进入下一轮质检",
		],
	};
}

/** checking 恢复被跳过时的真实状态：无火焰，告知自动/手动恢复入口。 */
function interruptedCheckingActivity(language: Language) {
	return {
		language,
		title:
			language === "en" ? "💯 Quality check · interrupted" : "💯 质检 · 已中断",
		rows: [
			language === "en"
				? "An interrupted check is waiting to resume"
				: "检查已中断，等待续跑",
			language === "en"
				? "It resumes when idle; run /review to resume now"
				: "空闲后自动继续，或运行 /review 立即继续",
		],
	};
}

async function resumeStandaloneReviewCheck(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
) {
	pendingReviewCheckResume = false;
	if (reviewRunning || activeReviewLoop) return;
	if ((ctx.isIdle && !ctx.isIdle()) || ctx.hasPendingMessages?.()) {
		pendingReviewCheckResume = true;
		setReviewActivityBox(ctx, interruptedCheckingActivity(runtimeLanguage()));
		return;
	}
	const result = await runConfiguredReview(pi, ctx, {
		scope: { kind: "review" },
		onRoundFailed: standaloneReviewRoundFailed(ctx),
	});
	if (result.kind === "stopped" && result.stop.kind === "config_error") {
		const language = runtimeLanguage();
		notifyUser(
			ctx,
			reviewConfigReadFailedNotice(result.stop.message, language),
			"info",
			language,
		);
	}
}

export function isReviewLoopActive() {
	return reviewRunning || activeReviewLoop !== undefined;
}

export function isGoalScopedReviewActive() {
	return (
		isGoalScopedLoop(runningReviewLoop) || isGoalScopedLoop(activeReviewLoop)
	);
}

function isGoalScopedLoop(loop: ReviewLoop | undefined) {
	return loop?.options.scope?.kind === "goal";
}

export async function stopGoalScopedReview(goalId: string) {
	const loops = activeReviewLoops().filter(
		(loop) =>
			loop.options.scope?.kind === "goal" &&
			loop.options.scope.goalId === goalId,
	);
	await stopReviewLoops(loops, "flow_stop");
	return loops.length > 0;
}

async function stopReviewLoopsForShutdown() {
	await stopReviewLoops(activeReviewLoops(), "shutdown");
}

function activeReviewLoops() {
	return [...new Set([runningReviewLoop, activeReviewLoop])].filter(
		(loop): loop is ReviewLoop => loop !== undefined,
	);
}

async function stopReviewLoops(
	loops: ReviewLoop[],
	source: ReviewCancellationSource,
) {
	for (const loop of loops) cancelReview(loop, source);
	await Promise.all(
		loops.map((loop) =>
			loop.awaitingAgent && !loop.handlingOutcome
				? stopReviewLoop(loop.context, loop, { kind: "cancelled", source })
				: loop.finished,
		),
	);
}

let scheduledReviewAgentEnd: Promise<ReviewAgentEndResult> | undefined;

export function scheduleContinueReviewAfterAgentEnd(
	pi: ExtensionAPI,
	event: { messages?: unknown },
	ctx: ExtensionContext,
) {
	const snapshot = captureReviewAgentEndSnapshot(event);
	scheduledReviewAgentEnd = new Promise((resolve) => {
		setImmediate(() => {
			void continueReviewAfterAgentEnd(pi, event, ctx, snapshot).then(resolve);
		});
	});
	return scheduledReviewAgentEnd;
}

function captureReviewAgentEndSnapshot(event: object): ReviewAgentEndSnapshot {
	// agent_end 延后收口；必须先冻结事件 owner，禁止后续 message_start 改写旧事件归属。
	const existing = reviewAgentEndSnapshots.get(event);
	if (existing) return existing;
	const loop = activeReviewLoop;
	const snapshot = { loop, skip: loop?.skipNextAgentEnd === true };
	if (snapshot.skip && loop) loop.skipNextAgentEnd = false;
	reviewAgentEndSnapshots.set(event, snapshot);
	return snapshot;
}

export function waitForScheduledReviewAgentEnd() {
	return scheduledReviewAgentEnd ?? Promise.resolve("none" as const);
}

export async function continueReviewAfterAgentEnd(
	pi: ExtensionAPI,
	event: { messages?: unknown },
	ctx: ExtensionContext,
	snapshot?: ReviewAgentEndSnapshot,
): Promise<ReviewAgentEndResult> {
	const eventKey =
		typeof event === "object" && event !== null ? event : undefined;
	const handled = eventKey
		? handledReviewAgentEndEvents.get(eventKey)
		: undefined;
	if (handled) return handled;
	const remember = (result: ReviewAgentEndResult) => {
		if (eventKey) handledReviewAgentEndEvents.set(eventKey, result);
		return result;
	};
	if (snapshot && activeReviewLoop !== snapshot.loop)
		return remember(reviewRunning ? "active" : "none");

	// 重启恢复曾因配置非法跳过：配置修复后在本次 agent_end 幂等重建循环并直接续跑下一轮。
	if (!activeReviewLoop && pendingReviewRestartRecovery && !reviewRunning)
		resumeStandaloneReviewAfterRestart(pi, ctx);
	const loop = activeReviewLoop;
	if (!loop) {
		// checking 恢复曾因 busy 跳过：在下一次 agent_end（已空闲）幂等重试，不轮询。
		if (pendingReviewCheckResume && !reviewRunning)
			void resumeStandaloneReviewCheck(pi, ctx);
		return remember(reviewRunning ? "active" : "none");
	}
	if (!loop.awaitingAgent) return remember("active");
	if (loop.cancellationSource) {
		await stopReviewLoop(ctx, loop, {
			kind: "cancelled",
			source: loop.cancellationSource,
		});
		return remember("handled");
	}
	if (snapshot?.skip || loop.skipNextAgentEnd) {
		loop.skipNextAgentEnd = false;
		return remember("skipped");
	}
	if (
		agentEndedWithRecoverableTransportStop(event) ||
		agentEndedWithPiRetryableStop(event)
	) {
		scheduleReviewRetryExhaustionWatch(ctx, loop);
		if (!loop.recoverableTransportNotified) {
			const language = reviewLanguage(loop);
			loop.recoverableTransportNotified = true;
			notifyUser(ctx, reviewRetryWaitingNotice(language), "info", language);
		}
		return remember("active");
	}
	cancelReviewRetryExhaustionWatch(loop);
	// BLOCKED 接管协议：修复回合声明阻塞于用户操作，不再送检，停循环交还用户。
	const blockedReason = blockedOnUserRequest(
		finalAssistantText(
			Array.isArray((event as { messages?: unknown }).messages)
				? ((event as { messages: unknown[] }).messages ?? [])
				: [],
		),
	);
	if (blockedReason) {
		const language = reviewLanguage(loop);
		await stopReviewLoop(ctx, loop, {
			kind: "user_action",
			message: blockedReason,
		});
		await notifyStandaloneReviewTerminal(
			ctx,
			loop,
			reviewUserActionNotice(blockedReason, language),
		);
		requestStandaloneReviewAttention(loop);
		return remember("handled");
	}
	if (agentEndedWithHardStop(event)) {
		const language = reviewLanguage(loop);
		const stop: ReviewStop = {
			kind: "hard_stop",
			message: reviewStoppedReason(language, "hard_stop"),
		};
		await stopReviewLoop(ctx, loop, stop);
		await notifyStandaloneReviewTerminal(
			ctx,
			loop,
			reviewStoppedNotice(language, "hard_stop"),
		);
		requestStandaloneReviewAttention(loop);
		return remember("handled");
	}
	// 修复回合后重读配置：与重启恢复/验收路径一致，配置变化下一轮生效，非法配置结构化收口而非继续用旧 reviewer。
	const refreshed = refreshReviewLoopConfig(loop);
	if (refreshed !== "ok") {
		const language = reviewLanguage(loop);
		const stop: Exclude<ReviewStop, { kind: "cancelled" }> = {
			kind: "config_error",
			message:
				refreshed === "disabled"
					? language === "en"
						? "Quality checks were disabled in config"
						: "质检已在配置中停用"
					: refreshed.message,
		};
		await stopReviewLoop(ctx, loop, stop);
		await notifyStandaloneReviewTerminal(
			ctx,
			loop,
			reviewConfigReadFailedNotice(stop.message, language),
		);
		requestStandaloneReviewAttention(loop);
		return remember("handled");
	}
	loop.awaitingAgent = false;
	loop.round += 1;
	try {
		await loop.options.onRoundStart?.(loop.round);
		await runReviewRound(pi, ctx, loop);
	} catch (error) {
		await stopReviewAfterSystemError(pi, ctx, loop, formatError(error));
	}
	return remember("handled");
}

function scheduleReviewRetryExhaustionWatch(
	ctx: ExtensionContext,
	loop: ReviewLoop,
) {
	cancelReviewRetryExhaustionWatch(loop);
	const generation = nextReviewRetryExhaustionGeneration();
	const timer = setTimeout(() => {
		void stopReviewAfterRetryExhaustion(ctx, loop, generation);
	}, PI_RETRY_EXHAUSTION_GUARD_MS);
	timer.unref?.();
	reviewRetryExhaustionWatch = { loop, generation, timer };
}

async function stopReviewAfterRetryExhaustion(
	ctx: ExtensionContext,
	loop: ReviewLoop,
	generation: number,
) {
	const watch = reviewRetryExhaustionWatch;
	if (!watch || watch.loop !== loop || watch.generation !== generation) return;
	reviewRetryExhaustionWatch = undefined;
	if (activeReviewLoop !== loop || !loop.awaitingAgent) return;
	const language = reviewLanguage(loop);
	const stop: ReviewStop = {
		kind: "retry_exhausted",
		message: reviewStoppedReason(language, "retry_exhausted"),
	};
	await stopReviewLoop(ctx, loop, stop);
	await notifyStandaloneReviewTerminal(
		ctx,
		loop,
		reviewStoppedNotice(language, "retry_exhausted"),
	);
	requestStandaloneReviewAttention(loop);
}

function reviewConfigReadFailedNotice(error: string, language: Language) {
	return language === "en"
		? formatUserNotice("❌", "Quality check config read failed", [error])
		: formatUserNotice("❌", "质检配置读取失败", [error]);
}

function reviewRetryWaitingNotice(language: Language) {
	return language === "en"
		? formatUserNotice("⏳", "Quality check auto loop is still waiting", [
				"Waiting for Pi to retry automatically",
				"Not stopped",
			])
		: formatUserNotice("⏳", "质检自动循环仍在等待", [
				"等待 Pi 自动重试",
				"未停止",
			]);
}

function reviewStoppedNotice(
	language: Language,
	reason: "hard_stop" | "retry_exhausted",
) {
	const reasonLine = reviewStoppedReason(language, reason);
	return formatUserNotice(
		"⚠️",
		language === "en"
			? "Quality check auto loop stopped"
			: "质检自动循环已停止",
		[reasonLine],
	);
}

function reviewStoppedReason(
	language: Language,
	reason: "hard_stop" | "retry_exhausted",
) {
	return language === "en"
		? reason === "hard_stop"
			? "AI interrupted or failed"
			: "Pi automatic retries are exhausted"
		: reason === "hard_stop"
			? "AI 中断或失败"
			: "Pi 自动重试耗尽";
}

function cancelReviewRetryExhaustionWatch(loop?: ReviewLoop) {
	const watch = reviewRetryExhaustionWatch;
	if (!watch || (loop && watch.loop !== loop)) return;
	clearTimeout(watch.timer);
	reviewRetryExhaustionWatch = undefined;
	nextReviewRetryExhaustionGeneration();
}

function nextReviewRetryExhaustionGeneration() {
	reviewRetryExhaustionGeneration += 1;
	return reviewRetryExhaustionGeneration;
}

async function runReviewRound(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	loop: ReviewLoop,
): Promise<ReviewRunResult> {
	loop.stepStartedAt = Date.now();
	loop.status?.refresh();
	reviewRunning = true;
	runningReviewLoop = loop;
	let activityStarted = false;
	let outcome: ReviewOutcome | { kind: "checkpoint_deferred" };
	try {
		const prepared = await prepareReviewRound(ctx, loop);
		if (!prepared) {
			outcome = { kind: "checkpoint_deferred" };
		} else {
			if (!loop.startPublished) {
				await loop.options.onStart?.(loop.flowConfig);
				loop.startPublished = true;
			}
			setPiActivity(REVIEW_ACTIVITY_SOURCE, true);
			if (!loop.status) startReviewStatus(ctx, loop);
			setFlowActivity("review", true);
			setFlowEditorInputHidden(true);
			setFlowCancelHandler(() => cancelReview(loop));
			setQualityActivityBox(ctx, loop);
			activityStarted = true;
			outcome = await runReviewWithRetry(ctx, loop, prepared);
			if (loop.cancellationSource)
				outcome = reviewAbortedOutcome(reviewLanguage(loop));
		}
	} catch (error) {
		return stopReviewAfterSystemError(pi, ctx, loop, formatError(error));
	} finally {
		if (activityStarted) {
			setReviewActivityBox(ctx, undefined);
			setFlowActivity("review", false);
		}
		reviewRunning = false;
		if (runningReviewLoop === loop) runningReviewLoop = undefined;
		setFlowEditorInputHidden(false);
		setFlowCancelHandler(undefined);
	}
	if (outcome.kind === "checkpoint_deferred")
		return deferReviewAfterCheckpointFailure(ctx, loop);
	loop.handlingOutcome = true;
	try {
		return await handleReviewOutcome(pi, ctx, loop, outcome);
	} catch (error) {
		return stopReviewAfterSystemError(pi, ctx, loop, formatError(error));
	} finally {
		loop.handlingOutcome = false;
	}
}

function setQualityActivityBox(ctx: ExtensionContext, loop: ReviewLoop) {
	if (loop.options.scope?.kind === "goal") setGoalActivityBox(ctx, undefined);
	setReviewActivityBox(ctx, reviewActivity(loop));
}

function buildReviewPrompt(
	ctx: ExtensionContext,
	loop: ReviewLoop,
): { ok: true; prompt: string } | { ok: false; message: string } {
	const language = reviewLanguage(loop);
	const { fixedPrompt, evidence } = buildReviewEvidence(
		ctx,
		loop.flowConfig,
		loop.options.scope,
		loop.history,
		loop.round,
		language,
	);
	return evidence.ok
		? { ok: true, prompt: `${fixedPrompt}${evidence.packet.text}` }
		: { ok: false, message: evidence.error.message };
}

function buildReviewEvidence(
	ctx: ExtensionContext,
	flowConfig: FlowConfig,
	scope: ReviewLoopOptions["scope"],
	history: ReviewHistoryEntry[],
	round: number,
	language: Language,
	entries = sessionEntriesSince(
		ctx,
		scope?.kind === "goal" ? scope.sessionAnchorId : undefined,
	),
) {
	const separator = language === "en" ? ":" : "：";
	const priorRounds = priorRoundsSection(history, round, language);
	const fixedPrompt = `${readPrompt("review", language)}\n\n${language === "en" ? "Review target" : "审查对象"}${separator}\n${reviewScopeText(scope, language)}${priorRounds ? `\n\n${priorRounds}` : ""}\n\n${language === "en" ? "Context Evidence" : "上下文证据"}${separator}\n`;
	return {
		fixedPrompt,
		evidence: buildContextEvidence({
			entries,
			projection: "review",
			language,
			modelReferences: flowConfig.modelRoles.reviewers.map(
				(reviewer) => reviewer.model,
			),
			modelRegistry: ctx.modelRegistry,
			fixedPrompt,
		}),
	};
}

function reviewLanguage(loop: ReviewLoop) {
	return loop.options.scope?.language ?? runtimeLanguage();
}

function reviewScopeText(
	scope: ReviewLoopOptions["scope"],
	language: Language,
) {
	if (scope?.kind === "goal") {
		const plan = formatPlanEvidence(scope.plan, language);
		const changeNote = scope.planChangeNote;
		if (language === "en")
			return [
				"Delivery quality for the following goal.",
				"",
				`<goal>\n${scope.goalText}\n</goal>`,
				plan ? `\n${plan}` : "",
				changeNote ? `\n${changeNote}` : "",
				"",
				"The goal text limits issue relevance; the plan limits scope, steps, and acceptance criteria. Report only issues that affect this goal's delivery quality. Do not request new features, refactors, or optimizations outside the goal.",
				"Scope completeness was already gated by the prior acceptance check: do not re-verify requirement coverage item by item. The acceptance verdict is not your evidence either; only files you actually read and commands you actually ran are. If you find concrete evidence that a requirement is actually unmet, report it as High severity.",
				"Focus on implementation quality: logic defects, edge cases, error handling, races, fake or insufficient tests, regression risk.",
			].join("\n");
		return [
			"以下目标对应的交付质量。",
			"",
			`<goal>\n${scope.goalText}\n</goal>`,
			plan ? `\n${plan}` : "",
			changeNote ? `\n${changeNote}` : "",
			"",
			"目标文本用于限定质量问题的相关性；计划用于限定 scope、步骤和验收口径。只报告影响该目标交付质量的问题。不要要求超出目标的新功能、新重构或新优化。",
			"范围完整性已由前置验收把关：不要重复逐项验证需求覆盖。验收结论也不是你的证据，只有你实际读取的文件和实际运行的命令才是；若发现具体证据表明某项要求实际未完成，按高严重度报告。",
			"重心放在实现质量：逻辑缺陷、边界条件、错误处理、竞态、虚假或不充分的测试、回归风险。",
		].join("\n");
	}
	if (language === "en")
		return [
			"Delivery quality for the current task in this conversation.",
			"",
			"Judgment criteria:",
			"- Whether the original user request is satisfied.",
			"- Whether later user additions, narrowing, or corrections are satisfied; later user messages may override, narrow, or correct the original request.",
			"- The latest assistant final reply is a delivery claim, not the only review target; key claims must be supported by factual evidence.",
			"- Whether any issue still requires the original execution model to continue working.",
			"",
			"Evidence rules:",
			"- The first user message is the original-request anchor.",
			"- Context Evidence records sourced branch events and coverage; actual file content and commands you run remain the strongest evidence.",
			"- Assistant claims of completion or tests passing are not evidence.",
			"",
			"Do not report:",
			"- Issues already fixed later.",
			"- Old requirements the user abandoned or overrode.",
			"- Generic optimizations unrelated to the current task.",
		].join("\n");
	return [
		"当前会话当前任务的交付质量。",
		"",
		"判断标准：",
		"- 是否满足用户原始需求。",
		"- 是否满足后续用户补充、缩小、纠正后的当前范围；后续用户消息可能覆盖、缩小或修正原始需求，以后者为准。",
		"- 最近 assistant 最终回复是交付声明，不是唯一审查对象；其关键声明必须有事实证据支持。",
		"- 是否还有需要原执行模型继续处理的问题。",
		"",
		"证据规则：",
		"- 首条用户消息是原始需求锚点。",
		"- 上下文证据记录有来源的 branch 事件与 coverage；你实际读取的文件和实际运行的命令仍是最强证据。",
		"- assistant 自称完成或测试通过不是证据。",
		"",
		"不要报告：",
		"- 已被后续修复的问题。",
		"- 用户已经放弃或覆盖的旧要求。",
		"- 与当前任务无关的泛化优化。",
	].join("\n");
}

interface PreparedReviewRound {
	prompt: string;
	active: NonNullable<ReviewLoop["activeCheck"]>;
}

async function prepareReviewRound(
	ctx: ExtensionContext,
	loop: ReviewLoop,
): Promise<PreparedReviewRound | undefined> {
	const promptResult = buildReviewPrompt(ctx, loop);
	if (!promptResult.ok) throw new Error(promptResult.message);
	const prompt = promptResult.prompt;
	const prior = loop.activeCheck ?? loop.options.activeCheck;
	const active = startCheckRun(
		prior,
		loop.round,
		checkInputHash("quality", prompt),
		loop.flowConfig.modelRoles.reviewers,
	);
	loop.activeCheck = active;
	if (!(await persistReviewCheckpoint(loop, active, prior?.generation ?? null)))
		return undefined;
	return { prompt, active };
}

async function runReviewWithRetry(
	ctx: ExtensionContext,
	loop: ReviewLoop,
	prepared: PreparedReviewRound,
): Promise<ReviewOutcome | { kind: "checkpoint_deferred" }> {
	const { prompt } = prepared;
	let { active } = prepared;
	let checkpointDeferred = false;
	const reviewers = loop.flowConfig.modelRoles.reviewers;
	const progressScope = openProgressScope(
		"quality",
		qualityProgressLabel(loop.round, reviewLanguage(loop)),
	);
	const progressAgents = reviewers.map((reviewer, index) =>
		progressScope.register(`M${index + 1}`, reviewerLabel(reviewer)),
	);
	for (const [index, model] of active.models.entries())
		if (model.outcome)
			progressScope.finish(`M${index + 1}`, model.outcome.result === "error");
	autoOpenMonitorOverlay(ctx, progressScope.id, reviewLanguage(loop));
	let results: ReviewerResult<ReviewOutcome>[];
	try {
		results = await runReviewerPool({
			reviewers,
			run: (reviewer, index, refresh) =>
				runSingleReviewWithRetry(reviewer, prompt, ctx, loop, (event) => {
					const before = progressAgents[index]?.current;
					progressScope.feed(`M${index + 1}`, event);
					if (progressAgents[index]?.current !== before) refresh();
				}),
			statusOf: reviewOutcomeStatus,
			summaryOf: reviewOutcomeSummary,
			initialResults: active.models.map((model) =>
				model.outcome ? reviewFromCheckOutcome(model.outcome) : undefined,
			),
			onSettled: async (settled) => {
				progressScope.finish(
					`M${settled.index + 1}`,
					settled.status === "error",
				);
				if (loop.controller.signal.aborted) return;
				const next = settleCheckModel(
					active,
					active.generation,
					settled.index,
					reviewCheckOutcome(settled.result),
				);
				if (!next) throw new Error("质检 checkpoint generation 已失效");
				active = next;
				loop.activeCheck = active;
				if (!(await persistReviewCheckpoint(loop, active, active.generation))) {
					checkpointDeferred = true;
					loop.controller.abort();
				}
			},
			onUpdate: (progress) => {
				if (loop.controller.signal.aborted) return;
				loop.reviewerProgress = progress;
				setQualityActivityBox(ctx, loop);
				loop.options.onProgress?.(progress, [...loop.history]);
			},
			activityOf: (_reviewer, index) => progressAgents[index]?.current,
		});
	} finally {
		progressScope.close();
	}
	return checkpointDeferred
		? { kind: "checkpoint_deferred" }
		: aggregateReviewOutcomes(results, reviewLanguage(loop));
}

/**
 * 单次 durable 状态转换：独立 /review 的 active+phase 原子写入同一条 checkpoint，
 * 禁止先落 `phase:null` 再补新阶段的伪终态窗口。
 */
async function persistReviewCheckpoint(
	loop: ReviewLoop,
	active: ReviewLoop["activeCheck"] | null,
	expectedGeneration: string | null,
	phase: "checking" | "awaiting_agent" | null = active ? "checking" : null,
	history: ReviewHistoryEntry[] = loop.history,
) {
	if (loop.options.scope?.kind !== "goal")
		try {
			const state: ReviewCheckpointState = {
				active: active ?? null,
				round: loop.round,
				phase,
				history,
			};
			writeReviewCheckpoint(undefined, loop.context, state, expectedGeneration);
			await refreshStandaloneReviewReport(
				loop.context,
				state,
				reviewLanguage(loop),
				loop.flowConfig,
			);
		} catch (error) {
			// 持久化失败不是 reviewer 系统错误：保留旧 checkpoint 走 deferred，重启后幂等重收口。
			if (!(error instanceof ReviewCheckpointConflictError))
				notifyUser(
					loop.context,
					reviewCheckpointSaveFailedNotice(
						formatError(error),
						reviewLanguage(loop),
					),
					"info",
					reviewLanguage(loop),
				);
			return false;
		}
	return (
		(await loop.options.onCheckRun?.(
			active ?? null,
			[...history],
			expectedGeneration,
			phase,
		)) !== "deferred"
	);
}

async function runSingleReviewWithRetry(
	reviewer: ReviewerConfig,
	prompt: string,
	ctx: ExtensionContext,
	loop: ReviewLoop,
	onEvent?: (event: unknown) => void,
) {
	const language = reviewLanguage(loop);
	let outcome: ReviewOutcome = reviewTimeoutOutcome(language);
	for (let attempt = 1; attempt <= REVIEW_ATTEMPTS; attempt += 1) {
		outcome = processOutcome(
			await runReviewProcessResult(
				reviewer,
				prompt,
				ctx.cwd,
				loop.controller.signal,
				onEvent,
			),
			language,
		);
		if (!shouldRetryReview(outcome) || attempt === REVIEW_ATTEMPTS) break;
	}
	return annotateAttempts(outcome, language);
}

function qualityProgressLabel(round: number, language: Language) {
	return language === "en"
		? `Quality check · Round ${round}`
		: `第 ${round} 轮质检`;
}

function processOutcome(
	result: ReviewProcessResult,
	language: ReturnType<typeof reviewLanguage>,
): ReviewOutcome {
	if (result.kind === "timeout") return reviewTimeoutOutcome(language);
	if (result.kind === "aborted") return reviewAbortedOutcome(language);
	if (result.kind === "empty_output")
		return emptyReviewOutputOutcome(result.stderr, language);
	return parseReviewOutcome(result.text, language);
}

function shouldRetryReview(outcome: ReviewOutcome) {
	if (outcome.kind !== "system_error") return false;
	return (
		outcome.notification.startsWith("review 输出为空") ||
		outcome.notification.startsWith("review output is empty") ||
		outcome.notification.startsWith("review 子进程超时") ||
		outcome.notification.startsWith("review subprocess timed out") ||
		outcome.notification.startsWith("Review failed to start:") ||
		outcome.notification.startsWith("Review failed with exit") ||
		outcome.notification.startsWith("Review terminated by signal")
	);
}

function annotateAttempts(
	outcome: ReviewOutcome,
	language: ReturnType<typeof reviewLanguage>,
): ReviewOutcome {
	if (outcome.kind !== "system_error") return outcome;
	if (!shouldRetryReview(outcome)) return outcome;
	return {
		...outcome,
		notification: `${outcome.notification}${attemptsSuffix(language)}`,
	};
}

function attemptsSuffix(language: ReturnType<typeof reviewLanguage>) {
	return language === "en"
		? ` (tried ${REVIEW_ATTEMPTS} times)`
		: `（已尝试 ${REVIEW_ATTEMPTS} 次）`;
}

function reviewCheckOutcome(outcome: ReviewOutcome): CheckModelOutcome {
	if (outcome.kind === "pass")
		return {
			result: "passed",
			summary: reviewOutcomeSummary(outcome) ?? "",
			details: outcome.summary,
		};
	if (outcome.kind === "needs_changes")
		return {
			result: "failed",
			summary: reviewOutcomeSummary(outcome) ?? "",
			details: outcome.review,
		};
	if (outcome.kind === "system_error")
		return {
			result: "error",
			summary: reviewOutcomeSummary(outcome) ?? "",
			details: outcome.notification,
		};
	throw new Error("已取消的质检模型不能写入 checkpoint");
}

function reviewFromCheckOutcome(outcome: CheckModelOutcome): ReviewOutcome {
	if (outcome.result === "passed")
		return { kind: "pass", summary: outcome.details };
	if (outcome.result === "failed")
		return { kind: "needs_changes", review: outcome.details };
	return { kind: "system_error", notification: outcome.details };
}

function reviewOutcomeStatus(outcome: ReviewOutcome): ReviewerStatus {
	if (outcome.kind === "pass") return "passed";
	if (outcome.kind === "needs_changes") return "failed";
	return "error";
}

function reviewOutcomeSummary(outcome: ReviewOutcome) {
	if (outcome.kind === "pass") return shortReviewSummary(outcome.summary);
	if (outcome.kind === "needs_changes")
		return shortReviewSummary(outcome.review);
	if (outcome.kind === "system_error")
		return shortReviewSummary(outcome.notification);
	return outcome.notification;
}

function shortReviewSummary(text: string) {
	const lines = normalizedReviewLines(text).filter(Boolean);
	const issue = lines.find((line) => /^•?\s*(问题|Issue):/u.test(line));
	return clipSummary(
		issue?.replace(/^•?\s*(问题|Issue):\s*/u, "") ?? lines[0] ?? "",
	);
}

async function handleReviewOutcome(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	loop: ReviewLoop,
	outcome: ReviewOutcome,
): Promise<ReviewRunResult> {
	if (outcome.kind === "cancelled") return stopCancelledReview(ctx, loop);
	if (outcome.kind === "system_error")
		return stopReviewAfterSystemError(pi, ctx, loop, outcome.notification);
	if (outcome.kind === "pass") return passReview(pi, ctx, loop, outcome);
	if (loop.flowConfig.quality.mode === "autoFix")
		return failAutoReview(pi, ctx, loop, outcome);
	return failSemiReview(pi, ctx, loop, outcome);
}

async function stopReviewAfterSystemError(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	loop: ReviewLoop,
	message: string,
): Promise<ReviewRunResult> {
	const stop: Exclude<ReviewStop, { kind: "cancelled" }> = {
		kind: "system_error",
		message,
	};
	if (loop.cancellationSource) return stopCancelledReview(ctx, loop);
	const history = reviewHistoryAfter(loop, "error", message, message);
	const deliveryId = reviewDeliveryId(loop, "stopped");
	const displayReview =
		reviewLanguage(loop) === "en" ? `Reason: ${message}` : `原因：${message}`;
	const delivered = loop.options.onStopFeedback
		? await loop.options.onStopFeedback(stop, history, deliveryId)
		: reviewResultDelivered(ctx, deliveryId, () =>
				sendReviewCard(pi, ctx, loop, "错误", message, {
					content: reviewErrorContent(loop, message),
					displayReview,
					deliveryId,
				}),
			);
	if (!delivered) return deferReviewAfterDeliveryFailure(ctx, loop);
	stop.feedbackDelivered = true;
	stop.expectedGeneration = loop.activeCheck?.generation;
	if (loop.options.scope?.kind === "goal") loop.history = history;
	else
		try {
			if (!(await persistReviewHistory(loop, history, null)))
				return deferReviewAfterCheckpointFailure(ctx, loop);
		} catch {
			return deferReviewAfterCheckpointFailure(ctx, loop);
		}
	await stopReviewLoop(ctx, loop, stop);
	requestStandaloneReviewAttention(loop);
	return { kind: "stopped", stop };
}

async function passReview(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	loop: ReviewLoop,
	outcome: Extract<ReviewOutcome, { kind: "pass" }>,
): Promise<ReviewRunResult> {
	const language = reviewLanguage(loop);
	const summary =
		outcome.summary ||
		(language === "en" ? "Quality check passed." : "质检通过。");
	const displayReview = displayPassReview(
		summary,
		outcome.infraErrors,
		language,
		outcome.details,
	);
	if (loop.cancellationSource) return stopCancelledReview(ctx, loop);
	// 先带 receipt 发卡再清 checkpoint：投递失败保留可恢复状态，恢复时 runId 沿用、receipt 幂等不重发。
	const deliveryId = reviewDeliveryId(loop, "passed");
	if (
		!reviewResultDelivered(ctx, deliveryId, () =>
			sendReviewCard(pi, ctx, loop, "通过", summary, {
				triggerTurn: loop.options.scope?.kind !== "goal",
				content: reviewPassContent(loop, summary, outcome.infraErrors),
				displayReview,
				deliveryId,
			}),
		)
	)
		return deferReviewAfterDeliveryFailure(ctx, loop);
	if (!(await recordReviewHistory(loop, "passed", summary, displayReview)))
		return deferReviewAfterCheckpointFailure(ctx, loop);
	// stats 必须在通过轮写入 history 之后取，否则 onPass/返回值丢失最终轮次。
	const stats = reviewLoopStats(loop);
	await loop.options.onPass?.(stats, summary);
	completeReviewLoop(ctx, loop);
	return { kind: "passed", stats, summary };
}

function reviewDeliveryId(
	loop: ReviewLoop,
	kind: "passed" | "failed" | "repair" | "stopped",
) {
	const active = loop.activeCheck;
	return active
		? checkResultDeliveryId("quality", active.runId, kind)
		: undefined;
}

function reviewResultDelivered(
	ctx: ExtensionContext,
	deliveryId: string | undefined,
	send: () => { delivered: boolean },
) {
	return (
		(deliveryId ? resultCardDelivered(ctx, deliveryId) : false) ||
		send().delivered
	);
}

async function failAutoReview(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	loop: ReviewLoop,
	outcome: Extract<ReviewOutcome, { kind: "needs_changes" }>,
): Promise<ReviewRunResult> {
	const language = reviewLanguage(loop);
	const displayReview = displayReviewWithInfra(outcome, language);
	const summary = summarizeReviewText(
		outcome.review,
		language === "en" ? "Quality check failed." : "质检未通过。",
	);
	const failureDeliveryId = reviewDeliveryId(loop, "failed");
	let history = reviewHistoryAfter(loop, "failed", summary, displayReview);
	const directive =
		(await loop.options.onRoundFailed?.(
			loop.round,
			[...history],
			loop.controller.signal,
		)) ?? {};
	if (loop.cancellationSource) return stopCancelledReview(ctx, loop);
	if (directive.stopMessage) {
		const stop: Exclude<ReviewStop, { kind: "cancelled" }> = {
			kind: "check_limit",
			message: directive.stopMessage,
		};
		const deliveryId = reviewDeliveryId(loop, "stopped");
		const delivered = loop.options.onStopFeedback
			? await loop.options.onStopFeedback(stop, [...history], deliveryId)
			: reviewResultDelivered(ctx, deliveryId, () =>
					sendReviewCard(pi, ctx, loop, "未通过", outcome.review, {
						content: reviewFailContent(loop, outcome.review),
						displayReview,
						deliveryId,
					}),
				);
		if (!delivered) return deferReviewAfterDeliveryFailure(ctx, loop);
		stop.feedbackDelivered = true;
		stop.expectedGeneration = loop.activeCheck?.generation;
		if (loop.options.scope?.kind === "goal") loop.history = history;
		else if (!(await persistReviewHistory(loop, history, null)))
			return deferReviewAfterCheckpointFailure(ctx, loop);
		await loop.options.onRoundFailedDelivered?.(loop.round, [...history]);
		await stopReviewLoop(ctx, loop, stop);
		if (loop.options.scope?.kind !== "goal")
			notifyUser(
				ctx,
				reviewCheckLimitNotice(stop.message, language),
				"info",
				language,
			);
		requestStandaloneReviewAttention(loop);
		return { kind: "stopped", stop };
	}
	if (loop.options.deferNextAgentEnd) {
		loop.skipNextAgentEnd = true;
		loop.options.deferNextAgentEnd = false;
	}
	if (!directive.consultAdvisor) {
		if (
			!reviewResultDelivered(ctx, failureDeliveryId, () =>
				sendReviewCard(pi, ctx, loop, "未通过", outcome.review, {
					triggerTurn: true,
					content: reviewFailContent(loop, outcome.review, directive),
					deliverAs: loop.skipNextAgentEnd ? "followUp" : undefined,
					displayReview,
					deliveryId: failureDeliveryId,
				}),
			)
		)
			return deferReviewAfterDeliveryFailure(ctx, loop);
	} else {
		const failures = trailingFailures(history);
		if (
			!reviewResultDelivered(ctx, failureDeliveryId, () =>
				sendReviewCard(pi, ctx, loop, "未通过", outcome.review, {
					content: reviewFailContent(loop, outcome.review, directive),
					displayReview,
					deliveryId: failureDeliveryId,
					footerLines: [advisorConsultingLine(failures, language)],
				}),
			)
		)
			return deferReviewAfterDeliveryFailure(ctx, loop);
		const repairDeliveryId = reviewDeliveryId(loop, "repair");
		const recoveredAdvice = repairDeliveryId
			? advisorCardAdvice(ctx, repairDeliveryId)
			: undefined;
		const advice =
			recoveredAdvice ??
			(await directive.consultAdvisor(loop.controller.signal));
		if (loop.cancellationSource) return stopCancelledReview(ctx, loop);
		if (advice) history = appendAdviceToHistory(loop, history, advice);
		const repairPrompt = reviewFailContent(loop, outcome.review, {
			advice,
			extraPromptLines: directive.extraPromptLines,
		});
		if (advice) {
			if (
				!recoveredAdvice &&
				!sendAdvisorCard(pi, ctx, {
					advice,
					language,
					content: repairPrompt,
					deliveryId: repairDeliveryId,
					triggerTurn: true,
					deliverAs: loop.skipNextAgentEnd ? "followUp" : undefined,
				}).delivered
			)
				return deferReviewAfterDeliveryFailure(ctx, loop);
		} else if (
			!sendOrchestrationPrompt(pi, ctx, repairPrompt, {
				followUp: loop.skipNextAgentEnd,
				errorPrefix:
					language === "en"
						? "Quality repair prompt send failed"
						: "质检修复提示发送失败",
				language,
			})
		)
			return deferReviewAfterDeliveryFailure(ctx, loop);
	}
	if (!(await persistReviewHistory(loop, history, "awaiting_agent")))
		return deferReviewAfterCheckpointFailure(ctx, loop);
	await loop.options.onRoundFailedDelivered?.(loop.round, [...history]);
	loop.repairs += 1;
	loop.awaitingAgent = true;
	await loop.options.onAwaitingAgent?.();
	if (loop.cancellationSource) return stopCancelledReview(ctx, loop);
	loop.stepStartedAt = Date.now();
	loop.status?.refresh();
	setQualityActivityBox(ctx, loop);
	return { kind: "awaiting_agent" };
}

async function failSemiReview(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	loop: ReviewLoop,
	outcome: Extract<ReviewOutcome, { kind: "needs_changes" }>,
): Promise<ReviewRunResult> {
	const language = reviewLanguage(loop);
	const displayReview = displayReviewWithInfra(outcome, language);
	const deliveryId = reviewDeliveryId(loop, "failed");
	if (
		!reviewResultDelivered(ctx, deliveryId, () =>
			sendReviewCard(pi, ctx, loop, "未通过", outcome.review, {
				content: reviewFailContent(loop, outcome.review),
				displayReview,
				deliveryId,
			}),
		)
	)
		return deferReviewAfterDeliveryFailure(ctx, loop);
	if (
		!(await recordReviewHistory(
			loop,
			"failed",
			summarizeReviewText(
				outcome.review,
				language === "en" ? "Quality check failed." : "质检未通过。",
			),
			displayReview,
		))
	)
		return deferReviewAfterCheckpointFailure(ctx, loop);
	if (loop.cancellationSource) return stopCancelledReview(ctx, loop);
	ctx.ui.setEditorText(
		`${reviewFeedbackInstruction(
			language,
			loop.options.scope?.kind === "goal",
		)}\n\n${outcome.review}`,
	);
	completeReviewLoop(ctx, loop);
	requestStandaloneReviewAttention(loop);
	return { kind: "needs_user" };
}

async function stopCancelledReview(
	ctx: ExtensionContext,
	loop: ReviewLoop,
	successNotice?: string,
): Promise<ReviewRunResult> {
	const stop: ReviewStop = {
		kind: "cancelled",
		source: loop.cancellationSource ?? "user",
		expectedGeneration: loop.activeCheck?.generation,
	};
	let checkpointError: unknown;
	let checkpointConflict = false;
	if (stop.source === "user")
		try {
			checkpointConflict =
				persistStandaloneReviewPhase(loop, null) === "conflict";
		} catch (error) {
			checkpointError = error;
		}
	await stopReviewLoop(ctx, loop, stop);
	if (stop.source === "user" && loop.options.scope?.kind !== "goal") {
		const language = reviewLanguage(loop);
		const notice = checkpointError
			? reviewCancellationSaveFailedNotice(
					formatError(checkpointError),
					language,
				)
			: checkpointConflict
				? reviewCancellationConflictNotice(language)
				: (successNotice ?? cancelNotification(loop));
		await notifyStandaloneReviewTerminal(ctx, loop, notice);
		if (checkpointError || checkpointConflict)
			requestStandaloneReviewAttention(loop);
	}
	return { kind: "stopped", stop };
}

function deferReviewAfterCheckpointFailure(
	ctx: ExtensionContext,
	loop: ReviewLoop,
): ReviewRunResult {
	completeReviewLoop(ctx, loop);
	return { kind: "checkpoint_deferred" };
}

function deferReviewAfterDeliveryFailure(
	ctx: ExtensionContext,
	loop: ReviewLoop,
): ReviewRunResult {
	completeReviewLoop(ctx, loop);
	requestStandaloneReviewAttention(loop);
	return { kind: "awaiting_delivery" };
}

function completeReviewLoop(ctx: ExtensionContext, loop: ReviewLoop) {
	finishReviewLoop(ctx, loop);
	loop.resolveFinished();
}

function finishReviewLoop(ctx: ExtensionContext, loop: ReviewLoop) {
	cancelReviewRetryExhaustionWatch(loop);
	clearActiveReviewLoop(loop);
	setPiActivity(REVIEW_ACTIVITY_SOURCE, false);
	setFlowActivity("review", false);
	setFlowCancelHandler(undefined);
	setReviewActivityBox(ctx, undefined);
	loop.status?.stop();
	loop.status = undefined;
	clearStatus(ctx, REVIEW_STATUS_KEY);
}

function clearActiveReviewLoop(loop: ReviewLoop) {
	if (activeReviewLoop === loop) activeReviewLoop = undefined;
	setFlowEditorInputHidden(reviewRunning);
}

function requestStandaloneReviewAttention(loop: ReviewLoop) {
	if (loop.options.scope?.kind !== "goal")
		requestPiAttention(REVIEW_ACTIVITY_SOURCE);
}

async function stopReviewLoop(
	ctx: ExtensionContext,
	loop: ReviewLoop,
	stop: ReviewStop,
) {
	if (!loop.stopPromise)
		loop.stopPromise = (async () => {
			// 终态停止清除 durable 阶段；被动中断（shutdown/flow_stop）保留以便重启恢复。
			if (stop.kind !== "cancelled")
				try {
					const result = persistStandaloneReviewPhase(loop, null);
					if (result === "conflict")
						reportReviewStopStateSaveFailure(
							loop,
							"checkpoint generation 已变化",
						);
				} catch (error) {
					reportReviewStopStateSaveFailure(loop, formatError(error));
				}
			finishReviewLoop(ctx, loop);
			await loop.options.onStop?.(stop, [...loop.history]);
			loop.resolveFinished();
		})();
	await loop.stopPromise;
}

/** 只写独立 /review 的循环阶段；generation 冲突不覆盖更新 owner。 */
function persistStandaloneReviewPhase(
	loop: ReviewLoop,
	phase: "awaiting_agent" | null,
): "saved" | "conflict" {
	if (loop.options.scope?.kind === "goal") return "saved";
	try {
		const state: ReviewCheckpointState = {
			active: null,
			round: loop.round,
			phase,
			history: loop.history,
		};
		writeReviewCheckpoint(
			undefined,
			loop.context,
			state,
			loop.activeCheck?.generation ?? null,
		);
		void refreshStandaloneReviewReport(
			loop.context,
			state,
			reviewLanguage(loop),
			loop.flowConfig,
		);
		return "saved";
	} catch (error) {
		if (error instanceof ReviewCheckpointConflictError) return "conflict";
		throw error;
	}
}

function reviewEvidenceEntries(
	ctx: ExtensionContext,
	state: ReviewCheckpointState,
) {
	const entries = sessionEntries(ctx);
	const generation =
		state.active?.generation ?? latestReviewGeneration(entries, state.round);
	if (!generation) return entries;
	const checkStart = entries.findIndex(
		(entry) => reviewCheckpointGeneration(entry) === generation,
	);
	return checkStart === -1 ? entries : entries.slice(0, checkStart);
}

function latestReviewGeneration(
	entries: ReturnType<typeof sessionEntries>,
	round: number,
) {
	let currentCheckpointSeen = false;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!isRecord(entry) || !isReviewCheckpointEntry(entry)) continue;
		if (!currentCheckpointSeen) {
			currentCheckpointSeen = true;
			continue;
		}
		const checkpoint = isRecord(entry.data) ? entry.data : undefined;
		const active = checkpoint?.active;
		if (isRecord(active) && active.round === round)
			return typeof active.generation === "string"
				? active.generation
				: undefined;
		if (checkpoint?.active === null && checkpoint.phase === null)
			return undefined;
	}
	return undefined;
}

function reviewCheckpointGeneration(entry: unknown) {
	if (!isRecord(entry) || !isReviewCheckpointEntry(entry)) return undefined;
	const active = isRecord(entry.data) ? entry.data.active : undefined;
	return isRecord(active) && typeof active.generation === "string"
		? active.generation
		: undefined;
}

function isReviewCheckpointEntry(entry: Record<string, unknown>) {
	return (
		entry.type === "custom" && entry.customType === REVIEW_CHECKPOINT_ENTRY_TYPE
	);
}

async function refreshStandaloneReviewReport(
	ctx: ExtensionContext,
	state: ReviewCheckpointState,
	language: Language,
	flowConfig: FlowConfig,
) {
	try {
		const { evidence } = buildReviewEvidence(
			ctx,
			flowConfig,
			{ kind: "review", language },
			state.history,
			state.round,
			language,
			reviewEvidenceEntries(ctx, state),
		);
		standaloneReviewReportFiles.set(
			ctx,
			writeReviewReport(ctx, state, language, evidence),
		);
		standaloneReviewReportErrors.delete(ctx);
		const status = ensureStandaloneReviewReportStatus(ctx, language);
		standaloneReviewReportStatus.set(ctx, status);
		await status;
	} catch (error) {
		notifyStandaloneReviewReportFailure(ctx, formatError(error), language);
	}
}

async function notifyStandaloneReviewTerminal(
	ctx: ExtensionContext,
	loop: ReviewLoop,
	notice: string,
) {
	if (loop.options.scope?.kind === "goal") return;
	const language = reviewLanguage(loop);
	await standaloneReviewReportStatus.get(ctx);
	notifyUser(ctx, notice, "info", language);
}

async function restoreStandaloneReviewReportStatus(
	ctx: ExtensionContext,
	language: Language,
) {
	let path: string;
	try {
		path = reviewReportPath(ctx);
	} catch {
		return;
	}
	if (!existsSync(path)) return;
	standaloneReviewReportFiles.set(ctx, path);
	await ensureStandaloneReviewReportStatus(ctx, language);
}

async function ensureStandaloneReviewReportStatus(
	ctx: ExtensionContext,
	language: Language,
) {
	const path = standaloneReviewReportFiles.get(ctx);
	if (!path) return;
	try {
		await liveReportUrl(ctx, path, language);
	} catch (error) {
		notifyStandaloneReviewReportFailure(ctx, formatError(error), language);
	}
}

function notifyStandaloneReviewReportFailure(
	ctx: ExtensionContext,
	error: string,
	language: Language,
) {
	if (standaloneReviewReportErrors.get(ctx) === error) return;
	standaloneReviewReportErrors.set(ctx, error);
	const notice =
		language === "en"
			? formatUserNotice("⚠️", "Quality report refresh failed", [
					error,
					"The quality check continues; the session checkpoint is unaffected",
				])
			: formatUserNotice("⚠️", "质检报告刷新失败", [
					error,
					"质检继续运行，已保存的质检状态不受影响",
				]);
	notifyUser(ctx, notice, "info", language);
}

function reviewCheckpointSaveFailedNotice(error: string, language: Language) {
	return language === "en"
		? formatUserNotice("❌", "Quality check state save failed", [
				error,
				"The recoverable checkpoint was preserved; it resumes after restart",
			])
		: formatUserNotice("❌", "质检状态保存失败", [
				error,
				"已保留可恢复 checkpoint，重启会话后自动恢复",
			]);
}

function reviewCancellationSaveFailedNotice(error: string, language: Language) {
	return language === "en"
		? formatUserNotice("❌", "Quality cancellation state save failed", [
				error,
				"The recoverable checkpoint was preserved",
			])
		: formatUserNotice("❌", "质检取消状态保存失败", [
				error,
				"已保留可恢复 checkpoint",
			]);
}

function reviewCancellationConflictNotice(language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Quality cancellation state changed", [
				"The latest recoverable checkpoint was preserved; cancel again if needed",
			])
		: formatUserNotice("⚠️", "质检取消状态已变化", [
				"已保留最新可恢复 checkpoint；如仍需取消，请重试",
			]);
}

function reportReviewStopStateSaveFailure(loop: ReviewLoop, error: string) {
	if (loop.options.scope?.kind === "goal") return;
	const language = reviewLanguage(loop);
	const message =
		language === "en"
			? formatUserNotice("❌", "Quality stop state save failed", [
					error,
					"The recoverable checkpoint was preserved",
				])
			: formatUserNotice("❌", "质检停止状态保存失败", [
					error,
					"已保留可恢复 checkpoint",
				]);
	notifyUser(loop.context, message, "info", language);
	requestStandaloneReviewAttention(loop);
}

function reviewLoopStats(loop: ReviewLoop): ReviewLoopStats {
	return {
		rounds: loop.round,
		repairs: loop.repairs,
		total: formatDuration(elapsedSeconds(loop.startedAt)),
		history: [...loop.history],
	};
}

function reviewHistoryAfter(
	loop: ReviewLoop,
	result: ReviewHistoryEntry["result"],
	summary: string,
	details?: string,
) {
	const trimmedDetails = details?.trim();
	const models = loop.reviewerProgress.map((model) => ({
		label: model.label,
		status: reviewHistoryModelStatus(model.status),
		...(model.summary ? { summary: model.summary } : {}),
		...(model.thinking ? { thinking: model.thinking } : {}),
	}));
	const startedAt = loop.activeCheck?.startedAt ?? loop.stepStartedAt;
	return [
		...loop.history.filter((item) => item.round !== loop.round),
		{
			round: loop.round,
			result,
			summary: singleLineSummary(summary),
			...(trimmedDetails ? { details: trimmedDetails } : {}),
			...(models.length > 0 ? { models } : {}),
			elapsedMs: Date.now() - startedAt,
		},
	];
}

function reviewCheckLimitNotice(reason: string, language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Quality check auto-paused", [
				reason,
				"Run /review again after handling the findings",
			])
		: formatUserNotice("⚠️", "质检已自动暂停", [
				reason,
				"处理后重新运行 /review",
			]);
}

function reviewUserActionNotice(reason: string, language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Your action needed", [
				reason,
				"Run /review again afterwards",
			])
		: formatUserNotice("⚠️", "需要你操作", [reason, "完成后重新运行 /review"]);
}

/**
 * 独立 /review 的停滞自愈（与 Flow 检查同一节奏）：连续 2/4/6/8 轮未通过咨询顾问，
 * 10 轮硬停；无计划 Success Criteria 可修订，故不注入修订许可。
 */
function standaloneReviewRoundFailed(ctx: ExtensionContext) {
	return async (
		_round: number,
		history: ReviewHistoryEntry[],
		_signal: AbortSignal,
	): Promise<ReviewRoundFailedDirective> => {
		const failures = trailingFailures(history);
		const language = runtimeLanguage();
		if (failures >= MAX_CONSECUTIVE_CHECK_FAILURES)
			return { stopMessage: hardCapStopReason(failures, language) };
		if (!shouldConsultAdvisor(failures) || !isAdvisorEnabled()) return {};
		return {
			consultAdvisor: (signal) =>
				consultAdvisorForStandaloneReview(
					ctx,
					failures,
					history,
					signal,
					language,
				),
		};
	};
}

/** 咨询期间挂「顾问介入中」活动框；Esc 只跳过本次咨询，不取消质检。 */
async function consultAdvisorForStandaloneReview(
	ctx: ExtensionContext,
	failures: number,
	history: ReviewHistoryEntry[],
	signal: AbortSignal,
	language: Language,
): Promise<CheckRoundAdvisor | undefined> {
	if (!shouldConsultAdvisor(failures) || !isAdvisorEnabled()) return undefined;
	const skip = new AbortController();
	const consultSignal = AbortSignal.any([signal, skip.signal]);
	const restoreInputHidden = isFlowEditorInputHidden();
	setReviewActivityBox(ctx, standaloneAdvisorActivity(ctx, failures, language));
	setFlowEditorInputHidden(true);
	setFlowCancelHandler(() => skip.abort());
	try {
		const result = await consultAdvisor({
			goalText:
				language === "en"
					? "Standalone quality check: the delivered work quality of the current session (no Flow plan)."
					: "独立质检：当前会话的交付质量（无 Flow 计划）。",
			language,
			failureHistory: history
				.filter((entry) => entry.result === "failed")
				.map((entry) => ({ phase: "quality" as const, entry })),
			ctx,
			signal: consultSignal,
			onProgress: (progress) =>
				setReviewActivityBox(
					ctx,
					standaloneAdvisorActivity(ctx, failures, language, progress),
				),
		});
		if (result.kind === "advice") return result.advice;
		if (result.kind === "aborted") return undefined;
		notifyUser(
			ctx,
			advisorUnavailableNotice(result.reason, language),
			"info",
			language,
		);
		return undefined;
	} finally {
		setFlowCancelHandler(undefined);
		setFlowEditorInputHidden(restoreInputHidden);
		setReviewActivityBox(ctx, undefined);
	}
}

function standaloneAdvisorActivity(
	ctx: ExtensionContext,
	failures: number,
	language: Language,
	progress?: AgentProgress,
) {
	let model: ReturnType<typeof advisorConsultModel> | undefined;
	try {
		model = advisorConsultModel(readFlowConfig());
	} catch {
		model = undefined;
	}
	return {
		title: language === "en" ? "🧭 Advisor consulting" : "🧭 顾问介入中",
		rows: activityRows([
			...(model && progress
				? [
						reviewerActivityLine(
							shortModel(model.model),
							progress,
							language,
							ctx.cwd,
						),
					]
				: []),
			language === "en"
				? `Quality checks failed ${failures} rounds in a row`
				: `质检已连续 ${failures} 轮未通过`,
		]),
		hint: `${currentCancelHint()} ${language === "en" ? "skip consult" : "跳过咨询"} · ${monitorDetailsHint(language)}`,
		flame: true,
		language,
	};
}

function appendAdviceToHistory(
	loop: ReviewLoop,
	history: ReviewHistoryEntry[],
	advice: CheckRoundAdvisor,
) {
	return history.map((item) =>
		item.round === loop.round ? { ...item, advisor: advice } : item,
	);
}

async function persistReviewHistory(
	loop: ReviewLoop,
	history: ReviewHistoryEntry[],
	nextPhase: "awaiting_agent" | null,
) {
	const generation = loop.activeCheck?.generation ?? null;
	if (
		!(await persistReviewCheckpoint(loop, null, generation, nextPhase, history))
	)
		return false;
	loop.history = history;
	loop.activeCheck = undefined;
	loop.options.onProgress?.([...loop.reviewerProgress], [...loop.history]);
	return true;
}

async function recordReviewHistory(
	loop: ReviewLoop,
	result: ReviewHistoryEntry["result"],
	summary: string,
	details?: string,
	nextPhase: "awaiting_agent" | null = null,
) {
	return persistReviewHistory(
		loop,
		reviewHistoryAfter(loop, result, summary, details),
		nextPhase,
	);
}

function reviewHistoryModelStatus(
	status: ReviewerStatus,
): ReviewHistoryEntry["result"] {
	if (status === "passed") return "passed";
	if (status === "failed") return "failed";
	return "error";
}

export type { ReviewLoopStats, ReviewStop } from "./review/types.js";
export { runReviewProcess } from "./shared/review-process.js";
