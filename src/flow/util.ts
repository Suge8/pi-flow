import { createHash } from "node:crypto";
import { clipText } from "../shared/clip.js";
import type { FlowGoal, FlowState } from "./types.js";

export function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	for (const char of input) {
		if (quote) {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) tokens.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current) tokens.push(current);
	return tokens;
}

export function replaceGoal(flow: FlowState, index: number, goal: FlowGoal) {
	return flow.goals.map((item, offset) => (offset === index ? goal : item));
}

export function flowSessionName(flow: FlowState, goal: FlowGoal) {
	const flowNumber = /^F([0-9]+)/u.exec(flow.id)?.[1] ?? "0";
	return `F${flowNumber}-G${goal.index + 1} ${clipText(goal.title, 18)}`;
}

export function requireFlowStartedAt(flow: Pick<FlowState, "startedAt">) {
	if (typeof flow.startedAt !== "number")
		throw new Error("running Flow 缺少 startedAt");
	return flow.startedAt;
}

export function sha256(text: string) {
	return createHash("sha256").update(text).digest("hex");
}

export { clipText as clip };
