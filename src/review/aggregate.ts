import type { ReviewOutcome } from "../review-outcome.js";
import type { Language } from "../shared/config.js";
import type { ReviewerResult } from "../shared/reviewer-pool.js";

type ReviewModelResult = ReviewerResult<ReviewOutcome>;
type FailedReviewResult = ReviewModelResult & {
	result: { kind: "needs_changes"; review: string };
};
type ErrorReviewResult = ReviewModelResult & {
	result: { kind: "system_error"; notification: string };
};
type PassedReviewResult = ReviewModelResult & {
	result: { kind: "pass"; summary: string };
};

export function aggregateReviewOutcomes(
	results: ReviewModelResult[],
	language: Language = "zh",
): ReviewOutcome {
	const cancelled = results.find((item) => item.result.kind === "cancelled");
	if (cancelled) return cancelled.result;
	const failures = results.filter(
		(item) => item.result.kind === "needs_changes",
	) as FailedReviewResult[];
	const errors = results.filter(
		(item) => item.result.kind === "system_error",
	) as ErrorReviewResult[];
	const passes = results.filter(
		(item) => item.result.kind === "pass",
	) as PassedReviewResult[];
	if (failures.length > 0)
		return {
			kind: "needs_changes",
			review: aggregateFailedReviews(failures, language),
			details: aggregateReviewDetails(results, language),
			...(errors.length > 0
				? { infraErrors: aggregateReviewErrors(errors, language) }
				: {}),
		};
	const formatErrors = errors.filter((item) =>
		isReviewFormatInvalidError(item.result),
	);
	if (passes.length === 0 || errors.length > formatErrors.length)
		return {
			kind: "system_error",
			notification: aggregateReviewErrors(errors, language),
		};
	return {
		kind: "pass",
		summary: aggregatePassSummaries(passes, language),
		...(formatErrors.length > 0
			? {
					details: aggregateReviewDetails(results, language, formatErrors),
					infraErrors: aggregateIgnoredReviewFormatErrors(
						formatErrors,
						language,
					),
				}
			: {}),
	};
}

export function aggregateFailedReviews(
	failures: FailedReviewResult[],
	language: Language = "zh",
) {
	return failures
		.map((item) => reviewerSection(item, item.result.review, language))
		.join("\n\n");
}

export function aggregateReviewErrors(
	results: ErrorReviewResult[],
	language: Language = "zh",
) {
	return results
		.map((item) => reviewerSection(item, item.result.notification, language))
		.join("\n\n");
}

export function aggregatePassSummaries(
	results: PassedReviewResult[],
	language: Language = "zh",
) {
	const passed = language === "en" ? "Quality check passed." : "质检通过。";
	if (results.length === 1) return results[0].result.summary || passed;
	return results
		.map((item) =>
			reviewerSection(item, item.result.summary || passed, language),
		)
		.join("\n\n");
}

function aggregateReviewDetails(
	results: ReviewModelResult[],
	language: Language,
	ignoredErrors: ErrorReviewResult[] = [],
) {
	const ignored = new Set<ReviewModelResult>(ignoredErrors);
	return results
		.map((item) =>
			reviewerSection(
				item,
				reviewDetailText(item, language, ignored.has(item)),
				language,
			),
		)
		.join("\n\n");
}

function reviewDetailText(
	item: ReviewModelResult,
	language: Language,
	ignoredError = false,
) {
	if (item.result.kind === "pass")
		return `PASS\n${item.result.summary || passFallback(language)}`;
	if (item.result.kind === "needs_changes") return item.result.review;
	if (item.result.kind === "system_error") {
		const prefix = ignoredError ? `${ignoredFormatPrefix(language)}\n` : "";
		return `${prefix}${item.result.notification}`;
	}
	return item.result.notification;
}

function passFallback(language: Language) {
	return language === "en" ? "Quality check passed." : "质检通过。";
}

function aggregateIgnoredReviewFormatErrors(
	results: ErrorReviewResult[],
	language: Language,
) {
	const prefix = ignoredFormatPrefix(language);
	return results
		.map((item) =>
			reviewerSection(item, `${prefix}\n${item.result.notification}`, language),
		)
		.join("\n\n");
}

function ignoredFormatPrefix(language: Language) {
	return language === "en"
		? "Invalid format (ignored this model result)"
		: "格式无效（已忽略该模型结论）";
}

function isReviewFormatInvalidError(
	result: Extract<ReviewOutcome, { kind: "system_error" }>,
) {
	return (
		result.notification.startsWith("review 输出格式无效") ||
		result.notification.startsWith("review output format invalid")
	);
}

function reviewerSection(
	item: Pick<ReviewModelResult, "index" | "label">,
	text: string,
	language: Language,
) {
	const label = language === "en" ? "Model" : "模型";
	return `${label} ${item.index + 1} · ${item.label}\n${text.trim()}`;
}
