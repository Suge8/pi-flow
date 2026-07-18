import { homedir } from "node:os";
import type {
	ExtensionContext,
	KeybindingsManager,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle } from "@earendil-works/pi-tui";
import {
	activitySpinnerLine,
	renderActivitySpinners,
} from "./activity-spinner.js";
import {
	type AgentProgressScopeSnapshot,
	type AgentProgressSnapshot,
	activeProgressSnapshot,
	onProgressChanged,
} from "./agent-progress.js";
import type { Language } from "./config.js";
import { runtimeLanguage } from "./language.js";
import {
	formatToolDuration,
	formatToolTokens,
	layoutToolLine,
	paintToolParts,
	type ToolLinePart,
	toolDisplayLabel,
	toolValueParts,
} from "./tool-line.js";
import { truncateToWidth, visibleWidth } from "./tui.js";
import {
	monitorCloseHint,
	monitorNoActiveAgentsText,
	monitorOpenFailedText,
	monitorThinkingText,
} from "./ui-language.js";

type MonitorCloseReason = "escape" | "replaced" | "scope-closed";
type MonitorContext = Pick<ExtensionContext, "cwd" | "mode" | "ui">;

interface AgentRows {
	agent: AgentProgressSnapshot;
	terminal: boolean;
	identity: string;
	current?: string;
	history: string[];
}

interface HeightLayout {
	lines: string[];
	showSeparator: boolean;
}

interface ActiveMonitor {
	scopeId: string;
	close(reason: MonitorCloseReason): void;
	handle?: OverlayHandle;
}

const silencedScopes = new Set<string>();
const silenceCleanups = new Map<string, () => void>();
let activeMonitor: ActiveMonitor | undefined;

export class MonitorOverlayComponent implements Component {
	private scope: AgentProgressScopeSnapshot | undefined;
	private readonly unsubscribe: () => void;
	private readonly timer: ReturnType<typeof setInterval>;
	private closed = false;

	constructor(
		private readonly tui: {
			terminal?: { columns?: number; rows?: number };
			requestRender(force?: boolean): void;
		},
		private readonly theme: Theme,
		private readonly keybindings: Pick<KeybindingsManager, "matches">,
		scopeId: string,
		private readonly language: Language,
		private readonly cwd: string,
		private readonly home: string,
		private readonly done: (reason: MonitorCloseReason) => void,
	) {
		this.scope = findScope(activeProgressSnapshot(), scopeId);
		this.unsubscribe = onProgressChanged((snapshot) => {
			this.scope = findScope(snapshot, scopeId);
			if (!this.scope) this.close("scope-closed");
			else this.tui.requestRender();
		});
		this.timer = setInterval(() => this.tui.requestRender(), 1000);
		this.timer.unref?.();
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const innerWidth = Math.max(1, safeWidth - 2);
		const scope = this.scope;
		if (!scope) return [];
		const compact = (this.tui.terminal?.columns ?? safeWidth) < 70;
		const agentRows = scope.agents.map((agent) =>
			this.agentRows(agent, innerWidth, compact),
		);
		const layout = this.fitHeight(agentRows, innerWidth);
		const lines = [
			this.border("╭", "╮", innerWidth),
			this.row(this.header(scope, innerWidth), innerWidth),
		];
		if (layout.showSeparator) lines.push(this.border("├", "┤", innerWidth));
		lines.push(...layout.lines.map((line) => this.row(line, innerWidth)));
		lines.push(
			this.row(
				center(
					this.theme.fg("dim", monitorCloseHint(this.language)),
					innerWidth,
				),
				innerWidth,
			),
			this.border("╰", "╯", innerWidth),
		);
		return lines;
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "app.interrupt")) this.close("escape");
	}

	invalidate(): void {
		this.tui.requestRender();
	}

	dispose(): void {
		this.unsubscribe();
		clearInterval(this.timer);
	}

	close(reason: MonitorCloseReason) {
		if (this.closed) return;
		this.closed = true;
		this.done(reason);
	}

	private header(scope: AgentProgressScopeSnapshot, width: number) {
		const left = this.theme.fg("toolTitle", scope.label);
		const elapsed = formatMonitorElapsed(Date.now() - scope.startedAt);
		const right = this.theme.fg("dim", `⏱ ${elapsed}`);
		return alignRight(left, right, width);
	}

	private agentRows(
		agent: AgentProgressSnapshot,
		width: number,
		compact: boolean,
	): AgentRows {
		const terminal =
			agent.progress.status === "complete" || agent.progress.status === "error";
		const identity = alignRight(
			this.identity(agent),
			this.theme.fg(
				"dim",
				`${agent.progress.toolCallCount} calls · ${formatToolTokens(agent.progress.tokens)} tok`,
			),
			width,
		);
		const current = terminal ? undefined : this.currentLine(agent, width);
		const history = compact
			? []
			: [...agent.progress.recentTools]
					.reverse()
					.map((tool) =>
						this.toolLine(
							tool.tool,
							tool.args,
							tool.endMs - tool.startMs,
							width,
							"history",
							tool.isError,
						),
					);
		return { agent, terminal, identity, current, history };
	}

	private identity(agent: AgentProgressSnapshot) {
		const { glyph, tone } = this.agentStatus(agent);
		return `${this.theme.fg(tone, glyph)} ${this.theme.fg("accent", agent.agentKey)} ${this.theme.fg("text", agent.label)}`;
	}

	private agentStatus(agent: AgentProgressSnapshot): {
		glyph: string;
		tone: ThemeColor;
	} {
		const status = agent.progress.status;
		if (status === "complete") return { glyph: "✓", tone: "success" };
		if (status === "error") return { glyph: "✗", tone: "error" };
		if (status === "tool") return { glyph: "●", tone: "accent" };
		return { glyph: spinnerGlyph(), tone: "accent" };
	}

	private compactAgentLine(agent: AgentProgressSnapshot, width: number) {
		const progress = agent.progress;
		const { glyph, tone } = this.agentStatus(agent);
		const prefix: ToolLinePart[] = [
			{ text: `${glyph} `, color: tone },
			{ text: `${agent.agentKey} `, color: "accent" },
		];
		let value: ToolLinePart[];
		let clipFrom: "start" | "end" = "end";
		if (progress.currentTool) {
			prefix.push({
				text: `${toolDisplayLabel(progress.currentTool, this.language)} `,
				color: "toolTitle",
			});
			value = toolValueParts(
				progress.currentTool,
				progress.currentToolArgs ?? "",
				this.cwd,
				this.home,
			);
			if (["read", "edit", "write"].includes(progress.currentTool))
				clipFrom = "start";
		} else {
			value = [
				{
					text:
						progress.status === "complete" || progress.status === "error"
							? agent.label
							: monitorThinkingText(this.language),
					color: "text",
				},
			];
		}
		const metrics: ToolLinePart[] = [
			{
				text: `${progress.toolCallCount} calls · ${formatToolTokens(progress.tokens)} tok`,
				color: "dim",
			},
		];
		if (progress.currentToolStartMs !== null) {
			const duration = formatToolDuration(
				Date.now() - progress.currentToolStartMs,
			);
			if (duration) metrics.push({ text: duration, color: "dim" });
		}
		const layout = layoutToolLine(prefix, value, metrics, width, clipFrom);
		const right = layout.metrics
			.map((part) => paintToolParts(this.theme, [part]))
			.join(this.theme.fg("dim", " · "));
		return `${paintToolParts(this.theme, layout.prefix)}${paintToolParts(this.theme, layout.value)}${" ".repeat(layout.padding)}${right}`;
	}

	private currentLine(agent: AgentProgressSnapshot, width: number) {
		const progress = agent.progress;
		if (progress.currentTool && progress.currentToolStartMs !== null)
			return this.toolLine(
				progress.currentTool,
				progress.currentToolArgs ?? "",
				Date.now() - progress.currentToolStartMs,
				width,
				"current",
				false,
			);
		return `${this.theme.fg("dim", "▏")} ${this.theme.fg("accent", spinnerGlyph())} ${this.theme.fg("dim", monitorThinkingText(this.language))}`;
	}

	private toolLine(
		tool: string,
		args: string,
		durationMs: number,
		width: number,
		state: "current" | "history",
		isError: boolean,
	) {
		const tone: ThemeColor = isError
			? "error"
			: state === "history"
				? "dim"
				: "accent";
		const marker = isError ? "✗" : state === "current" ? "●" : " ";
		const label = toolDisplayLabel(tool, this.language);
		const prefix: ToolLinePart[] = [
			{ text: "▏ ", color: "dim" },
			{ text: `${marker} `, color: tone },
			{
				text: `${label} `,
				color: isError ? "error" : state === "current" ? "toolTitle" : "dim",
			},
		];
		let value = toolValueParts(tool, args, this.cwd, this.home);
		if (state === "history" || isError)
			value = value.map((part) => ({ ...part, color: tone }));
		const duration = formatToolDuration(durationMs);
		const metrics = duration
			? [
					{
						text: duration,
						color: isError ? "error" : "dim",
					} satisfies ToolLinePart,
				]
			: [];
		const layout = layoutToolLine(
			prefix,
			value,
			metrics,
			width,
			["read", "edit", "write"].includes(tool) ? "start" : "end",
		);
		const right = layout.metrics
			.map((part) => paintToolParts(this.theme, [part]))
			.join(this.theme.fg("dim", " · "));
		return `${paintToolParts(this.theme, layout.prefix)}${paintToolParts(this.theme, layout.value)}${" ".repeat(layout.padding)}${right}`;
	}

	private fitHeight(agents: AgentRows[], width: number): HeightLayout {
		const fitted = agents.map((agent) => ({
			...agent,
			history: [...agent.history],
		}));
		const terminalRows = this.tui.terminal?.rows;
		if (!terminalRows)
			return { lines: agentContentLines(fitted), showSeparator: true };
		const maxRows = Math.max(1, Math.floor(terminalRows * 0.7));
		if (agentContentLines(fitted).length + 5 <= maxRows)
			return { lines: agentContentLines(fitted), showSeparator: true };
		for (const agent of fitted) if (agent.terminal) agent.history = [];
		while (agentContentLines(fitted).length + 5 > maxRows) {
			const withHistory = fitted.find((agent) => agent.history.length > 0);
			if (!withHistory) break;
			withHistory.history.pop();
		}
		if (agentContentLines(fitted).length + 5 <= maxRows)
			return { lines: agentContentLines(fitted), showSeparator: true };
		for (const agent of fitted) {
			agent.identity = this.compactAgentLine(agent.agent, width);
			agent.current = undefined;
			agent.history = [];
		}
		const compactLines = agentContentLines(fitted);
		if (compactLines.length + 5 <= maxRows)
			return { lines: compactLines, showSeparator: true };
		if (compactLines.length + 4 <= maxRows)
			return { lines: compactLines, showSeparator: false };
		return {
			lines: this.packAgentLines(
				fitted.map((agent) => agent.agent),
				Math.max(1, maxRows - 4),
				width,
			),
			showSeparator: false,
		};
	}

	private packAgentLines(
		agents: readonly AgentProgressSnapshot[],
		lineLimit: number,
		width: number,
	) {
		const columns = Math.ceil(agents.length / lineLimit);
		const separator = this.theme.fg("border", " │ ");
		const columnWidth = Math.max(
			1,
			Math.floor((width - (columns - 1) * 3) / columns),
		);
		const lineCount = Math.ceil(agents.length / columns);
		return Array.from({ length: lineCount }, (_unused, row) => {
			const cells = agents.slice(row * columns, (row + 1) * columns);
			return cells
				.map((agent) => {
					const line = truncateToWidth(
						this.compactAgentLine(agent, columnWidth),
						columnWidth,
						"…",
					);
					return `${line}${" ".repeat(Math.max(0, columnWidth - visibleWidth(line)))}`;
				})
				.join(separator);
		});
	}

	private border(left: string, right: string, width: number) {
		return this.theme.fg("border", `${left}${"─".repeat(width)}${right}`);
	}

	private row(content: string, width: number) {
		const clipped = truncateToWidth(content, width, "…");
		const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
		return `${this.theme.fg("border", "│")}${clipped}${padding}${this.theme.fg("border", "│")}`;
	}
}

export function autoOpenMonitorOverlay(
	ctx: MonitorContext,
	scopeId: string,
	language: Language,
) {
	void openMonitorScope(ctx, scopeId, language, true);
}

export async function openActiveMonitorOverlay(ctx: MonitorContext) {
	const scope = activeProgressSnapshot().scopes.at(-1);
	if (!scope) {
		ctx.ui.notify(monitorNoActiveAgentsText(runtimeLanguage()), "info");
		return false;
	}
	return openMonitorScope(ctx, scope.id, runtimeLanguage(), false);
}

export function activeMonitorScopeId() {
	return activeMonitor?.scopeId;
}

async function openMonitorScope(
	ctx: MonitorContext,
	scopeId: string,
	language: Language,
	automatic: boolean,
) {
	if (ctx.mode !== "tui" || (automatic && silencedScopes.has(scopeId)))
		return false;
	if (!findScope(activeProgressSnapshot(), scopeId)) return false;
	if (activeMonitor?.scopeId === scopeId) {
		activeMonitor.handle?.focus();
		return true;
	}
	activeMonitor?.close("replaced");
	const monitor: ActiveMonitor = {
		scopeId,
		close: () => undefined,
	};
	activeMonitor = monitor;
	try {
		const reason = await ctx.ui.custom<MonitorCloseReason>(
			(tui, theme, keybindings, done) => {
				const component = new MonitorOverlayComponent(
					tui,
					theme,
					keybindings,
					scopeId,
					language,
					ctx.cwd,
					homedir(),
					(reason) => {
						if (activeMonitor === monitor) activeMonitor = undefined;
						done(reason);
					},
				);
				monitor.close = (closeReason) => component.close(closeReason);
				return component;
			},
			{
				overlay: true,
				overlayOptions: {
					width: "80%",
					maxHeight: "70%",
					anchor: "center",
				},
				onHandle: (handle) => {
					monitor.handle = handle;
				},
			},
		);
		if (reason === "escape") rememberSilenced(scopeId);
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(monitorOpenFailedText(message, language), "error");
		return false;
	} finally {
		if (activeMonitor === monitor) activeMonitor = undefined;
	}
}

function rememberSilenced(scopeId: string) {
	if (silencedScopes.has(scopeId)) return;
	silencedScopes.add(scopeId);
	let unsubscribe: () => void = () => undefined;
	unsubscribe = onProgressChanged((snapshot) => {
		if (findScope(snapshot, scopeId)) return;
		silencedScopes.delete(scopeId);
		silenceCleanups.delete(scopeId);
		unsubscribe();
	});
	silenceCleanups.set(scopeId, unsubscribe);
}

function findScope(
	snapshot: ReturnType<typeof activeProgressSnapshot>,
	scopeId: string,
) {
	return snapshot.scopes.find((scope) => scope.id === scopeId);
}

function alignRight(left: string, right: string, width: number) {
	const rightWidth = visibleWidth(right);
	if (rightWidth >= width) return truncateToWidth(right, width, "…");
	const clippedLeft = truncateToWidth(left, width - rightWidth - 1, "…");
	const gap = Math.max(1, width - visibleWidth(clippedLeft) - rightWidth);
	return `${clippedLeft}${" ".repeat(gap)}${right}`;
}

function center(text: string, width: number) {
	const clipped = truncateToWidth(text, width, "…");
	return `${" ".repeat(Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2)))}${clipped}`;
}

function agentContentLines(agents: readonly AgentRows[]) {
	return agents.flatMap((agent) => [
		agent.identity,
		...(agent.current ? [agent.current] : []),
		...agent.history,
	]);
}

function spinnerGlyph() {
	return renderActivitySpinners(activitySpinnerLine("")).trim();
}

function formatMonitorElapsed(milliseconds: number) {
	const seconds = Math.max(0, Math.floor(milliseconds / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
