import type { CompletionCursor, GoalChecks } from "../goal/types.js";
import type { Language } from "../shared/config.js";
import type { ConversationTurn } from "../shared/context-evidence.js";
import type { AlignmentTurn } from "../shared/generation-alignment.js";

export const FLOW_SCHEMA_VERSION = 17;

export type FlowStatus =
	| "aligning"
	| "generating"
	| "draft"
	| "paused"
	| "running"
	| "complete";
export type FlowGoalStatus = "pending" | "running" | "paused" | "complete";
export type FlowGoalRole = "normal" | "final_acceptance";
export type FlowSource =
	| { type: "conversation"; transcript: ConversationTurn[] }
	| { type: "prompt"; text: string }
	| { type: "file"; path: string; text: string };
export type FlowSourceType = FlowSource["type"];

export interface FlowAlignment {
	kind: "recorded";
	turns: AlignmentTurn[];
}

/** 生成侧元信息：计划模型与对齐事实；只在生成成功时写入。 */
export interface FlowMeta {
	plannedBy: { model: string; thinking: string } | null;
	alignment: FlowAlignment | null;
}

export type FlowAttentionKind =
	| "check_hard_cap"
	| "system_error"
	| "interrupted"
	| "user_action_required";

/** 需要用户接管的异常事实；用户主动暂停不写。`/flow go` 恢复时清空。 */
export interface FlowAttention {
	kind: FlowAttentionKind;
	message: string;
	at: number;
}

/** 勾级归因：哪个模型在何时把计划 checkbox 写成完成。 */
export type CheckboxAttribution = {
	model: string;
	thinking: string;
	at: number;
};

export interface FlowGoalResult {
	summary: string | null;
	handoff: string | null;
	handoffGenerated: boolean;
	criteriaChanged: boolean;
}

/** 手动顾问建议的持久化 outbox：正文只存于对应检查轮，投递后清空引用。 */
export interface PendingAdvisor {
	phase: "acceptance" | "quality";
	round: number;
}

export interface FlowGoal {
	index: number;
	title: string;
	role: FlowGoalRole;
	file: string;
	dependsOn?: number[];
	writeScope?: string[];
	status: FlowGoalStatus;
	startedAt: number | null;
	completedAt: number | null;
	completionCursor: CompletionCursor;
	sessionFile: string | null;
	sessionName: string | null;
	snapshot: string | null;
	goalId: string | null;
	result: FlowGoalResult;
	checks: GoalChecks;
	pendingAdvisor: PendingAdvisor | null;
	checkAttribution?: Record<string, CheckboxAttribution>;
}

export interface FlowParallelRun {
	id: string;
	goalIndexes: number[];
	startedAt: number;
	consoleSessionFile: string;
	consoleSessionName: string;
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
	completedAt: number | null;
	currentGoal: number;
	meta: FlowMeta | null;
	attention: FlowAttention | null;
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
	checkAttribution?: Record<string, CheckboxAttribution>;
	parallelRunId?: string;
}
