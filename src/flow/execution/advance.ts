import { existsSync } from "node:fs";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { objectiveFromPlan } from "../../goal/validator.js";
import { clearCompletedGoalFromFlow } from "../../goal.js";
import { requestPiAttention } from "../../shared/activity-signal.js";
import { clipText } from "../../shared/clip.js";
import { formatError } from "../../shared/guards.js";
import { flowStepLabel } from "../../shared/progress-labels.js";

import {
	composeResultCardLines,
	finalReplyInstruction,
	resultCardElapsedLine,
	sendResultCard,
} from "../../shared/result-card.js";
import {
	collectSuggestions,
	completionChecksLines,
} from "../../shared/review-history.js";
import { formatDuration } from "../../shared/status.js";
import { formatUserNotice, notifyUser } from "../../shared/ui-language.js";
import {
	completionFactAllowedByBoundary,
	latestGoalCompletion,
} from "../completion.js";
import { completeGoalWithFact } from "../goal-completion.js";
import {
	publishFlowReportLifecycle,
	publishFlowReportProjection,
} from "../html.js";
import { flowLockBusyMessage, withFlowLock } from "../lock.js";
import { currentSessionFile } from "../ownership.js";
import {
	activeParallelBatchForDir,
	settleParallelBlockedRun,
} from "../parallel/batch-runner.js";
import { quoteCommand } from "../parallel/console.js";
import { settleParallelRun } from "../parallel/fan-in.js";
import { firstWorkerHandoff } from "../parallel/worker-artifact.js";
import {
	completionFact,
	deleteCompletionFact,
	releaseFlowContext,
	rememberedFlowContext,
	rememberFlowContext,
} from "../runtime.js";
import { computeReadyBatch } from "../scheduler.js";
import { requestSessionTransition } from "../session-transition.js";
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
	flowNoActiveStepMessage,
	flowStatusLabel,
	flowValidationFailedNotice,
	verifyCurrentSnapshot,
} from "./shared.js";
import { startGoalInNewSession } from "./start.js";

export async function advanceFlowExecution(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	location: FlowLocation,
) {
	if (canStartFromBeginning(location.flow))
		return startGoalInNewSession(pi, ctx, location.dir, location.flow, 0);
	if (location.flow.status === "paused") {
		const { resumeFlow } = await import("./resume.js");
		return resumeFlow(pi, ctx, location.id);
	}
	if (location.flow.status !== "running") {
		notifyUser(
			ctx,
			flowCannotAdvanceMessage(location.flow),
			"info",
			location.flow.language,
		);
		return;
	}
	const activeBatch = activeParallelBatchForDir(location.dir);
	if (location.flow.parallelRun && activeBatch) {
		if (await switchToParallelConsoleIfNeeded(ctx, location.flow)) return;
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
			"info",
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
			flowNoActiveStepMessage(verifiedFlow.language),
			"info",
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
	if (!completionFactAllowedByBoundary(ctx, fact)) {
		deleteCompletionFact(fact.sessionFile);
		return false;
	}
	const location =
		completionFlowLocation(ctx, sessionFile, fact) ??
		invalidCompletionFlowLocation(ctx);
	if (!location) {
		deleteCompletionFact(fact.sessionFile);
		releaseFlowContext(fact.sessionFile);
		return false;
	}
	const completed = await withFlowLock(
		location.dir,
		`complete ${location.flow.id}`,
		() => completeGoalEndTransaction(ctx, location.dir, location.flow, fact),
	);
	if (!completed.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(completed.owner, location.flow.language),
			"info",
			location.flow.language,
		);
		return true;
	}
	if (completed.value.kind === "retry") return false;
	if (completed.value.kind === "rejected") {
		deleteCompletionFact(fact.sessionFile);
		releaseFlowContext(fact.sessionFile);
		return false;
	}
	deleteCompletionFact(fact.sessionFile);
	const { plan, saved } = completed.value;
	const completedSessionFile =
		plan.sessionFile ?? fact.sessionFile ?? sessionFile;
	publishFlowReportLifecycle(ctx, location.dir, saved);
	clearCompletedGoalFromFlow(ctx, fact.goalId);
	if (saved.status === "complete") {
		closeFlowGoalWatcher(location.dir);
		releaseFlowContext(completedSessionFile);
		await sendFlowCompleteCard(pi, ctx, location.dir, saved);
		return true;
	}
	const flowContext =
		commandContextForAutoStart(ctx) ??
		rememberedFlowContext(completedSessionFile);
	if (!flowContext) {
		releaseFlowContext(completedSessionFile);
		sendFlowResumeRequiredCard(pi, ctx, saved);
		return true;
	}
	const scheduled = requestSessionTransition({
		key: `flow:${saved.id}`,
		ctx: flowContext,
		run: async () => {
			const started = await startGoalInNewSession(
				pi,
				flowContext,
				location.dir,
				saved,
				saved.currentGoal,
			);
			if (started) releaseFlowContext(completedSessionFile);
		},
		onError: (error) =>
			notifyFlowAdvanceFailed(flowContext, saved, formatError(error)),
	});
	if (!scheduled) {
		releaseFlowContext(completedSessionFile);
		sendFlowResumeRequiredCard(pi, ctx, saved);
	}
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
):
	| { kind: "completed"; plan: FlowState["goals"][number]; saved: FlowState }
	| { kind: "rejected" }
	| { kind: "retry" } {
	const validation = validateFlowDir(dir, flow.language);
	if (!validation.ok || !validation.flow) {
		notifyUser(
			ctx,
			flowValidationFailedNotice(validation.errors, flow.language),
			"info",
			flow.language,
		);
		return { kind: "retry" };
	}
	const verifiedFlow = verifyCurrentSnapshot(ctx, dir, validation.flow);
	if (!verifiedFlow) return { kind: "retry" };
	if (verifiedFlow.status !== "running") return { kind: "rejected" };
	const plan = currentGoal(verifiedFlow);
	if (!plan || plan.status !== "running") return { kind: "rejected" };
	if (
		plan.sessionFile &&
		fact.sessionFile &&
		plan.sessionFile !== fact.sessionFile
	)
		return { kind: "rejected" };
	return {
		kind: "completed",
		plan,
		saved: completeCurrentGoal(ctx, dir, verifiedFlow, fact),
	};
}

async function switchToParallelConsoleIfNeeded(
	ctx: ExtensionCommandContext,
	flow: FlowState,
) {
	const consoleSessionFile = flow.parallelRun?.consoleSessionFile;
	if (!consoleSessionFile || consoleSessionFile === currentSessionFile(ctx))
		return false;
	if (!existsSync(consoleSessionFile)) return false;
	await ctx.switchSession(consoleSessionFile, {
		withSession: async (sessionCtx) => {
			rememberFlowContext(sessionCtx);
			notifyUser(
				sessionCtx,
				parallelRunStillRunningMessage(flow),
				"info",
				flow.language,
			);
		},
	});
	return true;
}

async function recoverParallelRun(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
) {
	const consoleSessionFile = flow.parallelRun?.consoleSessionFile;
	const blocked = firstWorkerHandoff(dir, flow);
	if (blocked) {
		const handoff = await settleParallelBlockedRun(ctx, dir, flow, blocked);
		if (handoff.applied || handoff.flow.status !== "running") {
			releaseFlowContext(consoleSessionFile);
			return;
		}
		flow = handoff.flow;
	}
	const settled = await withFlowLock(dir, `recover parallel ${flow.id}`, () => {
		const validation = validateFlowDir(dir, flow.language);
		const current = validation.flow ?? flow;
		if (!current.parallelRun) return undefined;
		return settleParallelRun(ctx, dir, current, [], {
			requireSuccessfulExit: false,
			recovery: true,
		});
	});
	if (!settled.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(settled.owner, flow.language),
			"info",
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
		"info",
		fanIn.flow.language,
	);
	publishFlowReportLifecycle(ctx, dir, fanIn.flow);
	if (fanIn.flow.status === "complete") {
		closeFlowGoalWatcher(dir);
		releaseFlowContext(consoleSessionFile);
		await sendFlowCompleteCard(pi, ctx, dir, fanIn.flow);
		return;
	}
	const started = await startGoalInNewSession(
		pi,
		ctx,
		dir,
		fanIn.flow,
		fanIn.flow.currentGoal,
	);
	if (started) releaseFlowContext(consoleSessionFile);
}

function canStartFromBeginning(flow: FlowState) {
	return (
		flow.status === "draft" ||
		(flow.status === "paused" && flow.startedAt === null)
	);
}

function flowCannotAdvanceMessage(flow: FlowState) {
	const status = flowStatusLabel(flow.status, flow.language);
	return flow.language === "en"
		? formatUserNotice("⚠️", "Flow cannot advance", [
				`ID: ${flowCommandId(flow.id)}`,
				`Status: ${status}`,
			])
		: formatUserNotice("⚠️", "Flow 无法推进", [
				`编号：${flowCommandId(flow.id)}`,
				`状态：${status}`,
			]);
}

function parallelRunStillRunningMessage(flow: FlowState) {
	return flow.language === "en"
		? formatUserNotice("⏳", "Flow parallel batch is still running", [
				`ID: ${flowCommandId(flow.id)}`,
			])
		: formatUserNotice("⏳", "Flow 并行批次仍在执行", [
				`编号：${flowCommandId(flow.id)}`,
			]);
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
		? formatUserNotice("🔁", "Flow parallel recovery", [
				`Completed ${completed.join(", ") || none}`,
				`Reset ${reset.join(", ") || none}`,
			])
		: formatUserNotice("🔁", "Flow 并行恢复", [
				`已收口 ${completed.join("、") || none}`,
				`已重置 ${reset.join("、") || none}`,
			]);
}

function goalLabel(flow: FlowState, goalIndex: number) {
	const goal = flow.goals[goalIndex];
	return goal
		? flowStepLabel(goalIndex, goal.title, flow.language)
		: `G${goalIndex}`;
}

function notifyFlowAdvanceFailed(
	ctx: ExtensionCommandContext,
	flow: FlowState,
	error: string,
) {
	const command = `/flow go ${flowCommandId(flow.id)}`;
	const message =
		flow.language === "en"
			? formatUserNotice("❌", "Flow could not advance", [
					error,
					`Run ${quoteCommand(command)} to retry`,
				])
			: formatUserNotice("❌", "Flow 无法推进", [
					error,
					`运行 ${quoteCommand(command)} 重试`,
				]);
	notifyUser(ctx, message, "info", flow.language);
}

function sendFlowResumeRequiredCard(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	flow: FlowState,
) {
	const next = currentGoal(flow);
	if (!next) return;
	const command = `/flow go ${flowCommandId(flow.id)}`;
	const label = flowStepLabel(next.index, next.title, flow.language);
	const title =
		flow.language === "en" ? `Flow ${label} ready` : `Flow ${label} 已就绪`;
	const lines =
		flow.language === "en"
			? [`Next: ${quoteCommand(command)}`]
			: [`下一步：${quoteCommand(command)}`];
	sendResultCard(pi, ctx, [`[${title}]`, ...lines].join("\n"), {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		language: flow.language,
	});
	requestPiAttention(`pi-flow:flow:${flow.id}`);
}

export async function sendFlowCompleteCard(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	dir: string,
	flow: FlowState,
) {
	publishFlowReportLifecycle(ctx, dir, flow);
	const complete = flow.goals.filter(
		(goal) => goal.status === "complete",
	).length;
	const total = flow.goals.length;
	const totalTime = formatDuration(
		Math.max(0, Math.floor((Date.now() - requireFlowStartedAt(flow)) / 1000)),
	);
	const elapsedLine = resultCardElapsedLine(
		totalTime,
		flow.language,
		"totalElapsed",
	);
	const goal = flow.goals.length === 1 ? flow.goals[0] : undefined;
	const title = goal
		? flow.language === "en"
			? `Flow ${goal.title} complete`
			: `Flow ${goal.title} 已完成`
		: flow.language === "en"
			? "Flow complete"
			: "Flow 已完成";
	const suggestionCount = flow.goals.reduce(
		(count, item) => count + collectSuggestions(item.checks).length,
		0,
	);
	const suggestionLine =
		suggestionCount > 0
			? flow.language === "en"
				? `💡 ${suggestionCount} non-blocking suggestion${suggestionCount > 1 ? "s" : ""} · see report`
				: `💡 ${suggestionCount} 条非阻塞建议 · 见报告`
			: undefined;
	const summaryLines = [
		...(goal
			? singleFlowCompleteLines(flow, goal, elapsedLine)
			: flowCompleteSummaryLines(flow, complete, total, elapsedLine)),
	];
	const lines = goal
		? composeResultCardLines(
				[
					summaryLines.slice(0, 2),
					[
						...summaryLines.slice(2, -1),
						...(suggestionLine ? [suggestionLine] : []),
					],
				],
				[elapsedLine],
			)
		: [...summaryLines, ...(suggestionLine ? [suggestionLine] : [])];
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

function singleFlowCompleteLines(
	flow: FlowState,
	goal: FlowState["goals"][number],
	elapsedLine: string,
) {
	const objective = objectiveFromPlan(goal.snapshot ?? "") || goal.title;
	const head =
		flow.language === "en"
			? [`ID: ${flowCommandId(flow.id)}`, `Goal: ${clipText(objective, 120)}`]
			: [
					`编号：${flowCommandId(flow.id)}`,
					`目标：${clipText(objective, 120)}`,
				];
	return [
		...head,
		...completionChecksLines(goal.checks, flow.language),
		elapsedLine,
	];
}

function flowCompleteSummaryLines(
	flow: FlowState,
	complete: number,
	total: number,
	elapsedLine: string,
) {
	const summary =
		flow.language === "en"
			? [`Flow: ${flow.title}`, `Completed: ${complete}/${total} steps`]
			: [`Flow：${flow.title}`, `已完成：${complete}/${total} 步`];
	return composeResultCardLines([summary], [elapsedLine]);
}

function completeCurrentGoal(
	ctx: ExtensionContext,
	dir: string,
	flow: FlowState,
	fact: GoalCompletionFact,
) {
	const completed = completeGoalWithFact(dir, flow, flow.currentGoal, fact);
	const final = completed.goals.every((goal) => goal.status === "complete");
	const ready = final ? null : computeReadyBatch(completed);
	const saved = writeFlow(dir, {
		...completed,
		status: final ? "complete" : "running",
		completedAt: final ? Date.now() : null,
		currentGoal: final
			? completed.goals.length - 1
			: (ready?.indices[0] ?? completed.currentGoal),
	});
	publishFlowReportProjection(ctx, dir, saved);
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
