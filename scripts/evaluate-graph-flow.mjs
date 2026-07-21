// 四臂真实 Flow 图调度评测：每个 benchmark 只规划一次，四臂共享计划轨迹、仓库快照、
// worker 预算、模型与依赖 packet 规则；唯一变量是调度方式。
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import {
	activeCoordinatorGoals,
	applyCoordinatorEvent,
	artifactExitCode,
	benchmarkFingerprint,
	buildDependencyPacket,
	classifyFailure,
	classifyMissingWorkerExit,
	coordinatorAttemptId,
	coordinatorResourceCount,
	createCoordinatorState,
	decideEvaluation,
	deriveCheckFlags,
	evaluationGraph,
	evaluationSummaryPath,
	executorFingerprint,
	expectedArmOrder,
	formatEvaluationSummary,
	GRAPH_ARMS,
	GRAPH_ARTIFACT_VERSION,
	isRetryableFailure,
	modelFingerprint,
	normalizeBenchmarkIds,
	packetRuleFingerprint,
	planFingerprint,
	schedulerFingerprint,
	scorerFingerprint,
	sha256,
	stableJson,
	startCoordinatorAttempt,
	usageMetricsFromAttempts,
	validateArtifact,
	validateBenchmark,
	validatePlannedGraph,
	withInfrastructureRetries,
} from "./graph-flow-evaluation.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = dirname(dirname(scriptPath));
const fixtureRoot = join(root, "tests/fixtures/graph-flow");
const evaluationContractPath = join(fixtureRoot, "evaluation-contract.json");
const agentDist = join(root, "node_modules/@earendil-works/pi-coding-agent");
const RUN_TIMEOUT_MS = 45 * 60_000;
const DEFAULT_BUDGET = 2;

export function parseCliArgs(argv) {
	const verifyArtifact = option(argv, "--verify-artifact");
	const output = option(argv, "--output");
	const runsPerArm = numberOption(argv, "--runs", 1);
	const workerBudget = numberOption(argv, "--worker-budget", DEFAULT_BUDGET);
	const fixtures = option(argv, "--fixtures")?.split(",").filter(Boolean);
	const dryRun = argv.includes("--dry-run");
	for (const value of [runsPerArm, workerBudget])
		if (!Number.isSafeInteger(value) || value <= 0)
			throw new Error("--runs and --worker-budget must be positive integers");
	if (runsPerArm > 3) throw new Error("--runs must not exceed 3");
	if (
		verifyArtifact &&
		["--dry-run", "--fixtures", "--output", "--runs", "--worker-budget"].some(
			(name) => argv.includes(name),
		)
	)
		throw new Error(
			"--verify-artifact cannot be combined with evaluation options",
		);
	if (unknownArgs(argv).length)
		throw new Error(`unknown argument(s): ${unknownArgs(argv).join(", ")}`);
	return {
		dryRun,
		fixtures,
		output,
		runsPerArm,
		verifyArtifact,
		workerBudget,
	};
}

async function main(argv) {
	const args = parseCliArgs(argv);
	if (args.verifyArtifact) return verifyArtifactFile(args.verifyArtifact);
	const setup = evaluationSetup();
	const manifests = loadBenchmarks(setup.contract.benchmarks, args.fixtures);
	const fingerprints = evaluationFingerprints(
		manifests,
		setup.config,
		setup.contract,
	);
	if (args.dryRun) {
		console.log(
			JSON.stringify(
				{
					benchmarks: manifests.map(({ manifest }) => manifest.id),
					...fingerprints,
					runs: manifests.length * GRAPH_ARMS.length * args.runsPerArm,
				},
				null,
				2,
			),
		);
		return;
	}
	const extensionDir = prepareExtension(setup.config);
	const work = mkdtempSync(join(tmpdir(), "graph-flow-eval-"));
	const lifecycle = createEvalLifecycle([work, extensionDir]);
	const progress = createProgressLogger();
	let artifact;
	try {
		// 必须从 extensionDir/dist 加载：spawner/config 的 EXTENSION_DIR 据此解析评测合同。
		const runtime = await loadRuntime(extensionDir);
		const hostCommand = setup.config.background.command;
		if (typeof hostCommand !== "string" || !hostCommand.trim())
			throw new Error("evaluation contract background.command is required");
		progress.startHeartbeat();
		const benchmarks = [];
		for (const [benchmarkIndex, benchmark] of manifests.entries()) {
			throwIfCancelled(lifecycle.signal);
			console.log(`\n=== ${benchmark.manifest.id}: planning ===`);
			progress.set({
				replace: true,
				benchmark: benchmark.manifest.id,
				phase: "planning",
				startedAt: Date.now(),
			});
			benchmarks.push(
				await evaluateBenchmark({
					...benchmark,
					benchmarkIndex,
					extensionDir,
					hostCommand,
					lifecycle,
					progress,
					runsPerArm: args.runsPerArm,
					runtime,
					work,
					workerBudget: args.workerBudget,
				}),
			);
		}
		throwIfCancelled(lifecycle.signal);
		const decision = decideEvaluation(benchmarks);
		artifact = {
			schemaVersion: GRAPH_ARTIFACT_VERSION,
			benchmarkIds: manifests.map(({ manifest }) => manifest.id),
			...fingerprints,
			runsPerArm: args.runsPerArm,
			workerBudget: args.workerBudget,
			decision: decision.decision,
			directions: Object.fromEntries(
				benchmarks.map((benchmark, index) => [
					benchmark.id,
					decision.directions[index],
				]),
			),
			benchmarks,
		};
		const errors = validateArtifact(artifact, {
			expectedBenchmarkIds: manifests.map(({ manifest }) => manifest.id),
		});
		if (args.output) writeArtifact(args.output, artifact);
		printSummary(artifact);
		if (errors.length)
			throw new Error(`generated artifact is invalid: ${errors.join("; ")}`);
		process.exitCode = artifactExitCode(artifact);
	} catch (error) {
		if (classifyFailure(error) === "cancelled") {
			process.exitCode = lifecycle.exitCode ?? 143;
		} else {
			throw error;
		}
	} finally {
		progress.stop();
		await lifecycle.shutdown();
	}
	if (lifecycle.exitCode !== undefined) process.exitCode = lifecycle.exitCode;
	return artifact;
}

/**
 * 统一生命周期：信号 abort 后立刻 stop 已登记 handle；shutdown 等待同一收口再删目录。
 * 禁止在 handler 里 rmSync/process.exit。
 */
export function createEvalLifecycle(dirs) {
	const owned = dirs.filter(Boolean);
	const controller = new AbortController();
	const active = new Set();
	let exitCode;
	let shuttingDown = false;
	let stopPromise;
	const stopAll = () => {
		if (!stopPromise) {
			const handles = [...active];
			stopPromise = Promise.all(
				handles.map((handle) =>
					Promise.resolve()
						.then(() => handle.stop())
						.catch(() => undefined),
				),
			).then(() => undefined);
		}
		return stopPromise;
	};
	const abort = (code) => {
		if (exitCode === undefined) exitCode = code;
		if (!controller.signal.aborted) controller.abort();
		// 不等 main finally：立刻停 Planner/worker，解开 promptAndWait 等挂起。
		void stopAll();
	};
	const onSignal = (signal) => {
		abort(signal === "SIGINT" ? 130 : 143);
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);
	return {
		get signal() {
			return controller.signal;
		},
		get exitCode() {
			return exitCode;
		},
		abort,
		register(handle) {
			if (!handle || typeof handle.stop !== "function")
				throw new Error("lifecycle handle requires stop()");
			active.add(handle);
			if (controller.signal.aborted) void handle.stop().catch(() => undefined);
			return () => active.delete(handle);
		},
		async shutdown() {
			if (shuttingDown) return stopPromise;
			shuttingDown = true;
			process.off("SIGINT", onSignal);
			process.off("SIGTERM", onSignal);
			if (!controller.signal.aborted) controller.abort();
			await stopAll();
			active.clear();
			for (const dir of owned) rmSync(dir, { recursive: true, force: true });
		},
		/** 测试用：等同 OS 信号 abort，立即 kick stop */
		_testAbort(code = 143) {
			abort(code);
			return stopAll();
		},
	};
}

// 仅粗粒度阶段；排除 message/turn/update 流式风暴，避免污染 elapsed 观测。
const PROGRESS_EVENT_TYPES = new Set([
	"tool_start",
	"tool_execution_start",
	"check_start",
]);

/** 节流进度：仅阶段键变化时输出 + 低频心跳；过滤流式 update/delta。 */
export function createProgressLogger({
	write = console.log,
	now = Date.now,
	heartbeatMs = 30_000,
} = {}) {
	let state = { phase: "idle", at: now() };
	let lastPhaseKey = "";
	let timer;
	const phaseKey = (snapshot) =>
		[
			snapshot.benchmark ?? "",
			snapshot.arm ?? "",
			snapshot.goal ?? "",
			snapshot.phase ?? "",
			snapshot.detail ?? "",
		].join("|");
	const format = (snapshot) => {
		const parts = ["[progress]"];
		if (snapshot.benchmark) parts.push(snapshot.benchmark);
		if (snapshot.arm) parts.push(snapshot.arm);
		if (snapshot.goal !== undefined) parts.push(`G${snapshot.goal + 1}`);
		parts.push(snapshot.phase || "idle");
		if (snapshot.detail) parts.push(snapshot.detail);
		const elapsed = Math.round(
			(now() - (snapshot.startedAt || snapshot.at)) / 1000,
		);
		parts.push(`${elapsed}s`);
		return parts.join(" ");
	};
	const emit = (line) => {
		write(line);
	};
	return {
		set(update) {
			// replace: 新 benchmark/arm 清空旧 arm/goal/detail，并重置 startedAt。
			const base = update.replace
				? {
						benchmark: update.benchmark,
						arm: update.arm,
						goal: update.goal,
						phase: update.phase,
						detail: update.detail,
					}
				: { ...state, ...update };
			const next = {
				...base,
				at: now(),
				startedAt:
					update.startedAt ??
					(update.replace ? now() : state.startedAt) ??
					now(),
			};
			// 显式 undefined 表示清空（merge 路径）
			for (const key of ["arm", "goal", "detail"])
				if (update.replace && !(key in update)) delete next[key];
			const key = phaseKey(next);
			const changed = key !== lastPhaseKey;
			state = next;
			if (!changed) return;
			lastPhaseKey = key;
			emit(format(state));
		},
		noteWorkerEvent(goalIndex, event) {
			const type = String(event?.type ?? "");
			if (!type || type.includes("_update") || type.includes("_delta")) return;
			if (!PROGRESS_EVENT_TYPES.has(type)) return;
			const detail =
				type === "tool_execution_start" || type === "tool_start"
					? `tool:${String(event.name || event.toolName || "tool")}`
					: type === "message_start" || type === "turn_start"
						? "model"
						: type === "check_start" || type.includes("accept")
							? "check"
							: type;
			if (!/^[a-z0-9_.:-]+$/i.test(detail)) return;
			this.set({
				goal: goalIndex,
				phase: "worker",
				detail: detail.slice(0, 40),
			});
		},
		startHeartbeat() {
			if (timer) return;
			timer = setInterval(() => {
				const idle = Math.round((now() - state.at) / 1000);
				emit(`${format(state)} idle=${idle}s`);
			}, heartbeatMs);
			timer.unref?.();
		},
		stop() {
			if (timer) clearInterval(timer);
			timer = undefined;
		},
	};
}

export function throwIfCancelled(signal) {
	if (!signal?.aborted) return;
	throw cancellationError();
}

export function cancellationError() {
	const error = new Error("evaluation cancelled");
	error.code = "cancelled";
	return error;
}

/** 让不接受 AbortSignal 的 Promise 与 lifecycle 取消竞争。 */
export function raceAbort(signal, promise) {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(cancellationError());
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(cancellationError());
		};
		signal.addEventListener("abort", onAbort, { once: true });
		Promise.resolve(promise).then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

export function verifyArtifactFile(path) {
	const artifact = JSON.parse(readFileSync(resolve(root, path), "utf8"));
	const setup = evaluationSetup();
	const contractIds = normalizeBenchmarkIds(setup.contract.benchmarks);
	const errors = validateArtifact(artifact, {
		expectedBenchmarkIds: contractIds,
	});
	try {
		// 合同 ID 集是唯一可信根；禁止用 artifact 自带 ID 列表去加载 fixture。
		const currentBenchmarks = loadBenchmarks(contractIds);
		const expected = evaluationFingerprints(
			currentBenchmarks,
			setup.config,
			setup.contract,
		);
		for (const [field, value] of Object.entries(expected))
			if (artifact[field] !== value) errors.push(`${field} drifted`);
		const currentById = new Map(
			currentBenchmarks.map((benchmark) => [benchmark.manifest.id, benchmark]),
		);
		for (const [index, benchmark] of (artifact.benchmarks ?? []).entries()) {
			if (benchmark?.id !== contractIds[index])
				errors.push(
					`benchmark order mismatch at ${index}: expected ${contractIds[index]} got ${benchmark?.id}`,
				);
			const current = currentById.get(benchmark?.id);
			if (benchmark.fingerprint !== current?.fingerprint)
				errors.push(`${benchmark.id} benchmark contract drifted`);
			if (
				stableJson(benchmark.graph) !==
				stableJson(evaluationGraph(current?.manifest ?? { expectedGraph: [] }))
			)
				errors.push(`${benchmark.id} graph contract drifted`);
		}
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
	}
	const summaryPath = evaluationSummaryPath(resolve(root, path));
	if (existsSync(summaryPath)) {
		const expectedSummary = formatEvaluationSummary(artifact);
		const actualSummary = readFileSync(summaryPath, "utf8");
		if (actualSummary !== expectedSummary)
			errors.push(`summary drifted: ${summaryPath}`);
	}
	if (errors.length) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
		return false;
	}
	console.log(`graph artifact verified: ${artifact.decision}`);
	console.log(formatEvaluationSummary(artifact).trimEnd());
	return true;
}

function loadBenchmarks(contractIds, onlyIds) {
	const canonical = normalizeBenchmarkIds(contractIds);
	let ids = canonical;
	if (onlyIds !== undefined) {
		const selected = normalizeBenchmarkIds(onlyIds);
		// 子集必须保持合同相对顺序，禁止调用方重排。
		ids = canonical.filter((id) => selected.includes(id));
		if (ids.length !== selected.length)
			throw new Error(
				"fixture selection must be a subset of contract benchmarks",
			);
		if (
			stableJson(ids) !== stableJson(selected.filter((id) => ids.includes(id)))
		)
			throw new Error(
				"fixture selection must preserve contract benchmark order",
			);
	}
	if (ids.length === 0) throw new Error("no graph-flow benchmarks selected");
	return ids.map((id) => {
		const dir = join(fixtureRoot, id);
		if (!existsSync(join(dir, "manifest.json")))
			throw new Error(`unknown graph-flow benchmark: ${id}`);
		const manifest = JSON.parse(
			readFileSync(join(dir, "manifest.json"), "utf8"),
		);
		if (manifest.id && manifest.id !== id)
			throw new Error(`${id}: manifest.id must equal directory name`);
		const errors = validateBenchmark(manifest, dir);
		if (errors.length) throw new Error(`${id}: ${errors.join("; ")}`);
		return {
			dir,
			fingerprint: sha256(stableJson(manifest)),
			manifest: { ...manifest, id },
		};
	});
}

function evaluationSetup() {
	const contract = JSON.parse(readFileSync(evaluationContractPath, "utf8"));
	if (
		contract?.version !== 1 ||
		!contract.config?.modelRoles?.advisor ||
		!contract.config.modelRoles.executor ||
		!Array.isArray(contract.config.modelRoles.reviewers)
	)
		throw new Error("graph evaluation contract is invalid");
	try {
		contract.benchmarks = normalizeBenchmarkIds(contract.benchmarks);
	} catch (error) {
		throw new Error(
			`graph evaluation contract benchmarks invalid: ${error instanceof Error ? error.message : error}`,
		);
	}
	const template = JSON.parse(
		readFileSync(join(root, "config.template.json"), "utf8"),
	);
	return {
		contract,
		config: { ...template, ...contract.config },
	};
}

function evaluationFingerprints(benchmarks, config, contract) {
	const models = {
		advisor: config.modelRoles.advisor,
		executor: config.modelRoles.executor,
		reviewers: config.modelRoles.reviewers.map(({ model, thinking }) => ({
			model,
			thinking,
		})),
	};
	return {
		benchmarkFingerprint: benchmarkFingerprint(
			benchmarks.map(({ manifest }) => manifest),
		),
		evaluationConfigFingerprint: sha256(stableJson(contract)),
		modelFingerprint: modelFingerprint(models),
		packetRuleFingerprint: packetRuleFingerprint(),
		scorerFingerprint: scorerFingerprint(),
		executorFingerprint: executorFingerprint(),
		schedulerFingerprint: schedulerFingerprint(),
	};
}

function prepareExtension(config) {
	const dir = mkdtempSync(join(tmpdir(), "graph-flow-ext-"));
	try {
		// 只拷评测子进程需要的构建产物；宿主 runtime 直接读仓库根 dist。
		for (const entry of ["dist", "prompts"]) {
			const source = join(root, entry);
			if (!existsSync(source))
				throw new Error(`missing ${entry}/; run npm run build first`);
			cpSync(source, join(dir, entry), { recursive: true });
		}
		if (!existsSync(join(dir, "dist/flow/scheduler.js")))
			throw new Error("extension dist is incomplete after copy");
		symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
		writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
		writeFileSync(
			join(dir, "config.json"),
			`${JSON.stringify(config, null, 2)}\n`,
		);
		writeFileSync(
			join(dir, "planner.mjs"),
			[
				'import flowExtension from "./dist/flow.js";',
				'import { startGeneration } from "./dist/flow/generation.js";',
				"export default function graphPlanner(pi) {",
				"\tflowExtension(pi);",
				'\tpi.registerCommand("eval-graph-plan", {',
				'\t\tdescription: "private graph evaluation planner",',
				'\t\thandler: (args, ctx) => startGeneration(pi, ctx, args, "prompt", undefined, { mode: "direct", autoStart: false }),',
				"\t});",
				"}",
			].join("\n"),
		);
		return dir;
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
}

async function loadRuntime(extensionDir) {
	const importFromDist = (path) =>
		import(pathToFileURL(join(extensionDir, "dist", path)).href);
	const [
		scheduler,
		spawner,
		workerCommand,
		workerArtifact,
		resultWatcher,
		store,
		validator,
		planMarkdown,
	] = await Promise.all([
		importFromDist("flow/scheduler.js"),
		importFromDist("flow/parallel/spawner.js"),
		importFromDist("flow/execution/worker-command.js"),
		importFromDist("flow/parallel/worker-artifact.js"),
		importFromDist("flow/parallel/result-watcher.js"),
		importFromDist("flow/store.js"),
		importFromDist("flow/validator.js"),
		importFromDist("plan/markdown.js"),
	]);
	const { RpcClient } = await import(
		pathToFileURL(join(agentDist, "dist/modes/rpc/rpc-client.js")).href
	);
	const { SessionManager } = await import("@earendil-works/pi-coding-agent");
	const { sessionStats } = await import(
		pathToFileURL(join(root, "scripts/evaluate-prewalk.mjs")).href
	);
	return {
		...scheduler,
		...spawner,
		...workerCommand,
		...workerArtifact,
		...resultWatcher,
		...store,
		...validator,
		...planMarkdown,
		RpcClient,
		SessionManager,
		sessionStats,
	};
}

async function evaluateBenchmark(options) {
	let planned;
	try {
		throwIfCancelled(options.lifecycle?.signal);
		const retried = await withInfrastructureRetries((attempt) =>
			planBenchmark(options, attempt),
		);
		planned = { ...retried.value, attempts: retried.attempts };
	} catch (error) {
		if (classifyFailure(error) === "cancelled") throw error;
		console.error(
			`[${options.manifest.id}] planning failed:`,
			error instanceof Error ? error.message : error,
		);
		return planningFailureBenchmark(options, error);
	}
	const runs = [];
	const armOrder = expectedArmOrder(options.benchmarkIndex, options.runsPerArm);
	for (let repetition = 0; repetition < options.runsPerArm; repetition += 1) {
		const repetitionOrder = armOrder[repetition];
		for (const arm of repetitionOrder) {
			throwIfCancelled(options.lifecycle?.signal);
			console.log(
				`[${options.manifest.id}] ${arm} ${repetition + 1}/${options.runsPerArm}`,
			);
			options.progress?.set({
				replace: true,
				benchmark: options.manifest.id,
				arm,
				phase: "running",
				startedAt: Date.now(),
			});
			try {
				const retried = await withInfrastructureRetries((attempt) =>
					runArmAttempt({ ...options, ...planned, arm, attempt, repetition }),
				);
				runs.push(runWithAttemptSummary(retried.value, retried.attempts));
			} catch (error) {
				if (classifyFailure(error) === "cancelled") throw error;
				runs.push(failedArmRun(arm, repetition, error));
			}
		}
	}
	return {
		id: options.manifest.id,
		fingerprint: options.fingerprint,
		graph: evaluationGraph(options.manifest),
		planFingerprint: planned.planFingerprint,
		planning: {
			attempts: planned.attempts,
			elapsedMs: planned.elapsedMs,
			...usageMetricsFromAttempts(planned.attempts),
			status: "valid",
		},
		armOrder,
		runs,
	};
}

async function planBenchmark(options, attempt) {
	const planRoot = join(options.work, `${options.manifest.id}-plan-${attempt}`);
	rmSync(planRoot, { recursive: true, force: true });
	const fixture = join(planRoot, "repo");
	const sessions = join(planRoot, "sessions");
	cpSync(join(options.dir, "repo"), fixture, { recursive: true });
	mkdirSync(sessions, { recursive: true });
	initRepository(fixture);
	const plannerSession = join(sessions, "planner.jsonl");
	try {
		const client = new options.runtime.RpcClient({
			// 宿主 pi（与 worker 相同），不要用包内 cli.js：后者缺 xai oauth。
			cliPath: join(root, "scripts/eval-host-pi-cli.mjs"),
			cwd: fixture,
			env: { PI_FLOW_EVAL_HOST_COMMAND: options.hostCommand },
			args: [
				"--no-extensions",
				"--no-skills",
				"--no-context-files",
				"--session",
				plannerSession,
				"-e",
				join(options.extensionDir, "planner.mjs"),
			],
		});
		const startedAt = Date.now();
		const flowDir = join(fixture, ".flow/F1");
		let validation;
		const unregister = options.lifecycle?.register({
			stop: async () => {
				try {
					await client.stop();
				} catch {
					/* ignore */
				}
			},
		});
		try {
			throwIfCancelled(options.lifecycle?.signal);
			await client.start();
			options.progress?.set({
				benchmark: options.manifest.id,
				phase: "planning",
				detail: "prompt",
			});
			await raceAbort(
				options.lifecycle?.signal,
				client.promptAndWait(
					`/eval-graph-plan ${options.manifest.task}`,
					undefined,
					RUN_TIMEOUT_MS,
				),
			);
			// generation 可能在 agent_settled 之后还有 session transition；等到 draft/终态。
			validation = await waitForPlannerSettlement(
				client,
				flowDir,
				options.runtime.validateFlowDir,
				RUN_TIMEOUT_MS - (Date.now() - startedAt),
				options.lifecycle?.signal,
				options.progress,
			);
		} finally {
			unregister?.();
			try {
				await client.stop();
			} catch {
				/* ignore */
			}
		}
		throwIfCancelled(options.lifecycle?.signal);
		if (!validation?.ok || !validation.flow)
			throw new Error(
				`planner produced invalid Flow: ${(validation?.errors ?? ["missing flow.json"]).join("; ")}`,
			);
		const graphErrors = validatePlannedGraph(validation.flow, options.manifest);
		if (graphErrors.length)
			throw new Error(
				`planner graph invalid: ${graphErrors.join("; ")} (status=${validation.flow.status}, goals=${validation.flow.goals?.length ?? 0})`,
			);
		const unexpected = changedFiles(fixture).filter(
			(path) => !path.startsWith(".flow/"),
		);
		if (unexpected.length) {
			const error = new Error("planning phase modified the fixture");
			error.code = "planning_scope";
			throw error;
		}
		const plannerSessionManager =
			options.runtime.SessionManager.open(plannerSession);
		const planLeaf = plannerSessionManager.getLeafId();
		if (!planLeaf)
			throw protocolError("planner session has no completion leaf");
		return {
			elapsedMs: Date.now() - startedAt,
			fixture,
			flow: validation.flow,
			flowDir,
			planFingerprint: planFingerprint(flowDir, validation.flow),
			planLeaf,
			plannerSession,
			stats: options.runtime.sessionStats(readFileSync(plannerSession, "utf8")),
		};
	} catch (error) {
		throw attachSessionAttemptMetrics(
			error,
			[plannerSession],
			options.runtime.sessionStats,
		);
	}
}

export async function runArmAttempt(options) {
	const armRoot = join(
		options.work,
		`${options.manifest.id}-${options.arm}-${options.repetition}-${options.attempt}`,
	);
	rmSync(armRoot, { recursive: true, force: true });
	const fixture = join(armRoot, "repo");
	const sessions = join(armRoot, "sessions");
	cpSync(join(options.dir, "repo"), fixture, { recursive: true });
	mkdirSync(sessions, { recursive: true });
	initRepository(fixture);
	const flowDir = join(fixture, ".flow/F1");
	mkdirSync(flowDir, { recursive: true });
	for (const goal of options.flow.goals)
		cpSync(join(options.flowDir, goal.file), join(flowDir, goal.file));
	let flow = resetFlow(options.flow);
	let rootSessions = new Map();
	try {
		options.runtime.writeFlow(flowDir, flow);
		const runId = `E${options.repetition + 1}-${options.attempt}-${randomUUID()}`;
		const roots = flow.goals.filter((goal) => dependencies(goal).length === 0);
		rootSessions = new Map(
			roots.map((goal) => [
				goal.index,
				branchPlannerSession(
					options.runtime,
					options.plannerSession,
					options.planLeaf,
					fixture,
				),
			]),
		);
		if ([...rootSessions.values()].some((path) => !forkedSession(path)))
			throw protocolError("first frontier did not inherit the Planner session");
		const result = await runCoordinatedArm({
			...options,
			fixture,
			flow,
			flowDir,
			rootSessions,
			runId,
			sessions,
			signal: options.lifecycle?.signal,
		});
		flow = result.flow;
		const oracle = await runOracle(fixture, options.manifest);
		const stats = collectWorkerStats(
			flow,
			options.runtime,
			options.planLeaf,
			rootSessions,
		);
		const metrics = collectMetrics(flow, result, stats, roots.length);
		return {
			arm: options.arm,
			repetition: options.repetition + 1,
			terminalOutcome:
				oracle.ok && result.terminalOutcome === "complete"
					? "complete"
					: result.terminalOutcome === "complete"
						? "oracle_failed"
						: result.terminalOutcome,
			oracle: { executed: true, ok: oracle.ok },
			repositoryClean: oracle.scopeOk,
			schedule: result.schedule,
			packetFingerprints: result.packetFingerprints,
			metrics,
		};
	} catch (error) {
		throw attachAttemptMetrics(
			error,
			workerAttemptMetrics(flow, { ...options, rootSessions }),
		);
	}
}

export async function runCoordinatedArm(options) {
	const controller = new AbortController();
	const onOuterAbort = () => controller.abort();
	if (options.signal?.aborted) controller.abort();
	else options.signal?.addEventListener("abort", onOuterAbort, { once: true });
	const queue = eventQueue(controller.signal);
	const workers = [];
	const workersByResource = new Map();
	const artifacts = {};
	const schedule = [];
	const packetFingerprints = {};
	const processErrorClassifications = { process_start: 0, protocol: 0 };
	const workerErrors = new Map();
	let flow = options.flow;
	let coordinator = createCoordinatorState(flow.goals.map(dependencies));
	let terminalOutcome = "complete";
	let terminalError = "";
	let terminalGoalIndex;
	let terminalExit = { code: null, signal: null, stderr: "" };
	let sequence = 0;
	const startedAt = Date.now();
	const artifactPaths = flow.goals.map((goal) =>
		options.runtime.workerArtifactPath(options.flowDir, goal.index),
	);
	const pathIndexes = new Map(
		artifactPaths.map((path, index) => [path, index]),
	);
	const deliveredCompletions = new Set();
	const enqueueCompletion = (goalIndex, fact, attemptId) => {
		const key = `${goalIndex}:${fact.goalId}`;
		if (
			coordinatorAttemptId(coordinator, goalIndex) !== attemptId ||
			deliveredCompletions.has(key)
		)
			return;
		deliveredCompletions.add(key);
		queue.push({ type: "completion", fact, goalIndex, attemptId });
	};
	const closeWatcher = options.runtime.watchBatchResults(
		artifactPaths,
		(path, fact) => {
			const goalIndex = pathIndexes.get(path);
			enqueueCompletion(
				goalIndex,
				fact,
				coordinatorAttemptId(coordinator, goalIndex),
			);
			options.progress?.set({ goal: goalIndex, phase: "completion" });
		},
		controller.signal,
		options.runId,
	);
	const unregister = options.lifecycle?.register({
		stop: async () => {
			controller.abort();
		},
	});
	const record = (type, goalIndexes, extra = {}) => {
		schedule.push({
			sequence: ++sequence,
			type,
			goalIndexes: [...goalIndexes].sort((left, right) => left - right),
			elapsedMs: Date.now() - startedAt,
			...extra,
		});
	};
	const launch = (indices) => {
		const launchedAt = Date.now();
		const attempts = new Map();
		const packets = new Map();
		for (const goalIndex of indices) {
			const goal = flow.goals[goalIndex];
			const attemptId = `${options.runId}-G${goalIndex + 1}`;
			const nextCoordinator = startCoordinatorAttempt(
				coordinator,
				goalIndex,
				attemptId,
				attemptId,
			);
			if (nextCoordinator === coordinator)
				throw new Error(`scheduler selected non-ready G${goalIndex + 1}`);
			coordinator = nextCoordinator;
			attempts.set(goalIndex, attemptId);
			const packet = buildDependencyPacket(
				options.flowDir,
				flow,
				goalIndex,
				artifacts,
				options.runtime.hasCriteriaDeviation,
			);
			packets.set(goalIndex, packet);
			packetFingerprints[goalIndex] = packet.fingerprint;
			const sessionFile =
				options.rootSessions.get(goalIndex) ??
				join(
					options.sessions,
					`${options.arm}-G${goalIndex + 1}-${randomUUID()}.jsonl`,
				);
			flow = updateGoal(flow, goalIndex, {
				status: "running",
				startedAt: goal.startedAt ?? launchedAt,
				sessionFile,
				sessionName: `${options.manifest.id} G${goalIndex + 1}`,
				snapshot:
					goal.snapshot ??
					readFileSync(join(options.flowDir, goal.file), "utf8"),
			});
		}
		flow = updateParallelRun(
			flow,
			options.runId,
			activeCoordinatorGoals(coordinator),
			launchedAt,
		);
		options.runtime.writeFlow(options.flowDir, flow);
		for (const goalIndex of indices) {
			const goal = flow.goals[goalIndex];
			options.runtime.initWorkerArtifact(options.flowDir, flow, goalIndex, {
				parallelRunId: options.runId,
				sessionFile: goal.sessionFile,
				sessionName: goal.sessionName,
			});
			const attemptId = attempts.get(goalIndex);
			const packet = packets.get(goalIndex);
			const initialPrompt = `${options.runtime.workerInitialPrompt(
				options.flowDir,
				flow,
				goalIndex,
				{ forkedFromPlanSession: options.rootSessions.has(goalIndex) },
			)}\n\nDependency evidence packet (immutable, direct predecessors only):\n${JSON.stringify(packet)}`;
			const handle = options.runtime.spawnWorker({
				flowId: flow.id,
				goalIndex,
				flowDir: options.flowDir,
				parallelRunId: options.runId,
				cwd: options.fixture,
				initialPrompt,
				sessionFile: goal.sessionFile,
				signal: controller.signal,
			});
			const exited = deferred();
			handle.onEvent((event) => {
				options.progress?.noteWorkerEvent(goalIndex, event);
				const classification =
					event?.type === "json_parse_error"
						? "protocol"
						: event?.type === "process_error"
							? "process_start"
							: undefined;
				if (!classification) return;
				processErrorClassifications[classification] += 1;
				const errors = workerErrors.get(goalIndex) ?? [];
				errors.push(classification);
				workerErrors.set(goalIndex, errors);
			});
			handle.onExit((code, signal, stderr) => {
				exited.resolve();
				const artifact = options.runtime.readWorkerArtifact(
					options.flowDir,
					goalIndex,
				);
				if (artifact?.completion)
					enqueueCompletion(goalIndex, artifact.completion, attemptId);
				else if (artifact?.handoff)
					queue.push({ type: "blocked", goalIndex, attemptId });
				else
					queue.push({
						type: "exit",
						code,
						goalIndex,
						signal,
						stderr,
						attemptId,
					});
			});
			const worker = { exited: exited.promise, handle };
			workers.push(worker);
			workersByResource.set(attemptId, worker);
		}
		record("launch", indices, {
			active: activeCoordinatorGoals(coordinator),
		});
		options.progress?.set({
			phase: "launch",
			goal: indices[0],
			detail: `g${indices.map((index) => index + 1).join(",")}`,
		});
	};
	let coordinationError;
	const settleResources = (transition) => {
		const cancelled = new Set(transition.cancelResources);
		for (const resourceId of transition.releasedResources) {
			const worker = workersByResource.get(resourceId);
			if (cancelled.has(resourceId)) worker?.handle.kill();
			workersByResource.delete(resourceId);
		}
	};
	try {
		for (;;) {
			throwIfCancelled(controller.signal);
			if (flow.goals.every((goal) => goal.status === "complete")) break;
			const activeGoals = activeCoordinatorGoals(coordinator);
			if (shouldSchedule(options.arm, activeGoals.length)) {
				const indices = launchSet(options, flow, new Set(activeGoals));
				if (indices.length) launch(indices);
				else if (coordinatorResourceCount(coordinator) === 0) {
					terminalOutcome = "worker_error";
					record("deadlock", []);
					break;
				}
			}
			const event = await queue.next(RUN_TIMEOUT_MS);
			const transition = applyCoordinatorEvent(coordinator, event);
			if (!transition.accepted) {
				record("stale", [event.goalIndex]);
				continue;
			}
			coordinator = transition.state;
			settleResources(transition);
			if (transition.action === "complete") {
				artifacts[event.goalIndex] = options.runtime.readWorkerArtifact(
					options.flowDir,
					event.goalIndex,
				);
				flow = completeGoal(flow, event.goalIndex, event.fact);
				const remaining = activeCoordinatorGoals(coordinator);
				flow = remaining.length
					? updateParallelRun(flow, options.runId, remaining, startedAt)
					: { ...flow, parallelRun: null };
				options.runtime.writeFlow(options.flowDir, flow);
				record("completion", [event.goalIndex], { active: remaining });
				continue;
			}
			terminalOutcome = transition.action;
			terminalError = event.stderr ?? "";
			terminalGoalIndex = event.goalIndex;
			terminalExit = {
				code: event.code ?? null,
				signal: event.signal ?? null,
				stderr: event.stderr ?? "",
			};
			record(event.type, [event.goalIndex]);
			break;
		}
	} catch (error) {
		coordinationError = error;
	} finally {
		unregister?.();
		options.signal?.removeEventListener("abort", onOuterAbort);
		if (coordinatorResourceCount(coordinator) > 0) {
			const cleanup = applyCoordinatorEvent(coordinator, { type: "stop" });
			coordinator = cleanup.state;
			settleResources(cleanup);
		}
		closeWatcher();
		await Promise.all(workers.map((worker) => worker.exited));
		controller.abort();
		workersByResource.clear();
		workers.length = 0;
	}
	if (coordinationError) {
		if (classifyFailure(coordinationError) === "cancelled")
			throw coordinationError;
		throw attachAttemptMetrics(
			coordinationError,
			workerAttemptMetrics(flow, options),
		);
	}
	throwIfCancelled(options.signal);
	if (terminalOutcome !== "complete" && terminalOutcome !== "blocked") {
		const causalErrors = workerErrors.get(terminalGoalIndex) ?? [];
		// 无 completion/handoff 退出 = 协议/进程故障，必须可重试；不可用空 stderr 落到 quality。
		const classification =
			terminalOutcome === "missing_completion"
				? classifyMissingWorkerExit({
						...terminalExit,
						processErrors: causalErrors,
					})
				: causalErrors.includes("protocol")
					? "protocol"
					: causalErrors.includes("process_start")
						? "process_start"
						: classifyFailure(new Error(terminalError));
		if (isRetryableFailure(classification)) {
			const error = attachAttemptMetrics(
				new Error(`${classification} worker failure`),
				workerAttemptMetrics(flow, options),
			);
			error.code = classification;
			error.partialRun = buildPartialRunEvidence({
				flow,
				options,
				schedule,
				packetFingerprints,
				processErrorClassifications,
				processErrors:
					processErrorClassifications.process_start +
					processErrorClassifications.protocol,
				resourcesRemaining:
					coordinatorResourceCount(coordinator) + workersByResource.size,
				terminalOutcome,
			});
			throw error;
		}
	}
	if (terminalOutcome === "complete") {
		const completedAt = Date.now();
		flow = { ...flow, status: "complete", completedAt, parallelRun: null };
		options.runtime.writeFlow(options.flowDir, flow);
	}
	return {
		flow,
		packetFingerprints,
		processErrorClassifications,
		processErrors:
			processErrorClassifications.process_start +
			processErrorClassifications.protocol,
		resourcesRemaining:
			coordinatorResourceCount(coordinator) + workersByResource.size,
		schedule,
		terminalOutcome,
	};
}

function launchSet(options, flow, active) {
	const capacity = options.workerBudget;
	if (options.arm === "streaming")
		return options.runtime.computeLaunchSet(flow, active, capacity);
	if (active.size) return [];
	if (options.arm === "optimized-batch")
		return options.runtime.computeLaunchSet(flow, active, capacity);
	const current = options.runtime.computeReadyBatch(flow)?.indices ?? [];
	return current.slice(0, options.arm === "serial" ? 1 : capacity);
}

function shouldSchedule(arm, activeCount) {
	return arm === "streaming" || activeCount === 0;
}

function completeGoal(flow, goalIndex, fact) {
	const completedAt = Date.now();
	return updateGoal(flow, goalIndex, {
		status: "complete",
		completedAt,
		completionCursor: null,
		goalId: fact.goalId,
		result: {
			summary: fact.summary,
			handoff: null,
			handoffGenerated: false,
			criteriaChanged: false,
		},
		checks: fact.checks ?? flow.goals[goalIndex].checks,
		checkAttribution: fact.checkAttribution ?? {},
	});
}

function updateGoal(flow, goalIndex, replacement) {
	return {
		...flow,
		currentGoal: goalIndex,
		goals: flow.goals.map((goal, index) =>
			index === goalIndex ? { ...goal, ...replacement } : goal,
		),
	};
}

function updateParallelRun(flow, runId, goalIndexes, startedAt) {
	return {
		...flow,
		status: "running",
		startedAt: flow.startedAt ?? startedAt,
		parallelRun: {
			id: runId,
			goalIndexes: [...goalIndexes].sort((left, right) => left - right),
			startedAt,
			consoleSessionFile: join(tmpdir(), "graph-eval-console.jsonl"),
			consoleSessionName: "graph evaluation",
		},
	};
}

function resetFlow(flow) {
	return {
		...flow,
		status: "draft",
		startedAt: null,
		completedAt: null,
		currentGoal: 0,
		attention: null,
		parallelRun: null,
		errors: [],
		goals: flow.goals.map((goal) => ({
			...goal,
			status: "pending",
			startedAt: null,
			completedAt: null,
			completionCursor: null,
			sessionFile: null,
			sessionName: null,
			snapshot: null,
			goalId: null,
			result: {
				summary: null,
				handoff: null,
				handoffGenerated: false,
				criteriaChanged: false,
			},
			checks: {
				acceptance: { enabled: true, rounds: [], active: null },
				quality: { enabled: true, rounds: [], active: null },
			},
			pendingAdvisor: null,
		})),
	};
}

function branchPlannerSession(runtime, plannerSession, planLeaf, cwd) {
	const branch =
		runtime.SessionManager.open(plannerSession).createBranchedSession(planLeaf);
	if (!branch) throw protocolError("Planner session branch failed");
	const lines = readFileSync(branch, "utf8").trimEnd().split("\n");
	const header = JSON.parse(lines[0]);
	lines[0] = JSON.stringify({ ...header, cwd });
	writeFileSync(branch, `${lines.join("\n")}\n`);
	return branch;
}

function forkedSession(path) {
	const header = JSON.parse(readFileSync(path, "utf8").split("\n", 1)[0]);
	return typeof header.parentSession === "string";
}

async function runOracle(fixture, manifest) {
	let commandOk = false;
	try {
		await execFilePromise(manifest.oracle.command, manifest.oracle.args, {
			cwd: fixture,
			timeout: 2 * 60_000,
		});
		commandOk = true;
	} catch {}
	let diffOk = false;
	try {
		execFileSync("git", ["-C", fixture, "diff", "--check"], { stdio: "pipe" });
		diffOk = true;
	} catch {}
	const actual = changedFiles(fixture).filter(
		(path) => !path.startsWith(".flow/"),
	);
	const expected = [...manifest.allowedChanges].sort();
	const scopeOk = stableJson(actual) === stableJson(expected);
	return { ok: commandOk && diffOk && scopeOk, scopeOk };
}

function workerAttemptMetrics(flow, options) {
	const anchors = new Map();
	const sessionFiles = [...options.rootSessions.values()];
	for (const path of options.rootSessions.values())
		anchors.set(path, options.planLeaf);
	for (const goal of flow.goals) {
		if (!goal.sessionFile) continue;
		sessionFiles.push(goal.sessionFile);
		if (options.rootSessions.has(goal.index))
			anchors.set(goal.sessionFile, options.planLeaf);
	}
	return collectSessionAttemptMetrics(
		sessionFiles,
		options.runtime.sessionStats,
		anchors,
	);
}

export function collectSessionAttemptMetrics(
	sessionFiles,
	sessionStats,
	anchors = new Map(),
) {
	const paths = [...new Set(sessionFiles.filter(Boolean))];
	if (paths.length === 0) return undefined;
	const totals = { cost: 0, calls: 0, tokens: 0 };
	for (const path of paths) {
		// 任一预期 Session 缺失或解析失败 → 整次 attempt usage 未知，禁止部分聚合。
		if (!existsSync(path)) return undefined;
		try {
			const stats = sessionStats(readFileSync(path, "utf8"), anchors.get(path));
			totals.cost += stats.cost ?? 0;
			totals.calls += stats.turns ?? 0;
			totals.tokens +=
				(stats.input ?? 0) +
				(stats.output ?? 0) +
				(stats.cacheRead ?? 0) +
				(stats.cacheWrite ?? 0);
		} catch {
			return undefined;
		}
	}
	return totals;
}

export function attachSessionAttemptMetrics(
	error,
	sessionFiles,
	sessionStats,
	anchors = new Map(),
) {
	return attachAttemptMetrics(
		error,
		collectSessionAttemptMetrics(sessionFiles, sessionStats, anchors),
	);
}

function attachAttemptMetrics(error, metrics) {
	const failure = error instanceof Error ? error : new Error(String(error));
	if (metrics && !failure.attemptMetrics) failure.attemptMetrics = metrics;
	return failure;
}

function collectWorkerStats(flow, runtime, planLeaf, rootSessions) {
	const totals = {
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
	for (const goal of flow.goals) {
		if (!goal.sessionFile || !existsSync(goal.sessionFile)) continue;
		// 已存在但解析失败必须上抛，由 arm 外层收口为未知 usage；禁止静默少计。
		const stats = runtime.sessionStats(
			readFileSync(goal.sessionFile, "utf8"),
			rootSessions.has(goal.index) ? planLeaf : undefined,
		);
		for (const key of Object.keys(totals)) totals[key] += stats[key] ?? 0;
	}
	return totals;
}

function collectMetrics(flow, result, stats, rootCount) {
	const checks = deriveCheckFlags(flow.goals.map((goal) => goal.checks));
	return {
		elapsedMs: result.schedule.at(-1)?.elapsedMs ?? 0,
		...checks,
		processErrors: result.processErrors,
		processErrorClassifications: result.processErrorClassifications,
		resourcesRemaining: result.resourcesRemaining,
		prewalkHits: flow.goals.filter(
			(goal) =>
				dependencies(goal).length === 0 &&
				goal.sessionFile &&
				forkedSession(goal.sessionFile),
		).length,
		prewalkExpected: rootCount,
		calls: stats.turns,
		tokens: stats.input + stats.output + stats.cacheRead + stats.cacheWrite,
		cost: stats.cost,
		readCalls: stats.readCalls,
		bashCalls: stats.bashCalls,
	};
}

function runWithAttemptSummary(run, attempts) {
	// complete / blocked 都是一次干净收口的 attempt（BLOCKED 是质量终态，不是基础设施失败）。
	const settledOk =
		run.terminalOutcome === "complete" || run.terminalOutcome === "blocked";
	const recordedAttempts = settledOk
		? attempts
		: attempts.map((attempt, index) =>
				index === attempts.length - 1
					? {
							...attempt,
							classification:
								attempt.classification === "none"
									? "quality"
									: attempt.classification,
							outcome: "failed",
						}
					: attempt,
			);
	const usage = usageMetricsFromAttempts(recordedAttempts);
	return {
		...run,
		attempts: recordedAttempts,
		metrics: {
			...run.metrics,
			...usage,
		},
	};
}

function planningFailureBenchmark(options, error) {
	const attempts = error?.attempts ?? [failedAttempt(error)];
	const armOrder = expectedArmOrder(options.benchmarkIndex, options.runsPerArm);
	const planningUsage = usageMetricsFromAttempts(attempts);
	return {
		id: options.manifest.id,
		fingerprint: options.fingerprint,
		graph: evaluationGraph(options.manifest),
		planFingerprint: sha256(`planning-failure:${options.manifest.id}`),
		planning: {
			attempts,
			elapsedMs: planningUsage.totalAttemptElapsedMs ?? 0,
			...planningUsage,
			status: "failed",
		},
		armOrder,
		runs: armOrder.flatMap((order, repetition) =>
			order.map((arm) => planningFailureRun(arm, repetition)),
		),
	};
}

function planningFailureRun(arm, repetition) {
	const attempts = [
		{
			attempt: 1,
			classification: "quality",
			outcome: "failed",
			elapsedMs: 0,
			cost: null,
			calls: null,
			tokens: null,
			metricsComplete: false,
		},
	];
	return {
		arm,
		repetition: repetition + 1,
		terminalOutcome: "planning_failure",
		attempts,
		oracle: { executed: false, ok: false },
		repositoryClean: false,
		schedule: [
			{
				sequence: 1,
				type: "planning-failure",
				goalIndexes: [],
				elapsedMs: 0,
			},
		],
		packetFingerprints: {},
		metrics: { ...emptyMetrics(), ...usageMetricsFromAttempts(attempts) },
	};
}

function failedArmRun(arm, repetition, error) {
	const attempts = error?.attempts ?? [failedAttempt(error)];
	const usage = usageMetricsFromAttempts(attempts);
	const evidence =
		attempts.at(-1)?.evidence ?? compactPartialFromError(error) ?? undefined;
	if (evidence) {
		return {
			arm,
			repetition: repetition + 1,
			terminalOutcome: "worker_error",
			attempts,
			oracle: { executed: false, ok: false },
			repositoryClean: false,
			schedule: evidence.schedule,
			packetFingerprints: evidence.packetFingerprints,
			metrics: {
				...emptyMetrics(),
				elapsedMs: evidence.elapsedMs,
				acceptancePassed: evidence.acceptancePassed,
				qualityPassed: evidence.qualityPassed,
				firstRoundPassed: evidence.firstRoundPassed,
				repairRounds: evidence.repairRounds,
				processErrors: evidence.processErrors,
				processErrorClassifications: evidence.processErrorClassifications,
				resourcesRemaining: evidence.resourcesRemaining,
				prewalkHits: evidence.prewalkHits,
				prewalkExpected: evidence.prewalkExpected,
				readCalls: evidence.readCalls,
				bashCalls: evidence.bashCalls,
				...usage,
			},
		};
	}
	return {
		arm,
		repetition: repetition + 1,
		terminalOutcome: "worker_error",
		attempts,
		oracle: { executed: false, ok: false },
		repositoryClean: false,
		schedule: [
			{
				sequence: 1,
				type: "infrastructure-failure",
				goalIndexes: [],
				elapsedMs: 0,
			},
		],
		packetFingerprints: {},
		metrics: { ...emptyMetrics(), ...usage },
	};
}

function compactPartialFromError(error) {
	const partial = error?.partialRun;
	if (!partial?.schedule?.length) return undefined;
	return {
		schedule: partial.schedule,
		packetFingerprints: partial.packetFingerprints ?? {},
		processErrors: partial.metrics?.processErrors ?? 0,
		processErrorClassifications: partial.metrics
			?.processErrorClassifications ?? {
			process_start: 0,
			protocol: 0,
		},
		prewalkHits: partial.metrics?.prewalkHits ?? 0,
		prewalkExpected: partial.metrics?.prewalkExpected ?? 0,
		resourcesRemaining: partial.metrics?.resourcesRemaining ?? 0,
		readCalls: partial.metrics?.readCalls ?? 0,
		bashCalls: partial.metrics?.bashCalls ?? 0,
		elapsedMs: partial.metrics?.elapsedMs ?? 0,
		acceptancePassed: partial.metrics?.acceptancePassed === true,
		qualityPassed: partial.metrics?.qualityPassed === true,
		firstRoundPassed: partial.metrics?.firstRoundPassed === true,
		repairRounds: partial.metrics?.repairRounds ?? 0,
	};
}

function buildPartialRunEvidence({
	flow,
	options,
	schedule,
	packetFingerprints,
	processErrorClassifications,
	processErrors,
	resourcesRemaining,
	terminalOutcome,
}) {
	const rootCount = flow.goals.filter(
		(goal) => dependencies(goal).length === 0,
	).length;
	let stats = {
		turns: 0,
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		readCalls: 0,
		bashCalls: 0,
	};
	try {
		stats = collectWorkerStats(
			flow,
			options.runtime,
			options.planLeaf,
			options.rootSessions,
		);
	} catch {
		/* keep zeros */
	}
	const checks = deriveCheckFlags(flow.goals.map((goal) => goal.checks));
	return {
		terminalOutcome,
		schedule: schedule.map((event) => ({ ...event })),
		packetFingerprints: { ...packetFingerprints },
		metrics: {
			elapsedMs: schedule.at(-1)?.elapsedMs ?? 0,
			...checks,
			processErrors,
			processErrorClassifications: { ...processErrorClassifications },
			resourcesRemaining,
			prewalkHits: flow.goals.filter(
				(goal) =>
					dependencies(goal).length === 0 &&
					goal.sessionFile &&
					existsSync(goal.sessionFile) &&
					forkedSession(goal.sessionFile),
			).length,
			prewalkExpected: rootCount,
			calls: stats.turns,
			tokens: stats.input + stats.output + stats.cacheRead + stats.cacheWrite,
			cost: stats.cost,
			readCalls: stats.readCalls,
			bashCalls: stats.bashCalls,
		},
	};
}

function failedAttempt(error) {
	return {
		attempt: 1,
		classification: classifyFailure(error),
		outcome: "failed",
		elapsedMs: 0,
		cost: null,
		calls: null,
		tokens: null,
		metricsComplete: false,
	};
}

function emptyMetrics() {
	return {
		elapsedMs: 0,
		acceptancePassed: false,
		qualityPassed: false,
		firstRoundPassed: false,
		repairRounds: 0,
		processErrors: 0,
		processErrorClassifications: { process_start: 0, protocol: 0 },
		resourcesRemaining: 0,
		prewalkHits: 0,
		prewalkExpected: 0,
		calls: null,
		tokens: null,
		cost: null,
		readCalls: 0,
		bashCalls: 0,
	};
}

function changedFiles(fixture) {
	return execFileSync("git", ["-C", fixture, "status", "--porcelain"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	})
		.split("\n")
		.filter(Boolean)
		.map((line) => line.slice(3).replace(/^"|"$/gu, ""))
		.sort();
}

function initRepository(fixture) {
	execFileSync("git", ["-C", fixture, "init", "-q"], { stdio: "pipe" });
	execFileSync("git", ["-C", fixture, "add", "-A"], { stdio: "pipe" });
	execFileSync(
		"git",
		[
			"-C",
			fixture,
			"-c",
			"user.email=eval@local",
			"-c",
			"user.name=eval",
			"commit",
			"-qm",
			"base",
		],
		{ stdio: "pipe" },
	);
}

function printSummary(artifact) {
	console.log(`\n${formatEvaluationSummary(artifact).trimEnd()}`);
}

function writeArtifact(path, artifact) {
	const target = resolve(root, path);
	mkdirSync(dirname(target), { recursive: true });
	// Tab-indented JSON; baseline is excluded from Biome (large eval artifact).
	writeFileSync(target, `${JSON.stringify(artifact, null, "\t")}\n`);
	const summaryPath = evaluationSummaryPath(target);
	writeFileSync(summaryPath, formatEvaluationSummary(artifact));
}

function protocolError(message) {
	const error = new Error(message);
	error.code = "protocol";
	return error;
}

async function waitForPlannerSettlement(
	client,
	flowDir,
	validateFlowDir,
	timeoutMs,
	signal,
	progress,
) {
	const deadline = Date.now() + Math.max(1_000, timeoutMs);
	const remaining = () => {
		throwIfCancelled(signal);
		const duration = deadline - Date.now();
		if (duration <= 0) throw new Error("planner settlement timed out");
		return duration;
	};
	const readValidation = () =>
		existsSync(join(flowDir, "flow.json"))
			? validateFlowDir(flowDir)
			: undefined;
	const settledTerminal = (validation) => {
		const status = validation?.flow?.status;
		return (
			validation?.ok &&
			status &&
			status !== "aligning" &&
			status !== "generating"
		);
	};
	let goAttempts = 0;
	for (;;) {
		throwIfCancelled(signal);
		await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
		const validation = readValidation();
		if (settledTerminal(validation)) return validation;
		const settled = createAgentSettledLatch(client);
		try {
			const state = await client.getState();
			if (settled.hasSettled()) continue;
			if (state.isStreaming) {
				progress?.set({ phase: "planning", detail: "streaming" });
				await settled.wait(remaining(), signal);
				continue;
			}
			// idle：先等 session transition；仍停在 generating/aligning 时最多推进 3 次。
			const status = validation?.flow?.status;
			const goals = validation?.flow?.goals?.length ?? 0;
			if (status === "aligning" || status === "generating") {
				try {
					await settled.wait(Math.min(remaining(), 15_000), signal);
					continue;
				} catch {
					if (goAttempts >= 3)
						throw new Error(
							`planner stuck after ${goAttempts} go attempts (status=${status}, goals=${goals})`,
						);
					goAttempts += 1;
					console.log(
						`  planner idle in ${status} (goals=${goals}); /flow go (${goAttempts}/3)`,
					);
					await raceAbort(
						signal,
						client.promptAndWait("/flow go F1", undefined, remaining()),
					);
					continue;
				}
			}
			if (validation) return validation;
			throw new Error("planner finished without Flow state");
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
		async wait(timeoutMs, signal) {
			if (settled) return;
			let timer;
			try {
				await raceAbort(
					signal,
					Promise.race([
						settledPromise,
						new Promise((_, rejectPromise) => {
							timer = setTimeout(
								() => rejectPromise(new Error("planner settlement timed out")),
								timeoutMs,
							);
						}),
					]),
				);
			} finally {
				if (timer) clearTimeout(timer);
			}
		},
		close: unsubscribe,
	};
}

function dependencies(goal) {
	return goal.dependsOn ?? (goal.index === 0 ? [] : [goal.index - 1]);
}

function eventQueue(signal) {
	const buffered = [];
	const waiting = [];
	return {
		push(event) {
			const resolveEvent = waiting.shift();
			if (resolveEvent) resolveEvent(event);
			else buffered.push(event);
		},
		next(timeoutMs) {
			if (signal?.aborted) return Promise.reject(cancellationError());
			if (buffered.length) return Promise.resolve(buffered.shift());
			return new Promise((resolveEvent, rejectEvent) => {
				const timer = setTimeout(
					() => rejectEvent(new Error("worker evaluation timed out")),
					timeoutMs,
				);
				timer.unref?.();
				const onAbort = () => {
					clearTimeout(timer);
					rejectEvent(cancellationError());
				};
				signal?.addEventListener("abort", onAbort, { once: true });
				waiting.push((event) => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
					resolveEvent(event);
				});
			});
		},
	};
}

function deferred() {
	let resolvePromise = () => undefined;
	const promise = new Promise((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

function execFilePromise(command, args, options) {
	return new Promise((resolvePromise, rejectPromise) => {
		execFile(command, args, options, (error, stdout, stderr) => {
			if (error) rejectPromise(Object.assign(error, { stderr, stdout }));
			else resolvePromise({ stderr, stdout });
		});
	});
}

function option(argv, name) {
	const index = argv.indexOf(name);
	if (index < 0) return undefined;
	const value = argv[index + 1];
	if (!value || value.startsWith("--"))
		throw new Error(`${name} requires a value`);
	return value;
}

function numberOption(argv, name, fallback) {
	const value = option(argv, name);
	return value === undefined ? fallback : Number(value);
}

function unknownArgs(argv) {
	const valueOptions = new Set([
		"--fixtures",
		"--output",
		"--runs",
		"--verify-artifact",
		"--worker-budget",
	]);
	const flags = new Set(["--dry-run"]);
	const unknown = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (flags.has(arg)) continue;
		if (valueOptions.has(arg)) {
			index += 1;
			continue;
		}
		unknown.push(arg);
	}
	return unknown;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath)
	await main(process.argv.slice(2));
