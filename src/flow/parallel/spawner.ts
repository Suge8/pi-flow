import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { flowMainExtensionArgs } from "../../shared/child-extensions.js";
import { readFlowConfig } from "../../shared/config.js";
import { formatError } from "../../shared/guards.js";
import {
	PRIVATE_WORKER_ENV,
	type PrivateWorkerJob,
	privateWorkerEnv,
	privateWorkerMessage,
} from "../execution/worker-protocol.js";

type WorkerProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface WorkerSpawnOptions {
	flowId: string;
	goalIndex: number;
	flowDir: string;
	parallelRunId: string;
	cwd: string;
	initialPrompt: string;
	sessionFile: string;
	signal?: AbortSignal;
}

export interface WorkerHandle {
	goalIndex: number;
	onEvent(cb: (event: unknown) => void): () => void;
	onExit(
		cb: (
			code: number | null,
			signal: NodeJS.Signals | null,
			stderr: string | null,
		) => void,
	): () => void;
	kill(): void;
}

export function spawnWorker(options: WorkerSpawnOptions): WorkerHandle {
	const sessionPath = options.sessionFile;
	const background = readFlowConfig().background;
	const job = {
		flowId: options.flowId,
		flowDir: options.flowDir,
		goalIndex: options.goalIndex,
		parallelRunId: options.parallelRunId,
		sessionPath,
	};
	const events = new Set<(event: unknown) => void>();
	const exits = new Set<
		(
			code: number | null,
			signal: NodeJS.Signals | null,
			stderr: string | null,
		) => void
	>();
	let child: WorkerProcess | undefined;
	let stdout = "";
	let stderr = "";
	let killed = false;
	let exited = false;
	let exitState:
		| {
				code: number | null;
				signal: NodeJS.Signals | null;
				stderr: string | null;
		  }
		| undefined;
	let forceKill: NodeJS.Timeout | undefined;
	const emitEvent = (event: unknown) => {
		for (const cb of events) cb(event);
	};
	const parseLine = (line: string) => {
		const text = line.trim();
		if (!text) return;
		try {
			emitEvent(JSON.parse(text));
		} catch (error) {
			emitEvent({
				type: "json_parse_error",
				line: text,
				error: formatError(error),
			});
		}
	};
	const flushLines = () => {
		let newline = stdout.indexOf("\n");
		while (newline !== -1) {
			parseLine(stdout.slice(0, newline));
			stdout = stdout.slice(newline + 1);
			newline = stdout.indexOf("\n");
		}
	};
	const control = startWorkerControl(job, (error) => {
		const message = formatError(error);
		emitEvent({ type: "process_error", error: message });
		finishExit(null, null, message);
	});
	const finishExit = (
		code: number | null,
		signal: NodeJS.Signals | null,
		error?: string,
	) => {
		if (exited) return;
		exited = true;
		const stderrTail = trimErrorTail(
			[stderr, error].filter(Boolean).join("\n"),
		);
		exitState = { code, signal, stderr: stderrTail || null };
		parseLine(stdout);
		stdout = "";
		control.close();
		if (forceKill) clearTimeout(forceKill);
		options.signal?.removeEventListener("abort", abort);
		for (const cb of exits) cb(code, signal, exitState.stderr);
	};
	const kill = () => {
		if (killed) return;
		killed = true;
		control.close();
		if (!child) return finishExit(null, "SIGTERM");
		killProcessTree(child, "SIGTERM");
		forceKill = setTimeout(
			() => child && killProcessTree(child, "SIGKILL"),
			5000,
		);
		forceKill.unref?.();
	};
	const abort = () => kill();
	const spawnChild = () => {
		if (killed) return finishExit(null, "SIGTERM");
		child = spawn(
			background.command,
			[
				"--mode",
				"json",
				...flowMainExtensionArgs(background.extensions),
				"--session",
				sessionPath,
				"-p",
				options.initialPrompt,
			],
			{
				cwd: options.cwd,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					...control.env,
					[PRIVATE_WORKER_ENV.initialPrompt]: "1",
				},
			},
		);
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
			flushLines();
		});
		child.stderr.on("data", (chunk) => {
			stderr = trimErrorTail(stderr + chunk.toString());
		});
		child.on("error", (error) => {
			const message = formatError(error);
			emitEvent({ type: "process_error", error: message });
			finishExit(null, null, message);
		});
		child.on("close", finishExit);
	};

	control.listen(spawnChild);
	if (options.signal?.aborted) kill();
	else options.signal?.addEventListener("abort", abort, { once: true });

	return {
		goalIndex: options.goalIndex,
		onEvent(cb) {
			events.add(cb);
			return () => events.delete(cb);
		},
		onExit(cb) {
			if (exitState) cb(exitState.code, exitState.signal, exitState.stderr);
			else exits.add(cb);
			return () => exits.delete(cb);
		},
		kill,
	};
}

function startWorkerControl(
	job: PrivateWorkerJob,
	onError: (error: unknown) => void,
) {
	const socketPath = workerSocketPath(job.goalIndex);
	const token = randomBytes(32).toString("hex");
	const sockets = new Set<Socket>();
	let closed = false;
	let accepted = false;
	const server = createServer((socket) => {
		if (accepted) return socket.destroy();
		sockets.add(socket);
		socket.setEncoding("utf8");
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk;
			const newline = buffer.indexOf("\n");
			if (newline === -1) return;
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (!validWorkerHello(line, token)) return socket.destroy();
			accepted = true;
			socket.write(privateWorkerMessage({ type: "start", job }));
		});
		socket.on("error", () => undefined);
		socket.on("close", () => sockets.delete(socket));
	});
	server.on("error", onError);
	return {
		env: privateWorkerEnv({ ...job, socketPath, token }),
		listen(onReady: () => void) {
			removeSocketFile(socketPath);
			server.listen(socketPath, onReady);
		},
		close() {
			if (closed) return;
			closed = true;
			for (const socket of sockets) socket.destroy();
			server.close();
			removeSocketFile(socketPath);
		},
	};
}

function validWorkerHello(line: string, token: string) {
	try {
		const message = JSON.parse(line) as { type?: unknown; token?: unknown };
		return message.type === "hello" && message.token === token;
	} catch {
		return false;
	}
}

function workerSocketPath(goalIndex: number) {
	const id = `${process.pid}-${goalIndex}-${randomBytes(4).toString("hex")}`;
	if (process.platform === "win32") return `\\\\.\\pipe\\pfw-${id}`;
	return join(tmpdir(), `pfw-${id}.sock`);
}

function removeSocketFile(path: string) {
	if (process.platform !== "win32") rmSync(path, { force: true });
}

function killProcessTree(child: WorkerProcess, signal: NodeJS.Signals) {
	const pid = child.pid;
	if (!pid) return child.kill(signal);
	if (process.platform === "win32") {
		const args = ["/pid", String(pid), "/T"];
		if (signal === "SIGKILL") args.push("/F");
		const killer = spawn("taskkill", args, { stdio: "ignore" });
		killer.unref();
		return;
	}
	try {
		process.kill(-pid, signal);
	} catch {
		child.kill(signal);
	}
}

function trimErrorTail(message: string) {
	const max = 4000;
	const trimmed = message.trim();
	return trimmed.length > max ? trimmed.slice(trimmed.length - max) : trimmed;
}
