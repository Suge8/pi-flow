import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { currentSessionFile } from "./ownership.js";
import type { GoalCompletionFact } from "./types.js";

const activeContexts = new Map<string, ExtensionCommandContext>();
const completionFacts = new Map<string, GoalCompletionFact>();

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

export function rememberCompletionFact(fact: GoalCompletionFact) {
	if (fact.sessionFile) completionFacts.set(fact.sessionFile, fact);
}

export function completionFact(sessionFile: string | undefined) {
	return sessionFile ? completionFacts.get(sessionFile) : undefined;
}

export function deleteCompletionFact(sessionFile: string | null) {
	if (sessionFile) completionFacts.delete(sessionFile);
}
