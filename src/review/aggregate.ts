import type { ReviewOutcome } from "../review-outcome.js";
import type { Language } from "../shared/config.js";
import type { ReviewerResult } from "../shared/reviewer-pool.js";

type ReviewModelResult = ReviewerResult<ReviewOutcome>;

export function aggregateReviewOutcomes(
	results: ReviewModelResult[],
	language: Language = "zh",
): ReviewOutcome {
	const cancelled = results.find((item) => item.result.kind === "cancelled");
	if (cancelled) return cancelled.result;
	const failures = results.filter(
		(item) => item.result.kind === "needs_changes",
	) as Array<
		ReviewModelResult & { result: { kind: "needs_changes"; review: string } }
	>;
	const errors = results.filter(
		(item) => item.result.kind === "system_error",
	) as Array<
		ReviewModelResult & {
			result: { kind: "system_error"; notification: string };
		}
	>;
	if (failures.length > 0)
		return {
			kind: "needs_changes",
			review: aggregateFailedReviews(failures, language),
			...(errors.length > 0
				? { infraErrors: aggregateReviewErrors(errors, language) }
				: {}),
		};
	const formatErrors = errors.filter((item) =>
		isReviewFormatInvalidError(item.result),
	);
	const passes = results.filter((item) => item.result.kind === "pass") as Array<
		ReviewModelResult & { result: { kind: "pass"; summary: string } }
	>;
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
					infraErrors: aggregateIgnoredReviewFormatErrors(
						formatErrors,
						language,
					),
				}
			: {}),
	};
}

export function aggregateFailedReviews(
	failures: Array<
		ReviewModelResult & { result: { kind: "needs_changes"; review: string } }
	>,
	language: Language = "zh",
) {
	return failures
		.map((item) => reviewerSection(item, item.result.review, language))
		.join("\n\n");
}

export function aggregateReviewErrors(
	results: Array<
		ReviewModelResult & {
			result: { kind: "system_error"; notification: string };
		}
	>,
	language: Language = "zh",
) {
	return results
		.map((item) => reviewerSection(item, item.result.notification, language))
		.join("\n\n");
}

export function aggregatePassSummaries(
	results: Array<
		ReviewModelResult & { result: { kind: "pass"; summary: string } }
	>,
	language: Language = "zh",
) {
	const passed = language === "en" ? "Quality check passed." : "质量检查通过。";
	if (results.length === 1) return results[0].result.summary || passed;
	return results
		.map((item) =>
			reviewerSection(item, item.result.summary || passed, language),
		)
		.join("\n\n");
}

function aggregateIgnoredReviewFormatErrors(
	results: Array<
		ReviewModelResult & {
			result: { kind: "system_error"; notification: string };
		}
	>,
	language: Language,
) {
	const prefix =
		language === "en"
			? "Invalid format (ignored this model result)"
			: "格式无效（已忽略该模型结论）";
	return results
		.map((item) =>
			reviewerSection(item, `${prefix}\n${item.result.notification}`, language),
		)
		.join("\n\n");
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
