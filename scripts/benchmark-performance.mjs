#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	watch,
	writeFileSync,
} from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = dirname(dirname(scriptPath));
const distIndex = join(root, "dist", "index.js");
const loaderPath = join(
	root,
	"node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js",
);
const startupMarker = "__PI_FLOW_STARTUP_SAMPLE__";
const mebibyte = 1024 * 1024;

if (process.argv[1] && resolve(process.argv[1]) === scriptPath)
	await main(process.argv.slice(2));

async function main([mode = "", ...args]) {
	try {
		if (mode === "startup-child") await runStartupChild(args);
		else {
			assertBuilt();
			const result = await runMode(mode, args);
			console.log(JSON.stringify(result, null, 2));
		}
	} catch (error) {
		if (mode !== "startup-child")
			console.log(
				JSON.stringify(
					{ mode: mode || null, ok: false, error: errorMessage(error) },
					null,
					2,
				),
			);
		else console.error(error);
		process.exitCode = 1;
	}
}

function runMode(selectedMode, modeArgs) {
	if (selectedMode === "startup") return runStartup(modeArgs);
	if (selectedMode === "soak") return runSoak(modeArgs);
	if (selectedMode === "report") return runReport(modeArgs);
	throw new Error("Usage: benchmark-performance.mjs startup|soak|report");
}

async function runStartup(modeArgs) {
	const samples = integerOption(modeArgs, "samples", 7, 3);
	const temp = mkdtempSync(join(tmpdir(), "pi-flow-startup-bench-"));
	const probePath = join(temp, "shutdown-probe.mjs");
	writeFileSync(probePath, startupProbeSource());
	try {
		const results = { bare: [], plugin: [] };
		for (let index = 0; index < samples; index += 1) {
			const order = index % 2 === 0 ? ["bare", "plugin"] : ["plugin", "bare"];
			for (const variant of order)
				results[variant].push(startupSample(variant, temp, probePath));
		}
		const bare = startupSummary(results.bare);
		const plugin = startupSummary(results.plugin);
		return {
			mode: "startup",
			ok: true,
			samples,
			loader: loaderPath,
			extension: distIndex,
			bare,
			plugin,
			delta: {
				loadMs: round(plugin.loadMs.median - bare.loadMs.median),
				rssBytes: plugin.rssBytes.median - bare.rssBytes.median,
			},
		};
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

function startupSample(variant, cwd, probePath) {
	const output = execFileSync(
		process.execPath,
		[scriptPath, "startup-child", variant, cwd, probePath],
		{
			encoding: "utf8",
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: join(cwd, "agent"),
				PI_OFFLINE: "1",
			},
			maxBuffer: 1024 * 1024,
		},
	);
	const line = output
		.split("\n")
		.find((item) => item.startsWith(startupMarker));
	if (!line) throw new Error(`Startup probe did not report for ${variant}.`);
	return JSON.parse(line.slice(startupMarker.length));
}

async function runStartupChild([variant, cwd, probePath]) {
	if (!variant || !cwd || !probePath) throw new Error("Invalid startup child.");
	const startedAt = performance.now();
	const { loadExtensions } = await import(pathToFileURL(loaderPath).href);
	const paths = variant === "plugin" ? [distIndex, probePath] : [probePath];
	const loaded = await loadExtensions(paths, cwd);
	if (loaded.errors.length)
		throw new Error(JSON.stringify(loaded.errors, null, 2));
	globalThis.__PI_FLOW_STARTUP_SAMPLE__ = {
		variant,
		loadMs: round(performance.now() - startedAt),
		rssBytes: process.memoryUsage().rss,
	};
	const ctx = startupContext(cwd);
	if (variant === "plugin") {
		const flowCommand = loaded.extensions[0]?.commands.get("flow");
		if (!flowCommand) throw new Error("Flow command shell was not registered.");
		const activationStartedAt = performance.now();
		await flowCommand.handler("status F999", ctx);
		globalThis.__PI_FLOW_STARTUP_SAMPLE__.activationMs = round(
			performance.now() - activationStartedAt,
		);
	}
	for (const extension of loaded.extensions) {
		for (const handler of extension.handlers.get("session_shutdown") ?? [])
			await handler({}, ctx);
	}
}

function startupProbeSource() {
	return `export default function probe(pi) {
	pi.on("session_shutdown", () => {
		const sample = globalThis.__PI_FLOW_STARTUP_SAMPLE__;
		process.stdout.write(${JSON.stringify(startupMarker)} + JSON.stringify({
			...sample,
			shutdownRssBytes: process.memoryUsage().rss,
		}) + "\\n");
	});
}
`;
}

function startupContext(cwd) {
	const entries = [];
	return {
		cwd,
		hasUI: false,
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: {
			getSessionFile: () => join(cwd, "startup.jsonl"),
			getBranch: () => entries,
			getEntries: () => entries,
			appendCustomEntry: (customType, data) =>
				entries.push({ type: "custom", customType, data }),
		},
		ui: quietUi(),
	};
}

function startupSummary(samples) {
	const activation = samples.flatMap((sample) =>
		typeof sample.activationMs === "number" ? [sample.activationMs] : [],
	);
	return {
		loadMs: seriesSummary(samples.map((sample) => sample.loadMs)),
		rssBytes: seriesSummary(samples.map((sample) => sample.rssBytes)),
		shutdownRssBytes: seriesSummary(
			samples.map((sample) => sample.shutdownRssBytes),
		),
		...(activation.length > 0
			? { activationMs: seriesSummary(activation) }
			: {}),
		samples,
	};
}

async function runSoak(modeArgs) {
	if (typeof global.gc !== "function")
		throw new Error("soak requires Node --expose-gc");
	const cycles = integerOption(modeArgs, "cycles", 100, 100);
	const warmupCycles = integerOption(modeArgs, "warmup", 10, 1);
	// Node materializes piped stdio lazily; include inherited handles in the baseline.
	void process.stdout;
	void process.stderr;
	const baselineActiveResources = activeResourceCounts();
	const temp = mkdtempSync(join(tmpdir(), "pi-flow-soak-bench-"));
	let bench;
	try {
		bench = await createSoakBench(temp);
		for (let index = 0; index < warmupCycles; index += 1) {
			await bench.runCycle(index);
			await bench.waitForReportIdle();
			await settleLifecycle();
		}
		const samples = [];
		for (let cycle = 1; cycle <= cycles; cycle += 1) {
			const lifecycle = await bench.runCycle(warmupCycles + cycle);
			await bench.waitForReportIdle();
			await settleLifecycle();
			const memory = process.memoryUsage();
			samples.push({
				cycle,
				heapUsed: memory.heapUsed,
				rss: memory.rss,
				lifecycle,
				resources: bench.resourceSnapshot(),
			});
		}
		await bench.close();
		await settleLifecycle();
		const result = soakResult(
			samples,
			warmupCycles,
			bench.contextRefs,
			bench.resourceSnapshot(),
			baselineActiveResources,
		);
		if (!result.ok) process.exitCode = 1;
		return result;
	} finally {
		await bench?.close();
		rmSync(temp, { recursive: true, force: true });
	}
}

async function createSoakBench(temp) {
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	const agentDir = join(temp, "agent");
	mkdirSync(agentDir, { recursive: true });
	// 隔离报告 daemon 到本 soak 临时目录，close 时按 endpoint 停掉，避免占固定 49327。
	process.env.PI_CODING_AGENT_DIR = agentDir;
	const workerCommand = writeBenchmarkWorker(temp);
	const pluginRoot = isolatedPlugin(temp, workerCommand);
	const workspace = join(temp, "workspace");
	mkdirSync(workspace, { recursive: true });
	const pluginIndex = join(pluginRoot, "dist", "index.js");
	const { createExtensionRuntime, loadExtensionFromFactory } = await import(
		pathToFileURL(loaderPath).href
	);
	const runtime = createExtensionRuntime();
	const { default: factory } = await import(pathToFileURL(pluginIndex).href);
	const extension = await loadExtensionFromFactory(
		factory,
		workspace,
		undefined,
		runtime,
		pluginIndex,
	);
	const harness = createSessionHarness(extension, runtime, workspace);
	const moduleUrl = (path) =>
		pathToFileURL(join(pluginRoot, "dist", path)).href;
	const [
		{ handleGoalCompletionEnd },
		{ getGoalState },
		flowRuntimeModule,
		{ waitForSessionTransitions },
		generation,
		generationState,
		watcher,
		goalRuntime,
		laneUi,
		reportClient,
		flowTypes,
		flowValidator,
	] = await Promise.all([
		import(moduleUrl("flow/execution/advance.js")),
		import(moduleUrl("goal.js")),
		import(moduleUrl("flow/runtime.js")),
		import(moduleUrl("flow/session-transition.js")),
		import(moduleUrl("flow/generation.js")),
		import(moduleUrl("shared/generation-state.js")),
		import(moduleUrl("flow/watcher.js")),
		import(moduleUrl("goal/runtime.js")),
		import(moduleUrl("flow/parallel/lane-ui.js")),
		import(moduleUrl("shared/report-client.js")),
		import(moduleUrl("flow/types.js")),
		import(moduleUrl("flow/validator.js")),
	]);
	const pi = piFacade(runtime);
	const flowCommand = extension.commands.get("flow")?.handler;
	if (!flowCommand) throw new Error("Loaded extension did not register /flow.");

	async function settleAndResetWorkspaceFlow() {
		// Report bind is fire-and-forget; drain before deleting HTML so register sees a real file.
		await reportClient.waitForReportClientIdle();
		resetWorkspaceFlow(workspace);
	}

	async function runCycle(index) {
		const generation = await runGenerationCancellation(index);
		const serial = await runExecution(index, index % 2 === 0);
		const parallel = await runParallelExecution(index, index % 2 === 0);
		harness.releaseEntries();
		return { generation, serial, parallel, parallelWorkers: 2 };
	}

	async function runGenerationCancellation(index) {
		resetWorkspaceFlow(workspace);
		const ctx = harness.newRootContext(`generation-${index}`);
		await harness.emit("session_start", { reason: "new" }, ctx);
		await flowCommand(`benchmark generation ${index}`, ctx);
		await flowCommand("stop F1", ctx);
		await harness.emit("agent_end", { messages: [] }, ctx);
		await harness.shutdown(ctx);
		const dir = join(workspace, ".flow", "F1");
		const lifecycle = generationCancellationLifecycle(
			validatedFlow(dir),
			generationState.readAlignmentState(dir),
		);
		await settleAndResetWorkspaceFlow();
		return lifecycle;
	}

	async function runExecution(index, stop) {
		resetWorkspaceFlow(workspace);
		const dir = writeFlowFixture(
			workspace,
			2,
			"F1",
			flowTypes.FLOW_SCHEMA_VERSION,
		);
		const planningCtx = harness.newRootContext(`planning-${index}`);
		await harness.emit("session_start", { reason: "new" }, planningCtx);
		await flowCommand("go F1", planningCtx);
		let goalCtx = harness.currentContext();
		if (!goalCtx || goalCtx === planningCtx)
			throw new Error("Flow did not switch to its first Goal Session.");
		if (stop) await flowCommand("stop F1", goalCtx);
		else {
			await completeGoal(dir, goalCtx);
			goalCtx = harness.currentContext();
			await completeGoal(dir, goalCtx);
		}
		const stopEvidence = stop
			? {
					completionBoundary: goalCtx.sessionManager
						.getBranch()
						.some(
							(entry) =>
								entry.customType === "pi-flow-goal-completion-boundary" &&
								entry.data?.reason === "stop",
						),
					runtimeGoalStatus: getGoalState(goalCtx)?.status,
				}
			: undefined;
		await harness.shutdown(goalCtx);
		const lifecycle = serialExecutionLifecycle(
			validatedFlow(dir),
			stop,
			stopEvidence,
		);
		await settleAndResetWorkspaceFlow();
		return lifecycle;
	}

	async function runParallelExecution(index, stop) {
		resetWorkspaceFlow(workspace);
		const dir = writeParallelFlowFixture(
			workspace,
			"F1",
			flowTypes.FLOW_SCHEMA_VERSION,
		);
		const batchIndices = [1, 2];
		const markers = batchIndices.map((goalIndex) =>
			join(workspace, `benchmark-worker-${goalIndex}.started`),
		);
		for (const marker of markers) rmSync(marker, { force: true });
		const previousMode = process.env.PI_FLOW_BENCH_WORKER_MODE;
		process.env.PI_FLOW_BENCH_WORKER_MODE = stop ? "hang" : "complete";
		const planningCtx = harness.newRootContext(`parallel-${index}`);
		const mountsBefore = harness.laneWidgets.mounts;
		const clearsBefore = harness.laneWidgets.clears;
		let consoleCtx;
		let running;
		try {
			await harness.emit("session_start", { reason: "new" }, planningCtx);
			running = flowCommand("go F1", planningCtx);
			try {
				await waitForFiles(markers, 10_000);
			} catch (error) {
				throw new Error(
					`${errorMessage(error)}\nboards=${laneUi.activeParallelLaneBoardCount()}\n${readFileSync(join(dir, "flow.json"), "utf8")}\n${harness.notifications.slice(-5).join("\n")}`,
				);
			}
			consoleCtx = harness.currentContext();
			if (!consoleCtx || consoleCtx === planningCtx)
				throw new Error("Parallel Flow did not open its console Session.");
			if (laneUi.activeParallelLaneBoardCount() !== 1)
				throw new Error("Parallel lane board was not mounted.");
			if (stop) {
				const liveWatchers = watcher.flowGoalWatcherResourceSnapshot();
				if (
					liveWatchers.flows !== 1 ||
					liveWatchers.osWatchers !== 1 ||
					liveWatchers.watchedFiles !== 6 ||
					liveWatchers.registrations !== 8
				)
					throw new Error(
						`Parallel watcher multiplexing failed: ${JSON.stringify(liveWatchers)}`,
					);
				await flowCommand("stop F1", consoleCtx);
			}
			await running;
			const settledWatchers = watcher.flowGoalWatcherResourceSnapshot();
			if (Object.values(settledWatchers).some((count) => count !== 0))
				throw new Error(
					`Settled parallel watchers remained active: ${JSON.stringify(settledWatchers)}`,
				);
			if (laneUi.activeParallelLaneBoardCount() !== 0)
				throw new Error("Settled parallel lane board remained active.");
			if (
				harness.laneWidgets.mounts - mountsBefore !== 1 ||
				harness.laneWidgets.clears - clearsBefore !== 1
			)
				throw new Error(
					"Parallel lane board was not mounted and cleared once.",
				);
			await harness.shutdown(consoleCtx);
			return parallelExecutionLifecycle(validatedFlow(dir), stop, batchIndices);
		} finally {
			consoleCtx ??= harness.currentContext();
			if (
				laneUi.activeParallelLaneBoardCount() !== 0 &&
				consoleCtx &&
				consoleCtx !== planningCtx
			)
				await flowCommand("stop F1", consoleCtx).catch(() => undefined);
			await running?.catch(() => undefined);
			if (previousMode === undefined)
				delete process.env.PI_FLOW_BENCH_WORKER_MODE;
			else process.env.PI_FLOW_BENCH_WORKER_MODE = previousMode;
			for (const marker of markers) rmSync(marker, { force: true });
			await settleAndResetWorkspaceFlow();
		}
	}

	async function completeGoal(dir, ctx) {
		const goal = getGoalState(ctx);
		if (!goal)
			throw new Error(
				`Goal runtime was not active: ${readFileSync(join(dir, "flow.json"), "utf8")}\n${harness.notifications.join("\n")}`,
			);
		const before = validatedFlow(dir);
		const completedGoalIndex = before.currentGoal;
		await handleGoalCompletionEnd(pi, ctx, {
			goalId: goal.id,
			summary: "benchmark complete",
			acceptance: "passed",
			sessionFile: ctx.sessionManager.getSessionFile(),
		});
		await waitForSessionTransitions();
		const flow = validatedFlow(dir);
		if (flow.goals[completedGoalIndex]?.status !== "complete")
			throw new Error(
				`Serial Goal ${completedGoalIndex + 1} did not complete.`,
			);
		if (completedGoalIndex === before.goals.length - 1)
			serialExecutionLifecycle(flow, false);
		else if (
			flow.status !== "running" ||
			flow.currentGoal !== completedGoalIndex + 1
		)
			throw new Error("Serial Flow completion did not advance exactly once.");
	}

	function validatedFlow(dir) {
		const validation = flowValidator.validateFlowDir(dir, "zh");
		if (!validation.ok || !validation.flow)
			throw new Error(
				`Benchmark Flow validation failed: ${validation.errors.join("; ")}`,
			);
		return validation.flow;
	}

	function resourceSnapshot() {
		return {
			flow: flowRuntimeModule.flowRuntimeResourceCounts(),
			generation: generation.flowGenerationResourceCounts(),
			goalSessions: goalRuntime.goalRuntimeState.sessions.size,
			flowWatchers: watcher.flowGoalWatcherCount(),
			flowWatcherResources: watcher.flowGoalWatcherResourceSnapshot(),
			parallelBoards: laneUi.activeParallelLaneBoardCount(),
			laneWidgets: { ...harness.laneWidgets },
			report: reportClient.reportClientResourceSnapshot(),
			active: activeResourceCounts(),
		};
	}

	let closePromise;
	return {
		runCycle,
		resourceSnapshot,
		contextRefs: harness.contextRefs,
		waitForReportIdle: reportClient.waitForReportClientIdle,
		close() {
			closePromise ??= (async () => {
				watcher.closeFlowGoalWatcher();
				await reportClient.closeReportClient();
				await stopReportDaemon(join(agentDir, "pi-flow-report"));
				if (previousAgentDir === undefined)
					delete process.env.PI_CODING_AGENT_DIR;
				else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			})();
			return closePromise;
		},
	};
}

/** soak 独占的临时 daemon：SIGTERM 后等 endpoint 删除（daemon close 完成凭证），禁止只发信号就返回。 */
async function stopReportDaemon(runtimeDir) {
	const endpointPath = join(runtimeDir, "endpoint.json");
	let pid;
	try {
		pid = JSON.parse(readFileSync(endpointPath, "utf8")).pid;
	} catch {
		return;
	}
	if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid)
		throw new Error(`invalid report daemon pid in ${endpointPath}`);
	try {
		process.kill(pid, "SIGTERM");
	} catch (error) {
		if (error?.code !== "ESRCH") throw error;
		// 进程已死：仍须确认 endpoint 不在，否则所有权未收口
		if (!existsSync(endpointPath)) return;
	}
	if (!existsSync(endpointPath)) return;
	await new Promise((resolve, reject) => {
		const watcher = watch(dirname(endpointPath), () => {
			if (existsSync(endpointPath)) return;
			finish();
		});
		const timeout = setTimeout(() => {
			finish(
				new Error(
					`report daemon ${pid} did not release endpoint ${endpointPath}`,
				),
			);
		}, 5_000);
		const finish = (error) => {
			clearTimeout(timeout);
			watcher.close();
			if (error) reject(error);
			else resolve();
		};
		if (!existsSync(endpointPath)) finish();
	});
}

function createSessionHarness(extension, runtime, cwd) {
	const entries = new Map();
	const contextRefs = [];
	const notifications = [];
	const laneWidgets = { active: 0, mounts: 0, clears: 0 };
	let current;
	let sequence = 0;

	const entryList = (sessionFile) => {
		if (!entries.has(sessionFile)) entries.set(sessionFile, []);
		return entries.get(sessionFile);
	};
	const emit = async (name, event, ctx) => {
		current = ctx;
		for (const handler of extension.handlers.get(name) ?? [])
			await handler(event, ctx);
	};
	const shutdown = async (ctx) => {
		if (!ctx || ctx.__shutdown) return;
		ctx.__shutdown = true;
		await emit("session_shutdown", {}, ctx);
		contextRefs.push(new WeakRef(ctx));
		if (current === ctx) current = undefined;
	};
	const makeContext = (label) => {
		const sessionFile = join(cwd, `${label}-${++sequence}.jsonl`);
		writeFileSync(sessionFile, "");
		const controller = new AbortController();
		const ctx = {
			cwd,
			hasUI: false,
			model: { provider: "benchmark", id: "current", contextWindow: 200_000 },
			modelRegistry: {
				find: (provider, id) => ({ provider, id, contextWindow: 200_000 }),
			},
			signal: controller.signal,
			ui: {
				...quietUi(),
				notify: (message) => notifications.push(String(message)),
				setWidget: (key, content) => {
					if (key !== "flow-parallel-lanes") return;
					if (content === undefined) {
						laneWidgets.active = 0;
						laneWidgets.clears += 1;
					} else {
						laneWidgets.active = 1;
						laneWidgets.mounts += 1;
					}
				},
			},
			isIdle: () => true,
			hasPendingMessages: () => false,
			waitForIdle: async () => undefined,
			abort: () => controller.abort(),
			sessionManager: {
				getSessionFile: () => sessionFile,
				getSessionDir: () => cwd,
				getBranch: () => entryList(sessionFile),
				getEntries: () => entryList(sessionFile),
				appendSessionInfo: () => undefined,
				appendCustomEntry: (customType, data) =>
					entryList(sessionFile).push({ type: "custom", customType, data }),
			},
			sendMessage: () => undefined,
			sendUserMessage: () => undefined,
			async newSession(options) {
				await shutdown(ctx);
				const next = makeContext("goal");
				current = next;
				await emit("session_start", { reason: "new" }, next);
				await options?.withSession?.(next);
				return { cancelled: false };
			},
			async switchSession(path, options) {
				await shutdown(ctx);
				const next = makeContext(`switch-${safeName(path)}`);
				current = next;
				await emit("session_start", { reason: "switch" }, next);
				await options?.withSession?.(next);
				return { cancelled: false };
			},
		};
		entryList(sessionFile);
		return ctx;
	};

	Object.assign(runtime, {
		sendMessage: () => undefined,
		sendUserMessage: () => undefined,
		appendEntry(customType, data) {
			const sessionFile = current?.sessionManager.getSessionFile();
			if (sessionFile)
				entryList(sessionFile).push({ type: "custom", customType, data });
		},
		setSessionName: () => undefined,
		getSessionName: () => undefined,
		setLabel: () => undefined,
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: () => undefined,
		getCommands: () => [...extension.commands.values()],
		setModel: async () => true,
		getThinkingLevel: () => "off",
		setThinkingLevel: () => undefined,
	});

	return {
		contextRefs,
		notifications,
		laneWidgets,
		emit,
		shutdown,
		newRootContext(label) {
			const ctx = makeContext(label);
			current = ctx;
			return ctx;
		},
		currentContext: () => current,
		releaseEntries() {
			entries.clear();
			current = undefined;
		},
	};
}

function piFacade(runtime) {
	return {
		sendMessage: (...args) => runtime.sendMessage(...args),
		sendUserMessage: (...args) => runtime.sendUserMessage(...args),
		setModel: (...args) => runtime.setModel(...args),
		setThinkingLevel: (...args) => runtime.setThinkingLevel(...args),
		getThinkingLevel: () => runtime.getThinkingLevel(),
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	};
}

function soakResult(
	samples,
	warmupCycles,
	contextRefs,
	closedResources,
	baselineActiveResources,
) {
	return evaluateSoakResult(
		samples,
		warmupCycles,
		{
			weakRefs: contextRefs.length,
			aliveAfterGc: aliveRefs(contextRefs),
		},
		closedResources,
		baselineActiveResources,
	);
}

export function evaluateSoakResult(
	samples,
	warmupCycles,
	contexts,
	closedResources,
	baselineActiveResources = {},
) {
	const first = samples.slice(0, 20);
	const last = samples.slice(-20);
	const firstHeapMedian = median(first.map((sample) => sample.heapUsed));
	const lastHeapMedian = median(last.map((sample) => sample.heapUsed));
	const heapGrowthBytes = lastHeapMedian - firstHeapMedian;
	const resourceFailures = samples.flatMap((sample) =>
		terminalResourceFailures(
			sample.resources,
			baselineActiveResources,
			false,
		).map((failure) => `cycle ${sample.cycle}: ${failure}`),
	);
	if (samples.length === 0) resourceFailures.push("soak produced no samples");
	if (contexts.aliveAfterGc !== 0)
		resourceFailures.push(
			`${contexts.aliveAfterGc} Session contexts survived GC`,
		);
	if (closedResources)
		resourceFailures.push(
			...terminalResourceFailures(
				closedResources,
				baselineActiveResources,
				true,
			).map((failure) => `after close: ${failure}`),
		);
	else resourceFailures.push("post-close resource snapshot is missing");
	const generationCancellations = samples.filter(
		(sample) => sample.lifecycle?.generation === "cancelled",
	).length;
	if (generationCancellations !== samples.length)
		resourceFailures.push("generation cancellation coverage is incomplete");
	const serialLifecycles = lifecycleCounts(samples, "serial");
	checkLifecycleCoverage(
		"serial",
		serialLifecycles,
		samples.length,
		resourceFailures,
	);
	const parallelLifecycles = lifecycleCounts(samples, "parallel");
	checkLifecycleCoverage(
		"parallel",
		parallelLifecycles,
		samples.length,
		resourceFailures,
	);
	if (samples.some((sample) => sample.lifecycle?.parallelWorkers !== 2))
		resourceFailures.push("parallel lifecycle did not start two workers");
	const ok = heapGrowthBytes <= 5 * mebibyte && resourceFailures.length === 0;
	return {
		mode: "soak",
		ok,
		cycles: samples.length,
		warmupCycles,
		thresholds: {
			maxHeapGrowthBytes: 5 * mebibyte,
			maxAliveContexts: 0,
		},
		heapUsed: {
			first20Median: firstHeapMedian,
			last20Median: lastHeapMedian,
			growthBytes: heapGrowthBytes,
		},
		rss: {
			first20Median: median(first.map((sample) => sample.rss)),
			last20Median: median(last.map((sample) => sample.rss)),
			gated: false,
		},
		contexts,
		generationCancellations,
		serialLifecycles,
		parallelLifecycles,
		baselineActiveResources,
		closedResources,
		resourceFailures,
		samples: samples.map((sample, index) => {
			const window = samples.slice(Math.max(0, index - 19), index + 1);
			return {
				...sample,
				rollingHeapMedian: median(window.map((item) => item.heapUsed)),
				rollingRssMedian: median(window.map((item) => item.rss)),
			};
		}),
	};
}

export function generationCancellationLifecycle(flow, alignment) {
	if (
		flow?.status !== "paused" ||
		!Array.isArray(flow.goals) ||
		flow.goals.length !== 0 ||
		flow.currentGoal !== 0 ||
		flow.parallelRun !== null ||
		alignment?.version !== 1
	)
		throw new Error(
			`Generation cancellation did not settle as pre-draft: status=${String(flow?.status)}, goals=${String(flow?.goals?.length)}, currentGoal=${String(flow?.currentGoal)}, parallel=${String(flow?.parallelRun !== null)}, alignment=${String(alignment?.version)}`,
		);
	return "cancelled";
}

export function serialExecutionLifecycle(flow, stop, stopEvidence) {
	if (stop) {
		const currentGoal = flow?.goals?.[flow.currentGoal];
		if (
			flow?.status !== "paused" ||
			currentGoal?.status !== "running" ||
			stopEvidence?.runtimeGoalStatus !== "paused" ||
			stopEvidence.completionBoundary !== true
		)
			throw new Error(
				`Serial stop did not settle: status=${String(flow?.status)}, canonicalGoal=${String(currentGoal?.status)}, runtimeGoal=${String(stopEvidence?.runtimeGoalStatus)}, boundary=${String(stopEvidence?.completionBoundary)}`,
			);
		return "stopped";
	}
	if (
		flow?.status !== "complete" ||
		!Array.isArray(flow.goals) ||
		flow.goals.length === 0 ||
		flow.goals.some((goal) => goal.status !== "complete")
	)
		throw new Error("Serial completion did not complete every Goal.");
	return "completed";
}

export function parallelExecutionLifecycle(flow, stop, goalIndexes) {
	if (stop) {
		const runIndexes = flow?.parallelRun?.goalIndexes;
		if (
			flow?.status !== "paused" ||
			!Array.isArray(runIndexes) ||
			runIndexes.length !== goalIndexes.length ||
			runIndexes.some((goalIndex, index) => goalIndex !== goalIndexes[index]) ||
			goalIndexes.some(
				(goalIndex) => flow.goals?.[goalIndex]?.status !== "paused",
			)
		)
			throw new Error("Parallel stop did not pause its active Goals.");
		return "stopped";
	}
	if (
		flow?.status !== "complete" ||
		flow.parallelRun !== null ||
		!Array.isArray(flow.goals) ||
		flow.goals.length === 0 ||
		flow.goals.some((goal) => goal.status !== "complete")
	)
		throw new Error("Parallel completion did not complete every Goal.");
	return "completed";
}

function lifecycleCounts(samples, name) {
	return {
		completed: samples.filter(
			(sample) => sample.lifecycle?.[name] === "completed",
		).length,
		stopped: samples.filter((sample) => sample.lifecycle?.[name] === "stopped")
			.length,
	};
}

function checkLifecycleCoverage(name, counts, sampleCount, failures) {
	if (counts.completed + counts.stopped !== sampleCount)
		failures.push(`${name} lifecycle coverage is incomplete`);
	if (sampleCount > 0 && (counts.completed === 0 || counts.stopped === 0))
		failures.push(`${name} lifecycle coverage requires completed and stopped`);
}

function terminalResourceFailures(resources, baselineActiveResources, closed) {
	const failures = reportClientFailures(resources.report, closed);
	if (resources.flow.contexts !== 0)
		failures.push(`${resources.flow.contexts} Flow contexts active`);
	if (resources.flow.completionFacts !== 0)
		failures.push(`${resources.flow.completionFacts} completion facts active`);
	for (const [name, count] of Object.entries(resources.generation))
		if (count !== 0) failures.push(`${count} generation ${name} active`);
	if (resources.goalSessions !== 0)
		failures.push(`${resources.goalSessions} Goal sessions active`);
	if (resources.flowWatchers !== 0)
		failures.push(`${resources.flowWatchers} Flow watchers active`);
	for (const [name, count] of Object.entries(resources.flowWatcherResources))
		if (count !== 0) failures.push(`${count} Flow watcher ${name} active`);
	if (resources.parallelBoards !== 0)
		failures.push(`${resources.parallelBoards} parallel boards active`);
	if (resources.laneWidgets.active !== 0)
		failures.push(`${resources.laneWidgets.active} lane widgets active`);
	for (const [name, count] of Object.entries(resources.active)) {
		const retained = count - (baselineActiveResources[name] ?? 0);
		if (retained > 0)
			failures.push(`${retained} ${name} resources active above baseline`);
	}
	return failures;
}

function reportClientFailures(report, closed) {
	if (!report) return ["report client diagnostics are missing"];
	const failures = [];
	if (report.backgroundTasks !== 0)
		failures.push(`${report.backgroundTasks} report background tasks active`);
	if (report.connecting) failures.push("report client is still connecting");
	if (report.failureCount !== 0)
		failures.push(`report client failed ${report.failureCount} times`);
	if (report.statusContext)
		failures.push("report status context is still active");
	if (!closed) {
		if (!report.connected) failures.push("report client is not connected");
		if (report.registeredReports < 1)
			failures.push("report client has no registered report");
		if (report.requestDestroyed || report.responseDestroyed)
			failures.push("live report control connection was destroyed");
		return failures;
	}
	if (report.connected) failures.push("report client is still connected");
	if (report.registeredReports !== 0)
		failures.push(`${report.registeredReports} reports still registered`);
	if (report.registerChains !== 0)
		failures.push(`${report.registerChains} register chains still retained`);
	if (
		!report.lastClosedConnection?.requestDestroyed ||
		!report.lastClosedConnection?.responseDestroyed
	)
		failures.push("report control connection was not destroyed");
	return failures;
}

async function runReport(modeArgs) {
	const updates = integerOption(modeArgs, "updates", 100, 10);
	const temp = mkdtempSync(join(tmpdir(), "pi-flow-report-bench-"));
	const require = createRequire(import.meta.url);
	const fs = require("node:fs");
	const originalWrite = fs.writeFileSync;
	const reportWrites = new Map();
	try {
		const pluginRoot = isolatedPlugin(temp);
		const workspace = join(temp, "workspace");
		fs.writeFileSync = (...writeArgs) => {
			const path = String(writeArgs[0]);
			if (
				path.endsWith(`${sep}flow.html`) &&
				path.includes(`${sep}.flow${sep}`)
			)
				reportWrites.set(path, (reportWrites.get(path) ?? 0) + 1);
			return originalWrite(...writeArgs);
		};
		syncBuiltinESMExports();
		const moduleUrl = (path) =>
			pathToFileURL(join(pluginRoot, "dist", path)).href;
		const [{ writeFlowHtml }, { readFlow }, watcher, flowTypes] =
			await Promise.all([
				import(moduleUrl("flow/html.js")),
				import(moduleUrl("flow/store.js")),
				import(moduleUrl("flow/watcher.js")),
				import(moduleUrl("flow/types.js")),
			]);
		const startedAt = performance.now();
		const serial = await benchmarkSerialReport({
			workspace,
			schemaVersion: flowTypes.FLOW_SCHEMA_VERSION,
			updates,
			originalWrite,
			readFlow,
			reportWrites,
			watcher,
			writeFlowHtml,
		});
		const parallel = await benchmarkParallelReport({
			workspace,
			schemaVersion: flowTypes.FLOW_SCHEMA_VERSION,
			updates,
			originalWrite,
			readFlow,
			reportWrites,
			watcher,
			writeFlowHtml,
		});
		const independent = await benchmarkIndependentReports({
			workspace,
			schemaVersion: flowTypes.FLOW_SCHEMA_VERSION,
			updates,
			originalWrite,
			readFlow,
			watcher,
			writeFlowHtml,
		});
		watcher.closeFlowGoalWatcher();
		const closedWatchers = watcher.flowGoalWatcherResourceSnapshot();
		const ok =
			serial.watcher.osWatchers === 1 &&
			serial.watcher.watchedFiles === 1 &&
			serial.burst.fullRenders <= 2 &&
			serial.burst.finalVisible &&
			serial.sustained.withinFrameRate &&
			serial.sustained.finalVisible &&
			parallel.watcher.osWatchers === 1 &&
			parallel.watcher.watchedFiles === 6 &&
			parallel.fullRenders <= 2 &&
			parallel.finalVisible &&
			parallel.terminalStable &&
			parallel.sameContentSkipped &&
			independent.every(
				(flow) =>
					flow.watcher.osWatchers === 1 &&
					flow.watcher.watchedFiles === 1 &&
					flow.fullRenders <= 2 &&
					flow.finalVisible,
			) &&
			Object.values(closedWatchers).every((count) => count === 0);
		if (!ok) process.exitCode = 1;
		return {
			mode: "report",
			ok,
			updates,
			serial,
			parallel,
			independent,
			closedWatchers,
			elapsedMs: round(performance.now() - startedAt),
		};
	} finally {
		fs.writeFileSync = originalWrite;
		syncBuiltinESMExports();
		rmSync(temp, { recursive: true, force: true });
	}
}

async function benchmarkSerialReport(input) {
	const dir = writeFlowFixture(input.workspace, 1, "F1", input.schemaVersion);
	setFlowRunning(dir, [0]);
	const flow = input.readFlow(dir);
	const htmlPath = input.writeFlowHtml(dir, flow);
	const initialWrites = input.reportWrites.get(htmlPath) ?? 0;
	input.watcher.watchCurrentFlowGoal(dir, flow);
	await waitForReportQuiet(input.watcher, dir);
	const initialStats = input.watcher.flowGoalWatcherStats(dir);
	const goalPath = join(dir, "G1-goal.md");
	const base = readFileSync(goalPath, "utf8");
	for (let index = 0; index < input.updates; index += 1) {
		atomicReplace(
			goalPath,
			base.replace("Complete lifecycle.", `Burst canonical ${index}.`),
			input.originalWrite,
		);
	}
	await waitForReportQuiet(input.watcher, dir);
	const burstStats = input.watcher.flowGoalWatcherStats(dir);
	const burstRefreshes = burstStats.refreshes - initialStats.refreshes;
	const burstWrites = (input.reportWrites.get(htmlPath) ?? 0) - initialWrites;
	const burstHtml = readFileSync(htmlPath, "utf8");

	const sustainedStartRefreshes = burstRefreshes;
	const sustainedStartedAt = performance.now();
	for (let index = 0; index < 20; index += 1) {
		atomicReplace(
			goalPath,
			base.replace("Complete lifecycle.", `Sustained canonical ${index}.`),
			input.originalWrite,
		);
		await wait(5);
	}
	const sustainedElapsedMs = performance.now() - sustainedStartedAt;
	await waitForReportQuiet(input.watcher, dir);
	const sustainedStats = input.watcher.flowGoalWatcherStats(dir);
	const sustainedRefreshes = sustainedStats.refreshes - sustainedStartRefreshes;
	input.watcher.closeFlowGoalWatcher(dir);
	return {
		watcher: {
			osWatchers: sustainedStats.osWatchers,
			watchedFiles: sustainedStats.watchedFiles,
		},
		burst: {
			sourceUpdates: input.updates,
			watcherSignals: burstStats.signals - initialStats.signals,
			fullRenders: burstRefreshes,
			actualWrites: burstWrites,
			finalVisible: burstHtml.includes(`Burst canonical ${input.updates - 1}.`),
			finalHash: sha256(burstHtml),
		},
		sustained: {
			sourceUpdates: 20,
			watcherSignals: sustainedStats.signals - burstStats.signals,
			fullRenders: sustainedRefreshes,
			elapsedMs: round(sustainedElapsedMs),
			withinFrameRate:
				sustainedRefreshes <= Math.ceil(sustainedElapsedMs / 25) + 2,
			finalVisible: readFileSync(htmlPath, "utf8").includes(
				"Sustained canonical 19.",
			),
			finalHash: sha256(readFileSync(htmlPath, "utf8")),
		},
	};
}

async function benchmarkParallelReport(input) {
	const dir = writeParallelFlowFixture(
		input.workspace,
		"F2",
		input.schemaVersion,
	);
	const runId = "report-benchmark-run";
	setParallelFlowRunning(dir, runId);
	let flow = input.readFlow(dir);
	const htmlPath = input.writeFlowHtml(dir, flow);
	input.watcher.watchParallelBatch(dir, flow, [1, 2]);
	await waitForReportQuiet(input.watcher, dir);
	const initialStats = input.watcher.flowGoalWatcherStats(dir);
	const initialWrites = input.reportWrites.get(htmlPath) ?? 0;
	const goalPath = join(dir, "G2-goal.md");
	const base = readFileSync(goalPath, "utf8");
	for (let index = 0; index < input.updates; index += 1) {
		atomicReplace(
			goalPath,
			base.replace("Complete lifecycle.", `Parallel canonical ${index}.`),
			input.originalWrite,
		);
		writeReportWorkerArtifact(dir, flow, 1, runId, index);
		atomicReplace(
			join(dir, "G2-worker-events.json"),
			`${JSON.stringify([{ marker: index }])}\n`,
			input.originalWrite,
		);
	}
	await waitForReportQuiet(input.watcher, dir);
	const liveStats = input.watcher.flowGoalWatcherStats(dir);
	const fullRenders = liveStats.refreshes - initialStats.refreshes;
	const actualWrites = (input.reportWrites.get(htmlPath) ?? 0) - initialWrites;
	const liveHtml = readFileSync(htmlPath, "utf8");
	const writesBeforeSame = input.reportWrites.get(htmlPath) ?? 0;
	atomicReplace(
		join(dir, "G2-worker-events.json"),
		`${JSON.stringify([{ marker: input.updates - 1 }])}\n`,
		input.originalWrite,
	);
	await waitForReportQuiet(input.watcher, dir);
	const sameContentSkipped =
		(input.reportWrites.get(htmlPath) ?? 0) === writesBeforeSame;

	atomicReplace(
		goalPath,
		base.replace("Complete lifecycle.", "Late parallel refresh."),
		input.originalWrite,
	);
	await waitForReportPending(input.watcher, dir);
	const pendingBeforeClose = true;
	flow = input.readFlow(dir);
	flow.status = "complete";
	flow.parallelRun = null;
	for (const goal of flow.goals) goal.status = "complete";
	input.originalWrite(
		join(dir, "flow.json"),
		`${JSON.stringify(flow, null, 2)}\n`,
	);
	input.watcher.closeFlowGoalWatcher(dir);
	input.writeFlowHtml(dir, flow);
	const terminalHash = sha256(readFileSync(htmlPath, "utf8"));
	await wait(60);
	return {
		watcher: {
			osWatchers: liveStats.osWatchers,
			watchedFiles: liveStats.watchedFiles,
		},
		sourceUpdates: input.updates * 3,
		watcherSignals: liveStats.signals - initialStats.signals,
		fullRenders,
		actualWrites,
		finalVisible:
			liveHtml.includes(`Parallel canonical ${input.updates - 1}.`) &&
			liveHtml.includes(`Worker artifact ${input.updates - 1}`),
		finalHash: sha256(liveHtml),
		sameContentSkipped,
		pendingBeforeClose,
		terminalStable:
			pendingBeforeClose &&
			terminalHash === sha256(readFileSync(htmlPath, "utf8")),
		terminalHash,
	};
}

async function benchmarkIndependentReports(input) {
	const flows = ["F3", "F4"].map((id) => {
		const dir = writeFlowFixture(input.workspace, 1, id, input.schemaVersion);
		setFlowRunning(dir, [0]);
		const flow = input.readFlow(dir);
		input.writeFlowHtml(dir, flow);
		input.watcher.watchCurrentFlowGoal(dir, flow);
		return { dir, goalPath: join(dir, "G1-goal.md") };
	});
	await Promise.all(
		flows.map((flow) => waitForReportQuiet(input.watcher, flow.dir)),
	);
	for (const flow of flows) {
		flow.initialRefreshes = input.watcher.flowGoalWatcherStats(
			flow.dir,
		).refreshes;
	}
	for (let index = 0; index < input.updates; index += 1) {
		for (const [flowIndex, flow] of flows.entries()) {
			atomicReplace(
				flow.goalPath,
				goalMarkdown(1).replace(
					"Complete lifecycle.",
					`Independent ${flowIndex}-${index}.`,
				),
				input.originalWrite,
			);
		}
	}
	await Promise.all(
		flows.map((flow) => waitForReportQuiet(input.watcher, flow.dir)),
	);
	return flows.map((flow, flowIndex) => {
		const html = readFileSync(join(flow.dir, "flow.html"), "utf8");
		const stats = input.watcher.flowGoalWatcherStats(flow.dir);
		const fullRenders = stats.refreshes - flow.initialRefreshes;
		input.watcher.closeFlowGoalWatcher(flow.dir);
		return {
			id: `F${flowIndex + 3}`,
			watcher: {
				osWatchers: stats.osWatchers,
				watchedFiles: stats.watchedFiles,
			},
			fullRenders,
			finalVisible: html.includes(
				`Independent ${flowIndex}-${input.updates - 1}.`,
			),
			finalHash: sha256(html),
		};
	});
}

async function waitForReportPending(watcher, dir) {
	const startedAt = performance.now();
	while (performance.now() - startedAt < 1000) {
		if (watcher.flowGoalWatcherStats(dir)?.pending) return;
		await wait(1);
	}
	throw new Error(`Report frame was not scheduled: ${dir}`);
}

async function waitForReportQuiet(watcher, dir) {
	await waitForQuiet(
		() => watcher.flowGoalWatcherStats(dir)?.refreshes ?? 0,
		60,
		2000,
	);
	const stats = watcher.flowGoalWatcherStats(dir);
	if (!stats || stats.pending)
		throw new Error(`Report frame did not settle: ${dir}`);
}

function setFlowRunning(dir, goalIndexes) {
	const path = join(dir, "flow.json");
	const flow = JSON.parse(readFileSync(path, "utf8"));
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = Math.min(...goalIndexes);
	for (const goalIndex of goalIndexes) flow.goals[goalIndex].status = "running";
	writeFileSync(path, `${JSON.stringify(flow, null, 2)}\n`);
}

function setParallelFlowRunning(dir, runId) {
	setFlowRunning(dir, [1, 2]);
	const path = join(dir, "flow.json");
	const flow = JSON.parse(readFileSync(path, "utf8"));
	flow.parallelRun = {
		id: runId,
		goalIndexes: [1, 2],
		startedAt: Date.now(),
		consoleSessionFile: "report-console.jsonl",
		consoleSessionName: "Report benchmark console",
	};
	writeFileSync(path, `${JSON.stringify(flow, null, 2)}\n`);
}

function writeReportWorkerArtifact(dir, flow, goalIndex, runId, marker) {
	const goal = flow.goals[goalIndex];
	atomicReplace(
		join(dir, `G${goalIndex + 1}-worker.json`),
		`${JSON.stringify(
			{
				schemaVersion: 3,
				flowId: flow.id,
				goalIndex,
				goalTitle: goal.title,
				goalFile: goal.file,
				parallelRunId: runId,
				status: "running",
				completionCursor: null,
				runtimeGoalId: null,
				sessionFile: null,
				sessionName: null,
				result: { summary: null, outcome: null },
				checks: {
					acceptance: {
						enabled: true,
						rounds: [
							{
								round: 1,
								result: "failed",
								summary: `Worker artifact ${marker}`,
							},
						],
						active: null,
					},
					quality: { enabled: false, rounds: [], active: null },
				},
				handoff: null,
				completion: null,
				updatedAt: Date.now(),
			},
			null,
			2,
		)}\n`,
	);
}

function atomicReplace(path, content, write = writeFileSync) {
	const temporaryPath = `${path}.report-benchmark.tmp`;
	write(temporaryPath, content);
	renameSync(temporaryPath, path);
}

function sha256(content) {
	return createHash("sha256").update(content).digest("hex");
}

function writeBenchmarkWorker(temp) {
	const command = join(temp, "benchmark-worker.mjs");
	writeFileSync(
		command,
		`#!/usr/bin/env node
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

const goalIndex = Number(process.env.PI_FLOW_WORKER_GOAL_INDEX);
const flowDir = process.env.PI_FLOW_WORKER_FLOW_DIR;
const parallelRunId = process.env.PI_FLOW_WORKER_PARALLEL_RUN_ID;
const sessionFile = process.env.PI_FLOW_WORKER_SESSION_PATH;
const socketPath = process.env.PI_FLOW_WORKER_SOCKET_PATH;
const token = process.env.PI_FLOW_WORKER_TOKEN;
if (!flowDir || !parallelRunId || !sessionFile || !socketPath || !token)
	throw new Error("Incomplete benchmark worker environment.");

const socket = connect(socketPath);
await new Promise((resolve, reject) => {
	let buffer = "";
	const fail = (error) => reject(error);
	socket.once("error", fail);
	socket.once("connect", () =>
		socket.write(JSON.stringify({ type: "hello", token }) + "\\n"),
	);
	socket.on("data", (chunk) => {
		buffer += chunk;
		if (!buffer.includes("\\n")) return;
		socket.off("error", fail);
		resolve();
	});
});
socket.on("error", () => undefined);
writeFileSync(
	join(process.cwd(), "benchmark-worker-" + goalIndex + ".started"),
	"",
);
console.log(JSON.stringify({ type: "agent_start", goalIndex }));

if (process.env.PI_FLOW_BENCH_WORKER_MODE === "hang") {
	await new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		process.once("SIGTERM", finish);
		process.once("SIGINT", finish);
		socket.once("close", finish);
	});
	socket.destroy();
} else {
	await new Promise((resolve) => setTimeout(resolve, 50));
	const artifactPath = join(flowDir, "G" + (goalIndex + 1) + "-worker.json");
	const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
	const completion = {
		goalId: "benchmark-worker-" + goalIndex,
		summary: "benchmark complete " + goalIndex,
		acceptance: "passed",
		sessionFile,
		parallelRunId,
	};
	const temporaryPath = artifactPath + ".benchmark-" + process.pid + ".tmp";
	writeFileSync(
		temporaryPath,
		JSON.stringify({
			...artifact,
			status: "complete",
			completionCursor: null,
			result: { summary: completion.summary, outcome: "passed" },
			handoff: null,
			completion,
			updatedAt: Date.now(),
		}, null, 2) + "\\n",
	);
	renameSync(temporaryPath, artifactPath);
	console.log(JSON.stringify({ type: "agent_end", messages: [] }));
	socket.destroy();
}
`,
	);
	chmodSync(command, 0o755);
	return command;
}

function isolatedPlugin(temp, runnerCommand) {
	const pluginRoot = join(temp, "plugin");
	cpSync(join(root, "dist"), join(pluginRoot, "dist"), { recursive: true });
	symlinkSync(
		join(root, "node_modules"),
		join(pluginRoot, "node_modules"),
		"dir",
	);
	cpSync(join(root, "prompts"), join(pluginRoot, "prompts"), {
		recursive: true,
	});
	mkdirSync(join(pluginRoot, "assets"), { recursive: true });
	cpSync(
		join(root, "assets", "logo.png"),
		join(pluginRoot, "assets", "logo.png"),
	);
	writeFileSync(
		join(pluginRoot, "config.json"),
		JSON.stringify({
			language: "zh",
			generation: { align: "no" },
			background: {
				command: runnerCommand ?? "pi",
				extensions: [],
			},
			checks: {
				tools: ["read"],
				timeoutMinutes: 0.5,
				openaiFast: false,
			},
			modelRoles: {
				advisor: "current",
				executor: "current",
				reviewers: [{ model: "benchmark/reviewer", thinking: "off" }],
			},
			acceptance: { enabled: false },
			quality: { enabled: false, mode: "autoFix", runAfterCompletion: false },
		}),
	);
	return pluginRoot;
}

function writeFlowFixture(workspace, goalCount, id, schemaVersion) {
	const dir = join(workspace, ".flow", id);
	mkdirSync(dir, { recursive: true });
	const goals = Array.from({ length: goalCount }, (_item, index) => {
		const file = `G${index + 1}-goal.md`;
		writeFileSync(join(dir, file), goalMarkdown(index + 1));
		return {
			index,
			title: `Goal ${index + 1}`,
			role: "normal",
			file,
			status: "pending",
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
			startedAt: null,
			completedAt: null,
			checks: emptyChecks(),
			pendingAdvisor: null,
		};
	});
	const now = Date.now();
	writeFileSync(
		join(dir, "flow.json"),
		`${JSON.stringify(
			{
				schemaVersion,
				language: "zh",
				id,
				title: "Performance benchmark",
				status: "draft",
				source: { type: "prompt", text: "benchmark" },
				createdAt: now,
				updatedAt: now,
				startedAt: null,
				completedAt: null,
				currentGoal: 0,
				meta: null,
				attention: null,
				parallelRun: null,
				repairAttempts: 0,
				errors: [],
				goals,
			},
			null,
			2,
		)}\n`,
	);
	return dir;
}

function writeParallelFlowFixture(workspace, id, schemaVersion) {
	const dir = writeFlowFixture(workspace, 3, id, schemaVersion);
	const flowPath = join(dir, "flow.json");
	const flow = JSON.parse(readFileSync(flowPath, "utf8"));
	flow.goals[0].status = "complete";
	for (const goalIndex of [1, 2]) {
		flow.goals[goalIndex].dependsOn = [0];
		flow.goals[goalIndex].writeScope = [`src/${goalIndex}/**`];
	}
	flow.updatedAt = Date.now();
	writeFileSync(flowPath, `${JSON.stringify(flow, null, 2)}\n`);
	return dir;
}

function emptyChecks() {
	return {
		acceptance: { enabled: false, rounds: [], active: null },
		quality: { enabled: false, rounds: [], active: null },
	};
}

function goalMarkdown(index) {
	return `# Goal ${index}\n\n## Objective\n\nComplete benchmark Goal ${index}.\n\n## Scope\n\n- Benchmark lifecycle only.\n\n## Steps\n\n- [ ] Complete lifecycle.\n\n## Success Criteria\n\n- Lifecycle completes.\n\n## Verification\n\n- [ ] Verify lifecycle.\n\n## Notes\n\n- None.\n\n## Handoff\n\n- Benchmark handoff.\n`;
}

function resetWorkspaceFlow(workspace) {
	rmSync(join(workspace, ".flow"), { recursive: true, force: true });
}

function quietUi() {
	return {
		confirm: async () => true,
		select: async (_title, options) => options[0],
		notify: () => undefined,
		setStatus: () => undefined,
		setWidget: () => undefined,
		setWorkingVisible: () => undefined,
	};
}

function activeResourceCounts() {
	const counts = {};
	for (const name of process.getActiveResourcesInfo?.() ?? [])
		counts[name] = (counts[name] ?? 0) + 1;
	return counts;
}

function forceGc() {
	global.gc();
	global.gc();
}

async function settleLifecycle() {
	await new Promise((resolve) => setImmediate(resolve));
	forceGc();
	await new Promise((resolve) => setImmediate(resolve));
	forceGc();
}

function aliveRefs(refs) {
	return refs.reduce((count, ref) => count + (ref.deref() ? 1 : 0), 0);
}

function seriesSummary(values) {
	return { samples: values, median: median(values) };
}

function median(values) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function integerOption(args, name, fallback, minimum) {
	const prefix = `--${name}=`;
	const inline = args
		.find((arg) => arg.startsWith(prefix))
		?.slice(prefix.length);
	const index = args.indexOf(`--${name}`);
	const raw = inline ?? (index >= 0 ? args[index + 1] : undefined);
	const value = raw === undefined ? fallback : Number(raw);
	if (!Number.isInteger(value) || value < minimum)
		throw new Error(`--${name} must be an integer >= ${minimum}.`);
	return value;
}

function waitForFiles(paths, timeoutMs) {
	return new Promise((resolveWait, reject) => {
		let watcher;
		const timeout = setTimeout(() => {
			watcher?.close();
			reject(new Error(`Worker start timeout: ${paths.join(", ")}`));
		}, timeoutMs);
		const finishIfReady = () => {
			if (!paths.every((path) => existsSync(path))) return;
			clearTimeout(timeout);
			watcher?.close();
			resolveWait();
		};
		watcher = watch(dirname(paths[0]), finishIfReady);
		finishIfReady();
	});
}

async function waitForQuiet(readCount, quietMs, timeoutMs) {
	const startedAt = performance.now();
	let count = readCount();
	let changedAt = performance.now();
	while (performance.now() - startedAt < timeoutMs) {
		await wait(10);
		const next = readCount();
		if (next !== count) {
			count = next;
			changedAt = performance.now();
		}
		if (count > 0 && performance.now() - changedAt >= quietMs) return;
	}
	throw new Error("Report watcher did not settle.");
}

function wait(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeName(path) {
	return String(path)
		.replace(/[^a-z0-9]+/giu, "-")
		.slice(-40);
}

function round(value) {
	return Math.round(value * 1000) / 1000;
}

function assertBuilt() {
	try {
		readFileSync(distIndex);
	} catch {
		throw new Error("dist/index.js is missing; run npm run build first.");
	}
}

function errorMessage(error) {
	return error instanceof Error
		? (error.stack ?? error.message)
		: String(error);
}
