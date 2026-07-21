import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-scheduler-test-${runId}`);
const srcOut = join(out, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
prepareTestDist(root, srcOut, [
	"--ignoreConfig",
	"--outDir",
	srcOut,
	"--rootDir",
	"src",
	"--noEmit",
	"false",
	"--target",
	"ES2022",
	"--module",
	"NodeNext",
	"--moduleResolution",
	"NodeNext",
	"--types",
	"node",
	"--strict",
	"--skipLibCheck",
	"src/flow/scheduler.ts",
]);

const MULTI_WAVE_GOALS = [
	{ dependsOn: [], writeScope: ["src/wave-1/**"] },
	{ dependsOn: [0], writeScope: ["src/wave-2/api/**"] },
	{ dependsOn: [0], writeScope: ["src/wave-2/ui/**"] },
	{ dependsOn: [0], writeScope: ["src/wave-2/docs/**"] },
	{ dependsOn: [1, 2, 3], writeScope: ["src/wave-3/core/**"] },
	{ dependsOn: [1, 2, 3], writeScope: ["src/wave-3/ops/**"] },
	{ dependsOn: [4, 5], writeScope: ["src/wave-4/**"] },
	{ dependsOn: [6], writeScope: ["src/wave-5/api/**"] },
	{ dependsOn: [6], writeScope: ["src/wave-5/ui/**"] },
	{ dependsOn: [6], writeScope: ["src/wave-5/docs/**"] },
	{
		role: "final_acceptance",
		dependsOn: [7, 8, 9],
		writeScope: ["docs/final-acceptance/**"],
	},
];

try {
	const { computeLaunchSet, computeReadyBatch, scopesOverlap } = await import(
		`file://${join(srcOut, "flow/scheduler.js")}?t=${Date.now()}`
	);

	assert.deepEqual(
		computeReadyBatch(flow([{ status: "pending" }, { status: "pending" }])),
		{ mode: "serial", indices: [0] },
		"serial flow should start at first pending goal",
	);
	assert.deepEqual(
		computeReadyBatch(flow([{ status: "complete" }, { status: "pending" }])),
		{ mode: "serial", indices: [1] },
		"missing dependsOn should default to previous goal",
	);

	assert.deepEqual(
		computeReadyBatch(
			flow([
				{ status: "complete" },
				{ status: "pending", dependsOn: [0], writeScope: ["src/api/**"] },
				{
					status: "pending",
					role: "normal",
					dependsOn: [0],
					writeScope: ["src/ui/**"],
				},
				{ status: "pending" },
			]),
		),
		{ mode: "parallel", indices: [1, 2] },
		"independent scopes should run in one parallel batch",
	);

	assert.deepEqual(
		computeReadyBatch(
			flow([
				{ status: "complete" },
				{ status: "pending", dependsOn: [0], writeScope: ["src/**"] },
				{
					status: "pending",
					role: "normal",
					dependsOn: [0],
					writeScope: ["src/api/**"],
				},
				{ status: "pending" },
			]),
		),
		{ mode: "serial", indices: [1] },
		"overlapping scopes should start the smallest index only",
	);

	assert.deepEqual(
		computeReadyBatch(
			flow([
				{ status: "pending" },
				{ status: "pending", dependsOn: [0], writeScope: ["src/api/**"] },
			]),
		),
		{ mode: "serial", indices: [0] },
		"a goal should wait for incomplete dependencies",
	);
	assert.deepEqual(
		computeReadyBatch(
			flow([
				{ status: "complete" },
				{
					status: "pending",
					role: "normal",
					dependsOn: [0],
					writeScope: ["src/api/**"],
				},
				{ status: "pending", dependsOn: [], writeScope: ["docs/**"] },
			]),
		),
		{ mode: "serial", indices: [1] },
		"final acceptance should ignore dependsOn/writeScope until ordinary goals complete",
	);
	assert.deepEqual(
		computeReadyBatch(
			flow([
				{ status: "complete" },
				{ status: "complete", role: "normal" },
				{ status: "pending", dependsOn: [], writeScope: ["docs/**"] },
			]),
		),
		{ mode: "serial", indices: [2] },
		"final acceptance should run alone after ordinary goals complete",
	);

	for (const testCase of [
		{
			complete: [],
			batch: { mode: "serial", indices: [0] },
			label: "multi-wave DAG should start at G1",
		},
		{
			complete: [0],
			batch: { mode: "parallel", indices: [1, 2, 3] },
			label: "multi-wave DAG should run G2/G3/G4 together",
		},
		{
			complete: [0, 1, 2, 3],
			batch: { mode: "parallel", indices: [4, 5] },
			label: "multi-wave DAG should fan in before G5/G6",
		},
		{
			complete: [0, 1, 2, 3, 4, 5],
			batch: { mode: "serial", indices: [6] },
			label: "multi-wave DAG should run G7 after G5/G6",
		},
		{
			complete: [0, 1, 2, 3, 4, 5, 6],
			batch: { mode: "parallel", indices: [7, 8, 9] },
			label: "multi-wave DAG should run G8/G9/G10 together",
		},
		{
			complete: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			batch: { mode: "serial", indices: [10] },
			label: "multi-wave DAG should finish with G11 final acceptance",
		},
	]) {
		assert.deepEqual(
			computeReadyBatch(multiWaveFlow(testCase.complete)),
			testCase.batch,
			testCase.label,
		);
	}

	const nonGreedy = graphFlow([
		{ status: "pending", dependsOn: [], writeScope: ["**"] },
		{ status: "pending", dependsOn: [], writeScope: ["src/api/**"] },
		{ status: "pending", dependsOn: [], writeScope: ["src/ui/**"] },
	]);
	assert.deepEqual(
		computeLaunchSet(nonGreedy, new Set(), 2),
		[1, 2],
		"two narrow scopes should beat the first global scope",
	);
	assert.deepEqual(
		computeLaunchSet(nonGreedy, new Set(), 1),
		[0],
		"budget one should use stable index tie-break",
	);
	assert.deepEqual(
		computeLaunchSet(nonGreedy, new Set(), 8),
		[1, 2],
		"budget above the frontier should not admit conflicts",
	);

	const activeConflict = graphFlow([
		{ status: "running", dependsOn: [], writeScope: ["src/api/**"] },
		{ status: "pending", dependsOn: [], writeScope: ["src/api/generated/**"] },
		{ status: "pending", dependsOn: [], writeScope: ["src/ui/**"] },
		{ status: "pending", dependsOn: [], writeScope: ["docs/**"] },
	]);
	assert.deepEqual(
		computeLaunchSet(activeConflict, new Set([0]), 3),
		[2, 3],
		"launches should avoid active scopes and consume remaining budget",
	);
	for (const budget of [0, 1]) {
		assert.deepEqual(
			computeLaunchSet(activeConflict, new Set([0]), budget),
			[],
			`budget ${budget} should leave no capacity beside one active goal`,
		);
	}

	const blockedDependency = graphFlow([
		{ status: "running", dependsOn: [], writeScope: ["src/base/**"] },
		{ status: "pending", dependsOn: [0], writeScope: ["src/next/**"] },
	]);
	assert.deepEqual(
		computeLaunchSet(blockedDependency, new Set([0]), 2),
		[],
		"an active dependency is not complete and must keep successors blocked",
	);

	const pendingFinal = graphFlow([
		{ status: "pending", dependsOn: [], writeScope: ["src/**"] },
		{
			status: "pending",
			role: "final_acceptance",
			dependsOn: [],
			writeScope: ["docs/**"],
		},
	]);
	assert.deepEqual(
		computeLaunchSet(pendingFinal, new Set(), 2),
		[0],
		"final acceptance should wait behind every ordinary goal",
	);
	const readyFinal = graphFlow([
		{ status: "complete", dependsOn: [], writeScope: ["src/**"] },
		{
			status: "pending",
			role: "final_acceptance",
			dependsOn: [],
			writeScope: ["docs/**"],
		},
	]);
	assert.deepEqual(
		computeLaunchSet(readyFinal, new Set(), 1),
		[1],
		"final acceptance should launch alone once ordinary goals complete",
	);
	assert.deepEqual(
		computeLaunchSet(readyFinal, new Set([0]), 2),
		[],
		"final acceptance must not launch beside any active goal",
	);

	const sparseLaunchScope = [];
	sparseLaunchScope.length = 1;
	for (const unsafeScope of [
		undefined,
		[],
		["src/*"],
		[null],
		sparseLaunchScope,
	]) {
		assert.deepEqual(
			computeLaunchSet(
				graphFlow([
					{ status: "pending", dependsOn: [], writeScope: unsafeScope },
				]),
				new Set(),
				1,
			),
			[],
			`unsafe candidate scope must fail closed: ${JSON.stringify(unsafeScope)}`,
		);
	}
	assert.deepEqual(
		computeLaunchSet(
			graphFlow([{ status: "pending", dependsOn: [], writeScope: ["src/**"] }]),
			new Set([99]),
			2,
		),
		[],
		"an unknown active goal scope must fail closed",
	);

	for (const [deepRoot, expected] of [
		[1, [1]],
		[0, [0]],
	]) {
		const topology = deepBranchFlow(deepRoot);
		assert.deepEqual(
			computeLaunchSet(topology, new Set(), 1),
			expected,
			"the deeper branch should win regardless of root order",
		);
	}
	const stableTie = graphFlow([
		{ status: "pending", dependsOn: [], writeScope: ["src/a/**"] },
		{ status: "pending", dependsOn: [], writeScope: ["src/b/**"] },
		{ status: "pending", dependsOn: [], writeScope: ["src/c/**"] },
		{ status: "pending", dependsOn: [0], writeScope: ["docs/a/**"] },
		{ status: "pending", dependsOn: [1], writeScope: ["docs/b/**"] },
		{ status: "pending", dependsOn: [2], writeScope: ["docs/c/**"] },
		{ status: "pending", dependsOn: [3, 4, 5], writeScope: ["docs/join/**"] },
	]);
	assert.deepEqual(
		computeLaunchSet(stableTie, new Set(), 2),
		[0, 1],
		"equal-width branches should use lexicographic goal indices",
	);

	const tenNodeGraph = graphFlow([
		{ status: "pending", dependsOn: [], writeScope: ["**"] },
		{ status: "pending", dependsOn: [], writeScope: ["src/api/**"] },
		{ status: "pending", dependsOn: [], writeScope: ["src/ui/**"] },
		{ status: "pending", dependsOn: [], writeScope: ["ops/**"] },
		{ status: "pending", dependsOn: [0], writeScope: ["docs/a/**"] },
		{ status: "pending", dependsOn: [1], writeScope: ["docs/b/**"] },
		{ status: "pending", dependsOn: [1], writeScope: ["docs/c/**"] },
		{ status: "pending", dependsOn: [2, 3], writeScope: ["docs/d/**"] },
		{ status: "pending", dependsOn: [4, 5], writeScope: ["docs/e/**"] },
		{ status: "pending", dependsOn: [6, 7, 8], writeScope: ["docs/f/**"] },
	]);
	for (const [candidateFlow, budgets] of [
		[nonGreedy, [0, 1, 2, 4]],
		[activeConflict, [1, 2, 3, 5]],
		[tenNodeGraph, [1, 2, 3, 10]],
	]) {
		const active = candidateFlow === activeConflict ? new Set([0]) : new Set();
		for (const budget of budgets) {
			assert.deepEqual(
				computeLaunchSet(candidateFlow, active, budget),
				oracleLaunchSet(candidateFlow, active, budget),
				`launch set should match exhaustive oracle at budget ${budget}`,
			);
		}
	}

	const immutableFlow = deepFreeze(structuredClone(tenNodeGraph));
	const immutableSnapshot = structuredClone(immutableFlow);
	const immutableActive = new Set([3]);
	const firstLaunch = computeLaunchSet(immutableFlow, immutableActive, 3);
	assert.deepEqual(
		computeLaunchSet(immutableFlow, immutableActive, 3),
		firstLaunch,
		"identical inputs should produce an identical launch order",
	);
	assert.deepEqual(
		immutableFlow,
		immutableSnapshot,
		"scheduler mutated its flow",
	);
	assert.deepEqual(
		[...immutableActive],
		[3],
		"scheduler mutated the active goal set",
	);

	assert.equal(
		computeReadyBatch(flow([{ status: "complete" }, { status: "complete" }])),
		null,
		"complete flow should have no ready batch",
	);
	assert.equal(
		computeReadyBatch(
			flow([{ status: "complete" }, { status: "pending" }], {
				parallelRun: {
					id: "P1",
					goalIndexes: [1],
					startedAt: 0,
					consoleSessionFile: "console.jsonl",
					consoleSessionName: "parallel",
				},
			}),
		),
		null,
		"active parallel run should block scheduling",
	);
	assert.equal(
		computeReadyBatch(flow([{ status: "running" }, { status: "pending" }])),
		null,
		"running goal should block scheduling",
	);

	assert.equal(scopesOverlap(["**"], ["src/api/**"]), true);
	assert.equal(scopesOverlap(["src/**"], ["src/api/**"]), true);
	assert.equal(scopesOverlap(["src/api/**"], ["src/ui/**"]), false);
	assert.equal(scopesOverlap(["src/foo*"], ["src/foobar/**"]), true);
	for (const invalidScope of [
		"src/api/*/generated",
		"src\\api\\**",
		"/src/api/**",
		"src/../api/**",
		"src/api.ts",
		null,
	]) {
		assert.equal(
			scopesOverlap([invalidScope], ["src/ui/**"]),
			true,
			`invalid scope must fail closed: ${invalidScope}`,
		);
	}
	const sparseScope = [];
	sparseScope.length = 1;
	for (const unsafeScope of [
		"src/api/**",
		null,
		{ 0: "src/api/**", length: 1 },
		[],
		sparseScope,
	]) {
		const label = JSON.stringify(unsafeScope);
		assert.equal(
			scopesOverlap(unsafeScope, ["src/ui/**"]),
			true,
			`unsafe scope container must fail closed: ${label}`,
		);
		assert.equal(
			scopesOverlap(["src/ui/**"], unsafeScope),
			true,
			`unsafe right scope container must fail closed: ${label}`,
		);
		for (const writeScopes of [
			[unsafeScope, ["src/ui/**"]],
			[["src/ui/**"], unsafeScope],
		]) {
			assert.deepEqual(
				computeReadyBatch(
					flow([
						{ status: "complete" },
						{
							status: "pending",
							dependsOn: [0],
							writeScope: writeScopes[0],
						},
						{
							status: "pending",
							dependsOn: [0],
							writeScope: writeScopes[1],
						},
					]),
				),
				{ mode: "serial", indices: [1] },
				`unsafe scope container entered a parallel batch: ${label}`,
			);
		}
	}

	console.log("scheduler smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function multiWaveFlow(completedIndices) {
	const completed = new Set(completedIndices);
	return flow(
		MULTI_WAVE_GOALS.map((goal, index) => ({
			...goal,
			status: completed.has(index) ? "complete" : "pending",
		})),
	);
}

function graphFlow(goals, overrides = {}) {
	return flow(
		goals.map((goal) => ({ role: "normal", ...goal })),
		overrides,
	);
}

function deepBranchFlow(deepRoot) {
	const shallowRoot = deepRoot === 0 ? 1 : 0;
	return graphFlow([
		{ status: "pending", dependsOn: [], writeScope: ["src/root-a/**"] },
		{ status: "pending", dependsOn: [], writeScope: ["src/root-b/**"] },
		{
			status: "pending",
			dependsOn: [shallowRoot],
			writeScope: ["src/shallow-a/**"],
		},
		{
			status: "pending",
			dependsOn: [shallowRoot],
			writeScope: ["src/shallow-b/**"],
		},
		{
			status: "pending",
			dependsOn: [deepRoot],
			writeScope: ["src/deep-a/**"],
		},
		{ status: "pending", dependsOn: [4], writeScope: ["src/deep-b/**"] },
		{
			status: "pending",
			dependsOn: [2, 3, 5],
			writeScope: ["src/join/**"],
		},
	]);
}

function oracleLaunchSet(candidateFlow, active, budget) {
	if (!Number.isInteger(budget) || budget <= active.size) return [];
	const ready = candidateFlow.goals
		.filter((goal, index) => oracleReady(candidateFlow, goal, index))
		.map((goal) => goal.index)
		.filter(
			(index) =>
				oracleSafeScopes(candidateFlow.goals[index]?.writeScope) &&
				[...active].every((activeIndex) =>
					oracleScopesDisjoint(
						candidateFlow.goals[index]?.writeScope,
						candidateFlow.goals[activeIndex]?.writeScope,
					),
				),
		);
	const finalAcceptance = ready.find(
		(index) => candidateFlow.goals[index]?.role === "final_acceptance",
	);
	if (finalAcceptance !== undefined)
		return active.size === 0 ? [finalAcceptance] : [];

	let best = [];
	for (let mask = 1; mask < 2 ** ready.length; mask += 1) {
		const launch = ready.filter((_, offset) => mask & (2 ** offset));
		if (launch.length > budget - active.size) continue;
		if (!oraclePairwiseDisjoint(candidateFlow, launch)) continue;
		if (oracleLaunchIsBetter(candidateFlow, active, launch, best))
			best = launch;
	}
	return best;
}

function oracleReady(candidateFlow, goal, index) {
	if (goal.status !== "pending") return false;
	if (goal.role === "final_acceptance")
		return candidateFlow.goals.every(
			(candidate) =>
				candidate.role === "final_acceptance" ||
				candidate.status === "complete",
		);
	const dependencies = goal.dependsOn ?? (index === 0 ? [] : [index - 1]);
	return dependencies.every(
		(dependency) => candidateFlow.goals[dependency]?.status === "complete",
	);
}

function oracleSafeScopes(scopes) {
	return (
		Array.isArray(scopes) &&
		scopes.length > 0 &&
		[...scopes].every((scope) => oracleScopePrefix(scope) !== undefined)
	);
}

function oracleScopesDisjoint(left, right) {
	if (!oracleSafeScopes(left) || !oracleSafeScopes(right)) return false;
	return left.every((leftScope) =>
		right.every((rightScope) => {
			const leftPrefix = oracleScopePrefix(leftScope);
			const rightPrefix = oracleScopePrefix(rightScope);
			return !(
				leftPrefix === "" ||
				rightPrefix === "" ||
				leftPrefix === rightPrefix ||
				leftPrefix.startsWith(`${rightPrefix}/`) ||
				rightPrefix.startsWith(`${leftPrefix}/`)
			);
		}),
	);
}

function oracleScopePrefix(scope) {
	if (scope === "**") return "";
	if (typeof scope !== "string" || !scope.endsWith("/**")) return undefined;
	const prefix = scope.slice(0, -3);
	return prefix
		.split("/")
		.every(
			(segment) =>
				segment !== "." &&
				segment !== ".." &&
				/^[A-Za-z0-9._-]+$/u.test(segment),
		)
		? prefix
		: undefined;
}

function oraclePairwiseDisjoint(candidateFlow, launch) {
	return launch.every((index, offset) =>
		launch
			.slice(offset + 1)
			.every((other) =>
				oracleScopesDisjoint(
					candidateFlow.goals[index]?.writeScope,
					candidateFlow.goals[other]?.writeScope,
				),
			),
	);
}

function oracleLaunchIsBetter(candidateFlow, active, launch, best) {
	const launchPath = oracleRemainingCriticalPath(candidateFlow, active, launch);
	const bestPath = oracleRemainingCriticalPath(candidateFlow, active, best);
	if (launchPath !== bestPath) return launchPath < bestPath;
	if (launch.length !== best.length) return launch.length > best.length;
	for (const [offset, index] of launch.entries()) {
		if (index !== best[offset]) return index < best[offset];
	}
	return false;
}

function oracleRemainingCriticalPath(candidateFlow, active, launch) {
	const excluded = new Set([...active, ...launch]);
	const depths = [];
	for (const [index, goal] of candidateFlow.goals.entries()) {
		if (goal.status === "complete" || excluded.has(index)) {
			depths[index] = 0;
			continue;
		}
		const dependencies =
			goal.role === "final_acceptance"
				? candidateFlow.goals
						.filter((candidate) => candidate.role === "normal")
						.map((candidate) => candidate.index)
				: (goal.dependsOn ?? (index === 0 ? [] : [index - 1]));
		depths[index] =
			1 + Math.max(0, ...dependencies.map((item) => depths[item] ?? 0));
	}
	return Math.max(0, ...depths);
}

function deepFreeze(value) {
	if (value && typeof value === "object") {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

function flow(goals, overrides = {}) {
	return {
		schemaVersion: 17,
		language: "zh",
		id: "F1",
		title: "Scheduler",
		status: "running",
		source: {
			type: "conversation",
			transcript: [{ kind: "user", at: "2026-01-01", text: "Schedule" }],
		},
		createdAt: 0,
		updatedAt: 0,
		startedAt: 0,
		completedAt: null,
		currentGoal: firstActiveIndex(goals),
		meta: null,
		attention: null,
		parallelRun: null,
		repairAttempts: 0,
		errors: [],
		...overrides,
		goals: goals.map((goal, index) => ({
			index,
			title: `G${index + 1}`,
			role: index === goals.length - 1 ? "final_acceptance" : "normal",
			file: `G${index + 1}.md`,
			startedAt: goal.status === "pending" ? null : 0,
			completedAt: goal.status === "complete" ? 0 : null,
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
			checks: emptyChecks(),
			...goal,
		})),
	};
}

function firstActiveIndex(goals) {
	const index = goals.findIndex((goal) => goal.status !== "complete");
	return index === -1 ? 0 : index;
}

function emptyChecks() {
	return {
		acceptance: { enabled: true, rounds: [], active: null },
		quality: { enabled: true, rounds: [], active: null },
	};
}
