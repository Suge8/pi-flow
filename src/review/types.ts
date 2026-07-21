import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ActiveCheckRun, CheckRoundAdvisor } from "../goal/types.js";
import type { Language, readFlowConfig } from "../shared/config.js";
import type { PlanEvidence } from "../shared/plan-evidence.js";
import type { ReviewHistoryEntry } from "../shared/review-history.js";
import type { ReviewerProgress } from "../shared/reviewer-pool.js";
import type { ElapsedStatus } from "../shared/status.js";

type MaybePromise<T> = T | Promise<T>;
export type FlowConfig = ReturnType<typeof readFlowConfig>;

export type ReviewCancellationSource = "user" | "flow_stop" | "shutdown";

export type ReviewStop =
	| {
			kind: "cancelled";
			source: ReviewCancellationSource;
			expectedGeneration?: string;
	  }
	| {
			kind:
				| "system_error"
				| "config_error"
				| "hard_stop"
				| "retry_exhausted"
				| "blocked"
				| "user_action"
				| "check_limit";
			message: string;
			feedbackDelivered?: boolean;
			expectedGeneration?: string;
	  };

export type ReviewRunResult =
	| { kind: "passed"; stats: ReviewLoopStats; summary: string }
	| { kind: "awaiting_agent" }
	| { kind: "awaiting_delivery" }
	| { kind: "needs_user" }
	| { kind: "disabled" }
	| { kind: "busy" }
	| { kind: "checkpoint_deferred" }
	| { kind: "stopped"; stop: ReviewStop };

export type ReviewCheckpointResult = "saved" | "deferred";

export interface ReviewActivityScope {
	object: string;
	rows: string[];
}

export type ReviewScope =
	| { kind: "review"; language?: Language }
	| {
			kind: "goal";
			goalId: string;
			language: Language;
			goalText: string;
			plan?: PlanEvidence;
			planChangeNote?: string;
			statusPrefix?: string;
			statusKey?: string;
			totalStartedAt?: number;
			showTotalElapsed?: boolean;
			resumeCommand?: string;
			activity?: ReviewActivityScope;
			/** 证据锚点：只取锚点之后的会话事实（fork 会话不吃计划期前缀）。 */
			sessionAnchorId?: string;
	  };

export type ReviewLoopOptions = {
	scope?: ReviewScope;
	deferNextAgentEnd?: boolean;
	initialHistory?: ReviewHistoryEntry[];
	activeCheck?: ActiveCheckRun | null;
	onCheckRun?: (
		active: ActiveCheckRun | null,
		history: ReviewHistoryEntry[],
		expectedGeneration: string | null,
		phase: "checking" | "awaiting_agent" | null,
	) => MaybePromise<ReviewCheckpointResult | undefined>;
	/** 配置校验通过且首轮 durable 状态已提交后，发布唯一启动 UI。 */
	onStart?: (config: FlowConfig) => MaybePromise<void>;
	onRoundStart?: (round: number) => MaybePromise<void>;
	onRoundFailed?: (
		round: number,
		history: ReviewHistoryEntry[],
		signal: AbortSignal,
	) => MaybePromise<ReviewRoundFailedDirective>;
	/** 失败反馈已成功投递且检查历史已提交后回调；durable 失败计数在此提交。 */
	onRoundFailedDelivered?: (
		round: number,
		history: ReviewHistoryEntry[],
	) => MaybePromise<void>;
	/** 受控停止反馈提交前投递；false 保留当前检查 checkpoint。 */
	onStopFeedback?: (
		stop: Exclude<ReviewStop, { kind: "cancelled" }>,
		history: ReviewHistoryEntry[],
		deliveryId: string | undefined,
	) => MaybePromise<boolean>;
	/** 每轮失败后修复 prompt 已投递、循环进入等待执行模型修复时回调。 */
	onAwaitingAgent?: () => MaybePromise<void>;
	onPass?: (stats: ReviewLoopStats, summary: string) => MaybePromise<void>;
	onStop?: (
		stop: ReviewStop,
		history: ReviewHistoryEntry[],
	) => MaybePromise<void>;
	onProgress?: (
		progress: ReviewerProgress[],
		history: ReviewHistoryEntry[],
	) => void;
};

export interface ReviewRoundFailedDirective {
	/** 非空时停止质检循环，作为受控停止原因。 */
	stopMessage?: string;
	/** 失败卡落盘后执行的顾问咨询；循环负责投递与恢复时序。 */
	consultAdvisor?: (
		signal: AbortSignal,
	) => Promise<CheckRoundAdvisor | undefined>;
	/** 附加到本轮失败反馈 prompt 末尾的条款。 */
	extraPromptLines?: string[];
}

export type { ReviewHistoryEntry } from "../shared/review-history.js";

export interface ReviewLoopStats {
	rounds: number;
	repairs: number;
	total: string;
	history: ReviewHistoryEntry[];
}

export interface ReviewLoop {
	context: ExtensionContext;
	flowConfig: FlowConfig;
	round: number;
	repairs: number;
	startedAt: number;
	stepStartedAt: number;
	awaitingAgent: boolean;
	skipNextAgentEnd: boolean;
	startPublished?: boolean;
	status?: ElapsedStatus;
	options: ReviewLoopOptions;
	controller: AbortController;
	history: ReviewHistoryEntry[];
	reviewerProgress: ReviewerProgress[];
	activeCheck?: ActiveCheckRun;
	/** 独立 /review 目录 generation；goal-scoped 不使用。 */
	reportRun?: number;
	cancellationSource?: ReviewCancellationSource;
	handlingOutcome?: boolean;
	finished: Promise<void>;
	resolveFinished: () => void;
	stopPromise?: Promise<void>;
	recoverableTransportNotified?: boolean;
}

export type ReviewAgentEndResult = "none" | "active" | "skipped" | "handled";
