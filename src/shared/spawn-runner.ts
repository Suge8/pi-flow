import { spawn } from "node:child_process";

export type SpawnRunnerResult =
	| { kind: "close"; code: number | null; stdout: string; stderr: string }
	| { kind: "error"; error: Error; stdout: string; stderr: string }
	| { kind: "timeout"; stdout: string; stderr: string }
	| { kind: "aborted"; stdout: string; stderr: string };

export interface SpawnRunnerOptions {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
	signal?: AbortSignal;
}

export function runSpawnProcess(
	options: SpawnRunnerOptions,
): Promise<SpawnRunnerResult> {
	return new Promise((resolve) => {
		const child = spawn(options.command, options.args, {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (result: SpawnRunnerResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", abort);
			resolve(result);
		};
		const output = () => ({ stdout, stderr });
		const abort = () => {
			child.kill("SIGTERM");
			finish({ kind: "aborted", ...output() });
		};
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			finish({ kind: "timeout", ...output() });
		}, options.timeoutMs);
		if (options.signal?.aborted) return abort();
		options.signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => finish({ kind: "error", error, ...output() }));
		child.on("close", (code) => finish({ kind: "close", code, ...output() }));
	});
}
