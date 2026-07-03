import { childExtensionArgs } from "./child-extensions.js";
import type { ReviewerConfig } from "./config.js";
import { serviceTierArgs } from "./service-tier.js";
import { runSpawnProcess } from "./spawn-runner.js";

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
): Promise<string | null> {
	const result = await runReviewProcessResult(config, prompt, cwd, signal);
	if (result.kind === "output") return result.text;
	if (result.kind === "empty_output") return "";
	return null;
}

export async function runReviewProcessResult(
	config: ReviewerConfig,
	prompt: string,
	cwd: string,
	signal?: AbortSignal,
): Promise<ReviewProcessResult> {
	const result = await runSpawnProcess({
		command: config.command,
		args: reviewProcessArgs(config, prompt),
		cwd,
		timeoutMs: config.timeoutMs,
		signal,
	});
	if (result.kind === "aborted") return { kind: "aborted" };
	if (result.kind === "timeout") return { kind: "timeout" };
	if (result.kind === "error") {
		return {
			kind: "output",
			text: `Review failed to start: ${result.error.message}`,
		};
	}
	if (result.code === 0) {
		return result.stdout.trim()
			? { kind: "output", text: result.stdout }
			: { kind: "empty_output", stderr: result.stderr.trim() };
	}
	return {
		kind: "output",
		text: `Review failed with exit ${result.code}.\n${result.stderr.trim() || result.stdout.trim()}`,
	};
}

export function reviewProcessArgs(config: ReviewerConfig, prompt: string) {
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
