import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	qualityNonRegression,
	scoreStructuredOutput,
	selectPlateau,
	summarizeSamples,
} from "../scripts/context-evidence-evaluation.mjs";
import { evaluationRunnerConfig } from "../scripts/evaluate-context-evidence.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const benchmark = JSON.parse(
	readFileSync(
		join(root, "tests/fixtures/context-evidence/evaluation.json"),
		"utf8",
	),
);
const models = ["test/sol", "test/terra", "test/claude"];
const packet = `[2026-01-01] [entry:u1] [source:user]
数量 0 是合法值，负数必须返回验证错误。
输出 JSON 的键顺序保持 id, quantity, source。

[2026-01-02] [entry:supplement-1] [source:visible user supplement]
路径字段必须拒绝 \`../\`。

[2026-01-03] [call:call-read-new] [tool:read] [succeeded]
Result [entry:r5]:
if (!quantity) throw new Error("quantity required");
return join(process.cwd(), input);

[2026-01-04] [call:call-test-fail] [tool:bash] [failed]
Result [entry:r6]:
FAIL tests/import-orders.test.ts
expected path ../secrets.csv to be rejected

[2026-01-05] [call:call-test-latest] [tool:bash] [succeeded]
Result [entry:r7]:
import-orders: 13 passed`;
const baselineEvidence = `[baseline] [entry:transcript-baseline] [source:transcript baseline]
数量 0 是合法值，负数必须返回验证错误。输出 JSON 的键顺序保持 id, quantity, source。路径字段必须拒绝 \`../\`。`;

evaluationRunnerConfigScenario();
structuredIdsIgnoreWordingScenario();
forgedAndMisattributedEvidenceScenario();
decoyScenario();
majorityPlateauScenario();
persistentFalsePositiveScenario();
console.log("context evidence evaluation smoke ok");

function evaluationRunnerConfigScenario() {
	assert(
		JSON.stringify(
			evaluationRunnerConfig({
				background: {
					command: "custom-pi",
					extensions: ["first.mjs", "second.mjs"],
				},
				checks: { timeoutMinutes: 1.5 },
			}),
		) ===
			JSON.stringify({
				command: "custom-pi",
				extensions: ["first.mjs", "second.mjs"],
				timeoutMs: 90_000,
			}),
		"current evaluator process config was not mapped",
	);
	assert(
		JSON.stringify(evaluationRunnerConfig({})) ===
			JSON.stringify({ command: "pi", extensions: [], timeoutMs: 1_200_000 }),
		"evaluator process config defaults changed",
	);
	assert(
		JSON.stringify(
			evaluationRunnerConfig({
				runner: {
					command: "legacy-pi",
					extensions: ["legacy.mjs"],
					timeoutMs: 1,
				},
			}),
		) ===
			JSON.stringify({ command: "pi", extensions: [], timeoutMs: 1_200_000 }),
		"legacy runner config still affects evaluation",
	);
}

function structuredIdsIgnoreWordingScenario() {
	const english = scoreStructuredOutput(
		validOutput("English classification note"),
		benchmark,
		packet,
	);
	const chinese = scoreStructuredOutput(
		validOutput("中文分类说明"),
		benchmark,
		packet,
	);
	for (const score of [english, chinese]) {
		assert(score.requirements === 4, JSON.stringify(score));
		assert(score.defects === 4, JSON.stringify(score));
		assert(score.falsePositives === 0, JSON.stringify(score));
	}
	assert(
		JSON.stringify(english.requirementIds) ===
			JSON.stringify(chinese.requirementIds),
		"wording changed requirement classification",
	);
	assert(
		JSON.stringify(english.defectIds) === JSON.stringify(chinese.defectIds),
		"wording changed defect classification",
	);
}

function forgedAndMisattributedEvidenceScenario() {
	const output = JSON.stringify({
		requirements: [
			{
				id: "zero-is-valid",
				evidence: [
					{
						locator: "entry:not-in-packet",
						quote: "数量 0 是合法值",
					},
				],
			},
		],
		defects: [
			{
				id: "falsy-zero-check",
				evidence: [
					{
						locator: "entry:r5",
						quote: "join(process.cwd(), input)",
					},
				],
			},
		],
	});
	const score = scoreStructuredOutput(output, benchmark, packet);
	assert(score.requirements === 0, JSON.stringify(score));
	assert(score.defects === 0, JSON.stringify(score));
	assert(score.falsePositives === 0, JSON.stringify(score));
	assert(score.groundingErrors === 2, JSON.stringify(score));
}

function decoyScenario() {
	const output = JSON.stringify({
		requirements: [
			{
				id: "zero-is-invalid",
				evidence: [{ locator: "entry:u1", quote: "数量 0 是合法值" }],
			},
		],
		defects: [
			{
				id: "public-api-changed",
				evidence: [{ locator: "entry:r5", quote: "if (!quantity)" }],
			},
		],
	});
	const score = scoreStructuredOutput(output, benchmark, packet);
	assert(score.falsePositives === 2, JSON.stringify(score));
	const leaked = scoreStructuredOutput(
		validOutput("INTERNAL_SENTINEL_DO_NOT_LEAK"),
		benchmark,
		packet,
	);
	assert(leaked.leakedInternal, "forbidden marker was not detected");
}

function majorityPlateauScenario() {
	const stable = scoreStructuredOutput(
		validOutput("stable"),
		benchmark,
		packet,
	);
	const noisyOutput = JSON.parse(validOutput("noisy"));
	noisyOutput.defects.push({
		id: "public-api-changed",
		evidence: [{ locator: "entry:r5", quote: "if (!quantity)" }],
	});
	const noisy = scoreStructuredOutput(
		JSON.stringify(noisyOutput),
		benchmark,
		packet,
	);
	const runs = models.flatMap((model) => [
		sample(model, 1, stable),
		sample(model, 2, stable),
		sample(model, 3, noisy),
	]);
	const summary = summarizeSamples(runs, benchmark, models, 3);
	assert(summary.aggregate.requirements === 12, JSON.stringify(summary));
	assert(summary.aggregate.defects === 12, JSON.stringify(summary));
	assert(summary.aggregate.falsePositives === 0, JSON.stringify(summary));
	const baselineRuns = models.flatMap((model) =>
		[1, 2, 3].map((sampleNumber) =>
			sample(
				model,
				sampleNumber,
				scoreStructuredOutput(baselineOutput(), benchmark, baselineEvidence),
			),
		),
	);
	const baseline = summarizeSamples(baselineRuns, benchmark, models, 3);
	assert(qualityNonRegression(summary, baseline), "majority should qualify");
	const selected = selectPlateau(
		[
			{ tokenLimit: 16_000, status: "overflow", qualifies: false },
			candidate(32_000, summary),
			candidate(64_000, summary),
		],
		baseline.aggregate,
		12,
	);
	assert(selected?.tokenLimit === 32_000, "smallest plateau was not selected");
}

function persistentFalsePositiveScenario() {
	const base = JSON.parse(validOutput("stable"));
	const decoys = ["public-api-changed", "json-key-order-broken", "unknown"];
	const runs = decoys.map((id, index) => {
		const output = {
			...base,
			defects: [
				...base.defects,
				{
					id,
					evidence: [{ locator: "entry:r5", quote: "if (!quantity)" }],
				},
			],
		};
		return sample(
			models[0],
			index + 1,
			scoreStructuredOutput(JSON.stringify(output), benchmark, packet),
		);
	});
	const summary = summarizeSamples(runs, benchmark, [models[0]], 3);
	assert(
		summary.aggregate.falsePositives === 1,
		"different false-positive IDs in every sample were hidden",
	);
}

function validOutput(note) {
	return JSON.stringify({
		requirements: [
			item("zero-is-valid", "entry:u1", "数量 0 是合法值", note),
			item("negative-is-error", "entry:u1", "负数必须返回验证错误", note),
			item("json-key-order", "entry:u1", "id, quantity, source", note),
			item(
				"reject-parent-path",
				"entry:supplement-1",
				"路径字段必须拒绝 `../`",
				note,
			),
		],
		defects: [
			item("falsy-zero-check", "entry:r5", "if (!quantity)", note),
			item("negative-validation", "entry:r5", "if (!quantity)", note),
			item("path-traversal", "entry:r5", "join(process.cwd(), input)", note),
			{
				id: "contradictory-validation",
				note,
				evidence: [
					{
						locator: "call:call-test-fail",
						quote: "FAIL tests/import-orders.test.ts",
					},
					{
						locator: "call:call-test-latest",
						quote: "import-orders: 13 passed",
					},
				],
			},
		],
	});
}

function baselineOutput() {
	return JSON.stringify({
		requirements: [
			item("zero-is-valid", "entry:transcript-baseline", "数量 0 是合法值"),
			item(
				"negative-is-error",
				"entry:transcript-baseline",
				"负数必须返回验证错误",
			),
			item(
				"json-key-order",
				"entry:transcript-baseline",
				"id, quantity, source",
			),
			item(
				"reject-parent-path",
				"entry:transcript-baseline",
				"路径字段必须拒绝 `../`",
			),
		],
		defects: [],
	});
}

function item(id, locator, quote, note) {
	return { id, ...(note ? { note } : {}), evidence: [{ locator, quote }] };
}

function sample(model, sampleNumber, metrics) {
	return {
		model,
		sample: sampleNumber,
		elapsedMs: 20 + sampleNumber,
		promptTokens: 200,
		metrics,
	};
}

function candidate(tokenLimit, summary) {
	return {
		tokenLimit,
		status: "evaluated",
		qualifies: true,
		aggregate: summary.aggregate,
	};
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
