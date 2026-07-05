import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-plan-test-${runId}`);
const srcOut = join(out, "src");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	["--outDir", srcOut, "--rootDir", "src", "--noEmit", "false"],
	{ cwd: root, stdio: "inherit" },
);

try {
	await markdownScenario();
	await validatorScenario();
	await validateDraftCliScenario();
	await validateDraftConsistencyScenario();
	await flowBuilderScenario();
	await directoryIdMismatchScenario();
	await snapshotScenario();
	await viewScenario();
	console.log("plan smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

async function markdownScenario() {
	const { hasCriteriaDeviation, planSection, replaceHandoff } =
		await importModule("plan/markdown.js");
	const next = replaceHandoff(markdown(), "done");
	assert(
		planSection(next, "Objective") === "Ship v2.",
		"objective parse failed",
	);
	assert(planSection(next, "Handoff") === "done", "handoff replace failed");
	for (const text of [
		"criteria deviation found",
		"验收标准偏差：需要最终复核",
		"验收口径有调整",
	])
		assert(hasCriteriaDeviation(text), `${text} was not detected`);
	for (const text of [
		"未发现 criteria deviation",
		"no criteria deviation",
		"without acceptance deviation",
		"standard deviation is a statistical term",
	])
		assert(!hasCriteriaDeviation(text), `${text} caused a false positive`);
}

async function validatorScenario() {
	const { FLOW_GOAL_SECTIONS, validatePlanMarkdown } =
		await importModule("plan/validator.js");
	assert(
		validatePlanMarkdown(markdown(), FLOW_GOAL_SECTIONS).length === 0,
		"valid plan failed",
	);
	assert(
		validatePlanMarkdown(
			markdown().replace("- [ ] Implement.", "Implement."),
			FLOW_GOAL_SECTIONS,
		).some((error) => error.includes("Steps")),
		"missing checkbox not rejected",
	);
	assert(
		validatePlanMarkdown(
			markdown().replace("- [ ] npm test", "npm test"),
			FLOW_GOAL_SECTIONS,
		).some((error) => error.includes("Verification")),
		"missing verification checkbox not rejected",
	);
	assert(
		validatePlanMarkdown(
			markdown().replace("- Done.", "* [ ] Done."),
			FLOW_GOAL_SECTIONS,
		).some((error) => error.includes("Success Criteria")),
		"success criteria star checkbox not rejected",
	);
	assert(
		validatePlanMarkdown(
			markdown().replace("- Done.", "+ [x] Done."),
			FLOW_GOAL_SECTIONS,
		).some((error) => error.includes("Success Criteria")),
		"success criteria plus checkbox not rejected",
	);
	assert(
		validatePlanMarkdown(
			markdown().replace("- [ ] Implement.", "- [!] Implement."),
			FLOW_GOAL_SECTIONS,
		).length === 0,
		"blocked checkbox was rejected",
	);
}

function validateDraftCliScenario() {
	const dir = join(out, "F1-cli");
	writeFlowDraft(dir, baseFlow("F1-cli", [baseFlowGoal(0, "step-1.md")]));
	execFileSync("node", [join(root, "scripts", "validate-draft.mjs"), dir]);
}

async function validateDraftConsistencyScenario() {
	const { validateFlowDir } = await importModule("flow/validator.js");
	const cases = [
		{
			name: "flow accepts persisted check error round",
			write: (dir) =>
				writeFlowDraft(
					dir,
					baseFlow("F1-check-error", [
						baseFlowGoal(0, "step-1.md", { checks: validChecks("error") }),
					]),
				),
		},
		{
			name: "flow accepts indented plan section headings",
			write: (dir) =>
				writeFlowDraft(
					dir,
					baseFlow("F2-indented-headings", [baseFlowGoal(0, "step-1.md")]),
					indentedMarkdown(),
				),
		},
		{
			name: "flow accepts todo progress states",
			write: (dir) =>
				writeFlowDraft(
					dir,
					baseFlow("F3-todo-states", [baseFlowGoal(0, "step-1.md")]),
					markdown()
						.replace("- [ ] Implement.", "- [~] Implement.")
						.replace("- [ ] npm test", "- [!] npm test"),
				),
		},
		{
			name: "flow rejects success criteria checkbox",
			write: (dir) =>
				writeFlowDraft(
					dir,
					baseFlow("F3-criteria-checkbox", [baseFlowGoal(0, "step-1.md")]),
					markdown().replace("- Done.", "+ [ ] Done."),
				),
		},
		{
			name: "flow accepts eleven goals",
			write: (dir) =>
				writeFlowDraft(dir, baseFlow("F3-eleven-goals", baseFlowGoals(11))),
		},
		{
			name: "flow rejects twelve goals",
			write: (dir) =>
				writeFlowDraft(dir, baseFlow("F3-twelve-goals", baseFlowGoals(12))),
		},
		{
			name: "flow rejects invalid current goal",
			write: (dir) =>
				writeFlowDraft(
					dir,
					baseFlow("F3-invalid-current", [baseFlowGoal(0, "step-1.md")], {
						currentGoal: 9,
					}),
				),
		},
		{
			name: "flow rejects invalid completion cursor",
			write: (dir) =>
				writeFlowDraft(
					dir,
					baseFlow("F3-invalid-cursor", [
						baseFlowGoal(0, "step-1.md", { completionCursor: "done" }),
					]),
				),
		},
		{
			name: "flow rejects missing step file",
			write: (dir) => {
				mkdirSync(dir, { recursive: true });
				writeJson(
					join(dir, "flow.json"),
					baseFlow("F3-missing-step", [baseFlowGoal(0, "missing.md")]),
				);
			},
		},
		{
			name: "flow rejects step directory",
			write: (dir) => {
				writeFlowDraft(
					dir,
					baseFlow("F4-step-directory", [baseFlowGoal(0, "step-1.md")]),
				);
				rmSync(join(dir, "step-1.md"));
				mkdirSync(join(dir, "step-1.md"));
			},
		},
		{
			name: "flow shape error short circuits step files",
			write: (dir) => {
				mkdirSync(dir, { recursive: true });
				writeJson(
					join(dir, "flow.json"),
					baseFlow("F5-short-circuit", [baseFlowGoal(0, "missing.md")], {
						currentGoal: 9,
					}),
				);
			},
		},
		{
			name: "flow rejects non object json",
			write: (dir) => {
				mkdirSync(dir, { recursive: true });
				writeJson(join(dir, "flow.json"), []);
			},
		},
	];
	for (const testCase of cases) {
		const stagingDir = join(out, testCase.name.replaceAll(/\W+/gu, "-"));
		testCase.write(stagingDir);
		const dir = artifactDirFromStaging(stagingDir);
		const source = validateFlowDir(dir);
		const cli = runValidateDraft(dir);
		const sourceOutput = source.errors.join("\n");
		assert(
			cli.ok === source.ok,
			`${testCase.name}: CLI ${cli.ok ? "accepted" : "rejected"} but source ${
				source.ok ? "accepted" : "rejected"
			}\nCLI:\n${cli.output}\nsource:\n${sourceOutput}`,
		);
		if (!source.ok)
			assert(
				cli.output === sourceOutput,
				`${testCase.name}: CLI errors differed\nCLI:\n${cli.output}\nsource:\n${sourceOutput}`,
			);
	}
	assertElevenGoalFlowValid(validateFlowDir);
	assertDuplicateFinalRejected(validateFlowDir);
}

function assertElevenGoalFlowValid(validateFlowDir) {
	const dir = join(out, "F6-eleven-direct");
	writeFlowDraft(dir, baseFlow("F6-eleven-direct", baseFlowGoals(11)));
	const source = validateFlowDir(dir);
	assert(source.ok, `11-goal flow rejected: ${source.errors.join("\n")}`);
	const cli = runValidateDraft(dir);
	assert(cli.ok, `11-goal draft CLI rejected: ${cli.output}`);
}

function assertDuplicateFinalRejected(validateFlowDir) {
	const dir = join(out, "F7-duplicate-final");
	writeFlowDraft(
		dir,
		baseFlow("F7-duplicate-final", [
			baseFlowGoal(0, "step-1.md"),
			baseFlowGoal(1, "step-2.md"),
			baseFlowGoal(2, "step-final-a.md", { role: "final_acceptance" }),
			baseFlowGoal(3, "step-final-b.md", { role: "final_acceptance" }),
		]),
	);
	assertValidationError(
		validateFlowDir(dir),
		"多步 Flow 必须有 1 个最终验收步骤（role: final_acceptance）",
		"duplicate final acceptance",
	);
	const cli = runValidateDraft(dir);
	assert(
		!cli.ok && cli.output.includes("多步 Flow 必须有 1 个最终验收步骤"),
		`duplicate final acceptance CLI accepted: ${cli.output}`,
	);
}

async function flowBuilderScenario() {
	const { buildFlowArtifact } = await importModule("flow/builder.js");
	const { computeReadyBatch } = await importModule("flow/scheduler.js");
	const { validateFlowDir } = await importModule("flow/validator.js");
	const dir = join(out, "F4-semantic-builder");
	const semantic = {
		title: "Semantic Flow",
		goals: [
			{
				title: "Build base",
				role: "normal",
				file: "G1-build.md",
				dependsOn: [],
				writeScope: ["src/base/**"],
			},
			{
				title: "Build API",
				role: "normal",
				file: "G2-api.md",
				dependsOn: [0],
				writeScope: ["src/api/**"],
			},
			{
				title: "Build UI",
				role: "normal",
				file: "G3-ui.md",
				dependsOn: [0],
				writeScope: ["src/ui/**"],
			},
			{
				title: "Final",
				role: "final_acceptance",
				file: "G4-final.md",
				dependsOn: [1, 2],
				writeScope: ["docs/final/**"],
			},
		],
	};
	mkdirSync(dir, { recursive: true });
	writeJson(join(dir, "flow.semantic.json"), semantic);
	for (const goal of semantic.goals)
		writeFileSync(join(dir, goal.file), markdown());
	const flow = buildFlowArtifact(
		dir,
		readJson(join(dir, "flow.semantic.json")),
		"zh",
		{
			type: "prompt",
			path: null,
			originalRequest: "Flow semantic",
		},
	);
	for (const field of [
		"schemaVersion",
		"language",
		"id",
		"title",
		"status",
		"source",
		"createdAt",
		"updatedAt",
		"startedAt",
		"currentGoal",
		"repairAttempts",
		"errors",
		"goals",
	])
		assert(field in flow, `flow builder missing ${field}`);
	const persisted = readJson(join(dir, "flow.json"));
	assert(
		persisted.id === "F4-semantic-builder" &&
			persisted.title === "Semantic Flow" &&
			persisted.goals.length === 4,
		"flow builder did not persist semantic title/goals",
	);
	assert(
		JSON.stringify(persisted.goals[1].dependsOn) === JSON.stringify([0]) &&
			JSON.stringify(persisted.goals[1].writeScope) ===
				JSON.stringify(["src/api/**"]),
		"flow builder did not persist semantic parallel fields",
	);
	const validation = validateFlowDir(dir);
	assert(
		validation.ok,
		`flow builder output invalid: ${validation.errors.join("\n")}`,
	);
	const schedulable = {
		...flow,
		goals: flow.goals.map((goal, index) =>
			index === 0 ? { ...goal, status: "complete" } : goal,
		),
	};
	assert(
		JSON.stringify(computeReadyBatch(schedulable)) ===
			JSON.stringify({ mode: "parallel", indices: [1, 2] }),
		"semantic parallel fields did not influence scheduler",
	);
}

async function directoryIdMismatchScenario() {
	const { validateFlowDir } = await importModule("flow/validator.js");
	const flowDir = join(out, "F9-dir");
	writeFlowDraft(flowDir, baseFlow("F9-json", [baseFlowGoal(0, "step-1.md")]));
	assertValidationError(
		validateFlowDir(flowDir),
		"flow 目录名必须等于 id：F9-json",
		"flow directory id mismatch",
	);
	const flowCli = runValidateDraft(flowDir);
	assert(
		!flowCli.ok && flowCli.output.includes("flow 目录名必须等于 id：F9-json"),
		`flow CLI mismatch accepted: ${flowCli.output}`,
	);
}

function artifactDirFromStaging(dir) {
	const id = artifactId(dir);
	if (!id) return dir;
	const target = join(dirname(dir), id);
	if (target !== dir) renameSync(dir, target);
	return target;
}

function artifactId(dir) {
	try {
		const parsed = JSON.parse(readFileSync(join(dir, "flow.json"), "utf8"));
		if (parsed && typeof parsed === "object" && typeof parsed.id === "string")
			return parsed.id;
	} catch {}
	return undefined;
}

function assertValidationError(result, fragment, label) {
	assert(!result.ok, `${label} accepted`);
	assert(
		result.errors.includes(fragment),
		`${label} error missing: ${result.errors.join(" | ")}`,
	);
}

async function snapshotScenario() {
	const { planSnapshotHash } = await importModule("plan/snapshot.js");
	const base = markdown();
	const mutableChange = base.replace("## Notes\n", "## Notes\nnew note\n");
	const protectedChange = base.replace("Ship v2.", "Ship v3.");
	assert(
		planSnapshotHash(base) === planSnapshotHash(mutableChange),
		"mutable section changed hash",
	);
	assert(
		planSnapshotHash(base) !== planSnapshotHash(protectedChange),
		"protected section did not change hash",
	);
	const uncheckedCriteria = base.replace("- Done.", "- [ ] Done.");
	const checkedCriteria = base.replace("- Done.", "- [x] Done.");
	assert(
		planSnapshotHash(uncheckedCriteria) !== planSnapshotHash(checkedCriteria),
		"success criteria checkbox state did not change hash",
	);
}

async function viewScenario() {
	const { checkboxProgress, parseSteps } = await importModule("plan/view.js");
	const markdown = "- [x] A\n- [~] B\n- [!] C\n- [ ] D\n";
	const progress = checkboxProgress(markdown);
	assert(
		progress.done === 1 && progress.total === 4 && progress.percent === 25,
		"progress failed",
	);
	const steps = parseSteps(markdown);
	assert(
		steps.map((step) => step.status).join(",") ===
			"done,active,blocked,pending",
		"step status parse failed",
	);
}

function writeFlowDraft(dir, flow, goalMarkdown = markdown()) {
	mkdirSync(dir, { recursive: true });
	writeJson(join(dir, "flow.json"), flow);
	for (const goal of flow.goals)
		writeFileSync(join(dir, goal.file), goalMarkdown);
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function runValidateDraft(dir) {
	const result = spawnSync(
		"node",
		[join(root, "scripts", "validate-draft.mjs"), dir],
		{ encoding: "utf8" },
	);
	return {
		ok: result.status === 0,
		output: `${result.stdout}${result.stderr}`.trim(),
	};
}

function baseFlow(id, goals, overrides = {}) {
	return {
		schemaVersion: 6,
		language: "zh",
		id,
		title: "Flow CLI",
		status: "draft",
		source: { type: "prompt", path: null, originalRequest: "Flow CLI" },
		createdAt: Date.now(),
		updatedAt: Date.now(),
		startedAt: null,
		currentGoal: 0,
		repairAttempts: 0,
		errors: [],
		goals,
		...overrides,
	};
}

function baseFlowGoals(count) {
	return Array.from({ length: count }, (_, index) => {
		const final = index === count - 1;
		return baseFlowGoal(
			index,
			final ? "step-final.md" : `step-${index + 1}.md`,
			final ? { role: "final_acceptance" } : {},
		);
	});
}

function baseFlowGoal(index, file, overrides = {}) {
	return {
		index,
		title: `Step ${index + 1}`,
		role: "normal",
		file,
		status: "pending",
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
		...overrides,
	};
}

function emptyChecks() {
	return {
		acceptance: { enabled: true, rounds: [], active: null },
		quality: { enabled: true, rounds: [], active: null },
	};
}

function validChecks(result) {
	return {
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result, summary: "summary" }],
			active: null,
		},
		quality: { enabled: false, rounds: [], active: null },
	};
}

function indentedMarkdown() {
	return markdown().replace(/^##/gmu, "  ##");
}

function markdown() {
	return `# Goal

## Objective
Ship v2.

## Scope
Only plan modules.

## Steps
- [ ] Implement.

## Success Criteria
- Done.

## Verification
- [ ] npm test

## Notes

## Handoff
`;
}

async function importModule(path) {
	return import(
		`file://${join(srcOut, path)}?t=${Date.now()}-${Math.random()}`
	);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
