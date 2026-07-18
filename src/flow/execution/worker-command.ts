import { readFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { objectiveFromPlan } from "../../goal/validator.js";
import {
	continueActiveGoalFromCheckpoint,
	startGoalFromFlow,
} from "../../goal.js";
import { formatError } from "../../shared/guards.js";
import { runtimeLanguage } from "../../shared/language.js";
import { formatUserNotice, notifyUser } from "../../shared/ui-language.js";
import { onFlowGoalCompleted } from "../completion.js";
import {
	type FlowGoalBlockedHandoff,
	onFlowGoalBlocked,
} from "../goal-events.js";
import { currentSessionFile } from "../ownership.js";
import {
	initWorkerArtifact,
	readWorkerArtifact,
	resumableWorkerCursor,
	workerArtifactPath,
	writeWorkerCompletion,
} from "../parallel/worker-artifact.js";
import { planGoalPrompt } from "../prompt.js";
import type { FlowGoal, FlowState, GoalCompletionFact } from "../types.js";
import { flowSessionName } from "../util.js";
import { validateFlowDir } from "../validator.js";
import { flowStatusLabel } from "./shared.js";
import {
	PRIVATE_WORKER_ENV,
	type PrivateWorkerControl,
	type PrivateWorkerJob,
	privateWorkerControlFromEnv,
	privateWorkerMessage,
	samePrivateWorkerJob,
} from "./worker-protocol.js";

interface WorkerJob {
	flowDir: string;
	goalIndex: number;
	settled: boolean;
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
	onFlowGoalBlocked((handoff, ctx) => finishBlockedWorker(ctx, handoff));
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
	void pi;
	let control: PrivateWorkerControl | undefined;
	try {
		control = privateWorkerControlFromEnv();
	} catch (error) {
		notifyUser(
			ctx,
			workerStartFailedMessage(formatError(error), runtimeLanguage()),
			"info",
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
				"info",
				validation.flow?.language,
			);
			return exitPrivateWorker();
		}
		if (validation.flow.id !== control.flowId)
			throw new Error(`Private worker flow mismatch: ${validation.flow.id}.`);
		const started = await startWorkerGoal(
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
			"info",
		);
		return exitPrivateWorker();
	}
}

async function startWorkerGoal(
	ctx: ExtensionCommandContext,
	flowDir: string,
	flow: FlowState,
	goalIndex: number,
	privateJob?: PrivateWorkerJob,
	finishPrivateWorker?: () => void,
) {
	if (flow.status === "complete" || flow.status === "paused")
		return notifyUser(
			ctx,
			flowNotRunnableMessage(flow, goalIndex),
			"info",
			flow.language,
		);
	const goal = flow.goals[goalIndex];
	if (!goal)
		return notifyUser(
			ctx,
			goalNotFoundMessage(goalIndex, flow.language),
			"info",
			flow.language,
		);
	if (goal.status === "complete")
		return notifyUser(
			ctx,
			goalAlreadyCompleteMessage(goal, flow.language),
			"info",
			flow.language,
		);
	const workerId = `G${goalIndex + 1}`;
	const sessionPath = privateJob?.sessionPath ?? goal.sessionFile;
	if (!sessionPath) throw new Error("Private worker session path is missing.");
	if (privateJob) validatePrivateWorkerJob(privateJob, flow, flowDir);
	if (currentSessionFile(ctx) !== sessionPath) {
		let started = false;
		const result = await ctx.switchSession(sessionPath, {
			withSession: async (sessionCtx) => {
				started = Boolean(
					await startWorkerGoal(
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
	const parallelRunId =
		privateJob?.parallelRunId ?? workerParallelRunId(flow, goalIndex);
	if (!parallelRunId)
		throw new Error("Private worker parallel run is missing.");
	const input = workerGoalInput(flowDir, flow, goalIndex);
	const sessionName = flowSessionName(flow, goal);
	const resumeCheck =
		privateJob !== undefined &&
		workerUsesInitialPrompt() &&
		resumableWorkerCursor(
			readWorkerArtifact(flowDir, goalIndex),
			parallelRunId,
		) !== null;
	setSessionName(ctx, sessionName);
	initWorkerArtifact(flowDir, flow, goalIndex, {
		parallelRunId,
		sessionFile: sessionPath,
		sessionName,
	});
	setWorkerJob(ctx, {
		flowDir,
		goalIndex,
		settled: false,
		parallelRunId,
		finishPrivateWorker,
	});
	const started = await startGoalFromFlow(
		{ objective: input.objective, prompt: input.prompt },
		ctx,
		{
			artifact: {
				artifactId: workerId,
				artifactPlanPath: join(flowDir, goal.file),
				artifactPlanDisplayPath: `.flow/${flow.id}/${goal.file}`,
				artifactStatePath: workerArtifactPath(flowDir, goalIndex),
				artifactStateDisplayPath: `${workerId}-worker.json`,
			},
			rememberFlowContext: false,
			sendPrompt: !workerUsesInitialPrompt(),
		},
	);
	if (!started) clearWorkerJob(ctx);
	else if (
		resumeCheck &&
		(await continueActiveGoalFromCheckpoint(ctx)) !== "continued"
	)
		throw new Error("Worker check checkpoint is not resumable.");
	return started;
}

/**
 * respawn 时的 CLI 初始 prompt：检查/收口阶段禁止重新投递执行 prompt
 * （会导致重复执行），改发 hold 指令；检查本身由 worker bootstrap 按 cursor 续跑。
 */
export function workerInitialPrompt(
	flowDir: string,
	flow: FlowState,
	goalIndex: number,
	options: { forkedFromPlanSession?: boolean } = {},
) {
	const cursor = resumableWorkerCursor(
		readWorkerArtifact(flowDir, goalIndex),
		flow.parallelRun?.id ?? "",
	);
	if (cursor === null)
		return workerGoalInput(flowDir, flow, goalIndex, options).prompt;
	return flow.language === "en"
		? "The orchestration system is resuming this step's checks from a durable checkpoint. Do not perform any actions or modify any files. Reply exactly: waiting for settlement."
		: "编排系统正在从断点恢复本步骤的检查收口。不要执行任何操作、不要修改任何文件，直接回复：等待收口。";
}

export function workerGoalInput(
	flowDir: string,
	flow: FlowState,
	goalIndex: number,
	options: { forkedFromPlanSession?: boolean } = {},
) {
	const goal = flow.goals[goalIndex];
	if (!goal) throw new Error(`Worker goal not found: G${goalIndex + 1}`);
	const markdown = readFileSync(join(flowDir, goal.file), "utf8");
	const promptGoal = { ...goal, file: goal.file };
	return {
		markdown,
		objective: objectiveFromPlan(markdown) || goal.title,
		prompt: planGoalPrompt(
			workerPromptFlow(flow, promptGoal),
			promptGoal,
			markdown,
			options,
		),
	};
}

function workerPromptFlow(flow: FlowState, promptGoal: FlowGoal) {
	return {
		...flow,
		goals: flow.goals.map((item) =>
			item.index === promptGoal.index ? promptGoal : item,
		),
	};
}

function workerUsesInitialPrompt() {
	return process.env[PRIVATE_WORKER_ENV.initialPrompt] === "1";
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
) {
	if (job.flowId !== flow.id)
		throw new Error("Private worker flow id mismatch.");
	if (job.flowDir !== flowDir)
		throw new Error("Private worker flow dir mismatch.");
	if (job.parallelRunId !== workerParallelRunId(flow, job.goalIndex))
		throw new Error("Private worker parallel run mismatch.");
}

function writeWorkerResult(ctx: object | undefined, fact: GoalCompletionFact) {
	if (!ctx || !isWorkerContext(ctx)) return;
	const job = workerJob(ctx);
	if (!job || job.settled || !job.parallelRunId) return;
	writeWorkerCompletion(job.flowDir, job.goalIndex, fact, job.parallelRunId);
	finishWorker(ctx, job);
}

function finishBlockedWorker(
	ctx: object | undefined,
	handoff: FlowGoalBlockedHandoff,
) {
	if (!ctx || !isWorkerContext(ctx)) return;
	const job = workerJob(ctx);
	if (!job || job.settled || !job.parallelRunId) return;
	const artifact = readWorkerArtifact(job.flowDir, job.goalIndex);
	if (
		artifact?.parallelRunId !== job.parallelRunId ||
		artifact.runtimeGoalId !== handoff.goalId ||
		artifact.handoff?.message !== handoff.message
	)
		return;
	finishWorker(ctx, job);
}

function finishWorker(ctx: object, job: WorkerJob) {
	setWorkerJob(ctx, { ...job, settled: true });
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

function setSessionName(ctx: ExtensionCommandContext, name: string) {
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
		? formatUserNotice("❌", "Flow validation failed", errors)
		: formatUserNotice("❌", "Flow 校验失败", errors);
}

function workerStartFailedMessage(error: string, language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("❌", "Flow worker start failed", [error])
		: formatUserNotice("❌", "Flow worker 启动失败", [error]);
}

function flowNotRunnableMessage(flow: FlowState, goalIndex: number) {
	const status = flowStatusLabel(flow.status, flow.language);
	return flow.language === "en"
		? formatUserNotice("⚠️", "Flow worker cannot start", [
				`ID: ${flow.id}`,
				`Status: ${status}`,
				`Worker: ${goalIndex}`,
			])
		: formatUserNotice("⚠️", "Flow worker 无法启动", [
				`编号：${flow.id}`,
				`状态：${status}`,
				`worker：${goalIndex}`,
			]);
}

function goalNotFoundMessage(goalIndex: number, language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("⚠️", "Flow step index out of range", [
				`Index: ${goalIndex}`,
			])
		: formatUserNotice("⚠️", "Flow 步骤下标超出范围", [`下标：${goalIndex}`]);
}

export function goalAlreadyCompleteMessage(
	goal: Pick<FlowGoal, "index">,
	language: "zh" | "en",
) {
	const label = goal.index + 1;
	return language === "en"
		? formatUserNotice("✅", `Flow step ${label} is already complete`, [
				"Worker start skipped",
			])
		: formatUserNotice("✅", `Flow 第 ${label} 步已完成`, ["无需启动 worker"]);
}
