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

const EVIDENCE_LINE_PATTERN = /^(?:[-*]\s*)?(?:证据：|Evidence:)/u;
/** 带扩展名的文件路径 token（扩展名以字母开头，排除 v1.2 这类版本号）。 */
const FILE_ANCHOR_PATTERN = /[\w@./-]*\w\.[a-zA-Z]\w{0,5}\b/u;
const FILE_SEGMENT_PATTERN = /(?:文件|files)\s*=\s*([^;；]*)/iu;
const COMMAND_SEGMENT_PATTERN = /(?:命令|commands)\s*=\s*([^;；]*)/iu;

export type PassOutputIssue =
	| "missing_line"
	| "missing_summary"
	| "missing_file_anchor"
	| "missing_command_anchor";

/**
 * PASS 输出的机器可验证结构：摘要行在前；以首个证据行为唯一判定行，
 * 该行必须同时含文件段与命令段（`证据：文件=…；命令=…`）：文件段含至少
 * 一个带扩展名路径，命令段非空；后续冗余证据行不参与判定，拆行拼装无法通过。
 * 段内容的真实性机器无法验证，由检查协议约束；结构违反按格式无效拒绝。
 */
export function passOutputIssue(text: string): PassOutputIssue | undefined {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const evidenceIndex = lines.findIndex((line) =>
		EVIDENCE_LINE_PATTERN.test(line),
	);
	if (evidenceIndex === -1) return "missing_line";
	if (evidenceIndex === 0) return "missing_summary";
	const evidenceLine = lines[evidenceIndex];
	if (!hasFileSegment(evidenceLine)) return "missing_file_anchor";
	if (!hasCommandSegment(evidenceLine)) return "missing_command_anchor";
	return undefined;
}

function hasFileSegment(line: string) {
	const segment = FILE_SEGMENT_PATTERN.exec(line)?.[1];
	return Boolean(segment && FILE_ANCHOR_PATTERN.test(segment));
}

function hasCommandSegment(line: string) {
	return Boolean(COMMAND_SEGMENT_PATTERN.exec(line)?.[1]?.trim());
}
