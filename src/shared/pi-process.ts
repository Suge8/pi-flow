import { childExtensionArgs } from "./child-extensions.js";
import type { ReviewerConfig } from "./config.js";
import { serviceTierArgs } from "./service-tier.js";
import { runSpawnProcess } from "./spawn-runner.js";

export async function runPiPrompt(
	config: ReviewerConfig,
	prompt: string,
	cwd: string,
	signal?: AbortSignal,
) {
	const result = await runSpawnProcess({
		command: config.command,
		args: piPromptArgs(config, prompt),
		cwd,
		timeoutMs: config.timeoutMs,
		signal,
	});
	if (result.kind === "aborted")
		return { ok: false as const, feedback: "子进程已取消。" };
	if (result.kind === "timeout")
		return { ok: false as const, feedback: "子进程超时。" };
	if (result.kind === "error")
		return {
			ok: false as const,
			feedback: `子进程启动失败：${result.error.message}`,
		};
	if (result.code === 0) return { ok: true as const, text: result.stdout };
	return {
		ok: false as const,
		feedback: `子进程失败，退出码 ${result.code}。${(result.stderr.trim() || result.stdout.trim()).slice(0, 2000)}`,
	};
}

export function piPromptArgs(config: ReviewerConfig, prompt: string) {
	return [
		"--no-session",
		...childExtensionArgs(config.extensions),
		"--model",
		config.model,
		"--thinking",
		config.thinking,
		"--tools",
		config.tools.join(","),
		"--exclude-tools",
		config.excludeTools.join(","),
		...serviceTierArgs(config.serviceTier),
		"-p",
		prompt,
	];
}
