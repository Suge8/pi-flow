import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { reviewToggles } from "../shared/config.js";
import { formatError, isRecord } from "../shared/guards.js";
import { settledChecks } from "../shared/report-review.js";
import type { ReviewerProgress } from "../shared/reviewer-pool.js";
import { notifyUser } from "../shared/ui-language.js";
import { writeGoalHtml } from "./html.js";
import type {
	ActiveGoal,
	ReviewHistoryEntry,
	StatusContext,
} from "./runtime.js";
import { goalPlanPath, readGoalArtifact, writeGoalArtifact } from "./store.js";
import type { CheckModelSnapshot, CheckRound, GoalChecks } from "./types.js";
import { outcomeFromPlan } from "./validator.js";
import { refreshGoalPlanHtml } from "./watcher.js";

export const GOAL_STATE_ENTRY_TYPE = "goal-state";
const STATE_FILE = join(
	process.env.PI_CODING_AGENT_DIR ??
		join(process.env.HOME ?? ".", ".pi", "agent"),
	"pi-goal-state.json",
);

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
	cwd: string,
	ctx: StatusContext | undefined,
	pi: ExtensionAPI | undefined,
): void {
	appendCustomEntry<GoalStateEntryData>(ctx, pi, GOAL_STATE_ENTRY_TYPE, {
		goal: null,
	});
	clearLegacyPersistedGoal(cwd);
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

function readState(): Record<string, unknown> {
	if (!existsSync(STATE_FILE)) return {};
	try {
		const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as unknown;
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function clearLegacyPersistedGoal(cwd: string): void {
	if (!existsSync(STATE_FILE)) return;
	const goals = readState();
	delete goals[cwd];
	mkdirSync(dirname(STATE_FILE), { recursive: true });
	writeFileSync(STATE_FILE, `${JSON.stringify(goals, null, 2)}\n`);
}

interface GoalCheckLive {
	phase: "acceptance" | "quality";
	progress: ReviewerProgress[];
	rounds?: ReviewHistoryEntry[];
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
	refreshGoalPlanHtml(input.goal.artifactDir);
}

export function syncStandaloneGoalArtifact(
	ctx: StatusContext,
	goal: ActiveGoal,
	live: GoalCheckLive | undefined,
	acceptance = "",
): void {
	if (!goal.artifactDir) return;
	try {
		const artifact = readGoalArtifact(goal.artifactDir);
		const markdown = readFileSync(goalPlanPath(goal.artifactDir), "utf8");
		const outcome = outcomeFromPlan(markdown);
		const saved = writeGoalArtifact(goal.artifactDir, {
			...artifact,
			status: artifactStatus(goal.status),
			runtimeGoalId: goal.id,
			result: {
				summary: acceptance || artifact.result.summary,
				outcome: outcome || artifact.result.outcome,
			},
			checks: artifactChecks(
				goal.stateReviewHistory,
				goal.qualityReviewHistory,
				artifact.checks,
				live,
			),
		});
		writeGoalHtml(goal.artifactDir, saved);
	} catch (error) {
		notifyUser(
			ctx,
			goal.language === "en"
				? `Goal state save failed: ${notifyError(error)}`
				: `目标状态保存失败：${notifyError(error)}`,
			"error",
			goal.language,
		);
	}
}

export function cancelStandaloneGoalArtifact(
	ctx: StatusContext,
	goal: ActiveGoal,
): void {
	if (!goal.artifactDir) return;
	try {
		const artifact = readGoalArtifact(goal.artifactDir);
		const saved = writeGoalArtifact(goal.artifactDir, {
			...artifact,
			status: "cancelled",
			checks: settledChecks(artifact.checks),
		});
		writeGoalHtml(goal.artifactDir, saved);
	} catch (error) {
		notifyUser(
			ctx,
			goal.language === "en"
				? `Goal cancellation save failed: ${notifyError(error)}`
				: `目标取消保存失败：${notifyError(error)}`,
			"error",
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
			rounds: acceptanceRounds.map(checkRound),
			active:
				live?.phase === "acceptance" ? modelSnapshots(live.progress) : null,
		},
		quality: {
			enabled: toggles.quality,
			rounds:
				live?.phase === "quality" && live.rounds
					? live.rounds.map(checkRound)
					: qualityRounds.length
						? qualityRounds.map(checkRound)
						: (prior?.quality.rounds ?? []),
			active: live?.phase === "quality" ? modelSnapshots(live.progress) : null,
		},
	};
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
	};
}

function modelSnapshots(progress: ReviewerProgress[]): CheckModelSnapshot[] {
	return progress.map((item) => ({
		label: item.label,
		status: item.status,
		...(item.summary ? { summary: item.summary } : {}),
	}));
}

function notifyError(error: unknown): string {
	return truncateNotification(formatError(error));
}

function truncateNotification(value: string): string {
	return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}
