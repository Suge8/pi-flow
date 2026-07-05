import { existsSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { pauseGoalFromFlow } from "../../goal.js";
import { settledChecks } from "../../shared/report-review.js";
import { confirmUser, notifyUser } from "../../shared/ui-language.js";
import { writeFlowHtml } from "../html.js";
import { currentSessionFile } from "../ownership.js";
import {
	activeParallelBatch,
	cancelParallelBatch,
} from "../parallel/batch-runner.js";
import { rememberFlowContext } from "../runtime.js";
import { currentGoal, writeFlow } from "../store.js";
import { closeFlowGoalWatcher } from "../watcher.js";
import { flowCommandLanguage, runningFlowOrNotify } from "./shared.js";

export async function pauseFlow(ctx: ExtensionCommandContext) {
	const location = runningFlowOrNotify(ctx);
	if (location === null) return;
	if (!location) return notifyNoRunningFlow(ctx);
	const plan = currentGoal(location.flow);
	if (!plan)
		return notifyUser(
			ctx,
			flowNoActiveStepMessage(location.flow.language),
			"error",
			location.flow.language,
		);
	if (
		plan.sessionFile &&
		plan.sessionFile !== currentSessionFile(ctx) &&
		existsSync(plan.sessionFile)
	) {
		await ctx.switchSession(plan.sessionFile, {
			withSession: async (sessionCtx) => {
				rememberFlowContext(sessionCtx);
				pauseGoalFromFlow(sessionCtx);
			},
		});
	} else pauseGoalFromFlow(ctx);
	notifyUser(
		ctx,
		flowPausedMessage(location.flow.id, location.flow.language),
		"info",
		location.flow.language,
	);
}

export async function cancelFlow(ctx: ExtensionCommandContext) {
	const activeBatch = activeParallelBatch(ctx.cwd);
	if (activeBatch) return cancelActiveParallelFlow(ctx, activeBatch);
	const location = runningFlowOrNotify(ctx);
	if (location === null) return;
	if (!location) return notifyNoRunningFlow(ctx);
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
	const parallelCancelled = cancelParallelBatch(location.dir);
	const saved = writeFlow(location.dir, {
		...location.flow,
		status: "cancelled",
		parallelBatch: null,
		goals: location.flow.goals.map((goal) => ({
			...goal,
			checks: settledChecks(goal.checks),
		})),
	});
	closeFlowGoalWatcher();
	writeFlowHtml(location.dir, saved);
	if (!parallelCancelled) {
		if (
			plan?.sessionFile &&
			plan.sessionFile !== currentSessionFile(ctx) &&
			existsSync(plan.sessionFile)
		) {
			await ctx.switchSession(plan.sessionFile, {
				withSession: async (sessionCtx) => {
					rememberFlowContext(sessionCtx);
					pauseGoalFromFlow(sessionCtx);
				},
			});
		} else pauseGoalFromFlow(ctx);
	}
	notifyUser(
		ctx,
		flowCancelledMessage(saved.id, saved.language),
		"warning",
		saved.language,
	);
}

async function cancelActiveParallelFlow(
	ctx: ExtensionCommandContext,
	batch: NonNullable<ReturnType<typeof activeParallelBatch>>,
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
	notifyUser(
		ctx,
		flowCancelledMessage(batch.flow.id, batch.flow.language),
		"warning",
		batch.flow.language,
	);
}

function notifyNoRunningFlow(ctx: ExtensionCommandContext) {
	const language = flowCommandLanguage(ctx);
	return notifyUser(
		ctx,
		language === "en"
			? "No running Flow in the current directory."
			: "当前目录没有运行中的 Flow。",
		"warning",
		language,
	);
}

function flowNoActiveStepMessage(language: "zh" | "en") {
	return language === "en"
		? "Flow has no active step."
		: "Flow 没有进行中的步骤。";
}

function flowPausedMessage(id: string, language: "zh" | "en") {
	return language === "en" ? `Flow paused: ${id}` : `Flow 已暂停：${id}`;
}

function flowCancelledMessage(id: string, language: "zh" | "en") {
	return language === "en" ? `Flow cancelled: ${id}` : `Flow 已取消：${id}`;
}
