import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-language-test-${runId}`);
const srcOut = join(out, "src");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "prompts"), join(out, "prompts"), { recursive: true });
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	["--outDir", srcOut, "--rootDir", "src", "--noEmit", "false"],
	{ cwd: root, stdio: "inherit" },
);

try {
	const language = await import(
		`file://${join(srcOut, "shared/language.js")}?t=${Date.now()}`
	);
	const config = await import(
		`file://${join(srcOut, "shared/config.js")}?t=${Date.now()}`
	);
	const goalPrompt = await import(
		`file://${join(srcOut, "goal/prompt.js")}?t=${Date.now()}`
	);
	const flowPrompt = await import(
		`file://${join(srcOut, "flow/prompt.js")}?t=${Date.now()}`
	);
	const goalValidator = await import(
		`file://${join(srcOut, "goal/validator.js")}?t=${Date.now()}`
	);
	const flowValidator = await import(
		`file://${join(srcOut, "flow/validator.js")}?t=${Date.now()}`
	);
	const generationAlignment = await import(
		`file://${join(srcOut, "shared/generation-alignment.js")}?t=${Date.now()}`
	);
	const flowHtml = await import(
		`file://${join(srcOut, "flow/html.js")}?t=${Date.now()}`
	);
	const flowStatus = await import(
		`file://${join(srcOut, "flow/execution/status.js")}?t=${Date.now()}`
	);
	const uiLanguage = await import(
		`file://${join(srcOut, "shared/ui-language.js")}?t=${Date.now()}`
	);
	const originalEnv = { ...process.env };

	writeConfig({ language: "zh" });
	process.env.PI_FLOW_LANGUAGE = "en";
	language.resetRuntimeLanguageForTests();
	assert(language.runtimeLanguage() === "en", "env language was not preferred");

	process.env.PI_FLOW_LANGUAGE = "bad";
	language.resetRuntimeLanguageForTests();
	assert(
		language.runtimeLanguage() === "zh",
		"invalid env language did not fall back to config",
	);

	writeConfig({ language: "bad" });
	process.env.PI_FLOW_LANGUAGE = "en";
	assert(
		throwMessage(() => config.readConfiguredLanguage()).includes(
			"config.json field language must be auto, zh, or en",
		),
		"invalid config language was not reported in English",
	);

	writeConfig({ language: "auto" });
	assert(
		language.languageFromLocale("zh_CN.UTF-8") === "zh",
		"zh locale failed",
	);
	assert(
		language.languageFromLocale("en_US.UTF-8") === "en",
		"en locale failed",
	);
	assert(
		language.languageFromLocale("C") === undefined,
		"C locale should be ignored",
	);

	process.env.PI_FLOW_LANGUAGE = "en";
	language.resetRuntimeLanguageForTests();
	const englishUiCopy = [
		["运行质量检查", "Run quality checks"],
		["等待 AI 提问。", "Waiting for AI to ask."],
		["已有运行中的 Flow：F1-test", "A Flow is already running: F1-test"],
		["Flow 步骤会话启动失败：boom", "Flow step session start failed: boom"],
		["已有活动目标：Ship feature", "Active Goal already exists: Ship feature"],
	];
	for (const [source, expected] of englishUiCopy) {
		assert(
			uiLanguage.localizeUserText(source) === expected,
			`English UI copy missing for ${source}`,
		);
	}
	const englishTerminalSamples = [
		"目标计划已生成并启动：G1-test",
		"目标计划已生成，但自动启动失败。运行 /goal start G1-test。",
		"会话名同步失败：boom",
		"config.json 字段 generation.align 必须是 ask、yes 或 no；已按 ask 处理。",
		"质量检查失败：boom",
		"质量检查自动循环已停止：AI 中断或失败。",
		"目标完成事实写入失败：boom",
		"目标状态保存失败：boom",
		"目标取消保存失败：boom",
		"目标校验失败：\nlanguage must be zh or en",
		"完成验收启动失败：boom",
		"子进程启动失败：boom",
		"子进程失败，退出码 1。err",
		"目标状态为 paused；只有活动目标可以暂停。",
		"目标状态为 paused；只有已暂停或预算受限的目标可以恢复。",
		"目标令牌预算仍已达到：10",
		"用法：/goal | /goal start [id]\n当前没有目标。",
		"目标提示发送失败：boom",
		"当前步骤状态：running。",
		"Flow 已更新；运行 /flow continue 继续下一步。",
		"Flow 继续结果：weird。",
		".flow 目录不可用：boom",
		"对齐阶段不接受目标计划；请继续对齐后再生成。",
		"AI 未生成有效目标计划。请重试 /goal。",
		"AI 未生成有效 Flow 计划。请重试 /flow。",
	];
	for (const source of englishTerminalSamples) {
		const localized = uiLanguage.localizeUserText(source) ?? "";
		assert(
			!hasChinese(localized),
			`English terminal copy leaked Chinese: ${localized}`,
		);
	}
	const selectState = { title: "", options: [] };
	const ctx = {
		ui: {
			select(title, options) {
				selectState.title = title;
				selectState.options = options;
				return options[1];
			},
		},
	};
	uiLanguage.installLocalizedUi(ctx);
	const selected = await ctx.ui.select("生成计划前先对齐思路？", [
		"先进行多轮问答对齐想法",
		"跳过对齐，直接根据上下文生成计划",
	]);
	const localizedValidationNotice = uiLanguage.localizeUserText(
		"Flow 校验失败：\nschemaVersion 必须为 5\nlanguage 必须是 zh 或 en",
	);
	assert(
		localizedValidationNotice.includes("Flow validation failed") &&
			localizedValidationNotice.includes("schemaVersion must be 5") &&
			localizedValidationNotice.includes("language must be zh or en") &&
			!localizedValidationNotice.includes("必须"),
		"English validation notice leaked Chinese",
	);
	assert(
		selectState.title === "Align before generating the plan?",
		"select title not localized",
	);
	assert(
		selectState.options[1] === "Skip alignment and generate from context",
		"select option not localized",
	);
	assert(
		selected === "跳过对齐，直接根据上下文生成计划",
		"localized select result was not mapped back to the original option",
	);
	assertAlignmentCopy(generationAlignment);
	assert(
		generationAlignment.isStartGenerationConfirmation("Start generation", "en"),
		"English Start generation confirmation was not accepted",
	);
	assert(
		generationAlignment.isStartGenerationConfirmation("Start generation"),
		"Start generation compatibility confirmation was not accepted",
	);
	assert(
		generationAlignment.isStartGenerationConfirmation(
			"start   generation",
			"en",
		),
		"English confirmation whitespace/case normalization failed",
	);
	assert(
		generationAlignment.isStartGenerationConfirmation("开始生成", "zh"),
		"Chinese start generation confirmation was not accepted",
	);
	assert(
		!generationAlignment.isStartGenerationConfirmation(
			"Start generation",
			"zh",
		),
		"English confirmation should not be accepted for explicit zh language",
	);
	assert(
		generationAlignment.isDraftConfirmation("Y", "en"),
		"Y draft confirmation compatibility was broken",
	);
	const prompt = goalPrompt.generationPrompt({
		originalRequest: "Ship feature",
		sourceType: "prompt",
		language: "en",
	});
	assert(
		prompt.includes("goal.semantic.json"),
		"English goal prompt missed semantic artifact",
	);
	assert(
		prompt.includes('"source": {}'),
		"English goal prompt missed semantic source skeleton",
	);
	assert(
		!prompt.includes('"schemaVersion": 5'),
		"English goal prompt still asks the model to write runtime schema",
	);
	assert(
		prompt.includes("Output language must use current language"),
		"English goal prompt missed language rule",
	);
	assert(
		!prompt.includes("输出语言跟用户原始需求一致"),
		"old request-language rule leaked into English prompt",
	);
	const flowGenerationPrompt = flowPrompt.generationPrompt({
		originalRequest: "Ship flow",
		sourceType: "prompt",
		language: "en",
	});
	assert(
		flowGenerationPrompt.includes("flow.semantic.json"),
		"English flow prompt missed semantic artifact",
	);
	assert(
		!flowGenerationPrompt.includes('"schemaVersion": 5'),
		"English flow prompt still asks the model to write runtime schema",
	);
	assert(
		flowGenerationPrompt.includes("Output language must use current language"),
		"English flow prompt missed language rule",
	);
	const badGoalDir = join(out, "G1-bad-goal");
	mkdirSync(badGoalDir, { recursive: true });
	writeFileSync(
		join(badGoalDir, "goal.json"),
		`${JSON.stringify({ ...sampleGoal(), language: undefined })}\n`,
	);
	const badGoal = goalValidator.validateGoalDir(badGoalDir, "en");
	assert(
		badGoal.errors.includes("language must be zh or en") &&
			!badGoal.errors.some((error) => error.includes("必须")),
		"English Goal validator error leaked Chinese",
	);
	const scriptResult = spawnSync(
		process.execPath,
		[join(root, "scripts/validate-draft.mjs"), badGoalDir],
		{
			cwd: root,
			env: { ...process.env, PI_FLOW_LANGUAGE: "en" },
			encoding: "utf8",
		},
	);
	assert(scriptResult.status === 1, "bad draft script should fail");
	assert(
		scriptResult.stderr.includes("language must be zh or en") &&
			!scriptResult.stderr.includes("必须"),
		"English validate-draft output leaked Chinese",
	);
	const badFlowDir = join(out, "F1-bad-flow");
	mkdirSync(badFlowDir, { recursive: true });
	writeFileSync(
		join(badFlowDir, "flow.json"),
		`${JSON.stringify({ ...sampleFlow(), schemaVersion: 3, id: "F1-bad-flow" })}\n`,
	);
	const badFlow = flowValidator.validateFlowDir(badFlowDir);
	assert(
		badFlow.errors.includes("schemaVersion must be 5") &&
			!badFlow.errors.some((error) => error.includes("必须")),
		"English Flow validator error leaked Chinese",
	);
	const badParallelFlowDir = join(out, "F1-bad-parallel");
	mkdirSync(badParallelFlowDir, { recursive: true });
	const badParallelFlow = sampleFlow();
	badParallelFlow.id = "F1-bad-parallel";
	badParallelFlow.parallelBatch = "bad";
	badParallelFlow.goals.push({
		...badParallelFlow.goals[0],
		index: 1,
		title: "Final acceptance",
		role: "final_acceptance",
		file: "goal-2.md",
		dependsOn: [1],
	});
	writeFileSync(
		join(badParallelFlowDir, "flow.json"),
		`${JSON.stringify(badParallelFlow)}\n`,
	);
	const badParallelFlowResult =
		flowValidator.validateFlowDir(badParallelFlowDir);
	assert(
		badParallelFlowResult.errors.includes(
			"parallelBatch must be an array or null",
		) &&
			badParallelFlowResult.errors.includes(
				"goals[1].dependsOn[0] must point to an earlier goals index",
			) &&
			!badParallelFlowResult.errors.some(hasChinese),
		"English parallel Flow validator error leaked Chinese",
	);
	const badFinalRoleDir = join(out, "F1-bad-final-role");
	mkdirSync(badFinalRoleDir, { recursive: true });
	const badFinalRoleFlow = sampleFlow();
	badFinalRoleFlow.id = "F1-bad-final-role";
	badFinalRoleFlow.goals[0].role = "final_acceptance";
	badFinalRoleFlow.goals.push({
		...badFinalRoleFlow.goals[0],
		index: 1,
		title: "Final acceptance",
		file: "goal-2.md",
	});
	writeFileSync(
		join(badFinalRoleDir, "flow.json"),
		`${JSON.stringify(badFinalRoleFlow)}\n`,
	);
	const badFinalRoleResult = flowValidator.validateFlowDir(badFinalRoleDir);
	assert(
		badFinalRoleResult.errors.includes(
			"Exactly 1 final acceptance step is required (role: final_acceptance)",
		) &&
			badFinalRoleResult.errors.includes(
				"goals[0] non-final step must be normal",
			) &&
			!badFinalRoleResult.errors.some(hasChinese),
		"English final role validator error leaked Chinese",
	);
	const flowDir = join(out, "flow-en");
	mkdirSync(flowDir, { recursive: true });
	writeFileSync(
		join(flowDir, "goal-1.md"),
		"# Goal 1\n\n## Steps\n- [ ] **Do work**: implement\n\n## Verification\n- [ ] npm test\n",
	);
	const flow = sampleFlow();
	const html = flowHtml.renderFlowHtml(flowDir, flow);
	assert(html.includes('<html lang="en">'), "English Flow HTML lang missing");
	assert(html.includes("Multi-step plan"), "English Flow HTML chrome missing");
	assert(html.includes("Completion acceptance"), "English check label missing");
	assert(!html.includes("多步骤计划"), "Chinese Flow HTML chrome leaked");
	const status = flowStatus.statusText(flow);
	assert(
		status.includes("Title: Ship feature"),
		"English Flow status title missing",
	);
	assert(
		status.includes("Step 1 · Build"),
		"English Flow status step label missing",
	);

	process.env = originalEnv;
	console.log("language smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function writeConfig(value) {
	writeFileSync(join(out, "config.json"), `${JSON.stringify(value)}\n`);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function hasChinese(text) {
	return /[\u4e00-\u9fff]/u.test(text);
}

function assertAlignmentCopy(generationAlignment) {
	const waiting = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_alignment_input",
		"en",
	);
	assert(
		waiting.phase === "Waiting for reply",
		"English alignment phase missing",
	);
	assert(
		waiting.rows[0] === "Continue alignment by answering the question" &&
			waiting.rows[1] ===
				"Reply “Start generation” to generate the plan directly",
		"English alignment rows missing",
	);
	const final = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_final_confirm",
		"zh",
	);
	assert(
		final.rows[0] === "回复「开始生成」生成计划" &&
			final.rows[1] === "继续输入则补充对齐",
		"Chinese alignment rows missing",
	);
	assert(
		generationAlignment.generationAlignmentSummary(
			"awaiting_alignment_input",
			"en",
		) ===
			"Continue alignment by answering the question, or reply “Start generation” to generate the plan directly.",
		"English alignment summary missing",
	);
}

function sampleGoal() {
	return {
		schemaVersion: 5,
		language: "en",
		id: "G1-bad-goal",
		title: "Bad goal",
		status: "draft",
		completionCursor: null,
		source: { type: "prompt", path: null, originalRequest: "Bad goal" },
		createdAt: 0,
		updatedAt: 0,
		repairAttempts: 0,
		errors: [],
		sessionFile: null,
		sessionName: null,
		snapshot: null,
		snapshotHash: null,
		runtimeGoalId: null,
		result: { summary: null, outcome: null },
		checks: {
			acceptance: { enabled: true, rounds: [], active: null },
			quality: { enabled: true, rounds: [], active: null },
		},
	};
}

function sampleFlow() {
	return {
		schemaVersion: 5,
		language: "en",
		id: "F1-ship",
		title: "Ship feature",
		status: "draft",
		source: { type: "prompt", path: null, originalRequest: "Ship feature" },
		createdAt: 0,
		updatedAt: 0,
		startedAt: null,
		currentGoal: 0,
		repairAttempts: 0,
		errors: [],
		goals: [
			{
				index: 0,
				title: "Build",
				role: "normal",
				file: "goal-1.md",
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
				checks: {
					acceptance: { enabled: true, rounds: [], active: null },
					quality: { enabled: true, rounds: [], active: null },
				},
			},
		],
	};
}

function throwMessage(fn) {
	try {
		fn();
	} catch (error) {
		return String(error?.message ?? error);
	}
	throw new Error("function did not throw");
}
