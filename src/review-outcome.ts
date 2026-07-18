import {
	APPLY_INSTRUCTION,
	APPLY_INSTRUCTION_EN,
} from "./shared/check-feedback.js";
import type { Language } from "./shared/config.js";
import {
	type PassOutputIssue,
	parseCheckVerdictLine,
	passOutputIssue,
} from "./shared/review-verdict.js";

export { reviewFeedbackInstruction } from "./shared/check-feedback.js";

export type ReviewOutcome =
	| { kind: "pass"; summary: string; details?: string; infraErrors?: string }
	| {
			kind: "needs_changes";
			review: string;
			/** 完整展示/落盘详情；review 只保留需要修复的失败反馈。 */
			details?: string;
			infraErrors?: string;
	  }
	| { kind: "system_error"; notification: string }
	| { kind: "cancelled"; notification: string };

export function parseReviewOutcome(
	result: string | null,
	language: Language = "zh",
): ReviewOutcome {
	if (result === null) return reviewTimeoutOutcome(language);
	const review = stripApplyInstruction(result);
	if (!review) return systemError(reviewCopy(language).emptyOutput);
	if (isReviewProcessFailure(review)) {
		return { kind: "system_error", notification: review.slice(0, 2000) };
	}
	const [firstLine = "", ...rest] = review.split(/\r?\n/);
	const verdict = parseCheckVerdictLine(firstLine);
	if (verdict === "PASS") {
		const summary = rest.join("\n").trim();
		const issue = passOutputIssue(summary);
		if (issue) return systemError(reviewCopy(language).missingEvidence(issue));
		return { kind: "pass", summary };
	}
	if (verdict === "FAIL") return { kind: "needs_changes", review };
	const actual = firstLine.trim() || reviewCopy(language).emptyLine;
	return systemError(reviewCopy(language).invalidFormat(actual));
}

export function reviewTimeoutOutcome(language: Language = "zh"): ReviewOutcome {
	return systemError(reviewCopy(language).timeout);
}

export function reviewAbortedOutcome(language: Language = "zh"): ReviewOutcome {
	return {
		kind: "cancelled",
		notification: language === "en" ? "Review cancelled" : "质检已取消。",
	};
}

export function stripApplyInstruction(text: string) {
	return removeWhitespaceInsensitive(
		removeWhitespaceInsensitive(text, APPLY_INSTRUCTION),
		APPLY_INSTRUCTION_EN,
	)
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function isReviewProcessFailure(review: string) {
	return (
		review.startsWith("Review failed to start:") ||
		review.startsWith("Review failed with exit") ||
		review.startsWith("Review terminated by signal")
	);
}

function systemError(notification: string): ReviewOutcome {
	return { kind: "system_error", notification };
}

function reviewCopy(language: Language) {
	return language === "en"
		? {
				emptyOutput:
					"review output is empty: stdout is empty. No check result.",
				timeout:
					"review subprocess timed out: no valid output before timeoutMs.",
				emptyLine: "(empty)",
				invalidFormat: (actual: string) =>
					`review output format invalid: first line must be PASS or FAIL; actual: ${actual}`,
				missingEvidence: (issue: PassOutputIssue) =>
					`review output format invalid: ${REVIEW_PASS_ISSUE_EN[issue]}`,
			}
		: {
				emptyOutput: "review 输出为空：stdout 为空。无检查结论。",
				timeout: "review 子进程超时：未在 timeoutMs 内返回有效输出。",
				emptyLine: "（空）",
				invalidFormat: (actual: string) =>
					`review 输出格式无效：第一行必须是 PASS 或 FAIL；实际是：${actual}`,
				missingEvidence: (issue: PassOutputIssue) =>
					`review 输出格式无效：${REVIEW_PASS_ISSUE_ZH[issue]}`,
			};
}

const REVIEW_PASS_ISSUE_ZH: Record<PassOutputIssue, string> = {
	missing_line: "PASS 缺少证据锚点行（证据：文件=…；命令=…）",
	missing_summary: "PASS 缺少摘要行（证据行前必须有一行极简摘要）",
	missing_file_anchor: "PASS 证据行缺少文件段（文件=至少一个带扩展名的路径）",
	missing_command_anchor: "PASS 证据行缺少命令段（命令=实际运行的命令）",
};

const REVIEW_PASS_ISSUE_EN: Record<PassOutputIssue, string> = {
	missing_line:
		"PASS is missing the evidence anchor line (Evidence: files=...; commands=...)",
	missing_summary:
		"PASS is missing the summary line (one terse summary line must precede the evidence line)",
	missing_file_anchor:
		"the PASS evidence line has no files segment (files=at least one path with an extension)",
	missing_command_anchor:
		"the PASS evidence line has no commands segment (commands=commands actually run)",
};

function removeWhitespaceInsensitive(text: string, needle: string) {
	let result = "";
	let index = 0;
	while (index < text.length) {
		const matchEnd = whitespaceInsensitiveMatchEnd(text, needle, index);
		if (matchEnd === undefined) {
			result += text[index];
			index += 1;
			continue;
		}
		index = matchEnd;
	}
	return result;
}

function whitespaceInsensitiveMatchEnd(
	text: string,
	needle: string,
	start: number,
) {
	let textIndex = start;
	for (const char of needle) {
		while (textIndex < text.length && /\s/.test(text[textIndex]))
			textIndex += 1;
		if (text[textIndex] !== char) return undefined;
		textIndex += 1;
	}
	return textIndex;
}
