import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-prewalk-test-${runId}`);
const srcOut = join(out, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
prepareTestDist(root, srcOut);

const writeConfig = (config) =>
	writeFileSync(join(out, "config.json"), JSON.stringify(config));

try {
	const configModule = await import(
		`file://${join(srcOut, "shared/config.js")}?t=${Date.now()}`
	);
	const sessionModule = await import(
		`file://${join(srcOut, "shared/session.js")}?t=${Date.now()}`
	);
	const prewalkModule = await import(
		`file://${join(srcOut, "flow/prewalk.js")}?t=${Date.now()}`
	);
	const promptModule = await import(
		`file://${join(srcOut, "flow/prompt.js")}?t=${Date.now()}`
	);
	const { CURRENT_SESSION_VERSION, SessionManager } = await import(
		"@earendil-works/pi-coding-agent"
	);

	// ---- config: prewalk 键默认与校验 ----
	// 未配置时运行时回退 false；官方模板单独选择开启。
	assert.equal(
		configModule.readFlowConfig().prewalk.enabled,
		false,
		"prewalk defaults to disabled without config.json",
	);
	writeConfig({ prewalk: { enabled: false } });
	assert.equal(configModule.readFlowConfig().prewalk.enabled, false);
	writeConfig({ prewalk: { enabled: true } });
	assert.equal(configModule.readFlowConfig().prewalk.enabled, true);
	writeConfig({ prewalk: { unknown: 1 } });
	assert.throws(
		() => configModule.readFlowConfig(),
		/prewalk/u,
		"unknown prewalk keys are rejected",
	);
	writeConfig({ prewalk: { enabled: true } });

	// ---- sessionEntriesSince: 锚点切片 ----
	const entries = [
		{ type: "message", id: "e1" },
		{ type: "custom", id: "e2", customType: "x" },
		{ type: "message", id: "e3" },
	];
	const entriesCtx = { sessionManager: { getBranch: () => entries } };
	assert.deepEqual(
		sessionModule.sessionEntriesSince(entriesCtx, undefined),
		entries,
		"no anchor keeps all entries",
	);
	assert.deepEqual(
		sessionModule.sessionEntriesSince(entriesCtx, "e2").map((e) => e.id),
		["e3"],
		"anchor slices to entries after it",
	);
	assert.deepEqual(
		sessionModule.sessionEntriesSince(entriesCtx, "missing"),
		entries,
		"unknown anchor keeps all entries",
	);

	// ---- planGoalPrompt: fork 解禁句 ----
	const goal = {
		index: 0,
		title: "Test goal",
		file: "G1-test.md",
		role: "normal",
		result: {},
	};
	const flowBase = { id: "F1", language: "zh", goals: [goal] };
	const coldPrompt = promptModule.planGoalPrompt(flowBase, goal, "# plan");
	assert.ok(!coldPrompt.includes("延续自计划会话"), "cold start has no note");
	const forkedPrompt = promptModule.planGoalPrompt(flowBase, goal, "# plan", {
		forkedFromPlanSession: true,
	});
	assert.ok(
		forkedPrompt.includes("延续自计划会话") &&
			forkedPrompt.includes("限制已解除"),
		"forked zh prompt lifts the generation-phase restriction",
	);
	const forkedEn = promptModule.planGoalPrompt(
		{ ...flowBase, language: "en" },
		goal,
		"# plan",
		{ forkedFromPlanSession: true },
	);
	assert.ok(
		forkedEn.includes("continues from the planning session") &&
			forkedEn.includes("no longer applies"),
		"forked en prompt lifts the generation-phase restriction",
	);

	// ---- planTrajectoryForkPoint: 串行 fork 资格 ----
	// 工作区指纹守卫需要真实 git 仓库 cwd。
	const gitCwd = join(out, "workspace");
	mkdirSync(gitCwd, { recursive: true });
	writeFileSync(join(gitCwd, "tracked.txt"), "original\n");
	const git = (...args) =>
		execFileSync("git", ["-C", gitCwd, ...args], { stdio: "pipe" });
	git("init", "-q");
	git("add", "-A");
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
	const planEntry = { type: "message", id: "leaf-1" };
	const makeCtx = (input = {}) => ({
		cwd: input.cwd ?? gitCwd,
		fork: () => {},
		getContextUsage: () => ({ percent: 10, tokens: 1000, contextWindow: 1 }),
		sessionManager: {
			getSessionFile: () => input.sessionFile ?? "/tmp/gen.jsonl",
			getBranch: () => input.branch ?? [planEntry],
			getLeafId: () => (input.leafId === undefined ? "leaf-1" : input.leafId),
		},
		...input.overrides,
	});
	const draftFlow = { id: "F1", startedAt: null };
	const dir = "/tmp/flow-F1";

	prewalkModule.resetPrewalkRuntime();
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		undefined,
		"no remembered generation session -> cold start",
	);

	prewalkModule.rememberGenerationSession(dir, makeCtx());
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		"leaf-1",
		"eligible generation session forks at the plan leaf",
	);
	writeConfig({ prewalk: { unknown: 1 } });
	assert.throws(
		() => prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		/prewalk/u,
		"invalid prewalk config must not silently disable trajectory inheritance",
	);
	writeConfig({ prewalk: { enabled: true } });
	// leaf 漂移：计划完成后出现新对话轮 → 冷启动；纯 custom 卡片不算漂移。
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(
			makeCtx({
				branch: [planEntry, { type: "message", id: "chat-after-plan" }],
				leafId: "chat-after-plan",
			}),
			dir,
			draftFlow,
		),
		undefined,
		"conversation after plan completion (leaf drift) -> cold start",
	);
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(
			makeCtx({
				branch: [planEntry, { type: "custom_message", id: "hidden-turn" }],
				leafId: "hidden-turn",
			}),
			dir,
			draftFlow,
		),
		undefined,
		"hidden prompt turn after plan completion -> cold start",
	);
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(
			makeCtx({
				branch: [planEntry, { type: "custom", id: "card", customType: "x" }],
				leafId: "card",
			}),
			dir,
			draftFlow,
		),
		"leaf-1",
		"plugin card entries after the plan leaf do not block forking",
	);
	// 编辑换支：计划完成点不在当前分支上 → 冷启动。
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(
			makeCtx({
				branch: [{ type: "message", id: "other-branch" }],
				leafId: "other-branch",
			}),
			dir,
			draftFlow,
		),
		undefined,
		"plan leaf missing from the current branch -> cold start",
	);
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, {
			...draftFlow,
			startedAt: 123,
		}),
		undefined,
		"started flow (stale trajectory) -> cold start",
	);
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(
			makeCtx({ sessionFile: "/tmp/other.jsonl" }),
			dir,
			draftFlow,
		),
		undefined,
		"different session -> cold start",
	);
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(
			makeCtx({
				branch: [
					{ type: "custom", id: "g", customType: "goal-state" },
					planEntry,
				],
			}),
			dir,
			draftFlow,
		),
		undefined,
		"runtime entries in prefix -> cold start",
	);
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(
			makeCtx({
				branch: [
					{ type: "custom", id: "r", customType: "review-checkpoint" },
					planEntry,
				],
			}),
			dir,
			draftFlow,
		),
		undefined,
		"review checkpoint in prefix -> cold start",
	);

	writeConfig({ prewalk: { enabled: false } });
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		undefined,
		"prewalk disabled -> cold start",
	);
	writeConfig({ prewalk: { enabled: true } });

	// 生成完成时上下文过大 -> 冷启动（保险丝）
	prewalkModule.rememberGenerationSession(
		dir,
		makeCtx({
			overrides: {
				getContextUsage: () => ({
					percent: 80,
					tokens: 1,
					contextWindow: 1,
				}),
			},
		}),
	);
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		undefined,
		"large planning context -> cold start",
	);
	// usage 未知（percent null）同样保守
	prewalkModule.rememberGenerationSession(
		dir,
		makeCtx({
			overrides: {
				getContextUsage: () => ({
					percent: null,
					tokens: null,
					contextWindow: 1,
				}),
			},
		}),
	);
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		undefined,
		"unknown context usage -> cold start",
	);

	// 释放语义：启动路径显式释放
	prewalkModule.rememberGenerationSession(dir, makeCtx());
	prewalkModule.releaseGenerationSession(dir);
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		undefined,
		"released memory -> cold start",
	);
	// 无 leaf（空会话）不记忆
	prewalkModule.rememberGenerationSession(
		dir,
		makeCtx({ leafId: null, branch: [] }),
	);
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		undefined,
		"empty session is never remembered",
	);
	// 工作区漂移：计划完成后代码被外部修改 → 串行冷启动；恢复后又可 fork。
	prewalkModule.rememberGenerationSession(dir, makeCtx());
	writeFileSync(join(gitCwd, "tracked.txt"), "externally edited\n");
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		undefined,
		"external code edit after plan completion -> serial cold start",
	);
	git("checkout", "-q", "--", ".");
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		"leaf-1",
		"restored workspace forks again",
	);
	// untracked 文件内容漂移：路径/状态不变、仅内容变 → 串行冷启动；恢复后又可 fork。
	writeFileSync(join(gitCwd, "untracked.ts"), "v1\n");
	prewalkModule.rememberGenerationSession(dir, makeCtx());
	writeFileSync(join(gitCwd, "untracked.ts"), "v2\n");
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		undefined,
		"untracked content edit after plan completion -> serial cold start",
	);
	writeFileSync(join(gitCwd, "untracked.ts"), "v1\n");
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		"leaf-1",
		"restored untracked content forks again",
	);
	// untracked 目录内的文件变化同样判漂移。
	mkdirSync(join(gitCwd, "untracked-dir"), { recursive: true });
	writeFileSync(join(gitCwd, "untracked-dir/inner.ts"), "a\n");
	prewalkModule.rememberGenerationSession(dir, makeCtx());
	writeFileSync(join(gitCwd, "untracked-dir/inner.ts"), "b\n");
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(makeCtx(), dir, draftFlow),
		undefined,
		"content edit inside an untracked directory -> serial cold start",
	);
	rmSync(join(gitCwd, "untracked-dir"), { recursive: true, force: true });
	rmSync(join(gitCwd, "untracked.ts"), { force: true });
	// 非 git 仓库：指纹不可得 → 保守冷启动。
	const plainDir = join(out, "plain");
	mkdirSync(plainDir, { recursive: true });
	prewalkModule.rememberGenerationSession(dir, makeCtx({ cwd: plainDir }));
	assert.equal(
		prewalkModule.planTrajectoryForkPoint(
			makeCtx({ cwd: plainDir }),
			dir,
			draftFlow,
		),
		undefined,
		"non-git workspace never forks",
	);

	// ---- prepareWorkerTrajectorySessions: 并行首批物理分支 ----
	const sessionDir = join(out, "sessions");
	mkdirSync(sessionDir, { recursive: true });
	const genFile = join(sessionDir, "generation.jsonl");
	const header = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: "gen-session",
		timestamp: new Date().toISOString(),
		cwd: out,
	};
	const userEntry = {
		type: "message",
		id: "u1",
		parentId: null,
		timestamp: new Date().toISOString(),
		message: { role: "user", content: [{ type: "text", text: "explore" }] },
	};
	const assistantEntry = {
		type: "message",
		id: "a1",
		parentId: "u1",
		timestamp: new Date().toISOString(),
		message: {
			role: "assistant",
			content: [{ type: "text", text: "plan written" }],
		},
	};
	writeFileSync(
		genFile,
		`${[header, userEntry, assistantEntry]
			.map((item) => JSON.stringify(item))
			.join("\n")}\n`,
	);
	// 独立验证宿主能打开该文件（测试夹具有效性）
	assert.equal(SessionManager.open(genFile).getLeafId(), "a1");

	const genCtx = makeCtx({ sessionFile: genFile, leafId: "a1" });
	prewalkModule.resetPrewalkRuntime();
	prewalkModule.rememberGenerationSession(dir, genCtx);
	const sessions = prewalkModule.prepareWorkerTrajectorySessions(
		gitCwd,
		dir,
		draftFlow,
		[1, 2],
	);
	assert.equal(sessions.size, 2, "one branched session per lane");
	const seen = new Set();
	for (const [index, path] of sessions) {
		assert.ok([1, 2].includes(index));
		assert.ok(existsSync(path), `branched session exists for G${index + 1}`);
		assert.ok(!seen.has(path), "each lane gets an independent file");
		seen.add(path);
		assert.notEqual(path, genFile, "original session is not reused");
		const lines = readFileSync(path, "utf8").trim().split("\n");
		const branchedHeader = JSON.parse(lines[0]);
		assert.equal(branchedHeader.parentSession, genFile);
		const texts = lines.slice(1).map((line) => JSON.parse(line));
		assert.ok(
			texts.some(
				(entry) =>
					entry.type === "message" && entry.message?.role === "assistant",
			),
			"prefix entries are physically copied",
		);
		assert.ok(
			prewalkModule.isForkedWorkerSession(path),
			"branched worker session is identified from persisted lineage",
		);
		prewalkModule.resetPrewalkRuntime();
		assert.ok(
			prewalkModule.isForkedWorkerSession(path),
			"persisted lineage survives parent runtime reset",
		);
		// 宿主兼容：worker 进程用 SessionManager.open 打开分支文件，leaf 必须是计划完成点。
		assert.equal(
			SessionManager.open(path).getLeafId(),
			"a1",
			"host SessionManager must open the branched file at the plan leaf",
		);
	}
	assert.equal(
		readFileSync(genFile, "utf8").includes("plan written"),
		true,
		"original generation session file is untouched",
	);

	// 第二个 lane 写盘失败：必须清理本批已创建分支并把真实 IO 错误交给调用方。
	prewalkModule.rememberGenerationSession(dir, genCtx);
	const filesBeforeFailure = readdirSync(sessionDir).sort();
	const originalWriteFileSync = fs.writeFileSync;
	let branchWrites = 0;
	let branchError;
	fs.writeFileSync = (path, ...args) => {
		if (dirname(String(path)) === sessionDir && path !== genFile) {
			branchWrites += 1;
			if (branchWrites === 2) {
				const error = new Error("simulated prewalk branch write failure");
				error.code = "ENOSPC";
				throw error;
			}
		}
		return originalWriteFileSync(path, ...args);
	};
	syncBuiltinESMExports();
	try {
		prewalkModule.prepareWorkerTrajectorySessions(
			gitCwd,
			dir,
			draftFlow,
			[1, 2],
		);
	} catch (error) {
		branchError = error;
	} finally {
		fs.writeFileSync = originalWriteFileSync;
		syncBuiltinESMExports();
	}
	assert.equal(
		branchWrites,
		2,
		"prewalk write failure fixture did not trigger",
	);
	assert.equal(
		branchError?.code,
		"ENOSPC",
		"prewalk branch IO failure was silently downgraded",
	);
	assert.deepEqual(
		readdirSync(sessionDir).sort(),
		filesBeforeFailure,
		"partial prewalk branch files were not removed",
	);

	const coldSession = join(sessionDir, "cold.jsonl");
	assert.equal(
		prewalkModule.isForkedWorkerSession(coldSession),
		false,
		"missing cold session has no fork lineage",
	);
	writeFileSync(coldSession, "{broken\n");
	assert.throws(
		() => prewalkModule.isForkedWorkerSession(coldSession),
		SyntaxError,
		"malformed session lineage must not silently degrade to cold",
	);
	rmSync(coldSession, { force: true });
	const headerOnlySession = join(sessionDir, "header-only.jsonl");
	writeFileSync(
		headerOnlySession,
		`${JSON.stringify({ ...header, parentSession: genFile })}\n{broken-entry\n`,
	);
	assert.equal(
		prewalkModule.isForkedWorkerSession(headerOnlySession),
		true,
		"lineage lookup reads only the persisted session header",
	);
	rmSync(headerOnlySession, { force: true });
	// reset 已清除生成会话记忆；重新记忆后验证显式 release 生命周期。
	prewalkModule.rememberGenerationSession(dir, genCtx);
	assert.equal(
		prewalkModule.prepareWorkerTrajectorySessions(gitCwd, dir, draftFlow, [1])
			.size,
		1,
		"memory stays until the start path releases it",
	);
	prewalkModule.releaseGenerationSession(dir);
	assert.equal(
		prewalkModule.prepareWorkerTrajectorySessions(gitCwd, dir, draftFlow, [1])
			.size,
		0,
		"released memory -> no worker branching",
	);
	// 已启动 Flow 不分支
	prewalkModule.rememberGenerationSession(dir, genCtx);
	assert.equal(
		prewalkModule.prepareWorkerTrajectorySessions(
			gitCwd,
			dir,
			{ ...draftFlow, startedAt: 5 },
			[1],
		).size,
		0,
		"started flow -> no worker branching",
	);
	// 工作区漂移：untracked 内容变化后并行分支同样冷启动。
	writeFileSync(join(gitCwd, "untracked.ts"), "v1\n");
	prewalkModule.rememberGenerationSession(dir, genCtx);
	writeFileSync(join(gitCwd, "untracked.ts"), "v2\n");
	assert.equal(
		prewalkModule.prepareWorkerTrajectorySessions(gitCwd, dir, draftFlow, [1])
			.size,
		0,
		"untracked content edit after plan completion -> parallel cold start",
	);
	rmSync(join(gitCwd, "untracked.ts"), { force: true });
	// 工作区漂移：外部改码后并行分支同样冷启动；恢复后又可分支。
	prewalkModule.rememberGenerationSession(dir, genCtx);
	writeFileSync(join(gitCwd, "tracked.txt"), "externally edited again\n");
	assert.equal(
		prewalkModule.prepareWorkerTrajectorySessions(gitCwd, dir, draftFlow, [1])
			.size,
		0,
		"external code edit after plan completion -> parallel cold start",
	);
	git("checkout", "-q", "--", ".");
	assert.equal(
		prewalkModule.prepareWorkerTrajectorySessions(gitCwd, dir, draftFlow, [1])
			.size,
		1,
		"restored workspace branches again",
	);
	// leaf 漂移：生成文件在计划完成点之后又出现对话轮 → 整批冷启动。
	const driftEntry = {
		type: "message",
		id: "m2",
		parentId: "a1",
		timestamp: new Date().toISOString(),
		message: { role: "user", content: [{ type: "text", text: "later chat" }] },
	};
	writeFileSync(genFile, `${JSON.stringify(driftEntry)}\n`, { flag: "a" });
	assert.equal(
		prewalkModule.prepareWorkerTrajectorySessions(gitCwd, dir, draftFlow, [1])
			.size,
		0,
		"conversation after plan completion -> no worker branching",
	);

	// ---- 评测账单边界：fork 分支含计划前缀，统计必须从计划完成点之后开始 ----
	const { sessionStats } = await import(
		pathToFileURL(join(root, "scripts/evaluate-prewalk.mjs")).href
	);
	const usage = (cost, input) => ({
		input,
		output: 10,
		cacheRead: 0,
		cacheWrite: 0,
		cost: { total: cost },
	});
	const statsJsonl = [
		{ type: "session", id: "h" },
		{
			type: "message",
			id: "plan-turn",
			message: {
				role: "assistant",
				usage: usage(5, 100),
				content: [{ type: "toolCall", name: "read" }],
			},
		},
		{
			type: "message",
			id: "plan-leaf",
			message: { role: "assistant", usage: usage(2, 50), content: [] },
		},
		{
			type: "message",
			id: "exec-turn",
			message: {
				role: "assistant",
				usage: usage(1, 20),
				content: [{ type: "toolCall", name: "edit" }],
			},
		},
	]
		.map((entry) => JSON.stringify(entry))
		.join("\n");
	const fullStats = sessionStats(statsJsonl);
	assert.equal(fullStats.cost, 8, "full accounting sums every turn");
	assert.equal(fullStats.turns, 3);
	const executionStats = sessionStats(statsJsonl, "plan-leaf");
	assert.deepEqual(
		{
			cost: executionStats.cost,
			turns: executionStats.turns,
			input: executionStats.input,
			readCalls: executionStats.readCalls,
			editCalls: executionStats.editCalls,
		},
		{ cost: 1, turns: 1, input: 20, readCalls: 0, editCalls: 1 },
		"boundary accounting must exclude the shared plan prefix (incl. the leaf itself)",
	);
	assert.equal(
		sessionStats(statsJsonl, "missing-anchor").turns,
		0,
		"unknown boundary counts nothing (never silently over-bills)",
	);

	// ---- 评测退出语义：任一 arm 验证失败必须判定为失败（禁止假成功） ----
	const { evaluationFailed } = await import(
		pathToFileURL(join(root, "scripts/evaluate-prewalk.mjs")).href
	);
	const passingPair = {
		cold: { verified: { ok: true } },
		fork: { verified: { ok: true } },
	};
	assert.equal(evaluationFailed([passingPair]), false, "all-pass is success");
	assert.equal(
		evaluationFailed([]),
		true,
		"empty results must fail (no silent empty run)",
	);
	for (const arm of ["cold", "fork"]) {
		assert.equal(
			evaluationFailed([
				passingPair,
				{ ...passingPair, [arm]: { verified: { ok: false, reason: "x" } } },
			]),
			true,
			`${arm} verification failure must fail the evaluation`,
		);
		assert.equal(
			evaluationFailed([{ ...passingPair, [arm]: {} }]),
			true,
			`missing ${arm} verification must fail the evaluation`,
		);
	}

	console.log("prewalk smoke passed");
} finally {
	rmSync(out, { recursive: true, force: true });
}
