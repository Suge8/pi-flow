import { execFileSync } from "node:child_process";
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
	const flowPrompt = await import(
		`file://${join(srcOut, "flow/prompt.js")}?t=${Date.now()}`
	);
	const flowValidator = await import(
		`file://${join(srcOut, "flow/validator.js")}?t=${Date.now()}`
	);
	const generationAlignment = await import(
		`file://${join(srcOut, "shared/generation-alignment.js")}?t=${Date.now()}`
	);
	const generationState = await import(
		`file://${join(srcOut, "shared/generation-state.js")}?t=${Date.now()}`
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
		["已有运行中的 Flow：F1", "A Flow is already running: F1"],
		["Flow 步骤会话启动失败：boom", "Flow step session start failed: boom"],
	];
	for (const [source, expected] of englishUiCopy) {
		assert(
			uiLanguage.localizeUserText(source) === expected,
			`English UI copy missing for ${source}`,
		);
	}
	const englishTerminalSamples = [
		"会话名同步失败：boom",
		"config.json 字段 generation.align 必须是 ask、yes 或 no；已按 ask 处理。",
		"质量检查失败：boom",
		"质量检查自动循环已停止：AI 中断或失败。",
		"目标完成事实写入失败：boom",
		"目标状态保存失败：boom",
		"目标取消保存失败：boom",
		"完成验收启动失败：boom",
		"子进程启动失败：boom",
		"子进程失败，退出码 1。err",
		"当前步骤状态：running。",
		"Flow 已更新；运行 /flow continue F1 继续下一步。",
		"Flow 继续结果：weird。",
		".flow 目录不可用：boom",
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
		"Flow 校验失败：\nschemaVersion 必须为 8\nlanguage 必须是 zh 或 en",
	);
	assert(
		localizedValidationNotice.includes("Flow validation failed") &&
			localizedValidationNotice.includes("schemaVersion must be 8") &&
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
	assertAlignmentCopy(generationAlignment, generationState);
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
	const flowGenerationPrompt = flowPrompt.generationPrompt({
		originalRequest: "Ship flow",
		sourceType: "prompt",
		language: "en",
		flowPath: "/tmp/F1",
	});
	const restoredFlowGenerationPrompt = flowPrompt.generationPrompt({
		originalRequest: "Ship flow",
		sourceType: "prompt",
		language: "en",
		flowPath: "/tmp/F1",
		restoredAlignmentContext: [{ question: "Q?", answer: "A." }],
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
	assert(
		flowGenerationPrompt.includes("2–10 user-understandable milestones") &&
			flowGenerationPrompt.includes("provide completion evidence") &&
			!flowGenerationPrompt.includes("3–12 small items"),
		"English flow prompt missing milestone step rules",
	);
	assert(
		!flowGenerationPrompt.includes("Restored alignment Q&A") &&
			restoredFlowGenerationPrompt.includes("Restored alignment Q&A") &&
			restoredFlowGenerationPrompt.includes("Q1: Q?") &&
			restoredFlowGenerationPrompt.includes("A1: A."),
		"restored Flow prompt Q&A context should be opt-in",
	);
	const flowRepairPrompt = flowPrompt.repairPrompt({
		errors: ["bad draft"],
		originalRequest: "Ship flow",
		flowPath: "/tmp/F1",
		language: "en",
	});
	assert(
		flowRepairPrompt.includes("2–10 user-understandable milestones") &&
			flowRepairPrompt.includes("provide completion evidence") &&
			!flowRepairPrompt.includes("3–12 small items"),
		"English repair prompt missing milestone step rules",
	);
	const badFlowDir = join(out, "F10");
	mkdirSync(badFlowDir, { recursive: true });
	writeFileSync(
		join(badFlowDir, "flow.json"),
		`${JSON.stringify({ ...sampleFlow(), schemaVersion: 3, id: "F10" })}\n`,
	);
	const badFlow = flowValidator.validateFlowDir(badFlowDir);
	assert(
		badFlow.errors.includes("schemaVersion must be 8") &&
			!badFlow.errors.some((error) => error.includes("必须")),
		"English Flow validator error leaked Chinese",
	);
	const badParallelFlowDir = join(out, "F11");
	mkdirSync(badParallelFlowDir, { recursive: true });
	const badParallelFlow = sampleFlow();
	badParallelFlow.id = "F11";
	badParallelFlow.parallelRun = "bad";
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
			"parallelRun must be an object or null",
		) &&
			badParallelFlowResult.errors.includes(
				"goals[1].dependsOn[0] must point to an earlier goals index",
			) &&
			!badParallelFlowResult.errors.some(hasChinese),
		"English parallel Flow validator error leaked Chinese",
	);
	const badFinalRoleDir = join(out, "F12");
	mkdirSync(badFinalRoleDir, { recursive: true });
	const badFinalRoleFlow = sampleFlow();
	badFinalRoleFlow.id = "F12";
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
			"Multi-step Flow must have exactly 1 final acceptance step (role: final_acceptance)",
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
	assert(
		html.includes("1 steps, waiting to start"),
		"English Flow HTML chrome missing",
	);
	assert(
		html.includes("/flow start F1"),
		"English Flow HTML command did not use bare id",
	);
	assert(
		!html.includes("Multi-step plan"),
		"English Flow HTML should be neutral",
	);
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
	assert(
		status.includes("Next: /flow start F1"),
		"English Flow status next command did not use bare id",
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

function assertAlignmentCopy(generationAlignment, generationState) {
	const zhPrompt = generationAlignment.buildAlignmentPrompt({
		kind: "flow",
		language: "zh",
		originalRequest: "修登录",
		source: "prompt",
	});
	assert(
		zhPrompt.includes("先全面审视当前会话、已有需求、代码库线索和文档") &&
			zhPrompt.includes("直到达成全面共同理解") &&
			zhPrompt.includes("一次只问一个问题") &&
			zhPrompt.includes("2-4 个具体选项") &&
			zhPrompt.includes("基于项目具体情况，需求以及最佳实践") &&
			zhPrompt.includes("先探索事实源后再提出基于事实的问题") &&
			zhPrompt.includes(
				"所有会影响实现范围、实现细节、需求、提示词语义、状态事实源、测试验证",
			) &&
			!zhPrompt.includes("<aligned-request>") &&
			!zhPrompt.includes("最高杠杆") &&
			!zhPrompt.includes("阻塞哪个未确认决策") &&
			!zhPrompt.includes("每轮先列出未确认决策树"),
		"Chinese alignment prompt missing concise decision contract",
	);
	const enPrompt = generationAlignment.buildAlignmentPrompt({
		kind: "flow",
		language: "en",
		originalRequest: "Ship login",
		source: "prompt",
	});
	assert(
		enPrompt.includes(
			"First comprehensively review the current conversation",
		) &&
			enPrompt.includes("comprehensive shared understanding") &&
			enPrompt.includes("Ask exactly one question at a time") &&
			enPrompt.includes("2-4 concrete options") &&
			enPrompt.includes("the project's specific situation") &&
			enPrompt.includes(
				"inspect the source of truth first and then ask a fact-based question",
			) &&
			enPrompt.includes(
				"all decisions that affect implementation scope, implementation details, requirements, prompt semantics, state source of truth, and test verification",
			) &&
			!enPrompt.includes("<aligned-request>") &&
			!enPrompt.includes("highest-leverage") &&
			!enPrompt.includes("which unconfirmed decision it blocks") &&
			!enPrompt.includes("list the unconfirmed decision tree") &&
			!hasChinese(enPrompt),
		"English alignment prompt missing concise decision contract",
	);
	const zhFollowUp = generationAlignment.buildAlignmentFollowUpPrompt({
		language: "zh",
	});
	assert(
		zhFollowUp.includes("继续 Flow 生成前对齐") &&
			zhFollowUp.includes("先探索事实源") &&
			zhFollowUp.includes("一次只问一个简洁问题") &&
			!zhFollowUp.includes("# 拷问我") &&
			!zhFollowUp.includes("原始需求") &&
			!zhFollowUp.includes("已对齐问答") &&
			!zhFollowUp.includes("用户刚才回答") &&
			!zhFollowUp.includes("<aligned-request>"),
		"Chinese follow-up alignment prompt should stay lightweight",
	);
	const enFollowUp = generationAlignment.buildAlignmentFollowUpPrompt({
		language: "en",
	});
	assert(
		enFollowUp.includes("Continue Flow alignment") &&
			enFollowUp.includes(
				"inspect the codebase, docs, or existing .flow files",
			) &&
			enFollowUp.includes("Ask exactly one concise question") &&
			!enFollowUp.includes("# Question me") &&
			!enFollowUp.includes("Original request") &&
			!enFollowUp.includes("Aligned Q&A") &&
			!enFollowUp.includes("Latest user answer") &&
			!enFollowUp.includes("<aligned-request>"),
		"English follow-up alignment prompt should stay lightweight",
	);
	const pendingAlignment = {
		language: "zh",
	};
	generationState.rememberAlignmentQuestion(
		pendingAlignment,
		"问题 1：是否限定 UI？\n<!-- pi-flow:ready-to-draft -->",
	);
	generationState.appendAlignmentAnswer(pendingAlignment, "继续限定 UI");
	assert(
		pendingAlignment.alignmentTurns?.at(-1)?.question ===
			"问题 1：是否限定 UI？" &&
			pendingAlignment.alignmentTurns?.at(-1)?.answer === "继续限定 UI",
		"ready marker alignment reply should preserve the real question in memory",
	);
	const longQuestion = `问题：${"很长".repeat(500)}`;
	const pendingLongQuestion = { language: "zh" };
	generationState.rememberAlignmentQuestion(
		pendingLongQuestion,
		`${longQuestion}\n<!-- pi-flow:ready-to-draft -->`,
	);
	generationState.appendAlignmentAnswer(pendingLongQuestion, "答案");
	assert(
		pendingLongQuestion.alignmentTurns?.at(-1)?.question === longQuestion,
		"alignment Q&A memory should keep long questions untrimmed",
	);
	const pendingManyTurns = { language: "zh" };
	for (let index = 0; index < 10; index += 1) {
		generationState.rememberAlignmentQuestion(
			pendingManyTurns,
			`问题 ${index + 1}：选项？`,
		);
		generationState.appendAlignmentAnswer(
			pendingManyTurns,
			`答案 ${index + 1}`,
		);
	}
	assert(
		pendingManyTurns.alignmentTurns?.length === 10,
		"alignment Q&A memory should not trim to the old 8-turn limit",
	);
	const zhAskQ1 = generationAlignment.generationAlignmentActivityCopy(
		"aligning",
		"zh",
		1,
	);
	const zhAskQ2 = generationAlignment.generationAlignmentActivityCopy(
		"aligning",
		"zh",
		2,
	);
	assert(
		zhAskQ1.phase === "对齐中" &&
			zhAskQ1.rows === "等待 AI 提出 Q1" &&
			zhAskQ2.rows === "等待 AI 提出 Q2",
		"Chinese Q1/Q2 ask copy missing",
	);
	const zhWaitingQ2 = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_alignment_input",
		"zh",
		2,
	);
	assert(
		zhWaitingQ2.phase === "等待回复 Q2" &&
			zhWaitingQ2.rows[0] === "回答 Q2 继续对齐" &&
			zhWaitingQ2.rows[1] === "回复「开始生成」直接生成计划",
		"Chinese waiting-reply copy missing",
	);
	const zhFinal = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_final_confirm",
		"zh",
	);
	assert(
		zhFinal.phase === "等待确认" &&
			zhFinal.rows[0] === "对齐已就绪" &&
			zhFinal.rows[1] === "回复「开始生成」生成计划" &&
			zhFinal.rows[2] === "继续输入则补充对齐",
		"Chinese ready-confirmation rows missing",
	);
	const zhDraft = generationAlignment.generationAlignmentActivityCopy(
		"generating",
		"zh",
		3,
	);
	assert(
		zhDraft.phase === "撰写计划中" && zhDraft.rows.length === 0,
		"Chinese drafting copy should not depend on Q&A turns",
	);
	const enAskQ1 = generationAlignment.generationAlignmentActivityCopy(
		"aligning",
		"en",
		1,
	);
	const enAskQ2 = generationAlignment.generationAlignmentActivityCopy(
		"aligning",
		"en",
		2,
	);
	assert(
		enAskQ1.phase === "Aligning" &&
			enAskQ1.rows === "Waiting for AI to ask Q1" &&
			enAskQ2.rows === "Waiting for AI to ask Q2",
		"English Q1/Q2 ask copy missing",
	);
	const enWaitingQ1 = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_alignment_input",
		"en",
		1,
	);
	assert(
		enWaitingQ1.phase === "Waiting for Q1 reply" &&
			enWaitingQ1.rows[0] === "Answer Q1 to continue alignment" &&
			enWaitingQ1.rows[1] ===
				"Reply “Start generation” to generate the plan directly",
		"English waiting-reply rows missing",
	);
	const enFinal = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_final_confirm",
		"en",
	);
	assert(
		enFinal.phase === "Ready to draft" &&
			enFinal.rows[0] === "Alignment is ready" &&
			enFinal.rows[1] === "Reply “Start generation” to generate the plan" &&
			enFinal.rows[2] === "Any other input continues alignment",
		"English ready-confirmation rows missing",
	);
	const enDraft = generationAlignment.generationAlignmentActivityCopy(
		"generating",
		"en",
		3,
	);
	assert(
		enDraft.phase === "Drafting plan" && enDraft.rows.length === 0,
		"English drafting copy should not depend on Q&A turns",
	);
	assert(
		generationAlignment.generationAlignmentSummary(
			"awaiting_alignment_input",
			"en",
		) ===
			"Answer Q1 to continue alignment, or reply “Start generation” to generate the plan directly." &&
			generationAlignment.generationAlignmentSummary("generating", "zh", 8) ===
				"正在撰写计划。",
		"alignment summary copy missing",
	);
	const draftBox = generationState.generationDraftBox(
		"🌊 Flow · Drafting plan",
	);
	assert(
		draftBox.rows.length === 0,
		"drafting activity box should not render empty Q&A rows",
	);
}

function sampleFlow() {
	return {
		schemaVersion: 8,
		language: "en",
		id: "F1",
		title: "Ship feature",
		status: "draft",
		source: { type: "prompt", path: null, originalRequest: "Ship feature" },
		createdAt: 0,
		updatedAt: 0,
		startedAt: null,
		currentGoal: 0,
		parallelRun: null,
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
