import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ActiveCheckRun, CheckModelOutcome } from "./goal/types.js";
import type { ReviewCheckpointResult } from "./review/types.js";
import { openProgressScope } from "./shared/agent-progress.js";
import {
	checkInputHash,
	settleCheckModel,
	startCheckRun,
} from "./shared/check-run.js";
import { clipText } from "./shared/clip.js";
import {
	type Language,
	type ReviewerConfig,
	readFlowConfig,
} from "./shared/config.js";
import {
	buildContextEvidence,
	type ContextEvidenceRegistry,
} from "./shared/context-evidence.js";
import { formatError } from "./shared/guards.js";
import { autoOpenMonitorOverlay } from "./shared/monitor-overlay.js";
import { runPiPrompt } from "./shared/pi-process.js";
import {
	formatPlanEvidence,
	type PlanEvidence,
} from "./shared/plan-evidence.js";
import { readPrompt } from "./shared/prompts.js";
import {
	priorRoundsSection,
	type ReviewHistoryEntry,
} from "./shared/review-history.js";
import {
	type PassOutputIssue,
	parseCheckVerdictLine,
	passOutputIssue,
} from "./shared/review-verdict.js";
import {
	type ReviewerProgress,
	type ReviewerResult,
	type ReviewerStatus,
	reviewerLabel,
	runReviewerPool,
} from "./shared/reviewer-pool.js";
import { sessionEntriesSince } from "./shared/session.js";

interface GoalForAudit {
	text: string;
	language: Language;
	plan?: PlanEvidence;
	planChangeNote?: string;
	/** 往轮验收发现（跨轮收敛）：第 2 轮起注入检查 prompt。 */
	priorRounds?: ReviewHistoryEntry[];
	/** 证据锚点：只取锚点之后的会话事实（fork 会话不吃计划期前缀）。 */
	sessionAnchorId?: string;
}

interface AuditContext {
	cwd: string;
	mode?: ExtensionContext["mode"];
	ui?: ExtensionContext["ui"];
	sessionManager?: unknown;
	modelRegistry?: ContextEvidenceRegistry;
}

export interface GoalAuditResult {
	complete: boolean;
	feedback: string;
	raw: string;
	systemError?: boolean;
	infraFeedback?: string;
	elapsedMs?: number;
	models?: {
		label: string;
		status: "passed" | "failed" | "error";
		summary?: string;
		thinking?: string;
	}[];
}

export type GoalAuditRunResult =
	| { kind: "result"; audit: GoalAuditResult }
	| { kind: "config_error"; message: string }
	| { kind: "checkpoint_deferred" };

type GoalAuditModelResult = ReviewerResult<GoalAuditResult>;

const AUDIT_ATTEMPTS = 3;

interface GoalAuditOptions {
	round: number;
	signal?: AbortSignal;
	active?: ActiveCheckRun | null;
	onProgress?: (progress: ReviewerProgress[]) => void;
	onCheckRun?: (
		active: ActiveCheckRun,
		expectedGeneration: string | null,
	) => ReviewCheckpointResult | Promise<ReviewCheckpointResult>;
	onStart?: (models: ReviewerConfig[]) => void | Promise<void>;
}

export async function auditGoalCompletion(
	goal: GoalForAudit,
	summary: string,
	ctx: AuditContext,
	options: GoalAuditOptions,
): Promise<GoalAuditRunResult> {
	let flowConfig: ReturnType<typeof readFlowConfig>;
	try {
		flowConfig = readFlowConfig();
	} catch (error) {
		return {
			kind: "config_error",
			message: auditCopy(goal.language).configError(formatError(error)),
		};
	}
	if (!flowConfig.acceptance.enabled) {
		const disabled = auditCopy(goal.language).disabled;
		return {
			kind: "result",
			audit: { complete: true, feedback: disabled, raw: `PASS\n${disabled}` },
		};
	}

	const promptResult = buildAuditPrompt(
		goal,
		summary,
		ctx,
		flowConfig.modelRoles.reviewers,
		options.round,
	);
	if (!promptResult.ok)
		return { kind: "config_error", message: promptResult.message };
	const prompt = promptResult.prompt;
	const prior = options.active;
	let active = startCheckRun(
		prior,
		options.round,
		checkInputHash("acceptance", prompt),
		flowConfig.modelRoles.reviewers,
	);
	if (
		(await options.onCheckRun?.(active, prior?.generation ?? null)) ===
		"deferred"
	)
		return { kind: "checkpoint_deferred" };
	await options.onStart?.(flowConfig.modelRoles.reviewers);
	let checkpointDeferred = false;
	const checkpointController = new AbortController();
	const signal = options.signal
		? AbortSignal.any([options.signal, checkpointController.signal])
		: checkpointController.signal;
	const reviewers = flowConfig.modelRoles.reviewers;
	const progressScope = openProgressScope(
		"acceptance",
		acceptanceProgressLabel(options.round, goal.language),
	);
	const progressAgents = reviewers.map((reviewer, index) =>
		progressScope.register(`M${index + 1}`, reviewerLabel(reviewer)),
	);
	for (const [index, model] of active.models.entries())
		if (model.outcome)
			progressScope.finish(`M${index + 1}`, model.outcome.result === "error");
	if (ctx.mode && ctx.ui)
		autoOpenMonitorOverlay(
			{ cwd: ctx.cwd, mode: ctx.mode, ui: ctx.ui },
			progressScope.id,
			goal.language,
		);
	let results: GoalAuditModelResult[];
	try {
		results = await runReviewerPool({
			reviewers,
			run: (reviewer, index, refresh) =>
				runSingleAudit(
					reviewer,
					prompt,
					ctx,
					signal,
					goal.language,
					(event) => {
						const before = progressAgents[index]?.current;
						progressScope.feed(`M${index + 1}`, event);
						if (progressAgents[index]?.current !== before) refresh();
					},
				),
			statusOf: auditStatus,
			summaryOf: auditSummary,
			initialResults: active.models.map((model) =>
				model.outcome
					? auditFromCheckOutcome(model.outcome, goal.language)
					: undefined,
			),
			onSettled: async (settled) => {
				progressScope.finish(
					`M${settled.index + 1}`,
					settled.status === "error",
				);
				if (signal.aborted) return;
				const next = settleCheckModel(
					active,
					active.generation,
					settled.index,
					auditCheckOutcome(settled.result),
				);
				if (!next) {
					checkpointDeferred = true;
					checkpointController.abort();
					return;
				}
				active = next;
				if (
					(await options.onCheckRun?.(active, active.generation)) === "deferred"
				) {
					checkpointDeferred = true;
					checkpointController.abort();
				}
			},
			onUpdate: options.onProgress,
			activityOf: (_reviewer, index) => progressAgents[index]?.current,
		});
	} finally {
		progressScope.close();
	}
	return checkpointDeferred
		? { kind: "checkpoint_deferred" }
		: {
				kind: "result",
				audit: {
					...withAuditModels(
						aggregateAuditResults(results, goal.language),
						results,
					),
					...(active.startedAt
						? { elapsedMs: Date.now() - active.startedAt }
						: {}),
				},
			};
}

async function runSingleAudit(
	reviewer: ReviewerConfig,
	prompt: string,
	ctx: AuditContext,
	signal?: AbortSignal,
	language: Language = "zh",
	onEvent?: (event: unknown) => void,
) {
	let result: GoalAuditResult = incomplete(auditCopy(language).timeout, true);
	for (let attempt = 1; attempt <= AUDIT_ATTEMPTS; attempt += 1) {
		const output = await runPiPrompt(
			reviewer,
			prompt,
			ctx.cwd,
			signal,
			onEvent,
		);
		result = output.ok
			? parseAuditOutput(output.text, language)
			: incomplete(auditFailureText(output.feedback, language), true);
		if (!shouldRetryAudit(result) || attempt === AUDIT_ATTEMPTS) break;
	}
	return annotateAuditAttempts(result, language);
}

function acceptanceProgressLabel(round: number, language: Language) {
	return language === "en"
		? `Acceptance · Round ${round}`
		: `第 ${round} 轮验收`;
}

function buildAuditPrompt(
	goal: GoalForAudit,
	summary: string,
	ctx: AuditContext,
	reviewers: ReviewerConfig[],
	round: number,
): { ok: true; prompt: string } | { ok: false; message: string } {
	const plan = formatPlanEvidence(goal.plan, goal.language);
	const priorRounds = priorRoundsSection(
		goal.priorRounds ?? [],
		round,
		goal.language,
	);
	const separator = goal.language === "en" ? ":" : "：";
	const fixedPrompt = `${readPrompt("goal-audit", goal.language)}

${goal.language === "en" ? "Goal" : "目标"}${separator}
${goal.text}${plan ? `\n\n${plan}` : ""}${goal.planChangeNote ? `\n\n${goal.planChangeNote}` : ""}${priorRounds ? `\n\n${priorRounds}` : ""}

${goal.language === "en" ? "Original execution model completion claim (may be empty; not evidence)" : "原执行模型完成声明（可为空，不作为证据）"}${separator}
${summary || (goal.language === "en" ? "(empty)" : "（空）")}

${goal.language === "en" ? "Context Evidence" : "上下文证据"}${separator}
`;
	const evidence = buildContextEvidence({
		entries: sessionEntriesSince(ctx, goal.sessionAnchorId),
		projection: "review",
		language: goal.language,
		modelReferences: reviewers.map((reviewer) => reviewer.model),
		modelRegistry: ctx.modelRegistry,
		fixedPrompt,
	});
	return evidence.ok
		? { ok: true, prompt: `${fixedPrompt}${evidence.packet.text}\n` }
		: { ok: false, message: evidence.error.message };
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
		result.feedback.startsWith("验收输出格式无效") ||
		result.feedback.startsWith("Acceptance output format invalid")
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
			...(model.thinking ? { thinking: model.thinking } : {}),
		})),
	};
}

function auditCheckOutcome(result: GoalAuditResult): CheckModelOutcome {
	return {
		result: auditStatus(result) as CheckModelOutcome["result"],
		summary: auditSummary(result) ?? "",
		details: result.systemError ? result.feedback : result.raw,
	};
}

function auditFromCheckOutcome(
	outcome: CheckModelOutcome,
	language: Language,
): GoalAuditResult {
	return outcome.result === "error"
		? incomplete(outcome.details, true)
		: parseAuditOutput(outcome.details, language);
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
		result.feedback.startsWith("验收超时") ||
		result.feedback.startsWith("Acceptance timed out") ||
		result.feedback.startsWith("验收启动失败") ||
		result.feedback.startsWith("Acceptance failed to start") ||
		result.feedback.startsWith("验收失败") ||
		result.feedback.startsWith("Acceptance failed")
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
	if (verdict === "PASS") {
		const issue = passOutputIssue(feedback);
		if (issue)
			return incomplete(
				auditCopy(language).missingEvidence(issue, text.slice(0, 2000)),
				true,
			);
		return { complete: true, feedback, raw: text };
	}
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
		if (feedback === "子进程超时。") return "Acceptance timed out.";
		if (feedback === "子进程已取消。") return "Acceptance cancelled.";
		if (feedback === "子进程输出为空。")
			return "Acceptance subprocess returned no assistant output.";
		if (feedback.startsWith("子进程启动失败："))
			return feedback.replace(
				"子进程启动失败：",
				"Acceptance failed to start: ",
			);
		if (feedback.startsWith("子进程失败，"))
			return feedback.replace("子进程失败，", "Acceptance failed, ");
		return feedback;
	}
	if (feedback === "子进程超时。") return "验收超时。";
	if (feedback === "子进程已取消。") return "验收已取消。";
	if (feedback === "子进程输出为空。") return "验收子进程未返回结论。";
	if (feedback.startsWith("子进程启动失败："))
		return feedback.replace("子进程", "验收");
	if (feedback.startsWith("子进程失败，"))
		return feedback.replace("子进程失败，", "验收失败，");
	return feedback;
}

function auditCopy(language: Language) {
	return language === "en"
		? {
				configError: (error: string) =>
					`Acceptance config read failed: ${error}`,
				disabled: "Acceptance is disabled.",
				timeout: "Acceptance timed out.",
				systemError: "System error",
				passed: "Acceptance passed.",
				failed: "Acceptance judged the goal incomplete.",
				invalidFormatIgnored: "Invalid format (ignored this model result)",
				invalidFormat: (text: string) =>
					`Acceptance output format invalid. Raw output: ${text}`,
				missingEvidence: (issue: PassOutputIssue, text: string) =>
					`Acceptance output format invalid. ${PASS_ISSUE_EN[issue]} Raw output: ${text}`,
			}
		: {
				configError: (error: string) => `验收配置读取失败：${error}`,
				disabled: "验收已禁用。",
				timeout: "验收超时。",
				systemError: "系统错误",
				passed: "验收通过。",
				failed: "验收判定未通过。",
				invalidFormatIgnored: "格式无效（已忽略该模型结论）",
				invalidFormat: (text: string) => `验收输出格式无效。原始输出：${text}`,
				missingEvidence: (issue: PassOutputIssue, text: string) =>
					`验收输出格式无效。${PASS_ISSUE_ZH[issue]}原始输出：${text}`,
			};
}

const PASS_ISSUE_ZH: Record<PassOutputIssue, string> = {
	missing_line: "PASS 缺少证据锚点行（证据：文件=…；命令=…）。",
	missing_summary: "PASS 缺少摘要行（证据行前必须有一行极简摘要）。",
	missing_file_anchor: "PASS 证据行缺少文件段（文件=至少一个带扩展名的路径）。",
	missing_command_anchor: "PASS 证据行缺少命令段（命令=实际运行的命令）。",
};

const PASS_ISSUE_EN: Record<PassOutputIssue, string> = {
	missing_line:
		"PASS is missing the evidence anchor line (Evidence: files=...; commands=...).",
	missing_summary:
		"PASS is missing the summary line (one terse summary line must precede the evidence line).",
	missing_file_anchor:
		"The PASS evidence line has no files segment (files=at least one path with an extension).",
	missing_command_anchor:
		"The PASS evidence line has no commands segment (commands=commands actually run).",
};

function incomplete(feedback: string, systemError = false): GoalAuditResult {
	return { complete: false, feedback, raw: `FAIL\n${feedback}`, systemError };
}
