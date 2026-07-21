import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const GRAPH_ARTIFACT_VERSION = 1;
export const GRAPH_ARMS = [
	"serial",
	"current-batch",
	"optimized-batch",
	"streaming",
];
const DECISIONS = new Set(["proceed", "expand", "stop"]);
const TERMINAL_OUTCOMES = new Set([
	"complete",
	"blocked",
	"missing_completion",
	"worker_error",
	"oracle_failed",
	"planning_failure",
]);
const WRITE_SCOPE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;
const SCHEDULE_EVENT_TYPES = new Set([
	"blocked",
	"completion",
	"deadlock",
	"exit",
	"infrastructure-failure",
	"launch",
	"planning-failure",
	"stale",
]);
const RETRYABLE_FAILURES = new Set([
	"network",
	"rate_limit",
	"process_start",
	"protocol",
	"planning_scope",
]);
const FAILURE_CLASSIFICATIONS = new Set([
	"none",
	"quality",
	"cancelled",
	...RETRYABLE_FAILURES,
]);
const SCORING_CONTRACT = {
	quality: "completion+acceptance+quality+oracle+scope",
	reliability:
		"first attempt only, complete ledger, and zero worker process/protocol errors",
	attribution: {
		optimized: "launch sequence differs from same-repetition current-batch",
		streaming: "launch while a prior worker remains active (completion-fill)",
	},
	positiveSpeedRatio: 0.95,
	negativeSpeedRatio: 1.05,
	baselineArms: ["serial", "current-batch"],
	candidateArms: ["optimized-batch", "streaming"],
};
const ARTIFACT_KEYS = new Set([
	"schemaVersion",
	"benchmarkIds",
	"benchmarkFingerprint",
	"evaluationConfigFingerprint",
	"modelFingerprint",
	"packetRuleFingerprint",
	"scorerFingerprint",
	"executorFingerprint",
	"schedulerFingerprint",
	"runsPerArm",
	"workerBudget",
	"decision",
	"directions",
	"benchmarks",
]);
const BENCHMARK_KEYS = new Set([
	"id",
	"fingerprint",
	"graph",
	"planFingerprint",
	"planning",
	"armOrder",
	"runs",
]);
const PLANNING_KEYS = new Set([
	"attempts",
	"cost",
	"calls",
	"tokens",
	"elapsedMs",
	"totalAttemptElapsedMs",
	"totalAttemptCost",
	"totalAttemptCalls",
	"totalAttemptTokens",
	"attemptMetricsComplete",
	"status",
]);
const RUN_KEYS = new Set([
	"arm",
	"repetition",
	"terminalOutcome",
	"attempts",
	"oracle",
	"repositoryClean",
	"schedule",
	"packetFingerprints",
	"metrics",
]);
const ORACLE_KEYS = new Set(["executed", "ok"]);
const GRAPH_NODE_KEYS = new Set(["dependsOn", "writeScope"]);
const ATTEMPT_KEYS = new Set([
	"attempt",
	"classification",
	"outcome",
	"elapsedMs",
	"cost",
	"calls",
	"tokens",
	"metricsComplete",
	"evidence",
]);
const ATTEMPT_EVIDENCE_KEYS = new Set([
	"schedule",
	"packetFingerprints",
	"processErrors",
	"processErrorClassifications",
	"prewalkHits",
	"prewalkExpected",
	"resourcesRemaining",
	"readCalls",
	"bashCalls",
	"elapsedMs",
	"acceptancePassed",
	"qualityPassed",
	"firstRoundPassed",
	"repairRounds",
]);
const SCHEDULE_KEYS = new Set([
	"sequence",
	"type",
	"goalIndexes",
	"elapsedMs",
	"active",
]);
const METRICS_KEYS = new Set([
	"elapsedMs",
	"acceptancePassed",
	"qualityPassed",
	"firstRoundPassed",
	"repairRounds",
	"processErrors",
	"processErrorClassifications",
	"resourcesRemaining",
	"prewalkHits",
	"prewalkExpected",
	"calls",
	"tokens",
	"cost",
	"readCalls",
	"bashCalls",
	"totalAttemptElapsedMs",
	"totalAttemptCost",
	"totalAttemptCalls",
	"totalAttemptTokens",
	"attemptMetricsComplete",
]);
const PROCESS_ERROR_KEYS = new Set(["process_start", "protocol"]);
const DEPENDENCY_PACKET_CONTRACT = {
	version: 1,
	predecessors: [
		"goalIndex",
		"handoff",
		"summary",
		"acceptance",
		"quality",
		"criteriaDeviation",
	],
	source: "verified-direct-predecessors",
	criteriaDeviationDetector: "plan/markdown#hasCriteriaDeviation",
};

export function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function directoryFingerprint(dir) {
	const hash = createHash("sha256");
	for (const path of listFiles(dir)) {
		hash.update(relative(dir, path)).update("\0");
		hash.update(readFileSync(path)).update("\0");
	}
	return hash.digest("hex");
}

export function scorerFingerprint() {
	// 合同：对 evaluation 模块全文取指纹，覆盖 stableJson 等全部传递依赖。
	return sha256(readFileSync(fileURLToPath(import.meta.url), "utf8"));
}

const evaluationScriptsDir = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = join(evaluationScriptsDir, "..");

/** 评测执行器（arm 调度/重试/派发）全文指纹；与纯 scorer 分离。 */
export function executorFingerprint() {
	return sha256(
		readFileSync(join(evaluationScriptsDir, "evaluate-graph-flow.mjs"), "utf8"),
	);
}

/** 候选调度器源码指纹：optimized/streaming 实际 import 的 computeLaunchSet 合同。 */
export function schedulerFingerprint() {
	return sha256(
		readFileSync(join(packageRoot, "src/flow/scheduler.ts"), "utf8"),
	);
}

/** 固定公平轮转：canonical benchmark index + repetition 决定 GRAPH_ARMS 起点。 */
export function rotateArms(offset) {
	const start =
		((offset % GRAPH_ARMS.length) + GRAPH_ARMS.length) % GRAPH_ARMS.length;
	return [...GRAPH_ARMS.slice(start), ...GRAPH_ARMS.slice(0, start)];
}

export function expectedArmOrder(benchmarkIndex, runsPerArm) {
	if (!Number.isSafeInteger(benchmarkIndex) || benchmarkIndex < 0)
		throw new Error("benchmarkIndex must be a non-negative integer");
	if (!Number.isSafeInteger(runsPerArm) || runsPerArm < 1)
		throw new Error("runsPerArm must be a positive integer");
	return Array.from({ length: runsPerArm }, (_, repetition) =>
		rotateArms(benchmarkIndex + repetition),
	);
}

/** 合同有序 benchmark 集：唯一、非空、稳定 ID。 */
export function normalizeBenchmarkIds(ids) {
	if (!Array.isArray(ids) || ids.length === 0)
		throw new Error("benchmark ids must be a non-empty array");
	const normalized = ids.map((id) => {
		if (typeof id !== "string" || !id.trim())
			throw new Error("benchmark id must be a non-empty string");
		return id;
	});
	if (new Set(normalized).size !== normalized.length)
		throw new Error("benchmark ids must be unique");
	return normalized;
}

export function canonicalBenchmarkIndex(benchmarkIds, id) {
	const index = normalizeBenchmarkIds(benchmarkIds).indexOf(id);
	if (index < 0) throw new Error(`unknown benchmark id: ${id}`);
	return index;
}

/** 从各 Goal 检查轮次派生验收/质检/首轮事实；无轮次不得记首轮通过。 */
export function deriveCheckFlags(goalChecks) {
	const list = Array.isArray(goalChecks) ? goalChecks : [];
	const acceptancePassed =
		list.length > 0 &&
		list.every((item) => item?.acceptance?.rounds?.at(-1)?.result === "passed");
	const qualityPassed =
		list.length > 0 &&
		list.every((item) => item?.quality?.rounds?.at(-1)?.result === "passed");
	const firstRoundPassed =
		list.length > 0 &&
		list.every((item) => {
			const acceptance = item?.acceptance?.rounds ?? [];
			const quality = item?.quality?.rounds ?? [];
			const firstAcceptance = acceptance.find((round) => round.round === 1);
			const firstQuality = quality.find((round) => round.round === 1);
			return (
				firstAcceptance?.result === "passed" &&
				firstQuality?.result === "passed"
			);
		});
	const repairRounds = list
		.flatMap((item) => [
			...(item?.acceptance?.rounds ?? []),
			...(item?.quality?.rounds ?? []),
		])
		.filter((round) => round.result === "failed").length;
	return {
		acceptancePassed,
		qualityPassed,
		firstRoundPassed,
		repairRounds,
	};
}

/** attempt 汇总投影到 run/planning metrics 的 usage 字段。 */
export function usageMetricsFromAttempts(attempts) {
	const summary = summarizeAttempts(attempts);
	return {
		...summary,
		cost: summary.totalAttemptCost,
		calls: summary.totalAttemptCalls,
		tokens: summary.totalAttemptTokens,
	};
}

export function packetRuleFingerprint() {
	return sha256(stableJson(DEPENDENCY_PACKET_CONTRACT));
}

export function benchmarkFingerprint(manifests) {
	return sha256(
		stableJson(
			manifests.map((manifest) => ({
				...manifest,
				task: sha256(manifest.task),
			})),
		),
	);
}

export function modelFingerprint(models) {
	return sha256(stableJson(models));
}

export function validateBenchmark(manifest, fixtureDir) {
	const errors = [];
	if (manifest?.version !== 1) errors.push("manifest version must be 1");
	if (!nonEmpty(manifest?.id)) errors.push("manifest id is required");
	if (!nonEmpty(manifest?.task)) errors.push("manifest task is required");
	if (
		!Array.isArray(manifest?.expectedGraph) ||
		manifest.expectedGraph.length < 1
	)
		errors.push("expectedGraph must be non-empty");
	if (!Array.isArray(manifest?.allowedChanges))
		errors.push("allowedChanges must be an array");
	if (!nonEmpty(manifest?.oracle?.command))
		errors.push("oracle command is required");
	if (!Array.isArray(manifest?.oracle?.args))
		errors.push("oracle args must be an array");
	if (!/^[a-f0-9]{64}$/u.test(String(manifest?.initialSnapshotFingerprint)))
		errors.push("initialSnapshotFingerprint must be sha256");
	if (errors.length === 0) {
		const actual = directoryFingerprint(join(fixtureDir, "repo"));
		if (actual !== manifest.initialSnapshotFingerprint)
			errors.push("initial snapshot fingerprint drifted");
	}
	return errors;
}

export function evaluationGraph(manifest) {
	return manifest.expectedGraph.map((goal) => ({
		dependsOn: [...goal.dependsOn],
		writeScope: [...goal.writeScope],
	}));
}

export function validatePlannedGraph(flow, manifest) {
	const errors = [];
	if (flow?.status !== "draft") errors.push("planned Flow must be draft");
	if (flow?.goals?.length !== manifest.expectedGraph.length)
		errors.push("planned Goal count differs from benchmark contract");
	for (const [index, expected] of manifest.expectedGraph.entries()) {
		const goal = flow?.goals?.[index];
		if (!goal) continue;
		if (goal.role !== "normal") errors.push(`G${index + 1} must be normal`);
		if (goal.file !== expected.file)
			errors.push(`G${index + 1} file differs from contract`);
		if (
			stableJson(goal.dependsOn ?? defaultDependencies(index)) !==
			stableJson(expected.dependsOn)
		)
			errors.push(`G${index + 1} dependencies differ from contract`);
		if (stableJson(goal.writeScope) !== stableJson(expected.writeScope))
			errors.push(`G${index + 1} writeScope differs from contract`);
	}
	return errors;
}

export function planFingerprint(flowDir, flow) {
	return sha256(
		stableJson({
			graph: flow.goals.map((goal) => ({
				file: goal.file,
				role: goal.role,
				dependsOn: goal.dependsOn ?? defaultDependencies(goal.index),
				writeScope: goal.writeScope,
				markdown: readFileSync(join(flowDir, goal.file), "utf8"),
			})),
		}),
	);
}

export function classifyFailure(error) {
	const code = String(error?.code ?? "").toLowerCase();
	const message = String(error?.message ?? error ?? "").toLowerCase();
	if (code === "planning_scope" || message.includes("planning phase modified"))
		return "planning_scope";
	if (
		code.includes("rate") ||
		message.includes("rate limit") ||
		message.includes("too many requests")
	)
		return "rate_limit";
	if (
		code.includes("network") ||
		message.includes("econn") ||
		message.includes("fetch failed") ||
		message.includes("network") ||
		message.includes("socket") ||
		message.includes("timed out")
	)
		return "network";
	if (
		code.includes("spawn") ||
		code === "process_start" ||
		message.includes("enoent") ||
		message.includes("failed to start")
	)
		return "process_start";
	if (code.includes("protocol") || message.includes("protocol"))
		return "protocol";
	if (
		code === "cancelled" ||
		message.includes("evaluation cancelled") ||
		message.includes("aborted")
	)
		return "cancelled";
	return "quality";
}

/**
 * worker 无 completion/handoff 凭证退出：一律基础设施/协议故障（可重试），
 * 不是 executor→验收→质检后的 Agent 质量结果。BLOCKED handoff 不走此函数。
 */
export function classifyMissingWorkerExit({
	code = null,
	signal = null,
	stderr = "",
	processErrors = [],
} = {}) {
	if (processErrors.includes("protocol")) return "protocol";
	if (processErrors.includes("process_start")) return "process_start";
	if (signal) return "process_start";
	if (code !== null && code !== undefined && code !== 0) return "process_start";
	const fromStderr = classifyFailure(new Error(String(stderr ?? "")));
	if (fromStderr !== "quality") return fromStderr;
	// 干净退出但无凭证 = 协议违约
	return "protocol";
}

export function isRetryableFailure(classification) {
	return (
		classification !== "cancelled" && RETRYABLE_FAILURES.has(classification)
	);
}

export async function withInfrastructureRetries(
	run,
	maxAttempts = 3,
	now = Date.now,
) {
	const attempts = [];
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const startedAt = now();
		try {
			const value = await run(attempt);
			attempts.push(
				attemptEvidence(attempt, "none", "complete", now() - startedAt, value),
			);
			return { attempts, value };
		} catch (error) {
			const classification = classifyFailure(error);
			attempts.push(
				attemptEvidence(
					attempt,
					classification,
					"failed",
					now() - startedAt,
					error,
				),
			);
			if (!isRetryableFailure(classification) || attempt === maxAttempts)
				throw Object.assign(
					error instanceof Error ? error : new Error(String(error)),
					{
						attempts,
						classification,
					},
				);
		}
	}
	throw new Error("retry loop exhausted");
}

function attemptEvidence(attempt, classification, outcome, elapsedMs, source) {
	const metrics = source?.attemptMetrics ?? source?.metrics ?? source?.stats;
	const cost = finiteMetric(metrics?.cost);
	const calls = finiteMetric(metrics?.calls ?? metrics?.turns);
	const tokens = finiteMetric(
		metrics?.tokens ??
			sumMetrics(metrics, ["input", "output", "cacheRead", "cacheWrite"]),
	);
	const evidence = compactAttemptEvidence(source?.partialRun ?? source);
	return {
		attempt,
		classification,
		outcome,
		elapsedMs: Math.max(0, elapsedMs),
		cost,
		calls,
		tokens,
		metricsComplete: cost !== null && calls !== null && tokens !== null,
		...(evidence ? { evidence } : {}),
	};
}

/** 失败 attempt 的紧凑运行证据：可复核 schedule/packet/prewalk/process，不含 Session 原文。 */
export function compactAttemptEvidence(source) {
	const schedule = source?.schedule ?? source?.partialRun?.schedule;
	if (!Array.isArray(schedule) || schedule.length === 0) return undefined;
	const packets =
		source?.packetFingerprints ?? source?.partialRun?.packetFingerprints ?? {};
	const metrics = source?.metrics ?? source?.partialRun?.metrics ?? {};
	const classifications = metrics.processErrorClassifications ??
		source?.processErrorClassifications ?? { process_start: 0, protocol: 0 };
	return {
		schedule: schedule.map((event) => ({ ...event })),
		packetFingerprints: { ...packets },
		processErrors:
			metrics.processErrors ??
			source?.processErrors ??
			classifications.process_start + classifications.protocol,
		processErrorClassifications: { ...classifications },
		prewalkHits: metrics.prewalkHits ?? source?.prewalkHits ?? 0,
		prewalkExpected: metrics.prewalkExpected ?? source?.prewalkExpected ?? 0,
		resourcesRemaining:
			metrics.resourcesRemaining ?? source?.resourcesRemaining ?? 0,
		readCalls: metrics.readCalls ?? 0,
		bashCalls: metrics.bashCalls ?? 0,
		elapsedMs: metrics.elapsedMs ?? schedule.at(-1)?.elapsedMs ?? 0,
		acceptancePassed: metrics.acceptancePassed === true,
		qualityPassed: metrics.qualityPassed === true,
		firstRoundPassed: metrics.firstRoundPassed === true,
		repairRounds: metrics.repairRounds ?? 0,
	};
}

function finiteMetric(value) {
	return Number.isFinite(value) && value >= 0 ? value : null;
}

function sumMetrics(metrics, fields) {
	if (!metrics || fields.every((field) => metrics[field] === undefined))
		return undefined;
	return fields.reduce((total, field) => total + (metrics[field] ?? 0), 0);
}

export function buildDependencyPacket(
	flowDir,
	flow,
	goalIndex,
	artifacts,
	hasCriteriaDeviation,
) {
	if (typeof hasCriteriaDeviation !== "function")
		throw new Error("criteria deviation detector is required");
	const dependencies =
		flow.goals[goalIndex]?.dependsOn ?? defaultDependencies(goalIndex);
	const predecessors = dependencies.map((index) => {
		const artifact = artifacts[index];
		if (!artifact?.completion)
			throw new Error(`missing completion credential for G${index + 1}`);
		const markdown = readFileSync(
			join(flowDir, flow.goals[index].file),
			"utf8",
		);
		return {
			goalIndex: index,
			handoff: section(markdown, "Handoff"),
			summary: artifact.completion.summary,
			acceptance: lastCheckResult(artifact.completion.checks, "acceptance"),
			quality: lastCheckResult(artifact.completion.checks, "quality"),
			criteriaDeviation: hasCriteriaDeviation(markdown),
		};
	});
	const packet = {
		version: 1,
		goalIndex,
		predecessors,
	};
	return deepFreeze({ ...packet, fingerprint: sha256(stableJson(packet)) });
}

export function createCoordinatorState(dependencies) {
	if (!Array.isArray(dependencies) || dependencies.length === 0)
		throw new Error("coordinator requires a non-empty dependency graph");
	const graph = dependencies.map((items, goalIndex) => {
		if (
			!Array.isArray(items) ||
			items.some(
				(index) =>
					!Number.isSafeInteger(index) || index < 0 || index >= goalIndex,
			) ||
			new Set(items).size !== items.length
		)
			throw new Error(`invalid dependencies for G${goalIndex + 1}`);
		return [...items];
	});
	return {
		dependencies: graph,
		active: {},
		completed: [],
		failed: [],
		status: "running",
		stopReason: null,
	};
}

export function readyCoordinatorGoals(state) {
	if (state.status !== "running") return [];
	return state.dependencies.flatMap((dependencies, goalIndex) => {
		if (
			state.completed.includes(goalIndex) ||
			state.failed.includes(goalIndex) ||
			state.active[goalIndex] ||
			dependencies.some((index) => !state.completed.includes(index))
		)
			return [];
		return [goalIndex];
	});
}

export function activeCoordinatorGoals(state) {
	return Object.keys(state.active)
		.map(Number)
		.sort((left, right) => left - right);
}

export function coordinatorAttemptId(state, goalIndex) {
	return state.active[goalIndex]?.attemptId;
}

export function coordinatorResourceCount(state) {
	return activeCoordinatorGoals(state).length;
}

export function startCoordinatorAttempt(
	state,
	goalIndex,
	attemptId,
	resourceId,
) {
	if (
		!readyCoordinatorGoals(state).includes(goalIndex) ||
		typeof attemptId !== "string" ||
		!attemptId ||
		typeof resourceId !== "string" ||
		!resourceId
	)
		return state;
	return {
		...state,
		active: {
			...state.active,
			[goalIndex]: { attemptId, resourceId },
		},
	};
}

export function applyCoordinatorEvent(state, event) {
	if (event.type === "stop" || event.type === "console_switch")
		return stopCoordinator(state, event.type, event.type);
	if (event.type === "resume")
		return {
			state: {
				...state,
				active: {},
				failed: [],
				status: "running",
				stopReason: null,
			},
			accepted: true,
			action: "resume",
			releasedResources: [],
			cancelResources: [],
			restartGoals: [...state.failed],
		};
	const current = state.active[event.goalIndex];
	if (
		state.status !== "running" ||
		!current ||
		current.attemptId !== event.attemptId
	)
		return coordinatorEventResult(state, false, "stale");
	if (event.type === "blocked")
		return stopCoordinator(state, "blocked", "blocked");
	if (event.type === "exit")
		return stopCoordinator(state, "missing_completion", "missing_completion");
	if (event.type !== "completion")
		return coordinatorEventResult(state, false, "unknown");
	const active = { ...state.active };
	delete active[event.goalIndex];
	return {
		state: {
			...state,
			active,
			completed: sortedUnique([...state.completed, event.goalIndex]),
			failed: state.failed.filter((index) => index !== event.goalIndex),
		},
		accepted: true,
		action: "complete",
		releasedResources: [current.resourceId],
		cancelResources: [],
		restartGoals: [],
	};
}

function stopCoordinator(state, stopReason, action) {
	const activeGoals = activeCoordinatorGoals(state);
	const resources = activeGoals.map(
		(goalIndex) => state.active[goalIndex].resourceId,
	);
	return {
		state: {
			...state,
			active: {},
			failed: sortedUnique([...state.failed, ...activeGoals]),
			status: stopReason === "blocked" ? "blocked" : "stopped",
			stopReason,
		},
		accepted: true,
		action,
		releasedResources: resources,
		cancelResources: resources,
		restartGoals: [],
	};
}

function coordinatorEventResult(state, accepted, action) {
	return {
		state,
		accepted,
		action,
		releasedResources: [],
		cancelResources: [],
		restartGoals: [],
	};
}

export function decideEvaluation(benchmarks) {
	const directions = benchmarks.map(benchmarkDirection);
	if (directions.every((direction) => direction === "positive"))
		return { decision: "proceed", directions };
	if (directions.every((direction) => direction === "negative"))
		return { decision: "stop", directions };
	return { decision: "expand", directions };
}

export function validateArtifact(artifact, options = {}) {
	const errors = [];
	if (artifact?.schemaVersion !== GRAPH_ARTIFACT_VERSION)
		errors.push("artifact schemaVersion is invalid");
	if (!DECISIONS.has(artifact?.decision))
		errors.push("artifact decision is invalid");
	rejectUnknownKeys(artifact, ARTIFACT_KEYS, "artifact", errors);
	let expectedBenchmarkIds = null;
	if (options.expectedBenchmarkIds !== undefined) {
		try {
			expectedBenchmarkIds = normalizeBenchmarkIds(
				options.expectedBenchmarkIds,
			);
		} catch (error) {
			errors.push(
				error instanceof Error
					? error.message
					: "expectedBenchmarkIds is invalid",
			);
		}
	}
	for (const field of [
		"benchmarkFingerprint",
		"evaluationConfigFingerprint",
		"modelFingerprint",
		"packetRuleFingerprint",
		"scorerFingerprint",
		"executorFingerprint",
		"schedulerFingerprint",
	]) {
		if (!/^[a-f0-9]{64}$/u.test(String(artifact?.[field])))
			errors.push(`${field} is invalid`);
	}
	if (
		typeof artifact?.scorerFingerprint === "string" &&
		artifact.scorerFingerprint !== scorerFingerprint()
	)
		errors.push("scorerFingerprint does not match evaluation module");
	if (
		typeof artifact?.executorFingerprint === "string" &&
		artifact.executorFingerprint !== executorFingerprint()
	)
		errors.push("executorFingerprint does not match evaluate-graph-flow.mjs");
	if (
		typeof artifact?.schedulerFingerprint === "string" &&
		artifact.schedulerFingerprint !== schedulerFingerprint()
	)
		errors.push("schedulerFingerprint does not match src/flow/scheduler.ts");
	if (!Number.isSafeInteger(artifact?.runsPerArm) || artifact.runsPerArm < 1)
		errors.push("runsPerArm must be positive");
	if (
		!Number.isSafeInteger(artifact?.workerBudget) ||
		artifact.workerBudget < 1
	)
		errors.push("workerBudget must be positive");
	if (!Array.isArray(artifact?.benchmarks) || artifact.benchmarks.length === 0)
		errors.push("artifact benchmarks must be non-empty");
	let benchmarkIds;
	try {
		benchmarkIds = normalizeBenchmarkIds(artifact?.benchmarkIds);
	} catch (error) {
		errors.push(
			error instanceof Error ? error.message : "benchmarkIds is invalid",
		);
		benchmarkIds = null;
	}
	// 可信集合只能来自外部合同；禁止只用 artifact 自带 ID 当实验身份。
	if (
		expectedBenchmarkIds &&
		benchmarkIds &&
		stableJson(benchmarkIds) !== stableJson(expectedBenchmarkIds)
	)
		errors.push("benchmarkIds must match evaluation contract order");
	if (expectedBenchmarkIds) benchmarkIds = expectedBenchmarkIds;
	if (
		benchmarkIds &&
		Array.isArray(artifact?.benchmarks) &&
		(artifact.benchmarks.length !== benchmarkIds.length ||
			artifact.benchmarks.some(
				(benchmark, index) => benchmark?.id !== benchmarkIds[index],
			))
	)
		errors.push("artifact benchmarks must follow benchmarkIds order exactly");
	if (Array.isArray(artifact?.benchmarks)) {
		const seen = new Set();
		for (const benchmark of artifact.benchmarks) {
			if (typeof benchmark?.id !== "string") continue;
			if (seen.has(benchmark.id))
				errors.push(`duplicate benchmark id: ${benchmark.id}`);
			seen.add(benchmark.id);
		}
	}
	for (const [offset, benchmark] of (artifact?.benchmarks ?? []).entries()) {
		let benchmarkIndex = offset;
		if (benchmarkIds && typeof benchmark?.id === "string") {
			benchmarkIndex = benchmarkIds.indexOf(benchmark.id);
			if (benchmarkIndex < 0) {
				errors.push(`${benchmark.id} is not in benchmarkIds contract`);
				continue;
			}
		}
		validateArtifactBenchmark(
			benchmark,
			benchmarkIndex,
			artifact.runsPerArm,
			artifact.workerBudget,
			artifact.decision,
			errors,
		);
	}
	if (Array.isArray(artifact?.benchmarks) && artifact.benchmarks.length > 0) {
		const scored = decideEvaluation(artifact.benchmarks);
		const directions = Object.fromEntries(
			artifact.benchmarks.map((benchmark, index) => [
				benchmark.id,
				scored.directions[index],
			]),
		);
		if (
			artifact.decision !== scored.decision ||
			stableJson(artifact.directions) !== stableJson(directions)
		)
			errors.push("artifact decision does not match scored evidence");
	}
	if (sensitiveArtifactValue(artifact))
		errors.push("artifact contains sensitive/raw values");
	return errors;
}

export function artifactExitCode(artifact) {
	return artifact.decision === "proceed" ? 0 : 1;
}

/** artifact 旁路摘要路径：foo.json → foo.summary.md */
export function evaluationSummaryPath(artifactPath) {
	return String(artifactPath).replace(/\.json$/iu, ".summary.md");
}

/**
 * 由 artifact 确定性生成人读摘要（禁止模型撰写，避免洗白数字）。
 * 仅派生已校验字段：decision、directions、elapsed、complete 计数、completion-fill。
 */
export function formatEvaluationSummary(artifact) {
	const ids = Array.isArray(artifact?.benchmarkIds)
		? artifact.benchmarkIds
		: (artifact?.benchmarks ?? []).map((benchmark) => benchmark.id);
	const lines = [
		"# 图执行评测摘要",
		"",
		"> 本文件由 artifact 确定性生成，非模型撰写；数字须与 JSON 一致。",
		"",
		`- **结论**: \`${artifact?.decision ?? "?"}\``,
		`- **样本**: runsPerArm=${artifact?.runsPerArm ?? "?"} · workerBudget=${artifact?.workerBudget ?? "?"}`,
		`- **任务集**: ${ids.join(", ") || "(empty)"}`,
		"",
		"## 方向",
		"",
		"| 任务 | 方向 |",
		"|------|------|",
	];
	for (const id of ids) {
		const direction = artifact?.directions?.[id] ?? "?";
		lines.push(`| ${id} | ${direction} |`);
	}
	lines.push(
		"",
		"## 耗时（秒，serial / current-batch / optimized-batch / streaming）",
		"",
		"| 任务 | serial | current | optimized | streaming |",
		"|------|--------|---------|-----------|-----------|",
	);
	let complete = 0;
	let total = 0;
	let processErrors = 0;
	let completionFills = 0;
	for (const id of ids) {
		const benchmark = (artifact?.benchmarks ?? []).find(
			(item) => item.id === id,
		);
		const cells = GRAPH_ARMS.map((arm) => {
			const runs = (benchmark?.runs ?? []).filter((run) => run.arm === arm);
			for (const run of runs) {
				total += 1;
				if (run.terminalOutcome === "complete") complete += 1;
				processErrors += Number(run.metrics?.processErrors ?? 0);
				if (arm === "streaming")
					completionFills += countStreamingCompletionFills(run.schedule);
			}
			if (runs.length === 0) return "—";
			const seconds = runs.map((run) =>
				Math.round(Number(run.metrics?.elapsedMs ?? 0) / 1000),
			);
			const mid = [...seconds].sort((a, b) => a - b)[
				Math.floor(seconds.length / 2)
			];
			return seconds.length === 1
				? String(mid)
				: `${mid} (n=${seconds.length})`;
		});
		lines.push(`| ${id} | ${cells.join(" | ")} |`);
	}
	lines.push(
		"",
		"## 完整性",
		"",
		`- complete: ${complete}/${total}`,
		`- processErrors: ${processErrors}`,
		`- streaming completion-fills: ${completionFills}`,
		"",
		"## 指纹（前 12 位）",
		"",
		`- scorer: \`${shortFingerprint(artifact?.scorerFingerprint)}\``,
		`- executor: \`${shortFingerprint(artifact?.executorFingerprint)}\``,
		`- scheduler: \`${shortFingerprint(artifact?.schedulerFingerprint)}\``,
		`- evaluationConfig: \`${shortFingerprint(artifact?.evaluationConfigFingerprint)}\``,
		"",
		"## 边界",
		"",
		"- 摘要不能替代 artifact 校验；请以 `evaluate-graph-flow --verify-artifact` 为准。",
		"- 单样本不足以授权生产 streaming；`expand` 表示先扩样，不是 proceed。",
		"- 不能证明 worktree/patch 隔离后的墙钟收益。",
	);
	return `${lines.join("\n")}\n`;
}

export function countStreamingCompletionFills(schedule) {
	const events = Array.isArray(schedule) ? schedule : [];
	const active = new Set();
	let fills = 0;
	for (const event of events) {
		if (event?.type === "launch") {
			if (active.size > 0) fills += 1;
			for (const index of event.goalIndexes ?? []) active.add(index);
		} else if (event?.type === "completion") {
			for (const index of event.goalIndexes ?? []) active.delete(index);
		}
	}
	return fills;
}

function shortFingerprint(value) {
	return typeof value === "string" && value.length >= 12
		? value.slice(0, 12)
		: String(value ?? "?");
}

function validateArtifactBenchmark(
	benchmark,
	benchmarkIndex,
	runsPerArm,
	workerBudget,
	decision,
	errors,
) {
	rejectUnknownKeys(
		benchmark,
		BENCHMARK_KEYS,
		`benchmark ${benchmark?.id ?? "?"}`,
		errors,
	);
	if (!nonEmpty(benchmark?.id)) errors.push("benchmark id is required");
	if (!/^[a-f0-9]{64}$/u.test(String(benchmark?.fingerprint)))
		errors.push(`${benchmark?.id ?? "benchmark"} fingerprint is invalid`);
	if (!/^[a-f0-9]{64}$/u.test(String(benchmark?.planFingerprint)))
		errors.push(`${benchmark?.id ?? "benchmark"} planFingerprint is invalid`);
	validateGraph(benchmark?.id ?? "benchmark", benchmark?.graph, errors);
	for (const [index, node] of (benchmark?.graph ?? []).entries())
		rejectUnknownKeys(
			node,
			GRAPH_NODE_KEYS,
			`${benchmark?.id ?? "benchmark"} graph[${index}]`,
			errors,
		);
	rejectUnknownKeys(
		benchmark?.planning,
		PLANNING_KEYS,
		`${benchmark?.id ?? "benchmark"} planning`,
		errors,
	);
	for (const attempt of benchmark?.planning?.attempts ?? [])
		rejectUnknownKeys(
			attempt,
			ATTEMPT_KEYS,
			`${benchmark?.id ?? "benchmark"} planning attempt`,
			errors,
		);
	if (
		!benchmark?.planning ||
		!optionalNonNegative(benchmark.planning.cost) ||
		!Number.isFinite(benchmark.planning.elapsedMs) ||
		benchmark.planning.elapsedMs < 0 ||
		!["failed", "valid"].includes(benchmark.planning.status) ||
		!validAttempts(
			benchmark.planning.attempts,
			benchmark.planning.status === "valid",
		) ||
		!validAttemptSummary(
			benchmark.planning,
			benchmark.planning.attempts,
			benchmark.planning.status === "valid",
		) ||
		!usageMatchesAttempts(benchmark.planning, benchmark.planning.attempts)
	)
		errors.push(`${benchmark?.id ?? "benchmark"} planning evidence is invalid`);
	const expectedOrder = Number.isSafeInteger(runsPerArm)
		? expectedArmOrder(benchmarkIndex, runsPerArm)
		: null;
	if (
		!Array.isArray(benchmark?.armOrder) ||
		benchmark.armOrder.length !== runsPerArm ||
		benchmark.armOrder.some(
			(order) =>
				!Array.isArray(order) ||
				order.length !== GRAPH_ARMS.length ||
				GRAPH_ARMS.some((arm) => !order.includes(arm)),
		)
	)
		errors.push(`${benchmark?.id ?? "benchmark"} armOrder is invalid`);
	else if (
		expectedOrder &&
		stableJson(benchmark.armOrder) !== stableJson(expectedOrder)
	)
		errors.push(
			`${benchmark?.id ?? "benchmark"} armOrder does not match rotation contract`,
		);
	if (!Array.isArray(benchmark?.runs)) {
		errors.push(`${benchmark?.id ?? "benchmark"} runs must be an array`);
		return;
	}
	for (const arm of GRAPH_ARMS) {
		const runs = benchmark.runs.filter((run) => run.arm === arm);
		if (
			runs.length !== runsPerArm ||
			stableJson(runs.map((run) => run.repetition).sort()) !==
				stableJson(Array.from({ length: runsPerArm }, (_, index) => index + 1))
		)
			errors.push(`${benchmark.id} must contain ${runsPerArm} ${arm} run(s)`);
	}
	const recordedOrder = Array.from({ length: runsPerArm }, (_, repetition) =>
		benchmark.runs
			.filter((run) => run.repetition === repetition + 1)
			.map((run) => run.arm),
	);
	if (stableJson(recordedOrder) !== stableJson(benchmark.armOrder))
		errors.push(`${benchmark.id} run order differs from armOrder`);
	for (const run of benchmark.runs) {
		rejectUnknownKeys(
			run,
			RUN_KEYS,
			`${benchmark.id}/${run?.arm ?? "?"}`,
			errors,
		);
		rejectUnknownKeys(
			run?.oracle,
			ORACLE_KEYS,
			`${benchmark.id}/${run?.arm ?? "?"} oracle`,
			errors,
		);
		if (!GRAPH_ARMS.includes(run.arm))
			errors.push(`${benchmark.id} has unknown arm`);
		if (!TERMINAL_OUTCOMES.has(run.terminalOutcome))
			errors.push(`${benchmark.id}/${run.arm} terminal outcome is invalid`);
		if (
			typeof run.oracle?.executed !== "boolean" ||
			typeof run.oracle?.ok !== "boolean" ||
			typeof run.repositoryClean !== "boolean" ||
			!run.packetFingerprints ||
			typeof run.packetFingerprints !== "object" ||
			Array.isArray(run.packetFingerprints)
		)
			errors.push(`${benchmark.id}/${run.arm} terminal evidence is incomplete`);
		for (const attempt of run.attempts ?? []) {
			rejectUnknownKeys(
				attempt,
				ATTEMPT_KEYS,
				`${benchmark.id}/${run.arm} attempt`,
				errors,
			);
			if (attempt.evidence) {
				rejectUnknownKeys(
					attempt.evidence,
					ATTEMPT_EVIDENCE_KEYS,
					`${benchmark.id}/${run.arm} attempt evidence`,
					errors,
				);
				validateAttemptEvidence(
					benchmark.id,
					run.arm,
					attempt,
					benchmark.graph,
					workerBudget,
					errors,
				);
			} else if (failedAttemptNeedsEvidence(attempt))
				errors.push(
					`${benchmark.id}/${run.arm} attempt ${attempt.attempt} with real work lacks evidence`,
				);
		}
		for (const event of run.schedule ?? [])
			rejectUnknownKeys(
				event,
				SCHEDULE_KEYS,
				`${benchmark.id}/${run.arm} schedule`,
				errors,
			);
		if (
			!validAttempts(
				run.attempts,
				run.terminalOutcome === "complete" || run.terminalOutcome === "blocked",
			)
		)
			errors.push(`${benchmark.id}/${run.arm} attempts are invalid`);
		validateSchedule(benchmark.id, benchmark.graph, run, workerBudget, errors);
		validatePacketFingerprints(benchmark.id, run, errors);
		validateFailedRunEvidence(benchmark.id, run, errors);
		validateRunMetrics(benchmark.id, run, errors);
		validateTerminalOracle(benchmark.id, run, errors);
		if (decision === "proceed" && !runPassed(run))
			errors.push(
				`${benchmark.id}/${run.arm} positive artifact contains a failed run`,
			);
	}
}

function validateTerminalOracle(benchmarkId, run, errors) {
	const label = `${benchmarkId}/${run.arm}`;
	if (run.terminalOutcome === "complete") {
		if (run.oracle?.executed !== true || run.oracle?.ok !== true)
			errors.push(`${label} complete run requires a successful oracle`);
		if (run.repositoryClean !== true)
			errors.push(`${label} complete run requires a clean repository scope`);
		if (
			run.metrics?.acceptancePassed !== true ||
			run.metrics?.qualityPassed !== true
		)
			errors.push(
				`${label} complete run requires passed acceptance and quality`,
			);
		return;
	}
	if (run.terminalOutcome === "oracle_failed") {
		if (run.oracle?.executed !== true || run.oracle?.ok !== false)
			errors.push(
				`${label} oracle_failed must record an executed failed oracle`,
			);
		return;
	}
	if (
		run.terminalOutcome !== "planning_failure" &&
		!infrastructureOnlyFailure(run) &&
		run.oracle?.executed !== true
	)
		errors.push(`${label} oracle was not executed`);
}

function validateGraph(benchmarkId, graph, errors) {
	if (!validGraph(graph))
		errors.push(`${benchmarkId} graph evidence is invalid`);
}

function validGraph(graph) {
	return (
		Array.isArray(graph) &&
		graph.length > 0 &&
		graph.every(
			(goal, goalIndex) =>
				Array.isArray(goal?.dependsOn) &&
				goal.dependsOn.every(
					(index) =>
						Number.isSafeInteger(index) && index >= 0 && index < goalIndex,
				) &&
				new Set(goal.dependsOn).size === goal.dependsOn.length &&
				Array.isArray(goal.writeScope) &&
				goal.writeScope.length > 0 &&
				goal.writeScope.every((scope) => scopePrefix(scope) !== undefined),
		)
	);
}

function validateSchedule(
	benchmarkId,
	graph,
	run,
	workerBudget,
	errors,
	{ checkTerminalOutcome = true } = {},
) {
	const graphLen = Array.isArray(graph) ? graph.length : 0;
	if (
		!Array.isArray(run.schedule) ||
		run.schedule.length === 0 ||
		run.schedule.some(
			(event, index) =>
				event.sequence !== index + 1 ||
				!SCHEDULE_EVENT_TYPES.has(event.type) ||
				!Number.isFinite(event.elapsedMs) ||
				event.elapsedMs < 0 ||
				(index > 0 && event.elapsedMs < run.schedule[index - 1].elapsedMs) ||
				!validGoalIndexes(event.goalIndexes, graphLen) ||
				(event.active !== undefined &&
					!validGoalIndexes(event.active, graphLen)) ||
				!scheduleEventShapeOk(event) ||
				(event.type === "launch" && event.goalIndexes.length === 0) ||
				(["launch", "completion"].includes(event.type) &&
					!Array.isArray(event.active)),
		)
	) {
		errors.push(`${benchmarkId}/${run.arm} schedule is invalid`);
		return;
	}
	if (
		!validGraph(graph) ||
		!Number.isSafeInteger(workerBudget) ||
		workerBudget < 1
	)
		return;
	const active = new Set();
	const completed = new Set();
	let terminal = null;
	for (const event of run.schedule) {
		// 终态后禁止任何事件（含图内 stale）
		if (terminal) return scheduleReplayError(benchmarkId, run.arm, errors);
		if (event.type === "launch") {
			if (
				(run.arm !== "streaming" && active.size > 0) ||
				(run.arm === "serial" && event.goalIndexes.length !== 1)
			)
				return scheduleReplayError(benchmarkId, run.arm, errors);
			const launching = [];
			for (const goalIndex of event.goalIndexes) {
				const goal = graph[goalIndex];
				if (
					!goal ||
					active.has(goalIndex) ||
					completed.has(goalIndex) ||
					goal.dependsOn.some((index) => !completed.has(index)) ||
					[...active, ...launching].some((index) =>
						writeScopesOverlap(goal.writeScope, graph[index].writeScope),
					)
				)
					return scheduleReplayError(benchmarkId, run.arm, errors);
				launching.push(goalIndex);
			}
			for (const goalIndex of launching) active.add(goalIndex);
			if (active.size > workerBudget)
				return scheduleReplayError(benchmarkId, run.arm, errors);
		} else if (event.type === "completion") {
			if (
				event.goalIndexes.length !== 1 ||
				!active.delete(event.goalIndexes[0])
			)
				return scheduleReplayError(benchmarkId, run.arm, errors);
			completed.add(event.goalIndexes[0]);
			if (completed.size === graph.length && active.size === 0)
				terminal = "complete";
		} else if (event.type === "blocked" || event.type === "exit") {
			if (event.goalIndexes.length !== 1 || !active.has(event.goalIndexes[0]))
				return scheduleReplayError(benchmarkId, run.arm, errors);
			active.clear();
			terminal = event.type === "blocked" ? "blocked" : "exit";
		} else if (event.type === "deadlock") {
			terminal = "deadlock";
		} else if (
			event.type === "planning-failure" ||
			event.type === "infrastructure-failure"
		) {
			terminal = event.type;
		}
		// stale：仅运行中允许，且不改变 active/completed
		if (
			event.active !== undefined &&
			stableJson([...active].sort((left, right) => left - right)) !==
				stableJson(event.active)
		)
			return scheduleReplayError(benchmarkId, run.arm, errors);
	}
	if (
		run.metrics?.elapsedMs !== run.schedule.at(-1).elapsedMs ||
		run.metrics?.totalAttemptElapsedMs < run.metrics?.elapsedMs
	)
		errors.push(`${benchmarkId}/${run.arm} elapsed evidence is inconsistent`);
	if (
		["complete", "oracle_failed"].includes(run.terminalOutcome) &&
		(completed.size !== graph.length ||
			active.size !== 0 ||
			terminal !== "complete")
	)
		errors.push(`${benchmarkId}/${run.arm} schedule did not settle every Goal`);
	if (
		checkTerminalOutcome &&
		!terminalOutcomeMatchesSchedule(
			run.terminalOutcome,
			run.schedule.at(-1),
			terminal,
		)
	)
		errors.push(
			`${benchmarkId}/${run.arm} terminal outcome does not match schedule ending`,
		);
}

function terminalOutcomeMatchesSchedule(outcome, lastEvent, terminal) {
	if (!lastEvent) return false;
	if (outcome === "complete" || outcome === "oracle_failed")
		return terminal === "complete" && lastEvent.type === "completion";
	if (outcome === "blocked")
		return terminal === "blocked" && lastEvent.type === "blocked";
	if (outcome === "missing_completion")
		return terminal === "exit" && lastEvent.type === "exit";
	if (outcome === "planning_failure")
		return lastEvent.type === "planning-failure";
	if (outcome === "worker_error")
		return ["infrastructure-failure", "deadlock", "exit"].includes(
			lastEvent.type,
		);
	return true;
}

function scheduleReplayError(benchmarkId, arm, errors) {
	errors.push(`${benchmarkId}/${arm} schedule replay failed`);
}

function writeScopesOverlap(left, right) {
	return left.some((leftScope) =>
		right.some((rightScope) => {
			const leftPrefix = scopePrefix(leftScope);
			const rightPrefix = scopePrefix(rightScope);
			return (
				leftPrefix === "" ||
				rightPrefix === "" ||
				leftPrefix === rightPrefix ||
				leftPrefix.startsWith(`${rightPrefix}/`) ||
				rightPrefix.startsWith(`${leftPrefix}/`)
			);
		}),
	);
}

function scopePrefix(scope) {
	if (scope === "**") return "";
	if (typeof scope !== "string" || !scope.endsWith("/**")) return undefined;
	const prefix = scope.slice(0, -3);
	return prefix
		.split("/")
		.every(
			(segment) =>
				segment !== "." &&
				segment !== ".." &&
				WRITE_SCOPE_SEGMENT_PATTERN.test(segment),
		)
		? prefix
		: undefined;
}

function validGoalIndexes(value, graphLen = Number.POSITIVE_INFINITY) {
	return (
		Array.isArray(value) &&
		value.every(
			(index) => Number.isSafeInteger(index) && index >= 0 && index < graphLen,
		)
	);
}

/** planning-failure/infrastructure-failure/deadlock 无 Goal；stale 必须指向图内 Goal。 */
function scheduleEventShapeOk(event) {
	if (
		["planning-failure", "infrastructure-failure", "deadlock"].includes(
			event.type,
		)
	)
		return event.goalIndexes.length === 0;
	if (event.type === "stale") return event.goalIndexes.length === 1;
	return true;
}

function scheduledGoalIndexes(schedule, type) {
	return sortedUnique(
		schedule
			.filter((event) => event.type === type)
			.flatMap((event) => event.goalIndexes),
	);
}

function validAttempts(attempts, succeeded) {
	if (
		!Array.isArray(attempts) ||
		attempts.length < 1 ||
		attempts.length > 3 ||
		attempts.some(
			(attempt, index) =>
				attempt.attempt !== index + 1 ||
				!FAILURE_CLASSIFICATIONS.has(attempt.classification) ||
				!Number.isFinite(attempt.elapsedMs) ||
				attempt.elapsedMs < 0 ||
				![attempt.cost, attempt.calls, attempt.tokens].every(
					(value) => value === null || (Number.isFinite(value) && value >= 0),
				) ||
				attempt.metricsComplete !==
					[attempt.cost, attempt.calls, attempt.tokens].every(
						(value) => value !== null,
					),
		)
	)
		return false;
	if (
		attempts
			.slice(0, -1)
			.some(
				(attempt) =>
					attempt.outcome !== "failed" ||
					!RETRYABLE_FAILURES.has(attempt.classification),
			)
	)
		return false;
	const finalAttempt = attempts.at(-1);
	return succeeded
		? finalAttempt.outcome === "complete" &&
				finalAttempt.classification === "none"
		: finalAttempt.outcome === "failed" &&
				finalAttempt.classification !== "none";
}

export function summarizeAttempts(attempts) {
	const sum = (field) => {
		if (attempts.some((attempt) => attempt[field] === null)) return null;
		return attempts.reduce((total, attempt) => total + attempt[field], 0);
	};
	return {
		totalAttemptElapsedMs: sum("elapsedMs"),
		totalAttemptCost: sum("cost"),
		totalAttemptCalls: sum("calls"),
		totalAttemptTokens: sum("tokens"),
		attemptMetricsComplete: attempts.every(
			(attempt) => attempt.metricsComplete,
		),
	};
}

function validAttemptSummary(value, attempts, succeeded) {
	if (!validAttempts(attempts, succeeded)) return false;
	return Object.entries(summarizeAttempts(attempts)).every(
		([field, item]) => value?.[field] === item,
	);
}

function validateRunMetrics(benchmarkId, run, errors) {
	const metrics = run.metrics;
	const label = `${benchmarkId}/${run.arm}`;
	rejectUnknownKeys(metrics, METRICS_KEYS, `${label} metrics`, errors);
	rejectUnknownKeys(
		metrics?.processErrorClassifications,
		PROCESS_ERROR_KEYS,
		`${label} processErrorClassifications`,
		errors,
	);
	const requiredFinite = [
		"elapsedMs",
		"repairRounds",
		"processErrors",
		"resourcesRemaining",
		"prewalkHits",
		"prewalkExpected",
		"readCalls",
		"bashCalls",
	];
	if (
		!metrics ||
		!validAttemptSummary(
			metrics,
			run.attempts,
			run.terminalOutcome === "complete" || run.terminalOutcome === "blocked",
		) ||
		!usageMatchesAttempts(metrics, run.attempts) ||
		requiredFinite.some(
			(field) => !Number.isFinite(metrics[field]) || metrics[field] < 0,
		) ||
		!["acceptancePassed", "qualityPassed", "firstRoundPassed"].every(
			(field) => typeof metrics[field] === "boolean",
		) ||
		!validProcessErrorEvidence(metrics)
	)
		errors.push(`${label} metrics are incomplete`);
	if (
		metrics?.firstRoundPassed &&
		(!metrics.acceptancePassed || !metrics.qualityPassed)
	)
		errors.push(
			`${label} firstRoundPassed contradicts failed acceptance/quality`,
		);
	if (
		run.terminalOutcome === "complete" &&
		metrics?.prewalkHits !== metrics?.prewalkExpected
	)
		errors.push(`${label} first frontier did not all prewalk`);
	if (metrics?.resourcesRemaining !== 0)
		errors.push(`${label} worker resources were not released`);
}

function failedAttemptNeedsEvidence(attempt) {
	if (attempt?.outcome !== "failed") return false;
	return (
		(Number(attempt.elapsedMs) >= 1_000 ||
			Number(attempt.calls) > 0 ||
			Number(attempt.tokens) > 0) &&
		attempt.classification !== "planning_scope"
	);
}

function validateAttemptEvidence(
	benchmarkId,
	arm,
	attempt,
	graph,
	workerBudget,
	errors,
) {
	const label = `${benchmarkId}/${arm} attempt ${attempt.attempt}`;
	const evidence = attempt.evidence;
	if (!evidence?.schedule?.length) {
		errors.push(`${label} evidence schedule is missing`);
		return;
	}
	const probe = {
		arm,
		terminalOutcome: "worker_error",
		schedule: evidence.schedule,
		packetFingerprints: evidence.packetFingerprints ?? {},
		metrics: {
			elapsedMs: evidence.elapsedMs,
			totalAttemptElapsedMs: evidence.elapsedMs,
		},
		attempts: [attempt],
	};
	// attempt evidence 只重放结构/终态锁，不按 run 的 terminalOutcome 对齐。
	validateSchedule(benchmarkId, graph, probe, workerBudget, errors, {
		checkTerminalOutcome: false,
	});
	validatePacketFingerprints(benchmarkId, probe, errors);
	if (
		!validProcessErrorEvidence({
			processErrors: evidence.processErrors,
			processErrorClassifications: evidence.processErrorClassifications,
		})
	)
		errors.push(`${label} evidence process classification is invalid`);
}

function validateFailedRunEvidence(benchmarkId, run, errors) {
	if (run.terminalOutcome !== "worker_error") return;
	const label = `${benchmarkId}/${run.arm}`;
	const lastEvidence = run.attempts?.at(-1)?.evidence;
	if (lastEvidence) {
		if (stableJson(run.schedule) !== stableJson(lastEvidence.schedule))
			errors.push(
				`${label} worker_error schedule must match final attempt evidence`,
			);
		return;
	}
	if (run.attempts?.some(failedAttemptNeedsEvidence))
		errors.push(
			`${label} exhausted infrastructure failure lacks attempt evidence`,
		);
}

function validatePacketFingerprints(benchmarkId, run, errors) {
	const label = `${benchmarkId}/${run.arm}`;
	const packets = run.packetFingerprints;
	if (!packets || typeof packets !== "object" || Array.isArray(packets)) {
		errors.push(`${label} dependency packet evidence is incomplete`);
		return;
	}
	const keys = Object.keys(packets);
	if (keys.some((key) => !/^\d+$/u.test(key))) {
		errors.push(`${label} packetFingerprints keys must be Goal indexes`);
		return;
	}
	const actual = keys.map(Number).sort((left, right) => left - right);
	if (run.terminalOutcome === "planning_failure") {
		if (actual.length > 0)
			errors.push(
				`${label} planning failure must not carry packet fingerprints`,
			);
		return;
	}
	const launched = scheduledGoalIndexes(run.schedule ?? [], "launch");
	if (stableJson(actual) !== stableJson(launched)) {
		errors.push(
			`${label} packetFingerprints must exactly match launched Goal indexes`,
		);
		return;
	}
	for (const goalIndex of launched) {
		const fingerprint = packets[goalIndex] ?? packets[String(goalIndex)];
		if (!/^[a-f0-9]{64}$/u.test(String(fingerprint)))
			errors.push(`${label} dependency packet evidence is incomplete`);
	}
}

function usageMatchesAttempts(value, attempts) {
	const usage = usageMetricsFromAttempts(attempts);
	return (
		value?.cost === usage.cost &&
		value?.calls === usage.calls &&
		value?.tokens === usage.tokens &&
		value?.totalAttemptCost === usage.totalAttemptCost &&
		value?.totalAttemptCalls === usage.totalAttemptCalls &&
		value?.totalAttemptTokens === usage.totalAttemptTokens &&
		value?.attemptMetricsComplete === usage.attemptMetricsComplete
	);
}

function optionalNonNegative(value) {
	return value === null || (Number.isFinite(value) && value >= 0);
}

function rejectUnknownKeys(value, allowed, label, errors) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	for (const key of Object.keys(value))
		if (!allowed.has(key)) errors.push(`${label} has unknown field ${key}`);
}

function validProcessErrorEvidence(metrics) {
	const classifications = metrics?.processErrorClassifications;
	return (
		classifications !== null &&
		typeof classifications === "object" &&
		Number.isSafeInteger(classifications.process_start) &&
		classifications.process_start >= 0 &&
		Number.isSafeInteger(classifications.protocol) &&
		classifications.protocol >= 0 &&
		metrics.processErrors ===
			classifications.process_start + classifications.protocol
	);
}

function infrastructureOnlyFailure(run) {
	return (
		run.terminalOutcome === "worker_error" &&
		Array.isArray(run.attempts) &&
		run.attempts.length > 0 &&
		run.attempts.every((attempt) =>
			RETRYABLE_FAILURES.has(attempt.classification),
		)
	);
}

function benchmarkDirection(benchmark) {
	if (
		benchmark.planning?.status === "failed" ||
		benchmark.runs.every((run) => !runPassed(run))
	)
		return "negative";
	const grouped = Object.fromEntries(
		GRAPH_ARMS.map((arm) => [
			arm,
			benchmark.runs.filter((run) => run.arm === arm),
		]),
	);
	if (GRAPH_ARMS.some((arm) => grouped[arm].length === 0)) return "negative";
	// 先判质量：基线可用而候选明确更差 → negative；其余部分失败 → neutral。
	const baselinePass = Math.max(
		passRate(grouped.serial),
		passRate(grouped["current-batch"]),
	);
	const candidatePass = Math.min(
		passRate(grouped["optimized-batch"]),
		passRate(grouped.streaming),
	);
	if (candidatePass < baselinePass) return "negative";
	const baselineQuality = Math.max(
		reliablePassRate(grouped.serial),
		reliablePassRate(grouped["current-batch"]),
	);
	const candidateQuality = Math.min(
		reliablePassRate(grouped["optimized-batch"]),
		reliablePassRate(grouped.streaming),
	);
	if (candidateQuality < baselineQuality) return "negative";
	if (benchmark.runs.some((run) => !runPassed(run))) return "neutral";
	const baselineElapsed = Math.min(
		medianElapsed(grouped.serial),
		medianElapsed(grouped["current-batch"]),
	);
	const interventionGroups = [grouped["optimized-batch"], grouped.streaming]
		.map((runs) =>
			runs.filter((run) => scheduleIntervened(run, grouped["current-batch"])),
		)
		.filter((runs) => runs.length > 0);
	if (interventionGroups.length === 0) return "neutral";
	const candidateElapsed = Math.min(...interventionGroups.map(medianElapsed));
	if (candidateQuality > baselineQuality) return "positive";
	if (candidateElapsed < baselineElapsed * SCORING_CONTRACT.positiveSpeedRatio)
		return "positive";
	if (candidateElapsed > baselineElapsed * SCORING_CONTRACT.negativeSpeedRatio)
		return "negative";
	return "neutral";
}

function passRate(runs) {
	return runs.filter(runPassed).length / runs.length;
}

function scheduleIntervened(run, currentRuns) {
	// streaming 只认 completion-fill；optimized 只认与 current 的完整 launch 序列差异。
	if (run.arm === "streaming")
		return run.schedule.some(
			(event) =>
				event.type === "launch" &&
				Array.isArray(event.active) &&
				event.active.length > event.goalIndexes.length,
		);
	if (run.arm !== "optimized-batch") return false;
	const current = currentRuns.find(
		(item) => item.repetition === run.repetition,
	);
	return (
		stableJson(launchSequence(run)) !== stableJson(launchSequence(current))
	);
}

function launchSequence(run) {
	return (run?.schedule ?? [])
		.filter((event) => event.type === "launch")
		.map((event) => ({
			goalIndexes: event.goalIndexes,
			active: event.active ?? [],
		}));
}

function reliablePassRate(runs) {
	return runs.filter(runReliable).length / runs.length;
}

function runReliable(run) {
	return (
		runPassed(run) &&
		run.attempts.length === 1 &&
		run.attempts[0]?.classification === "none" &&
		run.attempts[0]?.outcome === "complete" &&
		run.metrics?.processErrors === 0
	);
}

function runPassed(run) {
	return (
		run.terminalOutcome === "complete" &&
		run.oracle?.ok === true &&
		run.repositoryClean === true &&
		run.metrics?.acceptancePassed === true &&
		run.metrics?.qualityPassed === true
	);
}

function medianElapsed(runs) {
	const values = runs
		.filter(runReliable)
		.map((run) => run.metrics?.elapsedMs)
		.filter(Number.isFinite)
		.sort((left, right) => left - right);
	return values[Math.floor(values.length / 2)] ?? Number.POSITIVE_INFINITY;
}

function sensitiveArtifactValue(value, key = "") {
	if (
		/^(?:absolutePath|assistantText|messages?|modelText|output|prompt|rawOutput|session|sessionFile|stderr|stdout|transcript)$/u.test(
			key,
		)
	)
		return true;
	if (typeof value === "string" && isAbsolutePathString(value)) return true;
	if (Array.isArray(value))
		return value.some((item) => sensitiveArtifactValue(item));
	if (!value || typeof value !== "object") return false;
	return Object.entries(value).some(([childKey, child]) =>
		sensitiveArtifactValue(child, childKey),
	);
}

function isAbsolutePathString(value) {
	if (typeof value !== "string" || value.length === 0) return false;
	if (value.startsWith("/") || value.startsWith("\\")) return true;
	if (/^[A-Za-z]:[\\/]/.test(value)) return true;
	return false;
}

function section(markdown, title) {
	const lines = markdown.split(/\r?\n/u);
	const start = lines.findIndex((line) => line.trim() === `## ${title}`);
	if (start < 0) return "";
	const end = lines.findIndex(
		(line, index) => index > start && /^##\s+/u.test(line),
	);
	return lines
		.slice(start + 1, end < 0 ? undefined : end)
		.join("\n")
		.trim();
}

function lastCheckResult(checks, phase) {
	return checks?.[phase]?.rounds?.at(-1)?.result ?? "missing";
}

function listFiles(dir) {
	return readdirSync(dir, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(dir, entry.name);
			return entry.isDirectory() ? listFiles(path) : [path];
		})
		.sort();
}

function defaultDependencies(index) {
	return index === 0 ? [] : [index - 1];
}

function nonEmpty(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function sortedUnique(values) {
	return [...new Set(values)].sort((left, right) => left - right);
}

function deepFreeze(value) {
	Object.freeze(value);
	for (const child of Object.values(value))
		if (child && typeof child === "object" && !Object.isFrozen(child))
			deepFreeze(child);
	return value;
}
