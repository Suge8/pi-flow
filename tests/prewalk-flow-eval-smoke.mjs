import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 真实 Flow 评测 CLI 的参数、失败语义与任务 oracle 回归（不 spawn 模型）。
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const {
	parseCliArgs,
	flowEvaluationFailed,
	readFlowStatus,
	runFlowToTerminal,
	verifyClipStartTask,
} = await import(
	pathToFileURL(join(root, "scripts/evaluate-prewalk-flow.mjs")).href
);

// 参数：默认串行 3 对；显式值透传；parallel 未实现必须明确报错而非静默假成功。
assert.deepEqual(parseCliArgs([]), { pairs: 3, output: undefined });
assert.deepEqual(parseCliArgs(["--pairs", "2", "--output", "/tmp/x.json"]), {
	pairs: 2,
	output: "/tmp/x.json",
});
assert.deepEqual(parseCliArgs(["--modes", "serial"]).pairs, 3);
assert.throws(
	() => parseCliArgs(["--modes", "serial,parallel"]),
	/parallel-worker A\/B is not implemented/u,
	"unimplemented modes must be rejected loudly",
);
// pairs 必须是正安全整数：0/负/NaN/非数字都拒绝（禁止空跑假成功）。
for (const bad of ["0", "-1", "abc", "1.5"])
	assert.throws(
		() => parseCliArgs(["--pairs", bad]),
		/positive integer/u,
		`--pairs ${bad} must be rejected`,
	);

// 两个评测 CLI 进程级：--pairs 0 必须非零退出（校验先于任何模型 spawn，不烧 token）。
for (const script of [
	"scripts/evaluate-prewalk-flow.mjs",
	"scripts/evaluate-prewalk.mjs",
])
	assert.throws(
		() =>
			execFileSync(process.execPath, [join(root, script), "--pairs", "0"], {
				stdio: "pipe",
				timeout: 60_000,
			}),
		`${script} --pairs 0 must exit non-zero`,
	);

// 扩展准备后的失败也必须清理临时目录；移除 PATH 中的 git，让 arm 在模型启动前失败。
const cleanupTmp = mkdtempSync(join(tmpdir(), "prewalk-cleanup-smoke-"));
try {
	assert.throws(() =>
		execFileSync(
			process.execPath,
			[join(root, "scripts/evaluate-prewalk-flow.mjs"), "--pairs", "1"],
			{
				env: { ...process.env, PATH: cleanupTmp, TMPDIR: cleanupTmp },
				stdio: "pipe",
				timeout: 60_000,
			},
		),
	);
	assert.deepEqual(
		readdirSync(cleanupTmp),
		[],
		"evaluation failure must remove its prepared extension and fixture",
	);
} finally {
	rmSync(cleanupTmp, { recursive: true, force: true });
}

// 失败语义：空结果或任一 arm 未干净完成都判失败。
const okPair = { cold: { ok: true }, fork: { ok: true } };
assert.equal(flowEvaluationFailed([okPair]), false);
assert.equal(
	flowEvaluationFailed([]),
	true,
	"empty results must fail (no silent empty run)",
);
for (const arm of ["cold", "fork"]) {
	assert.equal(
		flowEvaluationFailed([
			okPair,
			{ ...okPair, [arm]: { ok: false, reason: "paused" } },
		]),
		true,
		`${arm} failure must fail the evaluation`,
	);
	assert.equal(
		flowEvaluationFailed([{ ...okPair, [arm]: undefined }]),
		true,
		`missing ${arm} must fail the evaluation`,
	);
}

// 状态读取：仅「尚未生成」可视为 pending；canonical Schema/状态错误必须暴露根因。
const statusFixture = mkdtempSync(join(tmpdir(), "prewalk-status-smoke-"));
try {
	assert.equal(readFlowStatus(statusFixture), "pending");
	const flowDir = join(statusFixture, ".flow/F1");
	mkdirSync(flowDir, { recursive: true });
	const validFlow = {
		schemaVersion: 17,
		language: "zh",
		id: "F1",
		title: "Flow F1",
		status: "generating",
		source: { type: "prompt", text: "task" },
		createdAt: 1,
		updatedAt: 1,
		startedAt: null,
		completedAt: null,
		currentGoal: 0,
		meta: null,
		attention: null,
		parallelRun: null,
		repairAttempts: 0,
		errors: [],
		goals: [],
	};
	writeFileSync(join(flowDir, "flow.json"), JSON.stringify(validFlow));
	assert.equal(readFlowStatus(statusFixture), "generating");
	for (const invalid of [
		{},
		{ ...validFlow, status: "garbage" },
		{ ...validFlow, schemaVersion: undefined },
	]) {
		writeFileSync(join(flowDir, "flow.json"), JSON.stringify(invalid));
		assert.throws(
			() => readFlowStatus(statusFixture),
			/invalid canonical flow/u,
			"valid JSON with an invalid Flow Schema must fail",
		);
	}
	writeFileSync(join(flowDir, "flow.json"), "{broken\n");
	assert.throws(
		() => readFlowStatus(statusFixture),
		/invalid canonical flow/u,
		"malformed canonical state must not degrade to pending",
	);
} finally {
	rmSync(statusFixture, { recursive: true, force: true });
}

// 推进由 agent_settled 驱动；空闲时仅复用幂等 /flow go，不使用固定 sleep/轮询。
const prompts = [];
const statuses = ["draft", "complete"];
const fakeClient = {
	onEvent() {
		return () => {};
	},
	async promptAndWait(prompt) {
		prompts.push(prompt);
	},
	async getState() {
		return { isStreaming: false };
	},
};
assert.equal(
	await runFlowToTerminal(
		fakeClient,
		() => statuses.shift(),
		"/flow task",
		1000,
	),
	"complete",
);
assert.deepEqual(prompts, ["/flow task", "/flow go F1"]);
await assert.rejects(
	() =>
		runFlowToTerminal(
			{
				onEvent() {
					return () => {};
				},
				async promptAndWait() {},
				async getState() {
					throw new Error("rpc state failed");
				},
			},
			() => "draft",
			"/flow task",
			1000,
		),
	/rpc state failed/u,
	"RPC state failures must terminate instead of sending another command",
);

// settled 在 getState 响应前到达也必须被 latch 捕获，不能再等一个永远不会来的未来事件。
let settledListener = () => {};
let statusRead = 0;
const racingClient = {
	onEvent(listener) {
		settledListener = listener;
		return () => {
			settledListener = () => {};
		};
	},
	async promptAndWait() {},
	async getState() {
		settledListener({ type: "agent_settled" });
		return { isStreaming: true };
	},
};
assert.equal(
	await runFlowToTerminal(
		racingClient,
		() => (statusRead++ === 0 ? "running" : "complete"),
		"/flow task",
		1000,
	),
	"complete",
	"settled event during getState must be observed without waiting again",
);

// 任务 oracle 可证伪性：每类缺陷实现必须被拒绝，完整实现通过。
const BASE_CLIP = `export function clipText(text, maxLength, ellipsis = "\u2026") {
	return text;
}
`;
const GOOD_CLIP_START = `
/** 与 clipText 对称：保留尾部、截掉头部，省略号在头端。 */
export function clipStart(text, maxLength, ellipsis = "\u2026") {
	if (maxLength <= 0) return "";
	if (text.length <= maxLength) return text;
	if (maxLength <= ellipsis.length) return text.slice(-maxLength);
	return ellipsis + text.slice(-(maxLength - ellipsis.length));
}
`;
const oracleFixture = mkdtempSync(join(tmpdir(), "prewalk-oracle-smoke-"));
try {
	const git = (...args) =>
		execFileSync("git", ["-C", oracleFixture, ...args], { stdio: "pipe" });
	mkdirSync(join(oracleFixture, "src/shared"), { recursive: true });
	const clipPath = join(oracleFixture, "src/shared/clip.ts");
	writeFileSync(clipPath, BASE_CLIP);
	git("init", "-q");
	git("add", "-A");
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
	const check = (body, label) => {
		writeFileSync(clipPath, body);
		return { ...verifyClipStartTask(oracleFixture, { skipTsc: true }), label };
	};
	const good = check(BASE_CLIP + GOOD_CLIP_START, "good");
	assert.equal(
		good.ok,
		true,
		`complete implementation must pass: ${good.reason}`,
	);
	const defects = [
		["no-op change set", BASE_CLIP],
		[
			"raw tail without ellipsis",
			`${BASE_CLIP}\n// variant\nexport function clipStart(text, maxLength) { return text.slice(-maxLength); }\n`,
		],
		[
			"missing relationship comment",
			BASE_CLIP + GOOD_CLIP_START.replace(/\/\*\*.*\*\/\n/u, ""),
		],
		[
			"missing custom ellipsis support",
			`${BASE_CLIP}\n// variant\nexport function clipStart(text, maxLength) {\n\tif (maxLength <= 0) return "";\n\tif (text.length <= maxLength) return text;\n\treturn "\u2026" + text.slice(-(maxLength - 1));\n}\n`,
		],
	];
	for (const [label, body] of defects) {
		const result = check(body, label);
		assert.equal(
			result.ok,
			false,
			`defective implementation must fail: ${label}`,
		);
	}
	// 越范围改动：额外文件必须被拒绝。
	writeFileSync(clipPath, BASE_CLIP + GOOD_CLIP_START);
	writeFileSync(join(oracleFixture, "extra.ts"), "export {};\n");
	const outOfScope = verifyClipStartTask(oracleFixture, { skipTsc: true });
	assert.equal(outOfScope.ok, false, "out-of-scope file must fail");
} finally {
	rmSync(oracleFixture, { recursive: true, force: true });
}

console.log("prewalk flow eval smoke passed");
