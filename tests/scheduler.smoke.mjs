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
	const { computeReadyBatch, scopesOverlap } = await import(
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
