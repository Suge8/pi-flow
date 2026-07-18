// prewalk 真实 A/B 评测：同一计划会话下，执行会话「冷启动 vs fork 轨迹继承」对照。
// 任务表覆盖三类代表性形态（探索实现 / 读密集跨模块理解 / 症状定位修 bug），
// pair 按任务轮转采样；每个 pair 共享一次真实计划会话（advisor 模型读代码写计划），
// 两个 arm 用 executor 模型完成同一任务，唯一变量是执行会话的初始上下文。
// 记账边界：fork 分支文件物理包含计划期前缀，统计从计划完成点之后开始，
// 计划成本单列为共享成本，永不计入任一执行 arm。arm 顺序按 pair 奇偶交替。
// 指标口径：readCalls 只统计专用读取工具（read/grep/find/ls/glob），bash 调用单列
// 为 bashCalls（其中可能含 cat/rg 等 shell 读取，不并入 readCalls）。
// 用法：node scripts/evaluate-prewalk.mjs [--pairs N] [--output FILE]
import { execFileSync, spawn } from "node:child_process";
import {
	cpSync,
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
const { SessionManager } = await import("@earendil-works/pi-coding-agent");

const COMMON_RULES = [
	"要求：匹配项目现有代码风格（tab 缩进、中文注释、命名精确）；完成后运行 npx tsc --noEmit 确认通过。",
	"这是无人值守任务：不要提问，直接完成后停止。",
].join("\n");

/** 代表性任务表：id / 任务文本 / 可选 fixture 预处理 / 行为 oracle。 */
const TASKS = [
	{
		id: "clip-start",
		brief: [
			"任务：这个仓库的多个模块会把长文本截断后加省略号展示。找到 shared 层承担这个职责的实现函数与它的全部调用方，搞清楚它的截断语义（从哪端截、省略号放哪端、省略号参数如何工作）。",
			"然后在同一个实现文件里新增一个保留尾部、截掉头部的导出变体，命名为 clipStart，语义和签名都与现有函数严格对称（含可自定义省略号参数与全部边界分支），并在函数前用注释说明两者关系；不要修改任何调用方。",
			COMMON_RULES,
		].join("\n"),
		verify: verifyClipStart,
	},
	{
		id: "entries-until",
		brief: [
			"任务：这个仓库的 shared 层有一个会话分支遍历工具模块，其中有一个「取锚点之后 entries」的函数。通读该模块与它的全部调用方，理解锚点缺失时的语义约定。",
			"然后在同一个文件里新增对称的导出函数 sessionEntriesUntil(ctx, anchorId)：返回分支开头到锚点（含锚点自身）的 entries；锚点缺失或不在当前分支上时返回全量。风格与注释惯例保持一致；不要修改任何调用方。",
			COMMON_RULES,
		].join("\n"),
		verify: verifyEntriesUntil,
	},
	{
		id: "clip-boundary-fix",
		brief: [
			"任务：用户报告了一个展示缺陷——长度恰好等于上限的文本也被截断加了省略号，预期应该原样显示。在仓库里定位根因并修复；只修这一个缺陷，不要改变任何其他行为。",
			COMMON_RULES,
		].join("\n"),
		setup: (fixture) => {
			const path = join(fixture, "src/shared/clip.ts");
			const source = readFileSync(path, "utf8");
			const buggy = source.replace(
				"if (text.length <= maxLength) return text;",
				"if (text.length < maxLength) return text;",
			);
			if (buggy === source) throw new Error("bug injection anchor missing");
			writeFileSync(path, buggy);
		},
		verify: verifyClipFix,
	},
];

const PLAN_PROMPT_HEAD = [
	"你在为一个执行代理准备实现计划。先深入探索代码库：定位目标实现、通读全部调用方、确认项目的代码风格与注释惯例，把候选位置都看一遍再下结论。",
	"硬约束：本阶段严禁修改、新建或删除任何业务代码文件；唯一允许的写操作是新建 PLAN.md（实现位置、函数签名、复用点、验证命令）。下方任务描述里的修改要求由后续执行代理完成，不是你。",
	"这是无人值守任务：不要提问，写完 PLAN.md 后停止。",
	"",
].join("\n");

const UNLOCK_NOTE =
	"本会话延续自计划会话：计划期的代码探索与结论可直接复用，未变更的文件不必重读。生成阶段「只读、不改业务代码」的限制已解除，从现在起正常修改业务代码。\n";

const READ_TOOLS = new Set(["read", "grep", "find", "ls", "glob"]);

if (process.argv[1] && resolve(process.argv[1]) === scriptPath)
	await main(process.argv.slice(2));

async function main(argv) {
	const output = argValue(argv, "--output");
	const onlyTask = argValue(argv, "--task");
	const tasks = onlyTask ? TASKS.filter((task) => task.id === onlyTask) : TASKS;
	if (tasks.length === 0) throw new Error(`unknown task: ${onlyTask}`);
	// 默认即文档口径：每任务 3 对（全量无参 = 9 对）；非正整数拒绝，禁止空跑假成功。
	const pairs = Number(argValue(argv, "--pairs") ?? tasks.length * 3);
	if (!Number.isSafeInteger(pairs) || pairs <= 0)
		throw new Error(
			`--pairs must be a positive integer, got: ${argValue(argv, "--pairs")}`,
		);
	const config = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
	const advisor = config.modelRoles?.advisor;
	const executor = config.modelRoles?.executor;
	if (!advisor?.model || !executor?.model)
		throw new Error("config.json 需要 modelRoles.advisor / executor");
	const results = [];
	for (let pair = 0; pair < pairs; pair += 1) {
		const task = tasks[pair % tasks.length];
		console.log(`\n=== pair ${pair + 1}/${pairs} · task ${task.id} ===`);
		// arm 顺序按 pair 奇偶交替，消除固定顺序偏差。
		// 计划模型违反只读约定时整 pair 作废重试（全新 fixture），避免轨迹与磁盘不一致污染实验。
		results.push(
			await runPairWithRetry(advisor, executor, task, pair % 2 === 1),
		);
		printSummary(results);
	}
	if (output)
		writeFileSync(
			resolve(root, output),
			`${JSON.stringify(
				{
					tasks: TASKS.map((task) => ({ id: task.id, brief: task.brief })),
					advisor,
					executor,
					results,
				},
				null,
				2,
			)}\n`,
		);
	// 验证失败禁止假成功：任一 arm 未通过行为/范围/tsc 断言即非零退出（完整报告保留）。
	if (evaluationFailed(results)) {
		console.error(
			"\nevaluation FAILED: at least one arm did not pass verification",
		);
		process.exitCode = 1;
	}
}

/** 空结果或任一 cold/fork arm 验证未通过即判定失败（纯函数，供回归测试）。 */
export function evaluationFailed(results) {
	return (
		results.length === 0 ||
		results.some((result) =>
			["cold", "fork"].some((arm) => result[arm]?.verified?.ok !== true),
		)
	);
}

async function runPairWithRetry(advisor, executor, task, forkFirst) {
	const attempts = 3;
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await runPair(advisor, executor, task, forkFirst);
		} catch (error) {
			if (
				attempt >= attempts ||
				!String(error?.message).includes("plan phase modified the fixture")
			)
				throw error;
			console.log(
				`[plan] read-only violation, retrying pair (${attempt}/${attempts})`,
			);
		}
	}
}

async function runPair(advisor, executor, task, forkFirst) {
	const work = mkdtempSync(join(tmpdir(), "prewalk-eval-"));
	try {
		const fixture = createFixture(work, task);
		const sessionDir = join(work, "sessions");
		mkdirSync(sessionDir, { recursive: true });

		// 阶段 A：真实计划会话（两个 arm 共享同一轨迹与同一份 PLAN.md）。
		const planSession = join(sessionDir, "plan.jsonl");
		console.log(`[plan] ${advisor.model} exploring ${fixture}`);
		const plan = await runPi({
			cwd: fixture,
			session: planSession,
			model: advisor,
			prompt: `${PLAN_PROMPT_HEAD}${task.brief}`,
		});
		const planText = readFileSync(join(fixture, "PLAN.md"), "utf8");
		const planLeaf = SessionManager.open(planSession).getLeafId();
		if (!planLeaf) throw new Error("plan session has no leaf");
		// 计划期守卫：porcelain 能看到未跟踪文件；只允许新增 PLAN.md。
		const planChanges = gitStatus(fixture).filter(
			(line) => !line.endsWith(" PLAN.md") && !line.endsWith("\tPLAN.md"),
		);
		if (planChanges.length > 0)
			throw new Error(`plan phase modified the fixture: ${planChanges}`);
		// 把 PLAN.md 纳入执行起点快照：两个 arm 从完全相同的仓库状态开始。
		git(fixture, "add", "-A");
		git(
			fixture,
			"-c",
			"user.email=eval@local",
			"-c",
			"user.name=eval",
			"commit",
			"-qm",
			"plan",
		);
		const goalPrompt = `执行以下计划。\n\n计划全文：\n${planText}\n\n${task.brief}`;

		const runCold = async () => {
			console.log(`[cold] ${executor.model}`);
			return runArm({
				fixture,
				task,
				session: join(sessionDir, "cold.jsonl"),
				model: executor,
				prompt: goalPrompt,
			});
		};
		const runFork = async () => {
			// arm fork：从计划完成点物理分支（prewalk 路径）；
			// 分支文件包含计划前缀，账单从 planLeaf 之后开始统计。
			const manager = SessionManager.open(planSession);
			const forkSession = manager.createBranchedSession(planLeaf);
			if (!forkSession) throw new Error("createBranchedSession failed");
			console.log(`[fork] ${executor.model}`);
			return runArm({
				fixture,
				task,
				session: forkSession,
				model: executor,
				prompt: `${UNLOCK_NOTE}\n${goalPrompt}`,
				sinceEntryId: planLeaf,
			});
		};
		let cold;
		let fork;
		if (forkFirst) {
			fork = await runFork();
			resetFixture(fixture);
			cold = await runCold();
		} else {
			cold = await runCold();
			resetFixture(fixture);
			fork = await runFork();
		}
		return {
			task: task.id,
			plan: { ...plan, model: advisor.model },
			cold,
			fork,
			forkFirst,
		};
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

async function runArm({ fixture, task, session, model, prompt, sinceEntryId }) {
	const run = await runPi({
		cwd: fixture,
		session,
		model,
		prompt,
		sinceEntryId,
	});
	const verified = verifyTask(fixture, task);
	return { ...run, verified };
}

function createFixture(work, task) {
	const fixture = join(work, "repo");
	mkdirSync(fixture, { recursive: true });
	for (const entry of ["src", "package.json", "tsconfig.json", "biome.json"])
		cpSync(join(root, entry), join(fixture, entry), { recursive: true });
	symlinkSync(join(root, "node_modules"), join(fixture, "node_modules"), "dir");
	task.setup?.(fixture);
	git(fixture, "init", "-q");
	git(fixture, "add", "-A");
	git(
		fixture,
		"-c",
		"user.email=eval@local",
		"-c",
		"user.name=eval",
		"commit",
		"-qm",
		"fixture",
	);
	return fixture;
}

function resetFixture(fixture) {
	git(fixture, "checkout", "-q", "--", ".");
	git(fixture, "clean", "-qfd", "--exclude=node_modules");
}

function gitStatus(fixture) {
	return execFileSync("git", ["-C", fixture, "status", "--porcelain"], {
		encoding: "utf8",
	})
		.split("\n")
		.filter((line) => line.trim());
}

function git(fixture, ...args) {
	execFileSync("git", ["-C", fixture, ...args], { stdio: "pipe" });
}

/** 任务验证：变更范围只允许目标实现文件 + 任务专属行为 oracle + tsc。 */
function verifyTask(fixture, task) {
	const behavior = task.verify(fixture);
	return behavior.ok ? verifyTypeScript(fixture) : behavior;
}

export function verifyTypeScript(fixture) {
	try {
		execFileSync("npx", ["tsc", "--noEmit"], {
			cwd: fixture,
			stdio: "pipe",
			timeout: 300_000,
		});
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			reason: `tsc failed: ${String(error.stdout ?? error.message).slice(0, 200)}`,
		};
	}
}

function verifyChangeSet(fixture, allowedFile) {
	const changed = gitStatus(fixture);
	if (
		changed.length !== 1 ||
		!changed[0].includes(allowedFile) ||
		!changed[0].trimStart().startsWith("M")
	)
		return {
			ok: false,
			reason: `unexpected change set: ${changed.join(" | ") || "(no change)"}`,
		};
	return { ok: true };
}

/** clip-start oracle：与 clipText 严格对称的行为断言 + 注释要求 + 变更范围。 */
export function verifyClipStart(fixture) {
	const scope = verifyChangeSet(fixture, "src/shared/clip.ts");
	if (!scope.ok) return scope;
	const source = readFileSync(join(fixture, "src/shared/clip.ts"), "utf8");
	if (
		!/(\/\*\*[\s\S]*?\*\/|\/\/[^\n]*)\s*\nexport function clipStart/u.test(
			source,
		)
	)
		return {
			ok: false,
			reason: "clipStart is missing its relationship comment",
		};
	return runProbe(fixture, [
		`const { clipStart } = await import(${JSON.stringify(fileUrl(fixture, "src/shared/clip.ts"))});`,
		probeAssert(),
		// 与 clipText("abcdefghij", 5) === "abcd…" 严格对称：省略号在头端。
		`assert(clipStart("abcdefghij", 5) === "\\u2026ghij", "default ellipsis symmetry: " + clipStart("abcdefghij", 5));`,
		// 自定义省略号参数对称。
		`assert(clipStart("abcdefghij", 5, "..") === "..hij", "custom ellipsis symmetry: " + clipStart("abcdefghij", 5, ".."));`,
		// 短文本透传、零预算、极小预算（max <= ellipsis 长度）对称分支。
		`assert(clipStart("abc", 10) === "abc", "short text must pass through");`,
		`assert(clipStart("abcdefgh", 0) === "", "zero budget must return empty");`,
		`assert(clipStart("abcdefgh", 1) === "h", "tiny budget keeps the raw tail: " + clipStart("abcdefgh", 1));`,
	]);
}

/** entries-until oracle：编译依赖闭包后实际执行，验证锚点语义。 */
function verifyEntriesUntil(fixture) {
	const scope = verifyChangeSet(fixture, "src/shared/session.ts");
	if (!scope.ok) return scope;
	const compiled = join(fixture, ".eval-compiled");
	try {
		execFileSync(
			"npx",
			[
				"tsc",
				"--ignoreConfig",
				"src/shared/session.ts",
				"--outDir",
				compiled,
				"--rootDir",
				"src",
				"--module",
				"NodeNext",
				"--moduleResolution",
				"NodeNext",
				"--target",
				"ES2022",
				"--skipLibCheck",
				"--types",
				"node",
			],
			{ cwd: fixture, stdio: "pipe", timeout: 300_000 },
		);
	} catch (error) {
		return {
			ok: false,
			reason: `probe compile failed: ${String(error.stdout ?? error.message).slice(0, 200)}`,
		};
	}
	const result = runProbe(fixture, [
		`const { sessionEntriesUntil } = await import(${JSON.stringify(fileUrl(fixture, ".eval-compiled/shared/session.js"))});`,
		probeAssert(),
		`const ctx = { sessionManager: { getBranch: () => [{ id: "a" }, { id: "b" }, { id: "c" }] } };`,
		`assert(JSON.stringify(sessionEntriesUntil(ctx, "b").map((entry) => entry.id)) === '["a","b"]', "anchor slices inclusively");`,
		`assert(sessionEntriesUntil(ctx, "missing").length === 3, "unknown anchor keeps all entries");`,
		`assert(sessionEntriesUntil(ctx, undefined).length === 3, "no anchor keeps all entries");`,
	]);
	rmSync(compiled, { recursive: true, force: true });
	// 编译产物已删除；探针目录不允许污染变更范围判定（gitignore 外文件已被删除）。
	return result;
}

/** clip-boundary-fix oracle：off-by-one 修复后的边界行为 + 截断行为未回归。 */
function verifyClipFix(fixture) {
	const scope = verifyChangeSet(fixture, "src/shared/clip.ts");
	if (!scope.ok) return scope;
	return runProbe(fixture, [
		`const { clipText } = await import(${JSON.stringify(fileUrl(fixture, "src/shared/clip.ts"))});`,
		probeAssert(),
		`assert(clipText("abcde", 5) === "abcde", "exact-length text must pass through: " + clipText("abcde", 5));`,
		`assert(clipText("abcdef", 5) === "abcd\\u2026", "longer text must still clip: " + clipText("abcdef", 5));`,
		`assert(clipText("abc", 0) === "", "zero budget unchanged");`,
	]);
}

function probeAssert() {
	return `const assert = (cond, label) => { if (!cond) { console.error("BEHAVIOR-FAIL: " + label); process.exit(1); } };`;
}

function fileUrl(fixture, relativePath) {
	return pathToFileURL(join(fixture, relativePath)).href;
}

function runProbe(fixture, lines) {
	const probe = [...lines, `console.log("BEHAVIOR-OK");`].join("\n");
	try {
		const output = execFileSync(
			process.execPath,
			["--input-type=module", "-e", probe],
			{ cwd: fixture, encoding: "utf8", stdio: "pipe", timeout: 60_000 },
		);
		if (!output.includes("BEHAVIOR-OK"))
			return { ok: false, reason: `behavior probe inconclusive: ${output}` };
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			reason: `behavior check failed: ${String(error.stderr ?? error.message).slice(0, 200)}`,
		};
	}
}

async function runPi({ cwd, session, model, prompt, sinceEntryId }) {
	const startedAt = Date.now();
	const args = [
		"--no-extensions",
		"--no-skills",
		"--no-context-files",
		"--no-prompt-templates",
		"--session",
		session,
		"--model",
		model.model,
		"--thinking",
		model.thinking ?? "medium",
		"--mode",
		"json",
		"-p",
		prompt,
	];
	await spawnCapture("pi", args, cwd, 30 * 60_000);
	return {
		...sessionStats(readFileSync(session, "utf8"), sinceEntryId),
		elapsedMs: Date.now() - startedAt,
	};
}

/**
 * 聚合会话的真实账单与工具行为（读自 session JSONL 的 usage 事实）。
 * sinceEntryId：fork 分支文件物理包含计划期前缀（entry id 原样保留），
 * 传入计划完成点后只统计其后的执行期消息；共享的计划成本必须单列，不得计入执行 arm。
 * readCalls 只覆盖专用读取工具；bash 调用单列（可能含 shell 读取），不并入 readCalls。
 */
export function sessionStats(jsonl, sinceEntryId) {
	const stats = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		turns: 0,
		readCalls: 0,
		editCalls: 0,
		bashCalls: 0,
	};
	let counting = sinceEntryId === undefined;
	for (const line of jsonl.split("\n")) {
		if (!line.trim()) continue;
		const entry = JSON.parse(line);
		if (!counting) {
			if (entry.id === sinceEntryId) counting = true;
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message?.role === "assistant") {
			stats.turns += 1;
			const usage = message.usage ?? {};
			stats.input += usage.input ?? 0;
			stats.output += usage.output ?? 0;
			stats.cacheRead += usage.cacheRead ?? 0;
			stats.cacheWrite += usage.cacheWrite ?? 0;
			stats.cost += usage.cost?.total ?? 0;
			for (const part of Array.isArray(message.content)
				? message.content
				: []) {
				if (part?.type !== "toolCall") continue;
				const name = String(part.name ?? "");
				if (READ_TOOLS.has(name)) stats.readCalls += 1;
				if (name === "bash") stats.bashCalls += 1;
				if (name === "edit" || name === "write") stats.editCalls += 1;
			}
		}
	}
	return stats;
}

function printSummary(results) {
	const groups = new Map();
	for (const result of results) {
		const group = groups.get(result.task) ?? [];
		group.push(result);
		groups.set(result.task, group);
	}
	console.log(`\n--- summary over ${results.length} pair(s) ---`);
	for (const [taskId, group] of groups) {
		console.log(`task ${taskId} (${group.length} pair(s)):`);
		printArmRow("  plan (shared, excluded)", group, (result) => ({
			...result.plan,
			verified: { ok: true },
		}));
		printArmRow("  cold", group, (result) => result.cold);
		printArmRow("  fork", group, (result) => result.fork);
	}
	const failures = results.flatMap((result) =>
		["cold", "fork"].flatMap((arm) =>
			result[arm].verified?.ok
				? []
				: [`${result.task}/${arm}: ${result[arm].verified?.reason}`],
		),
	);
	for (const failure of failures) console.log(`  ✗ ${failure}`);
}

function printArmRow(label, group, pick) {
	const arms = group.map(pick);
	const total = (key) => arms.reduce((sum, arm) => sum + (arm[key] ?? 0), 0);
	const ok = arms.filter((arm) => arm.verified?.ok).length;
	console.log(
		`${label}: cost=$${total("cost").toFixed(3)} read=${total("readCalls")} bash=${total("bashCalls")} edits=${total("editCalls")} turns=${total("turns")} in=${total("input")} cacheRead=${total("cacheRead")} out=${total("output")} elapsed=${Math.round(total("elapsedMs") / 1000)}s verified=${ok}/${arms.length}`,
	);
}

function argValue(argv, name) {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : undefined;
}

function spawnCapture(command, args, cwd, timeoutMs) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stderr = "";
		child.stdout.resume();
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`${command} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0)
				reject(new Error(`${command} exited ${code}: ${stderr.slice(-400)}`));
			else resolvePromise(undefined);
		});
	});
}
