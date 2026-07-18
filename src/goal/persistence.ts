import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CheckboxAttribution } from "../flow/types.js";
import { reviewToggles } from "../shared/config.js";
import { formatError, isRecord } from "../shared/guards.js";
import { discardActiveChecks } from "../shared/report-review.js";
import { formatUserNotice, notifyUser } from "../shared/ui-language.js";
import type {
	ActiveGoal,
	ReviewHistoryEntry,
	StatusContext,
} from "./runtime.js";
import { GOAL_STATE_ENTRY_TYPE } from "./session-entry.js";
import type {
	ActiveCheckRun,
	CheckRound,
	CompletionCursor,
	GoalArtifactStatus,
	GoalChecks,
	GoalHandoff,
} from "./types.js";
import { outcomeFromPlan } from "./validator.js";

export { GOAL_STATE_ENTRY_TYPE } from "./session-entry.js";

export interface GoalStateEntryData {
	goal?: ActiveGoal | null;
}

export function persistGoal(
	goal: ActiveGoal,
	ctx: StatusContext | undefined,
	pi: ExtensionAPI | undefined,
): void {
	appendCustomEntry(ctx, pi, GOAL_STATE_ENTRY_TYPE, { goal });
}

export function clearPersistedGoal(
	ctx: StatusContext | undefined,
	pi: ExtensionAPI | undefined,
): void {
	appendCustomEntry<GoalStateEntryData>(ctx, pi, GOAL_STATE_ENTRY_TYPE, {
		goal: null,
	});
}

export function appendCustomEntry<T>(
	ctx: StatusContext | undefined,
	pi: ExtensionAPI | undefined,
	customType: string,
	data: T,
): void {
	const sessionManager = ctx?.sessionManager as
		| { appendCustomEntry?: (customType: string, data?: unknown) => unknown }
		| undefined;
	if (sessionManager?.appendCustomEntry) {
		sessionManager.appendCustomEntry(customType, data);
		return;
	}
	pi?.appendEntry<T>(customType, data);
}

interface GoalCheckLive {
	phase: "acceptance" | "quality";
	active: ActiveCheckRun | null;
	rounds?: ReviewHistoryEntry[];
	consulting?: boolean;
}

export interface StepRuntimeState {
	status: GoalArtifactStatus;
	completionCursor: CompletionCursor;
	runtimeGoalId: string | null;
	sessionFile: string | null;
	sessionName: string | null;
	result: { summary: string | null; outcome: string | null };
	checks: GoalChecks;
	checkAttribution?: Record<string, CheckboxAttribution>;
	handoff?: GoalHandoff | null;
	updatedAt: number;
}

interface RuntimeArtifactRef {
	artifactPlanPath?: string;
	artifactStatePath?: string;
}

export function saveActiveGoal(input: {
	ctx: StatusContext;
	goal: ActiveGoal | undefined;
	live: GoalCheckLive | undefined;
	pi: ExtensionAPI | undefined;
}): void {
	if (!input.goal) return;
	syncStandaloneGoalArtifact(input.ctx, input.goal, input.live);
	persistGoal(input.goal, input.ctx, input.pi);
}

export function syncStandaloneGoalArtifact(
	ctx: StatusContext,
	goal: ActiveGoal,
	live: GoalCheckLive | undefined,
	options: {
		acceptance?: string;
		expectedGeneration?: string | null;
		preserveChecks?: boolean;
		completionCursor?: CompletionCursor;
		handoff?: GoalHandoff;
	} = {},
): boolean {
	if (!hasRuntimeArtifact(goal)) return true;
	try {
		const state = readGoalRuntimeState(goal);
		if (
			options.expectedGeneration !== undefined &&
			checkpointGeneration(state.checks, live) !== options.expectedGeneration
		)
			return false;
		const markdown = readFileSync(runtimePlanPath(goal), "utf8");
		const outcome = outcomeFromPlan(markdown);
		writeGoalRuntimeState(goal, {
			...state,
			status: artifactStatus(goal.status),
			...(goal.checkAttribution !== undefined
				? { checkAttribution: goal.checkAttribution }
				: {}),
			...(options.completionCursor !== undefined
				? { completionCursor: options.completionCursor }
				: {}),
			...(options.handoff ? { handoff: options.handoff } : {}),
			runtimeGoalId: goal.id,
			result: {
				summary: options.acceptance || state.result.summary,
				outcome: outcome || state.result.outcome,
			},
			checks: options.preserveChecks
				? state.checks
				: artifactChecks(
						goal.stateReviewHistory,
						goal.qualityReviewHistory,
						state.checks,
						live,
					),
		});
		return true;
	} catch (error) {
		notifyUser(
			ctx,
			goalStateSaveFailedNotice(notifyError(error), goal.language),
			"info",
			goal.language,
		);
		return false;
	}
}

export function cancelStandaloneGoalArtifact(
	ctx: StatusContext,
	goal: ActiveGoal,
): void {
	if (!hasRuntimeArtifact(goal)) return;
	try {
		const state = readGoalRuntimeState(goal);
		writeGoalRuntimeState(goal, {
			...state,
			status: "cancelled",
			checks: discardActiveChecks(state.checks),
		});
	} catch (error) {
		notifyUser(
			ctx,
			goalCancellationSaveFailedNotice(notifyError(error), goal.language),
			"info",
			goal.language,
		);
	}
}

export function artifactChecks(
	acceptanceRounds: ReviewHistoryEntry[],
	qualityRounds: ReviewHistoryEntry[],
	prior: GoalChecks | null | undefined,
	live?: GoalCheckLive,
): GoalChecks {
	const toggles = reviewToggles();
	return {
		acceptance: {
			enabled: toggles.acceptance,
			rounds: acceptanceRounds.length
				? acceptanceRounds.map(checkRound)
				: (prior?.acceptance.rounds ?? []),
			active: live?.phase === "acceptance" ? live.active : null,
			...(live?.phase === "acceptance" && live.consulting
				? { consulting: true }
				: {}),
		},
		quality: {
			enabled: toggles.quality,
			rounds:
				live?.phase === "quality" && live.rounds
					? live.rounds.map(checkRound)
					: qualityRounds.length
						? qualityRounds.map(checkRound)
						: (prior?.quality.rounds ?? []),
			active: live?.phase === "quality" ? live.active : null,
			...(live?.phase === "quality" && live.consulting
				? { consulting: true }
				: {}),
		},
	};
}

export function readGoalRuntimeState(
	ref: RuntimeArtifactRef,
): StepRuntimeState {
	return readRuntimeStatePath(runtimeStatePath(ref));
}

export function writeGoalRuntimeState(
	ref: RuntimeArtifactRef,
	state: StepRuntimeState,
) {
	return writeRuntimeStatePath(runtimeStatePath(ref), state);
}

function readRuntimeStatePath(path: string): StepRuntimeState {
	const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!isRecord(parsed)) throw new Error(`${path} 必须是对象`);
	return parsed as unknown as StepRuntimeState;
}

function writeRuntimeStatePath(path: string, state: StepRuntimeState) {
	mkdirSync(dirname(path), { recursive: true });
	const previous = readJsonObject(path);
	const next = { ...previous, ...state, updatedAt: Date.now() };
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
	renameSync(tmp, path);
	return next;
}

function readJsonObject(path: string) {
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function checkpointGeneration(
	checks: GoalChecks,
	live: GoalCheckLive | undefined,
) {
	return live ? (checks[live.phase].active?.generation ?? null) : null;
}

function hasRuntimeArtifact(ref: RuntimeArtifactRef) {
	return Boolean(ref.artifactStatePath);
}

function runtimeStatePath(ref: RuntimeArtifactRef) {
	if (ref.artifactStatePath) return ref.artifactStatePath;
	throw new Error("目标缺少 state artifact");
}

function runtimePlanPath(ref: RuntimeArtifactRef) {
	if (ref.artifactPlanPath) return ref.artifactPlanPath;
	throw new Error("目标缺少 plan artifact");
}

function artifactStatus(
	status: ActiveGoal["status"],
): "running" | "paused" | "budget_limited" | "complete" {
	if (status === "active") return "running";
	return status;
}

function checkRound(entry: ReviewHistoryEntry): CheckRound {
	return {
		round: entry.round,
		result: entry.result,
		summary: entry.summary,
		...(entry.details ? { details: entry.details } : {}),
		...(entry.models ? { models: entry.models } : {}),
		...(entry.advisor ? { advisor: entry.advisor } : {}),
		...(entry.elapsedMs !== undefined ? { elapsedMs: entry.elapsedMs } : {}),
	};
}

function goalStateSaveFailedNotice(error: string, language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("❌", "Goal state save failed", [error])
		: formatUserNotice("❌", "目标状态保存失败", [error]);
}

function goalCancellationSaveFailedNotice(
	error: string,
	language: "zh" | "en",
) {
	return language === "en"
		? formatUserNotice("❌", "Goal cancellation save failed", [error])
		: formatUserNotice("❌", "目标取消保存失败", [error]);
}

function notifyError(error: unknown): string {
	return truncateNotification(formatError(error));
}

function truncateNotification(value: string): string {
	return value.length > 160 ? `${value.slice(0, 157)}…` : value;
}
