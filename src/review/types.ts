import type { Language, readFlowConfig } from "../shared/config.js";
import type { PlanEvidence } from "../shared/plan-evidence.js";
import type { ReviewHistoryEntry } from "../shared/review-history.js";
import type { ReviewerProgress } from "../shared/reviewer-pool.js";
import type { ElapsedStatus } from "../shared/status.js";

type MaybePromise<T> = T | Promise<T>;
export type FlowConfig = ReturnType<typeof readFlowConfig>;

export type ReviewRunResult =
	| { kind: "passed"; stats: ReviewLoopStats; summary: string }
	| { kind: "awaiting_agent" }
	| { kind: "awaiting_delivery" }
	| { kind: "needs_user" }
	| { kind: "disabled" }
	| { kind: "busy" }
	| { kind: "stopped"; message?: string };

export interface ReviewActivityScope {
	object: string;
	rows: string[];
}

export type ReviewScope =
	| { kind: "review"; language?: Language }
	| {
			kind: "goal";
			language: Language;
			goalText: string;
			plan?: PlanEvidence;
			statusPrefix?: string;
			statusKey?: string;
			totalStartedAt?: number;
			showTotalElapsed?: boolean;
			resumeCommand?: string;
			activity?: ReviewActivityScope;
	  };

export type ReviewLoopOptions = {
	scope?: ReviewScope;
	deferNextAgentEnd?: boolean;
	initialHistory?: ReviewHistoryEntry[];
	onRoundStart?: (round: number) => MaybePromise<void>;
	onPass?: (stats: ReviewLoopStats, summary: string) => MaybePromise<void>;
	onStop?: (
		message?: string,
		history?: ReviewHistoryEntry[],
	) => MaybePromise<void>;
	onProgress?: (
		progress: ReviewerProgress[],
		history: ReviewHistoryEntry[],
	) => void;
};

export type { ReviewHistoryEntry } from "../shared/review-history.js";

export interface ReviewLoopStats {
	rounds: number;
	repairs: number;
	total: string;
	history: ReviewHistoryEntry[];
}

export interface ReviewLoop {
	flowConfig: FlowConfig;
	round: number;
	repairs: number;
	startedAt: number;
	stepStartedAt: number;
	awaitingAgent: boolean;
	skipNextAgentEnd: boolean;
	status?: ElapsedStatus;
	options: ReviewLoopOptions;
	controller: AbortController;
	history: ReviewHistoryEntry[];
	reviewerProgress: ReviewerProgress[];
	recoverableTransportNotified?: boolean;
}

export type ReviewAgentEndResult = "none" | "active" | "skipped" | "handled";
