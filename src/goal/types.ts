export type GoalArtifactStatus =
	| "running"
	| "paused"
	| "budget_limited"
	| "complete"
	| "cancelled";

export interface GoalHandoff {
	kind: "user_action_required";
	message: string;
	at: number;
}

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
	thinking?: string;
}

/** 顾问介入记录：随轮次落盘，供失败反馈拼接与 HTML 报告渲染。 */
export interface CheckRoundAdvisor {
	model: string;
	thinking: string;
	advice: string;
}

export interface CheckModelOutcome {
	result: CheckResult;
	summary: string;
	details: string;
}

export interface ActiveCheckModel {
	key: string;
	label: string;
	thinking?: string;
	outcome: CheckModelOutcome | null;
}

export interface ActiveCheckRun {
	round: number;
	generation: string;
	/** 逻辑检查运行标识：崩溃恢复沿用，新运行重建。 */
	runId: string;
	/** 本轮检查启动时刻：同输入恢复沿用，用于轮次用时。 */
	startedAt?: number;
	inputHash: string;
	models: ActiveCheckModel[];
}

export interface CheckRound {
	round: number;
	result: CheckResult;
	summary: string;
	details?: string;
	models?: CheckModelSnapshot[];
	advisor?: CheckRoundAdvisor;
	elapsedMs?: number;
}

export interface CheckPhase {
	enabled: boolean;
	rounds: CheckRound[];
	active: ActiveCheckRun | null;
	/** 运行时字段：顾问咨询进行中（由插件发布，模型不写；下一次检查状态同步自然覆盖）。 */
	consulting?: boolean;
}

export interface GoalChecks {
	acceptance: CheckPhase;
	quality: CheckPhase;
}
