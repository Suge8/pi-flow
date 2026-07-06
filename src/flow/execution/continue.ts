import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { clearCompletedGoalFromFlow } from "../../goal.js";
import {
	flowGoalDisplayLabel,
	flowStepLabel,
} from "../../shared/progress-labels.js";
import { liveReportUrl } from "../../shared/report-server.js";
import {
	composeResultCardLines,
	finalReplyInstruction,
	resultCardElapsedLine,
	sendResultCard,
} from "../../shared/result-card.js";
import { formatDuration } from "../../shared/status.js";
import { notifyUser } from "../../shared/ui-language.js";
import { latestGoalCompletion } from "../completion.js";
import { completeGoalWithFact } from "../goal-completion.js";
import { writeFlowHtml } from "../html.js";
import { flowLockBusyMessage, withFlowLock } from "../lock.js";
import { currentSessionFile } from "../ownership.js";
import { activeParallelBatchForDir } from "../parallel/batch-runner.js";
import { settleParallelRun } from "../parallel/fan-in.js";
import {
	completionFact,
	deleteCompletionFact,
	rememberedFlowContext,
	rememberFlowContext,
} from "../runtime.js";
import {
	currentGoal,
	flowOwningSession,
	runningFlows,
	writeFlow,
} from "../store.js";
import type { FlowLocation, FlowState, GoalCompletionFact } from "../types.js";
import { flowCommandId, requireFlowStartedAt } from "../util.js";
import { validateFlowDir } from "../validator.js";
import { closeFlowGoalWatcher } from "../watcher.js";
import {
	continueCurrentGoal,
	flowTargetOrNotify,
	verifyCurrentSnapshot,
} from "./shared.js";
import { startGoalInNewSession } from "./start.js";

export async function continueFlow(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	id?: string,
) {
	const location = flowTargetOrNotify(ctx, { id, command: "continue" });
	if (!location) return;
	const activeBatch = activeParallelBatchForDir(location.dir);
	if (location.flow.parallelRun && activeBatch) {
		notifyUser(
			ctx,
			parallelRunStillRunningMessage(location.flow),
			"info",
			location.flow.language,
		);
		return;
	}
	const verified = await withFlowLock(
		location.dir,
		`verify ${location.flow.id}`,
		() => {
			const validation = validateFlowDir(location.dir, location.flow.language);
			return validation.flow
				? verifyCurrentSnapshot(ctx, location.dir, validation.flow)
				: undefined;
		},
	);
	if (!verified.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(verified.owner, location.flow.language),
			"warning",
			location.flow.language,
		);
		return;
	}
	const verifiedFlow = verified.value;
	if (!verifiedFlow) return;
	if (verifiedFlow.parallelRun)
		return recoverParallelRun(pi, ctx, location.dir, verifiedFlow);
	const plan = currentGoal(verifiedFlow);
	if (!plan)
		return notifyUser(
			ctx,
			location.flow.language === "en"
				? "Flow has no active step."
				: "Flow 没有进行中的步骤。",
			"error",
			verifiedFlow.language,
		);
	if (plan.sessionFile !== currentSessionFile(ctx)) {
		const { resumeFlow } = await import("./resume.js");
		return resumeFlow(pi, ctx, location.id);
	}
	rememberFlowContext(ctx);
	if (await handleGoalCompletionEnd(pi, ctx)) return;
	await continueCurrentGoal(ctx);
}

export async function handleGoalCompletionEnd(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	givenFact?: GoalCompletionFact,
) {
	const sessionFile = currentSessionFile(ctx);
	const fact =
		givenFact ?? completionFact(sessionFile) ?? latestGoalCompletion(ctx);
	if (!fact) return false;
	const location =
		completionFlowLocation(ctx, sessionFile, fact) ??
		invalidCompletionFlowLocation(ctx);
	if (!location) return false;
	const completed = await withFlowLock(
		location.dir,
		`complete ${location.flow.id}`,
		() => completeGoalEndTransaction(ctx, location.dir, location.flow, fact),
	);
	if (!completed.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(completed.owner, location.flow.language),
			"warning",
			location.flow.language,
		);
		return true;
	}
	if (!completed.value) return false;
	const { plan, saved } = completed.value;
	await liveReportUrl(
		ctx,
		join(location.dir, "flow.html"),
		saved.language,
	).catch(() => undefined);
	clearCompletedGoalFromFlow(ctx, fact.goalId);
	notifyUser(
		ctx,
		flowGoalCompleteNotice(plan.index, plan.title, saved),
		"info",
		saved.language,
	);
	if (saved.status === "complete") {
		closeFlowGoalWatcher(location.dir);
		await sendFlowCompleteCard(pi, ctx, location.dir, saved);
		return true;
	}
	const flowContext =
		commandContextForAutoStart(ctx) ??
		rememberedFlowContext(plan.sessionFile ?? fact.sessionFile ?? sessionFile);
	if (!flowContext) {
		const command = `/flow continue ${flowCommandId(saved.id)}`;
		sendFlowResumeRequiredCard(pi, ctx, saved);
		notifyUser(
			ctx,
			saved.language === "en"
				? `Flow updated; run ${command} to continue to the next step.`
				: `Flow 已更新；运行 ${command} 继续下一步。`,
			"warning",
			saved.language,
		);
		return true;
	}
	await startGoalInNewSession(
		pi,
		flowContext,
		location.dir,
		saved,
		saved.currentGoal,
	);
	return true;
}

function completionFlowLocation(
	ctx: ExtensionContext,
	sessionFile: string | undefined,
	fact: GoalCompletionFact,
): FlowLocation | undefined {
	if (fact.sessionFile) {
		const factOwner = flowOwningSession(ctx.cwd, fact.sessionFile);
		if (factOwner) return factOwner;
		if (fact.sessionFile !== sessionFile) return undefined;
	}
	return flowOwningSession(ctx.cwd, sessionFile);
}

function invalidCompletionFlowLocation(ctx: ExtensionContext) {
	return runningFlows(ctx.cwd).find(({ flow }) => !Array.isArray(flow.goals));
}

function completeGoalEndTransaction(
	ctx: ExtensionContext,
	dir: string,
	flow: FlowState,
	fact: GoalCompletionFact,
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
	const verifiedFlow = verifyCurrentSnapshot(ctx, dir, validation.flow);
	if (!verifiedFlow) return undefined;
	const plan = currentGoal(verifiedFlow);
	if (!plan || plan.status !== "running") return undefined;
	if (
		plan.sessionFile &&
		fact.sessionFile &&
		plan.sessionFile !== fact.sessionFile
	)
		return undefined;
	deleteCompletionFact(fact.sessionFile);
	return { plan, saved: completeCurrentGoal(dir, verifiedFlow, fact) };
}

async function recoverParallelRun(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
) {
	const settled = await withFlowLock(dir, `recover parallel ${flow.id}`, () => {
		const validation = validateFlowDir(dir, flow.language);
		const current = validation.flow ?? flow;
		if (!current.parallelRun) return undefined;
		return settleParallelRun(dir, current, [], {
			requireSuccessfulExit: false,
			recovery: true,
		});
	});
	if (!settled.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(settled.owner, flow.language),
			"warning",
			flow.language,
		);
		return;
	}
	const fanIn = settled.value;
	if (!fanIn) return;
	notifyUser(
		ctx,
		parallelRecoveryMessage(
			fanIn.flow,
			fanIn.completedIndexes,
			fanIn.resetIndexes,
		),
		fanIn.allSuccess ? "info" : "warning",
		fanIn.flow.language,
	);
	await liveReportUrl(ctx, join(dir, "flow.html"), fanIn.flow.language).catch(
		() => undefined,
	);
	if (fanIn.flow.status === "complete") {
		closeFlowGoalWatcher(dir);
		await sendFlowCompleteCard(pi, ctx, dir, fanIn.flow);
		return;
	}
	await startGoalInNewSession(pi, ctx, dir, fanIn.flow, fanIn.flow.currentGoal);
}

function flowGoalCompleteNotice(index: number, title: string, flow: FlowState) {
	const label = flowGoalDisplayLabel(
		index,
		title,
		flow.goals.length,
		flow.language,
	);
	return flow.language === "en"
		? `Flow ${label} complete.`
		: `Flow ${label} 已完成。`;
}

function parallelRunStillRunningMessage(flow: FlowState) {
	return flow.language === "en"
		? `Flow parallel batch is still running: ${flow.id}`
		: `Flow 并行批次仍在执行：${flow.id}`;
}

function parallelRecoveryMessage(
	flow: FlowState,
	completedIndexes: number[],
	resetIndexes: number[],
) {
	const completed = completedIndexes.map((index) => goalLabel(flow, index));
	const reset = resetIndexes.map((index) => goalLabel(flow, index));
	const none = flow.language === "en" ? "none" : "无";
	return flow.language === "en"
		? `Parallel recovery: completed ${completed.join(", ") || none}; reset ${reset.join(", ") || none}`
		: `并行恢复：已收口 ${completed.join("、") || none}；已重置 ${reset.join("、") || none}`;
}

function goalLabel(flow: FlowState, goalIndex: number) {
	const goal = flow.goals[goalIndex];
	return goal
		? flowStepLabel(goalIndex, goal.title, flow.language)
		: `G${goalIndex}`;
}

function sendFlowResumeRequiredCard(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	flow: FlowState,
) {
	const next = currentGoal(flow);
	if (!next) return;
	const command = `/flow continue ${flowCommandId(flow.id)}`;
	const label = flowStepLabel(next.index, next.title, flow.language);
	const title =
		flow.language === "en" ? `Flow ${label} ready` : `Flow ${label} 已就绪`;
	const lines =
		flow.language === "en"
			? [`Goal: ${next.title}`, `Next: ${command}`]
			: [`目标：${next.title}`, `下一步：${command}`];
	sendResultCard(pi, ctx, [`[${title}]`, ...lines].join("\n"), {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		language: flow.language,
	});
}

export async function sendFlowCompleteCard(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	dir: string,
	flow: FlowState,
) {
	const htmlPath = join(dir, "flow.html");
	await liveReportUrl(ctx, htmlPath, flow.language).catch(() => undefined);
	const complete = flow.goals.filter(
		(goal) => goal.status === "complete",
	).length;
	const total = flow.goals.length;
	const totalTime = formatDuration(
		Math.max(0, Math.floor((Date.now() - requireFlowStartedAt(flow)) / 1000)),
	);
	const title = flow.language === "en" ? "Flow complete" : "Flow 已完成";
	const summaryLines = flowCompleteSummaryLines(flow, complete, total);
	const lines = composeResultCardLines(
		[summaryLines],
		[resultCardElapsedLine(totalTime, flow.language, "totalElapsed")],
	);
	const content = [
		`[${title}]`,
		...summaryLines,
		"",
		flow.language === "en" ? "Next:" : "下一步：",
		finalReplyInstruction(flow.language),
	].join("\n");
	sendResultCard(
		pi,
		ctx,
		content,
		{ tone: "success", result: "完成", title, lines, language: flow.language },
		{ triggerTurn: true },
	);
}

function flowCompleteSummaryLines(
	flow: FlowState,
	complete: number,
	total: number,
) {
	if (total === 1)
		return flow.language === "en"
			? [`Flow: ${flow.title}`, "Status: complete"]
			: [`Flow：${flow.title}`, "状态：已完成"];
	return flow.language === "en"
		? [`Flow: ${flow.title}`, `Completed: ${complete}/${total} steps`]
		: [`Flow：${flow.title}`, `已完成：${complete}/${total} 步`];
}

function completeCurrentGoal(
	dir: string,
	flow: FlowState,
	fact: GoalCompletionFact,
) {
	const goalIndex = flow.currentGoal;
	const completed = completeGoalWithFact(dir, flow, goalIndex, fact);
	const final = goalIndex === flow.goals.length - 1;
	const saved = writeFlow(dir, {
		...completed,
		status: final ? "complete" : "running",
		currentGoal: final ? goalIndex : goalIndex + 1,
	});
	writeFlowHtml(dir, saved);
	return saved;
}

export { completeGoalWithFact };

function commandContextForAutoStart(
	ctx: ExtensionContext,
): ExtensionCommandContext | undefined {
	return typeof (ctx as { newSession?: unknown }).newSession === "function"
		? (ctx as ExtensionCommandContext)
		: undefined;
}
