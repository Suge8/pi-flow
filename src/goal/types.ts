export type GoalArtifactStatus =
	| "running"
	| "paused"
	| "budget_limited"
	| "complete"
	| "cancelled";

export type CheckModelStatus = "running" | "passed" | "failed" | "error";
export type CheckResult = "passed" | "failed" | "error";
export type CompletionCursor =
	| null
	| "acceptance_retry"
	| "acceptance_repair"
	| "quality_retry"
	| "quality_repair"
	| "finalize_retry";

export interface CheckModelSnapshot {
	label: string;
	status: CheckModelStatus;
	summary?: string;
}

export interface CheckRound {
	round: number;
	result: CheckResult;
	summary: string;
	details?: string;
}

export interface CheckPhase {
	enabled: boolean;
	rounds: CheckRound[];
	active: CheckModelSnapshot[] | null;
}

export interface GoalChecks {
	acceptance: CheckPhase;
	quality: CheckPhase;
}
