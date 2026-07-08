export const PRIVATE_WORKER_ENV = {
	flowId: "PI_FLOW_WORKER_FLOW_ID",
	flowDir: "PI_FLOW_WORKER_FLOW_DIR",
	goalIndex: "PI_FLOW_WORKER_GOAL_INDEX",
	parallelRunId: "PI_FLOW_WORKER_PARALLEL_RUN_ID",
	sessionPath: "PI_FLOW_WORKER_SESSION_PATH",
	initialPrompt: "PI_FLOW_WORKER_INITIAL_PROMPT",
	socketPath: "PI_FLOW_WORKER_SOCKET_PATH",
	token: "PI_FLOW_WORKER_TOKEN",
} as const;

export interface PrivateWorkerJob {
	flowId: string;
	flowDir: string;
	goalIndex: number;
	parallelRunId: string;
	sessionPath: string;
}

export interface PrivateWorkerControl extends PrivateWorkerJob {
	socketPath: string;
	token: string;
}

export function privateWorkerEnv(input: PrivateWorkerControl) {
	return {
		[PRIVATE_WORKER_ENV.flowId]: input.flowId,
		[PRIVATE_WORKER_ENV.flowDir]: input.flowDir,
		[PRIVATE_WORKER_ENV.goalIndex]: String(input.goalIndex),
		[PRIVATE_WORKER_ENV.parallelRunId]: input.parallelRunId,
		[PRIVATE_WORKER_ENV.sessionPath]: input.sessionPath,
		[PRIVATE_WORKER_ENV.socketPath]: input.socketPath,
		[PRIVATE_WORKER_ENV.token]: input.token,
	};
}

export function privateWorkerControlFromEnv(
	env: NodeJS.ProcessEnv = process.env,
) {
	const values = {
		flowId: env[PRIVATE_WORKER_ENV.flowId],
		flowDir: env[PRIVATE_WORKER_ENV.flowDir],
		goalIndex: env[PRIVATE_WORKER_ENV.goalIndex],
		parallelRunId: env[PRIVATE_WORKER_ENV.parallelRunId],
		sessionPath: env[PRIVATE_WORKER_ENV.sessionPath],
		socketPath: env[PRIVATE_WORKER_ENV.socketPath],
		token: env[PRIVATE_WORKER_ENV.token],
	};
	if (Object.values(values).every((value) => !value)) return undefined;
	if (Object.values(values).some((value) => !value))
		throw new Error("Incomplete private worker environment.");
	if (!/^\d+$/u.test(values.goalIndex ?? ""))
		throw new Error("Invalid private worker goal index.");
	return {
		flowId: values.flowId ?? "",
		flowDir: values.flowDir ?? "",
		goalIndex: Number(values.goalIndex),
		parallelRunId: values.parallelRunId ?? "",
		sessionPath: values.sessionPath ?? "",
		socketPath: values.socketPath ?? "",
		token: values.token ?? "",
	};
}

export function samePrivateWorkerJob(
	left: PrivateWorkerJob,
	right: PrivateWorkerJob,
) {
	return (
		left.flowId === right.flowId &&
		left.flowDir === right.flowDir &&
		left.goalIndex === right.goalIndex &&
		left.parallelRunId === right.parallelRunId &&
		left.sessionPath === right.sessionPath
	);
}

export function privateWorkerMessage(value: unknown) {
	return `${JSON.stringify(value)}\n`;
}
