import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	continueActiveGoalIfIdle,
	getGoalState,
	resumePausedGoalFromFlow,
} from "../../goal.js";
import type { Language } from "../../shared/config.js";
import { formatError } from "../../shared/guards.js";
import { runtimeLanguage } from "../../shared/language.js";
import { formatUserNotice, notifyUser } from "../../shared/ui-language.js";
import { refreshFlowHtmlProjection } from "../html.js";
import { flowLockBusyMessage, withFlowLockSync } from "../lock.js";
import { currentSessionFile, flowOwnerForSession } from "../ownership.js";
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
import { replaceGoal } from "../util.js";
import { validateFlowDir } from "../validator.js";

export async function continueCurrentGoal(ctx: ExtensionContext) {
	const goal = getGoalState(ctx);
	if (!goal) {
		const language = runtimeLanguage();
		notifyUser(ctx, flowContinueNoGoalMessage(language), "info", language);
		return "no_goal";
	}
	if (goal.status === "paused" || goal.status === "budget_limited") {
		const owner = flowOwnerForSession(ctx);
		const result = await resumePausedGoalFromFlow(ctx, {
			onGoalIdChanged: owner
				? (goalId) =>
						syncFlowGoalId(ctx, owner.dir, owner.flow.language, goalId)
				: undefined,
		});
		notifyUser(
			ctx,
			continueResultText(result, goal.language),
			"info",
			goal.language,
		);
		return result;
	}
	if (goal.status === "active") {
		const result = await continueActiveGoalIfIdle(ctx);
		notifyUser(
			ctx,
			continueResultText(result, goal.language),
			"info",
			goal.language,
		);
		return result;
	}
	notifyUser(
		ctx,
		currentStepStatusNotice(goal.status, goal.language),
		"info",
		goal.language,
	);
	return "not_resumable";
}

function syncFlowGoalId(
	ctx: ExtensionContext,
	dir: string,
	language: Language,
	goalId: string,
) {
	try {
		const synced = withFlowLockSync(dir, "sync resumed Goal ID", () => {
			const validation = validateFlowDir(dir, language);
			if (!validation.ok || !validation.flow) {
				notifyUser(
					ctx,
					flowValidationFailedNotice(validation.errors, language),
					"info",
					language,
				);
				return false;
			}
			const flow = validation.flow;
			const plan = currentGoal(flow);
			if (
				flow.status !== "running" ||
				plan?.status !== "running" ||
				plan.sessionFile !== currentSessionFile(ctx)
			)
				return false;
			if (plan.goalId === goalId) return true;
			writeFlow(dir, {
				...flow,
				goals: replaceGoal(flow, plan.index, { ...plan, goalId }),
			});
			return true;
		});
		if (synced.ok) return synced.value;
		notifyUser(
			ctx,
			flowLockBusyMessage(synced.owner, language),
			"info",
			language,
		);
		return false;
	} catch (error) {
		notifyUser(
			ctx,
			goalIdSyncFailedNotice(formatError(error), language),
			"info",
			language,
		);
		return false;
	}
}

function goalIdSyncFailedNotice(error: string, language: Language) {
	return language === "en"
		? formatUserNotice("❌", "Flow runtime state sync failed", [error])
		: formatUserNotice("❌", "Flow 运行状态同步失败", [error]);
}

export function flowCommandLanguage(ctx: ExtensionContext): Language {
	try {
		const target = resolveFlowTarget(ctx);
		if (target.ok) return target.location.flow.language;
		return latestFlow(ctx.cwd)?.flow.language ?? runtimeLanguage();
	} catch {
		return runtimeLanguage();
	}
}

type FlowTargetNotifyOptions = {
	id?: string;
	command: string;
	level?: "info";
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
			"info",
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
		options.level ?? "info",
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
			flowValidationFailedNotice(validation.errors, location.flow.language),
			"info",
			location.flow.language,
		);
		return null;
	}
	if (requireRunning && validation.flow.status !== "running") {
		notifyUser(
			ctx,
			flowNotRunningMessage(validation.flow.id, validation.flow.language),
			"info",
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
			flowValidationFailedNotice(validation.errors, flow.language),
			"info",
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
		refreshFlowHtmlProjection(ctx, dir, saved);
		notifyUser(
			ctx,
			planSnapshotErrorNotice(error, current.language),
			"info",
			current.language,
		);
		return undefined;
	}
	if (current.errors.length === 0) return current;
	const saved = writeFlow(dir, { ...current, errors: [] });
	refreshFlowHtmlProjection(ctx, dir, saved);
	return saved;
}

export function flowStatusLabel(status: string, language: Language = "zh") {
	if (status === "aligning")
		return language === "en" ? "Waiting for confirmation" : "等待确认";
	if (status === "generating")
		return language === "en" ? "Generating" : "生成中";
	if (status === "draft") return language === "en" ? "Ready" : "待执行";
	if (status === "paused") return language === "en" ? "Paused" : "已暂停";
	if (status === "running") return language === "en" ? "Running" : "执行中";
	if (status === "complete") return language === "en" ? "Complete" : "已完成";
	return status;
}

export function goalStatusLabel(status: string, language: Language = "zh") {
	if (status === "pending") return language === "en" ? "Ready" : "待执行";
	if (status === "running") return language === "en" ? "Running" : "执行中";
	if (status === "paused") return language === "en" ? "Paused" : "已暂停";
	if (status === "complete") return language === "en" ? "Complete" : "已完成";
	return status;
}

function continueResultText(result: string, language: Language) {
	if (result === "continued" || result === "resumed")
		return language === "en"
			? formatUserNotice("✅", "Flow resumed", ["Current step resumed"])
			: formatUserNotice("✅", "Flow 已恢复", ["当前步骤已恢复"]);
	if (result === "busy")
		return language === "en"
			? formatUserNotice("⏳", "Flow cannot advance yet", [
					"AI is running",
					"Try again later",
				])
			: formatUserNotice("⏳", "Flow 暂不能推进", ["AI 正在运行", "稍后再试"]);
	if (result === "no_goal") return flowContinueNoGoalMessage(language);
	if (result === "not_resumable")
		return language === "en"
			? formatUserNotice("⚠️", "Flow cannot resume", [
					"The current step is not resumable",
				])
			: formatUserNotice("⚠️", "Flow 无法恢复", ["当前步骤不在可恢复状态"]);
	return language === "en"
		? formatUserNotice("⚠️", "Flow advance result unknown", [
				`Result: ${result}`,
			])
		: formatUserNotice("⚠️", "Flow 推进结果未知", [`结果：${result}`]);
}

function currentStepStatusNotice(status: string, language: Language) {
	return language === "en"
		? formatUserNotice("ℹ️", "Current step status", [
				`Status: ${goalStatusLabel(status, language)}`,
			])
		: formatUserNotice("ℹ️", "当前步骤状态", [
				`状态：${goalStatusLabel(status, language)}`,
			]);
}

function planSnapshotErrorNotice(error: string, language: Language) {
	return language === "en"
		? formatUserNotice("❌", "Flow cannot recover", [error])
		: formatUserNotice("❌", "Flow 无法恢复", [error]);
}

export function flowValidationFailedNotice(
	errors: readonly string[],
	language: Language,
) {
	return language === "en"
		? formatUserNotice("❌", "Flow validation failed", errors)
		: formatUserNotice("❌", "Flow 校验失败", errors);
}

export function flowNoActiveStepMessage(language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Flow cannot advance", ["No active step"])
		: formatUserNotice("⚠️", "Flow 无法推进", ["没有进行中的步骤"]);
}

function flowContinueNoGoalMessage(language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Flow cannot advance", [
				"No active Goal in the current session",
			])
		: formatUserNotice("⚠️", "Flow 无法推进", ["当前会话没有进行中的目标"]);
}
