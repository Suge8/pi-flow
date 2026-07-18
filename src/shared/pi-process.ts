import { collectAssistantEvents } from "./assistant-event-stream.js";
import { childExtensionArgs } from "./child-extensions.js";
import type { ReviewerConfig } from "./config.js";
import { openaiFastArgs } from "./openai-fast.js";
import { runSpawnProcess, type SpawnRunnerResult } from "./spawn-runner.js";

export async function runPiPrompt(
	config: ReviewerConfig,
	prompt: string,
	cwd: string,
	signal?: AbortSignal,
	onEvent?: (event: unknown) => void,
) {
	const events = collectAssistantEvents(onEvent);
	const result = await runSpawnProcess({
		command: config.command,
		args: piPromptArgs(config, prompt),
		cwd,
		timeoutMs: config.timeoutMs,
		signal,
		onLine: events.onLine,
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
	const text = events.text();
	if (result.code === 0)
		return text.trim()
			? { ok: true as const, text }
			: { ok: false as const, feedback: "子进程输出为空。" };
	const output = (result.stderr.trim() || text.trim()).slice(0, 2000);
	return {
		ok: false as const,
		feedback: `${piFailureReason(result)}${output}`,
	};
}

function piFailureReason(
	result: Extract<SpawnRunnerResult, { kind: "close" }>,
) {
	if (result.code !== null) return `子进程失败，退出码 ${result.code}。`;
	return `子进程被信号 ${result.signal ?? "unknown"} 终止。`;
}

export function piPromptArgs(config: ReviewerConfig, prompt: string) {
	return [
		"--no-session",
		"--mode",
		"json",
		...childExtensionArgs(config.extensions),
		"--model",
		config.model,
		"--thinking",
		config.thinking,
		"--tools",
		config.tools.join(","),
		"--exclude-tools",
		config.excludeTools.join(","),
		...openaiFastArgs(config.openaiFast),
		"-p",
		prompt,
	];
}
