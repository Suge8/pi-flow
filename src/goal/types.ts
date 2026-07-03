import type { FlowSource } from "../flow/types.js";
import type { Language } from "../shared/config.js";

export type GoalArtifactStatus =
	| "draft"
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

export interface GoalArtifactResult {
	summary: string | null;
	outcome: string | null;
}

export interface GoalArtifactState {
	schemaVersion: 5;
	language: Language;
	id: string;
	title: string;
	status: GoalArtifactStatus;
	completionCursor: CompletionCursor;
	source: FlowSource;
	createdAt: number;
	updatedAt: number;
	repairAttempts: number;
	errors: string[];
	sessionFile: string | null;
	sessionName: string | null;
	snapshot: string | null;
	snapshotHash: string | null;
	runtimeGoalId: string | null;
	result: GoalArtifactResult;
	checks: GoalChecks;
}

export interface GoalArtifactLocation {
	id: string;
	dir: string;
	jsonPath: string;
	goal: GoalArtifactState;
}
