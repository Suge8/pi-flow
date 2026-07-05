import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type ReviewOutcome,
	reviewFeedbackInstruction,
} from "../review-outcome.js";
import {
	activityRows,
	currentCancelHint,
	setReviewActivityBox,
} from "../shared/activity-frame.js";
import { type Language, readFlowConfig } from "../shared/config.js";
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
	finalReplyInstruction,
	sendResultCard,
} from "../shared/result-card.js";
import { formatReviewResultLines } from "../shared/review-format.js";
import { reviewerProgressLines, shortModel } from "../shared/reviewer-pool.js";
import { elapsedSeconds, startElapsedStatus } from "../shared/status.js";
import type { ReviewLoop } from "./types.js";

const REVIEW_STATUS_KEY = "review";

export function sendReviewStartCard(pi: ExtensionAPI, ctx: ExtensionContext) {
	let flowConfig: ReturnType<typeof readFlowConfig>;
	try {
		flowConfig = readFlowConfig();
	} catch {
		return;
	}
	if (!flowConfig.quality.enabled) return;
	const language = runtimeLanguage();
	const reviewers = flowConfig.models
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
	},
) {
	setReviewActivityBox(ctx, undefined);
	const language = reviewLanguage(loop);
	const title = roundTitle(
		loop.round,
		qualityTitle(result, language),
		language,
	);
	sendResultCard(
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
			),
			language,
		},
		{ triggerTurn: options.triggerTurn, deliverAs: options.deliverAs },
	);
}

export function displayReviewWithInfra(
	outcome: Extract<ReviewOutcome, { kind: "needs_changes" }>,
	language: Language = "zh",
) {
	return [
		outcome.review,
		...(outcome.infraErrors
			? ["", "---", "", infraLabel(language), "", outcome.infraErrors]
			: []),
	].join("\n");
}

export function displayPassReview(
	summary: string,
	infraErrors: string | undefined,
	_language: Language = "zh",
) {
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
		summary || (language === "en" ? "Quality check passed." : "质量检查通过。"),
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
	const next =
		loop.options.scope?.kind === "goal"
			? (loop.options.scope.resumeCommand ?? "/flow continue")
			: "/review";
	return [
		`[${roundTitle(loop.round, qualityTitle("错误", language), language)}]`,
		"",
		language === "en"
			? "Blocker: quality check did not complete"
			: "卡点：质量检查未完成",
		language === "en" ? `Reason: ${message}` : `原因：${message}`,
		"",
		language === "en" ? `Next: ${next}` : `下一步：${next}`,
	].join("\n");
}

export function reviewFailContent(loop: ReviewLoop, review: string) {
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
	lines.push(
		language === "en" ? "Check result:" : "检查结果：",
		review,
		"",
		language === "en" ? "Next:" : "下一步：",
		reviewFeedbackNextStep(loop, language),
	);
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
	return {
		language,
		title: `💯 ${reviewActivityObject(loop)} · ${reviewActivityPhase(loop)}`,
		rows: activityRows(
			reviewActivityScopeRows(loop),
			reviewActivityLines(loop),
		),
		hint: loop.awaitingAgent
			? undefined
			: `${currentCancelHint()} ${language === "en" ? "cancel" : "取消"}`,
	};
}

export function cancelReview(loop: ReviewLoop) {
	loop.controller.abort();
}

export function cancelNotification(loop: ReviewLoop) {
	const language = reviewLanguage(loop);
	if (loop.options.scope?.kind !== "goal")
		return language === "en" ? "Quality check cancelled." : "质量检查已取消。";
	const command = loop.options.scope.resumeCommand ?? "/flow continue";
	return language === "en"
		? `Flow step paused. Run ${command} to continue.`
		: `Flow 步骤已暂停。运行 ${command} 继续。`;
}

function reviewLines(review: string, loop: ReviewLoop, includeTotal: boolean) {
	const lines = formatReviewResultLines(review);
	return [
		...lines,
		"",
		elapsedLine(reviewElapsedText(loop, includeTotal), reviewLanguage(loop)),
	];
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
	const phase = loop.awaitingAgent
		? language === "en"
			? "quality fix"
			: "质量修复中"
		: language === "en"
			? "quality check"
			: "质量检查";
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
				: "质量修复中"
			: language === "en"
				? "Quality check in progress"
				: "质量检查中",
		language,
	);
}

function reviewActivityObject(loop: ReviewLoop) {
	const language = reviewLanguage(loop);
	if (loop.options.scope?.kind === "goal")
		return (
			loop.options.scope.activity?.object ??
			(language === "en" ? "Goal" : "目标")
		);
	return language === "en" ? "Session" : "会话";
}

function reviewActivityScopeRows(loop: ReviewLoop) {
	const language = reviewLanguage(loop);
	if (loop.options.scope?.kind === "goal")
		return loop.options.scope.activity?.rows ?? [loop.options.scope.goalText];
	return language === "en"
		? [
				"Target: current task delivery",
				"Evidence: first user request + recent context + file clues",
			]
		: ["对象：当前任务交付", "证据：首条用户需求 + 最近上下文 + 文件线索"];
}

function reviewActivityLines(loop: ReviewLoop) {
	const language = reviewLanguage(loop);
	if (loop.awaitingAgent)
		return [
			language === "en"
				? `Repairing ${roundLabel(loop.round, language)} quality feedback`
				: `正在修复${roundLabel(loop.round, language)}质量反馈`,
		];
	if (loop.reviewerProgress.length > 0)
		return reviewerProgressLines(loop.reviewerProgress);
	return loop.flowConfig.models.map(
		(reviewer, index) => `${index + 1}·${shortModel(reviewer.model)} …`,
	);
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
		return "Quality check error";
	}
	if (state === "progress") return "质量检查中";
	return `质量检查${state}`;
}

function modelLine(reviewers: string, language: Language) {
	return language === "en" ? `Models: ${reviewers}` : `模型：${reviewers}`;
}

function infraLabel(language: Language) {
	return language === "en"
		? "Non-fix item: model system error"
		: "非修复项：模型系统错误";
}

function elapsedLine(text: string, language: Language) {
	return language === "en" ? `⏱ Elapsed: ${text}` : `⏱ 用时：${text}`;
}
