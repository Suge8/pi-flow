import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const evaluator = await import(
	pathToFileURL(join(root, "scripts/graph-flow-evaluation.mjs")).href
);
const cli = await import(
	pathToFileURL(join(root, "scripts/evaluate-graph-flow.mjs")).href
);
const { sessionStats } = await import(
	pathToFileURL(join(root, "scripts/evaluate-prewalk.mjs")).href
);

assert.deepEqual(cli.parseCliArgs([]), {
	dryRun: false,
	fixtures: undefined,
	output: undefined,
	runsPerArm: 1,
	verifyArtifact: undefined,
	workerBudget: 2,
});
assert.deepEqual(
	cli.parseCliArgs([
		"--fixtures",
		"scope-conflict,uneven-fork-join",
		"--runs",
		"3",
		"--worker-budget",
		"4",
		"--output",
		"out.json",
	]),
	{
		dryRun: false,
		fixtures: ["scope-conflict", "uneven-fork-join"],
		output: "out.json",
		runsPerArm: 3,
		verifyArtifact: undefined,
		workerBudget: 4,
	},
);
for (const args of [
	["--runs", "0"],
	["--runs", "4"],
	["--worker-budget", "x"],
	["--wat"],
	["--verify-artifact", "x", "--output", "y"],
	["--verify-artifact", "x", "--runs", "2"],
])
	assert.throws(() => cli.parseCliArgs(args));

const dryRun = JSON.parse(
	execFileSync(
		process.execPath,
		[join(root, "scripts/evaluate-graph-flow.mjs"), "--dry-run"],
		{
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	),
);
assert.equal(dryRun.runs, 12, "default dry-run must announce all 3 × 4 arms");
assert.deepEqual(dryRun.benchmarks, [
	"historical-cross-module",
	"scope-conflict",
	"uneven-fork-join",
]);
const subsetDryRun = JSON.parse(
	execFileSync(
		process.execPath,
		[
			join(root, "scripts/evaluate-graph-flow.mjs"),
			"--dry-run",
			"--fixtures",
			"uneven-fork-join",
		],
		{
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	),
);
const evaluationContract = JSON.parse(
	readFileSync(
		join(root, "tests/fixtures/graph-flow/evaluation-contract.json"),
		"utf8",
	),
);
assert.equal(
	subsetDryRun.modelFingerprint,
	evaluator.modelFingerprint(evaluationContract.config.modelRoles),
	"dry-run model fingerprint must come from the committed evaluation contract",
);
assert.equal(
	subsetDryRun.evaluationConfigFingerprint,
	evaluator.sha256(evaluator.stableJson(evaluationContract)),
);

for (const id of dryRun.benchmarks) {
	const dir = join(root, "tests/fixtures/graph-flow", id);
	const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
	assert.deepEqual(
		evaluator.validateBenchmark(manifest, dir),
		[],
		`${id} fixture fingerprint and contract must be valid`,
	);
	assert.throws(
		() =>
			execFileSync(manifest.oracle.command, manifest.oracle.args, {
				cwd: join(dir, "repo"),
				stdio: "pipe",
			}),
		`${id} initial snapshot must fail its behavior oracle`,
	);
}
const driftRoot = mkdtempSync(join(tmpdir(), "graph-fixture-drift-"));
try {
	const source = join(root, "tests/fixtures/graph-flow/uneven-fork-join");
	cpSync(source, driftRoot, { recursive: true });
	writeFileSync(join(driftRoot, "repo/untracked.js"), "export {};\n");
	const manifest = JSON.parse(
		readFileSync(join(driftRoot, "manifest.json"), "utf8"),
	);
	assert.match(
		evaluator.validateBenchmark(manifest, driftRoot).join(";"),
		/fingerprint drifted/u,
	);
} finally {
	rmSync(driftRoot, { recursive: true, force: true });
}

const expectedGraph = [
	{ file: "G1.md", dependsOn: [], writeScope: ["src/a/**"] },
	{ file: "G2.md", dependsOn: [0], writeScope: ["src/b/**"] },
];
const plannedFlow = {
	status: "draft",
	goals: expectedGraph.map((goal, index) => ({
		...goal,
		index,
		role: "normal",
	})),
};
assert.deepEqual(
	evaluator.validatePlannedGraph(plannedFlow, { expectedGraph }),
	[],
);
assert.match(
	evaluator
		.validatePlannedGraph(
			{
				...plannedFlow,
				goals: plannedFlow.goals.map((goal, index) =>
					index === 1 ? { ...goal, dependsOn: [] } : goal,
				),
			},
			{ expectedGraph },
		)
		.join(";"),
	/dependencies differ/u,
);

assert.equal(
	evaluator.classifyFailure(new Error("429 rate limit")),
	"rate_limit",
);
assert.equal(evaluator.classifyFailure(new Error("ECONNRESET")), "network");
assert.equal(evaluator.classifyFailure(new Error("oracle failed")), "quality");
let retryCalls = 0;
const retried = await evaluator.withInfrastructureRetries(() => {
	retryCalls += 1;
	if (retryCalls < 3) throw new Error("rate limit");
	return "ok";
});
assert.equal(retried.value, "ok");
assert.equal(retryCalls, 3);
let attemptCall = 0;
const timestamps = [0, 30, 30, 80];
const measuredRetry = await evaluator.withInfrastructureRetries(
	() => {
		attemptCall += 1;
		if (attemptCall === 1) {
			const error = new Error("rate limit");
			error.attemptMetrics = { cost: 0.1, calls: 1, tokens: 10 };
			throw error;
		}
		return { metrics: { cost: 0.2, calls: 2, tokens: 20 } };
	},
	3,
	() => timestamps.shift(),
);
assert.deepEqual(measuredRetry.attempts, [
	{
		attempt: 1,
		classification: "rate_limit",
		outcome: "failed",
		elapsedMs: 30,
		cost: 0.1,
		calls: 1,
		tokens: 10,
		metricsComplete: true,
	},
	{
		attempt: 2,
		classification: "none",
		outcome: "complete",
		elapsedMs: 50,
		cost: 0.2,
		calls: 2,
		tokens: 20,
		metricsComplete: true,
	},
]);
assert.deepEqual(evaluator.summarizeAttempts(measuredRetry.attempts), {
	totalAttemptElapsedMs: 80,
	totalAttemptCost: 0.30000000000000004,
	totalAttemptCalls: 3,
	totalAttemptTokens: 30,
	attemptMetricsComplete: true,
});
const retrySessionRoot = mkdtempSync(join(tmpdir(), "graph-retry-session-"));
try {
	const retrySession = join(retrySessionRoot, "failed.jsonl");
	let sessionAttempt = 0;
	const retryTimestamps = [0, 10, 10, 30];
	const sessionRetry = await evaluator.withInfrastructureRetries(
		() => {
			sessionAttempt += 1;
			if (sessionAttempt === 1) {
				writeFileSync(
					retrySession,
					`${JSON.stringify({ type: "session" })}\n${JSON.stringify({
						type: "message",
						message: {
							role: "assistant",
							content: [],
							usage: {
								input: 10,
								output: 5,
								cacheRead: 2,
								cacheWrite: 1,
								cost: { total: 0.4 },
							},
						},
					})}\n`,
				);
				throw cli.attachSessionAttemptMetrics(
					new Error("rate limit"),
					[retrySession],
					sessionStats,
				);
			}
			return { metrics: { cost: 0.2, calls: 2, tokens: 20 } };
		},
		3,
		() => retryTimestamps.shift(),
	);
	assert.deepEqual(sessionRetry.attempts[0], {
		attempt: 1,
		classification: "rate_limit",
		outcome: "failed",
		elapsedMs: 10,
		cost: 0.4,
		calls: 1,
		tokens: 18,
		metricsComplete: true,
	});
	const damaged = join(retrySessionRoot, "damaged.jsonl");
	writeFileSync(damaged, "{not-json\n");
	assert.equal(
		cli.collectSessionAttemptMetrics([retrySession, damaged], sessionStats),
		undefined,
		"one readable and one damaged Session must not partially aggregate usage",
	);
	assert.equal(
		cli.collectSessionAttemptMetrics(
			[retrySession, join(retrySessionRoot, "missing.jsonl")],
			sessionStats,
		),
		undefined,
		"a missing expected Session must make attempt usage unknown",
	);
} finally {
	rmSync(retrySessionRoot, { recursive: true, force: true });
}
assert.deepEqual(
	evaluator.deriveCheckFlags([
		{ acceptance: { rounds: [] }, quality: { rounds: [] } },
	]),
	{
		acceptancePassed: false,
		qualityPassed: false,
		firstRoundPassed: false,
		repairRounds: 0,
	},
	"empty check rounds must not count as first-round passes",
);
const incompleteAttempts = [
	{
		attempt: 1,
		classification: "protocol",
		outcome: "failed",
		elapsedMs: 10,
		cost: null,
		calls: null,
		tokens: null,
		metricsComplete: false,
	},
	{
		attempt: 2,
		classification: "none",
		outcome: "complete",
		elapsedMs: 20,
		cost: 2,
		calls: 5,
		tokens: 50,
		metricsComplete: true,
	},
];
assert.deepEqual(evaluator.summarizeAttempts(incompleteAttempts), {
	totalAttemptElapsedMs: 30,
	totalAttemptCost: null,
	totalAttemptCalls: null,
	totalAttemptTokens: null,
	attemptMetricsComplete: false,
});
let qualityCalls = 0;
await assert.rejects(
	() =>
		evaluator.withInfrastructureRetries(() => {
			qualityCalls += 1;
			throw new Error("oracle failed");
		}),
	/oracle failed/u,
);
assert.equal(qualityCalls, 1, "quality failures must never be retried");

const packetRoot = mkdtempSync(join(tmpdir(), "graph-packet-"));
try {
	writeFileSync(
		join(packetRoot, "G1.md"),
		"# G1\n\n## Handoff\nUse exported alpha.\n",
	);
	const flow = {
		goals: [
			{ index: 0, file: "G1.md", dependsOn: [] },
			{ index: 1, file: "G2.md", dependsOn: [0] },
		],
	};
	const artifacts = {
		0: {
			completion: {
				summary: "alpha complete",
				checks: {
					acceptance: { rounds: [{ result: "passed" }] },
					quality: { rounds: [{ result: "passed" }] },
				},
			},
		},
	};
	const packet = evaluator.buildDependencyPacket(
		packetRoot,
		flow,
		1,
		artifacts,
		(text) => text.includes("criteria deviation"),
	);
	assert.equal(packet.predecessors[0].handoff, "Use exported alpha.");
	assert.equal(packet.predecessors[0].quality, "passed");
	assert.equal(Object.isFrozen(packet.predecessors[0]), true);
	assert.throws(() => {
		packet.predecessors[0].summary = "changed";
	});
	assert.throws(
		() => evaluator.buildDependencyPacket(packetRoot, flow, 1, {}, () => false),
		/missing completion credential/u,
	);
} finally {
	rmSync(packetRoot, { recursive: true, force: true });
}

const forkJoinDependencies = [[], [], [0], [1], [2, 3]];
assert.throws(
	() => evaluator.createCoordinatorState([]),
	/non-empty dependency graph/u,
);
let coordinator = evaluator.createCoordinatorState(forkJoinDependencies);
assert.deepEqual(evaluator.readyCoordinatorGoals(coordinator), [0, 1]);
coordinator = evaluator.startCoordinatorAttempt(
	coordinator,
	0,
	"old-0",
	"worker-0",
);
coordinator = evaluator.startCoordinatorAttempt(
	coordinator,
	1,
	"old-1",
	"worker-1",
);
assert.equal(evaluator.coordinatorResourceCount(coordinator), 2);
let reduced = evaluator.applyCoordinatorEvent(coordinator, {
	type: "completion",
	goalIndex: 0,
	attemptId: "old-0",
});
assert.equal(reduced.action, "complete");
assert.deepEqual(reduced.releasedResources, ["worker-0"]);
assert.deepEqual(
	evaluator.readyCoordinatorGoals(reduced.state),
	[2],
	"streaming may dispatch a newly ready branch while an unrelated root is active",
);
coordinator = evaluator.startCoordinatorAttempt(
	reduced.state,
	2,
	"old-2",
	"worker-2",
);
reduced = evaluator.applyCoordinatorEvent(coordinator, {
	type: "blocked",
	goalIndex: 2,
	attemptId: "old-2",
});
assert.equal(reduced.action, "blocked");
assert.equal(reduced.state.status, "blocked");
assert.deepEqual(reduced.cancelResources, ["worker-1", "worker-2"]);
assert.equal(evaluator.coordinatorResourceCount(reduced.state), 0);
assert.deepEqual(
	evaluator.readyCoordinatorGoals(reduced.state),
	[],
	"BLOCKED must prevent dispatch on unrelated branches",
);
assert.equal(
	evaluator.applyCoordinatorEvent(reduced.state, {
		type: "completion",
		goalIndex: 1,
		attemptId: "old-1",
	}).action,
	"stale",
	"late completion from a cancelled branch must be ignored",
);
const resumedBlocked = evaluator.applyCoordinatorEvent(reduced.state, {
	type: "resume",
});
assert.deepEqual(resumedBlocked.restartGoals, [1, 2]);
coordinator = resumedBlocked.state;
assert.deepEqual(coordinator.completed, [0]);
assert.deepEqual(
	evaluator.readyCoordinatorGoals(coordinator),
	[1, 2],
	"resume restarts only unfinished Goals whose dependencies are complete",
);
assert.equal(
	evaluator.startCoordinatorAttempt(
		coordinator,
		0,
		"duplicate",
		"worker-duplicate",
	),
	coordinator,
	"completed Goals must never restart",
);

let missingCompletion = evaluator.createCoordinatorState([[], []]);
missingCompletion = evaluator.startCoordinatorAttempt(
	missingCompletion,
	0,
	"exit-0",
	"exit-worker-0",
);
missingCompletion = evaluator.startCoordinatorAttempt(
	missingCompletion,
	1,
	"exit-1",
	"exit-worker-1",
);
reduced = evaluator.applyCoordinatorEvent(missingCompletion, {
	type: "exit",
	goalIndex: 0,
	attemptId: "exit-0",
});
assert.equal(reduced.action, "missing_completion");
assert.equal(reduced.state.status, "stopped");
assert.deepEqual(reduced.state.failed, [0, 1]);
assert.deepEqual(reduced.cancelResources, ["exit-worker-0", "exit-worker-1"]);
assert.equal(evaluator.coordinatorResourceCount(reduced.state), 0);
assert.deepEqual(evaluator.readyCoordinatorGoals(reduced.state), []);
const resumedMissing = evaluator.applyCoordinatorEvent(reduced.state, {
	type: "resume",
});
assert.deepEqual(resumedMissing.restartGoals, [0, 1]);
coordinator = resumedMissing.state;
assert.deepEqual(evaluator.readyCoordinatorGoals(coordinator), [0, 1]);

let completionRace = evaluator.createCoordinatorState([[]]);
completionRace = evaluator.startCoordinatorAttempt(
	completionRace,
	0,
	"race-0",
	"race-worker-0",
);
reduced = evaluator.applyCoordinatorEvent(completionRace, {
	type: "completion",
	goalIndex: 0,
	attemptId: "race-0",
});
assert.equal(reduced.action, "complete");
assert.equal(evaluator.coordinatorResourceCount(reduced.state), 0);
assert.equal(
	evaluator.applyCoordinatorEvent(reduced.state, {
		type: "exit",
		goalIndex: 0,
		attemptId: "race-0",
	}).action,
	"stale",
	"completion followed by exit must settle once",
);

for (const type of ["stop", "console_switch"]) {
	let stopped = evaluator.createCoordinatorState([[], []]);
	stopped = evaluator.startCoordinatorAttempt(
		stopped,
		0,
		`${type}-0`,
		`${type}-worker-0`,
	);
	stopped = evaluator.startCoordinatorAttempt(
		stopped,
		1,
		`${type}-1`,
		`${type}-worker-1`,
	);
	reduced = evaluator.applyCoordinatorEvent(stopped, { type });
	assert.equal(reduced.state.status, "stopped");
	assert.equal(reduced.state.stopReason, type);
	assert.equal(evaluator.coordinatorResourceCount(reduced.state), 0);
	assert.deepEqual(reduced.state.failed, [0, 1]);
	assert.equal(reduced.cancelResources.length, 2);
}

const coordinatorRoot = mkdtempSync(join(tmpdir(), "graph-coordinator-"));
try {
	const flowDir = join(coordinatorRoot, "F1");
	const sessions = join(coordinatorRoot, "sessions");
	mkdirSync(flowDir);
	mkdirSync(sessions);
	for (const index of [0, 1, 2])
		writeFileSync(
			join(flowDir, `G${index + 1}.md`),
			`# G${index + 1}\n\n## Handoff\nG${index + 1} done.\n`,
		);
	const flow = fakeCoordinatorFlow();
	const completed = fakeCoordinatorRuntime([
		"complete",
		"complete",
		"complete",
	]);
	const completedResult = await cli.runCoordinatedArm({
		arm: "current-batch",
		fixture: coordinatorRoot,
		flow,
		flowDir,
		manifest: { id: "coordinator-smoke" },
		rootSessions: new Map([
			[0, join(sessions, "root-0.jsonl")],
			[1, join(sessions, "root-1.jsonl")],
		]),
		runId: "complete-run",
		runtime: completed.runtime,
		sessions,
		workerBudget: 2,
	});
	assert.equal(completedResult.terminalOutcome, "complete");
	assert.equal(completedResult.resourcesRemaining, 0);
	assert.deepEqual(completed.launched, [0, 1, 2]);
	assert.deepEqual(completed.cancelled, []);

	const blocked = fakeCoordinatorRuntime(["blocked", "hold", "complete"]);
	const blockedResult = await cli.runCoordinatedArm({
		arm: "current-batch",
		fixture: coordinatorRoot,
		flow: fakeCoordinatorFlow(),
		flowDir,
		manifest: { id: "coordinator-smoke" },
		rootSessions: new Map([
			[0, join(sessions, "blocked-0.jsonl")],
			[1, join(sessions, "blocked-1.jsonl")],
		]),
		runId: "blocked-run",
		runtime: blocked.runtime,
		sessions,
		workerBudget: 2,
	});
	assert.equal(blockedResult.terminalOutcome, "blocked");
	assert.equal(blockedResult.resourcesRemaining, 0);
	assert.deepEqual(blocked.launched, [0, 1]);
	assert.deepEqual(blocked.cancelled, [1]);
	assert.equal(
		blocked.launched.includes(2),
		false,
		"real coordinator must not dispatch a dependent branch after BLOCKED",
	);

	const blockedWithProcessError = fakeCoordinatorRuntime(
		["blocked", "hold", "complete"],
		{ 0: [{ type: "process_error", error: "worker startup failed" }] },
	);
	const blockedWithErrorResult = await cli.runCoordinatedArm({
		arm: "current-batch",
		fixture: coordinatorRoot,
		flow: fakeCoordinatorFlow(),
		flowDir,
		manifest: { id: "coordinator-smoke" },
		rootSessions: new Map([
			[0, join(sessions, "blocked-error-0.jsonl")],
			[1, join(sessions, "blocked-error-1.jsonl")],
		]),
		runId: "blocked-error-run",
		runtime: blockedWithProcessError.runtime,
		sessions,
		workerBudget: 2,
	});
	assert.equal(
		blockedWithErrorResult.terminalOutcome,
		"blocked",
		"a trusted BLOCKED handoff must not be retried as process startup failure",
	);

	const completedWithProcessError = fakeCoordinatorRuntime(
		["complete", "complete", "complete"],
		{ 0: [{ type: "process_error", error: "late worker error" }] },
	);
	const completedWithErrorResult = await cli.runCoordinatedArm({
		arm: "current-batch",
		fixture: coordinatorRoot,
		flow: fakeCoordinatorFlow(),
		flowDir,
		manifest: { id: "coordinator-smoke" },
		rootSessions: new Map([
			[0, join(sessions, "complete-error-0.jsonl")],
			[1, join(sessions, "complete-error-1.jsonl")],
		]),
		runId: "complete-error-run",
		runtime: completedWithProcessError.runtime,
		sessions,
		workerBudget: 2,
	});
	assert.equal(completedWithErrorResult.terminalOutcome, "complete");
	assert.deepEqual(completedWithErrorResult.processErrorClassifications, {
		process_start: 1,
		protocol: 0,
	});

	const bareExit = fakeCoordinatorRuntime(["exit", "hold", "complete"]);
	await assert.rejects(
		() =>
			cli.runCoordinatedArm({
				arm: "current-batch",
				fixture: coordinatorRoot,
				flow: fakeCoordinatorFlow(),
				flowDir,
				manifest: { id: "coordinator-smoke" },
				rootSessions: new Map([
					[0, join(sessions, "exit-0.jsonl")],
					[1, join(sessions, "exit-1.jsonl")],
				]),
				runId: "exit-run",
				runtime: bareExit.runtime,
				sessions,
				workerBudget: 2,
			}),
		/protocol worker failure/u,
		"exit without completion/handoff must be a retryable protocol failure",
	);

	let exitAttempts = 0;
	const recovered = await evaluator.withInfrastructureRetries(async () => {
		exitAttempts += 1;
		const outcomes =
			exitAttempts < 3
				? ["exit", "hold", "complete"]
				: ["complete", "complete", "complete"];
		return cli.runCoordinatedArm({
			arm: "current-batch",
			fixture: coordinatorRoot,
			flow: fakeCoordinatorFlow(),
			flowDir,
			manifest: { id: "coordinator-smoke" },
			rootSessions: new Map([
				[0, join(sessions, `exit-retry-0-${exitAttempts}.jsonl`)],
				[1, join(sessions, `exit-retry-1-${exitAttempts}.jsonl`)],
			]),
			runId: `exit-retry-${exitAttempts}`,
			runtime: fakeCoordinatorRuntime(outcomes).runtime,
			sessions,
			workerBudget: 2,
		});
	});
	assert.equal(recovered.value.terminalOutcome, "complete");
	assert.equal(exitAttempts, 3);
	assert.equal(recovered.attempts.length, 3);
	assert.equal(recovered.attempts[0].classification, "protocol");
	assert.equal(recovered.attempts[0].outcome, "failed");
	assert.ok(
		recovered.attempts[0].evidence?.schedule?.length > 0,
		"failed protocol attempt must keep schedule evidence",
	);
	assert.equal(recovered.attempts[2].classification, "none");
	assert.equal(recovered.attempts[2].outcome, "complete");

	// 重试耗尽：每次失败 attempt 都带 schedule evidence
	let exhausted;
	try {
		await evaluator.withInfrastructureRetries(async (attempt) =>
			cli.runCoordinatedArm({
				arm: "serial",
				fixture: coordinatorRoot,
				flow: fakeCoordinatorFlow(),
				flowDir,
				manifest: { id: "coordinator-smoke" },
				rootSessions: new Map([
					[0, join(sessions, `exit-exhaust-0-${attempt}.jsonl`)],
					[1, join(sessions, `exit-exhaust-1-${attempt}.jsonl`)],
				]),
				runId: `exit-exhaust-${attempt}`,
				runtime: fakeCoordinatorRuntime(["exit", "hold", "complete"]).runtime,
				sessions,
				workerBudget: 2,
			}),
		);
	} catch (error) {
		exhausted = error;
	}
	assert.ok(exhausted?.attempts?.length === 3);
	assert.ok(
		exhausted.attempts.every(
			(attempt) =>
				attempt.classification === "protocol" &&
				attempt.evidence?.schedule?.some((event) => event.type === "launch"),
		),
		"exhausted protocol failures must keep per-attempt launch evidence",
	);
} finally {
	rmSync(coordinatorRoot, { recursive: true, force: true });
}

assert.equal(
	evaluator.classifyMissingWorkerExit({ code: 0, signal: null, stderr: "" }),
	"protocol",
);
assert.equal(
	evaluator.classifyMissingWorkerExit({ code: 1, signal: null, stderr: "" }),
	"process_start",
);
assert.equal(
	evaluator.classifyMissingWorkerExit({
		code: 0,
		signal: "SIGTERM",
		stderr: "",
	}),
	"process_start",
);

const armPostprocessRoot = mkdtempSync(
	join(tmpdir(), "graph-arm-postprocess-"),
);
try {
	const benchmarkDir = join(armPostprocessRoot, "benchmark");
	const sourceRepo = join(benchmarkDir, "repo");
	const sourceFlowDir = join(armPostprocessRoot, "planned-flow");
	const plannerSession = join(armPostprocessRoot, "planner.jsonl");
	const work = join(armPostprocessRoot, "work");
	mkdirSync(sourceRepo, { recursive: true });
	mkdirSync(sourceFlowDir, { recursive: true });
	mkdirSync(work);
	writeFileSync(join(sourceRepo, "package.json"), '{"type":"module"}\n');
	const flow = fakeCoordinatorFlow();
	for (const goal of flow.goals)
		writeFileSync(
			join(sourceFlowDir, goal.file),
			`# G${goal.index + 1}\n\n## Handoff\nDone.\n`,
		);
	writeFileSync(
		plannerSession,
		`${JSON.stringify({ type: "session", id: "planner" })}\n`,
	);
	const completed = fakeCoordinatorRuntime([
		"complete",
		"complete",
		"complete",
	]);
	let injectPostprocessFailure = true;
	let branchNumber = 0;
	const runtime = {
		...completed.runtime,
		SessionManager: {
			open() {
				return {
					createBranchedSession() {
						const path = join(
							armPostprocessRoot,
							`branch-${++branchNumber}.jsonl`,
						);
						writeFileSync(
							path,
							`${[
								JSON.stringify({
									type: "session",
									id: `branch-${branchNumber}`,
									parentSession: plannerSession,
								}),
								JSON.stringify({ type: "custom", id: "plan-leaf" }),
								JSON.stringify({
									type: "message",
									message: {
										role: "assistant",
										content: [],
										usage: {
											input: 10,
											output: 5,
											cacheRead: 2,
											cacheWrite: 1,
											cost: { total: 0.4 },
										},
									},
								}),
							].join("\n")}\n`,
						);
						return path;
					},
				};
			},
		},
		sessionStats(jsonl, anchor) {
			if (injectPostprocessFailure) {
				injectPostprocessFailure = false;
				const error = new Error("protocol postprocess failure");
				error.code = "protocol";
				throw error;
			}
			return sessionStats(jsonl, anchor);
		},
	};
	const retriedArm = await evaluator.withInfrastructureRetries((attempt) =>
		cli.runArmAttempt({
			arm: "current-batch",
			attempt,
			dir: benchmarkDir,
			flow,
			flowDir: sourceFlowDir,
			manifest: {
				id: "postprocess-smoke",
				allowedChanges: [],
				oracle: { command: process.execPath, args: ["-e", ""] },
			},
			planLeaf: "plan-leaf",
			plannerSession,
			repetition: 0,
			runtime,
			work,
			workerBudget: 2,
		}),
	);
	assert.deepEqual(
		retriedArm.attempts[0],
		{
			attempt: 1,
			classification: "protocol",
			outcome: "failed",
			elapsedMs: retriedArm.attempts[0].elapsedMs,
			cost: 0.8,
			calls: 2,
			tokens: 36,
			metricsComplete: true,
		},
		"postprocessing failure must retain usage from worker Sessions before retry",
	);
} finally {
	rmSync(armPostprocessRoot, { recursive: true, force: true });
}

function fakeCoordinatorFlow() {
	return {
		id: "F1",
		status: "draft",
		startedAt: null,
		completedAt: null,
		currentGoal: 0,
		parallelRun: null,
		goals: [
			fakeCoordinatorGoal(0, []),
			fakeCoordinatorGoal(1, []),
			fakeCoordinatorGoal(2, [1]),
		],
	};
}

function fakeCoordinatorGoal(index, dependsOn) {
	return {
		index,
		file: `G${index + 1}.md`,
		dependsOn,
		status: "pending",
		startedAt: null,
		completedAt: null,
		snapshot: null,
		checks: {
			acceptance: { enabled: true, rounds: [], active: null },
			quality: { enabled: true, rounds: [], active: null },
		},
	};
}

function fakeCoordinatorRuntime(outcomes, events = {}) {
	const artifacts = new Map();
	const launched = [];
	const cancelled = [];
	const ready = (flow) =>
		flow.goals
			.filter(
				(goal) =>
					goal.status === "pending" &&
					goal.dependsOn.every(
						(index) => flow.goals[index].status === "complete",
					),
			)
			.map((goal) => goal.index);
	return {
		cancelled,
		launched,
		runtime: {
			computeReadyBatch(flow) {
				const indices = ready(flow);
				return indices.length ? { indices } : null;
			},
			hasCriteriaDeviation: () => false,
			initWorkerArtifact(_dir, _flow, goalIndex) {
				artifacts.set(goalIndex, { completion: null, handoff: null });
			},
			readWorkerArtifact(_dir, goalIndex) {
				return artifacts.get(goalIndex);
			},
			spawnWorker({ goalIndex, sessionFile }) {
				launched.push(goalIndex);
				if (sessionFile && !existsSync(sessionFile)) {
					mkdirSync(dirname(sessionFile), { recursive: true });
					writeFileSync(
						sessionFile,
						`${JSON.stringify({ type: "session", id: `g${goalIndex}` })}\n`,
					);
				}
				const eventCallbacks = new Set();
				let exitCallback = () => undefined;
				let exited = false;
				const settle = (signal = null) => {
					if (exited) return;
					exited = true;
					const outcome = outcomes[goalIndex];
					if (outcome === "complete")
						artifacts.set(goalIndex, fakeCompletedArtifact(goalIndex));
					else if (outcome === "blocked")
						artifacts.set(goalIndex, {
							completion: null,
							handoff: { message: "blocked" },
						});
					else if (outcome === "exit")
						artifacts.set(goalIndex, {
							completion: null,
							handoff: null,
						});
					exitCallback(signal ? null : 0, signal, null);
				};
				return {
					onEvent(callback) {
						eventCallbacks.add(callback);
						return () => eventCallbacks.delete(callback);
					},
					onExit(callback) {
						exitCallback = callback;
						if (outcomes[goalIndex] !== "hold")
							queueMicrotask(() => {
								for (const event of events[goalIndex] ?? [])
									for (const notify of eventCallbacks) notify(event);
								settle();
							});
						return () => undefined;
					},
					kill() {
						if (exited) return;
						cancelled.push(goalIndex);
						settle("SIGTERM");
					},
				};
			},
			watchBatchResults() {
				return () => undefined;
			},
			workerArtifactPath(_dir, goalIndex) {
				return `G${goalIndex + 1}-worker.json`;
			},
			workerInitialPrompt() {
				return "execute";
			},
			writeFlow(_dir, nextFlow) {
				return nextFlow;
			},
		},
	};
}

function fakeCompletedArtifact(goalIndex) {
	return {
		handoff: null,
		completion: {
			goalId: `goal-${goalIndex}`,
			summary: `G${goalIndex + 1} complete`,
			acceptance: "passed",
			sessionFile: null,
			checks: {
				acceptance: {
					enabled: true,
					rounds: [{ round: 1, result: "passed", summary: "passed" }],
					active: null,
				},
				quality: {
					enabled: true,
					rounds: [{ round: 1, result: "passed", summary: "passed" }],
					active: null,
				},
			},
		},
	};
}

const successfulAttempt = (elapsedMs, cost = 0, calls = 1, tokens = 1) => ({
	attempt: 1,
	classification: "none",
	outcome: "complete",
	elapsedMs,
	cost,
	calls,
	tokens,
	metricsComplete: true,
});
const makeRun = (arm, elapsedMs, passed = true, goalIndex = 0) => ({
	arm,
	repetition: 1,
	terminalOutcome: passed ? "complete" : "oracle_failed",
	attempts: [successfulAttempt(elapsedMs)],
	oracle: { executed: true, ok: passed },
	repositoryClean: passed,
	schedule: [
		{
			sequence: 1,
			type: "launch",
			goalIndexes: [goalIndex],
			active: [goalIndex],
			elapsedMs: 0,
		},
		{
			sequence: 2,
			type: "completion",
			goalIndexes: [goalIndex],
			active: [],
			elapsedMs,
		},
	],
	packetFingerprints: { [goalIndex]: "f".repeat(64) },
	metrics: {
		elapsedMs,
		acceptancePassed: passed,
		qualityPassed: passed,
		firstRoundPassed: passed,
		repairRounds: 0,
		processErrors: 0,
		processErrorClassifications: { process_start: 0, protocol: 0 },
		resourcesRemaining: 0,
		prewalkHits: 1,
		prewalkExpected: 1,
		calls: 1,
		tokens: 1,
		cost: 0,
		readCalls: 0,
		bashCalls: 1,
		totalAttemptElapsedMs: elapsedMs,
		totalAttemptCost: 0,
		totalAttemptCalls: 1,
		totalAttemptTokens: 1,
		attemptMetricsComplete: true,
	},
});

function syntheticCompleteArtifact(
	evaluator,
	evaluationContract,
	options = {},
) {
	const id = options.id ?? "uneven-fork-join";
	const fixtureDir = join(root, "tests/fixtures/graph-flow", id);
	const manifest = JSON.parse(
		readFileSync(join(fixtureDir, "manifest.json"), "utf8"),
	);
	const graph = options.graph ?? evaluator.evaluationGraph(manifest);
	const benchmarkIndex = options.benchmarkIndex ?? 0;
	const armOrder = evaluator.expectedArmOrder(benchmarkIndex, 1);
	const arms = armOrder[0];
	const schedule = [];
	let sequence = 1;
	let clock = 0;
	for (let goalIndex = 0; goalIndex < graph.length; goalIndex += 1) {
		schedule.push({
			sequence,
			type: "launch",
			goalIndexes: [goalIndex],
			active: [goalIndex],
			elapsedMs: clock,
		});
		sequence += 1;
		clock += 10;
		schedule.push({
			sequence,
			type: "completion",
			goalIndexes: [goalIndex],
			active: [],
			elapsedMs: clock,
		});
		sequence += 1;
	}
	const attempt = successfulAttempt(clock);
	const attemptSummary = evaluator.summarizeAttempts([attempt]);
	const runs = arms.map((arm) => ({
		...makeRun(arm, clock, true, 0),
		arm,
		repetition: 1,
		schedule: schedule.map((event) => ({
			...event,
			goalIndexes: [...event.goalIndexes],
			active: [...event.active],
		})),
		packetFingerprints: Object.fromEntries(
			graph.map((_, goalIndex) => [String(goalIndex), "a".repeat(64)]),
		),
		metrics: {
			...makeRun(arm, clock, true, 0).metrics,
			elapsedMs: clock,
			totalAttemptElapsedMs: attemptSummary.totalAttemptElapsedMs,
			totalAttemptCost: attemptSummary.totalAttemptCost,
			totalAttemptCalls: attemptSummary.totalAttemptCalls,
			totalAttemptTokens: attemptSummary.totalAttemptTokens,
			attemptMetricsComplete: attemptSummary.attemptMetricsComplete,
		},
		attempts: [{ ...attempt }],
	}));
	const planningAttempts = [successfulAttempt(5)];
	const planningUsage = evaluator.usageMetricsFromAttempts(planningAttempts);
	const benchmarks = [
		{
			id,
			fingerprint: evaluator.sha256(evaluator.stableJson(manifest)),
			planFingerprint: "c".repeat(64),
			graph,
			planning: {
				status: "valid",
				attempts: planningAttempts,
				elapsedMs: planningUsage.totalAttemptElapsedMs,
				...planningUsage,
			},
			armOrder,
			runs,
		},
	];
	const scored = evaluator.decideEvaluation(benchmarks);
	const benchmarkIds = options.benchmarkIds ?? [id];
	return {
		schemaVersion: 1,
		benchmarkIds,
		benchmarkFingerprint: evaluator.benchmarkFingerprint([manifest]),
		evaluationConfigFingerprint: evaluator.sha256(
			evaluator.stableJson(evaluationContract),
		),
		modelFingerprint: evaluator.modelFingerprint(
			evaluationContract.config.modelRoles,
		),
		packetRuleFingerprint: evaluator.packetRuleFingerprint(),
		scorerFingerprint: evaluator.scorerFingerprint(),
		executorFingerprint: evaluator.executorFingerprint(),
		schedulerFingerprint: evaluator.schedulerFingerprint(),
		decision: scored.decision,
		directions: Object.fromEntries(
			benchmarks.map((benchmark, index) => [
				benchmark.id,
				scored.directions[index],
			]),
		),
		runsPerArm: 1,
		workerBudget: 2,
		benchmarks,
	};
}

// Attempt/schedule validators must use an explicit complete-run seed — never assume
// baseline.json[0] is complete (failed evals may leave planning_failure-only artifacts).
const completeSeed = syntheticCompleteArtifact(evaluator, evaluationContract);
assert.deepEqual(
	evaluator.validateArtifact(completeSeed),
	[],
	`synthetic complete seed must validate: ${evaluator.validateArtifact(completeSeed).join("; ")}`,
);
const contradictoryAttemptOutcome = structuredClone(completeSeed);
contradictoryAttemptOutcome.benchmarks[0].runs[0].attempts[0].outcome =
	"failed";
assert.match(
	evaluator.validateArtifact(contradictoryAttemptOutcome).join(";"),
	/attempts are invalid/u,
	"a complete run must end with a complete, unclassified attempt",
);
const contradictoryAttemptMetrics = structuredClone(completeSeed);
const incompleteAttempt =
	contradictoryAttemptMetrics.benchmarks[0].runs[0].attempts[0];
incompleteAttempt.cost = null;
incompleteAttempt.metricsComplete = true;
const incompleteMetrics =
	contradictoryAttemptMetrics.benchmarks[0].runs[0].metrics;
incompleteMetrics.totalAttemptCost = null;
incompleteMetrics.attemptMetricsComplete = true;
assert.match(
	evaluator.validateArtifact(contradictoryAttemptMetrics).join(";"),
	/attempts are invalid/u,
	"metricsComplete must exactly match the attempt usage fields",
);
const contradictoryRetryOrder = structuredClone(completeSeed);
const retryOrderRun = contradictoryRetryOrder.benchmarks[0].runs[0];
retryOrderRun.attempts = [
	{ ...retryOrderRun.attempts[0], outcome: "complete" },
	{ ...retryOrderRun.attempts[0], attempt: 2 },
];
Object.assign(
	retryOrderRun.metrics,
	evaluator.summarizeAttempts(retryOrderRun.attempts),
);
assert.match(
	evaluator.validateArtifact(contradictoryRetryOrder).join(";"),
	/attempts are invalid/u,
	"only retryable failed attempts may precede the final attempt",
);
const baselinePath = join(root, "tests/fixtures/graph-flow/baseline.json");
assert.equal(
	existsSync(baselinePath),
	true,
	"committed graph-flow baseline.json is required; run npm run eval:graph -- --output tests/fixtures/graph-flow/baseline.json",
);
{
	const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
	assert.deepEqual(
		evaluator.validateArtifact(baseline, {
			expectedBenchmarkIds: evaluationContract.benchmarks,
		}),
		[],
	);
	const baselineRuns = baseline.benchmarks.flatMap(
		(benchmark) => benchmark.runs,
	);
	assert.equal(
		baselineRuns.every(
			(run) => !(run.metrics.firstRoundPassed && !run.metrics.acceptancePassed),
		),
		true,
		"baseline must not claim first-round pass without acceptance",
	);
	const packetLeak = structuredClone(baseline);
	packetLeak.benchmarks[0].runs[0].packetFingerprints["999"] =
		"full raw model response: secret implementation detail";
	assert.match(
		evaluator.validateArtifact(packetLeak).join(";"),
		/packetFingerprints must exactly match/u,
	);
	const staleOob = structuredClone(baseline);
	const staleRun = staleOob.benchmarks[0].runs.find(
		(run) => run.terminalOutcome === "complete",
	);
	const last = staleRun.schedule.at(-1);
	staleRun.schedule.push({
		sequence: last.sequence + 1,
		type: "stale",
		goalIndexes: [999],
		elapsedMs: last.elapsedMs,
	});
	assert.match(
		evaluator.validateArtifact(staleOob).join(";"),
		/schedule is invalid|schedule replay failed/u,
		"stale goalIndexes must stay inside the manifest graph",
	);
	const postCompleteStale = structuredClone(baseline);
	const doneRun = postCompleteStale.benchmarks[0].runs.find(
		(run) => run.terminalOutcome === "complete",
	);
	const doneLast = doneRun.schedule.at(-1);
	doneRun.schedule.push({
		sequence: doneLast.sequence + 1,
		type: "stale",
		goalIndexes: [0],
		elapsedMs: doneLast.elapsedMs,
	});
	doneRun.metrics.elapsedMs = doneLast.elapsedMs;
	doneRun.metrics.totalAttemptElapsedMs = Math.max(
		doneRun.metrics.totalAttemptElapsedMs,
		doneLast.elapsedMs,
	);
	assert.match(
		evaluator.validateArtifact(postCompleteStale).join(";"),
		/schedule replay failed|terminal outcome does not match/u,
		"complete schedule must not accept events after all Goals settle",
	);
	// scorer 指纹 = evaluation 模块全文；改模块必 drift，连续调用稳定
	const evaluationSource = readFileSync(
		join(root, "scripts/graph-flow-evaluation.mjs"),
		"utf8",
	);
	const executorSource = readFileSync(
		join(root, "scripts/evaluate-graph-flow.mjs"),
		"utf8",
	);
	assert.equal(
		evaluator.scorerFingerprint(),
		evaluator.sha256(evaluationSource),
		"scorer fingerprint must be the evaluation module source hash",
	);
	assert.equal(
		evaluator.executorFingerprint(),
		evaluator.sha256(executorSource),
		"executor fingerprint must be the evaluate-graph-flow source hash",
	);
	assert.equal(
		evaluator.scorerFingerprint(),
		evaluator.scorerFingerprint(),
		"scorer fingerprint must be deterministic",
	);
	assert.notEqual(
		evaluator.sha256(`${evaluationSource}\n// score-drift-probe`),
		evaluator.scorerFingerprint(),
		"any evaluation source change must drift the scorer fingerprint",
	);
	assert.notEqual(
		evaluator.sha256(`${executorSource}\n// executor-drift-probe`),
		evaluator.executorFingerprint(),
		"any executor source change must drift the executor fingerprint",
	);
	// 摘要由 artifact 确定性派生，禁止模型撰写；与 JSON 同决策/耗时
	const summaryText = evaluator.formatEvaluationSummary(baseline);
	assert.match(summaryText, /结论.*expand/u);
	assert.match(summaryText, /streaming completion-fills: 1/u);
	assert.match(summaryText, /complete: 12\/12/u);
	assert.equal(
		summaryText,
		evaluator.formatEvaluationSummary(baseline),
		"summary must be deterministic",
	);
	assert.equal(
		evaluator.evaluationSummaryPath("tests/fixtures/graph-flow/baseline.json"),
		"tests/fixtures/graph-flow/baseline.summary.md",
	);
	const committedSummary = readFileSync(
		join(root, "tests/fixtures/graph-flow/baseline.summary.md"),
		"utf8",
	);
	assert.equal(
		committedSummary,
		summaryText,
		"committed baseline.summary.md must match artifact-derived text",
	);
	assert.deepEqual(
		evaluator.expectedArmOrder(0, 1),
		[evaluator.GRAPH_ARMS],
		"benchmark 0 repetition 0 starts at serial",
	);
	assert.deepEqual(
		evaluator.expectedArmOrder(1, 1),
		[["current-batch", "optimized-batch", "streaming", "serial"]],
		"benchmark 1 rotates one step",
	);
	assert.deepEqual(
		evaluator.expectedArmOrder(0, 2),
		[
			evaluator.GRAPH_ARMS,
			["current-batch", "optimized-batch", "streaming", "serial"],
		],
		"repetition advances the rotation",
	);
	const reversedArms = structuredClone(completeSeed);
	const reversedOrder = [...evaluator.GRAPH_ARMS].reverse();
	reversedArms.benchmarks[0].armOrder = [reversedOrder];
	reversedArms.benchmarks[0].runs = reversedOrder.map((arm) => {
		const run = reversedArms.benchmarks[0].runs.find(
			(item) => item.arm === arm,
		);
		assert.ok(run, `missing run for ${arm}`);
		return run;
	});
	assert.match(
		evaluator.validateArtifact(reversedArms).join(";"),
		/armOrder does not match rotation contract/u,
		"reversed armOrder must be rejected even when runs are reshuffled to match",
	);
	const executorTamper = structuredClone(completeSeed);
	executorTamper.executorFingerprint = evaluator.sha256("tampered-executor");
	assert.match(
		evaluator.validateArtifact(executorTamper).join(";"),
		/executorFingerprint does not match/u,
		"executor fingerprint drift must fail verification",
	);
	const scorerTamper = structuredClone(completeSeed);
	scorerTamper.scorerFingerprint = evaluator.sha256("tampered-scorer");
	assert.match(
		evaluator.validateArtifact(scorerTamper).join(";"),
		/scorerFingerprint does not match/u,
		"scorer fingerprint drift must fail verification",
	);
	const schedulerTamper = structuredClone(completeSeed);
	schedulerTamper.schedulerFingerprint = evaluator.sha256("tampered-scheduler");
	assert.match(
		evaluator.validateArtifact(schedulerTamper).join(";"),
		/schedulerFingerprint does not match/u,
		"scheduler fingerprint drift must fail verification",
	);
	assert.equal(
		evaluator.schedulerFingerprint(),
		evaluator.sha256(readFileSync(join(root, "src/flow/scheduler.ts"), "utf8")),
		"scheduler fingerprint must hash src/flow/scheduler.ts",
	);
	// 多 benchmark 合同：交换顺序 / 重复 positive 必须 fail closed
	const multiSeed = structuredClone(baseline);
	multiSeed.scorerFingerprint = evaluator.scorerFingerprint();
	multiSeed.executorFingerprint = evaluator.executorFingerprint();
	multiSeed.schedulerFingerprint = evaluator.schedulerFingerprint();
	multiSeed.evaluationConfigFingerprint = evaluator.sha256(
		evaluator.stableJson(evaluationContract),
	);
	multiSeed.benchmarkIds = evaluationContract.benchmarks;
	// keep arm orders aligned to canonical ids
	for (const [index, benchmark] of multiSeed.benchmarks.entries()) {
		const expected = evaluator.expectedArmOrder(index, multiSeed.runsPerArm);
		const byRep = new Map();
		for (const run of benchmark.runs) {
			if (!byRep.has(run.repetition)) byRep.set(run.repetition, new Map());
			byRep.get(run.repetition).set(run.arm, run);
		}
		benchmark.armOrder = expected;
		benchmark.runs = expected.flatMap((order, repOffset) =>
			order.map((arm) => byRep.get(repOffset + 1).get(arm)),
		);
	}
	assert.deepEqual(
		evaluator.validateArtifact(multiSeed),
		[],
		`multi seed must validate after provenance restamp: ${evaluator.validateArtifact(multiSeed).join("; ")}`,
	);
	const swapped = structuredClone(multiSeed);
	swapped.benchmarks = [
		multiSeed.benchmarks[1],
		multiSeed.benchmarks[0],
		multiSeed.benchmarks[2],
	];
	swapped.benchmarkIds = swapped.benchmarks.map((item) => item.id);
	for (const [index, benchmark] of swapped.benchmarks.entries()) {
		const expected = evaluator.expectedArmOrder(index, swapped.runsPerArm);
		const byRep = new Map();
		for (const run of benchmark.runs) {
			if (!byRep.has(run.repetition)) byRep.set(run.repetition, new Map());
			byRep.get(run.repetition).set(run.arm, run);
		}
		benchmark.armOrder = expected;
		benchmark.runs = expected.flatMap((order, repOffset) =>
			order.map((arm) => byRep.get(repOffset + 1).get(arm)),
		);
	}
	const swappedErrors = evaluator
		.validateArtifact(swapped, {
			expectedBenchmarkIds: evaluationContract.benchmarks,
		})
		.join(";");
	assert.match(
		swappedErrors,
		/benchmarkIds must match evaluation contract order|benchmarks must follow benchmarkIds/u,
		`swapped benchmarks must fail against contract: ${swappedErrors}`,
	);
	const duplicated = structuredClone(multiSeed);
	const positive = multiSeed.benchmarks.find(
		(item) => item.id === "scope-conflict",
	);
	duplicated.benchmarks = [0, 1, 2].map((index) => {
		const clone = structuredClone(positive);
		const expected = evaluator.expectedArmOrder(index, 1);
		const byRep = new Map();
		for (const run of clone.runs) {
			if (!byRep.has(run.repetition)) byRep.set(run.repetition, new Map());
			byRep.get(run.repetition).set(run.arm, run);
		}
		clone.armOrder = expected;
		clone.runs = expected.flatMap((order, repOffset) =>
			order.map((arm) => byRep.get(repOffset + 1).get(arm)),
		);
		return clone;
	});
	duplicated.benchmarkIds = duplicated.benchmarks.map((item) => item.id);
	const scoredDup = evaluator.decideEvaluation(duplicated.benchmarks);
	duplicated.decision = scoredDup.decision;
	duplicated.directions = Object.fromEntries(
		duplicated.benchmarks.map((benchmark, index) => [
			benchmark.id,
			scoredDup.directions[index],
		]),
	);
	assert.match(
		evaluator
			.validateArtifact(duplicated, {
				expectedBenchmarkIds: evaluationContract.benchmarks,
			})
			.join(";"),
		/duplicate benchmark id|benchmark ids must be unique|benchmarkIds must match evaluation contract order/u,
		"duplicated positive benchmarks must fail",
	);
	// AGENTS compact 摘要耗时必须与当前 baseline 一致（防止文档漂移）
	const agentsMd = readFileSync(join(root, "AGENTS.md"), "utf8");
	const arms = ["serial", "current-batch", "optimized-batch", "streaming"];
	for (const benchmark of baseline.benchmarks) {
		const row = arms
			.map((arm) =>
				Math.round(
					benchmark.runs.find((run) => run.arm === arm).metrics.elapsedMs /
						1000,
				),
			)
			.join("/");
		assert.match(
			agentsMd,
			new RegExp(row.replaceAll("/", "\\/")),
			`AGENTS.md must include baseline elapsed ${benchmark.id} ${row}`,
		);
	}
	const graphLeak = structuredClone(baseline);
	graphLeak.benchmarks[0].graph[0].debugText = "complete model response";
	assert.match(
		evaluator.validateArtifact(graphLeak).join(";"),
		/unknown field debugText/u,
	);
	const attemptLeak = structuredClone(baseline);
	attemptLeak.benchmarks[0].planning.attempts[0].debugText =
		"complete model response";
	assert.match(
		evaluator.validateArtifact(attemptLeak).join(";"),
		/unknown field debugText/u,
	);
	const pathLeakVar = structuredClone(baseline);
	pathLeakVar.debug = "/var/folders/abc/session.jsonl";
	assert.match(
		evaluator.validateArtifact(pathLeakVar).join(";"),
		/sensitive\/raw|unknown field/u,
	);
	const pathLeakWin = structuredClone(baseline);
	pathLeakWin.debug = "C:\\Users\\x\\session.jsonl";
	assert.match(
		evaluator.validateArtifact(pathLeakWin).join(";"),
		/sensitive\/raw|unknown field/u,
	);
	const completeOracleFalse = structuredClone(baseline);
	const completeRun = completeOracleFalse.benchmarks
		.flatMap((benchmark) => benchmark.runs)
		.find((run) => run.terminalOutcome === "complete");
	if (completeRun) {
		completeRun.oracle.ok = false;
		assert.match(
			evaluator.validateArtifact(completeOracleFalse).join(";"),
			/successful oracle|decision does not match/u,
		);
		const usageTamper = structuredClone(baseline);
		const usageRun = usageTamper.benchmarks
			.flatMap((benchmark) => benchmark.runs)
			.find((run) => run.terminalOutcome === "complete");
		usageRun.metrics.cost = 12345;
		usageRun.metrics.calls = 12345;
		usageRun.metrics.tokens = 12345;
		assert.match(
			evaluator.validateArtifact(usageTamper).join(";"),
			/metrics are incomplete/u,
		);
	}
	assert.equal(
		baselineRuns.length,
		12,
		`committed baseline must contain 12 runs, got ${baselineRuns.length}`,
	);
	assert.equal(
		baseline.decision,
		"expand",
		`committed baseline decision must be expand, got ${baseline.decision}`,
	);
	// Formal baseline is a frozen 12-run green artifact — not a place for residual failures.
	assert.equal(
		baselineRuns.every(
			(run) =>
				run.terminalOutcome === "complete" &&
				run.oracle.executed === true &&
				run.oracle.ok === true &&
				run.repositoryClean === true &&
				run.metrics.acceptancePassed === true &&
				run.metrics.qualityPassed === true &&
				run.metrics.prewalkHits === run.metrics.prewalkExpected &&
				(run.metrics.processErrors ?? 0) === 0,
		),
		true,
		`committed baseline must be 12/12 complete with oracle+checks green and processErrors=0; outcomes=${baselineRuns.map((run) => `${run.arm}:${run.terminalOutcome}`).join(",")}`,
	);
}
// Seed graph dependency order using a 2-goal complete seed.
const multiGoalSeed = syntheticCompleteArtifact(evaluator, evaluationContract, {
	graph: [
		{ dependsOn: [], writeScope: ["src/a/**"] },
		{ dependsOn: [0], writeScope: ["src/b/**"] },
	],
});
assert.deepEqual(evaluator.validateArtifact(multiGoalSeed), []);
const prematureMulti = structuredClone(multiGoalSeed);
const prematureRun = prematureMulti.benchmarks[0].runs.find(
	(run) => run.arm === "serial",
);
for (const event of prematureRun.schedule) {
	event.goalIndexes = event.goalIndexes.map((index) =>
		index === 0 ? 1 : index === 1 ? 0 : index,
	);
	if (event.active)
		event.active = event.active.map((index) =>
			index === 0 ? 1 : index === 1 ? 0 : index,
		);
}
assert.match(
	evaluator.validateArtifact(prematureMulti).join(";"),
	/schedule replay failed/u,
	"a Goal cannot launch before its dependencies complete",
);
assert.match(
	evaluator
		.validateArtifact({
			...multiGoalSeed,
			workerBudget: 1,
			benchmarks: multiGoalSeed.benchmarks.map((benchmark) => ({
				...benchmark,
				runs: benchmark.runs.map((run) =>
					run.arm === "current-batch"
						? {
								...run,
								schedule: [
									{
										sequence: 1,
										type: "launch",
										goalIndexes: [0, 1],
										active: [0, 1],
										elapsedMs: 0,
									},
									{
										sequence: 2,
										type: "completion",
										goalIndexes: [0],
										active: [1],
										elapsedMs: 50,
									},
									{
										sequence: 3,
										type: "completion",
										goalIndexes: [1],
										active: [],
										elapsedMs: 100,
									},
								],
								metrics: { ...run.metrics, elapsedMs: 100 },
							}
						: run,
				),
			})),
		})
		.join(";"),
	/schedule replay failed/u,
	"active workers cannot exceed workerBudget",
);
const falseActiveSnapshot = structuredClone(completeSeed);
falseActiveSnapshot.benchmarks[0].runs[0].schedule[0].active.push(9);
assert.match(
	evaluator.validateArtifact(falseActiveSnapshot).join(";"),
	/schedule is invalid|schedule replay failed/u,
	"recorded active snapshots must equal replayed active workers",
);
const contradictoryElapsed = structuredClone(completeSeed);
const contradictoryRun = contradictoryElapsed.benchmarks[0].runs[0];
contradictoryRun.metrics.elapsedMs = 1;
contradictoryRun.attempts[0].elapsedMs = 1;
contradictoryRun.metrics.totalAttemptElapsedMs = 1;
assert.match(
	evaluator.validateArtifact(contradictoryElapsed).join(";"),
	/elapsed evidence is inconsistent/u,
	"scored elapsed must equal the terminal schedule timestamp",
);
const benchmarkWithTimes = (times, intervention = false) => ({
	id: "fixture",
	fingerprint: "a".repeat(64),
	planFingerprint: "b".repeat(64),
	graph: [
		{ dependsOn: [], writeScope: ["src/a/**"] },
		{ dependsOn: [], writeScope: ["src/b/**"] },
		{ dependsOn: [], writeScope: ["src/c/**"] },
	],
	planning: {
		attempts: [successfulAttempt(0, 0, 0, 0)],
		cost: 0,
		calls: 0,
		tokens: 0,
		elapsedMs: 0,
		totalAttemptElapsedMs: 0,
		totalAttemptCost: 0,
		totalAttemptCalls: 0,
		totalAttemptTokens: 0,
		attemptMetricsComplete: true,
		status: "valid",
	},
	armOrder: [evaluator.GRAPH_ARMS],
	runs: evaluator.GRAPH_ARMS.map((arm) =>
		makeRun(
			arm,
			times[arm],
			true,
			intervention && (arm === "optimized-batch" || arm === "streaming")
				? 1
				: 0,
		),
	),
});
const positive = benchmarkWithTimes(
	{
		serial: 120,
		"current-batch": 100,
		"optimized-batch": 80,
		streaming: 70,
	},
	true,
);
const neutral = benchmarkWithTimes({
	serial: 100,
	"current-batch": 100,
	"optimized-batch": 100,
	streaming: 100,
});
const negative = benchmarkWithTimes(
	{
		serial: 100,
		"current-batch": 100,
		"optimized-batch": 120,
		streaming: 130,
	},
	true,
);
const unattributedFast = benchmarkWithTimes({
	serial: 120,
	"current-batch": 100,
	"optimized-batch": 80,
	streaming: 70,
});
const completionFill = benchmarkWithTimes({
	serial: 120,
	"current-batch": 100,
	"optimized-batch": 100,
	streaming: 80,
});
for (const run of completionFill.runs.filter((item) =>
	["current-batch", "streaming"].includes(item.arm),
)) {
	run.schedule[0] = {
		...run.schedule[0],
		goalIndexes: [0, 1],
		active: [0, 1],
	};
	run.packetFingerprints[1] = "f".repeat(64);
}
const streamingFill = completionFill.runs.find(
	(run) => run.arm === "streaming",
);
streamingFill.schedule.splice(1, 0, {
	sequence: 2,
	type: "launch",
	goalIndexes: [2],
	active: [1, 2],
	elapsedMs: 50,
});
streamingFill.packetFingerprints[2] = "f".repeat(64);
assert.equal(evaluator.decideEvaluation([positive]).decision, "proceed");
const processErrorPositive = structuredClone(positive);
for (const run of processErrorPositive.runs.filter((item) =>
	["optimized-batch", "streaming"].includes(item.arm),
)) {
	run.metrics.processErrors = 1;
	run.metrics.processErrorClassifications = {
		process_start: 1,
		protocol: 0,
	};
}
assert.notEqual(
	evaluator.decideEvaluation([processErrorPositive]).decision,
	"proceed",
	"a completion with worker process errors is not reliable speed evidence",
);
assert.equal(evaluator.decideEvaluation([neutral]).decision, "expand");
assert.equal(
	evaluator.decideEvaluation([unattributedFast]).decision,
	"expand",
	"wall-clock noise without a scheduling intervention is not a benefit",
);
assert.equal(
	evaluator.decideEvaluation([completionFill]).decision,
	"proceed",
	"launching while a prior worker remains active is attributable streaming evidence",
);
const laterFrontier = benchmarkWithTimes({
	serial: 120,
	"current-batch": 100,
	"optimized-batch": 80,
	streaming: 100,
});
const launchSequence = (secondGoal, elapsedMs) => [
	{
		sequence: 1,
		type: "launch",
		goalIndexes: [0],
		active: [0],
		elapsedMs: 0,
	},
	{
		sequence: 2,
		type: "completion",
		goalIndexes: [0],
		active: [],
		elapsedMs: 40,
	},
	{
		sequence: 3,
		type: "launch",
		goalIndexes: [secondGoal],
		active: [secondGoal],
		elapsedMs: 41,
	},
	{
		sequence: 4,
		type: "completion",
		goalIndexes: [secondGoal],
		active: [],
		elapsedMs,
	},
];
for (const run of laterFrontier.runs.filter((item) => item.arm !== "serial")) {
	const secondGoal = run.arm === "optimized-batch" ? 2 : 1;
	run.schedule = launchSequence(secondGoal, run.metrics.elapsedMs);
	run.packetFingerprints[secondGoal] = "f".repeat(64);
}
assert.equal(
	evaluator.decideEvaluation([laterFrontier]).decision,
	"proceed",
	"a later-frontier launch difference must count as a scheduling intervention",
);
const retriedFast = structuredClone(positive);
for (const run of retriedFast.runs.filter((item) =>
	["optimized-batch", "streaming"].includes(item.arm),
))
	run.attempts = [
		{
			attempt: 1,
			classification: "rate_limit",
			outcome: "failed",
			elapsedMs: 20,
			cost: null,
			calls: null,
			tokens: null,
			metricsComplete: false,
		},
		{
			attempt: 2,
			classification: "none",
			outcome: "complete",
			elapsedMs: run.metrics.elapsedMs,
			cost: run.metrics.cost,
			calls: run.metrics.calls,
			tokens: run.metrics.tokens,
			metricsComplete: true,
		},
	];
assert.equal(
	evaluator.decideEvaluation([retriedFast]).decision,
	"stop",
	"retried candidates must not be scored as fast, first-attempt reliable runs",
);
assert.equal(evaluator.decideEvaluation([negative]).decision, "stop");
const candidateOracleFailed = structuredClone(positive);
for (const run of candidateOracleFailed.runs) {
	if (run.arm !== "optimized-batch" && run.arm !== "streaming") continue;
	run.terminalOutcome = "oracle_failed";
	run.oracle = { executed: true, ok: false };
	run.repositoryClean = false;
	run.metrics.acceptancePassed = false;
	run.metrics.qualityPassed = false;
	run.metrics.firstRoundPassed = false;
	run.attempts = [
		{
			...run.attempts[0],
			outcome: "failed",
			classification: "quality",
		},
	];
	Object.assign(run.metrics, evaluator.usageMetricsFromAttempts(run.attempts), {
		elapsedMs: run.metrics.elapsedMs,
		acceptancePassed: false,
		qualityPassed: false,
		firstRoundPassed: false,
		repairRounds: run.metrics.repairRounds,
		processErrors: run.metrics.processErrors,
		processErrorClassifications: run.metrics.processErrorClassifications,
		resourcesRemaining: run.metrics.resourcesRemaining,
		prewalkHits: run.metrics.prewalkHits,
		prewalkExpected: run.metrics.prewalkExpected,
		readCalls: run.metrics.readCalls,
		bashCalls: run.metrics.bashCalls,
	});
}
assert.equal(
	evaluator.decideEvaluation([candidateOracleFailed]).decision,
	"stop",
	"baseline-pass + candidate oracle failures must score negative, not expand",
);
assert.equal(
	evaluator.decideEvaluation([positive, negative]).decision,
	"expand",
	"mixed directions require more samples",
);

const currentManifest = JSON.parse(
	readFileSync(
		join(root, "tests/fixtures/graph-flow/uneven-fork-join/manifest.json"),
		"utf8",
	),
);
const artifactBenchmark = {
	...structuredClone(neutral),
	id: "uneven-fork-join",
	fingerprint: evaluator.sha256(evaluator.stableJson(currentManifest)),
	graph: [{ dependsOn: [], writeScope: ["src/a/**"] }],
	runs: evaluator.GRAPH_ARMS.map((arm) => makeRun(arm, 100)),
};
const validArtifact = {
	schemaVersion: 1,
	benchmarkIds: ["uneven-fork-join"],
	benchmarkFingerprint: subsetDryRun.benchmarkFingerprint,
	evaluationConfigFingerprint: subsetDryRun.evaluationConfigFingerprint,
	modelFingerprint: subsetDryRun.modelFingerprint,
	packetRuleFingerprint: subsetDryRun.packetRuleFingerprint,
	scorerFingerprint: evaluator.scorerFingerprint(),
	executorFingerprint: evaluator.executorFingerprint(),
	schedulerFingerprint: evaluator.schedulerFingerprint(),
	runsPerArm: 1,
	workerBudget: 2,
	decision: "expand",
	directions: { "uneven-fork-join": "neutral" },
	benchmarks: [
		{
			...artifactBenchmark,
			id: "uneven-fork-join",
			armOrder: evaluator.expectedArmOrder(0, 1),
			runs: evaluator.expectedArmOrder(0, 1)[0].map((arm) => makeRun(arm, 100)),
		},
	],
};
assert.deepEqual(evaluator.validateArtifact(validArtifact), []);
assert.equal(evaluator.artifactExitCode(validArtifact), 1);
for (const workerBudget of [undefined, 0, -1, 1.5, "2"]) {
	const invalidBudget = structuredClone(validArtifact);
	if (workerBudget === undefined) delete invalidBudget.workerBudget;
	else invalidBudget.workerBudget = workerBudget;
	assert.match(
		evaluator.validateArtifact(invalidBudget).join(";"),
		/workerBudget must be positive/u,
		`workerBudget ${String(workerBudget)} must be rejected`,
	);
}
const missingAttemptElapsed = structuredClone(validArtifact);
delete missingAttemptElapsed.benchmarks[0].runs[0].attempts[0].elapsedMs;
assert.match(
	evaluator.validateArtifact(missingAttemptElapsed).join(";"),
	/attempts are invalid/u,
);
const tamperedAttemptTotal = structuredClone(validArtifact);
tamperedAttemptTotal.benchmarks[0].runs[0].metrics.totalAttemptElapsedMs += 1;
assert.match(
	evaluator.validateArtifact(tamperedAttemptTotal).join(";"),
	/metrics are incomplete/u,
	"attempt totals must equal the complete attempt ledger",
);
const tamperedDecision = structuredClone(validArtifact);
tamperedDecision.decision = "proceed";
assert.match(
	evaluator.validateArtifact(tamperedDecision).join(";"),
	/decision does not match/u,
	"artifact decision must be recomputed from run evidence",
);
const missingArm = structuredClone(validArtifact);
missingArm.benchmarks[0].runs.pop();
assert.match(
	evaluator.validateArtifact(missingArm).join(";"),
	/streaming run/u,
);
const emptySchedule = structuredClone(validArtifact);
emptySchedule.benchmarks[0].runs[0].schedule = [];
assert.match(
	evaluator.validateArtifact(emptySchedule).join(";"),
	/schedule is invalid/u,
);
const fingerprintDrift = structuredClone(validArtifact);
fingerprintDrift.modelFingerprint = "drift";
assert.match(
	evaluator.validateArtifact(fingerprintDrift).join(";"),
	/modelFingerprint is invalid/u,
);
const leakedPath = structuredClone(validArtifact);
leakedPath.debug = "/Users/example/session.jsonl";
assert.match(
	evaluator.validateArtifact(leakedPath).join(";"),
	/sensitive\/raw/u,
);

const artifactRoot = mkdtempSync(join(tmpdir(), "graph-artifact-smoke-"));
try {
	const artifactPath = join(artifactRoot, "baseline.json");
	// CLI verify 绑定 evaluation-contract 全集；单 benchmark 合成件只走纯 validateArtifact。
	const committedBaseline = JSON.parse(
		readFileSync(join(root, "tests/fixtures/graph-flow/baseline.json"), "utf8"),
	);
	writeFileSync(artifactPath, `${JSON.stringify(committedBaseline)}\n`);
	const output = execFileSync(
		process.execPath,
		[
			join(root, "scripts/evaluate-graph-flow.mjs"),
			"--verify-artifact",
			artifactPath,
		],
		{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	assert.match(
		output,
		/verified: expand/u,
		"non-proceed decisions remain valid artifacts",
	);
	const driftPath = join(artifactRoot, "drift.json");
	writeFileSync(
		driftPath,
		`${JSON.stringify({ ...committedBaseline, modelFingerprint: "e".repeat(64) })}\n`,
	);
	assert.throws(
		() =>
			execFileSync(
				process.execPath,
				[
					join(root, "scripts/evaluate-graph-flow.mjs"),
					"--verify-artifact",
					driftPath,
				],
				{ cwd: root, stdio: "pipe" },
			),
		/modelFingerprint drifted/u,
		"artifact verification must detect current model-contract drift",
	);
} finally {
	rmSync(artifactRoot, { recursive: true, force: true });
}

const cleanCheckout = mkdtempSync(join(tmpdir(), "graph-clean-checkout-"));
try {
	mkdirSync(join(cleanCheckout, "scripts"), { recursive: true });
	mkdirSync(join(cleanCheckout, "tests/fixtures"), { recursive: true });
	for (const script of ["evaluate-graph-flow.mjs", "graph-flow-evaluation.mjs"])
		cpSync(
			join(root, "scripts", script),
			join(cleanCheckout, "scripts", script),
		);
	cpSync(
		join(root, "tests/fixtures/graph-flow"),
		join(cleanCheckout, "tests/fixtures/graph-flow"),
		{ recursive: true },
	);
	cpSync(
		join(root, "config.template.json"),
		join(cleanCheckout, "config.template.json"),
	);
	mkdirSync(join(cleanCheckout, "src/flow"), { recursive: true });
	cpSync(
		join(root, "src/flow/scheduler.ts"),
		join(cleanCheckout, "src/flow/scheduler.ts"),
	);
	// baseline 绑定合同全集 + scheduler/scorer 指纹；clean checkout 仍应独立 verify。
	const output = execFileSync(
		process.execPath,
		[
			"scripts/evaluate-graph-flow.mjs",
			"--verify-artifact",
			"tests/fixtures/graph-flow/baseline.json",
		],
		{
			cwd: cleanCheckout,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	assert.match(
		output,
		/verified: expand/u,
		"contract baseline must verify in a clean checkout without config.json",
	);
} finally {
	rmSync(cleanCheckout, { recursive: true, force: true });
}

const evaluatorSource = readFileSync(
	join(root, "scripts/evaluate-graph-flow.mjs"),
	"utf8",
);
assert.equal(
	(evaluatorSource.match(/runtime\.computeLaunchSet/gu) ?? []).length,
	2,
	"optimized-batch and streaming must be the only computeLaunchSet call sites",
);
assert.equal(
	(evaluatorSource.match(/runtime\.computeReadyBatch/gu) ?? []).length,
	1,
	"serial/current-batch must share the current scheduler result",
);

const cleanupRoot = mkdtempSync(join(tmpdir(), "graph-cleanup-smoke-"));
try {
	assert.throws(() =>
		execFileSync(
			process.execPath,
			[
				join(root, "scripts/evaluate-graph-flow.mjs"),
				"--fixtures",
				"uneven-fork-join",
			],
			{
				cwd: root,
				env: { ...process.env, PATH: cleanupRoot, TMPDIR: cleanupRoot },
				stdio: "pipe",
				timeout: 60_000,
			},
		),
	);
	assert.deepEqual(
		readdirSync(cleanupRoot),
		[],
		"planning startup failure must leave no extension, repo, or Session residue",
	);
} finally {
	rmSync(cleanupRoot, { recursive: true, force: true });
}

// 生命周期：abort 立刻 stop 活跃句柄（不解挂等 finally）；shutdown 再删目录。
{
	const lifeRoot = mkdtempSync(join(tmpdir(), "graph-life-"));
	const lifeDir = join(lifeRoot, "owned");
	mkdirSync(lifeDir);
	writeFileSync(join(lifeDir, "marker"), "x\n");
	const stopped = [];
	const life = cli.createEvalLifecycle([lifeDir]);
	const hang = cli.raceAbort(
		life.signal,
		new Promise(() => {
			/* never settles until cancelled */
		}),
	);
	life.register({
		stop: async () => {
			stopped.push("planner");
		},
	});
	life.register({
		stop: async () => {
			stopped.push("worker");
		},
	});
	const stopKick = life._testAbort(143);
	assert.equal(life.signal.aborted, true);
	await stopKick;
	assert.deepEqual(
		stopped.sort(),
		["planner", "worker"],
		"abort must stop handles immediately, not wait for shutdown()",
	);
	assert.equal(existsSync(lifeDir), true, "abort must not delete dirs yet");
	await assert.rejects(() => hang, /evaluation cancelled/u);
	await life.shutdown();
	assert.equal(existsSync(lifeDir), false, "shutdown deletes owned temps");
	assert.equal(life.exitCode, 143);
	rmSync(lifeRoot, { recursive: true, force: true });
}

// 真实 SIGTERM：子进程挂在 raceAbort 上，收到信号后限时以 143 退出并清临时目录与 fake host
{
	const { spawn } = await import("node:child_process");
	const hangScript = join(tmpdir(), `graph-sigterm-hang-${process.pid}.mjs`);
	const evaluatorUrl = pathToFileURL(
		join(root, "scripts/evaluate-graph-flow.mjs"),
	).href;
	writeFileSync(
		hangScript,
		[
			'import { spawn } from "node:child_process";',
			'import { mkdtempSync, writeFileSync } from "node:fs";',
			'import { tmpdir } from "node:os";',
			'import { join } from "node:path";',
			"async function main() {",
			`\tconst cli = await import(${JSON.stringify(evaluatorUrl)});`,
			'\tconst owned = mkdtempSync(join(tmpdir(), "graph-flow-eval-sig-"));',
			'\tconst ext = mkdtempSync(join(tmpdir(), "graph-flow-ext-sig-"));',
			'\twriteFileSync(join(owned, "marker"), "1\\n");',
			"\tconst life = cli.createEvalLifecycle([owned, ext]);",
			'\tconst host = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], { stdio: "ignore" });',
			"\tconst keepAlive = setInterval(() => {}, 1 << 30);",
			'\tprocess.stdout.write(JSON.stringify({ owned, ext, hostPid: host.pid }) + "\\n");',
			"\tlife.register({",
			"\t\tstop: async () => {",
			"\t\t\tclearInterval(keepAlive);",
			'\t\t\tif (host.pid) try { host.kill("SIGTERM"); } catch {}',
			"\t\t},",
			"\t});",
			"\ttry {",
			"\t\tawait cli.raceAbort(life.signal, new Promise(() => {}));",
			"\t} catch {}",
			"\tawait life.shutdown();",
			"\tprocess.exit(life.signal.aborted ? (life.exitCode ?? 143) : 0);",
			"}",
			"main().catch((error) => {",
			"\tconsole.error(error);",
			"\tprocess.exit(1);",
			"});",
			"",
		].join("\n"),
	);
	const proc = spawn(process.execPath, [hangScript], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let meta;
	proc.stdout.on("data", (chunk) => {
		stdout += chunk;
		if (!meta && stdout.includes("\n")) {
			meta = JSON.parse(stdout.trim().split("\n")[0]);
			setTimeout(() => proc.kill("SIGTERM"), 80);
		}
	});
	proc.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const result = await new Promise((resolve) => {
		const timer = setTimeout(() => {
			proc.kill("SIGKILL");
			resolve({ code: null, timedOut: true, stderr });
		}, 10_000);
		proc.on("exit", (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, timedOut: false, meta, stderr });
		});
	});
	rmSync(hangScript, { force: true });
	assert.equal(
		result.timedOut,
		false,
		`SIGTERM hang must exit within 10s: ${result.stderr}`,
	);
	assert.equal(
		result.code,
		143,
		`expected exit 143, got code=${result.code} signal=${result.signal} stderr=${result.stderr}`,
	);
	assert.ok(result.meta?.owned && result.meta?.ext);
	assert.equal(existsSync(result.meta.owned), false);
	assert.equal(existsSync(result.meta.ext), false);
	if (result.meta.hostPid) {
		let hostAlive = true;
		try {
			process.kill(result.meta.hostPid, 0);
		} catch {
			hostAlive = false;
		}
		assert.equal(hostAlive, false, "fake planner host must exit");
	}
}

// 取消路径：abort 后 worker hold 被收口，不进入基础设施重试投影
{
	const cancelRoot = mkdtempSync(join(tmpdir(), "graph-cancel-"));
	const flowDir = join(cancelRoot, "F1");
	const sessions = join(cancelRoot, "sessions");
	mkdirSync(flowDir);
	mkdirSync(sessions);
	for (const index of [0, 1, 2])
		writeFileSync(join(flowDir, `G${index + 1}.md`), `# G${index + 1}\n`);
	const held = fakeCoordinatorRuntime(["hold", "hold", "hold"]);
	const ac = new AbortController();
	const run = cli.runCoordinatedArm({
		arm: "current-batch",
		fixture: cancelRoot,
		flow: fakeCoordinatorFlow(),
		flowDir,
		manifest: { id: "cancel-smoke" },
		rootSessions: new Map([
			[0, join(sessions, "c0.jsonl")],
			[1, join(sessions, "c1.jsonl")],
		]),
		runId: "cancel-run",
		runtime: held.runtime,
		sessions,
		signal: ac.signal,
		workerBudget: 2,
	});
	setTimeout(() => ac.abort(), 30);
	await assert.rejects(() => run, /evaluation cancelled/u);
	assert.equal(held.cancelled.length > 0, true, "abort must kill held workers");
	rmSync(cancelRoot, { recursive: true, force: true });
}

// 进度日志：阶段变化有界输出，过滤流式 update，不含敏感正文
{
	const lines = [];
	const progress = cli.createProgressLogger({
		write: (line) => lines.push(line),
		heartbeatMs: 60_000,
	});
	progress.set({
		benchmark: "uneven-fork-join",
		arm: "serial",
		phase: "running",
	});
	for (let i = 0; i < 50; i += 1) {
		progress.noteWorkerEvent(0, {
			type: "message_update",
			message: { content: `FULL MODEL OUTPUT SECRET ${i}` },
		});
		progress.noteWorkerEvent(0, {
			type: "tool_execution_update",
			name: "bash",
			output: "SECRET STREAM",
		});
	}
	progress.noteWorkerEvent(0, {
		type: "tool_execution_start",
		name: "read",
		arguments: { path: "/secret/session.jsonl" },
		prompt: "FULL PROMPT SECRET",
	});
	progress.noteWorkerEvent(0, {
		type: "message_start",
		message: { content: "FULL MODEL OUTPUT SECRET" },
	});
	// 同阶段重复 set 不得刷屏
	for (let i = 0; i < 20; i += 1)
		progress.set({
			benchmark: "uneven-fork-join",
			arm: "serial",
			phase: "running",
		});
	const blob = lines.join("\n");
	assert.match(blob, /\[progress\]/u);
	assert.match(blob, /uneven-fork-join/u);
	assert.match(blob, /serial/u);
	assert.match(blob, /tool:read/u);
	assert.ok(
		lines.length <= 4,
		`progress must stay bounded, got ${lines.length}`,
	);
	assert.equal(blob.includes("FULL PROMPT SECRET"), false);
	assert.equal(blob.includes("FULL MODEL OUTPUT SECRET"), false);
	assert.equal(blob.includes("SECRET STREAM"), false);
	assert.equal(blob.includes("/secret/session.jsonl"), false);
	// 跨 benchmark/arm：replace 必须丢掉旧 G/arm/detail 并重置耗时
	const switchLines = [];
	const switchProgress = cli.createProgressLogger({
		write: (line) => switchLines.push(line),
		heartbeatMs: 60_000,
		now: (() => {
			const t = 1_000_000;
			return () => t;
		})(),
	});
	switchProgress.set({
		replace: true,
		benchmark: "first",
		arm: "streaming",
		phase: "running",
		goal: 3,
		detail: "tool:read",
		startedAt: 1_000_000 - 120_000,
	});
	switchProgress.set({
		replace: true,
		benchmark: "second",
		phase: "planning",
		startedAt: 1_000_000,
	});
	const last = switchLines.at(-1) ?? "";
	assert.match(last, /second/u);
	assert.match(last, /planning/u);
	assert.equal(last.includes("streaming"), false);
	assert.equal(last.includes("G4"), false);
	assert.equal(last.includes("tool:read"), false);
	assert.match(last, /\b0s\b/u, "new benchmark planning elapsed must reset");
	switchProgress.stop();
	progress.stop();
}

console.log("graph flow eval smoke passed");
