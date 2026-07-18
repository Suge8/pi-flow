import type { Language } from "./config.js";

/**
 * 检查反馈处理指令的单一事实源：
 * 验收失败反馈（goal runtime 注入）与质检失败反馈（review 循环注入）共用「假设待核实」骨架。
 */

export const APPLY_INSTRUCTION =
	"将质检反馈视为待核实假设，而非事实；先基于当前文件、测试/检查输出和会话约束核实。反馈属实时，逐条修复全部属实发现，修根因而非表象，同一根因的其他出现点一并修复，修完端到端验证问题已彻底解决再结束，避免无关重构、抽象、依赖或风格改动；反馈不成立时，不应用该反馈，并说明依据（文件、命令输出或约束）。";
export const APPLY_INSTRUCTION_EN =
	"Treat the quality-check feedback as hypotheses to verify, not facts. Verify it against current files, test/check output, and conversation constraints. When feedback is valid, fix every valid finding at the root cause rather than the symptom, fix other occurrences of the same root cause, and verify end to end that the problems are fully resolved before finishing; avoid unrelated refactors, abstractions, dependencies, or style changes. When feedback is invalid, do not apply it and state the basis (file, command output, or constraint).";

export function applyInstruction(language: Language = "zh") {
	return language === "en" ? APPLY_INSTRUCTION_EN : APPLY_INSTRUCTION;
}

export function reviewFeedbackInstruction(
	language: Language = "zh",
	goalScoped = false,
) {
	const base = applyInstruction(language);
	if (!goalScoped) return `${base} ${checkFeedbackDiscipline(language)}`;
	return language === "en"
		? `${base} After handling the feedback, continue completing the original Goal; do not only handle the review feedback. ${checkFeedbackDiscipline(language)}`
		: `${base} 处理完反馈后继续完成原目标；不要只处理检查反馈。 ${checkFeedbackDiscipline(language)}`;
}

/** 顾问建议段：仅进入送给执行模型的修复 prompt。 */
export function advisorDirectionLines(
	advice: string,
	language: Language,
): string[] {
	return [language === "en" ? "Advisor advice:" : "顾问建议：", advice];
}

export function advisorConsultingLine(failures: number, language: Language) {
	return language === "en"
		? `🧭 ${failures} consecutive failed rounds · Consulting advisor`
		: `🧭 连续 ${failures} 轮未通过 · 正在咨询顾问`;
}

export function acceptanceFeedbackInstruction(language: Language) {
	const base =
		language === "en"
			? "Treat the completion-acceptance feedback as hypotheses to verify, not facts. Verify it against the original goal, current files, and verification output. When feedback is valid, fix the root cause of every valid finding, fill the original-goal gap, and verify end to end against the original goal that it is fully resolved. When feedback is invalid, do not apply it and state the basis (file, command output, or constraint). After handling the feedback, continue completing the original Goal; do not only handle the acceptance feedback."
			: "将验收反馈视为待核实假设，而非事实；先基于原目标、当前文件和验证输出核实。反馈属实时，逐条修复全部属实发现的根因，补齐原目标缺口，修完按原目标端到端验证已彻底解决；反馈不成立时，不应用该反馈，并说明依据（文件、命令输出或约束）。处理完反馈后继续完成原目标；不要只处理验收反馈。";
	return `${base} ${checkFeedbackDiscipline(language)}`;
}

/** BLOCKED 协议标记：回复末尾单独一行，插件据此暂停并请求用户接管。 */
export const BLOCKED_MARKER = "BLOCKED:";

/** 从回复文本提取 BLOCKED 行（取最后一个）；无则 undefined。 */
export function blockedOnUserRequest(
	text: string | undefined,
): string | undefined {
	if (!text) return undefined;
	const lines = text.split(/\r?\n/);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index].trim();
		if (!line) continue;
		if (!line.startsWith(BLOCKED_MARKER)) return undefined;
		const reason = line.slice(BLOCKED_MARKER.length).trim();
		return reason || undefined;
	}
	return undefined;
}

/**
 * 失败反馈公共纪律（recency 补强层）：模式穷举、自主决策、BLOCKED 接管协议。
 * 行为规则的权威完整版在步骤 system prompt，此处只放离模型最近的一段。
 */
export function checkFeedbackDiscipline(language: Language) {
	return language === "en"
		? `Before fixing any finding, search for all instances of the same defect pattern and fix them in one pass; do not only fix the named instance. Decide technical approach, architecture, and tooling yourself and record the decision in Notes/Handoff — checks will gate it; do not ask the user for approval or wait for a reply. Only if a finding can solely be completed by the user in person (manual on-device action, system permission toggles, external accounts), do not automate around it or keep retrying: output a single final line \`${BLOCKED_MARKER} <what the user must do>\` and stop; this protocol is strictly for physically non-automatable actions and never for approval, preference, or risk confirmation.`
		: `修复任一发现前，先搜索同模式的全部实例一次性修复，不要只修被点名的那处。技术方案、架构、工具选型由你自主决策并在 Notes/Handoff 留档，检查会把关；不要向用户征求批准或等待回复。仅当某发现只能由用户亲手完成（真机人工操作、系统权限开关、外部账号）时，禁止自动化绕过或反复重试：在回复末尾单独一行输出 \`${BLOCKED_MARKER} <需要用户做的事>\` 然后停止；该协议仅限物理上无法自动化的操作，不适用于方案批准、偏好确认或风险告知。`;
}
