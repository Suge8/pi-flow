import { clipText } from "./shared/clip.js";
import {
	type Language,
	type ReviewerConfig,
	readFlowConfig,
} from "./shared/config.js";
import { formatError } from "./shared/guards.js";
import { runPiPrompt } from "./shared/pi-process.js";
import {
	formatPlanEvidence,
	type PlanEvidence,
} from "./shared/plan-evidence.js";
import { readPrompt } from "./shared/prompts.js";
import { parseCheckVerdictLine } from "./shared/review-verdict.js";
import {
	type ReviewerProgress,
	type ReviewerResult,
	type ReviewerStatus,
	runReviewerPool,
} from "./shared/reviewer-pool.js";
import {
	buildFilesSection,
	buildTranscript,
	sessionEntries,
	type TranscriptConfig,
} from "./shared/session.js";

interface GoalForAudit {
	text: string;
	language: Language;
	plan?: PlanEvidence;
}

interface AuditContext {
	cwd: string;
	sessionManager?: unknown;
}

export interface GoalAuditResult {
	complete: boolean;
	feedback: string;
	raw: string;
	systemError?: boolean;
	infraFeedback?: string;
	models?: {
		label: string;
		status: "passed" | "failed" | "error";
		summary?: string;
	}[];
}

type GoalAuditModelResult = ReviewerResult<GoalAuditResult>;

const AUDIT_ATTEMPTS = 3;

export async function auditGoalCompletion(
	goal: GoalForAudit,
	summary: string,
	ctx: AuditContext,
	signal?: AbortSignal,
	onProgress?: (progress: ReviewerProgress[]) => void,
): Promise<GoalAuditResult> {
	let flowConfig: ReturnType<typeof readFlowConfig>;
	try {
		flowConfig = readFlowConfig();
	} catch (error) {
		return incomplete(
			auditCopy(goal.language).configError(formatError(error)),
			true,
		);
	}
	if (!flowConfig.acceptance.enabled) {
		const disabled = auditCopy(goal.language).disabled;
		return { complete: true, feedback: disabled, raw: `PASS\n${disabled}` };
	}

	const prompt = buildAuditPrompt(goal, summary, ctx, flowConfig.transcript);
	const results = await runReviewerPool({
		reviewers: flowConfig.models,
		run: (reviewer) =>
			runSingleAudit(reviewer, prompt, ctx, signal, goal.language),
		statusOf: auditStatus,
		summaryOf: auditSummary,
		onUpdate: onProgress,
	});
	return withAuditModels(
		aggregateAuditResults(results, goal.language),
		results,
	);
}

async function runSingleAudit(
	reviewer: ReviewerConfig,
	prompt: string,
	ctx: AuditContext,
	signal?: AbortSignal,
	language: Language = "zh",
) {
	let result: GoalAuditResult = incomplete(auditCopy(language).timeout, true);
	for (let attempt = 1; attempt <= AUDIT_ATTEMPTS; attempt += 1) {
		const output = await runPiPrompt(reviewer, prompt, ctx.cwd, signal);
		result = output.ok
			? parseAuditOutput(output.text, language)
			: incomplete(auditFailureText(output.feedback, language), true);
		if (!shouldRetryAudit(result) || attempt === AUDIT_ATTEMPTS) break;
	}
	return annotateAuditAttempts(result, language);
}

function buildAuditPrompt(
	goal: GoalForAudit,
	summary: string,
	ctx: AuditContext,
	transcript: TranscriptConfig,
) {
	const entries = sessionEntries(ctx);
	const plan = formatPlanEvidence(goal.plan, goal.language);
	const separator = goal.language === "en" ? ":" : "：";
	return `${readPrompt("goal-audit", goal.language)}

${goal.language === "en" ? "Goal" : "目标"}${separator}
${goal.text}${plan ? `\n\n${plan}` : ""}

${goal.language === "en" ? "Original execution model completion claim (may be empty; not evidence)" : "原执行模型完成声明（可为空，不作为证据）"}${separator}
${summary || (goal.language === "en" ? "(empty)" : "（空）")}

${goal.language === "en" ? "Transcript" : "会话记录"}${separator}
${buildTranscript(entries, transcript)}

${goal.language === "en" ? "Relevant file clues" : "相关文件线索"}${separator}
${buildFilesSection(entries, goal.language)}
`;
}

function aggregateAuditResults(
	results: GoalAuditModelResult[],
	language: Language,
): GoalAuditResult {
	const incompleteResults = results.filter(
		(item) => !item.result.complete && !item.result.systemError,
	);
	const systemErrors = results.filter((item) => item.result.systemError);
	const completeResults = results.filter((item) => item.result.complete);
	if (incompleteResults.length > 0)
		return aggregateIncomplete(incompleteResults, systemErrors, language);
	if (completeResults.length > 0) {
		const formatInvalidOnly =
			systemErrors.length === 0 ||
			systemErrors.every((item) => isAuditFormatInvalid(item.result));
		if (!formatInvalidOnly)
			return aggregateSystemErrors(systemErrors, language);
		const infra = systemErrors.filter((item) =>
			isAuditFormatInvalid(item.result),
		);
		return aggregateComplete(completeResults, infra, language);
	}
	if (systemErrors.length > 0)
		return aggregateSystemErrors(systemErrors, language);
	return aggregateComplete(results, [], language);
}

function aggregateIncomplete(
	incompleteResults: GoalAuditModelResult[],
	systemErrors: GoalAuditModelResult[],
	language: Language,
): GoalAuditResult {
	const feedback = incompleteResults
		.map((item) =>
			auditSection(item, item.result.feedback || item.result.raw, language),
		)
		.join("\n\n");
	const infraFeedback = systemErrors
		.map((item) =>
			auditSection(
				item,
				`${auditCopy(language).systemError}\n${item.result.feedback || item.result.raw}`,
				language,
			),
		)
		.join("\n\n");
	return {
		complete: false,
		feedback,
		raw: `FAIL\n${feedback}`,
		...(infraFeedback ? { infraFeedback } : {}),
	};
}

function aggregateSystemErrors(
	results: GoalAuditModelResult[],
	language: Language,
): GoalAuditResult {
	const feedback = results
		.map((item) =>
			auditSection(item, item.result.feedback || item.result.raw, language),
		)
		.join("\n\n");
	return {
		complete: false,
		feedback,
		raw: `FAIL\n${feedback}`,
		systemError: true,
	};
}

function aggregateComplete(
	results: GoalAuditModelResult[],
	formatInvalidErrors: GoalAuditModelResult[] = [],
	language: Language,
): GoalAuditResult {
	const feedback = [
		...results.map((item) =>
			auditSection(
				item,
				item.result.feedback || auditCopy(language).passed,
				language,
			),
		),
	]
		.filter(Boolean)
		.join("\n\n");
	const infraFeedback = formatInvalidErrors
		.map((item) =>
			auditSection(
				item,
				`${auditCopy(language).invalidFormatIgnored}\n${item.result.feedback || item.result.raw}`,
				language,
			),
		)
		.join("\n\n");
	if (results.length === 1 && !infraFeedback) return results[0].result;
	return {
		complete: true,
		feedback,
		raw: `PASS\n${feedback}`,
		...(infraFeedback ? { infraFeedback } : {}),
	};
}

function isAuditFormatInvalid(result: GoalAuditResult) {
	return (
		result.feedback.startsWith("完成验收输出格式无效") ||
		result.feedback.startsWith("completion acceptance output format invalid")
	);
}

function auditSection(
	item: Pick<GoalAuditModelResult, "index" | "label">,
	text: string,
	language: Language,
) {
	const label = language === "en" ? "Model" : "模型";
	return `${label} ${item.index + 1} · ${item.label}\n${text.trim()}`;
}

function withAuditModels(
	result: GoalAuditResult,
	models: GoalAuditModelResult[],
): GoalAuditResult {
	return {
		...result,
		models: models.map((model) => ({
			label: model.label,
			status: auditStatus(model.result) as "passed" | "failed" | "error",
			...(auditSummary(model.result)
				? { summary: auditSummary(model.result) }
				: {}),
		})),
	};
}

function auditStatus(result: GoalAuditResult): ReviewerStatus {
	if (result.complete) return "passed";
	return result.systemError ? "error" : "failed";
}

function auditSummary(result: GoalAuditResult) {
	return firstLineSummary(result.feedback || result.raw);
}

function firstLineSummary(text: string) {
	const line = text
		.split(/\r?\n/)
		.map((item) => item.trim())
		.find(
			(item) =>
				item &&
				item !== "PASS" &&
				item !== "FAIL" &&
				!/^(模型|Model)\s+\d+\s+·\s+/iu.test(item),
		);
	return line ? clipText(line, 55) : undefined;
}

function shouldRetryAudit(result: GoalAuditResult) {
	if (!result.systemError) return false;
	return (
		result.feedback.startsWith("完成验收超时") ||
		result.feedback.startsWith("completion acceptance timed out") ||
		result.feedback.startsWith("完成验收启动失败") ||
		result.feedback.startsWith("completion acceptance failed to start") ||
		result.feedback.startsWith("完成验收失败") ||
		result.feedback.startsWith("completion acceptance failed")
	);
}

function annotateAuditAttempts(
	result: GoalAuditResult,
	language: Language,
): GoalAuditResult {
	if (!shouldRetryAudit(result)) return result;
	const suffix =
		language === "en"
			? ` (tried ${AUDIT_ATTEMPTS} times)`
			: `（已尝试 ${AUDIT_ATTEMPTS} 次）`;
	return {
		...result,
		feedback: `${result.feedback}${suffix}`,
		raw: `${result.raw}${suffix}`,
	};
}

function parseAuditOutput(raw: string, language: Language): GoalAuditResult {
	const text = raw.trim();
	const [firstLine = "", ...rest] = text.split(/\r?\n/);
	const verdict = parseCheckVerdictLine(firstLine);
	const feedback = rest.join("\n").trim();
	if (verdict === "PASS") return { complete: true, feedback, raw: text };
	if (verdict === "FAIL")
		return {
			complete: false,
			feedback: feedback || auditCopy(language).failed,
			raw: text,
		};
	return incomplete(
		auditCopy(language).invalidFormat(text.slice(0, 2000)),
		true,
	);
}

function auditFailureText(feedback: string, language: Language) {
	if (language === "en") {
		if (feedback === "子进程超时。") return "completion acceptance timed out.";
		if (feedback === "子进程已取消。")
			return "completion acceptance cancelled.";
		if (feedback.startsWith("子进程启动失败："))
			return feedback.replace(
				"子进程启动失败：",
				"completion acceptance failed to start: ",
			);
		if (feedback.startsWith("子进程失败，"))
			return feedback.replace("子进程失败，", "completion acceptance failed, ");
		return feedback;
	}
	if (feedback === "子进程超时。") return "完成验收超时。";
	if (feedback === "子进程已取消。") return "完成验收已取消。";
	if (feedback.startsWith("子进程启动失败："))
		return feedback.replace("子进程", "完成验收");
	if (feedback.startsWith("子进程失败，"))
		return feedback.replace("子进程失败，", "完成验收失败，");
	return feedback;
}

function auditCopy(language: Language) {
	return language === "en"
		? {
				configError: (error: string) =>
					`completion acceptance config error: ${error}`,
				disabled: "Completion acceptance is disabled.",
				timeout: "completion acceptance timed out.",
				systemError: "System error",
				passed: "Completion acceptance passed.",
				failed: "Completion acceptance judged the goal incomplete.",
				invalidFormatIgnored: "Invalid format (ignored this model result)",
				invalidFormat: (text: string) =>
					`completion acceptance output format invalid. Raw output: ${text}`,
			}
		: {
				configError: (error: string) => `完成验收配置错误：${error}`,
				disabled: "完成验收已禁用。",
				timeout: "完成验收超时。",
				systemError: "系统错误",
				passed: "完成验收通过。",
				failed: "完成验收判定未通过。",
				invalidFormatIgnored: "格式无效（已忽略该模型结论）",
				invalidFormat: (text: string) =>
					`完成验收输出格式无效。原始输出：${text}`,
			};
}

function incomplete(feedback: string, systemError = false): GoalAuditResult {
	return { complete: false, feedback, raw: `FAIL\n${feedback}`, systemError };
}
