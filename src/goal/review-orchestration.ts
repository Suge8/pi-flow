import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { GoalAuditResult } from "../auditor.js";
import {
	emitFlowGoalCompleted,
	FLOW_GOAL_COMPLETED_ENTRY,
	latestGoalCompletion,
} from "../flow/completion.js";
import { writeFlowHtml } from "../flow/html.js";
import { flowLockBusyMessage, withFlowLockSync } from "../flow/lock.js";
import { currentSessionFile, flowOwnerForSession } from "../flow/ownership.js";
import { currentGoal, readFlow, writeFlow } from "../flow/store.js";
import type { GoalCompletionFact } from "../flow/types.js";
import { requireFlowStartedAt } from "../flow/util.js";
import type { ReviewLoopStats } from "../review.js";
import { requestImmediateFlowRender } from "../shared/activity-frame.js";
import { clipText } from "../shared/clip.js";
import { reviewToggles } from "../shared/config.js";
import {
	flowGoalDisplayLabel,
	flowStepLabel,
	roundLabel,
} from "../shared/progress-labels.js";
import { liveReportUrl } from "../shared/report-server.js";
import {
	composeResultCardLines,
	finalReplyInstruction,
	resultCardElapsedLine,
	sendResultCard,
} from "../shared/result-card.js";
import { summarizeReviewText } from "../shared/review-format.js";
import {
	clearStatus,
	type ElapsedStatus,
	elapsedSeconds,
	formatDuration,
} from "../shared/status.js";
import { notifyUser } from "../shared/ui-language.js";
import {
	appendCustomEntry,
	artifactChecks,
	syncStandaloneGoalArtifact,
} from "./persistence.js";
import type {
	ActiveGoal,
	GoalRuntimeState,
	ReviewHistoryEntry,
	StatusContext,
} from "./runtime.js";
import type { CompletionCursor, GoalChecks } from "./types.js";
import { objectiveFromPlan } from "./validator.js";

export interface GoalCompletionActions {
	extensionApi: ExtensionAPI | undefined;
	transitionGoal: (
		goal: ActiveGoal,
		status: ActiveGoal["status"],
	) => ActiveGoal;
	updateGoalUsage: (goal: ActiveGoal, ctx: StatusContext) => void;
	persistGoal: (goal: ActiveGoal, ctx?: StatusContext) => void;
	clearActiveGoal: (ctx: StatusContext) => void;
	showCompletionStatus: (ctx: StatusContext) => void;
	onCompletionFactFailure: (ctx: ExtensionContext, goal: ActiveGoal) => void;
	setCompletionCursor: (
		ctx: StatusContext,
		goal: ActiveGoal,
		cursor: CompletionCursor,
	) => void;
}

export function recordGoalReview(
	goal: ActiveGoal,
	round: number,
	audit: GoalAuditResult,
): ActiveGoal {
	return {
		...goal,
		stateReviewHistory: [
			...goal.stateReviewHistory.filter((item) => item.round !== round),
			{
				round,
				result: audit.systemError
					? "error"
					: audit.complete
						? "passed"
						: "failed",
				summary: summarizeReviewText(
					audit.raw,
					goal.language === "en"
						? "Completion acceptance passed."
						: "完成验收通过。",
				),
				...(!audit.complete || audit.systemError
					? { details: audit.raw.trim() }
					: {}),
			},
		],
	};
}

export function recordGoalQualityReview(
	goal: ActiveGoal,
	history: ReviewHistoryEntry[],
): ActiveGoal {
	if (history.length === 0) return goal;
	const rounds = new Map(
		goal.qualityReviewHistory.map((item) => [item.round, item]),
	);
	for (const item of history) rounds.set(item.round, item);
	return {
		...goal,
		qualityReviewHistory: [...rounds.values()].sort(
			(left, right) => left.round - right.round,
		),
	};
}

export function finalizeGoalCompletion(
	state: GoalRuntimeState,
	ctx: ExtensionContext,
	goal: ActiveGoal,
	stateReviewRound: number,
	reviewStats: ReviewLoopStats | undefined,
	qualitySummary: string,
	actions: GoalCompletionActions,
): void {
	if (!state.activeGoal || state.activeGoal.id !== goal.id) return;
	state.goalReviewLive = undefined;
	const reviewedGoal = recordGoalQualityReview(
		goal,
		reviewStats?.history ?? [],
	);
	actions.updateGoalUsage(reviewedGoal, ctx);
	const audit = stateReviewSummary(reviewedGoal);
	actions.setCompletionCursor(ctx, reviewedGoal, "finalize_retry");
	const completionFact = recordFlowGoalCompletion(
		actions.extensionApi,
		reviewedGoal,
		audit,
		ctx,
		reviewStats,
	);
	if (!completionFact) {
		actions.onCompletionFactFailure(ctx, reviewedGoal);
		return;
	}
	state.activeGoal = actions.transitionGoal(reviewedGoal, "complete");
	actions.setCompletionCursor(ctx, state.activeGoal, null);
	syncStandaloneGoalArtifact(
		ctx,
		state.activeGoal,
		state.goalReviewLive,
		audit,
	);
	actions.persistGoal(state.activeGoal, ctx);
	actions.clearActiveGoal(ctx);
	actions.showCompletionStatus(ctx);
	sendCompletionCard(
		actions.extensionApi,
		ctx,
		reviewedGoal,
		stateReviewRound,
		reviewStats,
		qualitySummary,
	);
	emitFlowGoalCompleted(completionFact, ctx);
}

export function startCompletionAudit(
	state: GoalRuntimeState,
	goal: ActiveGoal,
): { generation: number; signal: AbortSignal } {
	cancelCompletionAudit(state);
	const generation = nextCompletionAuditGeneration(state);
	const controller = new AbortController();
	state.completionAuditPending = { goalId: goal.id, generation, controller };
	return { generation, signal: controller.signal };
}

export function cancelCompletionAudit(state: GoalRuntimeState): void {
	const pending = state.completionAuditPending;
	state.completionAuditPending = undefined;
	state.completionAuditGeneration += 1;
	state.goalReviewLive = undefined;
	pending?.controller.abort();
	pending?.status?.stop();
}

export function trackCompletionAuditStatus(
	state: GoalRuntimeState,
	goalId: string,
	generation: number,
	status: ElapsedStatus,
): void {
	if (!isCurrentCompletionAudit(state, goalId, generation)) {
		status.stop();
		return;
	}
	const pending = state.completionAuditPending;
	if (pending?.goalId === goalId && pending.generation === generation)
		pending.status = status;
}

export function clearCompletionAuditStatus(
	state: GoalRuntimeState,
	ctx: StatusContext,
	goalId: string,
	generation: number,
	status: ElapsedStatus,
): void {
	status.stop();
	clearStatus(ctx, "goal");
	const pending = state.completionAuditPending;
	if (
		pending?.goalId === goalId &&
		pending.generation === generation &&
		pending.status === status
	)
		pending.status = undefined;
}

export function isCurrentCompletionAudit(
	state: GoalRuntimeState,
	goalId: string,
	generation: number,
): boolean {
	return (
		state.activeGoal?.id === goalId &&
		state.completionAuditGeneration === generation
	);
}

export function syncGoalReviewSurfaces(
	state: GoalRuntimeState,
	ctx: StatusContext,
	goal: ActiveGoal,
): void {
	if (goal.artifactDir) {
		syncStandaloneGoalArtifact(ctx, goal, state.goalReviewLive);
		return;
	}
	syncFlowGoalReviews(state, ctx, goal);
}

export function yieldForGoalReviewCard(): Promise<void> {
	requestImmediateFlowRender();
	return new Promise((resolve) => setImmediate(resolve));
}

function sendCompletionCard(
	pi: ExtensionAPI | undefined,
	ctx: ExtensionContext,
	goal: ActiveGoal,
	stateReviewRound: number,
	reviewStats: ReviewLoopStats | undefined,
	qualitySummary: string,
): void {
	const flow = flowContext(ctx);
	const displayText = goalDisplayText(ctx, goal);
	const checkLines = completionCheckLines(
		goal,
		stateReviewRound,
		reviewStats,
		qualitySummary,
		goal.language,
	);
	if (flow) {
		const title =
			goal.language === "en"
				? `Flow ${flow.displayLabel} complete`
				: `Flow ${flow.displayLabel} 已完成`;
		const goalLine =
			goal.language === "en" ? `Goal: ${displayText}` : `目标：${displayText}`;
		const durationLine = resultCardElapsedLine(
			flowGoalCompleteDurationText(goal, flow.startedAt, goal.language),
			goal.language,
			"totalElapsed",
		);
		void refreshReportStatus(ctx, join(flow.dir, "flow.html"), goal.language);
		const lines = composeResultCardLines(
			[[goalLine], checkLines],
			[durationLine],
		);
		sendResultCard(
			pi,
			ctx,
			flowGoalCompleteContent(title, displayText, checkLines, goal.language),
			{
				tone: "success",
				result: "完成",
				title,
				lines,
				language: goal.language,
			},
		);
		return;
	}
	const title = goal.language === "en" ? "Flow complete" : "Flow 已完成";
	const stepLine =
		goal.language === "en" ? `Step: ${displayText}` : `步骤：${displayText}`;
	const totalLine = resultCardElapsedLine(
		durationSince(goal.startedAt),
		goal.language,
		"totalElapsed",
	);
	void refreshReportStatus(ctx, undefined, goal.language);
	const content = [
		`[${title}]`,
		stepLine,
		...checkLines,
		"",
		goal.language === "en" ? "Next:" : "下一步：",
		finalReplyInstruction(goal.language),
	].join("\n");
	sendResultCard(
		pi,
		ctx,
		content,
		{
			tone: "success",
			result: "完成",
			title,
			lines: composeResultCardLines([[stepLine], checkLines], [totalLine]),
			language: goal.language,
		},
		{ triggerTurn: true },
	);
}

function flowGoalCompleteContent(
	title: string,
	displayText: string,
	checkLines: string[],
	language: ActiveGoal["language"] = "zh",
): string {
	return [
		`[${title}]`,
		language === "en" ? `Goal: ${displayText}` : `目标：${displayText}`,
		...checkLines,
	].join("\n");
}

async function refreshReportStatus(
	ctx: StatusContext,
	htmlPath: string | undefined,
	language: ActiveGoal["language"],
) {
	if (!htmlPath) return;
	await liveReportUrl(ctx, htmlPath, language).catch(() => undefined);
}

function flowGoalCompleteDurationText(
	goal: ActiveGoal,
	flowStartedAt: number,
	language: ActiveGoal["language"],
) {
	return language === "en"
		? `current step ${durationSince(goal.startedAt)} / Flow total ${durationSince(flowStartedAt)}`
		: `当前步骤 ${durationSince(goal.startedAt)} / Flow 总 ${durationSince(flowStartedAt)}`;
}

function completionCheckLines(
	goal: ActiveGoal,
	stateReviewRound: number,
	reviewStats: ReviewLoopStats | undefined,
	qualitySummary: string,
	language: ActiveGoal["language"],
): string[] {
	const acceptance = completionPhaseLines(
		language === "en" ? "Completion acceptance" : "完成验收",
		completionStateReviewHistory(goal, stateReviewRound, language),
		language,
	);
	const quality = completionPhaseLines(
		language === "en" ? "Quality check" : "质量检查",
		completionQualityReviewHistory(goal, reviewStats, qualitySummary, language),
		language,
	);
	return [...acceptance, "", ...quality];
}

function completionQualityReviewHistory(
	goal: ActiveGoal,
	reviewStats: ReviewLoopStats | undefined,
	qualitySummary: string,
	language: ActiveGoal["language"],
): ReviewHistoryEntry[] | undefined {
	if (reviewStats)
		return reviewStats.history.length
			? reviewStats.history
			: [
					{
						round: reviewStats.rounds,
						result: "passed",
						summary:
							qualitySummary ||
							(language === "en" ? "Quality check passed." : "质量检查通过。"),
					},
				];
	if (!reviewToggles().quality) return undefined;
	return goal.qualityReviewHistory.length
		? goal.qualityReviewHistory
		: undefined;
}

function completionStateReviewHistory(
	goal: ActiveGoal,
	fallbackRound: number,
	language: ActiveGoal["language"],
): ReviewHistoryEntry[] | undefined {
	if (!reviewToggles().acceptance) return undefined;
	return goal.stateReviewHistory.length
		? goal.stateReviewHistory
		: [
				{
					round: fallbackRound,
					result: "passed",
					summary:
						language === "en"
							? "Completion acceptance passed."
							: "完成验收通过。",
				},
			];
}

function completionPhaseLines(
	label: string,
	history: ReviewHistoryEntry[] | undefined,
	language: ActiveGoal["language"],
) {
	const separator = language === "en" ? ":" : "：";
	if (!history)
		return [language === "en" ? `${label}: disabled` : `${label}：未启用`];
	if (history.length === 1) {
		const [round] = history;
		return [formatCompletionRound(`${label}${separator}`, round, language)];
	}
	return [
		`${label}${separator}`,
		...history.map((round) =>
			formatCompletionRound(roundLabel(round.round, language), round, language),
		),
	];
}

function formatCompletionRound(
	prefix: string,
	round: ReviewHistoryEntry,
	language: ActiveGoal["language"],
) {
	const summary = completionSummary(round, language);
	const gap = prefix.endsWith("：") ? "" : " ";
	return `${prefix}${gap}${resultIcon(round.result)}${summary ? ` ${summary}` : ""}`;
}

function completionSummary(
	round: ReviewHistoryEntry,
	language: ActiveGoal["language"],
) {
	const summary =
		visibleCompletionSummary(round.summary) || detailsSummary(round.details);
	if (summary) return clipText(summary, 180);
	if (round.result === "passed") return "";
	return language === "en" ? "see this round's details" : "见本轮详情";
}

function visibleCompletionSummary(summary: string) {
	const text = summary.trim();
	return STATUS_ONLY_SUMMARIES.has(text.replace(/[。.]$/u, "")) ? "" : text;
}

const STATUS_ONLY_SUMMARIES = new Set([
	"完成验收通过",
	"完成验收判定未通过",
	"完成验收失败",
	"质量检查通过",
	"质量检查未通过",
	"质量检查失败",
	"Completion acceptance passed",
	"Completion acceptance judged the goal incomplete",
	"Completion acceptance failed",
	"Quality check passed",
	"Quality check failed",
]);

function detailsSummary(details: string | undefined) {
	if (!details) return "";
	const lines = details
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const issueIndex = lines.findIndex((line) => /^- (问题|Issue):/u.test(line));
	if (issueIndex === -1) return "";
	const issue = lines[issueIndex].replace(/^- (问题|Issue):\s*/u, "");
	return cleanCompletionDetail(
		issue || nextIssueDetail(lines.slice(issueIndex + 1)),
	);
}

function nextIssueDetail(lines: string[]) {
	return lines.find(issueDetailCandidate) ?? "";
}

function issueDetailCandidate(line: string) {
	if (line.startsWith("#") || /^(模型|Model)\s+\d+\s+·\s+/iu.test(line))
		return false;
	if (/^- (问题|Issue):\s*$/u.test(line)) return false;
	return !STATUS_ONLY_SUMMARIES.has(line.replace(/[。.]$/u, ""));
}

function cleanCompletionDetail(line: string) {
	return line
		.replace(/^[-*+]\s+/u, "")
		.replace(/`([^`]+)`/gu, "$1")
		.trim();
}

function recordFlowGoalCompletion(
	pi: ExtensionAPI | undefined,
	goal: ActiveGoal,
	audit: string,
	ctx: StatusContext,
	reviewStats?: ReviewLoopStats,
): GoalCompletionFact | undefined {
	const fact = {
		goalId: goal.id,
		summary:
			audit.trim() ||
			(goal.language === "en" ? "Goal complete." : "目标完成。"),
		acceptance: audit.trim(),
		sessionFile: currentSessionFile(ctx) ?? null,
		checks: settledGoalChecks(goal, reviewStats),
	};
	try {
		appendCustomEntry(ctx, pi, FLOW_GOAL_COMPLETED_ENTRY, fact);
	} catch (error) {
		notifyUser(
			ctx,
			goal.language === "en"
				? `Goal completion fact write failed: ${formatNotifyError(error)}`
				: `目标完成事实写入失败：${formatNotifyError(error)}`,
			"error",
			goal.language,
		);
		return undefined;
	}
	if (sessionEntriesInspectable(ctx)) {
		const stored = latestGoalCompletion(ctx);
		if (!stored || stored.goalId !== goal.id) return undefined;
	}
	return fact;
}

function syncFlowGoalReviews(
	state: GoalRuntimeState,
	ctx: StatusContext,
	goal: ActiveGoal,
): void {
	try {
		const owner = flowOwnerForSession(ctx);
		if (!owner) return;
		const synced = withFlowLockSync(
			owner.dir,
			`sync goal reviews ${owner.flow.id}`,
			() => {
				const flow = readFlow(owner.dir);
				const current = flow.goals[flow.currentGoal];
				if (
					!current ||
					current.status !== "running" ||
					current.sessionFile !== currentSessionFile(ctx)
				)
					return;
				const checks = artifactChecks(
					goal.stateReviewHistory,
					goal.qualityReviewHistory,
					current.checks,
					state.goalReviewLive,
				);
				const goals = flow.goals.map((item, index) =>
					index === flow.currentGoal ? { ...item, checks } : item,
				);
				const saved = writeFlow(owner.dir, { ...flow, goals });
				writeFlowHtml(owner.dir, saved);
			},
		);
		if (!synced.ok)
			notifyUser(
				ctx,
				flowLockBusyMessage(synced.owner, goal.language),
				"warning",
				goal.language,
			);
	} catch (error) {
		notifyUser(
			ctx,
			goal.language === "en"
				? `Goal review sync failed: ${formatNotifyError(error)}`
				: `目标检查进度同步失败：${formatNotifyError(error)}`,
			"warning",
			goal.language,
		);
	}
}

function settledGoalChecks(
	goal: ActiveGoal,
	reviewStats: ReviewLoopStats | undefined,
): GoalChecks {
	const toggles = reviewToggles();
	return {
		acceptance: {
			enabled: toggles.acceptance,
			rounds: goal.stateReviewHistory.map(reviewRound),
			active: null,
		},
		quality: {
			enabled: toggles.quality,
			rounds: (reviewStats?.history ?? goal.qualityReviewHistory).map(
				reviewRound,
			),
			active: null,
		},
	};
}

function reviewRound(entry: ReviewHistoryEntry) {
	return {
		round: entry.round,
		result: entry.result,
		summary: entry.summary,
		...(entry.details ? { details: entry.details } : {}),
	};
}

function resultIcon(result: ReviewHistoryEntry["result"]) {
	if (result === "passed") return "✅";
	if (result === "failed") return "❌";
	return "🛑";
}

function stateReviewSummary(goal: ActiveGoal): string {
	if (!reviewToggles().acceptance)
		return goal.language === "en"
			? "Completion acceptance disabled"
			: "完成验收未启用";
	return (
		goal.stateReviewHistory.at(-1)?.summary ??
		(goal.language === "en"
			? "Completion acceptance passed."
			: "完成验收通过。")
	);
}

function sessionEntriesInspectable(ctx: StatusContext): boolean {
	const sessionManager = ctx.sessionManager as
		| { getBranch?: () => unknown[]; getEntries?: () => unknown[] }
		| undefined;
	return Boolean(sessionManager?.getBranch ?? sessionManager?.getEntries);
}

function goalDisplayText(ctx: StatusContext, goal: ActiveGoal): string {
	if (!isLegacyFlowPromptText(goal.text)) return goal.text;
	const flow = flowContext(ctx);
	return flow
		? objectiveFromPlan(flow.plan.snapshot ?? "") || flow.plan.title
		: goal.text;
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

function isLegacyFlowPromptText(text: string): boolean {
	return (
		text.includes("Flow Goal session 已启动") ||
		text.includes("当前 Goal plan 完整 snapshot")
	);
}

function durationSince(startedAt: number): string {
	return formatDuration(elapsedSeconds(startedAt));
}

function formatNotifyError(error: unknown): string {
	const value = error instanceof Error ? error.message : String(error);
	return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function nextCompletionAuditGeneration(state: GoalRuntimeState): number {
	state.completionAuditGeneration += 1;
	return state.completionAuditGeneration;
}
