import { type ChildProcess, spawn } from "node:child_process";

const TIMEOUT_PREKILL_GRACE_MS = 1000;
const TIMEOUT_TERM_SIGNAL: NodeJS.Signals = "SIGTERM";
const TIMEOUT_KILL_SIGNAL: NodeJS.Signals = "SIGKILL";
const TIMEOUT_CLOSE_FALLBACK_MS = 1000;
const STDERR_TAIL_LENGTH = 16_384;

export interface SpawnCloseResult {
	kind: "close";
	code: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}

export type SpawnRunnerResult =
	| SpawnCloseResult
	| { kind: "error"; error: Error; stdout: string; stderr: string }
	| { kind: "timeout"; stdout: string; stderr: string }
	| { kind: "aborted"; stdout: string; stderr: string };

export interface SpawnRunnerOptions {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
	signal?: AbortSignal;
	onLine?: (line: string) => void;
}

export function runSpawnProcess(
	options: SpawnRunnerOptions,
): Promise<SpawnRunnerResult> {
	return new Promise((resolve) => {
		const child = spawn(options.command, options.args, {
			cwd: options.cwd,
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stdoutLine = "";
		let stderr = "";
		let settled = false;
		let timedOut = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let timeoutKill: ReturnType<typeof setTimeout> | undefined;
		let timeoutCloseFallback: ReturnType<typeof setTimeout> | undefined;
		let exitCode: number | null | undefined;
		let exitSignal: NodeJS.Signals | null | undefined;
		const flushStdoutLine = () => {
			if (!options.onLine || !stdoutLine) return;
			options.onLine(
				stdoutLine.endsWith("\r") ? stdoutLine.slice(0, -1) : stdoutLine,
			);
			stdoutLine = "";
		};
		const finish = (result: SpawnRunnerResult) => {
			if (settled) return;
			flushStdoutLine();
			settled = true;
			if (timeout) clearTimeout(timeout);
			if (timeoutKill) clearTimeout(timeoutKill);
			if (timeoutCloseFallback) clearTimeout(timeoutCloseFallback);
			options.signal?.removeEventListener("abort", abort);
			resolve(result);
		};
		const output = () => ({ stdout, stderr });
		const closeResult = (
			code: number | null,
			signal: NodeJS.Signals | null,
		) => ({
			kind: "close" as const,
			code: exitCode ?? code,
			signal: exitSignal ?? signal,
			...output(),
		});
		const exitedBySignal = () =>
			(exitSignal !== undefined && exitSignal !== null) ||
			child.signalCode !== null;
		const abort = () => {
			killProcessTree(child, TIMEOUT_KILL_SIGNAL);
			finish({ kind: "aborted", ...output() });
		};
		const startTimeout = () => {
			timeout = setTimeout(() => {
				if (exitedBySignal()) {
					finish(closeResult(child.exitCode, child.signalCode));
					return;
				}
				timedOut = true;
				killProcessTree(child, TIMEOUT_TERM_SIGNAL);
				timeoutKill = setTimeout(() => {
					if (settled) return;
					killProcessTree(child, TIMEOUT_KILL_SIGNAL);
					timeoutCloseFallback = setTimeout(
						() => finish({ kind: "timeout", ...output() }),
						TIMEOUT_CLOSE_FALLBACK_MS,
					);
				}, TIMEOUT_PREKILL_GRACE_MS);
			}, options.timeoutMs);
		};
		if (options.signal?.aborted) return abort();
		options.signal?.addEventListener("abort", abort, { once: true });
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			if (settled) return;
			if (!options.onLine) {
				stdout += chunk;
				return;
			}
			stdoutLine += chunk;
			let newline = stdoutLine.indexOf("\n");
			while (newline >= 0) {
				const line = stdoutLine.slice(0, newline);
				options.onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
				stdoutLine = stdoutLine.slice(newline + 1);
				newline = stdoutLine.indexOf("\n");
			}
		});
		child.stderr.on("data", (chunk: string) => {
			stderr = options.onLine
				? `${stderr}${chunk}`.slice(-STDERR_TAIL_LENGTH)
				: stderr + chunk;
		});
		child.on("spawn", () => {
			if (!settled) startTimeout();
		});
		child.on("error", (error) => finish({ kind: "error", error, ...output() }));
		child.on("exit", (code, signal) => {
			exitCode = code;
			exitSignal = signal;
			if (signal !== null && !timedOut) finish(closeResult(code, signal));
		});
		child.on("close", (code, signal) =>
			finish(
				timedOut ? { kind: "timeout", ...output() } : closeResult(code, signal),
			),
		);
	});
}

function killProcessTree(child: ChildProcess, signal: NodeJS.Signals) {
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
