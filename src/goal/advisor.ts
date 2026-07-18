import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type AgentProgress,
	openProgressScope,
} from "../shared/agent-progress.js";
import { clipText } from "../shared/clip.js";
import {
	advisorConsultModel,
	type DiagnosticModelConfig,
	type Language,
	readFlowConfig,
} from "../shared/config.js";
import {
	buildContextEvidence,
	type ContextEvidenceRegistry,
} from "../shared/context-evidence.js";
import { formatError } from "../shared/guards.js";
import { autoOpenMonitorOverlay } from "../shared/monitor-overlay.js";
import { runPiPrompt } from "../shared/pi-process.js";
import {
	formatPlanEvidence,
	type PlanEvidence,
} from "../shared/plan-evidence.js";
import { roundLabel } from "../shared/progress-labels.js";
import { readPrompt } from "../shared/prompts.js";
import type { ReviewHistoryEntry } from "../shared/review-history.js";
import { shortModel } from "../shared/reviewer-pool.js";
import { sessionEntriesSince } from "../shared/session.js";
import { formatUserNotice } from "../shared/ui-language.js";
import type { CheckRoundAdvisor } from "./types.js";

export interface AdvisorFailureRound {
	phase: "acceptance" | "quality";
	entry: ReviewHistoryEntry;
}

export interface AdvisorConsultInput {
	goalText: string;
	language: Language;
	plan?: PlanEvidence;
	planChangeNote?: string;
	failureHistory: AdvisorFailureRound[];
	/** 证据锚点：只取锚点之后的会话事实（fork 会话不吃计划期前缀）。 */
	sessionAnchorId?: string;
	ctx: {
		cwd: string;
		mode?: ExtensionContext["mode"];
		ui?: ExtensionContext["ui"];
		sessionManager?: unknown;
		modelRegistry?: ContextEvidenceRegistry;
	};
	signal?: AbortSignal;
	onProgress?: (progress: AgentProgress) => void;
}

export type AdvisorConsultResult =
	| { kind: "advice"; advice: CheckRoundAdvisor }
	| { kind: "aborted" }
	| { kind: "unavailable"; reason: string };

/** 失败咨询开关（advisor.enabled）；配置读取失败时与运行时行为一致，默认开。 */
export function isAdvisorEnabled(): boolean {
	try {
		return readFlowConfig().advisor.enabled;
	} catch {
		return true;
	}
}

/** 咨询顾问模型：spawn 受限诊断子进程；失败不抛出，不阻塞反馈投递。 */
export async function consultAdvisor(
	input: AdvisorConsultInput,
): Promise<AdvisorConsultResult> {
	let advisor: DiagnosticModelConfig;
	try {
		advisor = advisorConsultModel(readFlowConfig());
	} catch (error) {
		return { kind: "unavailable", reason: formatError(error) };
	}
	const promptResult = buildAdvisorPrompt(input, advisor);
	if (!promptResult.ok)
		return { kind: "unavailable", reason: promptResult.message };
	const prompt = promptResult.prompt;
	const progressScope = openProgressScope(
		"advisor",
		advisorProgressLabel(input.language),
	);
	const progress = progressScope.register("A1", shortModel(advisor.model));
	if (input.ctx.mode && input.ctx.ui)
		autoOpenMonitorOverlay(
			{ cwd: input.ctx.cwd, mode: input.ctx.mode, ui: input.ctx.ui },
			progressScope.id,
			input.language,
		);
	let output: Awaited<ReturnType<typeof runPiPrompt>>;
	try {
		output = await runPiPrompt(
			advisor,
			prompt,
			input.ctx.cwd,
			input.signal,
			(event) => {
				const before = progress.current;
				progressScope.feed("A1", event);
				if (progress.current !== before) input.onProgress?.(progress.current);
			},
		);
		progressScope.finish("A1", !output.ok);
	} finally {
		progressScope.close();
	}
	// 取消（暂停/停止）不是失败：静默丢弃，不走 unavailable 通知。
	if (input.signal?.aborted) return { kind: "aborted" };
	if (!output.ok)
		return {
			kind: "unavailable",
			reason: advisorFailureReason(output.feedback, input.language),
		};
	const advice = output.text.trim();
	if (!advice)
		return {
			kind: "unavailable",
			reason:
				input.language === "en" ? "advisor output is empty" : "顾问输出为空",
		};
	return {
		kind: "advice",
		advice: {
			model: advisor.model,
			thinking: advisor.thinking,
			advice,
		},
	};
}

function advisorProgressLabel(language: Language) {
	return language === "en" ? "Advisor consultation" : "顾问咨询";
}

export function advisorUnavailableNotice(reason: string, language: Language) {
	const clipped = clipText(reason, 160);
	return language === "en"
		? formatUserNotice("⚠️", "Advisor consultation failed", [
				clipped,
				"Check feedback was delivered as usual",
			])
		: formatUserNotice("⚠️", "顾问咨询失败", [clipped, "检查反馈已照常投递"]);
}

function buildAdvisorPrompt(
	input: AdvisorConsultInput,
	advisor: DiagnosticModelConfig,
): { ok: true; prompt: string } | { ok: false; message: string } {
	const { language } = input;
	const plan = formatPlanEvidence(input.plan, language);
	const separator = language === "en" ? ":" : "：";
	const fixedPrompt = `${readPrompt("advisor", language)}

${language === "en" ? "Goal" : "目标"}${separator}
${input.goalText}${plan ? `\n\n${plan}` : ""}

${language === "en" ? "Failed check findings by round" : "失败发现历史"}${separator}
${formatFailureHistory(input.failureHistory, language)}${input.planChangeNote ? `\n\n${input.planChangeNote}` : ""}

${language === "en" ? "Context Evidence" : "上下文证据"}${separator}
`;
	const evidence = buildContextEvidence({
		entries: sessionEntriesSince(input.ctx, input.sessionAnchorId),
		projection: "review",
		language,
		modelReferences: [advisor.model],
		modelRegistry: input.ctx.modelRegistry,
		fixedPrompt,
	});
	return evidence.ok
		? { ok: true, prompt: `${fixedPrompt}${evidence.packet.text}\n` }
		: { ok: false, message: evidence.error.message };
}

function formatFailureHistory(
	history: AdvisorFailureRound[],
	language: Language,
) {
	if (history.length === 0) return language === "en" ? "(none)" : "（无）";
	return history
		.map(({ phase, entry }) => {
			const label =
				phase === "acceptance"
					? language === "en"
						? "Acceptance"
						: "验收"
					: language === "en"
						? "Quality check"
						: "质检";
			const body = (entry.details ?? entry.summary).trim();
			return `${roundLabel(entry.round, language)} · ${label}\n${body}`;
		})
		.join("\n\n");
}

function advisorFailureReason(feedback: string, language: Language) {
	const reason = feedback.replace(/[。.]$/u, "");
	if (language !== "en") return reason;
	if (reason.startsWith("子进程超时")) return "advisor subprocess timed out";
	if (reason.startsWith("子进程已取消"))
		return "advisor subprocess was cancelled";
	if (reason.startsWith("子进程启动失败："))
		return reason.replace("子进程启动失败：", "advisor failed to start: ");
	if (reason.startsWith("子进程失败，"))
		return reason
			.replace("子进程失败，", "advisor failed, ")
			.replace("退出码", "exit code");
	if (reason.startsWith("子进程被信号"))
		return reason
			.replace("子进程被信号", "advisor terminated by signal")
			.replace("终止", "");
	return reason;
}
