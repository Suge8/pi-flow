import { type ChildProcessByStdio, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { flowMainExtensionArgs } from "../../shared/child-extensions.js";
import { readFlowConfig } from "../../shared/config.js";
import { formatError } from "../../shared/guards.js";

type WorkerProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface WorkerSpawnOptions {
	flowId: string;
	goalIndex: number;
	flowDir: string;
	cwd: string;
	signal?: AbortSignal;
}

export interface WorkerHandle {
	goalIndex: number;
	process: WorkerProcess;
	onEvent(cb: (event: unknown) => void): () => void;
	onExit(
		cb: (code: number | null, signal: NodeJS.Signals | null) => void,
	): () => void;
	kill(): void;
}

export function spawnWorker(options: WorkerSpawnOptions): WorkerHandle {
	const workerDir = join(options.flowDir, "workers", `G${options.goalIndex}`);
	mkdirSync(workerDir, { recursive: true });
	const runner = readFlowConfig().runner;
	const child = spawn(
		runner.command,
		[
			"--mode",
			"json",
			...flowMainExtensionArgs(runner.extensions),
			"--session",
			join(workerDir, "session.jsonl"),
			"-p",
			`/flow worker ${options.flowId} ${options.goalIndex}`,
		],
		{ cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] },
	);
	const events = new Set<(event: unknown) => void>();
	const exits = new Set<
		(code: number | null, signal: NodeJS.Signals | null) => void
	>();
	let stdout = "";
	let killed = false;
	let exited = false;
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
	const finishExit = (code: number | null, signal: NodeJS.Signals | null) => {
		if (exited) return;
		exited = true;
		parseLine(stdout);
		stdout = "";
		if (forceKill) clearTimeout(forceKill);
		options.signal?.removeEventListener("abort", abort);
		for (const cb of exits) cb(code, signal);
	};
	const kill = () => {
		if (killed) return;
		killed = true;
		child.kill("SIGTERM");
		forceKill = setTimeout(() => child.kill("SIGKILL"), 5000);
		forceKill.unref?.();
	};
	const abort = () => kill();

	if (options.signal?.aborted) kill();
	else options.signal?.addEventListener("abort", abort, { once: true });
	child.stdout.on("data", (chunk) => {
		stdout += chunk.toString();
		flushLines();
	});
	child.stderr.on("data", () => undefined);
	child.on("error", (error) => {
		emitEvent({ type: "process_error", error: formatError(error) });
		finishExit(null, null);
	});
	child.on("close", finishExit);

	return {
		goalIndex: options.goalIndex,
		process: child,
		onEvent(cb) {
			events.add(cb);
			return () => events.delete(cb);
		},
		onExit(cb) {
			exits.add(cb);
			return () => exits.delete(cb);
		},
		kill,
	};
}
