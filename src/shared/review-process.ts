import { collectAssistantEvents } from "./assistant-event-stream.js";
import { childExtensionArgs } from "./child-extensions.js";
import type { ReviewerConfig } from "./config.js";
import { openaiFastArgs } from "./openai-fast.js";
import { runSpawnProcess, type SpawnRunnerResult } from "./spawn-runner.js";

export type ReviewProcessResult =
	| { kind: "output"; text: string }
	| { kind: "empty_output"; stderr: string }
	| { kind: "timeout" }
	| { kind: "aborted" };

export async function runReviewProcess(
	config: ReviewerConfig,
	prompt: string,
	cwd: string,
	signal?: AbortSignal,
	onEvent?: (event: unknown) => void,
): Promise<string | null> {
	const result = await runReviewProcessResult(
		config,
		prompt,
		cwd,
		signal,
		onEvent,
	);
	if (result.kind === "output") return result.text;
	if (result.kind === "empty_output") return "";
	return null;
}

export async function runReviewProcessResult(
	config: ReviewerConfig,
	prompt: string,
	cwd: string,
	signal?: AbortSignal,
	onEvent?: (event: unknown) => void,
): Promise<ReviewProcessResult> {
	const events = collectAssistantEvents(onEvent);
	const result = await runSpawnProcess({
		command: config.command,
		args: reviewProcessArgs(config, prompt),
		cwd,
		timeoutMs: config.timeoutMs,
		signal,
		onLine: events.onLine,
	});
	if (result.kind === "aborted") return { kind: "aborted" };
	if (result.kind === "timeout") return { kind: "timeout" };
	if (result.kind === "error") {
		return {
			kind: "output",
			text: `Review failed to start: ${result.error.message}`,
		};
	}
	const text = events.text();
	if (result.code === 0) {
		return text.trim()
			? { kind: "output", text }
			: { kind: "empty_output", stderr: result.stderr.trim() };
	}
	const output = result.stderr.trim() || text.trim();
	const reason = reviewFailureReason(result);
	return {
		kind: "output",
		text: output ? `${reason}\n${output}` : reason,
	};
}

function reviewFailureReason(
	result: Extract<SpawnRunnerResult, { kind: "close" }>,
) {
	if (result.code !== null) return `Review failed with exit ${result.code}.`;
	return `Review terminated by signal ${result.signal ?? "unknown"}.`;
}

export function reviewProcessArgs(config: ReviewerConfig, prompt: string) {
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
