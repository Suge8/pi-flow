import {
	mkdirSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-model-roles-test-${runId}`);
// 断言是中文文案；固定运行时语言避免机器 locale 引入环境相关失败。
process.env.PI_FLOW_LANGUAGE = "zh";
const srcOut = join(out, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
prepareTestDist(root, srcOut);

try {
	const config = await import(
		`file://${join(srcOut, "shared/config.js")}?t=${Date.now()}`
	);
	const modelRoles = await import(
		`file://${join(srcOut, "shared/model-roles.js")}?t=${Date.now()}`
	);

	removeConfig();
	const defaults = config.readFlowConfig();
	assert(defaults.modelRoles.advisor === "current", "default advisor changed");
	assert(
		defaults.modelRoles.executor === "current",
		"default executor changed",
	);
	assert(
		defaults.modelRoles.reviewers.length === 3,
		"default reviewers changed",
	);
	assert(defaults.advisor.enabled === true, "advisor consult default not on");
	assert(
		defaults.background.command === "pi" &&
			defaults.checks.timeoutMinutes === 20 &&
			defaults.checks.openaiFast === false,
		`unexpected background/check defaults: ${JSON.stringify(defaults)}`,
	);

	writeConfig({ advisor: { enabled: false } });
	assert(
		config.readFlowConfig().advisor.enabled === false,
		"advisor.enabled=false not parsed",
	);
	writeConfig({ advisor: { enabled: "yes" } });
	assertThrows(
		() => config.readFlowConfig(),
		"advisor.enabled 必须是布尔值",
		"invalid advisor.enabled did not fail",
	);

	writeConfig({
		modelRoles: {
			executor: { model: "executor/model", thinking: "max" },
		},
	});
	assert(
		config.readFlowConfig().modelRoles.executor.thinking === "max",
		"max executor thinking not parsed",
	);

	// 咨询子进程：advisor 为 current 时只回落模型选择；运行能力与 Reviewer 共用 checks。
	const defaultConsult = config.advisorConsultModel(defaults);
	assert(
		defaultConsult.model === defaults.modelRoles.reviewers[0].model &&
			defaultConsult.thinking === defaults.modelRoles.reviewers[0].thinking,
		"default advisor consult did not fall back to the first reviewer",
	);
	assert(
		defaultConsult.command === defaults.background.command &&
			defaultConsult.timeoutMs === defaults.checks.timeoutMinutes * 60_000 &&
			defaultConsult.openaiFast === defaults.checks.openaiFast,
		"advisor consult did not inherit background/check settings",
	);
	assert(
		JSON.stringify(defaultConsult.tools) ===
			JSON.stringify(defaults.modelRoles.reviewers[0].tools) &&
			defaultConsult.tools.includes("bash") &&
			["write", "edit"].every((tool) =>
				defaultConsult.excludeTools.includes(tool),
			),
		`advisor/reviewer tools diverged: ${JSON.stringify(defaultConsult.tools)} / ${JSON.stringify(defaultConsult.excludeTools)}`,
	);

	writeConfig({ runner: { command: "pi" } });
	assertThrows(
		() => config.readFlowConfig(),
		"config.json 字段 runner 不受支持",
		"legacy runner config was accepted",
	);
	writeConfig({
		background: { command: "custom-pi", extensions: ["/x.js"] },
		checks: {
			tools: ["read", "bash"],
			timeoutMinutes: 2,
			openaiFast: true,
		},
	});
	const configuredChecks = config.readFlowConfig();
	assert(
		configuredChecks.background.command === "custom-pi" &&
			configuredChecks.modelRoles.reviewers[0].tools.join(",") ===
				"read,bash" &&
			configuredChecks.modelRoles.reviewers[0].timeoutMs === 120_000 &&
			configuredChecks.modelRoles.reviewers[0].openaiFast === true,
		JSON.stringify(configuredChecks),
	);
	const removedFastField = ["fa", "st"].join("");
	writeConfig({ checks: { [removedFastField]: true } });
	assertThrows(
		() => config.readFlowConfig(),
		`checks.${removedFastField} 不受支持`,
		"removed fast field was accepted",
	);
	writeConfig({ checks: { openaiFast: "yes" } });
	assertThrows(
		() => config.readFlowConfig(),
		"checks.openaiFast 必须是布尔值",
		"invalid checks.openaiFast did not fail",
	);
	writeConfig({ checks: { tools: ["read", "write"] } });
	assertThrows(
		() => config.readFlowConfig(),
		"检查工具名无效: write",
		"write was accepted as a check tool",
	);

	writeConfig({ models: [{ model: "old/model", thinking: "low" }] });
	assertThrows(
		() => config.readFlowConfig(),
		"config.json 字段 models 不受支持",
		"top-level models was accepted",
	);
	writeConfig({
		modelRoles: {
			reviewers: [
				{ model: "review/model", thinking: "high", command: "custom" },
			],
		},
	});
	assertThrows(
		() => config.readFlowConfig(),
		"modelRoles.reviewers[0].command 不受支持",
		"reviewer process overrides were accepted",
	);

	writeConfig({
		modelRoles: {
			advisor: { model: "advisor/model", thinking: "high" },
			executor: { model: "executor/model", thinking: "medium" },
			reviewers: [{ model: "review/model", thinking: "minimal" }],
		},
	});
	const roles = config.readFlowConfig().modelRoles;
	assert(roles.advisor.model === "advisor/model", "advisor model not parsed");
	assert(roles.executor.thinking === "medium", "executor thinking not parsed");
	assert(roles.reviewers[0].model === "review/model", "reviewers not parsed");
	// 显式 advisor 角色：咨询子进程直接用该模型，仍与 Reviewer 共用检查能力。
	const explicitConsult = config.advisorConsultModel(config.readFlowConfig());
	assert(
		explicitConsult.model === "advisor/model" &&
			explicitConsult.thinking === "high",
		"advisor consult did not use the explicit advisor role",
	);
	assert(
		JSON.stringify(explicitConsult.tools) ===
			JSON.stringify(config.readFlowConfig().modelRoles.reviewers[0].tools) &&
			explicitConsult.tools.includes("bash") &&
			["write", "edit"].every((tool) =>
				explicitConsult.excludeTools.includes(tool),
			),
		"explicit advisor consult did not share reviewer tools",
	);

	writeConfig({
		modelRoles: { planner: { model: "planner/model", thinking: "high" } },
	});
	assertThrows(
		() => config.readFlowConfig(),
		"config.json 字段 modelRoles.planner 不受支持",
		"unknown model role was accepted",
	);

	writeConfig({ acceptance: { enabled: true, models: [] } });
	assertThrows(
		() => config.readFlowConfig(),
		"config.json 字段 acceptance.models 不受支持",
		"unknown acceptance field was accepted",
	);

	for (const [value, expected] of [
		[{ model: "advisor/model" }, "modelRoles.advisor.thinking"],
		[{ model: "advisormodel", thinking: "high" }, "provider/model-id"],
		[{ model: "advisor/model", thinking: "fast" }, "xhigh 或 max"],
		[
			{ model: "advisor/model", thinking: "high", tools: [] },
			"modelRoles.advisor.tools 不受支持",
		],
		["advisor/model", "必须是包含 model、thinking 的对象"],
	]) {
		writeConfig({ modelRoles: { advisor: value } });
		assertThrows(
			() => config.readFlowConfig(),
			expected,
			`invalid advisor did not fail: ${JSON.stringify(value)}`,
		);
	}

	writeConfig({
		modelRoles: {
			executor: { model: "provider/model-a", thinking: "max" },
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
		(await modelRoles.switchToRoleModel(pi, ctx, "executor", "zh")) === true,
		"max executor switch failed",
	);
	assertDeepEqual(calls, [
		["find", "provider", "model-a"],
		["setModel", "provider", "model-a"],
		["setThinkingLevel", "max"],
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
			(call) =>
				call[0] === "notify" &&
				call[1].startsWith("⚠️ 执行模型不可用\n\n") &&
				call[2] === "info",
		),
		"missing executor model was not reported",
	);

	writeConfig({ modelRoles: { advisor: "current" } });
	const currentCalls = [];
	assert(
		(await modelRoles.switchToRoleModel(
			pi,
			roleContext(currentCalls, { find: () => undefined }),
			"advisor",
			"zh",
		)) === true,
		"current advisor should pass",
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
