import { createHash, randomUUID } from "node:crypto";
import type { ActiveCheckRun, CheckModelOutcome } from "../goal/types.js";
import type { ReviewerConfig } from "./config.js";
import { reviewerLabel } from "./reviewer-pool.js";

export function checkInputHash(
	phase: "acceptance" | "quality",
	prompt: string,
) {
	return hash(JSON.stringify({ version: 1, phase, prompt }));
}

export function startCheckRun(
	prior: ActiveCheckRun | null | undefined,
	round: number,
	inputHash: string,
	reviewers: ReviewerConfig[],
): ActiveCheckRun {
	const sameInput = prior?.round === round && prior.inputHash === inputHash;
	const keys = reviewerKeys(reviewers);
	const reusable = sameInput
		? new Map(prior.models.map((model) => [model.key, model.outcome]))
		: new Map<string, CheckModelOutcome | null>();
	const sameReviewers =
		sameInput &&
		prior.models.length === keys.length &&
		keys.every((key) => prior.models.some((model) => model.key === key));
	return {
		round,
		generation: randomUUID(),
		runId: sameReviewers ? prior.runId : randomUUID(),
		startedAt: sameInput ? (prior.startedAt ?? Date.now()) : Date.now(),
		inputHash,
		models: keys.map((key, index) => ({
			key,
			label: reviewerLabel(reviewers[index]),
			thinking: reviewers[index].thinking,
			outcome: reusable.get(key) ?? null,
		})),
	};
}

export function settleCheckModel(
	run: ActiveCheckRun,
	generation: string,
	index: number,
	outcome: CheckModelOutcome,
): ActiveCheckRun | undefined {
	if (run.generation !== generation || !run.models[index]) return undefined;
	return {
		...run,
		models: run.models.map((model, modelIndex) =>
			modelIndex === index ? { ...model, outcome } : model,
		),
	};
}

function reviewerKeys(reviewers: ReviewerConfig[]) {
	const occurrences = new Map<string, number>();
	return reviewers.map((reviewer) => {
		const base = hash(
			JSON.stringify({
				model: reviewer.model,
				thinking: reviewer.thinking,
				command: reviewer.command,
				tools: reviewer.tools,
				excludeTools: reviewer.excludeTools,
				timeoutMs: reviewer.timeoutMs,
				openaiFast: reviewer.openaiFast,
				extensions: reviewer.extensions,
			}),
		);
		const occurrence = (occurrences.get(base) ?? 0) + 1;
		occurrences.set(base, occurrence);
		return `${base}:${occurrence}`;
	});
}

function hash(value: string) {
	return createHash("sha256").update(value).digest("hex");
}
