export interface PiActivityState {
	active: boolean;
	current?: string;
	sources: string[];
}

interface PiActivityUpdate {
	source: string;
	active: boolean;
}

export interface PiAttentionRequest {
	source: string;
}

type PiActivityListener = (state: PiActivityState) => void;
type PiAttentionListener = (request: PiAttentionRequest) => void;

interface PiActivitySignal {
	state: PiActivityState;
	emit(update: PiActivityUpdate): void;
	subscribe(listener: PiActivityListener): () => void;
}

interface PiAttentionSignal {
	emit(request: PiAttentionRequest): void;
	subscribe(listener: PiAttentionListener): () => void;
}

const activityGlobal = globalThis as typeof globalThis & {
	__PI_ACTIVITY_SIGNAL__?: PiActivitySignal;
	__PI_ATTENTION_SIGNAL__?: PiAttentionSignal;
};

export function piActivitySignal(): PiActivitySignal {
	if (activityGlobal.__PI_ACTIVITY_SIGNAL__)
		return activityGlobal.__PI_ACTIVITY_SIGNAL__;
	const activeSources = new Set<string>();
	const listeners = new Set<PiActivityListener>();
	const signal: PiActivitySignal = {
		state: { active: false, sources: [] },
		emit(update) {
			if (update.active) activeSources.add(update.source);
			else activeSources.delete(update.source);
			const sources = [...activeSources];
			const state: PiActivityState = {
				active: sources.length > 0,
				sources,
			};
			const current = sources.at(-1);
			if (current) state.current = current;
			signal.state = state;
			for (const listener of [...listeners]) notify(listener, state);
		},
		subscribe(listener) {
			listeners.add(listener);
			notify(listener, signal.state);
			return () => listeners.delete(listener);
		},
	};
	activityGlobal.__PI_ACTIVITY_SIGNAL__ = signal;
	return signal;
}

export function setPiActivity(source: string, active: boolean) {
	piActivitySignal().emit({ source, active });
}

export function piAttentionSignal(): PiAttentionSignal {
	if (activityGlobal.__PI_ATTENTION_SIGNAL__)
		return activityGlobal.__PI_ATTENTION_SIGNAL__;
	const listeners = new Set<PiAttentionListener>();
	const signal: PiAttentionSignal = {
		emit(request) {
			for (const listener of [...listeners]) notify(listener, request);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	activityGlobal.__PI_ATTENTION_SIGNAL__ = signal;
	return signal;
}

export function requestPiAttention(source: string) {
	piAttentionSignal().emit({ source });
}

function notify<T>(listener: (value: T) => void, value: T) {
	try {
		listener(value);
	} catch (error) {
		queueMicrotask(() => {
			throw error;
		});
	}
}
