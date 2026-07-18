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
import { isPrivateWorkerProcess } from "../flow/execution/worker-protocol.js";
import { refreshFlowHtmlProjection } from "../flow/html.js";
import {
	type FlowLockOwner,
	flowLockBusyMessage,
	withFlowLockSync,
} from "../flow/lock.js";
import { currentSessionFile, flowOwnerForSession } from "../flow/ownership.js";
import { currentGoal, findFlow, readFlow, writeFlow } from "../flow/store.js";
import type {
	CheckboxAttribution,
	FlowAttention,
	FlowState,
	GoalCompletionFact,
} from "../flow/types.js";
import { requireFlowStartedAt } from "../flow/util.js";
import type { ReviewLoopStats } from "../review.js";
import { requestImmediateFlowRender } from "../shared/activity-frame.js";
import { reviewToggles } from "../shared/config.js";
import {
	flowGoalDisplayLabel,
	flowStepLabel,
} from "../shared/progress-labels.js";
import { bindLiveReport } from "../shared/report-client.js";
import {
	composeResultCardLines,
	finalReplyInstruction,
	resultCardElapsedLine,
	sendResultCard,
} from "../shared/result-card.js";
import { summarizeReviewText } from "../shared/review-format.js";
import { completionPhaseLines } from "../shared/review-history.js";
import {
	clearStatus,
	type ElapsedStatus,
	elapsedSeconds,
	formatDuration,
} from "../shared/status.js";
import { formatUserNotice, notifyUser } from "../shared/ui-language.js";
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
import type { CompletionCursor, GoalChecks, GoalHandoff } from "./types.js";

export { refreshFlowHtmlProjection };

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
	const details = [audit.raw.trim(), audit.infraFeedback]
		.filter(Boolean)
		.join("\n\n---\n\n");
	const keepDetails =
		!audit.complete ||
		audit.systemError ||
		Boolean(audit.infraFeedback) ||
		(audit.models?.length ?? 0) > 0;
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
					goal.language === "en" ? "Acceptance passed." : "验收通过。",
				),
				...(keepDetails && details ? { details } : {}),
				...(audit.models ? { models: audit.models } : {}),
				...(audit.elapsedMs !== undefined
					? { elapsedMs: audit.elapsedMs }
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
	if (
		!state.activeGoal ||
		state.activeGoal.id !== goal.id ||
		state.activeGoal.status !== "active"
	)
		return;
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
	syncStandaloneGoalArtifact(ctx, state.activeGoal, state.goalReviewLive, {
		acceptance: audit,
	});
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

export type GoalReviewSurfaceSyncResult =
	| { kind: "saved" }
	| { kind: "locked"; dir: string; owner: FlowLockOwner | undefined }
	| { kind: "failed" };

/** 暂停时随 canonical 事务原子落盘的接管事实：串行保留真实 kind 写 flow.attention；
worker artifact handoff 校验只收 user_action_required，统一映射（消息携带具体原因）。 */
type PauseAttention = Omit<FlowAttention, "at">;

export function syncGoalReviewSurfaces(
	state: GoalRuntimeState,
	ctx: StatusContext,
	goal: ActiveGoal,
	options: {
		expectedGeneration?: string | null;
		completionCursor?: CompletionCursor;
		attention?: PauseAttention;
	} = {},
): GoalReviewSurfaceSyncResult {
	if (goal.artifactStatePath) {
		const handoff: GoalHandoff | undefined = options.attention
			? {
					kind: "user_action_required",
					message: options.attention.message,
					at: Date.now(),
				}
			: undefined;
		const synced = syncStandaloneGoalArtifact(ctx, goal, state.goalReviewLive, {
			expectedGeneration: options.expectedGeneration,
			completionCursor: options.completionCursor,
			handoff,
		});
		return synced ? { kind: "saved" } : { kind: "failed" };
	}
	return syncFlowGoalReviews(state, ctx, goal, options);
}

export interface FlowCheckboxAttributionTarget {
	flowId: string;
	goalIndex: number;
	goalFile: string;
}

export interface CheckboxAttributionChange {
	key: string;
	before?: CheckboxAttribution;
	after?: CheckboxAttribution;
}

export interface FlowCheckboxAttributionCommit
	extends FlowCheckboxAttributionTarget {
	language: ActiveGoal["language"];
	changes: CheckboxAttributionChange[];
}

export type CheckboxAttributionSyncResult =
	| { kind: "saved" }
	| { kind: "locked"; dir: string; owner: FlowLockOwner | undefined }
	| { kind: "failed" };

/** 用稳定步骤定位提交归因 delta，不覆盖检查 checkpoint 或其他 Flow 运行态。 */
export function syncGoalCheckboxAttribution(
	ctx: StatusContext,
	commit: FlowCheckboxAttributionCommit,
): CheckboxAttributionSyncResult {
	return syncFlowGoalCheckboxAttribution(ctx, commit);
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
	if (flow && shouldLetAdvanceSendSingleFlowCompletion(flow)) return;
	const displayText = goal.text;
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

function shouldLetAdvanceSendSingleFlowCompletion(
	flow: NonNullable<ReturnType<typeof flowContext>>,
) {
	return (
		!flow.flow.parallelRun &&
		flow.flow.goals.length === 1 &&
		flow.flow.goals.every(
			(goal) => goal.index === flow.plan.index || goal.status === "complete",
		)
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

function refreshReportStatus(
	ctx: StatusContext,
	htmlPath: string | undefined,
	language: ActiveGoal["language"],
) {
	if (!htmlPath) return;
	bindLiveReport(ctx, htmlPath, language);
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
		language === "en" ? "Acceptance" : "验收",
		completionStateReviewHistory(goal, stateReviewRound, language),
		language,
	);
	const quality = completionPhaseLines(
		language === "en" ? "Quality check" : "质检",
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
							(language === "en" ? "Quality check passed." : "质检通过。"),
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
					summary: language === "en" ? "Acceptance passed." : "验收通过。",
				},
			];
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
		...(goal.checkAttribution
			? { checkAttribution: goal.checkAttribution }
			: {}),
	};
	try {
		appendCustomEntry(ctx, pi, FLOW_GOAL_COMPLETED_ENTRY, fact);
	} catch (error) {
		notifyUser(
			ctx,
			goalCompletionFactWriteFailedNotice(
				formatNotifyError(error),
				goal.language,
			),
			"info",
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

/**
 * 非暂停事务中的 best-effort attention 更新；能与状态同事务提交的调用方应走 syncGoalReviewSurfaces。
 */
export function setFlowAttention(
	ctx: StatusContext,
	attention: Omit<FlowAttention, "at"> | null,
) {
	// 单写者约束：worker 进程不写父 flow.json；worker 异常经自身 artifact 的 paused+handoff 由父控制台收口。
	if (isPrivateWorkerProcess()) return;
	try {
		const owner = flowOwnerForSession(ctx);
		if (!owner) return;
		const updated = withFlowLockSync(
			owner.dir,
			`set attention ${owner.flow.id}`,
			() => {
				const flow = readFlow(owner.dir);
				if (attention === null && flow.attention === null) return;
				return writeFlow(owner.dir, {
					...flow,
					attention: attention ? { ...attention, at: Date.now() } : null,
				});
			},
		);
		if (updated.ok && updated.value)
			refreshFlowHtmlProjection(
				ctx,
				owner.dir,
				updated.value,
				owner.flow.language,
			);
	} catch {
		// 见 docstring：不阻塞暂停主链路。
	}
}

function syncFlowGoalCheckboxAttribution(
	ctx: StatusContext,
	commit: FlowCheckboxAttributionCommit,
): CheckboxAttributionSyncResult {
	try {
		const location = findFlow(ctx.cwd, commit.flowId);
		if (!location) return { kind: "failed" };
		const preview = applyCheckboxAttributionCommit(location.flow, commit);
		if (!preview) return { kind: "failed" };
		if (!preview.changed) {
			refreshFlowHtmlProjection(
				ctx,
				location.dir,
				location.flow,
				commit.language,
			);
			return { kind: "saved" };
		}
		const synced = withFlowLockSync(
			location.dir,
			`sync checkbox attribution ${commit.flowId}`,
			() => {
				const flow = readFlow(location.dir);
				const applied = applyCheckboxAttributionCommit(flow, commit);
				if (!applied) return undefined;
				return applied.changed ? writeFlow(location.dir, applied.flow) : flow;
			},
		);
		if (!synced.ok)
			return { kind: "locked", dir: location.dir, owner: synced.owner };
		if (!synced.value) return { kind: "failed" };
		refreshFlowHtmlProjection(ctx, location.dir, synced.value, commit.language);
		return { kind: "saved" };
	} catch (error) {
		notifyUser(
			ctx,
			goalReviewSyncFailedNotice(formatNotifyError(error), commit.language),
			"info",
			commit.language,
		);
		return { kind: "failed" };
	}
}

function applyCheckboxAttributionCommit(
	flow: FlowState,
	commit: FlowCheckboxAttributionCommit,
) {
	const goal = flow.goals[commit.goalIndex];
	if (!goal || goal.index !== commit.goalIndex || goal.file !== commit.goalFile)
		return undefined;
	const applied = applyCheckboxAttributionChanges(
		goal.checkAttribution,
		commit.changes,
	);
	if (!applied.changed) return { flow, changed: false };
	const goals = flow.goals.map((item, index) =>
		index === commit.goalIndex
			? { ...item, checkAttribution: applied.attribution }
			: item,
	);
	return { flow: { ...flow, goals }, changed: true };
}

function applyCheckboxAttributionChanges(
	current: Record<string, CheckboxAttribution> | undefined,
	changes: CheckboxAttributionChange[],
) {
	const attribution = { ...(current ?? {}) };
	let changed = false;
	for (const change of changes) {
		const value = attribution[change.key];
		if (checkboxAttributionEqual(value, change.after)) continue;
		if (checkboxAttributionEqual(value, change.before)) {
			changed = updateCheckboxAttribution(attribution, change) || changed;
			continue;
		}
		if (change.after && (!value || change.after.at > value.at)) {
			attribution[change.key] = change.after;
			changed = true;
		}
	}
	return { attribution, changed };
}

function updateCheckboxAttribution(
	attribution: Record<string, CheckboxAttribution>,
	change: CheckboxAttributionChange,
) {
	if (change.after) attribution[change.key] = change.after;
	else delete attribution[change.key];
	return true;
}

function checkboxAttributionEqual(
	left: CheckboxAttribution | undefined,
	right: CheckboxAttribution | undefined,
) {
	return (
		left?.model === right?.model &&
		left?.thinking === right?.thinking &&
		left?.at === right?.at
	);
}

function syncFlowGoalReviews(
	state: GoalRuntimeState,
	ctx: StatusContext,
	goal: ActiveGoal,
	options: {
		expectedGeneration?: string | null;
		completionCursor?: CompletionCursor;
		attention?: PauseAttention;
	},
): GoalReviewSurfaceSyncResult {
	try {
		const owner = flowOwnerForSession(ctx);
		if (!owner) return { kind: "failed" };
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
					return false;
				if (
					options.expectedGeneration !== undefined &&
					checkpointGeneration(current.checks, state.goalReviewLive) !==
						options.expectedGeneration
				)
					return false;
				const checks = artifactChecks(
					goal.stateReviewHistory,
					goal.qualityReviewHistory,
					current.checks,
					state.goalReviewLive,
				);
				const goals = flow.goals.map((item, index) =>
					index === flow.currentGoal
						? {
								...item,
								checks,
								...(goal.checkAttribution
									? { checkAttribution: goal.checkAttribution }
									: {}),
								...(options.completionCursor !== undefined
									? { completionCursor: options.completionCursor }
									: {}),
							}
						: item,
				);
				const status =
					goal.status === "paused" || goal.status === "budget_limited"
						? "paused"
						: flow.status;
				return writeFlow(owner.dir, {
					...flow,
					status,
					goals,
					...(options.attention
						? { attention: { ...options.attention, at: Date.now() } }
						: {}),
				});
			},
		);
		if (synced.ok) {
			if (!synced.value) return { kind: "failed" };
			refreshFlowHtmlProjection(ctx, owner.dir, synced.value, goal.language);
			return { kind: "saved" };
		}
		notifyUser(
			ctx,
			flowLockBusyMessage(synced.owner, goal.language),
			"info",
			goal.language,
		);
		return { kind: "locked", dir: owner.dir, owner: synced.owner };
	} catch (error) {
		notifyUser(
			ctx,
			goalReviewSyncFailedNotice(formatNotifyError(error), goal.language),
			"info",
			goal.language,
		);
		return { kind: "failed" };
	}
}

function checkpointGeneration(
	checks: GoalChecks,
	live: GoalRuntimeState["goalReviewLive"],
) {
	return live ? (checks[live.phase].active?.generation ?? null) : null;
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
		...(entry.models ? { models: entry.models } : {}),
	};
}

function stateReviewSummary(goal: ActiveGoal): string {
	if (!reviewToggles().acceptance)
		return goal.language === "en" ? "Acceptance disabled" : "验收未启用";
	return (
		goal.stateReviewHistory.at(-1)?.summary ??
		(goal.language === "en" ? "Acceptance passed." : "验收通过。")
	);
}

function sessionEntriesInspectable(ctx: StatusContext): boolean {
	const sessionManager = ctx.sessionManager as
		| { getBranch?: () => unknown[]; getEntries?: () => unknown[] }
		| undefined;
	return Boolean(sessionManager?.getBranch ?? sessionManager?.getEntries);
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

function durationSince(startedAt: number): string {
	return formatDuration(elapsedSeconds(startedAt));
}

function goalCompletionFactWriteFailedNotice(
	error: string,
	language: "zh" | "en",
) {
	return language === "en"
		? formatUserNotice("❌", "Goal completion fact write failed", [error])
		: formatUserNotice("❌", "目标完成事实写入失败", [error]);
}

function goalReviewSyncFailedNotice(error: string, language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("⚠️", "Goal review sync failed", [error])
		: formatUserNotice("⚠️", "目标检查进度同步失败", [error]);
}

function formatNotifyError(error: unknown): string {
	const value = error instanceof Error ? error.message : String(error);
	return value.length > 160 ? `${value.slice(0, 157)}…` : value;
}

function nextCompletionAuditGeneration(state: GoalRuntimeState): number {
	state.completionAuditGeneration += 1;
	return state.completionAuditGeneration;
}
