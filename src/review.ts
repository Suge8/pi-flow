import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { aggregateReviewOutcomes } from "./review/aggregate.js";
import { emptyReviewOutputOutcome } from "./review/outcome.js";
import type {
	FlowConfig,
	ReviewAgentEndResult,
	ReviewHistoryEntry,
	ReviewLoop,
	ReviewLoopOptions,
	ReviewLoopStats,
	ReviewRunResult,
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
	stripApplyInstruction,
} from "./review-outcome.js";
import {
	installFlowActivityFrame,
	setFlowActivity,
	setFlowCancelHandler,
	setFlowEditorInputHidden,
	setGoalActivityBox,
	setReviewActivityBox,
} from "./shared/activity-frame.js";
import { clipSummary } from "./shared/clip.js";
import { type ReviewerConfig, readFlowConfig } from "./shared/config.js";
import { formatError } from "./shared/guards.js";
import { runtimeLanguage } from "./shared/language.js";
import { formatPlanEvidence } from "./shared/plan-evidence.js";
import { readPrompt } from "./shared/prompts.js";
import { registerResultCardRenderer } from "./shared/result-card.js";
import {
	normalizedReviewLines,
	singleLineSummary,
	summarizeReviewText,
} from "./shared/review-format.js";
import {
	type ReviewProcessResult,
	runReviewProcessResult,
} from "./shared/review-process.js";
import {
	type ReviewerStatus,
	runReviewerPool,
} from "./shared/reviewer-pool.js";
import { buildFilesSection, buildTranscript } from "./shared/session.js";
import {
	clearStatus,
	elapsedSeconds,
	formatDuration,
} from "./shared/status.js";
import {
	installLocalizedUi,
	localizeUserText,
	notifyUser,
} from "./shared/ui-language.js";

const REVIEW_STATUS_KEY = "review";
const REVIEW_ATTEMPTS = 3;
const PI_RETRY_EXHAUSTION_GUARD_MS = 20_000;
let reviewRunning = false;
let runningReviewLoop: ReviewLoop | undefined;
let activeReviewLoop: ReviewLoop | undefined;
let reviewRetryExhaustionWatch: ReviewRetryExhaustionWatch | undefined;
let reviewRetryExhaustionGeneration = 0;
const handledReviewAgentEndEvents = new WeakMap<object, ReviewAgentEndResult>();

interface ReviewRetryExhaustionWatch {
	loop: ReviewLoop;
	generation: number;
	timer: NodeJS.Timeout;
}

export default function reviewExtension(pi: ExtensionAPI) {
	registerResultCardRenderer(pi);
	pi.on("session_start", (_event, ctx) => {
		cancelReviewRetryExhaustionWatch();
		activeReviewLoop?.controller.abort();
		activeReviewLoop?.status?.stop();
		activeReviewLoop = undefined;
		clearStatus(ctx, REVIEW_STATUS_KEY);
		installFlowActivityFrame(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		cancelReviewRetryExhaustionWatch();
		activeReviewLoop?.controller.abort();
		activeReviewLoop?.status?.stop();
		activeReviewLoop = undefined;
		setReviewActivityBox(ctx, undefined);
		setFlowEditorInputHidden(false);
		setFlowCancelHandler(undefined);
		clearStatus(ctx, REVIEW_STATUS_KEY);
	});
	pi.on("agent_start", () => cancelReviewRetryExhaustionWatch());
	pi.on("turn_start", () => cancelReviewRetryExhaustionWatch());
	pi.on("message_start", () => cancelReviewRetryExhaustionWatch());
	pi.on("agent_end", (event, ctx) => {
		scheduleContinueReviewAfterAgentEnd(pi, event, ctx);
	});

	pi.registerCommand("review", {
		description: localizeUserText("运行质量检查") ?? "运行质量检查",
		handler: async (_args, ctx) => {
			installLocalizedUi(ctx);
			if (!ctx.hasUI) return ctx.ui.notify("质量检查需要交互模式。", "error");
			if (!ctx.isIdle())
				return ctx.ui.notify("请等当前轮次结束后再运行 /review。", "error");
			if (reviewRunning || activeReviewLoop)
				return ctx.ui.notify("质量检查循环已在运行，请等待结果", "warning");

			sendReviewStartCard(pi, ctx);
			const result = await runConfiguredReview(pi, ctx, {
				scope: { kind: "review" },
			});
			if (result.kind === "disabled")
				ctx.ui.notify("质量检查已禁用", "warning");
			if (result.kind === "busy")
				ctx.ui.notify("质量检查循环已在运行，请等待结果", "warning");
			if (result.kind === "stopped" && result.message)
				ctx.ui.notify(result.message, "error");
		},
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
		return { kind: "stopped", message: formatError(error) };
	}
	if (!flowConfig.quality.enabled) return { kind: "disabled" };

	const initialHistory = options.initialHistory ?? [];
	const loop: ReviewLoop = {
		flowConfig,
		round: nextReviewRound(initialHistory),
		repairs: 0,
		startedAt: Date.now(),
		stepStartedAt: Date.now(),
		awaitingAgent: false,
		skipNextAgentEnd: false,
		options,
		controller: new AbortController(),
		history: [...initialHistory],
		reviewerProgress: [],
	};
	await options.onRoundStart?.(loop.round);
	startReviewStatus(ctx, loop);
	if (flowConfig.quality.mode === "autoFix") activeReviewLoop = loop;
	return runReviewRound(pi, ctx, loop);
}

function nextReviewRound(history: ReviewHistoryEntry[]) {
	return Math.max(0, ...history.map((item) => item.round)) + 1;
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

let scheduledReviewAgentEnd: Promise<ReviewAgentEndResult> | undefined;

export function scheduleContinueReviewAfterAgentEnd(
	pi: ExtensionAPI,
	event: { messages?: unknown },
	ctx: ExtensionContext,
) {
	scheduledReviewAgentEnd = new Promise((resolve) => {
		setImmediate(() => {
			void continueReviewAfterAgentEnd(pi, event, ctx).then(resolve);
		});
	});
	return scheduledReviewAgentEnd;
}

export function waitForScheduledReviewAgentEnd() {
	return scheduledReviewAgentEnd ?? Promise.resolve("none" as const);
}

export async function continueReviewAfterAgentEnd(
	pi: ExtensionAPI,
	event: { messages?: unknown },
	ctx: ExtensionContext,
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

	const loop = activeReviewLoop;
	if (!loop) return remember(reviewRunning ? "active" : "none");
	if (!loop.awaitingAgent) return remember("active");
	if (loop.skipNextAgentEnd) {
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
			notifyUser(
				ctx,
				language === "en"
					? "Quality check auto loop is still waiting: waiting for Pi to retry automatically; not stopped."
					: "质量检查自动循环仍在等待：等待 Pi 自动重试，未停止。",
				"info",
				language,
			);
		}
		return remember("active");
	}
	cancelReviewRetryExhaustionWatch(loop);
	if (agentEndedWithHardStop(event)) {
		const language = reviewLanguage(loop);
		await stopReviewLoop(ctx, loop);
		notifyUser(
			ctx,
			language === "en"
				? "Quality check auto loop stopped: AI interrupted or failed."
				: "质量检查自动循环已停止：AI 中断或失败。",
			"warning",
			language,
		);
		return remember("handled");
	}
	loop.awaitingAgent = false;
	loop.round += 1;
	await loop.options.onRoundStart?.(loop.round);
	await runReviewRound(pi, ctx, loop);
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
	const message =
		language === "en"
			? "Quality check auto loop stopped: Pi automatic retries are exhausted."
			: "质量检查自动循环已停止：Pi 自动重试耗尽。";
	await stopReviewLoop(ctx, loop, message);
	notifyUser(ctx, message, "warning", language);
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
	setFlowActivity("review", true);
	setFlowEditorInputHidden(true);
	setFlowCancelHandler(() => cancelReview(loop));
	setQualityActivityBox(ctx, loop);
	let outcome: ReviewOutcome;
	try {
		outcome = await runReviewWithRetry(ctx, loop);
	} catch (error) {
		const language = reviewLanguage(loop);
		const message =
			language === "en"
				? `Quality check failed: ${formatError(error)}`
				: `质量检查失败：${formatError(error)}`;
		recordReviewHistory(loop, "error", message, message);
		sendReviewCard(pi, ctx, loop, "错误", message, {
			content: reviewErrorContent(loop, message),
		});
		await stopReviewLoop(ctx, loop, message);
		notifyUser(ctx, message, "error", language);
		return { kind: "stopped" };
	} finally {
		setReviewActivityBox(ctx, undefined);
		setFlowActivity("review", false);
		reviewRunning = false;
		if (runningReviewLoop === loop) runningReviewLoop = undefined;
		setFlowEditorInputHidden(false);
		setFlowCancelHandler(undefined);
	}
	return handleReviewOutcome(pi, ctx, loop, outcome);
}

function setQualityActivityBox(ctx: ExtensionContext, loop: ReviewLoop) {
	if (loop.options.scope?.kind === "goal") setGoalActivityBox(ctx, undefined);
	setReviewActivityBox(ctx, reviewActivity(loop));
}

function buildReviewPrompt(ctx: ExtensionContext, loop: ReviewLoop) {
	const branch = ctx.sessionManager.getBranch();
	const transcript = stripApplyInstruction(
		buildTranscript(branch, loop.flowConfig.transcript),
	);
	const language = reviewLanguage(loop);
	const separator = language === "en" ? ":" : "：";
	return `${readPrompt("review", language)}\n\n${language === "en" ? "Review target" : "审查对象"}${separator}\n${reviewScopeText(loop)}\n\n${language === "en" ? "Transcript" : "会话记录"}${separator}\n${transcript}\n\n${buildFilesSection(branch, language)}`;
}

function reviewLanguage(loop: ReviewLoop) {
	return loop.options.scope?.language ?? runtimeLanguage();
}

function reviewScopeText(loop: ReviewLoop) {
	const language = reviewLanguage(loop);
	if (loop.options.scope?.kind === "goal") {
		const plan = formatPlanEvidence(loop.options.scope.plan, language);
		if (language === "en")
			return [
				"Delivery quality for the following goal.",
				"",
				`<goal>\n${loop.options.scope.goalText}\n</goal>`,
				plan ? `\n${plan}` : "",
				"",
				"The goal text limits issue relevance; the plan limits scope, steps, and acceptance criteria. Report only issues that affect this goal's delivery quality. Do not request new features, refactors, or optimizations outside the goal.",
				"The prior completion-acceptance result is only workflow state and must not be used as quality-pass evidence.",
			].join("\n");
		return [
			"以下目标对应的交付质量。",
			"",
			`<goal>\n${loop.options.scope.goalText}\n</goal>`,
			plan ? `\n${plan}` : "",
			"",
			"目标文本用于限定质量问题的相关性；计划用于限定 scope、步骤和验收口径。只报告影响该目标交付质量的问题。不要要求超出目标的新功能、新重构或新优化。",
			"前置完成验收结果只表示流程状态，不得作为质量通过证据。",
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
			"- Transcript and Files are clues; actual file content and real test/build/verification command output are stronger evidence.",
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
		"- Transcript 和 Files 是线索；实际文件内容、真实测试/构建/验证命令输出是更强证据。",
		"- assistant 自称完成或测试通过不是证据。",
		"",
		"不要报告：",
		"- 已被后续修复的问题。",
		"- 用户已经放弃或覆盖的旧要求。",
		"- 与当前任务无关的泛化优化。",
	].join("\n");
}

async function runReviewWithRetry(ctx: ExtensionContext, loop: ReviewLoop) {
	const prompt = buildReviewPrompt(ctx, loop);
	const results = await runReviewerPool({
		reviewers: loop.flowConfig.models,
		run: (reviewer) => runSingleReviewWithRetry(reviewer, prompt, ctx, loop),
		statusOf: reviewOutcomeStatus,
		summaryOf: reviewOutcomeSummary,
		onUpdate: (progress) => {
			if (loop.controller.signal.aborted) return;
			loop.reviewerProgress = progress;
			setQualityActivityBox(ctx, loop);
			loop.options.onProgress?.(progress, [...loop.history]);
		},
	});
	return aggregateReviewOutcomes(results, reviewLanguage(loop));
}

async function runSingleReviewWithRetry(
	reviewer: ReviewerConfig,
	prompt: string,
	ctx: ExtensionContext,
	loop: ReviewLoop,
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
			),
			language,
		);
		if (!shouldRetryReview(outcome) || attempt === REVIEW_ATTEMPTS) break;
	}
	return annotateAttempts(outcome, language);
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
		outcome.notification.startsWith("Review failed with exit")
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
	if (outcome.kind === "cancelled") {
		const message = cancelNotification(loop);
		recordReviewHistory(loop, "error", message, message);
		sendReviewCard(pi, ctx, loop, "错误", message, {
			content: reviewErrorContent(loop, message),
		});
		await stopReviewLoop(ctx, loop, message);
		notifyUser(ctx, message, "info", reviewLanguage(loop));
		return { kind: "stopped" };
	}
	if (outcome.kind === "system_error") {
		recordReviewHistory(
			loop,
			"error",
			outcome.notification,
			outcome.notification,
		);
		sendReviewCard(pi, ctx, loop, "错误", outcome.notification, {
			content: reviewErrorContent(loop, outcome.notification),
		});
		await stopReviewLoop(ctx, loop, outcome.notification);
		notifyUser(ctx, outcome.notification, "error", reviewLanguage(loop));
		return { kind: "stopped" };
	}
	if (outcome.kind === "pass") return passReview(pi, ctx, loop, outcome);
	if (loop.flowConfig.quality.mode === "autoFix")
		return failAutoReview(pi, ctx, loop, outcome);
	return failSemiReview(pi, ctx, loop, outcome);
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
		(language === "en" ? "Quality check passed." : "质量检查通过。");
	recordReviewHistory(loop, "passed", summary);
	const stats = reviewLoopStats(loop);
	finishReviewLoop(ctx, loop);
	sendReviewCard(pi, ctx, loop, "通过", summary, {
		triggerTurn: loop.options.scope?.kind !== "goal",
		content: reviewPassContent(loop, summary, outcome.infraErrors),
		displayReview: displayPassReview(summary, outcome.infraErrors, language),
	});
	await loop.options.onPass?.(stats, summary);
	return { kind: "passed", stats, summary };
}

async function failAutoReview(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	loop: ReviewLoop,
	outcome: Extract<ReviewOutcome, { kind: "needs_changes" }>,
): Promise<ReviewRunResult> {
	loop.repairs += 1;
	loop.awaitingAgent = true;
	recordReviewHistory(
		loop,
		"failed",
		summarizeReviewText(
			outcome.review,
			reviewLanguage(loop) === "en"
				? "Quality check failed."
				: "质量检查未通过。",
		),
		outcome.review,
	);
	if (loop.options.deferNextAgentEnd) {
		loop.skipNextAgentEnd = true;
		loop.options.deferNextAgentEnd = false;
	}
	sendReviewCard(pi, ctx, loop, "未通过", outcome.review, {
		triggerTurn: true,
		content: reviewFailContent(loop, outcome.review),
		deliverAs: loop.skipNextAgentEnd ? "followUp" : undefined,
		displayReview: displayReviewWithInfra(outcome, reviewLanguage(loop)),
	});
	loop.stepStartedAt = Date.now();
	loop.status?.refresh();
	setQualityActivityBox(ctx, loop);
	return { kind: "awaiting_agent" };
}

async function failSemiReview(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	loop: ReviewLoop,
	outcome: ReviewOutcome,
): Promise<ReviewRunResult> {
	if (outcome.kind !== "needs_changes") return { kind: "stopped" };
	recordReviewHistory(
		loop,
		"failed",
		summarizeReviewText(
			outcome.review,
			reviewLanguage(loop) === "en"
				? "Quality check failed."
				: "质量检查未通过。",
		),
		outcome.review,
	);
	ctx.ui.setEditorText(
		`${reviewFeedbackInstruction(
			reviewLanguage(loop),
			loop.options.scope?.kind === "goal",
		)}\n\n${outcome.review}`,
	);
	sendReviewCard(pi, ctx, loop, "未通过", outcome.review, {
		content: reviewFailContent(loop, outcome.review),
		displayReview: displayReviewWithInfra(outcome, reviewLanguage(loop)),
	});
	finishReviewLoop(ctx, loop);
	return { kind: "needs_user" };
}

function finishReviewLoop(ctx: ExtensionContext, loop: ReviewLoop) {
	cancelReviewRetryExhaustionWatch(loop);
	clearActiveReviewLoop(loop);
	setReviewActivityBox(ctx, undefined);
	loop.status?.stop();
	loop.status = undefined;
	clearStatus(ctx, REVIEW_STATUS_KEY);
}

function clearActiveReviewLoop(loop: ReviewLoop) {
	if (activeReviewLoop === loop) activeReviewLoop = undefined;
	setFlowEditorInputHidden(reviewRunning);
}

async function stopReviewLoop(
	ctx: ExtensionContext,
	loop: ReviewLoop,
	message?: string,
) {
	finishReviewLoop(ctx, loop);
	await loop.options.onStop?.(message, [...loop.history]);
}

function reviewLoopStats(loop: ReviewLoop): ReviewLoopStats {
	return {
		rounds: loop.round,
		repairs: loop.repairs,
		total: formatDuration(elapsedSeconds(loop.startedAt)),
		history: [...loop.history],
	};
}

function recordReviewHistory(
	loop: ReviewLoop,
	result: ReviewHistoryEntry["result"],
	summary: string,
	details?: string,
) {
	const trimmedDetails = details?.trim();
	loop.history = [
		...loop.history.filter((item) => item.round !== loop.round),
		{
			round: loop.round,
			result,
			summary: singleLineSummary(summary),
			...(trimmedDetails ? { details: trimmedDetails } : {}),
		},
	];
	loop.options.onProgress?.([...loop.reviewerProgress], [...loop.history]);
}

export type { ReviewLoopStats } from "./review/types.js";
export { runReviewProcess } from "./shared/review-process.js";
