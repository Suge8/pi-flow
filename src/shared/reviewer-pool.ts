import type { ReviewerConfig } from "./config.js";

export type ReviewerStatus = "running" | "passed" | "failed" | "error";

export interface ReviewerProgress {
	index: number;
	label: string;
	status: ReviewerStatus;
	summary?: string;
}

export interface ReviewerResult<T> extends ReviewerProgress {
	reviewer: ReviewerConfig;
	result: T;
}

export async function runReviewerPool<T>(args: {
	reviewers: ReviewerConfig[];
	run: (reviewer: ReviewerConfig, index: number) => Promise<T>;
	statusOf: (result: T) => ReviewerStatus;
	summaryOf?: (result: T) => string | undefined;
	onUpdate?: (progress: ReviewerProgress[]) => void;
}): Promise<ReviewerResult<T>[]> {
	const progress: ReviewerProgress[] = args.reviewers.map(
		(reviewer, index) => ({
			index,
			label: reviewerLabel(reviewer),
			status: "running",
		}),
	);
	args.onUpdate?.(progress.map((item) => ({ ...item })));
	const results = await Promise.all(
		args.reviewers.map(async (reviewer, index) => {
			const result = await args.run(reviewer, index);
			progress[index] = {
				...progress[index],
				status: args.statusOf(result),
				summary: args.summaryOf?.(result),
			};
			args.onUpdate?.(progress.map((item) => ({ ...item })));
			return { ...progress[index], reviewer, result };
		}),
	);
	return results;
}

export function reviewerLabel(reviewer: Pick<ReviewerConfig, "model">) {
	return shortModel(reviewer.model);
}

export function shortModel(model: string) {
	return model.split("/").at(-1) || model;
}

export function reviewerProgressLines(progress: ReviewerProgress[]) {
	return progress.map((item) => {
		const prefix =
			`${item.index + 1}·${item.label} ${statusIcon(item.status)}`.trim();
		return item.summary ? `${prefix}：${item.summary}` : prefix;
	});
}

function statusIcon(status: ReviewerStatus) {
	if (status === "passed") return "✅";
	if (status === "failed") return "❌";
	if (status === "error") return "⚠️";
	return "…";
}
