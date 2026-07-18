import { homedir } from "node:os";
import { activitySpinnerLine } from "./activity-spinner.js";
import type { AgentProgress } from "./agent-progress.js";
import type { Language, ReviewerConfig } from "./config.js";
import { toolDisplayLabel, toolValueText } from "./tool-line.js";
import { monitorThinkingText } from "./ui-language.js";

export type ReviewerStatus = "running" | "passed" | "failed" | "error";

export interface ReviewerProgress {
	index: number;
	label: string;
	status: ReviewerStatus;
	summary?: string;
	thinking?: string;
	activity?: AgentProgress;
}

export interface ReviewerResult<T> extends ReviewerProgress {
	reviewer: ReviewerConfig;
	result: T;
}

export async function runReviewerPool<T>(args: {
	reviewers: ReviewerConfig[];
	run: (
		reviewer: ReviewerConfig,
		index: number,
		refresh: () => void,
	) => Promise<T>;
	statusOf: (result: T) => ReviewerStatus;
	summaryOf?: (result: T) => string | undefined;
	initialResults?: Array<T | undefined>;
	onSettled?: (result: ReviewerResult<T>) => void | Promise<void>;
	onUpdate?: (progress: ReviewerProgress[]) => void;
	activityOf?: (
		reviewer: ReviewerConfig,
		index: number,
	) => AgentProgress | undefined;
}): Promise<ReviewerResult<T>[]> {
	const progress: ReviewerProgress[] = args.reviewers.map((reviewer, index) => {
		const result = args.initialResults?.[index];
		return result === undefined
			? {
					index,
					label: reviewerLabel(reviewer),
					status: "running" as const,
					thinking: reviewer.thinking,
				}
			: reviewerProgress(reviewer, index, result, args);
	});
	const publish = () =>
		args.onUpdate?.(snapshot(progress, args.reviewers, args.activityOf));
	publish();
	let settlement = Promise.resolve();
	return Promise.all(
		args.reviewers.map(async (reviewer, index) => {
			const initial = args.initialResults?.[index];
			if (initial !== undefined)
				return { ...progress[index], reviewer, result: initial };
			const result = await args.run(reviewer, index, publish);
			const settled = {
				...reviewerProgress(reviewer, index, result, args),
				reviewer,
				result,
			};
			settlement = settlement.then(() => args.onSettled?.(settled));
			await settlement;
			progress[index] = settled;
			publish();
			return settled;
		}),
	);
}

function reviewerProgress<T>(
	reviewer: ReviewerConfig,
	index: number,
	result: T,
	args: {
		statusOf: (result: T) => ReviewerStatus;
		summaryOf?: (result: T) => string | undefined;
	},
): ReviewerProgress {
	return {
		index,
		label: reviewerLabel(reviewer),
		status: args.statusOf(result),
		summary: args.summaryOf?.(result),
		thinking: reviewer.thinking,
	};
}

function snapshot(
	progress: ReviewerProgress[],
	reviewers: ReviewerConfig[],
	activityOf?: (
		reviewer: ReviewerConfig,
		index: number,
	) => AgentProgress | undefined,
) {
	return progress.map((item, index) => {
		const activity = activityOf?.(reviewers[index] as ReviewerConfig, index);
		return {
			...item,
			...(activity?.hasReceivedEvent ? { activity } : {}),
		};
	});
}

export function reviewerLabel(reviewer: Pick<ReviewerConfig, "model">) {
	return shortModel(reviewer.model);
}

export function shortModel(model: string) {
	return model.split("/").at(-1) || model;
}

export function reviewerProgressLines(
	progress: ReviewerProgress[],
	language: Language = "zh",
	cwd = process.cwd(),
) {
	return progress.map((item) => {
		const prefix = reviewerStatusPrefix(item, language, cwd);
		return item.summary ? `${prefix}：${item.summary}` : prefix;
	});
}

export function reviewerActivityLine(
	label: string,
	activity: AgentProgress,
	language: Language,
	cwd: string,
) {
	const action = activity.currentTool
		? `${toolDisplayLabel(activity.currentTool, language)} ${toolValueText(
				activity.currentTool,
				activity.currentToolArgs ?? "",
				cwd,
				homedir(),
			)}`.trim()
		: monitorThinkingText(language);
	return activitySpinnerLine(
		`${label} · ${action} · ${activity.toolCallCount} calls`,
	);
}

function reviewerStatusPrefix(
	item: ReviewerProgress,
	language: Language,
	cwd: string,
) {
	if (item.status === "running")
		return item.activity
			? reviewerActivityLine(item.label, item.activity, language, cwd)
			: item.label;
	return `${statusIcon(item.status)} ${item.label}`;
}

function statusIcon(status: Exclude<ReviewerStatus, "running">) {
	if (status === "passed") return "✅";
	if (status === "failed") return "❌";
	return "⚠️";
}
