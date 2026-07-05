import {
	CustomEditor,
	type ExtensionContext,
	type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type EditorTheme,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import type { Language } from "./config.js";
import { runtimeLanguage } from "./language.js";
import { localizeUserTextForLanguage } from "./ui-language.js";

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
	language?: Language;
}

type Rgb = readonly [number, number, number];

const GOAL_WIDGET_KEY = "goal-progress";
const REVIEW_WIDGET_KEY = "review-progress";
const GOAL_COLORS: readonly Rgb[] = [
	[125, 92, 255],
	[0, 194, 255],
];
const REVIEW_COLORS: readonly Rgb[] = [
	[255, 153, 102],
	[255, 91, 137],
];
const flowActivityGlobal = globalThis as typeof globalThis & {
	__PI_FLOW_ACTIVITY__?: { active: boolean };
};
const activityReasons = new Map<FlowActivity, Set<string>>();
let installed = false;
let activeTui: TUI | undefined;
let editorInputHidden = false;
let activeCancel: (() => void) | undefined;
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
			new FlowActivityEditor(tui, theme, keybindings),
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

export function setFlowCancelHandler(handler: (() => void) | undefined) {
	activeCancel = handler;
}

export function cancelActiveFlowActivity() {
	activeCancel?.();
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

	constructor(
		private readonly options: {
			activity: FlowActivity;
			message?: string;
			title?: string;
			rows?: string[];
			hint?: string;
			compact?: boolean;
		},
	) {
		this.signal = this.controller.signal;
	}

	set onAbort(_fn: (() => void) | undefined) {}

	render(width: number): string[] {
		const palette = paletteFor(this.options.activity);
		const border = colorText("─".repeat(Math.max(1, width)), palette);
		const blank = " ".repeat(Math.max(0, width));
		const compact = this.options.compact === true;
		const lines = [border];
		if (!compact) lines.push(blank);
		const title = this.options.title;
		if (title) {
			lines.push(centerLine(boldText(title), width));
			const rows = this.options.rows ?? [];
			if (rows.length > 0) lines.push(blank);
			for (const row of rows) {
				for (const line of row.split(/\r?\n/u))
					lines.push(centerLine(line, width));
			}
		} else {
			for (const line of (this.options.message ?? "").split(/\r?\n/)) {
				lines.push(centerLine(line, width));
			}
		}
		if (this.options.hint) {
			lines.push(blank, centerLine(this.options.hint, width));
		}
		if (!compact) lines.push(blank);
		lines.push(border);
		return lines;
	}

	handleInput(_data: string): void {}

	invalidate(): void {}
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
			? (_tui, theme) =>
					new ActivityBox({
						activity,
						message: widget.message
							? theme.fg(color, widget.message)
							: undefined,
						title: widget.title ? theme.fg(color, widget.title) : undefined,
						rows: widget.rows?.map((row) => theme.fg(color, row)),
						hint: widget.hint,
						compact: widget.compact,
					})
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

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings);
		this.appKeybindings = keybindings;
		activeTui = tui;
		cancelHint = formatCancelKeys(keybindings);
		syncActivityState();
	}

	handleInput(data: string): void {
		if (editorInputHidden) {
			if (matchesCancel(data, this.appKeybindings)) cancelActiveFlowActivity();
			return;
		}
		super.handleInput(data);
	}

	render(width: number): string[] {
		if (editorInputHidden) return [];
		return super.render(width);
	}
}

function matchesCancel(data: string, keybindings: KeybindingsManager) {
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
	const text = truncateToWidth(line, width, "");
	const padding = Math.max(0, width - visibleWidth(text));
	const left = Math.floor(padding / 2);
	return `${" ".repeat(left)}${text}${" ".repeat(padding - left)}`;
}

function syncActivityState() {
	flowActivityGlobal.__PI_FLOW_ACTIVITY__ = { active: activityCount() > 0 };
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
