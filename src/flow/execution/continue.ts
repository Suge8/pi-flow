import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { clearCompletedGoalFromFlow } from "../../goal.js";
import { flowStepLabel } from "../../shared/progress-labels.js";
import { liveReportUrl } from "../../shared/report-server.js";
import {
	finalReplyInstruction,
	sendResultCard,
} from "../../shared/result-card.js";
import { formatDuration } from "../../shared/status.js";
import { notifyUser } from "../../shared/ui-language.js";
import { latestGoalCompletion } from "../completion.js";
import { writeFlowHtml } from "../html.js";
import { currentSessionFile } from "../ownership.js";
import {
	completionFact,
	deleteCompletionFact,
	rememberedFlowContext,
	rememberFlowContext,
} from "../runtime.js";
import { currentGoal, writeFlow } from "../store.js";
import type { FlowState, GoalCompletionFact } from "../types.js";
import { replaceGoal, requireFlowStartedAt } from "../util.js";
import { closeFlowGoalWatcher } from "../watcher.js";
import {
	handoffHasCriteriaDeviation,
	readOrGenerateHandoff,
} from "./handoff.js";
import {
	continueCurrentGoal,
	flowCommandLanguage,
	runningFlowOrNotify,
	verifyCurrentSnapshot,
} from "./shared.js";
import { startGoalInNewSession } from "./start.js";

export async function continueFlow(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
) {
	const location = runningFlowOrNotify(ctx);
	if (location === null) return;
	if (!location) return notifyNoRunningFlow(ctx);
	const plan = currentGoal(location.flow);
	if (!plan)
		return notifyUser(
			ctx,
			location.flow.language === "en"
				? "Flow has no active step."
				: "Flow 没有进行中的步骤。",
			"error",
			location.flow.language,
		);
	if (plan.sessionFile !== currentSessionFile(ctx)) {
		const { resumeFlow } = await import("./resume.js");
		return resumeFlow(pi, ctx);
	}
	const verifiedFlow = verifyCurrentSnapshot(ctx, location.dir, location.flow);
	if (!verifiedFlow) return;
	rememberFlowContext(ctx);
	if (await handleGoalCompletionEnd(pi, ctx)) return;
	await continueCurrentGoal(ctx);
}

export async function handleGoalCompletionEnd(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
) {
	const sessionFile = currentSessionFile(ctx);
	const fact = completionFact(sessionFile) ?? latestGoalCompletion(ctx);
	if (!fact) return false;
	const location = runningFlowOrNotify(ctx);
	if (!location) return false;
	const verifiedFlow = verifyCurrentSnapshot(ctx, location.dir, location.flow);
	if (!verifiedFlow) return false;
	const plan = currentGoal(verifiedFlow);
	if (!plan || plan.status !== "running") return false;
	if (
		plan.sessionFile &&
		fact.sessionFile &&
		plan.sessionFile !== fact.sessionFile
	)
		return false;
	deleteCompletionFact(fact.sessionFile);
	const saved = completeCurrentGoal(location.dir, verifiedFlow, fact);
	await liveReportUrl(
		ctx,
		join(location.dir, "flow.html"),
		verifiedFlow.language,
	).catch(() => undefined);
	clearCompletedGoalFromFlow(ctx);
	notifyUser(
		ctx,
		flowGoalCompleteNotice(plan.index, plan.title, verifiedFlow),
		"info",
		verifiedFlow.language,
	);
	if (saved.status === "complete") {
		closeFlowGoalWatcher();
		await sendFlowCompleteCard(pi, ctx, location.dir, saved);
		return true;
	}
	const flowContext =
		commandContextForAutoStart(ctx) ??
		rememberedFlowContext(plan.sessionFile ?? fact.sessionFile ?? sessionFile);
	if (!flowContext) {
		sendFlowResumeRequiredCard(pi, ctx, saved);
		notifyUser(
			ctx,
			saved.language === "en"
				? "Flow updated; run /flow continue to continue to the next step."
				: "Flow 已更新；运行 /flow continue 继续下一步。",
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

function flowGoalCompleteNotice(index: number, title: string, flow: FlowState) {
	const label = flowStepLabel(index, title, flow.language);
	return flow.language === "en"
		? `Flow ${label} complete.`
		: `Flow ${label} 已完成。`;
}

function sendFlowResumeRequiredCard(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	flow: FlowState,
) {
	const next = currentGoal(flow);
	if (!next) return;
	const label = flowStepLabel(next.index, next.title, flow.language);
	const title =
		flow.language === "en" ? `Flow ${label} ready` : `Flow ${label} 已就绪`;
	const lines =
		flow.language === "en"
			? [`Goal: ${next.title}`, "Next: /flow continue"]
			: [`目标：${next.title}`, "下一步：/flow continue"];
	sendResultCard(pi, ctx, [`[${title}]`, ...lines].join("\n"), {
		tone: "neutral",
		result: "启动",
		title,
		lines,
		language: flow.language,
	});
}

async function sendFlowCompleteCard(
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
	const summaryLines =
		flow.language === "en"
			? [`Flow: ${flow.title}`, `Completed: ${complete}/${total} steps`]
			: [`Flow：${flow.title}`, `已完成：${complete}/${total} 步`];
	const lines =
		flow.language === "en"
			? [...summaryLines, `Total time: ${totalTime}`]
			: [...summaryLines, `总耗时：${totalTime}`];
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

export function completeGoalWithFact(
	dir: string,
	flow: FlowState,
	goalIndex: number,
	fact: GoalCompletionFact,
) {
	const goal = flow.goals[goalIndex];
	const handoff = readOrGenerateHandoff(dir, goal, fact);
	const goals = replaceGoal(flow, goalIndex, {
		...goal,
		status: "complete",
		completionCursor: null,
		goalId: fact.goalId,
		result: {
			summary: fact.summary,
			handoff: handoff.text,
			handoffGenerated: handoff.generated,
			criteriaChanged: handoffHasCriteriaDeviation(handoff.text),
		},
		checks: fact.checks ?? goal.checks,
	});
	return { ...flow, goals };
}

function commandContextForAutoStart(
	ctx: ExtensionContext,
): ExtensionCommandContext | undefined {
	return typeof (ctx as { newSession?: unknown }).newSession === "function"
		? (ctx as ExtensionCommandContext)
		: undefined;
}
