import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-goal-review-test-${runId}`);
process.env.PI_CODING_AGENT_DIR = join(out, "agent-state");
const defaultCwd = join(out, "project");
const srcOut = join(out, "src");
const bin = join(out, "bin");

rmSync(out, { recursive: true, force: true });
mkdirSync(bin, { recursive: true });
cpSync(join(root, "prompts"), join(out, "prompts"), { recursive: true });
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	["--outDir", srcOut, "--rootDir", "src", "--noEmit", "false"],
	{ cwd: root, stdio: "inherit" },
);

try {
	await runScenario(promptContractScenario);
	await runScenario(reviewFormatScenario);
	await runScenario(checksValidationScenario);
	await runScenario(flowAcceptancePromptIncludesPlanScenario);
	await runScenario(flowLiveReviewsSyncScenario);
	await runScenario(flowGoalCompleteWithQualityReviewScenario);
	await runScenario(flowQualityReviewFailureUsesFlowContinueScenario);
	console.log("goal review smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

async function runScenario(fn, name = fn.name) {
	try {
		await fn();
	} catch (error) {
		console.error(`goal review smoke failed in ${name}`);
		throw error;
	}
}

async function promptContractScenario() {
	const { parseCheckVerdictLine } = await import(
		`file://${join(srcOut, "shared/review-verdict.js")}?strict-${Date.now()}`
	);
	const goalPrompt = readFileSync(
		join(root, "prompts", "zh", "goal-audit.md"),
		"utf8",
	);
	const reviewPrompt = readFileSync(
		join(root, "prompts", "zh", "review.md"),
		"utf8",
	);
	assert(goalPrompt.includes("# 完成验收"), goalPrompt);
	assert(goalPrompt.includes("第一行只能是：PASS 或 FAIL"), goalPrompt);
	assert(goalPrompt.includes("输出契约"), goalPrompt);
	assert(reviewPrompt.includes("第一行只能是：PASS 或 FAIL"), reviewPrompt);
	assert(reviewPrompt.includes("输出契约"), reviewPrompt);
	assert(!goalPrompt.includes("任务：完成验收"), goalPrompt);
	assert(!goalPrompt.includes("工具安全"), goalPrompt);
	assert(
		reviewPrompt.includes("若 PASS，第二行写一句极简质量检查摘要"),
		reviewPrompt,
	);
	const removedToolName = "goal" + "_complete";
	assert(!goalPrompt.includes(removedToolName), goalPrompt);
	assert(!reviewPrompt.includes(removedToolName), reviewPrompt);
	assert(parseCheckVerdictLine("PASS") === "PASS", "PASS was rejected");
	assert(
		parseCheckVerdictLine("**FAIL**") === "FAIL",
		"markdown FAIL was rejected",
	);
	assert(
		parseCheckVerdictLine("PASS 目标已完成") === undefined,
		"non-exact PASS line was accepted",
	);
	assert(
		parseCheckVerdictLine("FAIL because") === undefined,
		"non-exact FAIL line was accepted",
	);
}

async function reviewFormatScenario() {
	const { formatReviewResultLines } = await import(
		`file://${join(srcOut, "shared/review-format.js")}?t=${Date.now()}`
	);
	const lines = formatReviewResultLines(
		"FAIL\n\n模型 1 · a\n问题A\n\n模型 2 · b\n问题B",
	);
	assert(lines.includes("---"), `sections not separated: ${lines.join("|")}`);
	assert(
		!lines.includes("未完成"),
		`verdict line leaked into card: ${lines.join("|")}`,
	);
	assert(
		lines.indexOf("模型 1 · a") < lines.indexOf("---") &&
			lines.indexOf("---") < lines.indexOf("模型 2 · b"),
		lines.join("|"),
	);
}

async function checksValidationScenario() {
	const { validateChecks } = await import(
		`file://${join(srcOut, "goal/validator.js")}?t=${Date.now()}`
	);
	let errors = [];
	validateChecks({}, errors);
	assert(
		errors.some((error) => error.includes("checks.acceptance")),
		errors.join(" | "),
	);
	errors = [];
	validateChecks(
		{
			acceptance: {
				enabled: true,
				rounds: [{ round: 1, result: "error", summary: "review crashed" }],
				active: null,
			},
			quality: { enabled: false, rounds: [], active: null },
		},
		errors,
	);
	assert(errors.length === 0, `valid check error round rejected: ${errors}`);
}

async function flowAcceptancePromptIncludesPlanScenario() {
	const command = captureCommand("PASS\n验收 OK\n");
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-plan");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const args = readFileSync(`${command}.args`, "utf8");
	assert(args.includes("计划（"), args);
	assert(args.includes("会话记录："), args);
	assert(args.includes("相关文件线索："), args);
	assert(args.includes("修改文件:"), args);
	assert(args.includes("引用文件:"), args);
	assert(args.includes(".flow/F1-login/G1-login.md"), args);
	assert(args.includes("## Success Criteria\n- Flow plan proof."), args);
	const flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.acceptance.rounds[0].summary === "验收 OK",
		JSON.stringify(flow.goals[0].checks),
	);
}

async function flowLiveReviewsSyncScenario() {
	writeConfig({
		acceptance: true,
		quality: false,
		command: shellScript("sleep 2"),
	});
	const cwd = join(out, "flow-live-checks");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow live objective", ctx);
	const pendingReview = handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const flowJson = join(cwd, ".flow", "F1-login", "flow.json");
	const live = await waitFor(
		() =>
			JSON.parse(readFileSync(flowJson, "utf8")).goals[0].checks?.acceptance
				.active,
		"flow.json never received live review progress",
	);
	assert(
		live.some((item) => item.status === "running"),
		JSON.stringify(live),
	);
	handlers.get("session_shutdown")({}, ctx);
	await pendingReview;
	const settled = JSON.parse(readFileSync(flowJson, "utf8")).goals[0].checks;
	assert(
		settled.acceptance.active === null,
		`shutdown left live review in flow.json: ${JSON.stringify(settled.acceptance.active)}`,
	);
	const html = readFileSync(
		join(cwd, ".flow", "F1-login", "flow.html"),
		"utf8",
	);
	assert(
		!html.includes("检查中"),
		"flow.html kept stale 检查中 after shutdown",
	);
}

async function flowGoalCompleteWithQualityReviewScenario() {
	const command = captureCommand("PASS\n质量 OK\n");
	writeConfig({ acceptance: false, quality: true, command });
	const cwd = join(out, "flow-quality-pass");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details?.title);
	assert(titles.includes("质量检查中"), titles.join(" | "));
	assert(titles.includes("质量检查通过"), titles.join(" | "));
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "Flow 第 1 步 · Login 已完成",
		card.message.details.title,
	);
	assert(
		card.message.content.includes("质量检查：✅ 质量 OK"),
		card.message.content,
	);
	const flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.quality.rounds[0].result === "passed" &&
			flow.goals[0].checks.acceptance.enabled === false,
		JSON.stringify(flow.goals[0].checks),
	);
}

async function flowQualityReviewFailureUsesFlowContinueScenario() {
	writeConfig({
		acceptance: false,
		quality: true,
		command: sequenceScript(["FAIL\n质量问题\n"]),
	});
	const cwd = join(out, "flow-quality-fail");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const content = state.messages.at(-1).message.content;
	assert(!content.includes("/goal continue"), content);
	const flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.quality.rounds[0].result === "failed",
		JSON.stringify(flow.goals[0].checks.quality),
	);
}

function writeConfig({ acceptance = false, quality = false, command }) {
	mkdirSync(out, { recursive: true });
	const runnerCommand = command ?? script("PASS\nOK\n");
	writeFileSync(
		join(out, "config.json"),
		JSON.stringify({
			runner: {
				command: runnerCommand,
				tools: [],
				excludeTools: [],
				timeoutMs: 5000,
				extensions: [],
			},
			models: [{ model: "test/gpt-5.4-mini", thinking: "off" }],
			acceptance: { enabled: acceptance },
			quality: {
				enabled: quality,
				mode: "autoFix",
				runAfterCompletion: quality,
			},
		}),
	);
}

function script(output) {
	return shellScript(`printf '%s' '${output.replaceAll("'", "'\\''")}'`);
}

function captureCommand(output) {
	const path = join(bin, `capture-${Math.random().toString(16).slice(2)}`);
	writeFileSync(
		path,
		`#!/bin/sh
while [ "$#" -gt 0 ]; do
  printf '%s\n---ARG---\n' "$1"
  shift
done > '${path}.args'
printf '%s' '${output.replaceAll("'", "'\\''")}'
`,
		{ mode: 0o755 },
	);
	return path;
}

function sequenceScript(outputs) {
	return countedScript(outputs, "*) cat '{{last}}' ;;");
}

function countedScript(outputs, fallbackCase) {
	mkdirSync(bin, { recursive: true });
	const path = join(bin, `script-${Math.random().toString(16).slice(2)}`);
	const files = outputs.map((output, index) => {
		const file = `${path}.${index}.out`;
		writeFileSync(file, output);
		return file;
	});
	writeFileSync(
		path,
		`#!/bin/sh\ncount_file='${path}.count'\ncount=$(cat "$count_file" 2>/dev/null || echo 0)\ncount=$((count + 1))\necho "$count" > "$count_file"\ncase "$count" in\n${files.map((file, index) => `${index + 1}) cat '${file}' ;;`).join("\n")}\n${fallbackCase.replace("{{last}}", files.at(-1))}\nesac\n`,
		{ mode: 0o755 },
	);
	return path;
}

function shellScript(body) {
	mkdirSync(bin, { recursive: true });
	const path = join(bin, `script-${Math.random().toString(16).slice(2)}`);
	writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	return path;
}

async function loadGoalExtension(state) {
	const module = await import(
		`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
	);
	const handlers = new Map();
	module.default({
		registerCommand() {},
		registerTool() {},
		registerMessageRenderer() {},
		appendEntry(customType, data) {
			state.entries.push({ type: "custom", customType, data });
		},
		sendUserMessage(message) {
			state.sentMessages.push(String(message));
		},
		sendMessage(message, options = {}) {
			if (message.customType === "pi-flow-goal-prompt") {
				state.sentMessages.push(String(message.content));
				return;
			}
			if (message.details?.title) state.messages.push({ message, options });
		},
		on(name, handler) {
			if (name !== "agent_end") return handlers.set(name, handler);
			handlers.set(name, async (...args) => {
				await handler(...args);
				await module.waitForScheduledGoalStateReview();
			});
		},
	});
	return { handlers, module };
}

function createState() {
	return {
		entries: [],
		messages: [],
		sentMessages: [],
		notifications: [],
		statuses: [],
		widgets: [],
	};
}

function mockContext(state, cwd = defaultCwd, sessionFile = undefined) {
	return {
		cwd,
		hasUI: true,
		ui: {
			async confirm() {
				return true;
			},
			notify(message, level) {
				state.notifications.push(`${message}:${level ?? "info"}`);
			},
			setStatus(_key, value) {
				state.statuses.push(value);
			},
			setWorkingVisible() {},
			setEditorText(text) {
				state.editorText = text;
			},
			setWidget(key, content) {
				state.widgets.push({ key, content });
			},
		},
		isIdle() {
			return true;
		},
		hasPendingMessages() {
			return false;
		},
		sessionManager: {
			getSessionFile() {
				return sessionFile;
			},
			getBranch() {
				return state.entries;
			},
			getEntries() {
				return state.entries;
			},
			appendCustomEntry(customType, data) {
				state.entries.push({ type: "custom", customType, data });
			},
		},
	};
}

function writeFlow(cwd, sessionFile) {
	const dir = join(cwd, ".flow", "F1-login");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "G1-login.md"),
		"# Login\n\n## Objective\nFlow objective\n\n## Scope\nFlow scope.\n\n## Steps\n- [x] Ship login.\n\n## Success Criteria\n- Flow plan proof.\n\n## Verification\n- [x] test\n\n## Notes\n\n## Handoff\n",
	);
	writeFileSync(
		join(dir, "flow.json"),
		`${JSON.stringify(
			{
				schemaVersion: 6,
				language: "zh",
				id: "F1-login",
				title: "Login",
				status: "running",
				source: { type: "prompt", path: null, originalRequest: "login" },
				createdAt: Date.now(),
				updatedAt: Date.now(),
				startedAt: Date.now(),
				currentGoal: 0,
				repairAttempts: 0,
				errors: [],
				goals: [
					{
						index: 0,
						title: "Login",
						role: "normal",
						file: "G1-login.md",
						status: "running",
						completionCursor: null,
						sessionFile,
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
					},
				],
			},
			null,
			2,
		)}\n`,
	);
}

function readFlow(cwd) {
	return JSON.parse(
		readFileSync(join(cwd, ".flow", "F1-login", "flow.json"), "utf8"),
	);
}

function emptyChecks() {
	return {
		acceptance: { enabled: true, rounds: [], active: null },
		quality: { enabled: true, rounds: [], active: null },
	};
}

async function waitFor(read, message, timeoutMs = 3000) {
	const startedAt = Date.now();
	for (;;) {
		try {
			const value = read();
			if (value) return value;
		} catch {}
		if (Date.now() - startedAt > timeoutMs) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
