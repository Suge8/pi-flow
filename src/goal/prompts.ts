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
		return `Flow step mode is active. Complete this step fully:\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}${budgetLine}\n\n${goalPersistenceRules("this step", todoContext, goal.language)}`;
	}
	const budgetLine =
		goal.tokenBudget === undefined
			? ""
			: `\n令牌预算：${formatTokenCount(goal.tokenBudget)}。`;
	return `Flow 步骤模式已激活。完整完成这个步骤：\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}${budgetLine}\n\n${goalPersistenceRules("这个步骤", todoContext, goal.language)}`;
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
		return `The user explicitly resumed the paused Flow step. Continue working toward this step:\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}${budgetLine}\n\n${goalPersistenceRules("this step", todoContext, goal.language)}`;
	}
	const budgetLine =
		goal.tokenBudget === undefined
			? ""
			: `\n令牌预算：已使用 ${formatBudget(goal)}。`;
	return `用户明确恢复了已暂停的 Flow 步骤。继续朝这个步骤工作：\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}${budgetLine}\n\n${goalPersistenceRules("这个步骤", todoContext, goal.language)}`;
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
		return `Active Flow step:\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}\n\nFlow step rules:\n- Keep going until the active step is fully solved end to end.\n- This step persists across turns. Ending this turn does not require shrinking the step to what fits now.\n- Keep the full step unchanged. If it cannot be completed now, make concrete progress toward the real requested final state, keep the step active, and do not redefine success around a smaller or easier task.\n- Treat the current worktree, command output, tests, and external state as authoritative.\n- Do not redefine the step as a smaller task; review every requirement before completion.\n- Do not stop at analysis, planning, TODO lists, partial fixes, or suggested next steps.\n- When available tools are needed, implement and verify autonomously.\n- ${todoRule(todoContext, goal.language)}\n- Do not handwrite or modify ${todoContext.stateFile}; runtime and check state are maintained by the extension.\n- Persist through recoverable tool failures by trying reasonable alternatives instead of yielding early.\n- If the step is not done when a turn ends, expect automatic completion acceptance or automatic continuation.${budgetLine}`;
	}
	const budgetLine =
		goal.tokenBudget === undefined
			? ""
			: `\n- 尊重目标令牌预算（已使用 ${formatBudget(goal)}）。`;
	return `活动的 Flow 步骤：\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}\n\nFlow 步骤规则：\n- 持续推进，直到活动步骤端到端地完全解决。\n- 这个步骤跨回合持久存在。结束本回合并不要求把步骤缩小成现在能放得下的内容。\n- 保持完整步骤不变。如果现在无法完成，就朝真实请求的最终状态取得具体进展，让步骤保持活动状态，并且不要围绕更小或更容易的任务重新定义成功。\n- 将当前工作树、命令输出、测试和外部状态视为权威。\n- 不要把步骤重新定义成更小的任务；完成前要审查每一个要求。\n- 不要停在分析、计划、TODO 列表、部分修复或建议的下一步。\n- 当完成步骤需要可用工具时，自主执行实现和验证。\n- ${todoRule(todoContext, goal.language)}\n- 不要手写或修改 ${todoContext.stateFile}；运行状态和检查状态由插件维护。\n- 通过尝试合理替代方案来坚持处理可恢复的工具失败，而不是过早让步。\n- 如果步骤在一个回合结束时还没有完成，预期会有自动完成验收或自动延续。${budgetLine}`;
}

export function buildContinuePrompt(
	goal: ActiveGoal,
	marker: string,
	context?: GoalTodoPromptContext,
): string {
	const todoContext = todoPromptContext(goal, context);
	if (goal.language === "en")
		return `Continue the active Flow step until it is complete:\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}\n\nThis is automatic continuation #${goal.iteration}. Current files, command output, tests, and external state are authoritative; re-check them as needed.${goalPersistenceRules("this step", todoContext, goal.language)}\n\n${continuationMarkerComment(marker)}`;
	return `继续活动的 Flow 步骤，直到它完成：\n\n${goalObjectiveBlock(goal)}${goalPlanLine(todoContext, goal.language)}\n\n这是自动延续 #${goal.iteration}。当前文件、命令输出、测试和外部状态是权威；按需重新检查它们。${goalPersistenceRules("这个步骤", todoContext, goal.language)}\n\n${continuationMarkerComment(marker)}`;
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

function goalPersistenceRules(
	goalLabel: string,
	context: Required<GoalTodoPromptContext>,
	language: ActiveGoal["language"],
): string {
	if (language === "en")
		return `Keep going until ${goalLabel} is fully solved end to end. ${goalLabel} persists across turns. Ending this turn does not require shrinking the goal to what fits now. Keep the full goal unchanged. If it cannot be completed now, make concrete progress toward the real requested final state, keep the goal active, and do not redefine success around a smaller or easier task. Do not redefine ${goalLabel} as a smaller task. Do not stop at analysis, planning, TODO lists, partial fixes, or suggested next steps. When available tools are needed, implement and verify autonomously. Treat the current worktree, command output, tests, and external state as authoritative. ${todoRule(context, language)} Do not handwrite or modify ${context.stateFile}; runtime and check state are maintained by the extension. If tool calls fail, try reasonable alternatives instead of yielding early.`;
	return `持续推进，直到${goalLabel}端到端地完全解决。${goalLabel}跨回合持久存在。结束本回合并不要求把目标缩小成现在能放得下的内容。保持完整目标不变。如果现在无法完成，就朝真实请求的最终状态取得具体进展，让目标保持活动状态，并且不要围绕更小或更容易的任务重新定义成功。不要把${goalLabel}重新定义成更小的任务。不要停在分析、计划、TODO 列表、部分修复或建议的下一步。当需要可用工具时，自主执行实现和验证。将当前工作树、命令输出、测试和外部状态视为权威。${todoRule(context, language)}不要手写或修改 ${context.stateFile}；运行状态和检查状态由插件维护。如果工具调用失败，尝试合理的替代方案，而不是过早让步。`;
}

function todoPromptContext(
	goal: ActiveGoal,
	context: GoalTodoPromptContext = {},
): Required<GoalTodoPromptContext> {
	return {
		planPath:
			context.planPath ??
			(goal.artifactDir ? `${goal.artifactDir}/plan.md` : "plan.md"),
		recordSection: context.recordSection ?? "Outcome",
		stateFile:
			context.stateFile ?? (goal.artifactDir ? "state.json" : "flow.json"),
	};
}

function todoRule(
	context: Required<GoalTodoPromptContext>,
	language: ActiveGoal["language"],
) {
	if (language === "en")
		return `The current plan markdown is your persistent Todo, working memory, and live HTML progress source; before starting, read ${context.planPath} and execute the first incomplete item. Immediately before starting an item, change its checkbox from [ ] to [~]; after real work is complete and evidence is available, immediately change [~] to [x]; never batch checkbox updates at the end. After each checkbox update and before switching to the next item, re-read or inspect ${context.planPath}. When blocked, mark [!], and in ${context.recordSection} explain the reason, attempted actions, why it is skipped for now, and the recovery path; after recording, you may move to the next incomplete item. During execution, you may only maintain Steps: split oversized incomplete items, add necessary subtasks, or merge duplicates; do not modify Objective / Scope / Success Criteria; record maintenance reasons in ${context.recordSection}. Steps/Verification status must match real execution results.`;
	return `当前计划 markdown 是你的持久 Todo、工作记忆和 HTML 实时进度来源；开始前必须读取 ${context.planPath}，按第一个未完成项执行。开始某项前立刻把该 checkbox 从 [ ] 改为 [~]；完成真实工作并拿到证据后，必须立刻从 [~] 改为 [x]，禁止最终集中补账；每次更新 checkbox 后、切换下一项前必须重新读取或检查 ${context.planPath}。阻塞时改为 [!]，并在 ${context.recordSection} 说明原因、已尝试动作、为什么先跳过和恢复路径；记录后可跳到下一个未完成项。执行中只允许维护 Steps：拆分过大的未完成项、补充必要子任务、合并重复项；不得修改 Objective / Scope / Success Criteria；维护原因写入 ${context.recordSection}。Steps/Verification 状态必须与真实执行结果一致。`;
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
