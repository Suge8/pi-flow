import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { currentSessionFile } from "./ownership.js";
import type { GoalCompletionFact } from "./types.js";

const activeContexts = new Map<string, ExtensionCommandContext>();
const completionFacts = new Map<string, GoalCompletionFact>();

export function resetFlowRuntime() {
	activeContexts.clear();
	completionFacts.clear();
}

export function rememberFlowContext(ctx: { sessionManager?: unknown }) {
	if (!canStartNewSession(ctx)) return;
	const sessionFile = currentSessionFile(ctx);
	if (sessionFile) activeContexts.set(sessionFile, ctx);
}

function canStartNewSession(ctx: {
	sessionManager?: unknown;
}): ctx is ExtensionCommandContext {
	return typeof (ctx as { newSession?: unknown }).newSession === "function";
}

export function rememberedFlowContext(sessionFile: string | null | undefined) {
	return sessionFile ? activeContexts.get(sessionFile) : undefined;
}

export function releaseFlowContext(
	sessionFile: string | null | undefined,
	expected?: ExtensionCommandContext,
) {
	if (!sessionFile) return false;
	if (expected && activeContexts.get(sessionFile) !== expected) return false;
	return activeContexts.delete(sessionFile);
}

export function rememberCompletionFact(fact: GoalCompletionFact) {
	if (fact.sessionFile) completionFacts.set(fact.sessionFile, fact);
}

export function completionFact(sessionFile: string | undefined) {
	return sessionFile ? completionFacts.get(sessionFile) : undefined;
}

export function deleteCompletionFact(sessionFile: string | null | undefined) {
	if (sessionFile) completionFacts.delete(sessionFile);
}

export function flowRuntimeResourceCounts() {
	return {
		contexts: activeContexts.size,
		completionFacts: completionFacts.size,
	};
}
