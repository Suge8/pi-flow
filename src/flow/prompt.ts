import type { Language } from "../shared/config.js";
import { localizeErrors } from "../shared/error-language.js";
import { appendAlignedRequest } from "../shared/generation-alignment.js";
import { readPrompt } from "../shared/prompts.js";
import { validateDraftCommand } from "../shared/validate-command.js";
import type { FlowGoal, FlowSourceType, FlowState } from "./types.js";

export function generationPrompt(input: {
	originalRequest: string;
	sourceType: FlowSourceType;
	sourcePath?: string;
	alignedRequest?: string;
	language: Language;
}) {
	return appendAlignedRequest(
		readPrompt("flow-plan", input.language)
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
			.replaceAll("{{validateCommand}}", validateDraftCommand())
			.replaceAll("{{language}}", input.language),
		input.alignedRequest,
		input.language,
	);
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

Full current Goal plan snapshot:

${snapshot}

Execution rules:
- Execute only the current Goal.
- Do not edit other Goal files.
- The current Goal file is the persistent Todo, working memory, and live HTML progress source; read the current plan markdown before starting.
- Execute the first incomplete checkbox: before starting an item, immediately change [ ] to [~]; after real work is done and evidence exists, immediately change [~] to [x]; never batch updates at the end.
- After each checkbox update and before switching items, re-read or inspect the current plan markdown.
- When blocked, mark [!] and explain the reason, attempted actions, why it is skipped for now, and the recovery path in Handoff; then you may move to the next incomplete item.
- You may update Steps, Verification, Notes, and Handoff in the current Goal file; only split oversized incomplete items, add necessary subtasks, or merge duplicates, and explain the reason in Handoff.
- Do not modify Objective / Scope / Success Criteria.
- Do not handwrite or modify flow.json; Flow state and check state are maintained by the extension.
- Run Verification and keep Steps/Verification status consistent with real results.
- If a verification command fails: do not claim completion unless you prove the verification itself is invalid and provide alternative evidence.
- If Success Criteria is clearly wrong: do not pause and do not edit the criteria; continue toward the real user goal and record criteria deviation in Handoff.
- Before completion, write/update the current Goal Handoff.
- End the turn naturally after completion; the Goal will automatically enter completion acceptance.
${finalAcceptanceBlock(goal, previous, deviations, flow.language)}`;
	return `Flow Goal session 已启动。

Flow id: ${flow.id}
Goal: ${goal.index + 1}/${flow.goals.length} — ${goal.title}
当前计划 markdown: .flow/${flow.id}/${goal.file}

当前 Goal plan 完整 snapshot：

${snapshot}

执行规则：
- 只执行当前 Goal。
- 不要改其他 Goal 文件。
- 当前 Goal 文件是持久 Todo、工作记忆和 HTML 实时进度来源；开始前必须读取当前计划 markdown。
- 必须按第一个未完成 checkbox 执行：开始某项前立刻从 [ ] 改为 [~]；完成真实工作并拿到证据后，立刻从 [~] 改为 [x]；禁止最终集中补账。
- 每次更新 checkbox 后、切换下一项前必须重新读取或检查当前计划 markdown。
- 阻塞时改为 [!]，并在 Handoff 说明原因、已尝试动作、为什么先跳过和恢复路径；记录后可跳到下一个未完成项。
- 当前 Goal 文件允许更新 Steps、Verification、Notes 和 Handoff；只允许拆分过大的未完成项、补充必要子任务、合并重复项，并在 Handoff 说明原因。
- 不得修改 Objective / Scope / Success Criteria。
- 不要手写或修改 flow.json；Flow 状态和检查状态由插件维护。
- 必须按 Verification 跑验证，并让 Steps/Verification 状态与真实执行结果一致。
- 如果验证命令失败：不能声称完成，除非证明验证本身无效并提供替代验证证据。
- 如果发现 Success Criteria 明显不对：不要暂停，不要改标准；继续朝真实用户目标推进，在 Handoff 记录 criteria deviation。
- 完成前必须写/更新当前 Goal 的 Handoff。
- 完成后自然结束本回合；Goal 会自动进入完成验收。
${finalAcceptanceBlock(goal, previous, deviations, flow.language)}`;
}

function finalAcceptanceBlock(
	goal: FlowGoal,
	previous: string,
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

Previous Handoffs:
${previous || "(none)"}

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

前序 Handoff：
${previous || "（无）"}

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
