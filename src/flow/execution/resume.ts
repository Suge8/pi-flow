import { existsSync } from "node:fs";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { getGoalState } from "../../goal.js";
import { runtimeLanguage } from "../../shared/language.js";
import { notifyUser } from "../../shared/ui-language.js";
import { latestGoalCompletion } from "../completion.js";
import { flowLockBusyMessage, withFlowLock } from "../lock.js";
import { currentSessionFile } from "../ownership.js";
import { rememberFlowContext } from "../runtime.js";
import { currentGoal, tryReadFlow } from "../store.js";
import type { FlowState } from "../types.js";
import { validateFlowDir } from "../validator.js";
import { handleGoalCompletionEnd } from "./continue.js";
import {
	continueCurrentGoal,
	flowTargetOrNotify,
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
	const location = flowTargetOrNotify(ctx, { id, command: "continue" });
	if (!location) return;
	const verified = await withFlowLock(
		location.dir,
		`verify ${location.flow.id}`,
		() => verifyCurrentSnapshot(ctx, location.dir, location.flow),
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
	const verified = await withFlowLock(dir, `verify ${validation.flow.id}`, () =>
		verifyCurrentSnapshot(ctx, dir, validation.flow),
	);
	if (!verified.ok) {
		notifyUser(
			ctx,
			flowLockBusyMessage(verified.owner, validation.flow.language),
			"warning",
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
			"error",
			verifiedFlow.language,
		);
	if (await handleGoalCompletionEnd(pi, ctx)) return;
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
						verifiedFlow.language === "en"
							? `Flow validation failed:\n${validation.errors.join("\n")}`
							: `Flow 校验失败：\n${validation.errors.join("\n")}`,
						"error",
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
				"warning",
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
			verifiedFlow.language === "en"
				? "flow.json marks the step complete, but the session has no completion evidence."
				: "flow.json 标记步骤已完成，但会话里没有完成证据。",
			"error",
			verifiedFlow.language,
		);
	}
	await continueCurrentGoal(ctx);
}

function flowNoActiveStepMessage(language: "zh" | "en") {
	return language === "en"
		? "Flow has no active step."
		: "Flow 没有进行中的步骤。";
}
