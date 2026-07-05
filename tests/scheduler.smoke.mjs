import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-scheduler-test-${runId}`);
const srcOut = join(out, "src");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	[
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
	],
	{ cwd: root, stdio: "inherit" },
);

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
				{ status: "pending", dependsOn: [0], writeScope: ["src/ui/**"] },
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
				{ status: "pending", dependsOn: [0], writeScope: ["src/api/**"] },
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

	assert.equal(
		computeReadyBatch(flow([{ status: "complete" }, { status: "complete" }])),
		null,
		"complete flow should have no ready batch",
	);
	assert.equal(
		computeReadyBatch(
			flow([{ status: "complete" }, { status: "pending" }], {
				parallelBatch: [1],
			}),
		),
		null,
		"active parallel batch should block scheduling",
	);
	assert.equal(
		computeReadyBatch(flow([{ status: "running" }, { status: "pending" }])),
		null,
		"running goal should block scheduling",
	);

	assert.equal(scopesOverlap(["src/**"], ["src/api/**"]), true);
	assert.equal(scopesOverlap(["src/api/**"], ["src/ui/**"]), false);

	console.log("scheduler smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function flow(goals, overrides = {}) {
	return {
		schemaVersion: 5,
		language: "zh",
		id: "F1-scheduler",
		title: "Scheduler",
		status: "running",
		source: { type: "conversation", path: null, originalRequest: "" },
		createdAt: 0,
		updatedAt: 0,
		startedAt: 0,
		currentGoal: firstActiveIndex(goals),
		parallelBatch: null,
		repairAttempts: 0,
		errors: [],
		...overrides,
		goals: goals.map((goal, index) => ({
			index,
			title: `G${index + 1}`,
			role: index === goals.length - 1 ? "final_acceptance" : "normal",
			file: `G${index + 1}.md`,
			completionCursor: null,
			sessionFile: null,
			sessionName: null,
			snapshot: null,
			snapshotHash: null,
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
