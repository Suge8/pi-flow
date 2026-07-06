import type { ActiveGoal } from "./runtime.js";

export interface GoalTodoPromptContext {
	planPath?: string;
	recordSection?: "Outcome" | "Handoff";
	stateFile?: "flow.json" | "state.json";
}

export function buildGoalPrompt(
	goal: ActiveGoal,
	context?: GoalTodoPromptContext,
): string {
	const todoContext = todoPromptContext(goal, context);
	if (goal.language === "en") {
		const budgetLine =
			goal.tokenBudget === undefined
				? ""
				: `\nToken budget: ${formatTokenCount(goal.tokenBudget)}.`;
		return `Flow step mode is active. Complete this step fully:\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}${budgetLine}\n\n${goalInstructionReminder(todoContext, goal.language)}`;
	}
	const budgetLine =
		goal.tokenBudget === undefined
			? ""
			: `\n令牌预算：${formatTokenCount(goal.tokenBudget)}。`;
	return `Flow 步骤模式已激活。完整完成这个步骤：\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}${budgetLine}\n\n${goalInstructionReminder(todoContext, goal.language)}`;
}

export function buildResumePrompt(
	goal: ActiveGoal,
	context?: GoalTodoPromptContext,
): string {
	const todoContext = todoPromptContext(goal, context);
	if (goal.language === "en") {
		const budgetLine =
			goal.tokenBudget === undefined
				? ""
				: `\nToken budget: used ${formatBudget(goal)}.`;
		return `The user explicitly resumed the paused Flow step. Continue working toward this step:\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}${budgetLine}\n\n${readPlanBeforeContinuing(todoContext, goal.language)}`;
	}
	const budgetLine =
		goal.tokenBudget === undefined
			? ""
			: `\n令牌预算：已使用 ${formatBudget(goal)}。`;
	return `用户明确恢复了已暂停的 Flow 步骤。继续朝这个步骤工作：\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}${budgetLine}\n\n${readPlanBeforeContinuing(todoContext, goal.language)}`;
}

export function buildGoalSystemPrompt(
	goal: ActiveGoal,
	context?: GoalTodoPromptContext,
): string {
	const todoContext = todoPromptContext(goal, context);
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
): string {
	const todoContext = todoPromptContext(goal, context);
	if (goal.language === "en")
		return `Continue the active Flow step until it is complete:\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}\n\nThis is automatic continuation #${goal.iteration}. Current files, command output, tests, and external state are authoritative; re-check them as needed. ${readPlanBeforeContinuing(todoContext, goal.language)}\n\n${continuationMarkerComment(marker)}`;
	return `继续活动的 Flow 步骤，直到它完成：\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}\n\n这是自动延续 #${goal.iteration}。当前文件、命令输出、测试和外部状态是权威；按需重新检查它们。${readPlanBeforeContinuing(todoContext, goal.language)}\n\n${continuationMarkerComment(marker)}`;
}

export function goalObjectiveBlock(goal: Pick<ActiveGoal, "text">): string {
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

function goalInstructionReminder(
	context: Required<GoalTodoPromptContext>,
	language: ActiveGoal["language"],
): string {
	if (language === "en")
		return `Use ${context.planPath} as the live plan markdown and follow the Flow step rules injected in the system prompt for progress updates, Verification, ${context.recordSection}, and completion. Do not handwrite or modify ${context.stateFile}.`;
	return `以 ${context.planPath} 作为实时计划 markdown；进度更新、Verification、${context.recordSection} 和完成判断遵循 system prompt 注入的 Flow 步骤规则。不要手写或修改 ${context.stateFile}。`;
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
- Persist through recoverable tool failures by trying reasonable alternatives instead of yielding early.
- If the step is not done when a turn ends, expect automatic completion acceptance or automatic continuation.
- End the turn naturally after completion; the Goal will automatically enter completion acceptance.`;
	return `- 持续推进，直到${goalLabel}端到端地完全解决。
- ${goalLabel}跨回合持久存在。结束本回合并不要求把步骤缩小成现在能放得下的内容。
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
- 通过尝试合理替代方案来坚持处理可恢复的工具失败，而不是过早让步。
- 如果步骤在一个回合结束时还没有完成，预期会有自动完成验收或自动延续。
- 完成后自然结束本回合；系统会自动进入完成验收。`;
}

function todoPromptContext(
	goal: ActiveGoal,
	context: GoalTodoPromptContext = {},
): Required<GoalTodoPromptContext> {
	return {
		planPath:
			context.planPath ??
			(goal.artifactDir ? `${goal.artifactDir}/plan.md` : "plan.md"),
		recordSection:
			context.recordSection ?? (goal.artifactDir ? "Handoff" : "Outcome"),
		stateFile:
			context.stateFile ?? (goal.artifactDir ? "state.json" : "flow.json"),
	};
}

function todoRule(
	context: Required<GoalTodoPromptContext>,
	language: ActiveGoal["language"],
) {
	if (language === "en")
		return `The current plan markdown is your persistent Todo, working memory, and live HTML progress source. If the current hidden startup message includes a full current Goal plan snapshot marked as the initial plan state, use that snapshot as the initial read for the first item; otherwise read ${context.planPath} before starting work. Execute the first incomplete checkbox item. Immediately before starting an item, change its checkbox from [ ] to [~]; after real work is complete and evidence is available, immediately change [~] to [x]; never batch checkbox updates at the end. After each checkbox update and before switching to the next item, re-read or inspect ${context.planPath}. When blocked, mark [!], and in ${context.recordSection} explain the reason, attempted actions, why it is skipped for now, and the recovery path; after recording, you may move to the next incomplete item.`;
	return `当前计划 markdown 是你的持久 Todo、工作记忆和 HTML 实时进度来源。若当前隐藏启动消息已包含标为初始计划状态的完整计划 snapshot，可将该 snapshot 视为首个 item 的初始读取；否则开始工作前必须读取 ${context.planPath}。按第一个未完成 checkbox 执行。开始某项前立刻把该 checkbox 从 [ ] 改为 [~]；完成真实工作并拿到证据后，必须立刻从 [~] 改为 [x]，禁止最终集中补账。每次更新 checkbox 后、切换下一项前必须重新读取或检查 ${context.planPath}。阻塞时改为 [!]，并在 ${context.recordSection} 说明原因、已尝试动作、为什么先跳过和恢复路径；记录后可跳到下一个未完成项。`;
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
