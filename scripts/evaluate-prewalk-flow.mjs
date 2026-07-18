// 真实 /flow off/on 对照：RPC 驱动完整扩展路径（生成→autoStart→执行→验收→质检）。
// 自包含：自动准备 fixture 仓库与独立扩展目录（.eval-ext，独立 config 控制 prewalk 开关）。
// 每 pair 交替 arm 顺序；每 arm 断言 Flow complete + 验收/质检最终通过 + clipStart 行为，
// 任一断言失败以非零退出（禁止假成功）。账单从 goal 会话对账，fork arm 以 sessionAnchorId 为界。
// 用法：node scripts/evaluate-prewalk-flow.mjs [--pairs N] [--modes serial] [--output FILE]
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = dirname(dirname(scriptPath));
// 宿主包无 exports main，不可经裸 require.resolve；从仓库 node_modules 定位。
const agentDist = join(root, "node_modules/@earendil-works/pi-coding-agent");
const { RpcClient } = await import(
	pathToFileURL(join(agentDist, "dist/modes/rpc/rpc-client.js")).href
);
const { sessionStats, verifyClipStart, verifyTypeScript } = await import(
	pathToFileURL(join(root, "scripts/evaluate-prewalk.mjs")).href
);
const { validateFlowDir } = await import(
	pathToFileURL(join(root, "dist/flow/validator.js")).href
);

const TASK =
	"在这个仓库的 shared 层找到把长文本截断加省略号的实现函数，在同一文件新增保留尾部截掉头部的对称导出变体 clipStart（含可自定义省略号参数），注释说明两者关系，不改任何调用方，完成后 npx tsc --noEmit 通过";
const RUN_TIMEOUT_MS = 45 * 60_000;

if (process.argv[1] && resolve(process.argv[1]) === scriptPath)
	await main(process.argv.slice(2));

export function parseCliArgs(argv) {
	const value = (name, fallback) => {
		const index = argv.indexOf(name);
		return index >= 0 ? argv[index + 1] : fallback;
	};
	const modes = String(value("--modes", "serial")).split(",");
	const unsupported = modes.filter((mode) => mode !== "serial");
	if (unsupported.length > 0)
		throw new Error(
			`unsupported modes: ${unsupported.join(",")} (parallel-worker A/B is not implemented yet; only serial is)`,
		);
	const pairs = Number(value("--pairs", 3));
	if (!Number.isSafeInteger(pairs) || pairs <= 0)
		throw new Error(
			`--pairs must be a positive integer, got: ${value("--pairs")}`,
		);
	return { pairs, output: value("--output") };
}

/** 空结果或任一 arm 未干净收口即判定失败（纯函数，供回归测试；禁止空跑假成功）。 */
export function flowEvaluationFailed(results) {
	return (
		results.length === 0 ||
		results.some((pair) =>
			["cold", "fork"].some((arm) => pair[arm]?.ok !== true),
		)
	);
}

async function main(argv) {
	const args = parseCliArgs(argv);
	const extensionDir = prepareExtension();
	try {
		const results = [];
		for (let pair = 0; pair < args.pairs; pair += 1) {
			const forkFirst = pair % 2 === 1;
			console.log(
				`\n=== pair ${pair + 1}/${args.pairs} (${forkFirst ? "fork" : "cold"} first) ===`,
			);
			results.push(await runPair(extensionDir, forkFirst));
			for (const line of summaryLines(results)) console.log(line);
		}
		if (args.output)
			writeFileSync(
				resolve(root, args.output),
				`${JSON.stringify({ task: TASK, results }, null, 2)}\n`,
			);
		if (flowEvaluationFailed(results)) {
			console.error(
				"\nevaluation FAILED: at least one arm did not complete cleanly",
			);
			process.exitCode = 1;
		}
	} finally {
		rmSync(extensionDir, { recursive: true, force: true });
	}
}

/** 独立扩展目录：真实 dist + 独立 config（prewalk 开关由 arm 写入）。 */
function prepareExtension() {
	const extensionDir = mkdtempSync(join(tmpdir(), "prewalk-flow-ext-"));
	try {
		for (const entry of ["dist", "prompts", "assets"])
			cpSync(join(root, entry), join(extensionDir, entry), { recursive: true });
		// 宿主包运行时解析：扩展子进程从自身位置向上找 node_modules。
		symlinkSync(
			join(root, "node_modules"),
			join(extensionDir, "node_modules"),
			"dir",
		);
		writeFileSync(join(extensionDir, "package.json"), '{"type":"module"}\n');
		return extensionDir;
	} catch (error) {
		rmSync(extensionDir, { recursive: true, force: true });
		throw error;
	}
}

function prepareFixture(work) {
	const fixture = join(work, "repo");
	mkdirSync(fixture, { recursive: true });
	for (const entry of ["src", "package.json", "tsconfig.json", "biome.json"])
		cpSync(join(root, entry), join(fixture, entry), { recursive: true });
	symlinkSync(join(root, "node_modules"), join(fixture, "node_modules"), "dir");
	writeFileSync(join(fixture, ".gitignore"), "node_modules\n.flow/\n");
	git(fixture, "init", "-q");
	git(fixture, "add", "-A");
	git(
		fixture,
		"-c",
		"user.email=e@l",
		"-c",
		"user.name=e",
		"commit",
		"-qm",
		"base",
	);
	return fixture;
}

async function runPair(extensionDir, forkFirst) {
	const work = mkdtempSync(join(tmpdir(), "prewalk-flow-eval-"));
	try {
		const fixture = prepareFixture(work);
		const arms = forkFirst ? ["fork", "cold"] : ["cold", "fork"];
		const pair = { forkFirst };
		for (const arm of arms) {
			resetFixture(fixture);
			rmSync(join(fixture, ".flow"), { recursive: true, force: true });
			pair[arm] = await runArm(extensionDir, fixture, arm === "fork");
			console.log(
				`[${arm}] ${pair[arm].ok ? "ok" : `FAIL: ${pair[arm].reason}`} elapsed=${Math.round(pair[arm].elapsedMs / 1000)}s cost=$${pair[arm].cost?.toFixed(3) ?? "?"}`,
			);
		}
		return pair;
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

async function runArm(extensionDir, fixture, prewalkOn) {
	const startedAt = Date.now();
	let client;
	let outcome;
	try {
		const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
		config.generation = { align: "no" };
		config.prewalk = { enabled: prewalkOn };
		writeFileSync(
			join(extensionDir, "config.json"),
			JSON.stringify(config, null, 2),
		);
		client = new RpcClient({
			cliPath: join(agentDist, "dist/cli.js"),
			cwd: fixture,
			args: [
				"--no-extensions",
				"--no-skills",
				"--no-context-files",
				"-e",
				join(extensionDir, "dist/index.js"),
			],
		});
		await client.start();
		const status = await runFlowToTerminal(
			client,
			() => readFlowStatus(fixture),
			`/flow ${TASK}`,
		);
		outcome = collectArm(fixture, prewalkOn, status);
	} catch (error) {
		outcome = armSystemFailure(error);
	}
	if (client)
		try {
			await client.stop();
		} catch (error) {
			outcome = armSystemFailure(error, outcome);
		}
	return { ...outcome, elapsedMs: Date.now() - startedAt };
}

/**
 * RPC 的 agent_settled 是推进节拍；setImmediate 只让已登记的 session transition 先执行，
 * 不引入固定等待。空闲且未终结时复用幂等 `/flow go` 恢复入口。
 */
export async function runFlowToTerminal(
	client,
	readStatus,
	initialPrompt,
	timeoutMs = RUN_TIMEOUT_MS,
) {
	const deadline = Date.now() + timeoutMs;
	const remaining = () => {
		const duration = deadline - Date.now();
		if (duration <= 0) throw new Error("Flow evaluation timed out");
		return duration;
	};
	await client.promptAndWait(initialPrompt, undefined, remaining());
	for (;;) {
		await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
		const status = readStatus();
		if (status === "complete" || status === "paused") return status;
		const settled = createAgentSettledLatch(client);
		try {
			const state = await client.getState();
			if (settled.hasSettled()) continue;
			if (state.isStreaming) await settled.wait(remaining());
			else await client.promptAndWait("/flow go F1", undefined, remaining());
		} finally {
			settled.close();
		}
	}
}

function createAgentSettledLatch(client) {
	let settled = false;
	let resolveSettled = () => {};
	const settledPromise = new Promise((resolvePromise) => {
		resolveSettled = resolvePromise;
	});
	const unsubscribe = client.onEvent((event) => {
		if (event.type !== "agent_settled" || settled) return;
		settled = true;
		resolveSettled();
	});
	return {
		hasSettled: () => settled,
		async wait(timeoutMs) {
			if (settled) return;
			let timer;
			try {
				await Promise.race([
					settledPromise,
					new Promise((_, rejectPromise) => {
						timer = setTimeout(
							() => rejectPromise(new Error("Flow evaluation timed out")),
							timeoutMs,
						);
					}),
				]);
			} finally {
				if (timer) clearTimeout(timer);
			}
		},
		close: unsubscribe,
	};
}

function armSystemFailure(error, previous) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		ok: false,
		status: "error",
		reason: previous?.reason
			? `${previous.reason}; cleanup failed: ${message}`
			: message,
	};
}

/** 收数 + 断言：complete、验收/质检最终 passed、clipStart 行为、账单（fork 以锚点为界）。 */
function collectArm(fixture, prewalkOn, status) {
	const fail = (reason) => ({ ok: false, reason, status });
	if (status !== "complete") return fail(`flow status is ${status}`);
	const flow = JSON.parse(
		readFileSync(join(fixture, ".flow/F1/flow.json"), "utf8"),
	);
	const goal = flow.goals[0];
	const checks = goal.checks ?? {};
	const lastResult = (phase) => (checks[phase]?.rounds ?? []).at(-1)?.result;
	// 验收与质检都必须至少跑一轮且最终通过（声明是含完整检查链的 A/B，零轮不得静默放行）。
	if (lastResult("acceptance") !== "passed")
		return fail("acceptance not passed");
	if (lastResult("quality") !== "passed")
		return fail("quality did not run or not passed");
	const behavior = verifyClipStartTask(fixture);
	if (!behavior.ok) return fail(behavior.reason);
	const jsonl = readFileSync(goal.sessionFile, "utf8");
	// fork arm 必须真的 fork（parentSession 血缘）；静默退化冷启动不得计入 fork 数据。
	// anchor 对所有 Goal 都会写入，不能作为 fork 证据。
	const forkedLineage =
		JSON.parse(jsonl.split("\n")[0]).parentSession !== undefined;
	if (prewalkOn && !forkedLineage)
		return fail(
			"fork arm silently fell back to cold start (no parentSession lineage)",
		);
	if (!prewalkOn && forkedLineage)
		return fail("cold arm unexpectedly has fork lineage");
	const anchor = prewalkOn ? goalAnchor(jsonl) : undefined;
	if (prewalkOn && !anchor) return fail("fork arm has no session anchor");
	const stats = sessionStats(jsonl, anchor);
	return {
		ok: true,
		status,
		execMs: (goal.completedAt ?? 0) - (goal.startedAt ?? 0),
		acceptanceRounds: (checks.acceptance?.rounds ?? []).map(
			(round) => round.result,
		),
		qualityRounds: (checks.quality?.rounds ?? []).map((round) => round.result),
		forkedLineage,
		...stats,
	};
}

function goalAnchor(jsonl) {
	for (const line of jsonl.split("\n")) {
		if (!line.trim()) continue;
		const entry = JSON.parse(line);
		if (entry.type === "custom" && entry.customType === "goal-state")
			return entry.data?.goal?.sessionAnchorId;
	}
	return undefined;
}

/** 复用隔离 harness 的唯一 clipStart oracle；Flow 路径只补完整链路断言。 */
export function verifyClipStartTask(fixture, { skipTsc = false } = {}) {
	const behavior = verifyClipStart(fixture);
	return behavior.ok && !skipTsc ? verifyTypeScript(fixture) : behavior;
}

function summaryLines(results) {
	const lines = [`--- summary over ${results.length} pair(s) ---`];
	for (const arm of ["cold", "fork"]) {
		const runs = results.map((pair) => pair[arm]).filter(Boolean);
		const ok = runs.filter((run) => run.ok).length;
		const total = (key) => runs.reduce((sum, run) => sum + (run[key] ?? 0), 0);
		lines.push(
			`${arm}: ok=${ok}/${runs.length} cost=$${total("cost").toFixed(3)} exec=${Math.round(total("execMs") / 1000)}s read=${total("readCalls")} turns=${total("turns")}`,
		);
	}
	return lines;
}

export function readFlowStatus(fixture) {
	const canonicalDir = join(fixture, ".flow/F1");
	if (!existsSync(join(canonicalDir, "flow.json"))) return "pending";
	const validation = validateFlowDir(canonicalDir);
	if (!validation.ok || !validation.flow)
		throw new Error(`invalid canonical flow: ${validation.errors.join("; ")}`);
	return validation.flow.status;
}

function resetFixture(fixture) {
	git(fixture, "checkout", "-q", "--", ".");
	git(fixture, "clean", "-qfd", "--exclude=node_modules");
}

function git(fixture, ...args) {
	execFileSync("git", ["-C", fixture, ...args], { stdio: "pipe" });
}
