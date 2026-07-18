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
import { refreshFlowHtmlProjection } from "../html.js";
import { flowLockBusyMessage, withFlowLock } from "../lock.js";
import { currentSessionFile } from "../ownership.js";
import { deleteCompletionFact, rememberFlowContext } from "../runtime.js";
import { currentGoal, tryReadFlow, writeFlow } from "../store.js";
import type { FlowGoal, FlowState } from "../types.js";
import { replaceGoal } from "../util.js";
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

type GoalRecoveryRoute =
	| "complete_missing_handoff"
	| "restart_pure_start"
	| "start_pending"
	| "inspect_session"
	| "resume_existing"
	| "unrecoverable";

type InitialResumeDecision = {
	flow: FlowState;
	route: GoalRecoveryRoute | undefined;
	sessionExists: boolean;
};

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
		(): InitialResumeDecision | undefined => {
			const current = verifyCurrentSnapshot(ctx, location.dir, location.flow);
			if (!current) return undefined;
			const flow = current.parallelRun
				? resumePausedParallelFlow(current, location.dir)
				: current;
			const plan = currentGoal(flow);
			const sessionExists = plan ? goalSessionExists(plan) : false;
			return {
				flow,
				route: plan
					? classifyGoalRecovery(plan, sessionExists, undefined)
					: undefined,
				sessionExists,
			};
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
	const decision = verified.value;
	if (!decision) return;
	const { flow, route, sessionExists } = decision;
	if (flow.parallelRun)
		return startGoalInNewSession(pi, ctx, location.dir, flow, flow.currentGoal);
	const plan = currentGoal(flow);
	if (!plan)
		return notifyUser(
			ctx,
			flowNoActiveStepMessage(flow.language),
			"info",
			flow.language,
		);
	if (route === "complete_missing_handoff")
		return notifyUser(
			ctx,
			missingHandoffSessionNotice(flow.language),
			"info",
			flow.language,
		);
	if (route === "restart_pure_start")
		return restartMissingSessionGoal(ctx, location.dir, flow, plan.index);
	if (route === "unrecoverable")
		return pauseUnrecoverableGoal(ctx, location.dir, flow, plan.index);
	if (route === "start_pending" && !sessionExists)
		return flow.errors.length > 0
			? startSelectedGoalInNewSession(ctx, location.dir, flow, plan.index)
			: startGoalInNewSession(pi, ctx, location.dir, flow, plan.index);
	const sessionFile = plan.sessionFile;
	if (!sessionFile) return;
	if (sessionFile === currentSessionFile(ctx))
		return resumeInSession(pi, ctx, location.dir);
	return ctx.switchSession(sessionFile, {
		withSession: async (sessionCtx) => {
			await resumeInSession(undefined, sessionCtx, location.dir);
		},
	});
}

function resumePausedParallelFlow(flow: FlowState, dir: string) {
	if (flow.status !== "paused" || flow.startedAt === null) return flow;
	return writeFlow(dir, { ...flow, status: "running" });
}

function classifyGoalRecovery(
	goal: FlowGoal,
	sessionExists: boolean,
	runtimeExists: boolean | undefined,
): GoalRecoveryRoute {
	if (goal.status === "complete")
		return sessionExists ? "resume_existing" : "complete_missing_handoff";
	if (goal.status === "pending") {
		if (!sessionExists) return "start_pending";
		if (runtimeExists === undefined) return "inspect_session";
		return runtimeExists ? "unrecoverable" : "start_pending";
	}
	if (!sessionExists)
		return restartableMissingSessionGoal(goal)
			? "restart_pure_start"
			: "unrecoverable";
	if (runtimeExists === undefined) return "inspect_session";
	return runtimeExists ? "resume_existing" : "unrecoverable";
}

function goalSessionExists(goal: FlowGoal) {
	return goal.sessionFile !== null && existsSync(goal.sessionFile);
}

async function restartMissingSessionGoal(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	goalIndex: number,
) {
	const reset = await withFlowLock(
		dir,
		`reset missing session ${flow.id}`,
		() => {
			const validation = validateFlowDir(dir, flow.language);
			const current = validation.flow;
			const plan = current && currentGoal(current);
			if (
				!current ||
				plan?.index !== goalIndex ||
				classifyGoalRecovery(plan, goalSessionExists(plan), false) !==
					"restart_pure_start"
			)
				return undefined;
			return writeFlow(dir, {
				...current,
				attention: null,
				goals: replaceGoal(current, goalIndex, {
					...plan,
					status: "pending",
					sessionFile: null,
					sessionName: null,
				}),
			});
		},
	);
	if (!reset.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(reset.owner, flow.language),
			"info",
			flow.language,
		);
		return false;
	}
	return reset.value
		? startSelectedGoalInNewSession(ctx, dir, reset.value, goalIndex)
		: false;
}

function restartableMissingSessionGoal(goal: FlowGoal) {
	return (
		goal.status === "running" &&
		goal.goalId === null &&
		goal.completionCursor === null &&
		goal.result.summary === null &&
		goal.result.handoff === null &&
		!goal.result.handoffGenerated &&
		!goal.result.criteriaChanged &&
		goal.pendingAdvisor === null &&
		Object.keys(goal.checkAttribution ?? {}).length === 0 &&
		goal.checks.acceptance.rounds.length === 0 &&
		goal.checks.acceptance.active === null &&
		goal.checks.quality.rounds.length === 0 &&
		goal.checks.quality.active === null
	);
}

type InterruptedFlow = {
	flow: FlowState;
	changed: boolean;
};

type SessionResumeResult =
	| { kind: "continue"; flow: FlowState; runtimeExists: boolean }
	| { kind: "interrupted"; interruption: InterruptedFlow }
	| { kind: "missing_handoff"; flow: FlowState }
	| { kind: "done" };

async function resumeInSession(
	pi: ExtensionAPI | undefined,
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
	const resumed = await withFlowLock(
		dir,
		`resume ${validation.flow.id}`,
		async (): Promise<SessionResumeResult> => {
			const latest = validateFlowDir(dir, validation.flow.language);
			if (!latest.ok || !latest.flow) {
				notifyUser(
					ctx,
					flowValidationFailedNotice(latest.errors, validation.flow.language),
					"info",
					validation.flow.language,
				);
				return { kind: "done" };
			}
			const current = verifyCurrentSnapshot(ctx, dir, latest.flow);
			const plan = current && currentGoal(current);
			if (!current || !plan) return { kind: "done" };
			const runtimeExists = runtimeMatchesGoal(getGoalState(ctx), plan);
			const route = classifyGoalRecovery(
				plan,
				goalSessionExists(plan),
				runtimeExists,
			);
			if (route === "complete_missing_handoff")
				return { kind: "missing_handoff", flow: current };
			if (route === "unrecoverable")
				return {
					kind: "interrupted",
					interruption: commitLostGoalInterruption(dir, current),
				};
			if (route === "start_pending") {
				rememberFlowContext(ctx);
				const saved = prepareGoalStart(
					ctx,
					dir,
					{ ...current, attention: null },
					current.currentGoal,
				);
				await bindFlowReportStatus(ctx, dir, saved.language);
				await startPreparedGoalWithLockHeld(
					ctx,
					dir,
					current,
					saved,
					saved.currentGoal,
					pi,
					true,
				);
				return { kind: "done" };
			}
			if (route !== "resume_existing") return { kind: "done" };
			rememberFlowContext(ctx);
			return {
				kind: "continue",
				flow: resumeRecoverableFlow(dir, current),
				runtimeExists,
			};
		},
	);
	if (!resumed.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(resumed.owner, validation.flow.language),
			"info",
			validation.flow.language,
		);
		return;
	}
	const action = resumed.value;
	if (action.kind === "done") return;
	if (action.kind === "missing_handoff")
		return notifyUser(
			ctx,
			missingHandoffSessionNotice(action.flow.language),
			"info",
			action.flow.language,
		);
	if (action.kind === "interrupted")
		return finishLostGoalInterruption(ctx, dir, action.interruption);
	const plan = currentGoal(action.flow);
	if (
		!action.runtimeExists &&
		plan?.status === "complete" &&
		!latestGoalCompletion(ctx)
	)
		return notifyUser(
			ctx,
			missingCompletionEvidenceNotice(action.flow.language),
			"info",
			action.flow.language,
		);
	const result = await continueCurrentGoal(ctx);
	if (result === "resumed" || result === "continued")
		recordResumeCompletionBoundary(ctx);
}

function runtimeMatchesGoal(
	runtime: ReturnType<typeof getGoalState>,
	goal: FlowGoal,
) {
	return Boolean(
		runtime && (goal.goalId === null || runtime.id === goal.goalId),
	);
}

function resumeRecoverableFlow(dir: string, flow: FlowState) {
	if (flow.status !== "paused" || flow.startedAt === null) return flow;
	return writeFlow(dir, { ...flow, status: "running", attention: null });
}

async function pauseUnrecoverableGoal(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
	goalIndex: number,
) {
	const interrupted = await withFlowLock(
		dir,
		`interrupt lost session ${flow.id}`,
		() => {
			const validation = validateFlowDir(dir, flow.language);
			const current = validation.flow;
			const plan = current && currentGoal(current);
			if (
				!current ||
				current.id !== flow.id ||
				current.currentGoal !== goalIndex ||
				!plan ||
				goalSessionExists(plan) ||
				classifyGoalRecovery(plan, false, false) !== "unrecoverable"
			)
				return undefined;
			return commitLostGoalInterruption(dir, current);
		},
	);
	if (!interrupted.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(interrupted.owner, flow.language),
			"info",
			flow.language,
		);
		return;
	}
	if (interrupted.value)
		finishLostGoalInterruption(ctx, dir, interrupted.value);
}

function commitLostGoalInterruption(
	dir: string,
	flow: FlowState,
): InterruptedFlow {
	const message = lostGoalAttentionMessage(flow.language);
	const matchingAttention =
		flow.attention?.kind === "interrupted" && flow.attention.message === message
			? flow.attention
			: undefined;
	if (flow.status === "paused" && matchingAttention)
		return { flow, changed: false };
	return {
		flow: writeFlow(dir, {
			...flow,
			status: "paused",
			attention: {
				kind: "interrupted",
				message,
				at: matchingAttention?.at ?? Date.now(),
			},
		}),
		changed: true,
	};
}

function finishLostGoalInterruption(
	ctx: ExtensionCommandContext,
	dir: string,
	interruption: InterruptedFlow,
) {
	if (interruption.changed)
		refreshFlowHtmlProjection(ctx, dir, interruption.flow);
	notifyUser(
		ctx,
		lostGoalSessionNotice(interruption.flow),
		"info",
		interruption.flow.language,
	);
}

function lostGoalAttentionMessage(language: "zh" | "en") {
	return language === "en"
		? "The step's original session record is missing or incomplete; automatic recovery is unsafe"
		: "步骤的原会话记录缺失或不完整，无法安全自动恢复";
}

function lostGoalSessionNotice(flow: FlowState) {
	const command = `/flow go ${flow.id}`;
	return flow.language === "en"
		? formatUserNotice("⚠️", "Flow needs your help", [
				"The step's original session record is missing or incomplete",
				`Restore the original session record, then run ${command} again`,
				"Or create a new Flow from the current plan and workspace",
			])
		: formatUserNotice("⚠️", "Flow 需要你接管", [
				"步骤的原会话记录缺失或不完整",
				`恢复原会话记录后，再运行 ${command}`,
				"或基于现有计划和仓库创建新 Flow",
			]);
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
