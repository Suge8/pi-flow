import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-service-tier-test-${runId}`);
const srcOut = join(out, "src");
const keptExtensions = [
	"/keep/pi-openai-compaction",
	"/keep/openai-options.ts",
	"/keep/pi-xai-oauth-scoped",
	"/keep/claude-sub.ts",
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	["--outDir", srcOut, "--rootDir", "src", "--noEmit", "false"],
	{ cwd: root, stdio: "inherit" },
);

try {
	const { applyPriorityServiceTier } = await import(
		`file://${join(srcOut, "shared/service-tier.js")}?t=${Date.now()}`
	);
	const { piPromptArgs } = await import(
		`file://${join(srcOut, "shared/pi-process.js")}?t=${Date.now()}`
	);
	const { reviewProcessArgs } = await import(
		`file://${join(srcOut, "shared/review-process.js")}?t=${Date.now()}`
	);
	const { flowChildExtensionPath } = await import(
		`file://${join(srcOut, "shared/child-extensions.js")}?t=${Date.now()}`
	);
	const { default: flowChildExtension } = await import(
		`file://${join(srcOut, "child.js")}?t=${Date.now()}`
	);

	const patched = applyPriorityServiceTier({
		model: "gpt-5.4-mini",
		text: { verbosity: "low" },
	});
	assert(patched?.service_tier === "priority", "priority tier was not applied");
	assert(
		applyPriorityServiceTier({
			model: "gpt-5.4-nano",
			text: { verbosity: "low" },
		}) === undefined,
		"unsupported model was patched",
	);
	assert(
		applyPriorityServiceTier({ model: "gpt-5.4-mini" }) === undefined,
		"non-codex payload was patched",
	);

	const reviewer = {
		command: "pi",
		model: "openai-codex/gpt-5.4-mini",
		thinking: "high",
		tools: ["read"],
		excludeTools: ["write"],
		timeoutMs: 1000,
		serviceTier: "priority",
		extensions: keptExtensions,
	};
	const args = piPromptArgs(reviewer, "prompt");
	const reviewArgs = reviewProcessArgs(reviewer, "prompt");
	const defaultArgs = piPromptArgs(
		{ ...reviewer, serviceTier: "default" },
		"prompt",
	);
	assertChildArgs(args, flowChildExtensionPath());
	assertChildArgs(reviewArgs, flowChildExtensionPath());
	assert(
		!defaultArgs.includes("--pi-flow-service-tier"),
		defaultArgs.join(" "),
	);

	const childCalls = [];
	flowChildExtension({
		registerFlag: (name, options) =>
			childCalls.push(["registerFlag", name, options.type]),
		on: (event) => childCalls.push(["on", event]),
		getFlag: () => undefined,
	});
	assert(
		childCalls.some(
			(call) =>
				call[0] === "registerFlag" && call[1] === "pi-flow-service-tier",
		),
		JSON.stringify(childCalls),
	);
	assert(
		!childCalls.some(
			(call) => call[0] === "registerCommand" || call[1] === "agent_end",
		),
		JSON.stringify(childCalls),
	);

	console.log("service tier smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function assertChildArgs(args, childPath) {
	const joined = args.join(" ");
	assert(args[0] === "--no-session", joined);
	assert(args[1] === "--no-extensions", joined);
	assert(args.includes("--pi-flow-service-tier"), joined);
	assert(args.includes("priority"), joined);
	assert(!joined.includes("mac-notify"), joined);
	for (const extension of keptExtensions)
		assert(hasExtension(args, extension), joined);
	assert(hasExtension(args, childPath), joined);
	assert(args.at(-2) === "-p" && args.at(-1) === "prompt", joined);
	assert(extensionValues(args).at(-1) === childPath, joined);
	assert(childPath.endsWith("/src/child.ts"), childPath);
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
