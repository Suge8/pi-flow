import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	artifactChecks,
	writeStepRuntimeState,
} from "../../goal/persistence.js";
import { objectiveFromPlan } from "../../goal/validator.js";
import { startGoalFromFlow } from "../../goal.js";
import { formatError } from "../../shared/guards.js";
import { runtimeLanguage } from "../../shared/language.js";
import { notifyUser } from "../../shared/ui-language.js";
import { onFlowGoalCompleted } from "../completion.js";
import { currentSessionFile } from "../ownership.js";
import { planGoalPrompt } from "../prompt.js";
import { findFlow } from "../store.js";
import type { FlowGoal, FlowState, GoalCompletionFact } from "../types.js";
import { flowSessionName } from "../util.js";
import { validateFlowDir } from "../validator.js";
import { flowNotFoundMessage, flowStatusLabel } from "./shared.js";

interface WorkerJob {
	resultPath: string;
	completed: boolean;
}

const workerContexts = new WeakSet<object>();
const workerJobs = new WeakMap<object, WorkerJob>();
const workerJobsBySession = new Map<string, WorkerJob>();
const workerSessionFiles = new Set<string>();
let completionListenerRegistered = false;

export function registerWorkerCommand(pi: ExtensionAPI) {
	void pi;
	if (completionListenerRegistered) return;
	completionListenerRegistered = true;
	onFlowGoalCompleted((fact, ctx) => writeWorkerResult(ctx, fact));
}

export function isWorkerContext(ctx: unknown) {
	if (typeof ctx !== "object" || ctx === null) return false;
	if (workerContexts.has(ctx)) return true;
	const sessionFile = workerSessionFile(ctx);
	return Boolean(sessionFile && workerSessionFiles.has(sessionFile));
}

export async function runWorkerCommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	args: string[],
) {
	if (args.length !== 2)
		return notifyUser(ctx, workerUsageMessage(runtimeLanguage()), "warning");
	const [flowId, goalIndexText] = args;
	const goalIndex = parseGoalIndex(goalIndexText);
	if (goalIndex === undefined)
		return notifyUser(ctx, workerUsageMessage(runtimeLanguage()), "warning");
	try {
		const location = findFlow(ctx.cwd, flowId);
		if (!location)
			return notifyUser(
				ctx,
				flowNotFoundMessage(flowId, runtimeLanguage()),
				"warning",
			);
		const validation = validateFlowDir(location.dir, location.flow.language);
		if (!validation.ok || !validation.flow)
			return notifyUser(
				ctx,
				validationFailedMessage(validation.errors, location.flow.language),
				"error",
				location.flow.language,
			);
		return startWorkerGoal(pi, ctx, location.dir, validation.flow, goalIndex);
	} catch (error) {
		return notifyUser(
			ctx,
			workerStartFailedMessage(formatError(error), runtimeLanguage()),
			"error",
		);
	}
}

async function startWorkerGoal(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	flowDir: string,
	flow: FlowState,
	goalIndex: number,
) {
	if (flow.status === "complete" || flow.status === "cancelled")
		return notifyUser(
			ctx,
			flowNotRunnableMessage(flow, goalIndex),
			"warning",
			flow.language,
		);
	const goal = flow.goals[goalIndex];
	if (!goal)
		return notifyUser(
			ctx,
			goalNotFoundMessage(goalIndex, flow.language),
			"warning",
			flow.language,
		);
	if (goal.status === "complete")
		return notifyUser(
			ctx,
			goalAlreadyCompleteMessage(goal, flow.language),
			"warning",
			flow.language,
		);
	const workerId = `G${goalIndex}`;
	const workerDir = join(flowDir, "workers", workerId);
	mkdirSync(workerDir, { recursive: true });
	const sessionPath = join(workerDir, "session.jsonl");
	if (currentSessionFile(ctx) !== sessionPath) {
		let started = false;
		const result = await ctx.switchSession(sessionPath, {
			withSession: async (sessionCtx) => {
				started = Boolean(
					await startWorkerGoal(pi, sessionCtx, flowDir, flow, goalIndex),
				);
			},
		});
		return started && !result.cancelled;
	}
	const resultPath = join(workerDir, "result.json");
	const planPath = join(workerDir, "plan.md");
	const markdown = readFileSync(join(flowDir, goal.file), "utf8");
	writeFileSync(planPath, markdown);
	rmSync(resultPath, { force: true });
	const sessionName = flowSessionName(flow, goal);
	setSessionName(pi, ctx, sessionName);
	writeWorkerGoalArtifact(ctx, workerDir, goal, sessionName);
	setWorkerJob(ctx, { resultPath, completed: false });
	const promptGoal = { ...goal, file: `workers/${workerId}/plan.md` };
	const started = await startGoalFromFlow(
		{
			objective: objectiveFromPlan(markdown) || goal.title,
			prompt: planGoalPrompt(
				workerPromptFlow(flow, promptGoal),
				promptGoal,
				markdown,
			),
		},
		ctx,
		{
			artifact: { artifactDir: workerDir, artifactId: workerId },
			rememberFlowContext: false,
		},
	);
	if (!started) clearWorkerJob(ctx);
	return started;
}

function writeWorkerGoalArtifact(
	ctx: ExtensionCommandContext,
	workerDir: string,
	goal: FlowGoal,
	sessionName: string,
) {
	const now = Date.now();
	writeStepRuntimeState(workerDir, {
		status: "running",
		completionCursor: null,
		runtimeGoalId: null,
		sessionFile: currentSessionFile(ctx) ?? null,
		sessionName,
		result: { summary: null, outcome: null },
		checks: artifactChecks([], [], goal.checks),
		updatedAt: now,
	});
}

function workerPromptFlow(flow: FlowState, promptGoal: FlowGoal) {
	return {
		...flow,
		goals: flow.goals.map((item) =>
			item.index === promptGoal.index ? promptGoal : item,
		),
	};
}

function writeWorkerResult(ctx: object | undefined, fact: GoalCompletionFact) {
	if (!ctx || !isWorkerContext(ctx)) return;
	const job = workerJob(ctx);
	if (!job || job.completed) return;
	const tmpPath = `${job.resultPath}.tmp`;
	writeFileSync(tmpPath, `${JSON.stringify(fact, null, 2)}\n`);
	renameSync(tmpPath, job.resultPath);
	setWorkerJob(ctx, { ...job, completed: true });
}

function setWorkerJob(ctx: object, job: WorkerJob) {
	workerContexts.add(ctx);
	workerJobs.set(ctx, job);
	const sessionFile = workerSessionFile(ctx);
	if (!sessionFile) return;
	workerSessionFiles.add(sessionFile);
	workerJobsBySession.set(sessionFile, job);
}

function clearWorkerJob(ctx: object) {
	workerJobs.delete(ctx);
	const sessionFile = workerSessionFile(ctx);
	if (sessionFile) workerJobsBySession.delete(sessionFile);
}

function workerJob(ctx: object) {
	return workerJobs.get(ctx) ?? workerJobBySession(ctx);
}

function workerJobBySession(ctx: object) {
	const sessionFile = workerSessionFile(ctx);
	return sessionFile ? workerJobsBySession.get(sessionFile) : undefined;
}

function workerSessionFile(ctx: object) {
	return currentSessionFile(ctx as { sessionManager?: unknown });
}

function setSessionName(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	name: string,
) {
	try {
		pi.setSessionName?.(name);
		return;
	} catch (error) {
		if (!formatError(error).includes("stale")) throw error;
	}
	const sessionManager = ctx.sessionManager as
		| { appendSessionInfo?: (name: string) => unknown }
		| undefined;
	sessionManager?.appendSessionInfo?.(name);
}

function parseGoalIndex(value: string) {
	if (!/^\d+$/u.test(value)) return undefined;
	return Number(value);
}

function workerUsageMessage(language: "zh" | "en") {
	return language === "en"
		? "Usage: /flow worker <flowId> <goalIndex>"
		: "用法：/flow worker <flowId> <goalIndex>";
}

function validationFailedMessage(errors: string[], language: "zh" | "en") {
	return language === "en"
		? `Flow validation failed:\n${errors.join("\n")}`
		: `Flow 校验失败：\n${errors.join("\n")}`;
}

function workerStartFailedMessage(error: string, language: "zh" | "en") {
	return language === "en"
		? `Flow worker start failed: ${error}`
		: `Flow worker 启动失败：${error}`;
}

function flowNotRunnableMessage(flow: FlowState, goalIndex: number) {
	const status = flowStatusLabel(flow.status, flow.language);
	return flow.language === "en"
		? `${flow.id} status: ${status}; cannot start worker ${goalIndex}.`
		: `${flow.id} 当前状态：${status}，不能启动 worker ${goalIndex}。`;
}

function goalNotFoundMessage(goalIndex: number, language: "zh" | "en") {
	return language === "en"
		? `Flow step index out of range: ${goalIndex}`
		: `Flow 步骤下标超出范围：${goalIndex}`;
}

function goalAlreadyCompleteMessage(goal: FlowGoal, language: "zh" | "en") {
	const label = goal.index + 1;
	return language === "en"
		? `Flow step ${label} is already complete.`
		: `Flow 第 ${label} 步已完成。`;
}
