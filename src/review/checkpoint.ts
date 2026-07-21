import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	ActiveCheckModel,
	ActiveCheckRun,
	CheckModelOutcome,
	CheckResult,
} from "../goal/types.js";
import { isRecord } from "../shared/guards.js";
import type { ReportLifecycle } from "../shared/report-protocol.js";
import type {
	ReviewHistoryEntry,
	ReviewHistoryResult,
} from "../shared/review-history.js";

export const REVIEW_CHECKPOINT_ENTRY_TYPE = "review-checkpoint";
const REVIEW_CHECKPOINT_VERSION = 3;

const CHECKPOINT_KEYS = [
	"version",
	"active",
	"round",
	"phase",
	"history",
	"reportRun",
] as const;

const ACTIVE_KEYS = [
	"round",
	"generation",
	"runId",
	"inputHash",
	"models",
] as const;

const ACTIVE_OPTIONAL_KEYS = ["startedAt"] as const;

const ACTIVE_MODEL_KEYS = ["key", "label", "outcome"] as const;
const ACTIVE_MODEL_OPTIONAL_KEYS = ["thinking"] as const;

const OUTCOME_KEYS = ["result", "summary", "details"] as const;

const HISTORY_KEYS = ["round", "result", "summary"] as const;
const HISTORY_OPTIONAL_KEYS = [
	"details",
	"models",
	"advisor",
	"elapsedMs",
] as const;

const HISTORY_MODEL_KEYS = ["label", "status"] as const;
const HISTORY_MODEL_OPTIONAL_KEYS = ["summary", "thinking"] as const;

const ADVISOR_KEYS = ["model", "thinking", "advice"] as const;

export class ReviewCheckpointConflictError extends Error {
	constructor() {
		super("质检 checkpoint generation 已失效");
		this.name = "ReviewCheckpointConflictError";
	}
}

/** 独立 /review 循环的 durable 状态：检查中（active 非空）或等待执行模型修复。 */
export interface ReviewCheckpointState {
	active: ActiveCheckRun | null;
	round: number;
	phase: "checking" | "awaiting_agent" | null;
	/** 已结算轮次历史：重启恢复后统计与后续轮次不丢失往轮。 */
	history: ReviewHistoryEntry[];
	/** 报告目录 generation；中断恢复复用，终态后新一轮必须递增。 */
	reportRun: number;
}

export function readReviewCheckpoint(
	ctx: Pick<ExtensionContext, "sessionManager">,
): ReviewCheckpointState | undefined {
	const sessionManager = ctx.sessionManager as
		| { getBranch?: () => unknown[]; getEntries?: () => unknown[] }
		| undefined;
	const entries =
		sessionManager?.getBranch?.() ?? sessionManager?.getEntries?.() ?? [];
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (
			!isRecord(entry) ||
			entry.type !== "custom" ||
			entry.customType !== REVIEW_CHECKPOINT_ENTRY_TYPE ||
			!isRecord(entry.data)
		)
			continue;
		const parsed = parseReviewCheckpointData(entry.data);
		if (parsed) return parsed;
	}
	return undefined;
}

export function writeReviewCheckpoint(
	pi: ExtensionAPI | undefined,
	ctx: Pick<ExtensionContext, "sessionManager">,
	state: ReviewCheckpointState,
	expectedGeneration: string | null,
) {
	const currentGeneration =
		readReviewCheckpoint(ctx)?.active?.generation ?? null;
	if (currentGeneration !== expectedGeneration)
		throw new ReviewCheckpointConflictError();
	const data = {
		version: REVIEW_CHECKPOINT_VERSION,
		active: state.active,
		round: state.round,
		phase: state.phase,
		history: state.history,
		reportRun: state.reportRun,
	};
	if (!parseReviewCheckpointData(data))
		throw new Error("质检 checkpoint 状态非法");
	const sessionManager = ctx.sessionManager as
		| {
				appendCustomEntry?: (customType: string, data?: unknown) => unknown;
		  }
		| undefined;
	if (sessionManager?.appendCustomEntry) {
		sessionManager.appendCustomEntry(REVIEW_CHECKPOINT_ENTRY_TYPE, data);
		return;
	}
	pi?.appendEntry(REVIEW_CHECKPOINT_ENTRY_TYPE, data);
}

/** 新 /review 取 max(now, previous+1)；中断恢复直接复用 checkpoint.reportRun。 */
export function nextReviewReportRun(previous: number | undefined) {
	const now = Date.now();
	if (previous === undefined) return now;
	return Math.max(now, previous + 1);
}

export function reviewReportPublication(
	state: Pick<ReviewCheckpointState, "active" | "phase" | "reportRun">,
): ReportLifecycle {
	return {
		generation: state.reportRun,
		state: state.active === null && state.phase === null ? "complete" : "live",
	};
}

/** 严格 v3：精确顶层键 + 嵌套结构；畸形不得折叠为终态。 */
export function parseReviewCheckpointData(
	value: unknown,
): ReviewCheckpointState | undefined {
	if (!isRecord(value) || !exactKeys(value, CHECKPOINT_KEYS)) return undefined;
	if (value.version !== REVIEW_CHECKPOINT_VERSION) return undefined;
	if (!nonNegativeInteger(value.round)) return undefined;
	if (!positiveSafeInteger(value.reportRun)) return undefined;
	if (
		value.phase !== null &&
		value.phase !== "checking" &&
		value.phase !== "awaiting_agent"
	)
		return undefined;
	const active = parseActiveCheckRun(value.active);
	if (active === undefined) return undefined;
	if (!Array.isArray(value.history)) return undefined;
	const history: ReviewHistoryEntry[] = [];
	for (const item of value.history) {
		const entry = parseHistoryEntry(item);
		if (!entry) return undefined;
		history.push(entry);
	}
	// phase/active/round 不变量：
	// - 终态：active 必须 null
	// - awaiting_agent：active 必须 null（含 round:0 武装态）
	// - checking：必须有 active，round>=1，且 active.round === round
	if (value.phase === null && active !== null) return undefined;
	if (value.phase === "awaiting_agent" && active !== null) return undefined;
	if (value.phase === "checking") {
		if (active === null) return undefined;
		if (value.round < 1) return undefined;
		if (active.round !== value.round) return undefined;
	}
	return {
		active,
		round: value.round,
		phase: value.phase,
		history,
		reportRun: value.reportRun,
	};
}

function parseActiveCheckRun(
	value: unknown,
): ActiveCheckRun | null | undefined {
	if (value === null) return null;
	if (!isRecord(value)) return undefined;
	const required = exactKeys(value, ACTIVE_KEYS, ACTIVE_OPTIONAL_KEYS);
	if (!required) return undefined;
	if (!nonNegativeInteger(value.round)) return undefined;
	if (typeof value.generation !== "string" || !value.generation)
		return undefined;
	if (typeof value.runId !== "string" || !value.runId) return undefined;
	if (typeof value.inputHash !== "string") return undefined;
	if (
		value.startedAt !== undefined &&
		(typeof value.startedAt !== "number" ||
			!Number.isFinite(value.startedAt) ||
			value.startedAt < 0)
	)
		return undefined;
	if (!Array.isArray(value.models) || value.models.length === 0)
		return undefined;
	const models: ActiveCheckModel[] = [];
	for (const item of value.models) {
		const model = parseActiveModel(item);
		if (!model) return undefined;
		models.push(model);
	}
	return {
		round: value.round,
		generation: value.generation,
		runId: value.runId,
		inputHash: value.inputHash,
		models,
		...(value.startedAt === undefined ? {} : { startedAt: value.startedAt }),
	};
}

function parseActiveModel(value: unknown): ActiveCheckModel | undefined {
	if (!isRecord(value)) return undefined;
	if (!exactKeys(value, ACTIVE_MODEL_KEYS, ACTIVE_MODEL_OPTIONAL_KEYS))
		return undefined;
	if (typeof value.key !== "string" || !value.key) return undefined;
	if (typeof value.label !== "string" || !value.label) return undefined;
	if (
		value.thinking !== undefined &&
		(typeof value.thinking !== "string" || !value.thinking)
	)
		return undefined;
	const outcome = parseOutcome(value.outcome);
	if (outcome === undefined) return undefined;
	return {
		key: value.key,
		label: value.label,
		outcome,
		...(value.thinking === undefined ? {} : { thinking: value.thinking }),
	};
}

function parseOutcome(value: unknown): CheckModelOutcome | null | undefined {
	if (value === null) return null;
	if (!isRecord(value) || !exactKeys(value, OUTCOME_KEYS)) return undefined;
	if (!isCheckResult(value.result)) return undefined;
	if (typeof value.summary !== "string") return undefined;
	if (typeof value.details !== "string") return undefined;
	return {
		result: value.result,
		summary: value.summary,
		details: value.details,
	};
}

function parseHistoryEntry(value: unknown): ReviewHistoryEntry | undefined {
	if (!isRecord(value)) return undefined;
	if (!exactKeys(value, HISTORY_KEYS, HISTORY_OPTIONAL_KEYS)) return undefined;
	if (!positiveSafeInteger(value.round) && value.round !== 0) return undefined;
	if (!nonNegativeInteger(value.round)) return undefined;
	if (!isHistoryResult(value.result)) return undefined;
	if (typeof value.summary !== "string") return undefined;
	if (value.details !== undefined && typeof value.details !== "string")
		return undefined;
	if (
		value.elapsedMs !== undefined &&
		(typeof value.elapsedMs !== "number" ||
			!Number.isFinite(value.elapsedMs) ||
			value.elapsedMs < 0)
	)
		return undefined;
	let models: ReviewHistoryEntry["models"];
	if (value.models !== undefined) {
		if (!Array.isArray(value.models)) return undefined;
		models = [];
		for (const item of value.models) {
			const model = parseHistoryModel(item);
			if (!model) return undefined;
			models.push(model);
		}
	}
	let advisor: ReviewHistoryEntry["advisor"];
	if (value.advisor !== undefined) {
		advisor = parseAdvisor(value.advisor);
		if (!advisor) return undefined;
	}
	return {
		round: value.round,
		result: value.result,
		summary: value.summary,
		...(value.details === undefined ? {} : { details: value.details }),
		...(models === undefined ? {} : { models }),
		...(advisor === undefined ? {} : { advisor }),
		...(value.elapsedMs === undefined ? {} : { elapsedMs: value.elapsedMs }),
	};
}

function parseHistoryModel(
	value: unknown,
): NonNullable<ReviewHistoryEntry["models"]>[number] | undefined {
	if (!isRecord(value)) return undefined;
	if (!exactKeys(value, HISTORY_MODEL_KEYS, HISTORY_MODEL_OPTIONAL_KEYS))
		return undefined;
	if (typeof value.label !== "string" || !value.label) return undefined;
	if (!isHistoryResult(value.status)) return undefined;
	if (value.summary !== undefined && typeof value.summary !== "string")
		return undefined;
	if (value.thinking !== undefined && typeof value.thinking !== "string")
		return undefined;
	return {
		label: value.label,
		status: value.status,
		...(value.summary === undefined ? {} : { summary: value.summary }),
		...(value.thinking === undefined ? {} : { thinking: value.thinking }),
	};
}

function parseAdvisor(
	value: unknown,
): NonNullable<ReviewHistoryEntry["advisor"]> | undefined {
	if (!isRecord(value) || !exactKeys(value, ADVISOR_KEYS)) return undefined;
	if (typeof value.model !== "string" || !value.model) return undefined;
	if (typeof value.thinking !== "string") return undefined;
	if (typeof value.advice !== "string") return undefined;
	return {
		model: value.model,
		thinking: value.thinking,
		advice: value.advice,
	};
}

function exactKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[] = [],
) {
	const allowed = new Set([...required, ...optional]);
	const keys = Object.keys(value);
	if (keys.some((key) => !allowed.has(key))) return false;
	return required.every((key) => Object.hasOwn(value, key));
}

function isCheckResult(value: unknown): value is CheckResult {
	return value === "passed" || value === "failed" || value === "error";
}

function isHistoryResult(value: unknown): value is ReviewHistoryResult {
	return value === "passed" || value === "failed" || value === "error";
}

function positiveSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
