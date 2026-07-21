import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { renderActivitySpinners } from "../../shared/activity-spinner.js";
import {
	type AgentProgressReference,
	onProgressChanged,
} from "../../shared/agent-progress.js";
import { currentSessionFile } from "../../shared/session.js";
import { truncateToWidth, visibleWidth } from "../../shared/tui.js";
import type { FlowState } from "../types.js";
import { parallelConsoleCommandHint } from "./console.js";
import {
	type CheckSlot,
	checkSlots,
	formatElapsed,
	type LaneDisplayStatus,
	type LaneState,
	laneActivityLines,
	progressMetrics,
	readLane,
	statusLabel,
	statusTone,
} from "./lane-model.js";

export type {
	LaneChecksStatus,
	LaneDisplayStatus,
	LaneState,
} from "./lane-model.js";

export interface ParallelLaneBoard {
	updateWorkerEvent(goalIndex: number): void;
	updateWorkerExit(
		goalIndex: number,
		exitCode: number | null,
		exitSignal: NodeJS.Signals | null,
		stderr?: string | null,
	): void;
	dispose(): void;
}

interface ParallelLaneContext {
	cwd: string;
	sessionManager?: unknown;
	ui: ExtensionContext["ui"];
}

export interface ParallelLaneProgress {
	scopeId: string;
	agents: ReadonlyMap<number, AgentProgressReference>;
}

const LANE_WIDGET_KEY = "flow-parallel-lanes";
const activeBoards = new Map<string, ParallelLaneBoard>();

export function activeParallelLaneBoardCount() {
	return activeBoards.size;
}

export function showParallelLaneBoard(
	ctx: ParallelLaneContext,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
	progress?: ParallelLaneProgress,
): ParallelLaneBoard {
	const key = boardKey(ctx, dir);
	activeBoards.get(key)?.dispose();
	const startedAt = flow.parallelRun?.startedAt ?? Date.now();
	const lanes = batchIndices.map((goalIndex) =>
		readLane(
			dir,
			flow,
			goalIndex,
			undefined,
			progress?.agents.get(goalIndex)?.current,
		),
	);
	const laneByIndex = new Map(lanes.map((lane) => [lane.goalIndex, lane]));
	let disposed = false;
	let widget: ParallelLaneWidget | undefined;
	const requestRender = () => widget?.invalidate();
	const refreshLane = (goalIndex: number, exit?: LaneState["exit"]) => {
		const lane = laneByIndex.get(goalIndex);
		if (!lane) return;
		Object.assign(
			lane,
			readLane(
				dir,
				flow,
				goalIndex,
				exit ?? lane.exit,
				progress?.agents.get(goalIndex)?.current,
			),
		);
		requestRender();
	};
	ctx.ui.setWidget(
		LANE_WIDGET_KEY,
		(tui, theme) => {
			widget = new ParallelLaneWidget(
				{
					flow,
					lanes,
					startedAt,
					getTerminalRows: () => tui.terminal?.rows,
				},
				theme,
				() => tui.requestRender(true),
			);
			return widget;
		},
		{ placement: "aboveEditor" },
	);
	ctx.ui.setWorkingVisible(false);
	const unsubscribeProgress = progress
		? onProgressChanged((snapshot) => {
				if (!snapshot.scopes.some((scope) => scope.id === progress.scopeId))
					return;
				for (const lane of lanes)
					lane.progress = progress.agents.get(lane.goalIndex)?.current;
				requestRender();
			})
		: () => undefined;
	const timer = setInterval(requestRender, 1000);
	timer.unref?.();

	const board: ParallelLaneBoard = {
		updateWorkerEvent(goalIndex) {
			refreshLane(goalIndex);
		},
		updateWorkerExit(goalIndex, exitCode, exitSignal, stderr = null) {
			refreshLane(goalIndex, {
				code: exitCode,
				signal: exitSignal,
				stderr,
			});
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			unsubscribeProgress();
			clearInterval(timer);
			widget = undefined;
			if (activeBoards.get(key) === board) activeBoards.delete(key);
			ctx.ui.setWidget(LANE_WIDGET_KEY, undefined);
			ctx.ui.setWorkingVisible(true);
		},
	};
	activeBoards.set(key, board);
	return board;
}

export function closeParallelLaneBoard(ctx: ParallelLaneContext, dir?: string) {
	activeBoards.get(boardKey(ctx, dir ?? ctx.cwd))?.dispose();
}

export class ParallelLaneWidget implements Component {
	constructor(
		private readonly input: {
			flow: FlowState;
			lanes: readonly LaneState[];
			startedAt: number;
			getTerminalRows: () => number | undefined;
		},
		private readonly theme: Theme,
		private readonly requestRender?: () => void,
	) {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const laneRows = rowsPerLane(
			this.input.getTerminalRows(),
			this.input.lanes.length,
		);
		const lines = [
			this.fit(
				`${this.theme.fg("toolTitle", this.input.flow.parallelRun?.consoleSessionName ?? "Flow 并行控制台")} ${this.theme.fg("muted", "·")} ${this.theme.fg("dim", `⏱ ${formatElapsed(Date.now() - this.input.startedAt)}`)}`,
				safeWidth,
			),
		];
		for (const lane of this.input.lanes)
			lines.push(...this.renderLane(lane, laneRows, safeWidth));
		lines.push(
			this.fit(
				this.theme.fg("muted", parallelConsoleCommandHint(this.input.flow)),
				safeWidth,
			),
		);
		return lines;
	}

	invalidate(): void {
		this.requestRender?.();
	}

	private renderLane(lane: LaneState, laneRows: number, width: number) {
		if (laneRows === 1) return [this.compactLaneLine(lane, width)];
		const slots = checkSlots(lane.checks, this.input.flow.language);
		const activityRows = Math.max(0, laneRows - 1 - slots.length);
		return [
			this.laneHeader(lane, width),
			...laneActivityLines(
				lane,
				activityRows,
				this.input.flow.language,
				Date.now(),
			).map((line) =>
				this.fit(
					this.theme.fg(line.tone, renderActivitySpinners(line.text)),
					width,
				),
			),
			...slots.map((slot) => this.fit(this.checkLine(slot), width)),
		];
	}

	private compactLaneLine(lane: LaneState, width: number) {
		const slots = checkSlots(lane.checks, this.input.flow.language)
			.map((slot) => `${slot.label}${slot.mark}`)
			.join(" ");
		const activity = laneActivityLines(
			lane,
			1,
			this.input.flow.language,
			Date.now(),
		)[0];
		const activityText = activity
			? this.theme.fg(
					activity.tone,
					renderActivitySpinners(activity.text.trim()),
				)
			: "";
		const identity = `${statusIcon(lane.status, this.theme)} ${this.goalLabel(lane)}`;
		const secondary = `${this.theme.fg("toolTitle", lane.title)} ${this.theme.fg("muted", "·")} ${this.statusText(lane.status)}${slots ? ` ${this.theme.fg("muted", "·")} ${slots}` : ""}`;
		const leftWidth = this.leftWidthForMetrics(lane, width);
		const activityWidth = Math.max(1, leftWidth - visibleWidth(identity) - 1);
		const fittedActivity = this.fit(activityText, activityWidth);
		const secondaryWidth =
			leftWidth - visibleWidth(identity) - visibleWidth(fittedActivity) - 4;
		const left =
			secondaryWidth >= 4
				? `${identity} ${this.fit(secondary, secondaryWidth)} ${this.theme.fg("muted", "·")} ${fittedActivity}`
				: `${identity} ${fittedActivity}`;
		return this.alignMetrics(left, lane, width);
	}

	private laneHeader(lane: LaneState, width: number) {
		const left = `${statusIcon(lane.status, this.theme)} ${this.goalLabel(lane)} ${this.theme.fg("toolTitle", lane.title)} ${this.theme.fg("muted", "·")} ${this.statusText(lane.status)}`;
		return this.alignMetrics(left, lane, width);
	}

	private checkLine(slot: CheckSlot) {
		const summary = slot.summary
			? ` ${this.theme.fg("muted", "·")} ${slot.summary}`
			: "";
		return `  ${this.theme.fg("muted", `${slot.label}：`)}${this.theme.fg(slot.tone, `${slot.mark} ${slot.text}`)}${summary}`;
	}

	private statusText(status: LaneDisplayStatus) {
		return this.theme.fg(
			statusTone(status),
			statusLabel(status, this.input.flow.language),
		);
	}

	private goalLabel(lane: LaneState) {
		return this.theme.fg("accent", `G${lane.goalIndex + 1}`);
	}

	private leftWidthForMetrics(lane: LaneState, width: number) {
		const metrics = progressMetrics(lane.progress);
		return metrics
			? Math.max(1, width - visibleWidth(this.theme.fg("dim", metrics)) - 1)
			: width;
	}

	private alignMetrics(left: string, lane: LaneState, width: number) {
		const metrics = progressMetrics(lane.progress);
		if (!metrics) return this.fit(left, width);
		const right = this.theme.fg("dim", metrics);
		const rightWidth = visibleWidth(right);
		if (rightWidth >= width) return this.fit(right, width);
		const clippedLeft = this.fit(left, width - rightWidth - 1);
		const gap = Math.max(1, width - visibleWidth(clippedLeft) - rightWidth);
		return `${clippedLeft}${" ".repeat(gap)}${right}`;
	}

	private fit(line: string, width: number) {
		return truncateToWidth(line, width, "…");
	}
}

function statusIcon(status: LaneDisplayStatus, theme: Theme) {
	if (status === "complete") return theme.fg("success", "✓");
	if (status === "interrupted") return theme.fg("error", "✗");
	if (status === "paused") return theme.fg("warning", "Ⅱ");
	return theme.fg("accent", "●");
}

function rowsPerLane(terminalRows: number | undefined, laneCount: number) {
	if (!terminalRows || laneCount <= 0) return 5;
	const available = Math.max(0, terminalRows - 3);
	if (available >= laneCount * 5) return 5;
	if (available >= laneCount * 3) return 3;
	return 1;
}

function boardKey(ctx: ParallelLaneContext, fallback: string) {
	return currentSessionFile(ctx) ?? fallback;
}
