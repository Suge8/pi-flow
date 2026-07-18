import {
	existsSync,
	type FSWatcher,
	mkdirSync,
	readFileSync,
	watch,
} from "node:fs";
import { basename, dirname } from "node:path";
import { isRecord } from "../../shared/guards.js";
import type { GoalCompletionFact } from "../types.js";

export function watchBatchResults(
	paths: string[],
	onResult: (path: string, fact: GoalCompletionFact) => void,
	signal: AbortSignal,
	parallelRunId?: string,
) {
	const watchers: FSWatcher[] = [];
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		for (const watcher of watchers) watcher.close();
		signal.removeEventListener("abort", close);
	};
	if (signal.aborted) return close;
	for (const path of paths) {
		const parent = dirname(path);
		const file = basename(path);
		mkdirSync(parent, { recursive: true });
		const readResult = () => {
			if (closed) return;
			const fact = readCompletionFact(path, parallelRunId);
			if (fact) onResult(path, fact);
		};
		readResult();
		watchers.push(
			watch(parent, (_event, name) => {
				if (name !== null && String(name) !== file) return;
				readResult();
			}),
		);
	}
	signal.addEventListener("abort", close, { once: true });
	return close;
}

export function readCompletionFact(path: string, parallelRunId?: string) {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		const fact = completionFactFromParsed(parsed);
		if (!fact) return undefined;
		if (parallelRunId !== undefined && fact.parallelRunId !== parallelRunId)
			return undefined;
		return fact;
	} catch {
		return undefined;
	}
}

function completionFactFromParsed(value: unknown) {
	if (isGoalCompletionFact(value)) return value;
	if (!isRecord(value)) return undefined;
	return isGoalCompletionFact(value.completion) ? value.completion : undefined;
}

function isGoalCompletionFact(value: unknown): value is GoalCompletionFact {
	if (!isRecord(value)) return false;
	return (
		typeof value.goalId === "string" &&
		typeof value.summary === "string" &&
		typeof value.acceptance === "string" &&
		(typeof value.sessionFile === "string" || value.sessionFile === null) &&
		(value.checks === undefined ||
			value.checks === null ||
			isRecord(value.checks)) &&
		(value.parallelRunId === undefined ||
			typeof value.parallelRunId === "string")
	);
}
