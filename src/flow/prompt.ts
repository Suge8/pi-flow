import type { Language } from "../shared/config.js";
import { localizeErrors } from "../shared/error-language.js";
import { readPrompt } from "../shared/prompts.js";
import { validateDraftCommand } from "../shared/validate-command.js";
import type { FlowGoal, FlowSourceType, FlowState } from "./types.js";

export function generationPrompt(input: {
	originalRequest: string;
	sourceType: FlowSourceType;
	sourcePath?: string;
	language: Language;
	flowPath: string;
	restoredAlignmentContext?: { question: string; answer: string }[];
}) {
	return readPrompt("flow-plan", input.language)
		.replace(
			"{{originalRequest}}",
			input.originalRequest || defaultOriginalRequest(input.language),
		)
		.replace(
			"{{source}}",
			input.sourcePath
				? `${input.sourceType}: ${input.sourcePath}`
				: input.sourceType,
		)
		.replace(
			"{{restoredAlignmentContext}}",
			restoredAlignmentContext(
				input.restoredAlignmentContext ?? [],
				input.language,
			),
		)
		.replaceAll("{{validateCommand}}", validateDraftCommand())
		.replaceAll("{{flowPath}}", input.flowPath)
		.replaceAll("{{language}}", input.language);
}

export function repairPrompt(input: {
	errors: string[];
	originalRequest: string;
	flowPath: string;
	language: Language;
}) {
	return readPrompt("flow-repair", input.language)
		.replaceAll(
			"{{errors}}",
			localizeErrors(input.errors, input.language).join("\n") ||
				noValidFlow(input.language),
		)
		.replaceAll(
			"{{originalRequest}}",
			input.originalRequest || none(input.language),
		)
		.replaceAll("{{flowPath}}", input.flowPath)
		.replaceAll("{{validateCommand}}", validateDraftCommand())
		.replaceAll("{{language}}", input.language);
}

function restoredAlignmentContext(
	turns: { question: string; answer: string }[],
	language: Language,
) {
	if (turns.length === 0) return "";
	const lines = turns.flatMap((turn, index) => [
		`Q${index + 1}: ${turn.question}`,
		`A${index + 1}: ${turn.answer}`,
	]);
	if (language === "en")
		return `Restored alignment Q&A (use these decisions only for cross-session recovery; do not copy them verbatim into every Goal):\n${lines.join("\n")}`;
	return `恢复的对齐问答（仅用于跨会话恢复；不要逐字复制进每个 Goal）：\n${lines.join("\n")}`;
}

function defaultOriginalRequest(language: Language) {
	return language === "en"
		? "(no explicit argument; generate from the current conversation context)"
		: "（无显式参数；根据当前会话上下文生成）";
}

function noValidFlow(language: Language) {
	return language === "en" ? "(no valid .flow found)" : "（未找到合格 .flow）";
}

function none(language: Language) {
	return language === "en" ? "(none)" : "（无）";
}

export function planGoalPrompt(
	flow: FlowState,
	goal: FlowGoal,
	snapshot: string,
) {
	const previous = flow.goals
		.filter((item) => item.index < goal.index)
		.map(
			(item) =>
				`Goal ${item.index + 1} ${item.title}\n${item.result.handoff ?? noHandoff(flow.language)}`,
		)
		.join("\n\n");
	const deviations = flow.goals
		.filter((item) => item.result.criteriaChanged)
		.map(
			(item) =>
				`Goal ${item.index + 1} ${item.title}: ${item.result.handoff ?? item.result.summary ?? markedDeviation(flow.language)}`,
		)
		.join("\n\n");
	if (flow.language === "en")
		return `Flow Goal session started.

Flow id: ${flow.id}
Goal: ${goal.index + 1}/${flow.goals.length} — ${goal.title}
Current plan markdown: .flow/${flow.id}/${goal.file}

Full current Goal plan snapshot (initial plan state):

${snapshot}

Previous Handoffs:
${previous || "(none)"}

Current step boundary and state reminder:
- Execute only the current Goal; do not edit other Goal files.
- The snapshot above is the initial plan state for this session and satisfies the startup read. Do not re-read the same markdown solely to restate it before the first progress update.
- After any progress update, the current plan markdown is authoritative.
- Do not modify Objective / Scope / Success Criteria.
- Do not handwrite or modify flow.json; Flow state and check state are maintained by the extension.
- Follow the Flow step rules injected in the system prompt for checkbox progress, Verification, Handoff, and completion.
${finalAcceptanceBlock(goal, deviations, flow.language)}`;
	return `Flow Goal session 已启动。

Flow id: ${flow.id}
Goal: ${goal.index + 1}/${flow.goals.length} — ${goal.title}
当前计划 markdown: .flow/${flow.id}/${goal.file}

当前 Goal plan 完整 snapshot（初始计划状态）：

${snapshot}

前序 Handoff：
${previous || "（无）"}

当前步骤边界与状态提醒：
- 只执行当前 Goal；不要改其他 Goal 文件。
- 上方 snapshot 是本会话的初始计划状态，已满足首轮计划读取；第一次进度更新前不要为了复述同一状态重复读取当前 markdown。
- 任何进度更新后，以当前计划 markdown 为权威。
- 不得修改 Objective / Scope / Success Criteria。
- 不要手写或修改 flow.json；Flow 状态和检查状态由插件维护。
- checkbox 进度、Verification、Handoff 和完成判断遵循 system prompt 注入的 Flow 步骤规则。
${finalAcceptanceBlock(goal, deviations, flow.language)}`;
}

function finalAcceptanceBlock(
	goal: FlowGoal,
	deviations: string,
	language: FlowState["language"],
) {
	if (goal.role !== "final_acceptance") return "";
	if (language === "en")
		return `
Final acceptance Goal responsibilities:
- Read and review all previous Handoffs.
- Review every criteria deviation.
- Run global verification.
- Check whether docs / AGENTS.md updates are needed.
- You may modify product code when acceptance finds a necessary fix.

Criteria deviations:
${deviations || "(none)"}
`;
	return `
Final acceptance Goal 职责：
- 读取并复核所有前序 Handoff。
- 复核所有 criteria deviation。
- 跑全局验证。
- 检查是否需要 docs / AGENTS.md 更新。
- 可修改业务代码，只要是验收发现的必要修复。

Criteria deviation：
${deviations || "（无）"}
`;
}

function noHandoff(language: FlowState["language"]) {
	return language === "en" ? "(no Handoff)" : "（无 Handoff）";
}

function markedDeviation(language: FlowState["language"]) {
	return language === "en" ? "marked deviation" : "已标记 deviation";
}
