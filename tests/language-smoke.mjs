import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-language-test-${runId}`);
const srcOut = join(out, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
cpSync(join(root, "prompts"), join(out, "prompts"), { recursive: true });
prepareTestDist(root, srcOut);

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

	writeConfig({});
	assert(
		JSON.stringify(config.readFlowConfig().report) ===
			JSON.stringify({
				bind: "127.0.0.1",
				port: 49327,
				publicBaseUrl: null,
			}),
		"default report config is incorrect",
	);
	for (const bind of [
		"localhost",
		"127.0.0.1",
		"0.0.0.0",
		"::",
		"100.64.0.1",
	]) {
		writeConfig({
			report: {
				bind,
				port: 49327,
				publicBaseUrl: "https://host.tailnet.ts.net",
			},
		});
		const report = config.readFlowConfig().report;
		assert(
			report.bind === bind &&
				report.port === 49327 &&
				report.publicBaseUrl === "https://host.tailnet.ts.net",
			`valid report config failed: ${bind}`,
		);
	}
	process.env.PI_FLOW_LANGUAGE = "en";
	for (const [report, expected] of [
		[{ bind: "host.local" }, "report.bind must match localhost/IP"],
		[{ port: 0 }, "report.port must be an integer"],
		[{ port: 65536 }, "report.port must be an integer"],
		[
			{ publicBaseUrl: "ftp://host" },
			"report.publicBaseUrl must match http(s) origin",
		],
		[
			{ publicBaseUrl: "https://user:pass@host" },
			"report.publicBaseUrl must match http(s) origin",
		],
		[
			{ publicBaseUrl: "https://host/path" },
			"report.publicBaseUrl must match http(s) origin",
		],
		[
			{ publicBaseUrl: "https://host?query=1" },
			"report.publicBaseUrl must match http(s) origin",
		],
		[
			{ publicBaseUrl: "https://host#hash" },
			"report.publicBaseUrl must match http(s) origin",
		],
		[{ extra: true }, "report.extra is not supported"],
	]) {
		writeConfig({ report });
		const message = throwMessage(() => config.readFlowConfig());
		assert(message.includes(expected) && !hasChinese(message), message);
	}

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
		[
			"运行质检或执行后自动质检",
			"Run quality checks now or automatically after execution",
		],
		["咨询顾问模型", "Consult the advisor model"],
		[
			"先确认范围和拆分方式，再生成计划",
			"Confirm scope and split before generating the plan",
		],
		["编号：F1", "ID: F1"],
		[
			"Flow F1 计划生成中\n\n完成后自动启动",
			"Flow F1 plan generating\n\nStarts automatically when done",
		],
		[
			"⏳ 已有运行中的 Flow\n\n编号：F1",
			"⏳ A Flow is already running\n\nID: F1",
		],
		[
			"❌ Flow 步骤会话启动失败\n\nboom",
			"❌ Flow step session start failed\n\nboom",
		],
	];
	for (const [source, expected] of englishUiCopy) {
		assert(
			uiLanguage.localizeUserText(source) === expected,
			`English UI copy missing for ${source}`,
		);
	}
	assert(
		uiLanguage.laneThinkingText("zh") === "思考中" &&
			uiLanguage.laneThinkingText("en") === "Thinking" &&
			uiLanguage.laneSilentWarningText(3, "zh") === "⚠ 3 分钟无活动" &&
			uiLanguage.laneSilentWarningText(3, "en") === "⚠ No activity for 3 min",
		"lane progress copy is incomplete",
	);
	const englishTerminalSamples = [
		"⚠️ 会话名同步失败\n\nboom",
		"⚠️ 生成配置已回退\n\nconfig.json 字段 generation.align 必须是 ask、no、coarse、standard 或 deep\n已按 ask 处理",
		"❌ 质检失败\n\nboom",
		"⚠️ 质检自动循环已停止\n\nAI 中断或失败",
		"❌ Flow 计划提示发送失败\n\nboom",
		"❌ Flow 计划修复提示发送失败\n\nboom",
		"❌ Flow 计划澄清提示发送失败\n\nboom",
		"🛠️ Flow 计划修复中\n\n完成后会自动校验",
		"❌ 目标完成事实写入失败\n\nboom",
		"❌ 目标状态保存失败\n\nboom",
		"❌ 目标取消保存失败\n\nboom",
		"❌ 验收启动失败\n\nboom",
		"子进程启动失败：boom",
		"子进程失败，退出码 1。err",
		"ℹ️ 当前步骤状态\n\n状态：执行中",
		"⚠️ Flow 推进结果未知\n\n结果：weird",
		"❌ .flow 目录不可用\n\nboom",
		"❌ AI 未生成有效 Flow 计划\n\n请重试 /flow",
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
		"粗对齐：约 10 问内，高杠杆问题优先",
		"跳过对齐，直接根据上下文生成计划",
	]);
	const localizedValidationNotice = uiLanguage.localizeUserText(
		"❌ Flow 校验失败\n\nschemaVersion 必须为 17\nlanguage 必须是 zh 或 en",
	);
	assert(
		localizedValidationNotice.includes("Flow validation failed") &&
			localizedValidationNotice.includes("schemaVersion must be 17") &&
			localizedValidationNotice.includes("language must be zh or en") &&
			!localizedValidationNotice.includes("必须"),
		"English validation notice leaked Chinese",
	);
	const localizedStatusNotice = uiLanguage.localizeUserText(
		"❌ Flow 校验失败\n\nFlow 状态不受支持",
	);
	assert(
		localizedStatusNotice.includes("Flow status is not supported") &&
			!hasChinese(localizedStatusNotice),
		"English unsupported Flow status notice leaked Chinese",
	);
	assert(
		selectState.title === "Align before generating the plan?",
		"select title not localized",
	);
	assert(
		selectState.options[0] ===
			"Coarse alignment: ~10 questions, prioritize high-leverage decisions" &&
			selectState.options[1] === "Skip alignment and generate from context",
		"select option not localized",
	);
	assert(
		selected === "跳过对齐，直接根据上下文生成计划",
		"localized select result was not mapped back to the original option",
	);
	assertAlignmentCopy(generationAlignment, generationState);
	const flowGenerationPrompt = flowPrompt.generationPrompt({
		requestText: "Ship flow",
		sourceType: "prompt",
		language: "en",
		flowPath: "/tmp/F1",
	});
	const restoredFlowGenerationPrompt = flowPrompt.generationPrompt({
		requestText: "Ship flow",
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
	assertFlowControlCopy(flowGenerationPrompt, "English flow prompt");
	assert(
		!flowGenerationPrompt.includes("Restored alignment Q&A") &&
			restoredFlowGenerationPrompt.includes("Restored alignment Q&A") &&
			restoredFlowGenerationPrompt.includes("Q1: Q?") &&
			restoredFlowGenerationPrompt.includes("A1: A."),
		"restored Flow prompt Q&A context should be opt-in",
	);
	const flowRepairPrompt = flowPrompt.repairPrompt({
		errors: ["bad draft"],
		requestText: "Ship flow",
		flowPath: "/tmp/F1",
		language: "en",
	});
	assert(
		flowRepairPrompt.includes("2–10 user-understandable milestones") &&
			flowRepairPrompt.includes("provide completion evidence") &&
			!flowRepairPrompt.includes("3–12 small items"),
		"English repair prompt missing milestone step rules",
	);
	assertFlowControlCopy(flowRepairPrompt, "English repair prompt");
	for (const [label, prompt] of [
		["English flow prompt", flowGenerationPrompt],
		["English repair prompt", flowRepairPrompt],
	]) {
		assert(
			prompt.includes("## Draft format contract"),
			`${label} missing appended draft contract`,
		);
		assert(
			!/\{\{(?:flowPath|language|validateCommand)\}\}/u.test(prompt),
			`${label} left contract placeholders unreplaced`,
		);
	}
	const badFlowDir = join(out, "F10");
	mkdirSync(badFlowDir, { recursive: true });
	writeFileSync(
		join(badFlowDir, "flow.json"),
		`${JSON.stringify({ ...sampleFlow(), schemaVersion: 3, id: "F10" })}\n`,
	);
	const badFlow = flowValidator.validateFlowDir(badFlowDir);
	assert(
		badFlow.errors.some((error) =>
			error.includes("schemaVersion must be 17"),
		) && !badFlow.errors.some((error) => error.includes("必须")),
		"English Flow validator error leaked Chinese",
	);
	const badAlignmentDir = join(out, "F12");
	mkdirSync(badAlignmentDir, { recursive: true });
	writeFileSync(
		join(badAlignmentDir, "flow.json"),
		`${JSON.stringify({
			...sampleFlow(),
			id: "F12",
			meta: {
				plannedBy: null,
				alignment: { kind: "invalid", turns: [] },
			},
		})}\n`,
	);
	const badAlignment = flowValidator.validateFlowDir(badAlignmentDir);
	assert(
		badAlignment.errors.some((error) =>
			error.includes("meta.alignment.kind must be recorded"),
		) && !badAlignment.errors.some(hasChinese),
		"English alignment validation error leaked Chinese",
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
	const badWriteScopeDir = join(out, "F13");
	mkdirSync(badWriteScopeDir, { recursive: true });
	const badWriteScopeFlow = sampleFlow();
	badWriteScopeFlow.id = "F13";
	badWriteScopeFlow.goals[0].writeScope = ["src/foo*"];
	writeFileSync(
		join(badWriteScopeDir, "flow.json"),
		`${JSON.stringify(badWriteScopeFlow)}\n`,
	);
	const badWriteScopeResult = flowValidator.validateFlowDir(badWriteScopeDir);
	assert(
		badWriteScopeResult.errors.includes(
			"goals[0].writeScope[0] must be ** or a relative directory glob ending in /**",
		) && !badWriteScopeResult.errors.some(hasChinese),
		"English writeScope validator error leaked Chinese",
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
			"At most 1 final acceptance step (role: final_acceptance)",
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
		html.includes(">Flow</span>") && html.includes("/flow go F1"),
		"English Flow HTML chrome missing",
	);
	assert(
		html.includes("/flow go F1") && !html.includes("/flow status F1"),
		"English Flow HTML should only show go with bare id",
	);
	assert(
		html.includes('data-copy-success="Copied"') &&
			html.includes('data-copy-failure="Copy failed"'),
		"English command copy feedback missing",
	);
	assert(
		!html.includes("Step 1 · Build"),
		"English Flow goal card should not repeat the step label as an eyebrow",
	);
	assert(
		!html.includes("Multi-step plan"),
		"English Flow HTML should be neutral",
	);
	assert(html.includes("Acceptance"), "English check label missing");
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
		status.includes("Next: 「/flow go F1」"),
		"English Flow status next command did not use bare id",
	);
	const preDraftStatus = flowStatus.statusText(
		{ ...flow, status: "aligning", goals: [] },
		{
			version: 1,
			stage: "awaiting_alignment_input",
			sessionFile: null,
			autoStart: true,
			depth: "standard",
			alignmentTurns: [],
			lastAlignmentQuestion: "Question 1: Scope?",
			createdAt: 0,
			updatedAt: 0,
		},
	);
	assert(
		preDraftStatus.includes("Status: Waiting for reply") &&
			preDraftStatus.includes("Next: 「/flow go F1」") &&
			!preDraftStatus.includes("reply with answer"),
		"English pre-draft Flow status did not use stage copy and go next hint",
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
		requestText: "修登录",
		source: "prompt",
	});
	assert(
		zhPrompt.includes("先全面审视当前会话、已有需求、代码库线索和文档") &&
			zhPrompt.includes("直到达成全面共同理解") &&
			zhPrompt.includes("一次只问一个问题") &&
			zhPrompt.includes("2-4 个具体选项") &&
			zhPrompt.includes("基于项目具体情况，需求以及最佳实践") &&
			zhPrompt.includes(
				"提出问题前，先探索相关代码库、文档、测试、调用链或现有 .flow 文件",
			) &&
			zhPrompt.includes("能从事实源确认的内容不要询问用户") &&
			zhPrompt.includes("高杠杆问题优先") &&
			zhPrompt.includes("计划结构、实现范围、验收标准、技术选型或不可逆决策") &&
			zhPrompt.includes("假设默认制") &&
			zhPrompt.includes("已有项目遵循现有技术栈") &&
			zhPrompt.includes("问题预算：约 20-30 问") &&
			zhPrompt.includes("用户回复「按推荐」时") &&
			zhPrompt.includes("输出假设清单") &&
			zhPrompt.includes("验收面过大") &&
			!zhPrompt.includes("{{questionBudget}}") &&
			!zhPrompt.includes("<aligned-request>") &&
			!zhPrompt.includes("阻塞哪个未确认决策") &&
			!zhPrompt.includes("每轮先列出未确认决策树"),
		"Chinese alignment prompt missing high-leverage grilling contract",
	);
	const zhCoarsePrompt = generationAlignment.buildAlignmentPrompt({
		kind: "flow",
		language: "zh",
		requestText: "修登录",
		source: "prompt",
		depth: "coarse",
	});
	const zhDeepPrompt = generationAlignment.buildAlignmentPrompt({
		kind: "flow",
		language: "zh",
		requestText: "修登录",
		source: "prompt",
		depth: "deep",
	});
	assert(
		zhCoarsePrompt.includes("问题预算：约 10 问以内") &&
			zhDeepPrompt.includes("问题预算：不设硬上限") &&
			!zhCoarsePrompt.includes("约 20-30 问") &&
			!zhDeepPrompt.includes("约 20-30 问"),
		"Chinese depth budgets were not injected into the alignment prompt",
	);
	const enPrompt = generationAlignment.buildAlignmentPrompt({
		kind: "flow",
		language: "en",
		requestText: "Ship login",
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
				"Before asking a question, inspect the relevant codebase, documentation, tests, call chains, or existing .flow files",
			) &&
			enPrompt.includes(
				"Do not ask the user about anything the sources of truth can confirm",
			) &&
			enPrompt.includes("High-leverage questions first") &&
			enPrompt.includes(
				"plan structure, implementation scope, acceptance criteria, tech choices, or an irreversible decision",
			) &&
			enPrompt.includes("Assume defaults") &&
			enPrompt.includes("follow the current stack") &&
			enPrompt.includes("continue asking beyond the budget") &&
			enPrompt.includes("Question budget: about 20-30 questions") &&
			enPrompt.includes('replies "use recommendations"') &&
			enPrompt.includes("assumption list") &&
			enPrompt.includes("oversized acceptance surface") &&
			!enPrompt.includes("{{questionBudget}}") &&
			!enPrompt.includes("<aligned-request>") &&
			!enPrompt.includes("which unconfirmed decision it blocks") &&
			!enPrompt.includes("list the unconfirmed decision tree") &&
			!hasChinese(enPrompt),
		"English alignment prompt missing high-leverage grilling contract",
	);
	const enCoarsePrompt = generationAlignment.buildAlignmentPrompt({
		kind: "flow",
		language: "en",
		requestText: "Ship login",
		source: "prompt",
		depth: "coarse",
	});
	const enDeepPrompt = generationAlignment.buildAlignmentPrompt({
		kind: "flow",
		language: "en",
		requestText: "Ship login",
		source: "prompt",
		depth: "deep",
	});
	assert(
		enCoarsePrompt.includes("Question budget: about 10 questions at most") &&
			enDeepPrompt.includes("Question budget: no hard cap") &&
			!enCoarsePrompt.includes("about 20-30 questions") &&
			!enDeepPrompt.includes("about 20-30 questions"),
		"English depth budgets were not injected into the alignment prompt",
	);
	const zhFollowUp = generationAlignment.buildAlignmentFollowUpPrompt({
		language: "zh",
	});
	assert(
		zhFollowUp.includes("继续 Flow 生成前对齐") &&
			zhFollowUp.includes("问题预算：约 20-30 问") &&
			zhFollowUp.includes("遵循首次拷问协议") &&
			zhFollowUp.includes("先查事实") &&
			zhFollowUp.includes("高杠杆问题优先") &&
			zhFollowUp.includes("可合理默认的次要决策不要问") &&
			zhFollowUp.includes("满足收敛条件后") &&
			!zhFollowUp.includes("# 拷问我") &&
			!zhFollowUp.includes("原始需求") &&
			!zhFollowUp.includes("已对齐问答") &&
			!zhFollowUp.includes("用户刚才回答") &&
			!zhFollowUp.includes("<aligned-request>"),
		"Chinese follow-up alignment prompt should stay lightweight",
	);
	const zhDeepFollowUp = generationAlignment.buildAlignmentFollowUpPrompt({
		language: "zh",
		depth: "deep",
	});
	assert(
		zhDeepFollowUp.includes("问题预算：不设硬上限") &&
			!zhDeepFollowUp.includes("约 20-30 问"),
		"Chinese follow-up prompt did not carry the deep budget",
	);
	const enFollowUp = generationAlignment.buildAlignmentFollowUpPrompt({
		language: "en",
	});
	assert(
		enFollowUp.includes("Continue Flow alignment") &&
			enFollowUp.includes("Question budget: about 20-30 questions") &&
			enFollowUp.includes("Follow the initial questioning protocol") &&
			enFollowUp.includes("inspect facts first") &&
			enFollowUp.includes("prioritize high-leverage questions") &&
			enFollowUp.includes("After convergence") &&
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
		zhAskQ1.phase === "Q1" &&
			zhAskQ1.rows === "准备问题中" &&
			zhAskQ2.phase === "Q2" &&
			zhAskQ2.rows === "准备问题中",
		"Chinese Q1/Q2 preparation copy missing or still has a spinner",
	);
	const zhWaitingQ2 = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_alignment_input",
		"zh",
		2,
	);
	assert(
		zhWaitingQ2.phase === "Q2 / ~30" &&
			zhWaitingQ2.rows ===
				"回复对齐需求 ｜「按推荐」委托剩余决策 ｜「/flow go」直接生成计划",
		"Chinese waiting-reply copy missing",
	);
	const zhWaitingCoarse = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_alignment_input",
		"zh",
		3,
		"/flow go F1",
		"coarse",
	);
	const zhWaitingDeep = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_alignment_input",
		"zh",
		3,
		"/flow go F1",
		"deep",
	);
	assert(
		zhWaitingCoarse.phase === "Q3 / ~10" && zhWaitingDeep.phase === "Q3",
		"Chinese waiting-reply progress should follow the depth budget",
	);
	const zhFinal = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_final_confirm",
		"zh",
		1,
		"/flow go F1",
	);
	assert(
		zhFinal.phase === "已对齐" &&
			zhFinal.rows === "「/flow go」生成计划 ｜继续回复则补充信息",
		"Chinese ready-confirmation rows missing",
	);
	const zhDraft = generationAlignment.generationAlignmentActivityCopy(
		"generating",
		"zh",
		3,
	);
	const zhDraftZero = generationAlignment.generationAlignmentActivityCopy(
		"generating",
		"zh",
		1,
	);
	assert(
		zhDraft.phase === "生成中" &&
			zhDraft.rows === "基于 2 轮问答生成全面计划" &&
			zhDraftZero.rows === "洞察全部上下文，生成全面计划",
		"Chinese drafting copy should show context without a spinner",
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
			enAskQ1.rows === "Preparing Q1" &&
			enAskQ2.rows === "Preparing Q2",
		"English Q1/Q2 preparation copy missing or still has a spinner",
	);
	const enWaitingQ1 = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_alignment_input",
		"en",
		1,
	);
	assert(
		enWaitingQ1.phase === "Waiting for reply" &&
			enWaitingQ1.rows ===
				'Answer Q1 of ~30 · "use recommendations" delegates the rest',
		"English waiting-reply rows missing",
	);
	const enWaitingDeep = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_alignment_input",
		"en",
		4,
		"/flow go F1",
		"deep",
	);
	assert(
		enWaitingDeep.rows ===
			'Answer Q4 · "use recommendations" delegates the rest',
		"English deep waiting-reply should hide the budget denominator",
	);
	const enFinal = generationAlignment.generationAlignmentActivityCopy(
		"awaiting_final_confirm",
		"en",
		1,
		"/flow go F1",
	);
	assert(
		enFinal.phase === "Ready to draft" &&
			enFinal.rows[0] === "Alignment is ready" &&
			enFinal.rows[1] === "Run 「/flow go F1」 to generate the plan" &&
			enFinal.rows[2] === "Any other input continues alignment",
		"English ready-confirmation rows missing",
	);
	const enDraft = generationAlignment.generationAlignmentActivityCopy(
		"generating",
		"en",
		3,
	);
	const enDraftZero = generationAlignment.generationAlignmentActivityCopy(
		"generating",
		"en",
		1,
	);
	assert(
		enDraft.phase === "Drafting plan" &&
			enDraft.rows ===
				"Drafting a comprehensive plan from 2 alignment rounds" &&
			enDraftZero.rows === "Drafting a comprehensive plan from full context",
		"English drafting copy should show context without a spinner",
	);
	const summaryCases = [
		["aligning", "zh", "Q1 准备问题中"],
		[
			"awaiting_alignment_input",
			"zh",
			"回复对齐需求（Q1 / ~30）；「按推荐」委托剩余决策；「/flow go」直接生成计划",
		],
		[
			"awaiting_final_confirm",
			"zh",
			"已对齐，「/flow go」生成计划；继续回复则补充信息",
		],
		["awaiting_blocking_input", "zh", "生成被阻塞，回答当前问题后继续生成"],
		["generating", "zh", "洞察全部上下文，生成全面计划"],
		["aligning", "en", "Aligning; preparing Q1"],
		[
			"awaiting_alignment_input",
			"en",
			'Answer Q1 of ~30 to continue alignment. Reply "use recommendations" to delegate the rest',
		],
		[
			"awaiting_final_confirm",
			"en",
			"Alignment is ready. Run 「/flow go <id>」 to generate the plan; any other input continues alignment",
		],
		[
			"awaiting_blocking_input",
			"en",
			"Generation is blocked. Answer the current question to continue generation",
		],
		["generating", "en", "Drafting a comprehensive plan from full context"],
	];
	assert(
		summaryCases.every(
			([stage, language, expected]) =>
				generationAlignment.generationAlignmentSummary(stage, language) ===
				expected,
		),
		"alignment summaries should use aligned copy without trailing periods",
	);
	assert(
		generationAlignment.generationAlignmentSummary(
			"awaiting_alignment_input",
			"zh",
			2,
			"/flow go F1",
			"coarse",
		) ===
			"回复对齐需求（Q2 / ~10）；「按推荐」委托剩余决策；「/flow go」直接生成计划" &&
			generationAlignment.generationAlignmentSummary("generating", "zh", 8) ===
				"基于 7 轮问答生成全面计划",
		"alignment summary variants should not end with punctuation",
	);
	const draftBox = generationState.generationDraftBox(
		"🌊 Flow · Drafting plan",
	);
	assert(
		draftBox.rows.length === 0,
		"drafting activity box should not render empty Q&A rows",
	);
}

function assertFlowControlCopy(text, label) {
	assert(
		text.includes("/flow go F<N>") && text.includes("/flow stop F<N>"),
		`${label} missing go/stop command contract`,
	);
	for (const command of ["start", "continue", "pause", "cancel"].map(
		(name) => `/flow ${name}`,
	))
		assert(
			!text.includes(command),
			`${label} recommends old command ${command}`,
		);
}

function sampleFlow() {
	return {
		schemaVersion: 17,
		language: "en",
		id: "F1",
		title: "Ship feature",
		status: "draft",
		source: { type: "prompt", text: "Ship feature" },
		createdAt: 0,
		updatedAt: 0,
		startedAt: null,
		completedAt: null,
		currentGoal: 0,
		meta: null,
		attention: null,
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
				startedAt: null,
				completedAt: null,
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
