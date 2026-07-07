import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	continueActiveGoalIfIdle,
	getGoalState,
	resumePausedGoalFromFlow,
} from "../../goal.js";
import type { Language } from "../../shared/config.js";
import { runtimeLanguage } from "../../shared/language.js";
import { notifyUser } from "../../shared/ui-language.js";
import { writeFlowHtml } from "../html.js";
import { planSnapshotError } from "../snapshot.js";
import { currentGoal, latestFlow, writeFlow } from "../store.js";
import {
	type FlowTargetResult,
	flowNotFoundMessage,
	flowNotRunningMessage,
	flowTargetLookupFailedMessage,
	flowTargetMessage,
	resolveFlowTarget,
} from "../target.js";
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
		const target = resolveFlowTarget(ctx);
		if (target.ok) return target.location.flow.language;
		return (
			latestFlow(ctx.cwd, (flow) => flow.status !== "cancelled")?.flow
				.language ?? runtimeLanguage()
		);
	} catch {
		return runtimeLanguage();
	}
}

type FlowTargetNotifyOptions = {
	id?: string;
	command: string;
	level?: "info" | "warning";
	quietNone?: boolean;
	requireRunning?: boolean;
};

export function flowTargetOrNotify(
	ctx: ExtensionContext,
	options: FlowTargetNotifyOptions,
) {
	let target: FlowTargetResult;
	try {
		target = resolveFlowTarget(ctx, options.id);
	} catch (error) {
		const language = runtimeLanguage();
		notifyUser(
			ctx,
			flowTargetLookupFailedMessage(error, language),
			"error",
			language,
		);
		return null;
	}
	if (!target.ok) return notifyMissingTarget(ctx, target, options);
	return validatedTarget(
		ctx,
		target.location,
		options.requireRunning !== false,
	);
}

export { flowNotFoundMessage };

function notifyMissingTarget(
	ctx: ExtensionContext,
	target: Exclude<FlowTargetResult, { ok: true }>,
	options: FlowTargetNotifyOptions,
) {
	if (target.reason === "none" && options.quietNone) return undefined;
	const language = targetResultLanguage(target);
	notifyUser(
		ctx,
		flowTargetMessage(target, language, options.command),
		options.level ?? "warning",
		language,
	);
	return null;
}

function validatedTarget(
	ctx: ExtensionContext,
	location: FlowLocation,
	requireRunning: boolean,
) {
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
	if (requireRunning && validation.flow.status !== "running") {
		notifyUser(
			ctx,
			flowNotRunningMessage(validation.flow.id, validation.flow.language),
			"warning",
			validation.flow.language,
		);
		return null;
	}
	return { ...location, flow: validation.flow };
}

function targetResultLanguage(
	target: Exclude<FlowTargetResult, { ok: true }>,
): Language {
	if (target.reason !== "ambiguous_active") return runtimeLanguage();
	const language = target.flows[0]?.flow.language;
	return language &&
		target.flows.every((item) => item.flow.language === language)
		? language
		: runtimeLanguage();
}

export function verifyCurrentSnapshot(
	ctx: ExtensionContext,
	dir: string,
	flow: FlowState,
) {
	const validation = validateFlowDir(dir, flow.language);
	if (!validation.ok || !validation.flow) {
		notifyUser(
			ctx,
			flow.language === "en"
				? `Flow validation failed:\n${validation.errors.join("\n")}`
				: `Flow 校验失败：\n${validation.errors.join("\n")}`,
			"error",
			flow.language,
		);
		return undefined;
	}
	const current = validation.flow;
	const plan = currentGoal(current);
	if (!plan || plan.status !== "running") return current;
	const error = planSnapshotError(dir, plan, current.language);
	if (error) {
		const saved = writeFlow(dir, { ...current, errors: [error] });
		writeFlowHtml(dir, saved);
		notifyUser(ctx, error, "error", current.language);
		return undefined;
	}
	if (current.errors.length === 0) return current;
	const saved = writeFlow(dir, { ...current, errors: [] });
	writeFlowHtml(dir, saved);
	return saved;
}

export function flowStatusLabel(status: string, language: Language = "zh") {
	if (status === "aligning") return language === "en" ? "aligning" : "对齐中";
	if (status === "generating")
		return language === "en" ? "generating" : "生成中";
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
