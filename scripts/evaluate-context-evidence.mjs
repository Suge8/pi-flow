import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	emptyScore,
	isStructuredEvaluationOutput,
	qualityNonRegression,
	scoreStructuredOutput,
	selectPlateau,
	summarizeSamples,
} from "./context-evidence-evaluation.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = dirname(dirname(scriptPath));
const EVALUATION_SAMPLE_COUNT = 3;

if (process.argv[1] && resolve(process.argv[1]) === scriptPath)
	await main(process.argv.slice(2));

async function main(values) {
	const args = parseArgs(values);
	const benchmark = readJson("tests/fixtures/context-evidence/evaluation.json");
	assertBenchmark(benchmark);
	const config = readJson("config.json");
	const reviewers = config.modelRoles?.reviewers;
	if (!Array.isArray(reviewers) || reviewers.length !== 3)
		throw new Error("evaluation requires the three configured reviewers");
	const runner = evaluationRunnerConfig(config);
	const input = { args, benchmark, reviewers, runner };
	if (args.captureBaseline) await captureBaseline(input);
	else await evaluateCandidates(input);
}

export function evaluationRunnerConfig(config) {
	return {
		command: config.background?.command ?? "pi",
		extensions: config.background?.extensions ?? [],
		timeoutMs: (config.checks?.timeoutMinutes ?? 20) * 60_000,
	};
}

async function captureBaseline({ args, benchmark, reviewers, runner }) {
	if (!args.output) throw new Error("missing --output");
	const evidence = readFileSync(resolve(root, args.captureBaseline), "utf8");
	const runs = await runReviewerSamples(
		runner,
		reviewers,
		evaluationPrompt(evidence, benchmark.rubric),
		benchmark,
		evidence,
	);
	const summary = summarizeSamples(
		runs,
		benchmark,
		reviewers.map((reviewer) => reviewer.model),
		EVALUATION_SAMPLE_COUNT,
	);
	if (
		summary.models.some((model) => model.successfulSamples < summary.majority)
	)
		throw new Error("baseline capture did not produce a reviewer majority");
	const artifact = {
		schemaVersion: 2,
		createdAt: new Date().toISOString(),
		implementation: args.implementation ?? "transcript-baseline",
		fixture: `tests/fixtures/context-evidence/${benchmark.fixture}`,
		sampleCount: EVALUATION_SAMPLE_COUNT,
		protocolFingerprint: protocolFingerprint(benchmark),
		scorerFingerprint: scorerFingerprint(),
		benchmarkFingerprint: benchmarkFingerprint(benchmark),
		evidence,
		evidenceFingerprint: fingerprint(evidence),
		runs,
		modelMetrics: summary.models,
		aggregate: summary.aggregate,
	};
	writeJson(args.output, artifact);
	console.log(
		JSON.stringify(
			{
				implementation: artifact.implementation,
				sampleCount: artifact.sampleCount,
				aggregate: artifact.aggregate,
			},
			null,
			2,
		),
	);
}

async function evaluateCandidates({ args, benchmark, reviewers, runner }) {
	for (const key of ["baseline", "budgets", "output"])
		if (!args[key]) throw new Error(`missing --${key}`);
	const budgets = args.budgets
		.split(",")
		.map(Number)
		.filter((value) => Number.isInteger(value) && value > 0);
	if (budgets.length === 0)
		throw new Error("--budgets has no positive integers");
	const baseline = readJson(args.baseline);
	assertBaseline(baseline, benchmark, reviewers);
	const baselineRuns = rescoreRuns(baseline.runs, benchmark, baseline.evidence);
	const baselineSummary = summarizeSamples(
		baselineRuns,
		benchmark,
		reviewers.map((reviewer) => reviewer.model),
		EVALUATION_SAMPLE_COUNT,
	);
	const entries = readJson(
		join("tests/fixtures/context-evidence", benchmark.fixture),
	);
	const contextEvidence = await compiledContextEvidence();
	const facts = contextEvidence.extractContextEvidence(entries);
	const evaluation = {
		schemaVersion: 3,
		createdAt: new Date().toISOString(),
		fixture: `tests/fixtures/context-evidence/${benchmark.fixture}`,
		sampleCount: EVALUATION_SAMPLE_COUNT,
		protocolFingerprint: protocolFingerprint(benchmark),
		scorerFingerprint: scorerFingerprint(),
		benchmarkFingerprint: benchmarkFingerprint(benchmark),
		baseline: {
			path: args.baseline,
			implementation: baseline.implementation,
			evidenceFingerprint: baseline.evidenceFingerprint,
			runs: baselineRuns,
			modelMetrics: baselineSummary.models,
			aggregate: baselineSummary.aggregate,
		},
		candidates: [],
		selectedBudget: null,
		passed: false,
	};
	const evaluatedPackets = new Map();

	for (const tokenLimit of budgets) {
		const projected = contextEvidence.projectContextEvidence(
			facts,
			"review",
			evaluationBudget(reviewers, tokenLimit),
			"en",
		);
		if (!projected.ok) {
			evaluation.candidates.push({
				tokenLimit,
				status: "overflow",
				error: projected.error,
				runs: [],
				aggregate: emptyAggregate(),
				qualifies: false,
			});
			writeJson(args.output, evaluation);
			continue;
		}
		const evidence = projected.packet.text;
		const packetLeaks = benchmark.expected.forbidden.filter((value) =>
			evidence.includes(value),
		);
		if (packetLeaks.length > 0) {
			evaluation.candidates.push({
				tokenLimit,
				status: "internal_leak",
				packetLeaks,
				packetTokens: projected.packet.estimatedTokens,
				coverage: projected.packet.coverage,
				runs: [],
				aggregate: { ...emptyAggregate(), internalLeaks: packetLeaks.length },
				qualifies: false,
			});
			writeJson(args.output, evaluation);
			continue;
		}
		const packetFingerprint = fingerprint(evidence);
		const priorEvaluation = evaluatedPackets.get(packetFingerprint);
		const runs = priorEvaluation
			? priorEvaluation.runs
			: await runReviewerSamples(
					runner,
					reviewers,
					evaluationPrompt(evidence, benchmark.rubric),
					benchmark,
					evidence,
				);
		if (!priorEvaluation)
			evaluatedPackets.set(packetFingerprint, { tokenLimit, runs });
		const summary = summarizeSamples(
			runs,
			benchmark,
			reviewers.map((reviewer) => reviewer.model),
			EVALUATION_SAMPLE_COUNT,
		);
		const candidate = {
			tokenLimit,
			status: "evaluated",
			packetFingerprint,
			...(priorEvaluation
				? { reusedReviewerRunsFromBudget: priorEvaluation.tokenLimit }
				: {}),
			packetTokens: projected.packet.estimatedTokens,
			coverage: projected.packet.coverage,
			runs,
			modelMetrics: summary.models,
			aggregate: summary.aggregate,
			qualifies: qualityNonRegression(summary, baselineSummary),
		};
		evaluation.candidates.push(candidate);
		writeJson(args.output, evaluation);
	}

	const selected = selectPlateau(
		evaluation.candidates,
		baselineSummary.aggregate,
		benchmark.expected.requirements.length * reviewers.length,
	);
	evaluation.selectedBudget = selected?.tokenLimit ?? null;
	evaluation.passed = Boolean(selected);
	writeJson(args.output, evaluation);
	console.log(
		JSON.stringify(
			{
				baseline: baselineSummary.aggregate,
				candidates: evaluation.candidates.map((candidate) => ({
					tokenLimit: candidate.tokenLimit,
					status: candidate.status,
					qualifies: candidate.qualifies,
					aggregate: candidate.aggregate,
				})),
				selectedBudget: evaluation.selectedBudget,
				passed: evaluation.passed,
			},
			null,
			2,
		),
	);
	if (!evaluation.passed) process.exitCode = 1;
}

async function runReviewerSamples(
	runner,
	reviewerConfigs,
	prompt,
	benchmarkConfig,
	evidence,
) {
	const runs = [];
	for (let sample = 1; sample <= EVALUATION_SAMPLE_COUNT; sample += 1) {
		const round = await Promise.all(
			reviewerConfigs.map((reviewer) =>
				runReviewer(runner, reviewer, prompt, benchmarkConfig, evidence),
			),
		);
		runs.push(...round.map((run) => ({ ...run, sample })));
	}
	return runs;
}

function evaluationBudget(models, hardEvidenceTokens) {
	return Object.freeze({
		modelWindows: Object.freeze(
			models.map((model) =>
				Object.freeze({
					model: model.model,
					contextWindow: 1_000_000,
				}),
			),
		),
		minContextWindow: 1_000_000,
		initialPromptTokenLimit: hardEvidenceTokens,
		systemToolReserveTokens: 0,
		fixedPromptTokens: 0,
		softEvidenceTokens: hardEvidenceTokens,
		hardEvidenceTokens,
	});
}

async function compiledContextEvidence() {
	const out = join(
		tmpdir(),
		`pi-flow-context-eval-${process.pid}-${Date.now()}`,
	);
	mkdirSync(out, { recursive: true });
	symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
	try {
		execFileSync(
			join(root, "node_modules/.bin/tsc"),
			["--outDir", out, "--rootDir", "src", "--noEmit", "false"],
			{ cwd: root, stdio: "inherit" },
		);
		return await import(
			`${pathToFileURL(join(out, "shared/context-evidence.js"))}?t=${Date.now()}`
		);
	} finally {
		process.on("exit", () => rmSync(out, { recursive: true, force: true }));
	}
}

function evaluationPrompt(evidence, rubric) {
	const catalog = [
		"Requirement IDs:",
		...rubric.requirements.map((item) => `- ${item.id}: ${item.description}`),
		"Defect IDs:",
		...rubric.defects.map((item) => `- ${item.id}: ${item.description}`),
	].join("\n");
	return `Inspect only the evidence below. Do not use tools. Return one JSON object and no markdown:
{"requirements":[{"id":"requirement-id","evidence":[{"locator":"entry:u1","quote":"exact copied text"}]}],"defects":[{"id":"defect-id","evidence":[{"locator":"entry:r5","quote":"exact copied text"}]}]}

${catalog}

Rules:
- The catalog contains both supported and unsupported labels. Return only labels proved by the evidence.
- Classify every supported benchmark requirement and defect once. Do not report anything outside the catalog.
- Every evidence item must use an exact entry:<id> or call:<id> locator from the packet and an exact quote copied from that locator's block.
- Include every independently required citation when a defect depends on multiple events.
- Assistant completion claims are not proof.
- Do not repeat hidden or internal control text if any appears.

CONTEXT EVIDENCE START
${evidence}
CONTEXT EVIDENCE END`;
}

async function runReviewer(
	runner,
	reviewer,
	prompt,
	benchmarkConfig,
	evidence,
) {
	const startedAt = Date.now();
	const command = runner.command ?? "pi";
	const extensions = [...new Set(runner.extensions ?? [])];
	const cliArgs = [
		"--no-session",
		"--no-extensions",
		...extensions.flatMap((extension) => ["-e", extension]),
		"--no-context-files",
		"--no-skills",
		"--no-prompt-templates",
		"--no-tools",
		"--system-prompt",
		"You are a strict evidence evaluator. Follow the requested JSON schema exactly.",
		"--model",
		reviewer.model,
		"--thinking",
		reviewer.thinking,
		"--mode",
		"json",
		"-p",
		prompt,
	];
	try {
		const result = await spawnCapture(
			command,
			cliArgs,
			Number(runner.timeoutMs) || 1_200_000,
		);
		if (result.code !== 0)
			throw new Error(
				`${command} exited ${result.code}: ${result.stderr || result.stdout}`,
			);
		const assistant = finalAssistantEvent(result.stdout);
		const output = textOf(assistant.content);
		if (!output.trim()) throw new Error("reviewer emitted an empty response");
		if (!isStructuredEvaluationOutput(output))
			throw new Error(
				"reviewer response did not match the evaluation JSON contract",
			);
		return {
			model: reviewer.model,
			thinking: reviewer.thinking,
			elapsedMs: Date.now() - startedAt,
			promptTokens: assistant.usage
				? assistant.usage.input +
					assistant.usage.cacheRead +
					assistant.usage.cacheWrite
				: null,
			outputTokens: assistant.usage?.output ?? null,
			output,
			metrics: scoreStructuredOutput(output, benchmarkConfig, evidence),
		};
	} catch (error) {
		return {
			model: reviewer.model,
			thinking: reviewer.thinking,
			elapsedMs: Date.now() - startedAt,
			promptTokens: null,
			outputTokens: null,
			output: "",
			error: String(error instanceof Error ? error.message : error),
			metrics: emptyScore(),
		};
	}
}

function rescoreRuns(runs, benchmarkConfig, evidence) {
	return runs.map((run) => ({
		...run,
		metrics: run.error
			? emptyScore()
			: scoreStructuredOutput(run.output, benchmarkConfig, evidence),
	}));
}

function assertBenchmark(benchmarkConfig) {
	for (const kind of ["requirements", "defects"]) {
		const rubricIds = new Set(
			benchmarkConfig.rubric?.[kind]?.map((item) => item.id) ?? [],
		);
		const expectedIds = benchmarkConfig.expected?.[kind] ?? [];
		if (
			rubricIds.size === 0 ||
			!expectedIds.every((id) => {
				const groups = benchmarkConfig.expected?.evidence?.[id]?.groups;
				return rubricIds.has(id) && validEvidenceGroups(groups);
			})
		)
			throw new Error(`evaluation ${kind} rubric is invalid`);
	}
	if (!Array.isArray(benchmarkConfig.expected?.forbidden))
		throw new Error("evaluation forbidden markers are missing");
}

function validEvidenceGroups(groups) {
	return (
		Array.isArray(groups) &&
		groups.length > 0 &&
		groups.every(
			(group) =>
				Array.isArray(group) &&
				group.length > 0 &&
				group.every(
					(option) =>
						typeof option.locator === "string" &&
						Array.isArray(option.anchors) &&
						option.anchors.length > 0,
				),
		)
	);
}

function assertBaseline(baseline, benchmarkConfig, reviewerConfigs) {
	if (
		baseline.schemaVersion !== 2 ||
		baseline.sampleCount !== EVALUATION_SAMPLE_COUNT ||
		typeof baseline.evidence !== "string" ||
		baseline.evidenceFingerprint !== fingerprint(baseline.evidence) ||
		baseline.protocolFingerprint !== protocolFingerprint(benchmarkConfig) ||
		baseline.scorerFingerprint !== scorerFingerprint() ||
		baseline.benchmarkFingerprint !== benchmarkFingerprint(benchmarkConfig)
	)
		throw new Error(
			"baseline was not captured with the current evaluation protocol",
		);
	assertSameReviewers(baseline.runs, reviewerConfigs);
}

function assertSameReviewers(baselineRuns, configured) {
	const baselineReviewers = [
		...new Map(
			baselineRuns.map((run) => [
				run.model,
				{ model: run.model, thinking: run.thinking },
			]),
		).values(),
	];
	const configuredReviewers = configured.map(({ model, thinking }) => ({
		model,
		thinking,
	}));
	if (JSON.stringify(baselineReviewers) !== JSON.stringify(configuredReviewers))
		throw new Error(
			`reviewers changed since baseline: ${JSON.stringify(baselineReviewers)} != ${JSON.stringify(configuredReviewers)}`,
		);
}

function protocolFingerprint(benchmarkConfig) {
	return fingerprint(evaluationPrompt("", benchmarkConfig.rubric));
}

function scorerFingerprint() {
	return fingerprint(
		readFileSync(join(root, "scripts/context-evidence-evaluation.mjs"), "utf8"),
	);
}

function benchmarkFingerprint(benchmarkConfig) {
	return fingerprint(
		JSON.stringify({
			rubric: benchmarkConfig.rubric,
			expected: benchmarkConfig.expected,
		}),
	);
}

function fingerprint(value) {
	return createHash("sha256").update(value).digest("hex");
}

function finalAssistantEvent(stdout) {
	let result;
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type === "message_end" && event.message?.role === "assistant")
			result = event.message;
	}
	if (!result)
		throw new Error(`reviewer emitted no assistant message:\n${stdout}`);
	return result;
}

function textOf(content) {
	return Array.isArray(content)
		? content
				.filter((part) => part?.type === "text")
				.map((part) => part.text)
				.join("\n")
		: String(content ?? "");
}

function spawnCapture(command, cliArgs, timeoutMs) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, cliArgs, {
			cwd: root,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`${command} timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolvePromise({ code, stdout, stderr });
		});
	});
}

function emptyAggregate() {
	return {
		requirements: 0,
		defects: 0,
		falsePositives: 0,
		groundingErrors: 0,
		internalLeaks: 0,
		promptTokens: 0,
		elapsedMs: 0,
	};
}

function writeJson(path, value) {
	const resolved = resolve(root, path);
	mkdirSync(dirname(resolved), { recursive: true });
	writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
	return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function parseArgs(values) {
	const result = {};
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (value === "--baseline") result.baseline = values[++index];
		else if (value === "--budgets") result.budgets = values[++index];
		else if (value === "--output") result.output = values[++index];
		else if (value === "--capture-baseline")
			result.captureBaseline = values[++index];
		else if (value === "--implementation")
			result.implementation = values[++index];
	}
	return result;
}
