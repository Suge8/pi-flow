import { existsSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { pauseGoalFromFlow } from "../../goal.js";
import { settledChecks } from "../../shared/report-review.js";
import { confirmUser, notifyUser } from "../../shared/ui-language.js";
import { writeFlowHtml } from "../html.js";
import { flowLockBusyMessage, withFlowLock } from "../lock.js";
import { currentSessionFile } from "../ownership.js";
import {
	activeParallelBatchForDir,
	cancelParallelBatch,
} from "../parallel/batch-runner.js";
import { rememberFlowContext } from "../runtime.js";
import { currentGoal, readFlow, writeFlow } from "../store.js";
import { validateFlowDir } from "../validator.js";
import { closeFlowGoalWatcher } from "../watcher.js";
import { flowTargetOrNotify } from "./shared.js";

export async function pauseFlow(ctx: ExtensionCommandContext, id?: string) {
	const location = flowTargetOrNotify(ctx, { id, command: "pause" });
	if (!location) return;
	const plan = currentGoal(location.flow);
	if (!plan)
		return notifyUser(
			ctx,
			flowNoActiveStepMessage(location.flow.language),
			"error",
			location.flow.language,
		);
	const paused = await pauseTargetGoal(ctx, plan.sessionFile);
	if (!paused)
		return notifyUser(
			ctx,
			flowPauseNoActiveGoalMessage(location.flow.language),
			"warning",
			location.flow.language,
		);
	notifyUser(
		ctx,
		flowPausedMessage(location.flow.id, location.flow.language),
		"info",
		location.flow.language,
	);
}

export async function cancelFlow(ctx: ExtensionCommandContext, id?: string) {
	const location = flowTargetOrNotify(ctx, { id, command: "cancel" });
	if (!location) return;
	const activeBatch = activeParallelBatchForDir(location.dir);
	if (activeBatch) return cancelActiveParallelFlow(ctx, activeBatch);
	const plan = currentGoal(location.flow);
	if (plan?.status === "running") {
		const confirmed = await confirmUser(
			ctx,
			location.flow.language === "en" ? "Cancel Flow?" : "取消 Flow？",
			location.flow.language === "en"
				? `${location.flow.id} will be cancelled. Files are kept.`
				: `将取消 ${location.flow.id}，文件会保留。`,
			undefined,
			location.flow.language,
		);
		if (!confirmed) return;
	}
	const cancelled = await withFlowLock(
		location.dir,
		`cancel ${location.flow.id}`,
		() => cancelFlowTransaction(ctx, location.dir, location.flow.language),
	);
	if (!cancelled.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(cancelled.owner, location.flow.language),
			"warning",
			location.flow.language,
		);
		return;
	}
	if (!cancelled.value) return;
	const { parallelCancelled, plan: cancelledPlan, saved } = cancelled.value;
	if (!parallelCancelled) {
		await pauseTargetGoal(ctx, cancelledPlan?.sessionFile ?? null);
	}
	notifyUser(
		ctx,
		flowCancelledMessage(saved.id, saved.language),
		"warning",
		saved.language,
	);
}

async function pauseTargetGoal(
	ctx: ExtensionCommandContext,
	sessionFile: string | null,
) {
	if (!sessionFile) return false;
	if (sessionFile === currentSessionFile(ctx)) return pauseGoalFromFlow(ctx);
	if (!existsSync(sessionFile)) return false;
	let paused = false;
	await ctx.switchSession(sessionFile, {
		withSession: async (sessionCtx) => {
			rememberFlowContext(sessionCtx);
			paused = pauseGoalFromFlow(sessionCtx);
		},
	});
	return paused;
}

function cancelFlowTransaction(
	ctx: ExtensionCommandContext,
	dir: string,
	language: "zh" | "en",
) {
	const validation = validateFlowDir(dir, language);
	if (!validation.ok || !validation.flow) {
		notifyUser(
			ctx,
			language === "en"
				? `Flow validation failed:\n${validation.errors.join("\n")}`
				: `Flow 校验失败：\n${validation.errors.join("\n")}`,
			"error",
			language,
		);
		return undefined;
	}
	if (validation.flow.status !== "running") return undefined;
	const plan = currentGoal(validation.flow);
	const parallelCancelled = cancelParallelBatch(dir);
	const saved = writeFlow(dir, {
		...validation.flow,
		status: "cancelled",
		parallelRun: null,
		goals: validation.flow.goals.map((goal) => ({
			...goal,
			checks: settledChecks(goal.checks),
		})),
	});
	closeFlowGoalWatcher(dir);
	writeFlowHtml(dir, saved);
	return { parallelCancelled, plan, saved };
}

async function cancelActiveParallelFlow(
	ctx: ExtensionCommandContext,
	batch: NonNullable<ReturnType<typeof activeParallelBatchForDir>>,
) {
	const confirmed = await confirmUser(
		ctx,
		batch.flow.language === "en" ? "Cancel Flow?" : "取消 Flow？",
		batch.flow.language === "en"
			? `${batch.flow.id} will be cancelled. Files are kept.`
			: `将取消 ${batch.flow.id}，文件会保留。`,
		undefined,
		batch.flow.language,
	);
	if (!confirmed) return;
	batch.cancel();
	await batch.wait();
	if (!(await ensureActiveParallelCancelPersisted(ctx, batch))) return;
	notifyUser(
		ctx,
		flowCancelledMessage(batch.flow.id, batch.flow.language),
		"warning",
		batch.flow.language,
	);
}

async function ensureActiveParallelCancelPersisted(
	ctx: ExtensionCommandContext,
	batch: NonNullable<ReturnType<typeof activeParallelBatchForDir>>,
) {
	if (readFlow(batch.dir).status === "cancelled") return true;
	const cancelled = await withFlowLock(
		batch.dir,
		`cancel ${batch.flow.id}`,
		() => cancelFlowTransaction(ctx, batch.dir, batch.flow.language),
	);
	if (!cancelled.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(cancelled.owner, batch.flow.language),
			"warning",
			batch.flow.language,
		);
		return false;
	}
	if (cancelled.value?.saved.status === "cancelled") return true;
	notifyUser(
		ctx,
		activeParallelCancelNotSavedMessage(batch.flow.language),
		"warning",
		batch.flow.language,
	);
	return false;
}

function flowNoActiveStepMessage(language: "zh" | "en") {
	return language === "en"
		? "Flow has no active step."
		: "Flow 没有进行中的步骤。";
}

function flowPausedMessage(id: string, language: "zh" | "en") {
	return language === "en" ? `Flow paused: ${id}` : `Flow 已暂停：${id}`;
}

function flowPauseNoActiveGoalMessage(language: "zh" | "en") {
	return language === "en"
		? "Flow step is not active; nothing paused."
		: "Flow 步骤未在活动状态，未执行暂停。";
}

function flowCancelledMessage(id: string, language: "zh" | "en") {
	return language === "en" ? `Flow cancelled: ${id}` : `Flow 已取消：${id}`;
}

function activeParallelCancelNotSavedMessage(language: "zh" | "en") {
	return language === "en"
		? "Flow cancellation was not saved. Run /flow cancel again."
		: "Flow 取消状态未保存，请重新运行 /flow cancel。";
}
