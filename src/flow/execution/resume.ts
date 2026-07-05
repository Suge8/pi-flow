import { existsSync } from "node:fs";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { objectiveFromPlan } from "../../goal/validator.js";
import { getGoalState, startGoalFromFlow } from "../../goal.js";
import { runtimeLanguage } from "../../shared/language.js";
import { notifyUser } from "../../shared/ui-language.js";
import { latestGoalCompletion } from "../completion.js";
import { currentSessionFile } from "../ownership.js";
import { planGoalPrompt } from "../prompt.js";
import { rememberFlowContext } from "../runtime.js";
import { currentGoal, tryReadFlow } from "../store.js";
import type { FlowState } from "../types.js";
import { validateFlowDir } from "../validator.js";
import { handleGoalCompletionEnd } from "./continue.js";
import {
	continueCurrentGoal,
	flowCommandLanguage,
	runningFlowOrNotify,
	verifyCurrentSnapshot,
} from "./shared.js";
import {
	bindFlowReportStatus,
	prepareGoalStart,
	rollbackPreparedGoalStart,
	sendFlowGoalStartCard,
	startGoalInNewSession,
	startSelectedGoalInNewSession,
} from "./start.js";

export async function resumeFlow(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
) {
	const location = runningFlowOrNotify(ctx);
	if (location === null) return;
	if (!location) return notifyNoRunningFlow(ctx);
	const verifiedFlow = verifyCurrentSnapshot(ctx, location.dir, location.flow);
	if (!verifiedFlow) return;
	const plan = currentGoal(verifiedFlow);
	if (!plan)
		return notifyUser(
			ctx,
			flowNoActiveStepMessage(verifiedFlow.language),
			"error",
			verifiedFlow.language,
		);
	if (!plan.sessionFile || !existsSync(plan.sessionFile)) {
		if (plan.status === "complete")
			return notifyUser(
				ctx,
				verifiedFlow.language === "en"
					? "The step is complete, but no session record exists for handoff."
					: "步骤已完成，但缺少会话记录，无法交接。",
				"error",
				verifiedFlow.language,
			);
		return startMissingSessionGoal(
			pi,
			ctx,
			location.dir,
			verifiedFlow,
			verifiedFlow.currentGoal,
		);
	}
	if (plan.sessionFile === currentSessionFile(ctx)) {
		rememberFlowContext(ctx);
		return resumeInSession(pi, ctx, location.dir);
	}
	return ctx.switchSession(plan.sessionFile, {
		withSession: async (sessionCtx) => {
			rememberFlowContext(sessionCtx);
			await resumeInSession(pi, sessionCtx, location.dir);
		},
	});
}

function startMissingSessionGoal(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	goalIndex: number,
) {
	const goal = flow.goals[goalIndex];
	if (goal?.status === "pending" && flow.errors.length > 0)
		return startSelectedGoalInNewSession(pi, ctx, dir, flow, goalIndex);
	return startGoalInNewSession(pi, ctx, dir, flow, goalIndex);
}

async function resumeInSession(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	dir: string,
) {
	const language = tryReadFlow(dir)?.language ?? runtimeLanguage();
	const validation = validateFlowDir(dir, language);
	if (!validation.ok || !validation.flow) {
		return notifyUser(
			ctx,
			language === "en"
				? `Flow validation failed:\n${validation.errors.join("\n")}`
				: `Flow 校验失败：\n${validation.errors.join("\n")}`,
			"error",
			language,
		);
	}
	const verifiedFlow = verifyCurrentSnapshot(ctx, dir, validation.flow);
	if (!verifiedFlow) return;
	const plan = currentGoal(verifiedFlow);
	if (!plan)
		return notifyUser(
			ctx,
			flowNoActiveStepMessage(verifiedFlow.language),
			"error",
			verifiedFlow.language,
		);
	if (await handleGoalCompletionEnd(pi, ctx)) return;
	const goal = getGoalState(ctx);
	if (!goal && plan.status !== "complete") {
		const saved = prepareGoalStart(
			ctx,
			dir,
			verifiedFlow,
			verifiedFlow.currentGoal,
			pi,
		);
		await bindFlowReportStatus(ctx, dir, verifiedFlow.language);
		const savedGoal = saved.goals[saved.currentGoal];
		const snapshot = savedGoal.snapshot ?? "";
		const objective = objectiveFromPlan(snapshot) || savedGoal.title;
		sendFlowGoalStartCard(pi, ctx, saved, savedGoal, objective);
		const started = await startGoalFromFlow(
			{
				objective,
				prompt: planGoalPrompt(saved, savedGoal, snapshot),
			},
			ctx,
		);
		if (!started) rollbackPreparedGoalStart(dir, verifiedFlow);
		return;
	}
	if (!goal && plan.status === "complete" && !latestGoalCompletion(ctx)) {
		return notifyUser(
			ctx,
			verifiedFlow.language === "en"
				? "flow.json marks the step complete, but the session has no completion evidence."
				: "flow.json 标记步骤已完成，但会话里没有完成证据。",
			"error",
			verifiedFlow.language,
		);
	}
	await continueCurrentGoal(ctx);
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
