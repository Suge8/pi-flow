import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
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
import type { FlowGoal, FlowState, GoalCompletionFact } from "../types.js";
import { flowSessionName } from "../util.js";
import { validateFlowDir } from "../validator.js";
import { flowStatusLabel } from "./shared.js";
import {
	type PrivateWorkerControl,
	type PrivateWorkerJob,
	privateWorkerControlFromEnv,
	privateWorkerMessage,
	samePrivateWorkerJob,
} from "./worker-protocol.js";

interface WorkerJob {
	resultPath: string;
	completed: boolean;
	parallelRunId?: string;
	finishPrivateWorker?: () => void;
}

const workerContexts = new WeakSet<object>();
const workerJobs = new WeakMap<object, WorkerJob>();
const workerJobsBySession = new Map<string, WorkerJob>();
const workerSessionFiles = new Set<string>();
let completionListenerRegistered = false;

export function registerWorkerRuntime(pi: ExtensionAPI) {
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

export async function startPrivateWorkerFromEnv(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
) {
	let control: PrivateWorkerControl | undefined;
	try {
		control = privateWorkerControlFromEnv();
	} catch (error) {
		notifyUser(
			ctx,
			workerStartFailedMessage(formatError(error), runtimeLanguage()),
			"error",
		);
		return exitPrivateWorker();
	}
	if (!control) return false;
	try {
		const connection = await connectPrivateWorkerControl(control);
		const validation = validateFlowDir(control.flowDir, runtimeLanguage());
		if (!validation.ok || !validation.flow) {
			notifyUser(
				ctx,
				validationFailedMessage(
					validation.errors,
					validation.flow?.language ?? runtimeLanguage(),
				),
				"error",
				validation.flow?.language,
			);
			return exitPrivateWorker();
		}
		if (validation.flow.id !== control.flowId)
			throw new Error(`Private worker flow mismatch: ${validation.flow.id}.`);
		const started = await startWorkerGoal(
			pi,
			ctx as ExtensionCommandContext,
			control.flowDir,
			validation.flow,
			control.goalIndex,
			control,
			connection.finish,
		);
		if (!started) return exitPrivateWorker();
		return true;
	} catch (error) {
		notifyUser(
			ctx,
			workerStartFailedMessage(formatError(error), runtimeLanguage()),
			"error",
		);
		return exitPrivateWorker();
	}
}

async function startWorkerGoal(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	flowDir: string,
	flow: FlowState,
	goalIndex: number,
	privateJob?: PrivateWorkerJob,
	finishPrivateWorker?: () => void,
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
	if (privateJob)
		validatePrivateWorkerJob(privateJob, flow, flowDir, sessionPath);
	if (currentSessionFile(ctx) !== sessionPath) {
		let started = false;
		const result = await ctx.switchSession(sessionPath, {
			withSession: async (sessionCtx) => {
				started = Boolean(
					await startWorkerGoal(
						pi,
						sessionCtx,
						flowDir,
						flow,
						goalIndex,
						privateJob,
						finishPrivateWorker,
					),
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
	setWorkerJob(ctx, {
		resultPath,
		completed: false,
		parallelRunId:
			privateJob?.parallelRunId ?? workerParallelRunId(flow, goalIndex),
		finishPrivateWorker,
	});
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

function workerParallelRunId(flow: FlowState, goalIndex: number) {
	return flow.parallelRun?.goalIndexes.includes(goalIndex)
		? flow.parallelRun.id
		: undefined;
}

function validatePrivateWorkerJob(
	job: PrivateWorkerJob,
	flow: FlowState,
	flowDir: string,
	sessionPath: string,
) {
	if (job.flowId !== flow.id)
		throw new Error("Private worker flow id mismatch.");
	if (job.flowDir !== flowDir)
		throw new Error("Private worker flow dir mismatch.");
	if (job.sessionPath !== sessionPath)
		throw new Error("Private worker session path mismatch.");
	if (job.parallelRunId !== workerParallelRunId(flow, job.goalIndex))
		throw new Error("Private worker parallel run mismatch.");
}

function writeWorkerResult(ctx: object | undefined, fact: GoalCompletionFact) {
	if (!ctx || !isWorkerContext(ctx)) return;
	const job = workerJob(ctx);
	if (!job || job.completed) return;
	const result = job.parallelRunId
		? { ...fact, parallelRunId: job.parallelRunId }
		: fact;
	const tmpPath = `${job.resultPath}.tmp`;
	writeFileSync(tmpPath, `${JSON.stringify(result, null, 2)}\n`);
	renameSync(tmpPath, job.resultPath);
	setWorkerJob(ctx, { ...job, completed: true });
	job.finishPrivateWorker?.();
	if (job.finishPrivateWorker) setImmediate(() => process.exit(0));
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

function connectPrivateWorkerControl(control: PrivateWorkerControl) {
	return new Promise<{ finish: () => void }>((resolve, reject) => {
		const socket = createConnection(control.socketPath);
		let buffer = "";
		let settled = false;
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			reject(error instanceof Error ? error : new Error(formatError(error)));
		};
		socket.once("connect", () => {
			socket.write(
				privateWorkerMessage({ type: "hello", token: control.token }),
			);
		});
		socket.on("data", (chunk) => {
			buffer += chunk;
			const newline = buffer.indexOf("\n");
			if (newline === -1) return;
			const job = privateWorkerStartJob(buffer.slice(0, newline));
			if (!job || !samePrivateWorkerJob(job, control))
				return fail(new Error("Private worker control rejected the job."));
			settled = true;
			const finish = stopWhenPrivateControlCloses(socket);
			resolve({ finish });
		});
		socket.once("error", fail);
		socket.once("close", () =>
			fail(new Error("Private worker control closed.")),
		);
	});
}

function privateWorkerStartJob(line: string): PrivateWorkerJob | undefined {
	try {
		const message = JSON.parse(line) as { type?: unknown; job?: unknown };
		const job = message.job as Partial<PrivateWorkerJob> | undefined;
		if (message.type !== "start" || !job) return undefined;
		if (
			typeof job.flowId !== "string" ||
			typeof job.flowDir !== "string" ||
			typeof job.goalIndex !== "number" ||
			typeof job.parallelRunId !== "string" ||
			typeof job.sessionPath !== "string"
		)
			return undefined;
		return {
			flowId: job.flowId,
			flowDir: job.flowDir,
			goalIndex: job.goalIndex,
			parallelRunId: job.parallelRunId,
			sessionPath: job.sessionPath,
		};
	} catch {
		return undefined;
	}
}

function stopWhenPrivateControlCloses(socket: Socket) {
	let active = true;
	const stop = () => {
		if (!active) return;
		active = false;
		process.exit(1);
	};
	socket.once("close", stop);
	socket.once("error", stop);
	return () => {
		if (!active) return;
		active = false;
		socket.off("close", stop);
		socket.off("error", stop);
		socket.destroy();
	};
}

function exitPrivateWorker() {
	process.exit(1);
	return true;
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
