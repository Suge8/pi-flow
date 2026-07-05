import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	continueActiveGoalIfIdle,
	getGoalState,
	resumePausedGoalFromFlow,
} from "../../goal.js";
import type { Language } from "../../shared/config.js";
import { formatError } from "../../shared/guards.js";
import { runtimeLanguage } from "../../shared/language.js";
import { notifyUser } from "../../shared/ui-language.js";
import { writeFlowHtml } from "../html.js";
import { planSnapshotError } from "../snapshot.js";
import { currentGoal, latestFlow, runningFlow, writeFlow } from "../store.js";
import type { FlowLocation, FlowState } from "../types.js";
import { validateFlowDir } from "../validator.js";

export async function continueCurrentGoal(ctx: ExtensionContext) {
	const goal = getGoalState(ctx);
	if (!goal)
		return notifyUser(
			ctx,
			flowContinueNoGoalMessage(runtimeLanguage()),
			"warning",
			runtimeLanguage(),
		);
	if (goal.status === "paused" || goal.status === "budget_limited") {
		const result = await resumePausedGoalFromFlow(ctx);
		return notifyUser(
			ctx,
			continueResultText(result, goal.language),
			"info",
			goal.language,
		);
	}
	if (goal.status === "active") {
		const result = await continueActiveGoalIfIdle(ctx);
		return notifyUser(
			ctx,
			continueResultText(result, goal.language),
			"info",
			goal.language,
		);
	}
	notifyUser(
		ctx,
		goal.language === "en"
			? `Current step status: ${goalStatusLabel(goal.status, goal.language)}.`
			: `当前步骤状态：${goalStatusLabel(goal.status, goal.language)}。`,
		"info",
		goal.language,
	);
}

export function flowCommandLanguage(ctx: ExtensionContext): Language {
	try {
		return (
			(
				runningFlow(ctx.cwd) ??
				latestFlow(ctx.cwd, (flow) => flow.status !== "cancelled")
			)?.flow.language ?? runtimeLanguage()
		);
	} catch {
		return runtimeLanguage();
	}
}

export function runningFlowOrNotify(ctx: ExtensionContext) {
	let location: FlowLocation | undefined;
	try {
		location = runningFlow(ctx.cwd);
	} catch (error) {
		const language = runtimeLanguage();
		notifyUser(
			ctx,
			language === "en"
				? `flow.json read failed: ${formatError(error)}`
				: `flow.json 读取失败：${formatError(error)}`,
			"error",
			language,
		);
		return null;
	}
	if (!location) return undefined;
	const validation = validateFlowDir(location.dir, location.flow.language);
	if (!validation.ok || !validation.flow) {
		notifyUser(
			ctx,
			location.flow.language === "en"
				? `Flow validation failed:\n${validation.errors.join("\n")}`
				: `Flow 校验失败：\n${validation.errors.join("\n")}`,
			"error",
			location.flow.language,
		);
		return null;
	}
	return { ...location, flow: validation.flow };
}

export function verifyCurrentSnapshot(
	ctx: ExtensionContext,
	dir: string,
	flow: FlowState,
) {
	const plan = currentGoal(flow);
	if (!plan || plan.status !== "running") return flow;
	const error = planSnapshotError(dir, plan, flow.language);
	if (error) {
		const saved = writeFlow(dir, { ...flow, errors: [error] });
		writeFlowHtml(dir, saved);
		notifyUser(ctx, error, "error", flow.language);
		return undefined;
	}
	if (flow.errors.length === 0) return flow;
	const saved = writeFlow(dir, { ...flow, errors: [] });
	writeFlowHtml(dir, saved);
	return saved;
}

export function flowNotFoundMessage(flowId: string, language: Language) {
	return language === "en"
		? `Flow not found: ${flowId}`
		: `未找到 Flow：${flowId}`;
}

export function flowStatusLabel(status: string, language: Language = "zh") {
	if (status === "draft") return language === "en" ? "draft" : "计划";
	if (status === "running") return language === "en" ? "running" : "执行中";
	if (status === "complete") return language === "en" ? "complete" : "已完成";
	if (status === "cancelled") return language === "en" ? "cancelled" : "已取消";
	return status;
}

export function goalStatusLabel(status: string, language: Language = "zh") {
	if (status === "pending") return language === "en" ? "pending" : "待执行";
	if (status === "running") return language === "en" ? "running" : "执行中";
	if (status === "complete") return language === "en" ? "complete" : "已完成";
	return status;
}

function continueResultText(result: string, language: Language) {
	if (result === "continued" || result === "resumed")
		return language === "en" ? "Flow continued." : "Flow 已继续执行。";
	if (result === "busy")
		return language === "en"
			? "AI is running; try again later."
			: "AI 正在运行，稍后再试。";
	if (result === "no_goal") return flowContinueNoGoalMessage(language);
	if (result === "not_resumable")
		return language === "en"
			? "The current step is not resumable."
			: "当前步骤不在可恢复状态。";
	return language === "en"
		? `Flow continue result: ${result}.`
		: `Flow 继续结果：${result}。`;
}

function flowContinueNoGoalMessage(language: Language) {
	return language === "en"
		? "No active Goal in the current session."
		: "当前会话没有进行中的目标。";
}
