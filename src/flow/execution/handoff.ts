import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	handoffText,
	hasCriteriaDeviation,
	replaceHandoff,
} from "../../plan/markdown.js";
import type { FlowGoal, GoalCompletionFact } from "../types.js";

export function readOrGenerateHandoff(
	dir: string,
	goal: FlowGoal,
	fact: GoalCompletionFact,
) {
	const path = join(dir, goal.file);
	const markdown = readFileSync(path, "utf8");
	const existing = handoffText(markdown).trim();
	if (existing) return { text: existing, generated: false };
	const generated = [
		`完成摘要：${fact.summary}`,
		`完成验收：${fact.acceptance}`,
	]
		.filter((line) => !line.endsWith("："))
		.join("\n");
	writeFileSync(path, replaceHandoff(markdown, generated));
	return { text: generated, generated: true };
}

export function handoffHasCriteriaDeviation(text: string) {
	return hasCriteriaDeviation(text);
}
