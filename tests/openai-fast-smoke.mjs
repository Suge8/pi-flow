import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-openai-fast-test-${runId}`);
const srcOut = join(out, "dist");
const keptExtensions = [
	"/keep/pi-openai-compaction",
	"/keep/openai-options.ts",
	"/keep/pi-xai-oauth-scoped",
	"/keep/claude-sub.ts",
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
prepareTestDist(root, srcOut);

try {
	const { applyOpenAIFast } = await import(
		`file://${join(srcOut, "shared/openai-fast.js")}?t=${Date.now()}`
	);
	const { piPromptArgs, runPiPrompt } = await import(
		`file://${join(srcOut, "shared/pi-process.js")}?t=${Date.now()}`
	);
	const { reviewProcessArgs, runReviewProcessResult } = await import(
		`file://${join(srcOut, "shared/review-process.js")}?t=${Date.now()}`
	);
	const { flowChildExtensionPath } = await import(
		`file://${join(srcOut, "shared/child-extensions.js")}?t=${Date.now()}`
	);
	const { default: flowChildExtension } = await import(
		`file://${join(srcOut, "child.js")}?t=${Date.now()}`
	);

	const codexModel = {
		id: "gpt-5.6-sol",
		provider: "openai-codex",
		api: "openai-codex-responses",
	};
	const responsesPayload = { model: codexModel.id, input: [] };
	const patched = applyOpenAIFast(responsesPayload, codexModel);
	assert(patched?.service_tier === "priority", "OpenAI fast was not applied");
	assert(
		applyOpenAIFast(
			{ model: "gpt-4.1", input: [] },
			{ id: "gpt-4.1", provider: "openai", api: "openai-responses" },
		)?.service_tier === "priority",
		"supported OpenAI Responses model was not patched",
	);
	assert(
		applyOpenAIFast(
			{ model: "gpt-5.3-codex-spark", input: [] },
			{ ...codexModel, id: "gpt-5.3-codex-spark" },
		) === undefined,
		"unsupported model was patched",
	);
	assert(
		applyOpenAIFast(responsesPayload, {
			...codexModel,
			provider: "github-copilot",
			api: "openai-responses",
		}) === undefined,
		"unsupported provider was patched",
	);
	assert(
		applyOpenAIFast(responsesPayload, {
			...codexModel,
			provider: "openai",
			api: "openai-completions",
		}) === undefined,
		"unsupported API was patched",
	);
	assert(
		applyOpenAIFast({ model: "gpt-5.6-terra", input: [] }, codexModel) ===
			undefined,
		"payload/model mismatch was patched",
	);
	assert(
		applyOpenAIFast({ model: codexModel.id, messages: [] }, codexModel) ===
			undefined,
		"non-Responses payload was patched",
	);

	const reviewer = {
		command: "pi",
		model: "openai-codex/gpt-5.6-sol",
		thinking: "high",
		tools: ["read", "bash"],
		excludeTools: ["write", "edit"],
		// 正常子进程成功路径的护栏；并发全套下 Node 冷启动可能超过 1s。
		timeoutMs: 10_000,
		openaiFast: true,
		extensions: keptExtensions,
	};
	const args = piPromptArgs(reviewer, "prompt");
	const reviewArgs = reviewProcessArgs(reviewer, "prompt");
	const standardArgs = piPromptArgs(
		{ ...reviewer, openaiFast: false },
		"prompt",
	);
	assertChildArgs(args, flowChildExtensionPath());
	assertChildArgs(reviewArgs, flowChildExtensionPath());
	assert(
		!standardArgs.includes("--pi-flow-openai-fast"),
		standardArgs.join(" "),
	);

	const events = [
		assistantMessageEnd("FIRST"),
		{
			type: "tool_execution_start",
			toolCallId: "read-1",
			toolName: "read",
			args: { path: "package.json" },
		},
		assistantMessageEnd("LAST"),
		{
			type: "agent_end",
			messages: [assistantMessage("FALLBACK")],
		},
	];
	const eventCommand = writeJsonCommand(out, "events", events);
	const seenEvents = [];
	const piResult = await runPiPrompt(
		{ ...reviewer, command: eventCommand },
		"prompt",
		root,
		undefined,
		(event) => seenEvents.push(event),
	);
	assert(piResult.ok && piResult.text === "LAST", JSON.stringify(piResult));
	assert(
		seenEvents.some((event) => event.type === "tool_execution_start"),
		JSON.stringify(seenEvents),
	);
	const reviewResult = await runReviewProcessResult(
		{ ...reviewer, command: eventCommand },
		"prompt",
		root,
	);
	assert(
		reviewResult.kind === "output" && reviewResult.text === "LAST",
		JSON.stringify(reviewResult),
	);
	const fallbackCommand = writeJsonCommand(out, "fallback", [
		{ type: "agent_end", messages: [assistantMessage("FALLBACK")] },
	]);
	const fallbackResult = await runPiPrompt(
		{ ...reviewer, command: fallbackCommand },
		"prompt",
		root,
	);
	assert(
		fallbackResult.ok && fallbackResult.text === "FALLBACK",
		JSON.stringify(fallbackResult),
	);
	const emptyCommand = writeJsonCommand(out, "empty", [
		{ type: "agent_start" },
	]);
	const emptyPi = await runPiPrompt(
		{ ...reviewer, command: emptyCommand },
		"prompt",
		root,
	);
	const emptyReview = await runReviewProcessResult(
		{ ...reviewer, command: emptyCommand },
		"prompt",
		root,
	);
	assert(
		!emptyPi.ok && emptyPi.feedback === "子进程输出为空。",
		JSON.stringify(emptyPi),
	);
	assert(emptyReview.kind === "empty_output", JSON.stringify(emptyReview));

	const childCalls = [];
	const beforeProviderRequests = [];
	flowChildExtension({
		registerFlag: (name, options) =>
			childCalls.push(["registerFlag", name, options.type]),
		on: (event, callback) => {
			childCalls.push(["on", event]);
			if (event === "before_provider_request")
				beforeProviderRequests.push(callback);
		},
		getFlag: () => true,
	});
	const hookResult = beforeProviderRequests
		.map((callback) =>
			callback({ payload: responsesPayload }, { model: codexModel }),
		)
		.find((result) => result?.service_tier === "priority");
	assert(
		hookResult?.service_tier === "priority",
		"provider hook ignored model context",
	);
	assert(
		childCalls.some(
			(call) =>
				call[0] === "registerFlag" &&
				call[1] === "pi-flow-openai-fast" &&
				call[2] === "boolean",
		),
		JSON.stringify(childCalls),
	);
	assert(
		!childCalls.some(
			(call) => call[0] === "registerCommand" || call[1] === "agent_end",
		),
		JSON.stringify(childCalls),
	);

	console.log("OpenAI fast smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function assertChildArgs(args, childPath) {
	const joined = args.join(" ");
	assert(args[0] === "--no-session", joined);
	assert(args[1] === "--mode" && args[2] === "json", joined);
	assert(args[3] === "--no-extensions", joined);
	assert(args.includes("--pi-flow-openai-fast"), joined);
	for (const extension of keptExtensions)
		assert(hasExtension(args, extension), joined);
	assert(hasExtension(args, childPath), joined);
	assert(args.at(-2) === "-p" && args.at(-1) === "prompt", joined);
	assert(extensionValues(args).at(-1) === childPath, joined);
	assert(childPath.endsWith("/dist/child.js"), childPath);
}

function assistantMessage(text) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
	};
}

function assistantMessageEnd(text) {
	return { type: "message_end", message: assistantMessage(text) };
}

function writeJsonCommand(directory, name, events) {
	const path = join(directory, name);
	writeFileSync(
		path,
		`#!/usr/bin/env node\nfor (const event of ${JSON.stringify(events)}) process.stdout.write(JSON.stringify(event) + "\\n");\n`,
		{ mode: 0o755 },
	);
	return path;
}

function hasExtension(args, extension) {
	return extensionValues(args).includes(extension);
}

function extensionValues(args) {
	const values = [];
	for (let index = 0; index < args.length - 1; index += 1)
		if (args[index] === "-e") values.push(args[index + 1]);
	return values;
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
