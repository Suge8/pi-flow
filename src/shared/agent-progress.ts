export const RECENT_TOOL_LIMIT = 5;
export const SILENT_PROGRESS_WARNING_MS = 3 * 60 * 1000;

export type AgentProgressStatus = "thinking" | "tool" | "complete" | "error";

export interface AgentToolProgress {
	toolCallId: string;
	tool: string;
	args: string;
	startMs: number;
}

export interface RecentAgentTool extends AgentToolProgress {
	endMs: number;
	isError: boolean;
}

export interface AgentProgress {
	hasReceivedEvent: boolean;
	currentTool: string | null;
	currentToolArgs: string | null;
	currentToolStartMs: number | null;
	recentTools: readonly RecentAgentTool[];
	toolCallCount: number;
	tokens: number;
	cost: number;
	lastEventAt: number;
	status: AgentProgressStatus;
	activeTools: readonly AgentToolProgress[];
}

export interface TimedAgentProgressEvent {
	at: number;
	event: unknown;
}

export interface AgentProgressReference {
	readonly agentKey: string;
	readonly label: string;
	current: AgentProgress;
}

export interface AgentProgressScopeSnapshot {
	id: string;
	kind: string;
	label: string;
	startedAt: number;
	agents: readonly AgentProgressSnapshot[];
}

export interface AgentProgressSnapshot {
	agentKey: string;
	label: string;
	progress: AgentProgress;
}

export interface ActiveProgressSnapshot {
	scopes: readonly AgentProgressScopeSnapshot[];
}

export interface AgentProgressScope {
	readonly id: string;
	register(agentKey: string, label: string): AgentProgressReference;
	feed(agentKey: string, event: unknown): void;
	finish(agentKey: string, isError?: boolean): void;
	close(): void;
}

type AgentProgressListener = (snapshot: ActiveProgressSnapshot) => void;

interface ProgressScopeState {
	id: string;
	kind: string;
	label: string;
	startedAt: number;
	agents: Map<string, AgentProgressReference>;
}

interface ProgressStore {
	nextScopeId: number;
	scopes: Map<string, ProgressScopeState>;
	listeners: Set<AgentProgressListener>;
}

const progressGlobal = globalThis as typeof globalThis & {
	__PI_AGENT_PROGRESS_STORE__?: ProgressStore;
};

export function emptyAgentProgress(at: number): AgentProgress {
	return {
		hasReceivedEvent: false,
		currentTool: null,
		currentToolArgs: null,
		currentToolStartMs: null,
		recentTools: [],
		toolCallCount: 0,
		tokens: 0,
		cost: 0,
		lastEventAt: at,
		status: "thinking",
		activeTools: [],
	};
}

export function updateAgentProgress(
	progress: AgentProgress,
	input: TimedAgentProgressEvent,
): AgentProgress {
	const event = recordValue(input.event);
	if (!event || typeof event.type !== "string") return progress;
	const observed = progress.hasReceivedEvent
		? progress
		: { ...progress, hasReceivedEvent: true, lastEventAt: input.at };
	if (event.type === "tool_execution_start")
		return startTool(observed, event, input.at);
	if (event.type === "tool_execution_end")
		return endTool(observed, event, input.at);
	if (event.type === "message_end")
		return addMessageUsage(observed, event, input.at);
	return observed;
}

export function silentProgressMinutes(
	progress: Pick<AgentProgress, "lastEventAt">,
	nowMs: number,
) {
	const elapsedMs = nowMs - progress.lastEventAt;
	if (elapsedMs < SILENT_PROGRESS_WARNING_MS) return undefined;
	return Math.floor(elapsedMs / 60_000);
}

export function openProgressScope(
	kind: string,
	label: string,
): AgentProgressScope {
	const store = progressStore();
	const id = `${kind}:${store.nextScopeId}`;
	store.nextScopeId += 1;
	const state: ProgressScopeState = {
		id,
		kind,
		label,
		startedAt: Date.now(),
		agents: new Map(),
	};
	store.scopes.set(id, state);
	publishProgress(store);
	let closed = false;
	return {
		id,
		register(agentKey, agentLabel) {
			if (closed) throw new Error(`Progress scope is closed: ${label}`);
			const existing = state.agents.get(agentKey);
			if (existing) return existing;
			const reference: AgentProgressReference = {
				agentKey,
				label: agentLabel,
				current: emptyAgentProgress(Date.now()),
			};
			state.agents.set(agentKey, reference);
			publishProgress(store);
			return reference;
		},
		feed(agentKey, event) {
			if (closed) return;
			const reference = registeredAgent(state, agentKey);
			const next = updateAgentProgress(reference.current, {
				at: Date.now(),
				event,
			});
			if (next === reference.current) return;
			reference.current = next;
			publishProgress(store);
		},
		finish(agentKey, isError = false) {
			if (closed) return;
			const reference = registeredAgent(state, agentKey);
			const status = isError ? "error" : "complete";
			if (reference.current.status === status) return;
			reference.current = {
				...reference.current,
				currentTool: null,
				currentToolArgs: null,
				currentToolStartMs: null,
				activeTools: [],
				lastEventAt: Date.now(),
				status,
			};
			publishProgress(store);
		},
		close() {
			if (closed) return;
			closed = true;
			store.scopes.delete(id);
			publishProgress(store);
		},
	};
}

export function activeProgressSnapshot(): ActiveProgressSnapshot {
	return snapshot(progressStore());
}

export function onProgressChanged(listener: AgentProgressListener) {
	const store = progressStore();
	store.listeners.add(listener);
	notify(listener, snapshot(store));
	return () => {
		store.listeners.delete(listener);
	};
}

function startTool(
	progress: AgentProgress,
	event: Record<string, unknown>,
	at: number,
) {
	const tool = stringValue(event.toolName) ?? "tool";
	const toolCallId =
		stringValue(event.toolCallId) ?? `${tool}:${at}:${progress.toolCallCount}`;
	const activeTool: AgentToolProgress = {
		toolCallId,
		tool,
		args: summarizeToolArgs(event.args),
		startMs: at,
	};
	return withCurrentTool(
		{
			...progress,
			activeTools: [...progress.activeTools, activeTool],
			toolCallCount: progress.toolCallCount + 1,
			lastEventAt: at,
		},
		activeTool,
	);
}

function endTool(
	progress: AgentProgress,
	event: Record<string, unknown>,
	at: number,
) {
	const toolCallId = stringValue(event.toolCallId);
	const completed = toolCallId
		? progress.activeTools.find((tool) => tool.toolCallId === toolCallId)
		: undefined;
	if (!completed) return { ...progress, lastEventAt: at };
	const activeTools = progress.activeTools.filter(
		(tool) => tool.toolCallId !== completed.toolCallId,
	);
	const recentTools = [
		...progress.recentTools,
		{ ...completed, endMs: at, isError: event.isError === true },
	].slice(-RECENT_TOOL_LIMIT);
	return withCurrentTool(
		{ ...progress, activeTools, recentTools, lastEventAt: at },
		activeTools.at(-1),
	);
}

function addMessageUsage(
	progress: AgentProgress,
	event: Record<string, unknown>,
	at: number,
) {
	const message = recordValue(event.message);
	const usage = recordValue(message?.usage);
	const cost = recordValue(usage?.cost);
	return {
		...progress,
		tokens: progress.tokens + finiteNumber(usage?.totalTokens),
		cost: progress.cost + finiteNumber(cost?.total),
		lastEventAt: at,
	};
}

function withCurrentTool(
	progress: AgentProgress,
	current: AgentToolProgress | undefined,
): AgentProgress {
	return {
		...progress,
		currentTool: current?.tool ?? null,
		currentToolArgs: current?.args ?? null,
		currentToolStartMs: current?.startMs ?? null,
		status: current ? "tool" : "thinking",
	};
}

function summarizeToolArgs(value: unknown) {
	const args = recordValue(value);
	if (args) {
		for (const key of ["path", "command"]) {
			const value = stringValue(args[key]);
			if (value)
				return key === "command" ? clipCommand(value, 100) : clip(value, 100);
		}
	}
	if (value === undefined) return "";
	try {
		const serialized = JSON.stringify(value);
		return serialized === "{}" ? "" : clip(serialized, 100);
	} catch {
		return clip(String(value), 100);
	}
}

function snapshot(store: ProgressStore): ActiveProgressSnapshot {
	return {
		scopes: [...store.scopes.values()].map((scope) => ({
			id: scope.id,
			kind: scope.kind,
			label: scope.label,
			startedAt: scope.startedAt,
			agents: [...scope.agents.values()].map((reference) => ({
				agentKey: reference.agentKey,
				label: reference.label,
				progress: reference.current,
			})),
		})),
	};
}

function registeredAgent(state: ProgressScopeState, agentKey: string) {
	const reference = state.agents.get(agentKey);
	if (!reference)
		throw new Error(`Agent progress is not registered: ${agentKey}`);
	return reference;
}

function progressStore() {
	if (progressGlobal.__PI_AGENT_PROGRESS_STORE__)
		return progressGlobal.__PI_AGENT_PROGRESS_STORE__;
	const store: ProgressStore = {
		nextScopeId: 1,
		scopes: new Map(),
		listeners: new Set(),
	};
	progressGlobal.__PI_AGENT_PROGRESS_STORE__ = store;
	return store;
}

function publishProgress(store: ProgressStore) {
	const current = snapshot(store);
	for (const listener of [...store.listeners]) notify(listener, current);
}

function notify(
	listener: AgentProgressListener,
	value: ActiveProgressSnapshot,
) {
	try {
		listener(value);
	} catch (error) {
		queueMicrotask(() => {
			throw error;
		});
	}
}

function recordValue(value: unknown) {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringValue(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown) {
	return Number.isFinite(value) ? Number(value) : 0;
}

function clip(value: string, limit: number) {
	const clean = value.replace(/\s+/gu, " ").trim();
	return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

function clipCommand(value: string, limit: number) {
	const clean = value
		.replace(/\r?\n/gu, " ↵ ")
		.replace(/[\t ]+/gu, " ")
		.trim();
	return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}
