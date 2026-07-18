import type {
	ExtensionContext,
	KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { setPiActivity } from "./activity-signal.js";
import {
	ACTIVITY_SPINNER_INTERVAL_MS,
	hasActivitySpinner,
	renderActivitySpinners,
} from "./activity-spinner.js";
import type { Language } from "./config.js";
import {
	FLAME_FRAME_COUNT,
	flameFrameLines,
	flameFrameWidth,
} from "./flame-frames.js";
import { runtimeLanguage } from "./language.js";
import { openActiveMonitorOverlay } from "./monitor-overlay.js";
import {
	CustomEditor,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "./tui.js";
import {
	localizeUserTextForLanguage,
	MONITOR_SHORTCUT,
} from "./ui-language.js";

export {
	ACTIVITY_SPINNER_FRAMES,
	activitySpinnerLine,
} from "./activity-spinner.js";

export type FlowActivity = "goal" | "review";

interface GoalActivityContext {
	ui: { setWidget?: unknown; setWorkingVisible?: unknown };
}

export interface ActivityWidgetMessage {
	message?: string;
	title?: string;
	rows?: string[];
	hint?: string;
	compact?: boolean;
	flame?: boolean;
	language?: Language;
}

type Rgb = readonly [number, number, number];

const GOAL_WIDGET_KEY = "goal-progress";
const REVIEW_WIDGET_KEY = "review-progress";
const FLAME_MARGIN_MIN = 6;
const FLAME_GAP_MIN = 8;
const FLAME_GAP_IDEAL = 16;
const GOAL_COLORS: readonly Rgb[] = [
	[125, 92, 255],
	[0, 194, 255],
];
const REVIEW_COLORS: readonly Rgb[] = [
	[255, 153, 102],
	[255, 91, 137],
];
// 外部消费者（终端集成等）通过 activity-signal 订阅 flow/review 编排是否进行中；
// 本模块是该来源的唯一写入者。
const FRAME_ACTIVITY_SOURCE = "pi-flow:frame";
const activityReasons = new Map<FlowActivity, Set<string>>();
let installed = false;
let activeTui: TUI | undefined;
let editorInputHidden = false;
let activeCancel: (() => void) | undefined;
let captureCancelWhenInputVisible = false;
let cancelHint = "Esc/Ctrl+C";

export function installFlowActivityFrame(ctx: ExtensionContext) {
	if (
		!ctx.hasUI ||
		installed ||
		typeof ctx.ui.setEditorComponent !== "function"
	)
		return;
	installed = true;
	ctx.ui.setEditorComponent(
		(tui, theme, keybindings) =>
			new FlowActivityEditor(tui, theme, keybindings, () => {
				void openActiveMonitorOverlay(ctx);
			}),
	);
}

export function setFlowActivity(
	activity: FlowActivity,
	active: boolean,
	reason = "default",
) {
	const before = activityCount();
	const reasons = activityReasons.get(activity) ?? new Set<string>();
	if (active) reasons.add(reason);
	else reasons.delete(reason);
	if (reasons.size) activityReasons.set(activity, reasons);
	else activityReasons.delete(activity);
	if (activityCount() !== before) {
		syncActivityState();
		activeTui?.requestRender();
	}
}

export function clearFlowActivities() {
	activityReasons.clear();
	syncActivityState();
	editorInputHidden = false;
	activeCancel = undefined;
	captureCancelWhenInputVisible = false;
	activeTui = undefined;
	installed = false;
}

export function setFlowEditorInputHidden(hidden: boolean) {
	if (editorInputHidden === hidden) return;
	editorInputHidden = hidden;
	activeTui?.requestRender();
}

export function isFlowEditorInputHidden() {
	return editorInputHidden;
}

export function setFlowCancelHandler(
	handler: (() => void) | undefined,
	options: { captureWhenInputVisible?: boolean } = {},
) {
	activeCancel = handler;
	captureCancelWhenInputVisible =
		handler !== undefined && options.captureWhenInputVisible === true;
}

export function cancelActiveFlowActivity() {
	activeCancel?.();
}

export function handleFlowActivityInput(
	data: string,
	keybindings: Pick<KeybindingsManager, "matches">,
) {
	if (
		(!editorInputHidden && !captureCancelWhenInputVisible) ||
		!matchesCancel(data, keybindings)
	)
		return false;
	cancelActiveFlowActivity();
	return true;
}

export function currentCancelHint() {
	return cancelHint;
}

export function activityRows(
	...sections: Array<string | readonly string[] | undefined>
) {
	const rows: string[] = [];
	for (const section of sections) {
		if (section === undefined || section === "") continue;
		const lines = typeof section === "string" ? [section] : section;
		if (lines.length === 0) continue;
		if (rows.length > 0) rows.push("");
		rows.push(...lines);
	}
	return rows;
}

export function notifyCentered(
	ctx: ExtensionContext,
	message: string,
	level: "info" | "warning" | "error" = "info",
) {
	const width = Math.max(0, (activeTui?.terminal.columns ?? 0) - 2);
	const offset = Math.max(0, Math.floor((width - visibleWidth(message)) / 2));
	ctx.ui.notify(`${" ".repeat(offset)}${message}`, level);
}

export function requestImmediateFlowRender() {
	activeTui?.requestRender(true);
}

export function setGoalActivityBox(
	ctx: GoalActivityContext,
	message: string | ActivityWidgetMessage | undefined,
) {
	setActivityWidget(ctx, GOAL_WIDGET_KEY, "goal", message, "accent");
}

export function setReviewActivityBox(
	ctx: GoalActivityContext,
	message: string | ActivityWidgetMessage | undefined,
) {
	setActivityWidget(ctx, REVIEW_WIDGET_KEY, "review", message, "muted");
}

export class ActivityBox implements Component {
	readonly signal: AbortSignal;
	private readonly controller = new AbortController();
	private readonly spinnerTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly options: {
			activity: FlowActivity;
			message?: string;
			title?: string;
			rows?: string[];
			hint?: string;
			compact?: boolean;
			flame?: boolean;
			requestRender?: () => void;
		},
	) {
		this.signal = this.controller.signal;
		if (
			!options.requestRender ||
			(!options.flame && !hasActivitySpinner(options))
		)
			return;
		this.spinnerTimer = setInterval(
			() => this.invalidate(),
			ACTIVITY_SPINNER_INTERVAL_MS,
		);
		this.spinnerTimer.unref?.();
	}

	set onAbort(_fn: (() => void) | undefined) {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const palette = paletteFor(this.options.activity);
		const border = colorText("─".repeat(safeWidth), palette);
		const contentRows = this.contentRows();
		const body = this.shouldRenderFlame(safeWidth)
			? this.renderFlameBody(contentRows, safeWidth)
			: contentRows.map((line) => centerLine(line, safeWidth));
		return [border, ...body, border];
	}

	private contentRows() {
		const rows: string[] = [];
		const compact = this.options.compact === true;
		if (!compact) rows.push("");
		const title = this.options.title;
		if (title) {
			rows.push(boldText(renderActivitySpinners(title)));
			const contentRows = this.options.rows ?? [];
			if (contentRows.length > 0) rows.push("");
			for (const row of contentRows)
				for (const line of row.split(/\r?\n/u))
					rows.push(renderActivitySpinners(line));
		} else {
			for (const line of (this.options.message ?? "").split(/\r?\n/u))
				rows.push(renderActivitySpinners(line));
		}
		if (this.options.hint) {
			rows.push("", renderActivitySpinners(this.options.hint));
		}
		if (!compact) rows.push("");
		return rows;
	}

	private shouldRenderFlame(width: number) {
		return this.options.flame === true && width >= 60;
	}

	private renderFlameBody(contentRows: string[], width: number) {
		const flameHeight = Math.max(4, contentRows.length);
		const rawFlame = flameFrameLines(flameHeight, currentFlameFrameIndex());
		const flameWidth = flameFrameWidth(flameHeight);
		const contentWidth = Math.min(
			Math.max(1, ...contentRows.map((row) => visibleWidth(row))),
			Math.max(1, width - FLAME_MARGIN_MIN * 2 - FLAME_GAP_MIN - flameWidth),
		);
		const gap = Math.max(
			FLAME_GAP_MIN,
			Math.min(
				FLAME_GAP_IDEAL,
				width - FLAME_MARGIN_MIN * 2 - contentWidth - flameWidth,
			),
		);
		const group = contentWidth + gap + flameWidth;
		const leftMargin = Math.max(
			FLAME_MARGIN_MIN,
			Math.floor((width - group) / 2),
		);
		const indent = " ".repeat(leftMargin);
		const paddedRows = [...contentRows];
		while (paddedRows.length < flameHeight) paddedRows.push("");
		return rawFlame.map((line, index) => {
			const row = truncateToWidth(paddedRows[index] ?? "", contentWidth, "…");
			const padding = " ".repeat(
				Math.max(0, contentWidth - visibleWidth(row) + gap),
			);
			const flame = `${truncateToWidth(line, flameWidth, "")}\x1b[0m`;
			return `${indent}${row}${padding}${flame}`;
		});
	}

	handleInput(_data: string): void {}

	invalidate(): void {
		this.options.requestRender?.();
	}

	dispose(): void {
		if (this.spinnerTimer) clearInterval(this.spinnerTimer);
		this.controller.abort();
	}
}

function setActivityWidget(
	ctx: GoalActivityContext,
	key: string,
	activity: FlowActivity,
	message: string | ActivityWidgetMessage | undefined,
	color: "accent" | "muted",
) {
	if (typeof ctx.ui.setWorkingVisible === "function")
		ctx.ui.setWorkingVisible(message === undefined);
	setActivityWidgetContent(ctx, key, activity, message, color);
}

function setActivityWidgetContent(
	ctx: GoalActivityContext,
	key: string,
	activity: FlowActivity,
	message: string | ActivityWidgetMessage | undefined,
	color: "accent" | "muted",
) {
	if (typeof ctx.ui.setWidget !== "function") return;
	const setWidget = ctx.ui.setWidget as (
		key: string,
		content:
			| ((tui: TUI, theme: ExtensionContext["ui"]["theme"]) => Component)
			| undefined,
		options?: { placement?: "aboveEditor" | "belowEditor" },
	) => void;
	const widget = normalizeActivityMessage(message);
	setWidget(
		key,
		widget
			? (tui, theme) => {
					const requestRender =
						typeof tui.requestRender === "function"
							? () => tui.requestRender()
							: undefined;
					return new ActivityBox({
						activity,
						message: widget.message
							? theme.fg(color, widget.message)
							: undefined,
						title: widget.title ? theme.fg(color, widget.title) : undefined,
						rows: widget.rows?.map((row) => theme.fg(color, row)),
						hint: widget.hint,
						compact: widget.compact,
						flame: widget.flame,
						requestRender,
					});
				}
			: undefined,
		{ placement: "aboveEditor" },
	);
}

function normalizeActivityMessage(
	message: string | ActivityWidgetMessage | undefined,
): ActivityWidgetMessage | undefined {
	if (!message) return undefined;
	const widget = typeof message === "string" ? { message } : message;
	const language = widget.language ?? runtimeLanguage();
	return {
		...widget,
		message: localizeUserTextForLanguage(widget.message, language),
		title: localizeUserTextForLanguage(widget.title, language),
		rows: widget.rows?.map(
			(row) => localizeUserTextForLanguage(row, language) ?? row,
		),
		hint: localizeUserTextForLanguage(widget.hint, language),
	};
}

function boldText(text: string) {
	return `\x1b[1m${text}\x1b[22m`;
}

class FlowActivityEditor extends CustomEditor {
	private readonly appKeybindings: KeybindingsManager;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly openMonitor: () => void,
	) {
		super(tui, theme, keybindings);
		this.appKeybindings = keybindings;
		activeTui = tui;
		cancelHint = formatCancelKeys(keybindings);
		syncActivityState();
	}

	handleInput(data: string): void {
		if (matchesKey(data, MONITOR_SHORTCUT.key)) {
			this.openMonitor();
			return;
		}
		if (handleFlowActivityInput(data, this.appKeybindings)) return;
		if (editorInputHidden) return;
		super.handleInput(data);
	}

	render(width: number): string[] {
		if (editorInputHidden) return [];
		return super.render(width);
	}
}

function matchesCancel(
	data: string,
	keybindings: Pick<KeybindingsManager, "matches">,
) {
	return (
		keybindings.matches(data, "app.interrupt") ||
		keybindings.matches(data, "app.clear")
	);
}

function formatCancelKeys(keybindings: KeybindingsManager) {
	const keys = [
		...keybindings.getKeys("app.interrupt"),
		...keybindings.getKeys("app.clear"),
	];
	return [...new Set(keys)].map(formatKey).join("/") || "Esc/Ctrl+C";
}

function formatKey(key: string) {
	return key
		.split("+")
		.map((part) =>
			part === "escape" || part === "esc"
				? "Esc"
				: part === "ctrl"
					? "Ctrl"
					: part === "alt"
						? "Alt"
						: part.length === 1
							? part.toUpperCase()
							: part,
		)
		.join("+");
}

function paletteFor(activity: FlowActivity) {
	return activity === "review" ? REVIEW_COLORS : GOAL_COLORS;
}

function centerLine(line: string, width: number) {
	if (width <= 0) return "";
	const text = truncateToWidth(line, width, "…");
	const padding = Math.max(0, width - visibleWidth(text));
	const left = Math.floor(padding / 2);
	return `${" ".repeat(left)}${text}${" ".repeat(padding - left)}`;
}

function currentFlameFrameIndex() {
	return (
		Math.floor(Date.now() / ACTIVITY_SPINNER_INTERVAL_MS) % FLAME_FRAME_COUNT
	);
}

function syncActivityState() {
	setPiActivity(FRAME_ACTIVITY_SOURCE, activityCount() > 0);
}

function activityCount() {
	let count = 0;
	for (const reasons of activityReasons.values()) count += reasons.size;
	return count;
}

function colorText(text: string, palette: readonly Rgb[]) {
	return ansiRgb(palette[0], text);
}

function ansiRgb([red, green, blue]: Rgb, text: string) {
	return `\x1b[38;2;${red};${green};${blue}m${text}\x1b[39m`;
}
