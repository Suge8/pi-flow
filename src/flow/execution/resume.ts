import { existsSync } from "node:fs";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getGoalState } from "../../goal.js";
import { runtimeLanguage } from "../../shared/language.js";
import { formatUserNotice, notifyUser } from "../../shared/ui-language.js";
import {
	latestGoalCompletion,
	recordFlowGoalCompletionBoundary,
} from "../completion.js";
import { flowLockBusyMessage, withFlowLock } from "../lock.js";
import { currentSessionFile } from "../ownership.js";
import { deleteCompletionFact, rememberFlowContext } from "../runtime.js";
import { currentGoal, tryReadFlow, writeFlow } from "../store.js";
import type { FlowState } from "../types.js";
import { validateFlowDir } from "../validator.js";
import {
	continueCurrentGoal,
	flowNoActiveStepMessage,
	flowTargetOrNotify,
	flowValidationFailedNotice,
	verifyCurrentSnapshot,
} from "./shared.js";
import {
	bindFlowReportStatus,
	prepareGoalStart,
	startGoalInNewSession,
	startPreparedGoalWithLockHeld,
	startSelectedGoalInNewSession,
} from "./start.js";

export async function resumeFlow(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	id?: string,
) {
	const location = flowTargetOrNotify(ctx, {
		id,
		command: "go",
		requireRunning: false,
	});
	if (!location) return;
	const verified = await withFlowLock(
		location.dir,
		`verify ${location.flow.id}`,
		() =>
			resumePausedFlowState(
				verifyCurrentSnapshot(ctx, location.dir, location.flow),
				location.dir,
			),
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
	const plan = currentGoal(verifiedFlow);
	if (!plan)
		return notifyUser(
			ctx,
			flowNoActiveStepMessage(verifiedFlow.language),
			"info",
			verifiedFlow.language,
		);
	if (!plan.sessionFile || !existsSync(plan.sessionFile)) {
		if (plan.status === "complete")
			return notifyUser(
				ctx,
				missingHandoffSessionNotice(verifiedFlow.language),
				"info",
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

function resumePausedFlowState(flow: FlowState | undefined, dir: string) {
	if (!flow || flow.status !== "paused" || flow.startedAt === null) return flow;
	return writeFlow(dir, { ...flow, status: "running" });
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
			flowValidationFailedNotice(validation.errors, language),
			"info",
			language,
		);
	}
	const verified = await withFlowLock(dir, `verify ${validation.flow.id}`, () =>
		resumePausedFlowState(
			verifyCurrentSnapshot(ctx, dir, validation.flow),
			dir,
		),
	);
	if (!verified.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(verified.owner, validation.flow.language),
			"info",
			validation.flow.language,
		);
		return;
	}
	const verifiedFlow = verified.value;
	if (!verifiedFlow) return;
	const plan = currentGoal(verifiedFlow);
	if (!plan)
		return notifyUser(
			ctx,
			flowNoActiveStepMessage(verifiedFlow.language),
			"info",
			verifiedFlow.language,
		);
	const goal = getGoalState(ctx);
	if (!goal && plan.status !== "complete") {
		const prepared = await withFlowLock(
			dir,
			`resume ${verifiedFlow.id}`,
			async () => {
				const validation = validateFlowDir(dir, verifiedFlow.language);
				if (!validation.ok || !validation.flow) {
					notifyUser(
						ctx,
						flowValidationFailedNotice(
							validation.errors,
							verifiedFlow.language,
						),
						"info",
						verifiedFlow.language,
					);
					return false;
				}
				const current = verifyCurrentSnapshot(ctx, dir, validation.flow);
				if (!current || currentGoal(current)?.status === "complete")
					return false;
				const saved = prepareGoalStart(ctx, dir, current, current.currentGoal);
				await bindFlowReportStatus(ctx, dir, saved.language);
				return startPreparedGoalWithLockHeld(
					ctx,
					dir,
					current,
					saved,
					saved.currentGoal,
					pi,
					true,
				);
			},
		);
		if (!prepared.ok) {
			notifyUser(
				ctx,
				flowLockBusyMessage(prepared.owner, verifiedFlow.language),
				"info",
				verifiedFlow.language,
			);
			return;
		}
		if (!prepared.value) return;
		return;
	}
	if (!goal && plan.status === "complete" && !latestGoalCompletion(ctx)) {
		return notifyUser(
			ctx,
			missingCompletionEvidenceNotice(verifiedFlow.language),
			"info",
			verifiedFlow.language,
		);
	}
	const result = await continueCurrentGoal(ctx);
	if (result === "resumed" || result === "continued")
		recordResumeCompletionBoundary(ctx);
}

function recordResumeCompletionBoundary(ctx: ExtensionCommandContext) {
	const goal = getGoalState(ctx);
	const sessionFile = currentSessionFile(ctx);
	if (!goal || !sessionFile) return;
	deleteCompletionFact(sessionFile);
	recordFlowGoalCompletionBoundary(ctx, {
		reason: "resume",
		expectedGoalId: goal.id,
	});
}

function missingHandoffSessionNotice(language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("⚠️", "Flow cannot hand off", [
				"The step is complete",
				"No session record exists for handoff",
			])
		: formatUserNotice("⚠️", "Flow 无法交接", ["步骤已完成", "缺少会话记录"]);
}

function missingCompletionEvidenceNotice(language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("⚠️", "Flow cannot resume", [
				"flow.json marks the step complete",
				"The session has no completion evidence",
			])
		: formatUserNotice("⚠️", "Flow 无法恢复", [
				"flow.json 标记步骤已完成",
				"会话里没有完成证据",
			]);
}
