/** 检查第一行结论：去掉常见 Markdown 包裹，便于模型输出 **PASS** 等仍能解析。 */
export function normalizeReviewVerdictLine(line: string) {
	return line
		.trim()
		.replace(/^\*{1,2}(.+?)\*{1,2}$/u, "$1")
		.replace(/^__([^_]+)__$/u, "$1")
		.trim();
}

const CHECK_VERDICTS = new Set(["PASS", "FAIL"]);

export type CheckVerdict = "PASS" | "FAIL";

export function parseCheckVerdictLine(line: string): CheckVerdict | undefined {
	const normalized = normalizeReviewVerdictLine(line).toUpperCase();
	return CHECK_VERDICTS.has(normalized)
		? (normalized as CheckVerdict)
		: undefined;
}
