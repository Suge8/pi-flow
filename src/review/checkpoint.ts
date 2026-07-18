import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ActiveCheckRun } from "../goal/types.js";
import { isRecord } from "../shared/guards.js";
import type { ReviewHistoryEntry } from "../shared/review-history.js";

export const REVIEW_CHECKPOINT_ENTRY_TYPE = "review-checkpoint";
const REVIEW_CHECKPOINT_VERSION = 2;

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
			!isRecord(entry.data) ||
			entry.data.version !== REVIEW_CHECKPOINT_VERSION
		)
			continue;
		const data = entry.data;
		const active =
			data.active === null || isRecord(data.active)
				? (data.active as ActiveCheckRun | null)
				: null;
		return {
			active,
			round: typeof data.round === "number" ? data.round : (active?.round ?? 0),
			phase:
				data.phase === "checking" || data.phase === "awaiting_agent"
					? data.phase
					: null,
			history: Array.isArray(data.history)
				? (data.history as ReviewHistoryEntry[])
				: [],
		};
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
	const data = { version: REVIEW_CHECKPOINT_VERSION, ...state };
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
