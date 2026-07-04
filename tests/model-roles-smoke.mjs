import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-model-roles-test-${runId}`);
const srcOut = join(out, "src");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	["--outDir", srcOut, "--rootDir", "src", "--noEmit", "false"],
	{ cwd: root, stdio: "inherit" },
);

try {
	const config = await import(
		`file://${join(srcOut, "shared/config.js")}?t=${Date.now()}`
	);
	const modelRoles = await import(
		`file://${join(srcOut, "shared/model-roles.js")}?t=${Date.now()}`
	);

	removeConfig();
	const defaults = config.readFlowConfig();
	assert(defaults.modelRoles.planner === "current", "default planner changed");
	assert(
		defaults.modelRoles.executor === "current",
		"default executor changed",
	);
	assert(defaults.models.length === 3, "default reviewers changed");
	assert(
		defaults.models === defaults.modelRoles.reviewers,
		"models alias is not reviewers",
	);

	writeConfig({
		models: [{ model: "legacy/model", thinking: "low" }],
	});
	const legacy = config.readFlowConfig();
	assert(legacy.modelRoles.planner === "current", "legacy planner changed");
	assert(legacy.models[0].model === "legacy/model", "legacy models not used");
	assert(
		legacy.modelRoles.reviewers[0].thinking === "low",
		"legacy reviewer thinking not used",
	);

	writeConfig({
		modelRoles: {
			planner: { model: "planner/model", thinking: "high" },
			executor: { model: "executor/model", thinking: "medium" },
			reviewers: [{ model: "review/model", thinking: "minimal" }],
		},
	});
	const roles = config.readFlowConfig().modelRoles;
	assert(roles.planner.model === "planner/model", "planner model not parsed");
	assert(roles.executor.thinking === "medium", "executor thinking not parsed");
	assert(roles.reviewers[0].model === "review/model", "reviewers not parsed");

	writeConfig({
		models: [{ model: "legacy/model", thinking: "low" }],
		modelRoles: {
			reviewers: [{ model: "review/model", thinking: "low" }],
		},
	});
	assertThrows(
		() => config.readFlowConfig(),
		"models 与 modelRoles.reviewers 不能同时配置",
		"conflicting reviewers did not fail",
	);

	for (const [value, expected] of [
		[{ model: "planner/model" }, "modelRoles.planner.thinking"],
		[{ model: "plannermodel", thinking: "high" }, "provider/model-id"],
		[{ model: "planner/model", thinking: "fast" }, "off、minimal"],
		[{ model: "planner/model", thinking: "high", tools: [] }, "不能包含 tools"],
		["planner/model", "必须是 current"],
	]) {
		writeConfig({ modelRoles: { planner: value } });
		assertThrows(
			() => config.readFlowConfig(),
			expected,
			`invalid planner did not fail: ${JSON.stringify(value)}`,
		);
	}

	writeConfig({
		modelRoles: {
			planner: { model: "provider/model-a", thinking: "high" },
		},
	});
	const calls = [];
	const ctx = roleContext(calls, {
		find(provider, modelId) {
			calls.push(["find", provider, modelId]);
			return { provider, id: modelId };
		},
	});
	const pi = {
		setModel(model) {
			calls.push(["setModel", model.provider, model.id]);
			return Promise.resolve(true);
		},
		setThinkingLevel(level) {
			calls.push(["setThinkingLevel", level]);
		},
	};
	assert(
		(await modelRoles.switchToRoleModel(pi, ctx, "planner", "zh")) === true,
		"planner switch failed",
	);
	assertDeepEqual(calls, [
		["find", "provider", "model-a"],
		["setModel", "provider", "model-a"],
		["setThinkingLevel", "high"],
		["notify", "🧭 计划模型开工：provider/model-a/high", "info"],
	]);

	writeConfig({
		modelRoles: {
			executor: { model: "provider/missing", thinking: "medium" },
		},
	});
	const missingCalls = [];
	assert(
		(await modelRoles.switchToRoleModel(
			pi,
			roleContext(missingCalls, { find: () => undefined }),
			"executor",
			"zh",
		)) === false,
		"missing executor model should fail",
	);
	assert(
		missingCalls.some(
			(call) => call[0] === "notify" && call[1].includes("执行模型不可用"),
		),
		"missing executor model was not reported",
	);

	writeConfig({ modelRoles: { planner: "current" } });
	const currentCalls = [];
	assert(
		(await modelRoles.switchToRoleModel(
			pi,
			roleContext(currentCalls, { find: () => undefined }),
			"planner",
			"zh",
		)) === true,
		"current planner should pass",
	);
	assertDeepEqual(currentCalls, []);

	console.log("model roles smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function writeConfig(value) {
	writeFileSync(join(out, "config.json"), `${JSON.stringify(value)}\n`);
}

function removeConfig() {
	try {
		unlinkSync(join(out, "config.json"));
	} catch {}
}

function roleContext(calls, modelRegistry) {
	return {
		modelRegistry,
		ui: {
			notify(message, level) {
				calls.push(["notify", message, level ?? "info"]);
			},
		},
	};
}

function assertThrows(fn, expected, message) {
	try {
		fn();
	} catch (error) {
		assert(
			String(error.message).includes(expected),
			`${message}: ${error.message}`,
		);
		return;
	}
	throw new Error(message);
}

function assertDeepEqual(actual, expected) {
	const actualText = JSON.stringify(actual);
	const expectedText = JSON.stringify(expected);
	assert(actualText === expectedText, `${actualText} !== ${expectedText}`);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
