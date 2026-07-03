import type { Language } from "./shared/config.js";
import { parseCheckVerdictLine } from "./shared/review-verdict.js";

export const APPLY_INSTRUCTION =
	"将质量检查反馈视为待核实假设，而非事实；先基于当前文件、测试/检查输出和会话约束核实。反馈属实时，修根因并做最小充分修复，避免无关重构、抽象、依赖或风格改动；反馈不成立时，不应用该反馈，并说明依据（文件、命令输出或约束）。";
const APPLY_INSTRUCTION_EN =
	"Treat the quality-check feedback as hypotheses to verify, not facts. Verify it against current files, test/check output, and conversation constraints. When feedback is valid, fix the root cause with the smallest sufficient change; avoid unrelated refactors, abstractions, dependencies, or style changes. When feedback is invalid, do not apply it and state the basis (file, command output, or constraint).";

export function applyInstruction(language: Language = "zh") {
	return language === "en" ? APPLY_INSTRUCTION_EN : APPLY_INSTRUCTION;
}

export function reviewFeedbackInstruction(
	language: Language = "zh",
	goalScoped = false,
) {
	const base = applyInstruction(language);
	if (!goalScoped) return base;
	return language === "en"
		? `${base} After handling the feedback, continue completing the original Goal; do not only handle the review feedback.`
		: `${base} 处理完反馈后继续完成原目标；不要只处理检查反馈。`;
}

export type ReviewOutcome =
	| { kind: "pass"; summary: string; infraErrors?: string }
	| { kind: "needs_changes"; review: string; infraErrors?: string }
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
	if (verdict === "PASS")
		return { kind: "pass", summary: rest.join("\n").trim() };
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
		notification: language === "en" ? "Review cancelled" : "质量检查已取消。",
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
		review.startsWith("Review failed with exit")
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
			}
		: {
				emptyOutput: "review 输出为空：stdout 为空。无检查结论。",
				timeout: "review 子进程超时：未在 timeoutMs 内返回有效输出。",
				emptyLine: "（空）",
				invalidFormat: (actual: string) =>
					`review 输出格式无效：第一行必须是 PASS 或 FAIL；实际是：${actual}`,
			};
}

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
