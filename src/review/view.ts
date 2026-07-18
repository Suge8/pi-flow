import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { quoteCommand } from "../flow/parallel/console.js";
import type { CheckRoundAdvisor } from "../goal/types.js";
import {
	type ReviewOutcome,
	reviewFeedbackInstruction,
} from "../review-outcome.js";
import {
	activityRows,
	currentCancelHint,
	setReviewActivityBox,
} from "../shared/activity-frame.js";
import { advisorDirectionLines } from "../shared/check-feedback.js";
import type { Language } from "../shared/config.js";
import { runtimeLanguage } from "../shared/language.js";
import {
	elapsedLabel,
	GOAL_SCOPE,
	REVIEW_OPTIMIZE_SCOPE,
	REVIEW_SCOPE,
	roundLabel,
	roundTitle,
} from "../shared/progress-labels.js";
import {
	composeResultCardLines,
	finalReplyInstruction,
	resultCardElapsedLine,
	sendResultCard,
} from "../shared/result-card.js";
import { formatReviewResultLines } from "../shared/review-format.js";
import { reviewerProgressLines, shortModel } from "../shared/reviewer-pool.js";
import { elapsedSeconds, startElapsedStatus } from "../shared/status.js";
import { formatUserNotice, monitorDetailsHint } from "../shared/ui-language.js";
import type {
	FlowConfig,
	ReviewCancellationSource,
	ReviewLoop,
} from "./types.js";

const REVIEW_STATUS_KEY = "review";

export function sendReviewStartCard(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	flowConfig: FlowConfig,
) {
	const language = runtimeLanguage();
	const reviewers = flowConfig.modelRoles.reviewers
		.map((reviewer) => shortModel(reviewer.model))
		.join(language === "en" ? ", " : "、");
	const title = qualityTitle("progress", language);
	const lines = [modelLine(reviewers, language)];
	sendResultCard(pi, ctx, `[${title}]\n${lines.join("\n")}`, {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		icon: "💯",
		language,
		context: "check-start",
	});
}

export function sendReviewCard(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	loop: ReviewLoop,
	result: "通过" | "未通过" | "错误",
	review: string,
	options: {
		content: string;
		triggerTurn?: boolean;
		deliverAs?: "followUp";
		displayReview?: string;
		deliveryId?: string;
		footerLines?: string[];
	},
) {
	setReviewActivityBox(ctx, undefined);
	const language = reviewLanguage(loop);
	const title = roundTitle(
		loop.round,
		qualityTitle(result, language),
		language,
	);
	return sendResultCard(
		pi,
		ctx,
		options.content,
		{
			tone: "quality-review",
			result,
			title,
			lines: reviewLines(
				options.displayReview ?? review,
				loop,
				result === "通过",
				options.footerLines,
			),
			language,
			...(options.deliveryId
				? { context: "check-result" as const, deliveryId: options.deliveryId }
				: {}),
		},
		{ triggerTurn: options.triggerTurn, deliverAs: options.deliverAs },
	);
}

export function displayReviewWithInfra(
	outcome: Extract<ReviewOutcome, { kind: "needs_changes" }>,
	language: Language = "zh",
) {
	if (outcome.details)
		return outcome.infraErrors
			? labelInfraDetails(outcome.details, outcome.infraErrors, language)
			: outcome.details;
	return [
		outcome.review,
		...(outcome.infraErrors
			? ["", "---", "", infraLabel(language), "", outcome.infraErrors]
			: []),
	].join("\n");
}

function labelInfraDetails(
	details: string,
	infraErrors: string,
	language: Language,
) {
	const index = details.indexOf(infraErrors);
	if (index === -1)
		return [details, "", "---", "", infraLabel(language), "", infraErrors].join(
			"\n",
		);
	return `${details.slice(0, index)}---\n\n${infraLabel(language)}\n\n${details.slice(index)}`;
}

export function displayPassReview(
	summary: string,
	infraErrors: string | undefined,
	_language: Language = "zh",
	details?: string,
) {
	if (details) return details;
	return [summary, ...(infraErrors ? ["", "---", "", infraErrors] : [])].join(
		"\n",
	);
}

export function reviewPassContent(
	loop: ReviewLoop,
	summary: string,
	infraErrors?: string,
) {
	const language = reviewLanguage(loop);
	const lines = [
		`[${roundTitle(loop.round, qualityTitle("通过", language), language)}]`,
		"",
		summary || (language === "en" ? "Quality check passed." : "质检通过。"),
	];
	if (infraErrors)
		lines.push("", "---", "", infraLabel(language), "", infraErrors);
	if (loop.options.scope?.kind !== "goal")
		lines.push(
			"",
			language === "en" ? "Next:" : "下一步：",
			finalReplyInstruction(language),
		);
	return lines.join("\n");
}

export function reviewErrorContent(loop: ReviewLoop, message: string) {
	const language = reviewLanguage(loop);
	const next = quoteCommand(
		loop.options.scope?.kind === "goal"
			? (loop.options.scope.resumeCommand ?? "/flow go")
			: "/review",
	);
	return [
		`[${roundTitle(loop.round, qualityTitle("错误", language), language)}]`,
		"",
		language === "en"
			? "Blocker: quality check did not complete"
			: "卡点：质检未完成",
		language === "en" ? `Reason: ${message}` : `原因：${message}`,
		"",
		language === "en" ? `Next: ${next}` : `下一步：${next}`,
	].join("\n");
}

export function reviewFailContent(
	loop: ReviewLoop,
	review: string,
	directive?: {
		advice?: CheckRoundAdvisor;
		extraPromptLines?: string[];
	},
) {
	const language = reviewLanguage(loop);
	const lines = [
		`[${roundTitle(loop.round, qualityTitle("未通过", language), language)}]`,
		"",
	];
	if (loop.options.scope?.kind === "goal") {
		lines.push(
			language === "en" ? "Original goal:" : "原目标：",
			`<goal>\n${loop.options.scope.goalText}\n</goal>`,
			"",
		);
	}
	lines.push(language === "en" ? "Check result:" : "检查结果：", review, "");
	if (directive?.advice)
		lines.push(...advisorDirectionLines(directive.advice.advice, language), "");
	lines.push(
		language === "en" ? "Next:" : "下一步：",
		reviewFeedbackNextStep(loop, language),
	);
	if (directive?.extraPromptLines?.length)
		lines.push("", ...directive.extraPromptLines);
	return lines.join("\n");
}

function reviewFeedbackNextStep(loop: ReviewLoop, language: Language) {
	return reviewFeedbackInstruction(
		language,
		loop.options.scope?.kind === "goal",
	);
}

export function startReviewStatus(ctx: ExtensionContext, loop: ReviewLoop) {
	loop.status = startElapsedStatus(
		ctx,
		reviewStatusKey(loop),
		() => reviewStatusText(loop),
		{ language: reviewLanguage(loop) },
	);
}

export function reviewActivity(loop: ReviewLoop) {
	const language = reviewLanguage(loop);
	if (loop.options.scope?.kind === "review" && loop.round === 0)
		return {
			language,
			flame: true,
			title: language === "en" ? "💯 Running" : "💯 执行中",
			rows: [
				language === "en"
					? "Runs quality checks automatically when done"
					: "完成后自动质检",
			],
			hint: `${currentCancelHint()} ${
				language === "en" ? "cancel automatic quality check" : "取消自动质检"
			}`,
		};
	return {
		language,
		flame: true,
		title: reviewActivityTitle(loop),
		rows: activityRows(
			reviewActivityScopeRows(loop),
			reviewActivityLines(loop),
		),
		hint: loop.awaitingAgent
			? undefined
			: `${currentCancelHint()} ${language === "en" ? "cancel" : "取消"} · ${monitorDetailsHint(language)}`,
	};
}

export function cancelReview(
	loop: ReviewLoop,
	source: ReviewCancellationSource = "user",
) {
	// first-writer-wins：用户主动取消不得被紧随的 shutdown/flow_stop 覆盖，
	// 否则本应清除的 checkpoint 会被保留并在重启后重跑已取消的质检。
	loop.cancellationSource ??= source;
	loop.controller.abort();
}

export function cancelNotification(loop: ReviewLoop) {
	return reviewLanguage(loop) === "en"
		? formatUserNotice("⏸", "Quality check cancelled", ["Stopped by user"])
		: formatUserNotice("⏸", "质检已取消", ["已按你的操作停止"]);
}

function reviewLines(
	review: string,
	loop: ReviewLoop,
	includeTotal: boolean,
	footerLines: string[] = [],
) {
	const lines = formatReviewResultLines(review);
	const language = reviewLanguage(loop);
	return composeResultCardLines(
		[lines],
		[
			...footerLines,
			resultCardElapsedLine(reviewElapsedText(loop, includeTotal), language),
		],
	);
}

function reviewStatusText(loop: ReviewLoop) {
	return `${reviewStatusPrefix(loop)} · ${timeText(loop)}`;
}

function reviewStatusKey(loop: ReviewLoop) {
	return loop.options.scope?.kind === "goal"
		? (loop.options.scope.statusKey ?? REVIEW_STATUS_KEY)
		: REVIEW_STATUS_KEY;
}

function reviewStatusPrefix(loop: ReviewLoop) {
	const language = reviewLanguage(loop);
	if (loop.options.scope?.kind === "review" && loop.round === 0)
		return `${REVIEW_SCOPE}/${
			language === "en"
				? "running · quality check when done"
				: "执行中 · 完成后自动质检"
		}`;
	const phase = loop.awaitingAgent
		? language === "en"
			? "quality fix"
			: "优化中"
		: language === "en"
			? "quality check"
			: "质检";
	const scope =
		loop.options.scope?.kind === "goal"
			? (loop.options.scope.statusPrefix ?? GOAL_SCOPE)
			: loop.awaitingAgent
				? REVIEW_OPTIMIZE_SCOPE
				: REVIEW_SCOPE;
	return `${scope}/${roundTitle(loop.round, phase, language)}`;
}

function timeText(loop: ReviewLoop) {
	return elapsedLabel(
		elapsedSeconds(loop.stepStartedAt),
		reviewTotalSeconds(loop),
		loop.round > 1 || loop.repairs > 0 || reviewScopeShowsTotal(loop),
		reviewLanguage(loop),
	);
}

function reviewElapsedText(loop: ReviewLoop, includeTotal: boolean) {
	return elapsedLabel(
		elapsedSeconds(loop.stepStartedAt),
		reviewTotalSeconds(loop),
		includeTotal && (loop.round > 1 || reviewScopeShowsTotal(loop)),
		reviewLanguage(loop),
	);
}

function reviewTotalSeconds(loop: ReviewLoop) {
	const startedAt =
		loop.options.scope?.kind === "goal"
			? (loop.options.scope.totalStartedAt ?? loop.startedAt)
			: loop.startedAt;
	return elapsedSeconds(startedAt);
}

function reviewScopeShowsTotal(loop: ReviewLoop) {
	return (
		loop.options.scope?.kind === "goal" &&
		loop.options.scope.showTotalElapsed === true
	);
}

function reviewActivityPhase(loop: ReviewLoop) {
	const language = reviewLanguage(loop);
	return roundTitle(
		loop.round,
		loop.awaitingAgent
			? language === "en"
				? "Quality fix in progress"
				: "优化中"
			: language === "en"
				? "Quality check in progress"
				: "质检中",
		language,
	);
}

function reviewActivityTitle(loop: ReviewLoop) {
	const phase = reviewActivityPhase(loop);
	if (loop.options.scope?.kind !== "goal") return `💯 ${phase}`;
	return `💯 ${reviewActivityObject(loop)} · ${phase}`;
}

function reviewActivityObject(loop: ReviewLoop) {
	const language = reviewLanguage(loop);
	const scope = loop.options.scope;
	if (scope?.kind === "goal")
		return scope.activity?.object ?? (language === "en" ? "Goal" : "目标");
	return language === "en" ? "Goal" : "目标";
}

function reviewActivityScopeRows(loop: ReviewLoop) {
	if (loop.options.scope?.kind === "goal")
		return loop.options.scope.activity?.rows ?? [loop.options.scope.goalText];
	return [];
}

function reviewActivityLines(loop: ReviewLoop) {
	const language = reviewLanguage(loop);
	if (loop.awaitingAgent)
		return [
			language === "en"
				? `Repairing ${roundLabel(loop.round, language)} quality feedback`
				: `正在修复${roundLabel(loop.round, language)}质检反馈`,
		];
	if (loop.reviewerProgress.length > 0)
		return reviewerProgressLines(
			loop.reviewerProgress,
			language,
			loop.context.cwd,
		);
	return [];
}

function reviewLanguage(loop: ReviewLoop) {
	return loop.options.scope?.language ?? runtimeLanguage();
}

function qualityTitle(
	state: "progress" | "通过" | "未通过" | "错误",
	language: Language,
) {
	if (language === "en") {
		if (state === "progress") return "Quality check in progress";
		if (state === "通过") return "Quality check passed";
		if (state === "未通过") return "Quality check failed";
		return "Quality check incomplete";
	}
	if (state === "progress") return "质检中";
	if (state === "错误") return "质检未完成";
	return `质检${state}`;
}

function modelLine(reviewers: string, language: Language) {
	return language === "en" ? `Models: ${reviewers}` : `模型：${reviewers}`;
}

function infraLabel(language: Language) {
	return language === "en"
		? "Non-fix item: model system error"
		: "非修复项：模型系统错误";
}
