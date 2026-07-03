import type { ReviewOutcome } from "../review-outcome.js";
import type { Language } from "../shared/config.js";

export function emptyReviewOutputOutcome(
	stderr: string,
	language: Language = "zh",
): ReviewOutcome {
	const suffix = stderr
		? language === "en"
			? ` stderr: ${truncateSystemError(stderr)}`
			: ` stderr：${truncateSystemError(stderr)}`
		: "";
	return {
		kind: "system_error",
		notification:
			language === "en"
				? `review output is empty: stdout is empty. No review result.${suffix}`
				: `review 输出为空：stdout 为空。无审查结论。${suffix}`,
	};
}

function truncateSystemError(message: string) {
	return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}
