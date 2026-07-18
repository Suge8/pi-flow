import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { currentSessionFile } from "./ownership.js";

interface SessionTransition {
	key: string;
	ctx: ExtensionCommandContext;
	run: () => Promise<void>;
	onError: (error: unknown) => void;
	immediate?: ReturnType<typeof setImmediate>;
	done: Promise<void>;
	resolveDone: () => void;
}

const transitions = new Map<string, SessionTransition>();
const transitionTasks = new Set<Promise<void>>();

export function requestSessionTransition(input: {
	key: string;
	ctx: ExtensionCommandContext;
	run: () => Promise<void>;
	onError: (error: unknown) => void;
}) {
	const sessionFile = currentSessionFile(input.ctx);
	if (!sessionFile) return false;
	const existing = transitions.get(sessionFile);
	if (existing) return existing.key === input.key;
	let resolveDone = () => {};
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});
	const transition: SessionTransition = { ...input, done, resolveDone };
	transitions.set(sessionFile, transition);
	transitionTasks.add(done);
	transition.immediate = setImmediate(() => {
		transition.immediate = undefined;
		void runSessionTransition(sessionFile, transition);
	});
	return true;
}

export function cancelSessionTransition(sessionFile: string | undefined) {
	if (!sessionFile) return;
	const transition = transitions.get(sessionFile);
	if (!transition) return;
	if (transition.immediate) clearImmediate(transition.immediate);
	transitions.delete(sessionFile);
	finishTransition(transition);
}

export async function waitForSessionTransitions() {
	while (transitionTasks.size > 0) await Promise.all([...transitionTasks]);
}

export function pendingSessionTransitionCount() {
	return transitions.size;
}

async function runSessionTransition(
	sessionFile: string,
	transition: SessionTransition,
) {
	try {
		await transition.ctx.waitForIdle();
		if (transitions.get(sessionFile) !== transition) return;
		if (currentSessionFile(transition.ctx) !== sessionFile) return;
		transitions.delete(sessionFile);
		await transition.run();
	} catch (error) {
		try {
			transition.onError(error);
		} catch (reportError) {
			console.error("Flow session transition failed", error, reportError);
		}
	} finally {
		if (transitions.get(sessionFile) === transition)
			transitions.delete(sessionFile);
		finishTransition(transition);
	}
}

function finishTransition(transition: SessionTransition) {
	transitionTasks.delete(transition.done);
	transition.resolveDone();
}
