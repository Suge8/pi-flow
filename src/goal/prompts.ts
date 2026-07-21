import type { ActiveGoal } from "./runtime.js";

export interface GoalTodoPromptContext {
	planPath?: string;
	recordSection?: "Outcome" | "Handoff";
	stateFile?: string;
}

/**
 * 编排上下文声明（入口纠偏层）：只在模型最容易误判「用户在场」的恢复入口注入；
 * 行为规则的权威完整版在步骤 system prompt，不在其他注入面重复。
 */
export function orchestrationContextLine(language: ActiveGoal["language"]) {
	return language === "en"
		? "The user resumed this step and has stepped away; what follows is the automated flow again and the user will not answer questions by default. When something only the user can do blocks you, follow the BLOCKED protocol and stop."
		: "用户恢复此步骤后已离场，接下来仍是自动化流程，用户默认不会回答提问；需要用户操作时按 BLOCKED 协议停下。";
}

export function buildResumePrompt(
	goal: ActiveGoal,
	context?: GoalTodoPromptContext,
	advisorDirection?: string,
	options?: { repair?: boolean },
): string {
	const direction = advisorDirection
		? `${manualAdvisorDirection(advisorDirection, goal.language)}\n\n`
		: "";
	// repair cursor 恢复：上下文仍在，只发触发词；有待投顾问建议时保留前置。
	if (options?.repair)
		return `${direction}${goal.language === "en" ? "Continue." : "继续"}`;
	const todoContext = todoPromptContext(context);
	if (goal.language === "en") {
		const budgetLine =
			goal.tokenBudget === undefined
				? ""
				: `\nToken budget: used ${formatBudget(goal)}.`;
		return `${direction}${orchestrationContextLine("en")} Continue working toward this step:\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}${budgetLine}\n\n${readPlanBeforeContinuing(todoContext, goal.language)}`;
	}
	const budgetLine =
		goal.tokenBudget === undefined
			? ""
			: `\n令牌预算：已使用 ${formatBudget(goal)}。`;
	return `${direction}${orchestrationContextLine("zh")}继续朝这个步骤工作：\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}${budgetLine}\n\n${readPlanBeforeContinuing(todoContext, goal.language)}`;
}

export function manualAdvisorDirection(
	advice: string,
	language: ActiveGoal["language"],
) {
	return language === "en"
		? `Advisor advice requested by the user (verify it as a hypothesis):\n${advice}`
		: `用户手动咨询的顾问建议（视为待核实假设）：\n${advice}`;
}

export function buildGoalSystemPrompt(
	goal: ActiveGoal,
	context?: GoalTodoPromptContext,
): string {
	const todoContext = todoPromptContext(context);
	if (goal.language === "en") {
		const budgetLine =
			goal.tokenBudget === undefined
				? ""
				: `\n- Respect the goal token budget (used ${formatBudget(goal)}).`;
		return `Active Flow step:\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}\n\nFlow step rules:\n${goalSystemRules("this step", todoContext, goal.language)}${budgetLine}`;
	}
	const budgetLine =
		goal.tokenBudget === undefined
			? ""
			: `\n- 尊重目标令牌预算（已使用 ${formatBudget(goal)}）。`;
	return `活动的 Flow 步骤：\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}\n\nFlow 步骤规则：\n${goalSystemRules("这个步骤", todoContext, goal.language)}${budgetLine}`;
}

export function buildContinuePrompt(
	goal: ActiveGoal,
	marker: string,
	context?: GoalTodoPromptContext,
	reminder?: string,
): string {
	const todoContext = todoPromptContext(context);
	const reminderHead = reminder ? `${reminder}\n\n` : "";
	if (goal.language === "en")
		return `${reminderHead}Continue the active Flow step (objective and rules are in the system prompt) until it is complete.${goalPlanLine(todoContext, goal.language)}\n\nThis is automatic continuation #${goal.iteration}. Current files, command output, tests, and external state are authoritative; re-check them as needed. ${readPlanBeforeContinuing(todoContext, goal.language)}\n\n${continuationMarkerComment(marker)}`;
	return `${reminderHead}继续活动的 Flow 步骤（目标与规则见 system prompt），直到它完成。${goalPlanLine(todoContext, goal.language)}\n\n这是自动延续 #${goal.iteration}。当前文件、命令输出、测试和外部状态是权威；按需重新检查它们。${readPlanBeforeContinuing(todoContext, goal.language)}\n\n${continuationMarkerComment(marker)}`;
}

function goalObjectiveBlock(goal: Pick<ActiveGoal, "text">): string {
	return `<目标>\n${escapeXmlTextContent(goal.text)}\n</目标>`;
}

function goalPlanLine(
	context: Required<GoalTodoPromptContext>,
	language: ActiveGoal["language"],
) {
	if (!context.planPath) return "";
	return language === "en"
		? `\nCurrent plan markdown: ${context.planPath}`
		: `\n当前计划 markdown：${context.planPath}`;
}

function readPlanBeforeContinuing(
	context: Required<GoalTodoPromptContext>,
	language: ActiveGoal["language"],
): string {
	if (language === "en")
		return `Before doing work, read ${context.planPath} and continue from the first incomplete item; do not rely on older snapshots. Follow the Flow step rules injected in the system prompt for progress updates, Verification, ${context.recordSection}, and completion. Do not handwrite or modify ${context.stateFile}.`;
	return `继续前必须读取 ${context.planPath}，再从第一个未完成项继续；不要依赖旧 snapshot。进度更新、Verification、${context.recordSection} 和完成判断遵循 system prompt 注入的 Flow 步骤规则。不要手写或修改 ${context.stateFile}。`;
}

function goalSystemRules(
	goalLabel: string,
	context: Required<GoalTodoPromptContext>,
	language: ActiveGoal["language"],
): string {
	if (language === "en")
		return `- Keep going until ${goalLabel} is fully solved end to end.
- ${goalLabel} persists across turns. Ending this turn does not require shrinking the step to what fits now.
- This is an orchestrated session: automatic continuation prompts and check feedback are injected by the orchestration system, not written by the user. The user may step in at any time but by default will not answer questions; do not ask the user or wait for confirmation. When blocked, follow the [!] rule and keep going; only when the blocker can solely be cleared by the user in person (manual on-device action, system permission toggles, external accounts), output a single final line \`BLOCKED: <what the user must do>\` and stop — never for approval, preference, or risk confirmation.
- Keep the full step unchanged. If it cannot be completed now, make concrete progress toward the real requested final state, keep the step active, and do not redefine success around a smaller or easier task.
- Treat the current worktree, command output, tests, and external state as authoritative.
- Do not redefine ${goalLabel} as a smaller task; review every requirement before completion.
- Do not stop at analysis, planning, TODO lists, partial fixes, or suggested next steps.
- When available tools are needed, implement and verify autonomously.
- ${todoRule(context, language)}
- You may update only Steps, Verification, Notes, and ${context.recordSection} in the current plan markdown. For Steps, only split oversized incomplete items, add necessary subtasks, or merge duplicate items; do not modify Objective / Scope / Success Criteria; record maintenance reasons in ${context.recordSection}.
- Run Verification before completion and keep Steps/Verification status consistent with real execution results.
- If a verification command fails, do not claim completion unless you prove the verification itself is invalid and provide alternative evidence.
- If Success Criteria is clearly wrong, do not pause and do not edit the criteria; continue toward the real user goal and record the criteria deviation in ${context.recordSection}.
- Before completion, write or update the current step ${context.recordSection}.
- Do not handwrite or modify ${context.stateFile}; runtime and check state are maintained by the extension.
- If the same finding still fails after two consecutive same-direction fix attempts, stop that direction, enumerate 3-5 alternative approaches, and implement the best one; do not keep micro-adjusting the original direction.
- Persist through recoverable tool failures by trying reasonable alternatives instead of yielding early.
- If the step is not done when a turn ends, expect automatic acceptance or automatic continuation.
- End the turn naturally after completion; the Goal will automatically enter acceptance.`;
	return `- 持续推进，直到${goalLabel}端到端地完全解决。
- ${goalLabel}跨回合持久存在。结束本回合并不要求把步骤缩小成现在能放得下的内容。
- 这是自动化编排会话：自动延续提示与检查反馈由编排系统注入，不是用户发言。用户可随时介入，但默认不会回答提问；不要向用户提问或等待确认，阻塞时按 [!] 规则记录并继续；仅当阻塞只能由用户亲手解除（真机人工操作、系统权限开关、外部账号）时，在回复末尾单独一行输出 \`BLOCKED: <需要用户做的事>\` 然后停止——不适用于方案批准、偏好确认或风险告知。
- 保持完整步骤不变。如果现在无法完成，就朝真实请求的最终状态取得具体进展，让步骤保持活动状态，并且不要围绕更小或更容易的任务重新定义成功。
- 将当前工作树、命令输出、测试和外部状态视为权威。
- 不要把${goalLabel}重新定义成更小的任务；完成前要审查每一个要求。
- 不要停在分析、计划、TODO 列表、部分修复或建议的下一步。
- 当完成步骤需要可用工具时，自主执行实现和验证。
- ${todoRule(context, language)}
- 当前计划 markdown 只允许更新 Steps、Verification、Notes 和 ${context.recordSection}；Steps 只允许拆分过大的未完成项、补充必要子任务或合并重复项；不得修改 Objective / Scope / Success Criteria；维护原因写入 ${context.recordSection}。
- 完成前必须按 Verification 跑验证，并让 Steps/Verification 状态与真实执行结果一致。
- 如果验证命令失败，不能声称完成，除非证明验证本身无效并提供替代验证证据。
- 如果发现 Success Criteria 明显不对，不要暂停，不要改标准；继续朝真实用户目标推进，并在 ${context.recordSection} 记录 criteria deviation。
- 完成前必须写或更新当前步骤的 ${context.recordSection}。
- 不要手写或修改 ${context.stateFile}；运行状态和检查状态由插件维护。
- 同一发现连续两轮同向修复仍未通过时，立即停止原方向，穷举 3–5 个替代方案并择优实施，禁止在原方向继续微调。
- 通过尝试合理替代方案来坚持处理可恢复的工具失败，而不是过早让步。
- 如果步骤在一个回合结束时还没有完成，预期会有自动验收或自动延续。
- 完成后自然结束本回合；系统会自动进入验收。`;
}

function todoPromptContext(
	context: GoalTodoPromptContext = {},
): Required<GoalTodoPromptContext> {
	return {
		planPath: context.planPath ?? "plan.md",
		recordSection: context.recordSection ?? "Outcome",
		stateFile: context.stateFile ?? "flow.json",
	};
}

function todoRule(
	context: Required<GoalTodoPromptContext>,
	language: ActiveGoal["language"],
) {
	if (language === "en")
		return `The current plan markdown is your persistent Todo, working memory, and live HTML progress source. If the current hidden startup message includes a full current Goal plan snapshot marked as the initial plan state, use that snapshot as the initial read for the first item; otherwise read ${context.planPath} before starting work. Execute the first incomplete checkbox item. Immediately before starting an item, change its checkbox from [ ] to [~]; after real work is complete and evidence is available, immediately change [~] to [x]; never batch checkbox updates at the end. Update each checkbox with a single-line precise edit of that item; do not rewrite the whole file. When blocked, mark [!], and in ${context.recordSection} explain the reason, attempted actions, why it is skipped for now, and the recovery path; after recording, you may move to the next incomplete item.`;
	return `当前计划 markdown 是你的持久 Todo、工作记忆和 HTML 实时进度来源。若当前隐藏启动消息已包含标为初始计划状态的完整计划 snapshot，可将该 snapshot 视为首个 item 的初始读取；否则开始工作前必须读取 ${context.planPath}。按第一个未完成 checkbox 执行。开始某项前立刻把该 checkbox 从 [ ] 改为 [~]；完成真实工作并拿到证据后，必须立刻从 [~] 改为 [x]，禁止最终集中补账。勾选用针对该项的单行精确编辑，不要重写整个文件。阻塞时改为 [!]，并在 ${context.recordSection} 说明原因、已尝试动作、为什么先跳过和恢复路径；记录后可跳到下一个未完成项。`;
}

function continuationMarkerComment(marker: string): string {
	return `<!-- pi-goal-continuation:${marker} -->`;
}

function formatBudget(goal: ActiveGoal): string {
	return `${formatTokenCount(goal.tokensUsed)}/${formatTokenCount(goal.tokenBudget ?? 0)}`;
}

function formatTokenCount(value: number): string {
	if (value < 1_000) return `${value}`;
	if (value < 1_000_000)
		return `${Number.isInteger(value / 1_000) ? value / 1_000 : (value / 1_000).toFixed(1)}k`;
	return `${Number.isInteger(value / 1_000_000) ? value / 1_000_000 : (value / 1_000_000).toFixed(1)}m`;
}

function escapeXmlTextContent(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
