import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionCommandContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	Spacer,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { CheckPhase, GoalChecks } from "../../goal/types.js";
import type { FlowState } from "../types.js";

export type LaneStatus = "running" | "complete" | "failed";
export type LaneChecksStatus =
	| "waiting"
	| "running"
	| "passed"
	| "failed"
	| "error";

export interface LaneState {
	goalIndex: number;
	title: string;
	status: LaneStatus;
	lastToolCall?: readonly string[];
	checksStatus?: LaneChecksStatus;
	elapsed?: number;
}

export interface ParallelLaneBoard {
	updateWorkerEvent(goalIndex: number, event: unknown): void;
	updateWorkerExit(
		goalIndex: number,
		exitCode: number | null,
		exitSignal: NodeJS.Signals | null,
	): void;
	dispose(): void;
}

const LANE_WIDGET_KEY = "flow-parallel-lanes";

export function showParallelLaneBoard(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
): ParallelLaneBoard {
	const startedAt = Date.now();
	const lanes = batchIndices.map<LaneState>((goalIndex) => ({
		goalIndex,
		title: flow.goals[goalIndex]?.title ?? `G${goalIndex + 1}`,
		status: "running",
		lastToolCall: [],
		checksStatus: "waiting",
		elapsed: 0,
	}));
	const laneByIndex = new Map(lanes.map((lane) => [lane.goalIndex, lane]));
	const mount = () => {
		ctx.ui.setWidget(
			LANE_WIDGET_KEY,
			(tui, theme) =>
				new ParallelLaneWidget(lanes, theme, () => tui.requestRender(true)),
			{ placement: "aboveEditor" },
		);
	};
	const refresh = () => {
		const elapsed = Date.now() - startedAt;
		for (const lane of lanes) lane.elapsed = elapsed;
		mount();
	};

	ctx.ui.setWorkingVisible(false);
	mount();

	return {
		updateWorkerEvent(goalIndex, event) {
			const lane = laneByIndex.get(goalIndex);
			const record = eventRecord(event);
			if (!lane || !record) return;
			if (record.type === "tool_execution_end") {
				lane.lastToolCall = [
					...(lane.lastToolCall ?? []),
					toolCallLabel(record),
				].slice(-2);
				refresh();
				return;
			}
			if (record.type === "message_end") {
				lane.checksStatus =
					readWorkerChecksStatus(dir, goalIndex) ?? lane.checksStatus;
				refresh();
				return;
			}
			if (record.type === "agent_end") {
				lane.checksStatus = readWorkerChecksStatus(dir, goalIndex) ?? "passed";
				lane.status = isFailedCheck(lane.checksStatus) ? "failed" : "complete";
				refresh();
				return;
			}
			if (record.type === "process_error") {
				lane.status = "failed";
				lane.checksStatus = "error";
				refresh();
			}
		},
		updateWorkerExit(goalIndex, exitCode) {
			const lane = laneByIndex.get(goalIndex);
			if (!lane) return;
			lane.checksStatus =
				readWorkerChecksStatus(dir, goalIndex) ?? lane.checksStatus;
			if (exitCode === 0 && !isFailedCheck(lane.checksStatus)) {
				lane.status = "complete";
				if (lane.checksStatus === "waiting" || lane.checksStatus === "running")
					lane.checksStatus = "passed";
			} else {
				lane.status = "failed";
				if (!isFailedCheck(lane.checksStatus)) lane.checksStatus = "error";
			}
			refresh();
		},
		dispose() {
			ctx.ui.setWidget(LANE_WIDGET_KEY, undefined);
			ctx.ui.setWorkingVisible(true);
		},
	};
}

export class ParallelLaneWidget implements Component {
	constructor(
		private readonly lanes: readonly LaneState[],
		private readonly theme: Theme,
		private readonly requestRender?: () => void,
	) {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const container = new Container();
		container.addChild(
			new Text(
				fitLine(
					this.theme.fg("toolTitle", this.theme.bold("Flow 并行看板")) +
						this.theme.fg("muted", ` · ${this.lanes.length} lanes`),
					safeWidth,
				),
				0,
				0,
			),
		);
		if (this.lanes.length > 0) container.addChild(new Spacer(1));
		for (const lane of this.lanes) {
			container.addChild(
				new Text(fitLine(this.laneLine(lane), safeWidth), 0, 0),
			);
		}
		return container.render(safeWidth);
	}

	invalidate(): void {
		this.requestRender?.();
	}

	private laneLine(lane: LaneState) {
		const icon = statusIcon(lane.status, this.theme);
		const goal = this.theme.fg("accent", `G${lane.goalIndex + 1}`);
		const title = this.theme.fg("toolTitle", lane.title);
		const elapsed = this.theme.fg("dim", formatElapsed(lane.elapsed ?? 0));
		const tools = formatTools(lane.lastToolCall, this.theme);
		const checks = formatChecks(lane.checksStatus ?? "waiting", this.theme);
		return `${icon} ${goal} ${title} ${this.theme.fg("muted", "·")} ${elapsed} ${this.theme.fg("muted", "·")} ${tools} ${this.theme.fg("muted", "·")} ${checks}`;
	}
}

function eventRecord(event: unknown) {
	return typeof event === "object" && event !== null
		? (event as Record<string, unknown>)
		: undefined;
}

function toolCallLabel(event: Record<string, unknown>) {
	const name = typeof event.toolName === "string" ? event.toolName : "tool";
	return event.isError === true ? `${name} ✗` : name;
}

function readWorkerChecksStatus(dir: string, goalIndex: number) {
	try {
		const artifact = JSON.parse(
			readFileSync(join(dir, "workers", `G${goalIndex}`, "goal.json"), "utf8"),
		) as { checks?: GoalChecks };
		return checksStatus(artifact.checks);
	} catch {
		return undefined;
	}
}

function checksStatus(checks: GoalChecks | undefined): LaneChecksStatus {
	return phaseStatus(checks?.acceptance);
}

function phaseStatus(phase: CheckPhase | undefined): LaneChecksStatus {
	if (!phase?.enabled) return "waiting";
	if (phase.active?.some((item) => item.status === "running")) return "running";
	if (phase.active?.some((item) => item.status === "failed")) return "failed";
	if (phase.active?.some((item) => item.status === "error")) return "error";
	const last = phase.rounds.at(-1);
	if (!last) return "waiting";
	if (last.result === "passed") return "passed";
	if (last.result === "failed") return "failed";
	return "error";
}

function isFailedCheck(status: LaneChecksStatus | undefined) {
	return status === "failed" || status === "error";
}

function statusIcon(status: LaneStatus, theme: Theme) {
	if (status === "complete") return theme.fg("success", "✓");
	if (status === "failed") return theme.fg("error", "✗");
	return theme.fg("warning", "⏳");
}

function formatTools(tools: readonly string[] | undefined, theme: Theme) {
	const recent = (tools ?? []).slice(-2);
	if (recent.length === 0) return theme.fg("muted", "tool: —");
	return `${theme.fg("muted", "tool: ")}${theme.fg("toolOutput", recent.join(" → "))}`;
}

function formatChecks(status: LaneChecksStatus, theme: Theme) {
	const label = checkLabel(status);
	const color = checkColor(status);
	return `${theme.fg("muted", "验收: ")}${theme.fg(color, label)}`;
}

function checkLabel(status: LaneChecksStatus) {
	if (status === "passed") return "通过";
	if (status === "failed") return "失败";
	if (status === "error") return "错误";
	if (status === "running") return "进行中";
	return "等待";
}

function checkColor(status: LaneChecksStatus) {
	if (status === "passed") return "success";
	if (status === "failed") return "error";
	if (status === "error") return "warning";
	if (status === "running") return "accent";
	return "muted";
}

function formatElapsed(milliseconds: number) {
	const seconds = Math.max(0, Math.floor(milliseconds / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

function fitLine(line: string, width: number) {
	return truncateToWidth(line, width, "…");
}
