import type { CompletionCursor, GoalChecks } from "../goal/types.js";
import type { Language } from "../shared/config.js";

export const FLOW_SCHEMA_VERSION = 9;

export type FlowStatus =
	| "aligning"
	| "generating"
	| "draft"
	| "paused"
	| "running"
	| "complete";
export type FlowGoalStatus = "pending" | "running" | "complete";
export type FlowGoalRole = "normal" | "final_acceptance";
export type FlowSourceType = "conversation" | "prompt" | "file";

export interface FlowSource {
	type: FlowSourceType;
	path: string | null;
	originalRequest: string;
}

export interface FlowGoalResult {
	summary: string | null;
	handoff: string | null;
	handoffGenerated: boolean;
	criteriaChanged: boolean;
}

export interface FlowGoal {
	index: number;
	title: string;
	role: FlowGoalRole;
	file: string;
	dependsOn?: number[];
	writeScope?: string[];
	status: FlowGoalStatus;
	completionCursor: CompletionCursor;
	sessionFile: string | null;
	sessionName: string | null;
	snapshot: string | null;
	snapshotHash: string | null;
	goalId: string | null;
	result: FlowGoalResult;
	checks: GoalChecks;
}

export interface FlowParallelRun {
	id: string;
	goalIndexes: number[];
	startedAt: number;
}

export interface FlowState {
	schemaVersion: typeof FLOW_SCHEMA_VERSION;
	language: Language;
	id: string;
	title: string;
	status: FlowStatus;
	source: FlowSource;
	createdAt: number;
	updatedAt: number;
	startedAt: number | null;
	currentGoal: number;
	parallelRun: FlowParallelRun | null;
	repairAttempts: number;
	errors: string[];
	goals: FlowGoal[];
}

export interface FlowLocation {
	id: string;
	dir: string;
	jsonPath: string;
	flow: FlowState;
}

export interface ValidationResult {
	ok: boolean;
	errors: string[];
	flow?: FlowState;
}

export interface GoalCompletionFact {
	goalId: string;
	summary: string;
	acceptance: string;
	sessionFile: string | null;
	checks?: GoalChecks | null;
	parallelRunId?: string;
}
