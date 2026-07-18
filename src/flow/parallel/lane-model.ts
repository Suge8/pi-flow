import type { CheckPhase, GoalChecks } from "../../goal/types.js";
import { activitySpinnerLine } from "../../shared/activity-spinner.js";
import {
	type AgentProgress,
	silentProgressMinutes,
} from "../../shared/agent-progress.js";
import {
	laneSilentWarningText,
	laneThinkingText,
} from "../../shared/ui-language.js";
import type { FlowGoal, FlowState } from "../types.js";
import { clip } from "../util.js";
import {
	type FlowWorkerArtifact,
	readWorkerArtifact,
	readWorkerEvents,
} from "./worker-artifact.js";

export type LaneDisplayStatus =
	| "starting"
	| "running"
	| "accepting"
	| "completing"
	| "checking"
	| "optimizing"
	| "settling"
	| "complete"
	| "paused"
	| "interrupted";
export type LaneChecksStatus =
	| "waiting"
	| "running"
	| "passed"
	| "failed"
	| "error";

export interface LaneState {
	goalIndex: number;
	title: string;
	status: LaneDisplayStatus;
	activities: string[];
	checks: GoalChecks | undefined;
	progress?: AgentProgress;
	exit?: LaneExit;
}

export interface LaneExit {
	code: number | null;
	signal: NodeJS.Signals | null;
	stderr: string | null;
}

export interface CheckSlot {
	label: string;
	mark: string;
	text: string;
	tone: "accent" | "success" | "error" | "warning" | "muted";
	summary: string;
}

export interface LaneActivityLine {
	text: string;
	tone: "toolOutput" | "warning";
}

export function readLane(
	dir: string,
	flow: FlowState,
	goalIndex: number,
	exit: LaneExit | undefined,
	progress?: AgentProgress,
): LaneState {
	const goal = flow.goals[goalIndex];
	const artifact = readWorkerArtifact(dir, goalIndex);
	const checks = artifact?.checks ?? goal?.checks;
	return {
		goalIndex,
		title: artifact?.goalTitle ?? goal?.title ?? `G${goalIndex + 1}`,
		status: laneStatus(goal, artifact, checks, exit),
		activities: artifactActivities(
			artifact,
			readWorkerEvents(dir, goalIndex),
			flow.language,
			exit,
		),
		checks,
		...(progress ? { progress } : {}),
		...(exit ? { exit } : {}),
	};
}

export function exitActivities(
	exit: LaneExit | undefined,
	language: FlowState["language"],
) {
	if (!exit) return [];
	const summary = exitFailed(exit)
		? exitFailureSummary(exit, language)
		: exitSuccessSummary(language);
	const stderr =
		exitFailed(exit) && exit.stderr
			? [`stderr：${clip(exit.stderr, 120)}`]
			: [];
	return [summary, ...stderr];
}

export function checkSlots(
	checks: GoalChecks | undefined,
	language: FlowState["language"],
) {
	if (!checks) return [];
	return [
		checkSlot(
			language === "en" ? "Acceptance" : "验收",
			checks.acceptance,
			language,
		),
		checkSlot(
			language === "en" ? "Quality check" : "质检",
			checks.quality,
			language,
		),
	].filter((slot): slot is CheckSlot => Boolean(slot));
}

export function activityLines(
	activities: readonly string[],
	count: number,
	language: FlowState["language"],
	status?: LaneDisplayStatus,
) {
	if (count <= 0) return [];
	const recent = activities.slice(-count);
	const lines = recent.length ? recent : [emptyActivity(language)];
	while (lines.length < count) {
		if (status === "running") lines.push("");
		else lines.unshift("");
	}
	let spinnerPending = status === "running";
	return lines.map((line) => {
		if (!line) return "";
		const activity = spinnerPending ? activitySpinnerLine(line) : line;
		spinnerPending = false;
		return `  ${activity}`;
	});
}

export function laneActivityLines(
	lane: LaneState,
	count: number,
	language: FlowState["language"],
	nowMs: number,
): LaneActivityLine[] {
	if (!lane.progress)
		return activityLines(lane.activities, count, language, lane.status).map(
			(text) => ({ text, tone: "toolOutput" }),
		);
	if (count <= 0) return [];
	const lines: LaneActivityLine[] = [];
	if (lane.status === "running")
		lines.push(currentProgressLine(lane.progress, language, nowMs));
	for (const tool of [...lane.progress.recentTools].reverse())
		lines.push({ text: `  ${recentToolLine(tool)}`, tone: "toolOutput" });
	for (const activity of [...lane.activities].reverse())
		lines.push({ text: `  ${activity}`, tone: "toolOutput" });
	const unique = lines.filter(
		(line, index) =>
			line.text &&
			lines.findIndex((candidate) => candidate.text === line.text) === index,
	);
	while (unique.length < count) unique.push({ text: "", tone: "toolOutput" });
	return unique.slice(0, count);
}

export function progressMetrics(progress: AgentProgress | undefined) {
	if (!progress) return "";
	return `${progress.toolCallCount} calls · ${(progress.tokens / 1000).toFixed(1)}k tok`;
}

export function emptyActivity(language: FlowState["language"]) {
	return language === "en" ? "recent activity: —" : "最近活动：—";
}

function currentProgressLine(
	progress: AgentProgress,
	language: FlowState["language"],
	nowMs: number,
): LaneActivityLine {
	const silentMinutes = silentProgressMinutes(progress, nowMs);
	if (silentMinutes !== undefined)
		return {
			text: `  ${laneSilentWarningText(silentMinutes, language)}`,
			tone: "warning",
		};
	if (progress.currentTool && progress.currentToolStartMs !== null) {
		const args = progress.currentToolArgs ? ` ${progress.currentToolArgs}` : "";
		const elapsed = formatElapsed(nowMs - progress.currentToolStartMs);
		return {
			text: `  ${activitySpinnerLine(`${progress.currentTool}${args} · ${elapsed}`)}`,
			tone: "toolOutput",
		};
	}
	return {
		text: `  ${activitySpinnerLine(laneThinkingText(language))}`,
		tone: "toolOutput",
	};
}

function recentToolLine(tool: AgentProgress["recentTools"][number]) {
	const args = tool.args ? ` ${tool.args}` : "";
	const mark = tool.isError ? "✗" : "✓";
	return `${mark} ${tool.tool}${args} · ${formatElapsed(tool.endMs - tool.startMs)}`;
}

export function statusLabel(
	status: LaneDisplayStatus,
	language: FlowState["language"],
) {
	if (language === "en") return englishStatusLabel(status);
	if (status === "starting") return "启动中";
	if (status === "running") return "执行中";
	if (status === "accepting") return "验收中";
	if (status === "completing") return "补完中";
	if (status === "checking") return "质检中";
	if (status === "optimizing") return "优化中";
	if (status === "settling") return "等待收口";
	if (status === "complete") return "已完成";
	if (status === "paused") return "已暂停";
	return "已中断";
}

export function statusTone(status: LaneDisplayStatus) {
	if (status === "complete") return "success";
	if (status === "interrupted") return "error";
	if (status === "paused") return "warning";
	return "accent";
}

export function formatElapsed(milliseconds: number) {
	const seconds = Math.max(0, Math.floor(milliseconds / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

function laneStatus(
	goal: FlowGoal | undefined,
	artifact: FlowWorkerArtifact | undefined,
	checks: GoalChecks | undefined,
	exit: LaneExit | undefined,
): LaneDisplayStatus {
	if (artifact?.completion || goal?.status === "complete") return "complete";
	if (artifact?.status === "paused" || goal?.status === "paused")
		return "paused";
	if (artifact?.status === "failed" || exitFailed(exit)) return "interrupted";
	if (phaseActive(checks?.acceptance)) return "accepting";
	if (phaseFailed(checks?.acceptance)) return "completing";
	if (phaseActive(checks?.quality)) return "checking";
	if (phaseFailed(checks?.quality)) return "optimizing";
	if (
		phasePassed(checks?.acceptance) &&
		checks?.quality.enabled &&
		!phaseDone(checks.quality)
	)
		return "checking";
	if (
		phasePassed(checks?.acceptance) &&
		(!checks?.quality.enabled || phaseDone(checks.quality))
	)
		return "settling";
	if (artifact || goal?.status === "running") return "running";
	return "starting";
}

function artifactActivities(
	artifact: FlowWorkerArtifact | undefined,
	events: unknown[],
	language: FlowState["language"],
	exit: LaneExit | undefined,
) {
	const activities = [
		...events.flatMap(workerErrorActivities),
		...(artifact?.completion
			? [completionActivity(artifact.completion.summary, language)]
			: []),
		...exitActivities(exit, language),
	];
	return [...new Set(activities)];
}

function workerErrorActivities(event: unknown) {
	const record = eventRecord(event);
	if (record?.type === "process_error")
		return [textValue(record.error, "进程错误")];
	if (record?.type === "json_parse_error") return ["事件解析失败"];
	return [];
}

function eventRecord(event: unknown) {
	return typeof event === "object" && event !== null
		? (event as Record<string, unknown>)
		: undefined;
}

function textValue(value: unknown, fallback: string) {
	return typeof value === "string" && value.trim()
		? clip(value.trim(), 100)
		: fallback;
}

function exitSuccessSummary(language: FlowState["language"]) {
	return language === "en" ? "worker exited" : "后台会话退出";
}

function exitFailureSummary(exit: LaneExit, language: FlowState["language"]) {
	if (exit.code !== null)
		return language === "en" ? `exit code ${exit.code}` : `退出码 ${exit.code}`;
	if (exit.signal)
		return language === "en" ? `signal ${exit.signal}` : `信号 ${exit.signal}`;
	return language === "en" ? "exit unknown" : "退出状态未知";
}

function completionActivity(summary: string, language: FlowState["language"]) {
	return language === "en"
		? `completion: ${clip(summary, 100)}`
		: `完成：${clip(summary, 100)}`;
}

function checkSlot(
	label: string,
	phase: CheckPhase,
	language: FlowState["language"],
): CheckSlot | undefined {
	if (!phase.enabled || (!phase.active && phase.rounds.length === 0))
		return undefined;
	const status = phaseStatus(phase);
	const last = phase.rounds.at(-1);
	return {
		label,
		mark: statusMark(status),
		text: checkLabel(status, language),
		tone: checkTone(status),
		summary: clip(last?.summary ?? activeSummary(phase), 90),
	};
}

function phaseStatus(phase: CheckPhase): LaneChecksStatus {
	if (phase.active?.models.some((item) => item.outcome === null))
		return "running";
	if (phase.active?.models.some((item) => item.outcome?.result === "failed"))
		return "failed";
	if (phase.active?.models.some((item) => item.outcome?.result === "error"))
		return "error";
	if (phase.active) return "running";
	const last = phase.rounds.at(-1);
	if (!last) return "waiting";
	if (last.result === "passed") return "passed";
	if (last.result === "failed") return "failed";
	return "error";
}

function activeSummary(phase: CheckPhase) {
	return (
		phase.active?.models
			.flatMap((item) => item.outcome?.summary ?? [])
			.join("；") ?? ""
	);
}

function phaseActive(phase: CheckPhase | undefined) {
	return phase?.active !== null && phase?.active !== undefined;
}

function phaseFailed(phase: CheckPhase | undefined) {
	const status = phaseStatusOrWaiting(phase);
	return status === "failed" || status === "error";
}

function phasePassed(phase: CheckPhase | undefined) {
	return phaseStatusOrWaiting(phase) === "passed";
}

function phaseDone(phase: CheckPhase | undefined) {
	const status = phaseStatusOrWaiting(phase);
	return status === "passed" || status === "failed" || status === "error";
}

function phaseStatusOrWaiting(phase: CheckPhase | undefined) {
	return phase ? phaseStatus(phase) : "waiting";
}

function englishStatusLabel(status: LaneDisplayStatus) {
	if (status === "starting") return "Starting";
	if (status === "running") return "Running";
	if (status === "accepting") return "Accepting";
	if (status === "completing") return "Completing";
	if (status === "checking") return "Quality check";
	if (status === "optimizing") return "Optimizing";
	if (status === "settling") return "Waiting to settle";
	if (status === "complete") return "Complete";
	if (status === "paused") return "Paused";
	return "Interrupted";
}

function checkLabel(status: LaneChecksStatus, language: FlowState["language"]) {
	if (language === "en") {
		if (status === "passed") return "Passed";
		if (status === "failed") return "Failed";
		if (status === "error") return "Error";
		if (status === "running") return "Running";
		return "Waiting";
	}
	if (status === "passed") return "通过";
	if (status === "failed") return "失败";
	if (status === "error") return "错误";
	if (status === "running") return "进行中";
	return "等待";
}

function statusMark(status: LaneChecksStatus) {
	if (status === "passed") return "✓";
	if (status === "failed") return "✗";
	if (status === "error") return "!";
	if (status === "running") return "…";
	return "-";
}

function checkTone(status: LaneChecksStatus) {
	if (status === "passed") return "success";
	if (status === "failed") return "error";
	if (status === "error") return "warning";
	if (status === "running") return "accent";
	return "muted";
}

function exitFailed(exit: LaneExit | undefined) {
	return Boolean(exit && (exit.code !== 0 || exit.signal));
}
