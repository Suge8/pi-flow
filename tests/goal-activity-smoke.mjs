import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	watch,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-goal-activity-test-${runId}`);
process.env.PI_CODING_AGENT_DIR = join(out, "agent-state");
const srcOut = join(out, "src");
const workingOut = join(out, "working");

rmSync(out, { recursive: true, force: true });
mkdirSync(srcOut, { recursive: true });
mkdirSync(workingOut, { recursive: true });
cpSync(join(root, "prompts"), join(out, "prompts"), { recursive: true });
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	["--outDir", srcOut, "--rootDir", "src", "--noEmit", "false"],
	{ cwd: root, stdio: "inherit" },
);

const workingSource = join(out, "working-style.ts");
copyFileSync(join(root, "..", "working-style.ts"), workingSource);
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	[
		"--ignoreConfig",
		"--outDir",
		workingOut,
		"--rootDir",
		out,
		"--noEmit",
		"false",
		"--target",
		"ES2022",
		"--module",
		"NodeNext",
		"--moduleResolution",
		"NodeNext",
		"--strict",
		"--skipLibCheck",
		workingSource,
	],
	{ cwd: root, stdio: "inherit" },
);

try {
	await runScenario(emptyConversationPromptsForGoalScenario);
	await runScenario(emptyConversationWithoutUiRejectsGoalDraftScenario);
	await runScenario(pendingGoalSkipsEmptyInputScenario);
	await runScenario(inlineGoalPromptScenario);
	await runScenario(goalAlignAutoStartScenario);
	await runScenario(goalReadyWithoutAlignedRequestScenario);
	await runScenario(englishGoalAlignmentActivityScenario);
	await runScenario(englishGoalDynamicNotificationScenario);
	await runScenario(englishGoalGeneratedSummaryUsesArtifactLanguageScenario);
	await runScenario(goalRuntimeNotificationsUseArtifactLanguageScenario);
	await runScenario(chineseGoalWidgetUsesArtifactLanguageScenario);
	await runScenario(goalDirectStatusCancelScenario);
	await runScenario(goalStartValidationWritesHtmlScenario);
	await runScenario(goalStartSendFailureRollsBackScenario);
	await runScenario(standaloneGoalRuntimePromptHiddenScenario);
	await runScenario(goalDraftSendFailureReleasesPendingScenario);
	await runScenario(goalDraftActivityScenario);
	await runScenario(concurrentGoalClarificationScenario);
	await runScenario(goalRecommendationSwitchesToFlowScenario);
	await runScenario(removedGoalForceCommandScenario);
	await runScenario(clarificationCompactionScenario);
	await runScenario(visibleClarificationHiddenFollowUpScenario);
	await runScenario(agentSessionClarificationHandledScenario);
	await runScenario(agentSessionAlignmentHandledScenario);
	await runScenario(goalClarificationSendFailureReleasesPendingScenario);
	await runScenario(transparentInternalPromptScenario);
	await runScenario(goalPromptChecklistSyncScenario);
	await runScenario(goalPromptXmlTextEscapingScenario);
	await runScenario(goalFromFileScenario);
	await runScenario(handwrittenGoalJsonIsRejectedScenario);
	await runScenario(semanticGoalGenerationEndScenario);
	await runScenario(goalSemanticOverridesHandwrittenScenario);
	await runScenario(goalSemanticRepairRebuildScenario);
	await runScenario(malformedGoalSemanticFallbackScenario);
	await runScenario(malformedCurrentGoalSemanticKeepsRepairingScenario);
	await runScenario(missingGoalSemanticTitleKeepsRepairingScenario);
	await runScenario(goalRepairScenario);
	await runScenario(standaloneGoalWatcherScenario);
	await runScenario(workingStyleSuppressionScenario);
	console.log("goal activity smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

async function runScenario(fn, name = fn.name) {
	try {
		await fn();
	} catch (error) {
		console.error(`goal activity smoke failed in ${name}`);
		throw error;
	}
}

async function emptyConversationPromptsForGoalScenario() {
	const { startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "empty-conversation");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], notifications: [] };
	const ctx = {
		cwd,
		ui: {
			input() {
				return "Ship prompted goal";
			},
			notify(message, level) {
				state.notifications.push(`${message}:${level ?? "info"}`);
			},
		},
		sessionManager: {
			getSessionFile: () => join(out, "empty.jsonl"),
			getBranch: () => [],
		},
	};
	await startGoalGeneration(goalPi(state), ctx, "", "conversation");
	assert(state.sent.length === 1, "empty conversation did not ask for a goal");
	assert(
		state.sent[0].message.includes("Ship prompted goal"),
		"prompted goal was not sent to agent",
	);
}

async function emptyConversationWithoutUiRejectsGoalDraftScenario() {
	const { startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "empty-conversation-no-ui");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], notifications: [] };
	const ctx = {
		cwd,
		hasUI: false,
		ui: {
			notify(message, level) {
				state.notifications.push(`${message}:${level ?? "info"}`);
			},
		},
		sessionManager: {
			getSessionFile: () => join(out, "empty-no-ui.jsonl"),
			getBranch: () => [],
		},
	};
	await startGoalGeneration(
		{ sendUserMessage: (message) => state.sent.push(message) },
		ctx,
		"",
		"conversation",
	);
	assert(
		state.sent.length === 0,
		"empty no-ui conversation started goal draft generation",
	);
	assert(
		state.notifications.some((item) =>
			item.includes("没有可用于生成目标的上下文"),
		),
		state.notifications.join("\n"),
	);
}

async function pendingGoalSkipsEmptyInputScenario() {
	const { startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "pending-skips-input");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], notifications: [], inputs: 0, execs: [] };
	const ctx = {
		cwd,
		ui: {
			input() {
				state.inputs += 1;
				return "should not be asked";
			},
			notify(message, level) {
				state.notifications.push(`${message}:${level ?? "info"}`);
			},
		},
		sessionManager: {
			getSessionFile: () => join(out, "pending-skips-input.jsonl"),
			getBranch: () => [],
		},
	};
	await startGoalGeneration(goalPi(state), ctx, "ship first", "prompt");
	await startGoalGeneration(goalPi(state), ctx, "", "conversation");
	assert(state.inputs === 0, "pending goal asked for empty /goal input");
	assert(
		state.notifications.some((message) =>
			message.includes("已有未完成的计划生成"),
		),
		"pending goal did not reject before input",
	);
}

async function inlineGoalPromptScenario() {
	const { default: goal } = await import(
		`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "inline-goal");
	mkdirSync(cwd, { recursive: true });
	const state = { hidden: [], visible: [], notifications: [], execs: [] };
	let commandHandler;
	goal({
		registerCommand(name, options) {
			if (name === "goal") commandHandler = options.handler;
		},
		registerMessageRenderer() {},
		on() {},
		sendMessage(message, options) {
			const item = {
				message: String(message.content),
				options,
				display: message.display,
			};
			if (message.display === false) state.hidden.push(item);
			else state.visible.push(item);
		},
		sendUserMessage(message, options) {
			state.visible.push({ message: String(message), options, display: true });
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	});
	await commandHandler(
		"Ship inline goal",
		goalContext(cwd, join(out, "inline.jsonl"), state),
	);
	assert(
		state.hidden.length === 1 && state.visible.length === 0,
		"/goal <需求> should send hidden draft generation only",
	);
	assert(
		state.hidden[0].message.includes("Ship inline goal"),
		"/goal <需求> did not include inline request",
	);
	assert(
		state.hidden[0].message.includes("goal.semantic.json") &&
			state.hidden[0].message.includes('"source": {}') &&
			state.hidden[0].message.includes("插件会组装完整状态"),
		"goal plan prompt missing semantic skeleton or plugin assembly rule",
	);
	assert(
		state.hidden[0].message.includes("<!-- pi-flow:need-input -->") &&
			state.hidden[0].message.includes("不要做生成前深度对齐"),
		"goal plan prompt missing blocking-input guidance",
	);
	assert(
		state.hidden[0].message.includes("禁止手写或测试 `goal.html`"),
		"goal plan prompt should leave HTML rendering to the plugin",
	);
	assert(
		state.hidden[0].message.includes(
			"`Steps` 和 `Verification` 都必须使用 checkbox",
		) &&
			state.hidden[0].message.includes("初始只允许 `[ ]`") &&
			state.hidden[0].message.includes("运行时 Todo"),
		"goal plan prompt missing todo checkbox rules",
	);
}

async function goalAlignAutoStartScenario() {
	const { default: goal } = await import(
		`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-align-auto-start");
	mkdirSync(cwd, { recursive: true });
	const state = {
		sent: [],
		messages: [],
		hidden: [],
		visible: [],
		notifications: [],
		execs: [],
		widgets: [],
		selects: [],
		select: "先进行多轮问答对齐想法",
	};
	let commandHandler;
	const handlers = new Map();
	goal({
		registerCommand(name, options) {
			if (name === "goal") commandHandler = options.handler;
		},
		registerMessageRenderer() {},
		on(name, handler) {
			if (!handlers.has(name)) handlers.set(name, []);
			handlers.get(name).push(handler);
		},
		sendMessage(message, options) {
			const item = {
				type: message.customType,
				message: String(message.content),
				options,
			};
			state.messages.push(item);
			if (message.display === false) state.hidden.push(item);
			else state.visible.push(item);
		},
		sendUserMessage(message, options) {
			state.sent.push({ message: String(message), options });
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
		setSessionName() {},
		appendEntry() {},
	});
	const ctx = goalContext(cwd, join(out, "goal-align-auto-start.jsonl"), state);
	await commandHandler("Ship aligned", ctx);
	assert(
		state.selects[0].title === "生成计划前先对齐思路？" &&
			state.selects[0].options[0] === "先进行多轮问答对齐想法" &&
			state.selects[0].options[1] === "跳过对齐，直接根据上下文生成计划",
		JSON.stringify(state.selects[0]),
	);
	assert(
		state.hidden.at(-1).message.includes("# 拷问我") &&
			!state.hidden.at(-1).message.includes("goal.json") &&
			state.sent.length === 0,
		"Y path should start alignment as hidden prompt only",
	);
	const cardIndex = state.messages.findIndex(
		(item) =>
			item.type === "pi-flow-result-card" &&
			item.message.includes("[开始对齐目标]") &&
			item.message.includes("等待 AI 提问"),
	);
	const hiddenPromptIndex = state.messages.findIndex(
		(item) => item.type === "pi-flow-internal-prompt",
	);
	assert(cardIndex >= 0, "goal alignment start card missing");
	assert(
		cardIndex < hiddenPromptIndex,
		"goal alignment start card should be sent before hidden prompt",
	);
	for (const handler of handlers.get("agent_end") ?? [])
		await handler(
			{
				messages: [
					{
						role: "assistant",
						content:
							"信息够了。\n<!-- pi-flow:ready-to-draft -->\n<aligned-request>- 目标：Ship aligned</aligned-request>",
					},
				],
			},
			ctx,
		);
	assert(
		latestWidgetText(state).includes("回复「开始生成」生成计划") &&
			latestWidgetText(state).includes("继续输入则补充对齐") &&
			!latestWidgetText(state).includes("回复 Y"),
		"ready marker did not show final confirmation actions",
	);
	let inputResult;
	for (const handler of handlers.get("input") ?? [])
		inputResult = await handler({ source: "interactive", text: "Y" }, ctx);
	assert(
		inputResult?.action === "handled",
		"consumed final Y should stop the original prompt",
	);
	assert(
		state.visible.at(-1).message === "Y",
		"final Y should remain visible as a user answer",
	);
	assert(
		state.hidden.at(-1).message.includes("对齐摘要") &&
			state.hidden.at(-1).message.includes("Ship aligned"),
		"final Y did not send hidden generation prompt with aligned summary",
	);
	writeGoalSemanticDraft(
		join(cwd, ".flow", "goals", "G1-aligned"),
		"Aligned",
		standalonePlan("Aligned"),
	);
	for (const handler of handlers.get("agent_end") ?? [])
		await handler({ messages: [] }, ctx);
	assert(
		state.notifications.some((item) => item.includes("目标计划已生成并启动")),
		"aligned goal did not auto-start",
	);
}

async function goalReadyWithoutAlignedRequestScenario() {
	const { default: goal } = await import(
		`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-ready-missing-summary");
	mkdirSync(cwd, { recursive: true });
	const state = {
		sent: [],
		hidden: [],
		visible: [],
		notifications: [],
		execs: [],
		widgets: [],
		select: "先进行多轮问答对齐想法",
	};
	let commandHandler;
	const handlers = new Map();
	goal({
		registerCommand(name, options) {
			if (name === "goal") commandHandler = options.handler;
		},
		registerMessageRenderer() {},
		on(name, handler) {
			if (!handlers.has(name)) handlers.set(name, []);
			handlers.get(name).push(handler);
		},
		sendMessage(message, options) {
			const item = { message: String(message.content), options };
			if (message.display === false) state.hidden.push(item);
			else state.visible.push(item);
		},
		sendUserMessage(message, options) {
			state.sent.push({ message: String(message), options });
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
		setSessionName() {},
		appendEntry() {},
	});
	const ctx = goalContext(
		cwd,
		join(out, "goal-ready-missing-summary.jsonl"),
		state,
	);
	await commandHandler("Ship missing summary", ctx);
	for (const handler of handlers.get("agent_end") ?? [])
		await handler(
			{
				messages: [
					{
						role: "assistant",
						content: "问题 1：是否限定 UI？\n<!-- pi-flow:ready-to-draft -->",
					},
				],
			},
			ctx,
		);
	assert(
		latestWidgetText(state).includes("等待回复") &&
			latestWidgetText(state).includes("回答问题继续对齐") &&
			latestWidgetText(state).includes("回复「开始生成」直接生成计划") &&
			!latestWidgetText(state).includes("回复 Y"),
		"ready without aligned-request should wait for an alignment reply",
	);
	for (const handler of handlers.get("input") ?? [])
		await handler({ source: "interactive", text: "Y" }, ctx);
	assert(
		latestWidgetText(state).includes("🎯 目标 · 对齐中") &&
			latestWidgetText(state).includes("等待 AI 追问") &&
			!latestWidgetText(state).includes("已收到"),
		"alignment input should keep an in-progress activity box",
	);
	assert(
		state.visible.at(-1).message === "Y",
		"alignment answer should remain visible",
	);
	assert(
		state.hidden.at(-1).message.includes("# 拷问我") &&
			state.hidden.at(-1).message.includes("Q1: 问题 1：是否限定 UI？") &&
			state.hidden.at(-1).message.includes("A1: Y") &&
			!state.hidden.at(-1).message.includes('"createdAt": 0'),
		"Y after malformed ready should continue hidden alignment with QA context",
	);
	for (const handler of handlers.get("agent_end") ?? [])
		await handler(
			{ messages: [{ role: "assistant", content: "问题 2：是否需要测试？" }] },
			ctx,
		);
	let startResult;
	for (const handler of handlers.get("input") ?? [])
		startResult = await handler(
			{ source: "interactive", text: "开始生成" },
			ctx,
		);
	assert(
		startResult?.action === "handled",
		"start generation reply should be consumed",
	);
	assert(
		latestWidgetText(state).includes("🎯 目标 · 计划生成中") &&
			!latestWidgetText(state).includes("Ship missing summary"),
		"start generation reply should switch to compact generation box",
	);
	assert(
		state.hidden.at(-1).message.includes("生成单 session 可执行计划") &&
			state.hidden.at(-1).message.includes("已对齐问答") &&
			state.hidden.at(-1).message.includes("Q1: 问题 1：是否限定 UI？") &&
			state.hidden.at(-1).message.includes("A1: Y") &&
			!state.hidden.at(-1).message.includes("# 拷问我"),
		"start generation reply should send generation prompt with aligned Q/A",
	);
}

async function englishGoalAlignmentActivityScenario() {
	const language = await import(`file://${join(srcOut, "shared/language.js")}`);
	const originalLanguage = process.env.PI_FLOW_LANGUAGE;
	process.env.PI_FLOW_LANGUAGE = "en";
	language.resetRuntimeLanguageForTests();
	try {
		const { default: goal } = await import(
			`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
		);
		const cwd = join(out, "goal-english-alignment-activity");
		mkdirSync(cwd, { recursive: true });
		const state = {
			sent: [],
			messages: [],
			hidden: [],
			visible: [],
			notifications: [],
			execs: [],
			widgets: [],
			selects: [],
			select: "Ask alignment questions first",
		};
		let commandHandler;
		const handlers = new Map();
		goal({
			registerCommand(name, options) {
				if (name === "goal") commandHandler = options.handler;
			},
			registerMessageRenderer() {},
			on(name, handler) {
				if (!handlers.has(name)) handlers.set(name, []);
				handlers.get(name).push(handler);
			},
			sendMessage(message, options) {
				const item = {
					type: message.customType,
					message: String(message.content),
					options,
				};
				state.messages.push(item);
				if (message.display === false) state.hidden.push(item);
				else state.visible.push(item);
			},
			sendUserMessage(message, options) {
				state.sent.push({ message: String(message), options });
			},
			exec(command, args) {
				state.execs.push({ command, args });
				return Promise.resolve({ code: 0, stdout: "", stderr: "" });
			},
			setSessionName() {},
			appendEntry() {},
		});
		const ctx = goalContext(
			cwd,
			join(out, "goal-english-alignment-activity.jsonl"),
			state,
		);
		await commandHandler("Ship English alignment", ctx);
		assert(
			state.selects[0].title === "Align before generating the plan?" &&
				state.selects[0].options[0] === "Ask alignment questions first" &&
				state.selects[0].options[1] ===
					"Skip alignment and generate from context",
			JSON.stringify(state.selects[0]),
		);
		assert(
			latestWidgetText(state).includes("🎯 Goal · Aligning") &&
				latestWidgetText(state).includes("Waiting for AI to ask") &&
				!latestWidgetText(state).includes("等待"),
			"English aligning widget leaked Chinese",
		);
		assert(
			state.hidden
				.at(-1)
				.message.includes("You are aligning before draft generation.") &&
				!state.hidden.at(-1).message.includes("你正在做生成前对齐"),
			"English alignment prompt was not used",
		);
		for (const handler of handlers.get("agent_end") ?? [])
			await handler(
				{
					messages: [
						{
							role: "assistant",
							content:
								"Enough info.\n<!-- pi-flow:ready-to-draft -->\n<aligned-request>- Goal: Ship English alignment</aligned-request>",
						},
					],
				},
				ctx,
			);
		const finalWidget = latestWidgetText(state);
		assert(
			finalWidget.includes("🎯 Goal · Waiting for confirmation") &&
				finalWidget.includes("Reply “Start generation” to generate the plan") &&
				finalWidget.includes("Any other input continues alignment") &&
				!finalWidget.includes("回复「开始生成」"),
			"English final-confirmation widget leaked Chinese",
		);
		await commandHandler("status", ctx);
		assert(
			state.notifications.at(-1).includes("Alignment summary is ready") &&
				!state.notifications.at(-1).includes("对齐摘要"),
			state.notifications.at(-1),
		);
		let startResult;
		for (const handler of handlers.get("input") ?? [])
			startResult = await handler(
				{ source: "interactive", text: "Start generation" },
				ctx,
			);
		assert(
			startResult?.action === "handled",
			"English start generation reply should be consumed",
		);
		assert(
			latestWidgetText(state).includes("🎯 Goal · Generating plan") &&
				!latestWidgetText(state).includes("计划生成中"),
			"English start generation should switch to generating widget",
		);
		assert(
			state.hidden
				.at(-1)
				.message.includes(
					"generating an executable single-session Pi Goal plan",
				) &&
				state.hidden.at(-1).message.includes("Alignment summary:") &&
				!state.hidden.at(-1).message.includes("# Interrogate me"),
			"English start generation should send the Goal generation prompt",
		);
	} finally {
		if (originalLanguage === undefined) delete process.env.PI_FLOW_LANGUAGE;
		else process.env.PI_FLOW_LANGUAGE = originalLanguage;
		language.resetRuntimeLanguageForTests();
	}
}

async function englishGoalDynamicNotificationScenario() {
	const language = await import(`file://${join(srcOut, "shared/language.js")}`);
	const originalLanguage = process.env.PI_FLOW_LANGUAGE;
	process.env.PI_FLOW_LANGUAGE = "en";
	language.resetRuntimeLanguageForTests();
	try {
		const goalModule = await import(
			`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
		);
		const cwd = join(out, "goal-english-dynamic-notification");
		mkdirSync(cwd, { recursive: true });
		const state = {
			sent: [],
			messages: [],
			notifications: [],
			execs: [],
			widgets: [],
		};
		let commandHandler;
		goalModule.default({
			registerCommand(name, options) {
				if (name === "goal") commandHandler = options.handler;
			},
			registerMessageRenderer() {},
			on() {},
			sendMessage(message, options) {
				state.messages.push({ message: String(message.content), options });
			},
			sendUserMessage(message, options) {
				state.sent.push({ message: String(message), options });
			},
			exec(command, args) {
				state.execs.push({ command, args });
				return Promise.resolve({ code: 0, stdout: "", stderr: "" });
			},
			setSessionName() {},
			appendEntry() {},
		});
		const ctx = goalContext(
			cwd,
			join(out, "goal-english-dynamic-notification.jsonl"),
			state,
		);
		assert(
			await goalModule.startGoalFromFlow("Ship feature", ctx),
			"English active Goal setup failed",
		);
		const dir = join(cwd, ".flow", "goals", "G1-active-blocked");
		writeGoalDraft(dir, "Blocked draft", standalonePlan("Blocked draft"), "en");
		await commandHandler("start G1-active-blocked", ctx);
		const notice = state.notifications.at(-1) ?? "";
		assert(
			notice.includes("Active Goal already exists: Ship feature") &&
				!hasChinese(notice),
			notice,
		);
	} finally {
		if (originalLanguage === undefined) delete process.env.PI_FLOW_LANGUAGE;
		else process.env.PI_FLOW_LANGUAGE = originalLanguage;
		language.resetRuntimeLanguageForTests();
	}
}

async function englishGoalGeneratedSummaryUsesArtifactLanguageScenario() {
	const language = await import(`file://${join(srcOut, "shared/language.js")}`);
	const originalLanguage = process.env.PI_FLOW_LANGUAGE;
	process.env.PI_FLOW_LANGUAGE = "en";
	language.resetRuntimeLanguageForTests();
	try {
		const goalModule = await import(
			`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
		);
		const cwd = join(out, "goal-english-generated-summary");
		mkdirSync(cwd, { recursive: true });
		const state = {
			sent: [],
			hidden: [],
			notifications: [],
			execs: [],
			widgets: [],
		};
		let commandHandler;
		const handlers = new Map();
		goalModule.default({
			registerCommand(name, options) {
				if (name === "goal") commandHandler = options.handler;
			},
			registerMessageRenderer() {},
			on(name, handler) {
				if (!handlers.has(name)) handlers.set(name, []);
				handlers.get(name).push(handler);
			},
			sendMessage(message, options) {
				const item = { message: String(message.content), options };
				state.sent.push(item);
				if (message.display === false) state.hidden.push(item);
			},
			sendUserMessage(message, options) {
				state.sent.push({ message: String(message), options });
			},
			exec(command, args) {
				state.execs.push({ command, args });
				return Promise.resolve({ code: 0, stdout: "", stderr: "" });
			},
			setSessionName() {},
			appendEntry() {},
		});
		const ctx = goalContext(
			cwd,
			join(out, "goal-english-generated-summary.jsonl"),
			state,
		);
		await commandHandler("English request", ctx);
		writeGoalSemanticDraft(
			join(cwd, ".flow", "goals", "G1-english-summary"),
			"English summary",
			standalonePlan("English summary"),
		);
		for (const handler of handlers.get("agent_end") ?? [])
			await handler({ messages: [] }, ctx);
		const notice = state.notifications.at(-1) ?? "";
		assert(
			notice.includes("Goal plan generated and started") && !hasChinese(notice),
			notice,
		);
	} finally {
		if (originalLanguage === undefined) delete process.env.PI_FLOW_LANGUAGE;
		else process.env.PI_FLOW_LANGUAGE = originalLanguage;
		language.resetRuntimeLanguageForTests();
	}
}

async function goalRuntimeNotificationsUseArtifactLanguageScenario() {
	const language = await import(`file://${join(srcOut, "shared/language.js")}`);
	const originalLanguage = process.env.PI_FLOW_LANGUAGE;
	process.env.PI_FLOW_LANGUAGE = "zh";
	language.resetRuntimeLanguageForTests();
	try {
		const goalModule = await import(
			`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
		);
		const cwd = join(out, "goal-artifact-language-notifications");
		const dir = join(cwd, ".flow", "goals", "G1-english-runtime");
		writeGoalDraft(
			dir,
			"English runtime",
			standalonePlan("English runtime"),
			"en",
		);
		const state = { sent: [], notifications: [], execs: [], widgets: [] };
		let commandHandler;
		goalModule.default({
			registerCommand(name, options) {
				if (name === "goal") commandHandler = options.handler;
			},
			registerMessageRenderer() {},
			on() {},
			sendMessage(message, options) {
				state.sent.push({ message: String(message.content), options });
			},
			sendUserMessage(message, options) {
				state.sent.push({ message: String(message), options });
			},
			exec(command, args) {
				state.execs.push({ command, args });
				return Promise.resolve({ code: 0, stdout: "", stderr: "" });
			},
			setSessionName() {},
			appendEntry() {},
		});
		const ctx = goalContext(
			cwd,
			join(out, "goal-artifact-language-notifications.jsonl"),
			state,
		);
		ctx.isIdle = () => true;
		ctx.hasPendingMessages = () => false;
		await commandHandler("start G1-english-runtime", ctx);
		const widgetText = latestWidgetText(state);
		assert(widgetText.includes("Esc/Ctrl+C pause"), widgetText);
		assert(!widgetText.includes("暂停"), widgetText);
		await commandHandler("pause", ctx);
		assertEnglishNotice(state.notifications.at(-1), "Goal paused");
		await commandHandler("continue", ctx);
		assertEnglishNotice(state.notifications.at(-1), "Goal resumed");
		await commandHandler("cancel", ctx);
		assertEnglishNotice(state.notifications.at(-1), "Goal cancelled");
	} finally {
		if (originalLanguage === undefined) delete process.env.PI_FLOW_LANGUAGE;
		else process.env.PI_FLOW_LANGUAGE = originalLanguage;
		language.resetRuntimeLanguageForTests();
	}
}

async function chineseGoalWidgetUsesArtifactLanguageScenario() {
	const language = await import(`file://${join(srcOut, "shared/language.js")}`);
	const originalLanguage = process.env.PI_FLOW_LANGUAGE;
	process.env.PI_FLOW_LANGUAGE = "en";
	language.resetRuntimeLanguageForTests();
	try {
		const goalModule = await import(
			`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
		);
		const cwd = join(out, "goal-chinese-widget-language");
		const dir = join(cwd, ".flow", "goals", "G1-chinese-widget");
		writeGoalDraft(dir, "测试目标", standalonePlan("测试目标"));
		const state = { sent: [], notifications: [], execs: [], widgets: [] };
		let commandHandler;
		goalModule.default({
			registerCommand(name, options) {
				if (name === "goal") commandHandler = options.handler;
			},
			registerMessageRenderer() {},
			on() {},
			sendMessage(message, options) {
				state.sent.push({ message: String(message.content), options });
			},
			sendUserMessage(message, options) {
				state.sent.push({ message: String(message), options });
			},
			exec(command, args) {
				state.execs.push({ command, args });
				return Promise.resolve({ code: 0, stdout: "", stderr: "" });
			},
			setSessionName() {},
			appendEntry() {},
		});
		const ctx = goalContext(
			cwd,
			join(out, "goal-chinese-widget-language.jsonl"),
			state,
		);
		await commandHandler("start G1-chinese-widget", ctx);
		const widgetText = latestWidgetText(state);
		assert(widgetText.includes("🎯 目标 · 执行中"), widgetText);
		assert(widgetText.includes("测试目标"), widgetText);
		assert(!widgetText.includes("🎯 Goal"), widgetText);
		assert(!widgetText.includes("测试Goal"), widgetText);
	} finally {
		if (originalLanguage === undefined) delete process.env.PI_FLOW_LANGUAGE;
		else process.env.PI_FLOW_LANGUAGE = originalLanguage;
		language.resetRuntimeLanguageForTests();
	}
}

async function goalDirectStatusCancelScenario() {
	const { default: goal } = await import(
		`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-direct-status-cancel");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], notifications: [], execs: [], widgets: [] };
	let commandHandler;
	goal({
		registerCommand(name, options) {
			if (name === "goal") commandHandler = options.handler;
		},
		registerMessageRenderer() {},
		on() {},
		sendMessage(message, options) {
			state.sent.push({ message: String(message.content), options });
		},
		sendUserMessage(message, options) {
			state.sent.push({ message: String(message), options });
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	});
	const ctx = goalContext(
		cwd,
		join(out, "goal-direct-status-cancel.jsonl"),
		state,
	);
	await commandHandler("Ship direct", ctx);
	await commandHandler("status", ctx);
	assert(
		state.notifications.some((item) => item.includes("计划生成中")),
		"pending goal status was not shown",
	);
	await commandHandler("cancel", ctx);
	assert(
		state.notifications.some((item) => item.includes("目标计划生成已取消")),
		"pending goal cancel did not clear generation",
	);
}

async function goalStartValidationWritesHtmlScenario() {
	const { default: goal } = await import(
		`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-start-invalid");
	const dir = join(cwd, ".flow", "goals", "G1-invalid-start");
	writeGoalDraft(dir, "Invalid start", "# Missing sections\n");
	const state = { sent: [], notifications: [], execs: [] };
	let commandHandler;
	goal({
		registerCommand(name, options) {
			if (name === "goal") commandHandler = options.handler;
		},
		registerMessageRenderer() {},
		on() {},
		sendUserMessage(message, options) {
			state.sent.push({ message: String(message), options });
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	});
	await commandHandler(
		"start G1-invalid-start",
		goalContext(cwd, join(out, "goal-start-invalid.jsonl"), state),
	);
	assert(
		existsSync(join(dir, "goal.html")),
		"/goal start validation failure did not write goal.html",
	);
	assert(
		readFileSync(join(dir, "goal.html"), "utf8").includes("校验错误"),
		"/goal start validation html missing errors",
	);
}

async function goalStartSendFailureRollsBackScenario() {
	const { default: goal } = await import(
		`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-start-send-failure");
	const dir = join(cwd, ".flow", "goals", "G1-send-failure");
	writeGoalDraft(dir, "Send failure", standalonePlan("Send failure"));
	const state = { notifications: [], execs: [] };
	let commandHandler;
	goal({
		registerCommand(name, options) {
			if (name === "goal") commandHandler = options.handler;
		},
		registerMessageRenderer() {},
		on() {},
		async sendUserMessage() {
			throw new Error("busy");
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
		setSessionName() {},
		appendEntry() {},
	});
	await commandHandler(
		"start G1-send-failure",
		goalContext(cwd, join(out, "goal-start-send-failure.jsonl"), state),
	);
	const saved = JSON.parse(readFileSync(join(dir, "goal.json"), "utf8"));
	assert(saved.status === "draft", "failed /goal start left goal running");
	assert(saved.runtimeGoalId === null, "failed /goal start kept runtimeGoalId");
}

async function standaloneGoalRuntimePromptHiddenScenario() {
	const { default: goal } = await import(
		`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-runtime-hidden");
	const dir = join(cwd, ".flow", "goals", "G1-runtime-hidden");
	writeGoalDraft(dir, "Runtime hidden", standalonePlan("Runtime hidden"));
	const state = {
		hidden: [],
		visible: [],
		notifications: [],
		execs: [],
		widgets: [],
		sessionNames: [],
	};
	let commandHandler;
	goal({
		registerCommand(name, options) {
			if (name === "goal") commandHandler = options.handler;
		},
		registerMessageRenderer() {},
		on() {},
		sendMessage(message, options) {
			const item = { message: String(message.content), options };
			if (message.display === false) state.hidden.push(item);
			else state.visible.push(item);
		},
		sendUserMessage(message, options) {
			state.visible.push({ message: String(message), options });
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
		setSessionName(name) {
			state.sessionNames.push(name);
		},
		appendEntry() {},
	});
	const ctx = goalContext(cwd, join(out, "goal-runtime-hidden.jsonl"), state);
	ctx.isIdle = () => true;
	ctx.hasPendingMessages = () => false;
	await commandHandler("start G1-runtime-hidden", ctx);
	assert(
		state.hidden.at(-1)?.message.includes("目标模式已激活") &&
			state.visible.length === 0,
		"/goal start should hide the runtime prompt",
	);
	assert(
		state.widgets.length > 0,
		"/goal start missing visible activity anchor",
	);
	await commandHandler("pause", ctx);
	await commandHandler("continue", ctx);
	assert(
		state.hidden.at(-1)?.message.includes("用户明确恢复了已暂停的 /goal"),
		"/goal continue resume prompt was not hidden",
	);
	await commandHandler("continue", ctx);
	assert(
		state.hidden.at(-1)?.message.includes("继续活动的 /goal"),
		"automatic continuation prompt was not hidden",
	);
	assert(
		!state.visible.some((item) => item.message.includes("目标模式已激活")),
		"runtime prompt leaked into visible messages",
	);
	await commandHandler("cancel", ctx);
}

async function goalDraftSendFailureReleasesPendingScenario() {
	const { startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "send-failure");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], notifications: [] };
	const ctx = goalContext(cwd, join(out, "send-failure.jsonl"), state);
	const pi = {
		async sendMessage() {
			throw new Error("busy");
		},
	};
	await startGoalGeneration(pi, ctx, "ship", "prompt");
	await startGoalGeneration(goalPi(state), ctx, "ship", "prompt");
	assert(
		state.sent.length === 1,
		"send failure kept pending goal plan generation",
	);
	assert(
		!state.notifications.some((item) => item.includes("已有未完成的计划生成")),
		state.notifications.join("\n"),
	);
}

async function goalDraftActivityScenario() {
	const {
		consumeGoalClarificationInput,
		startGoalGeneration,
		handleGoalGenerationEnd,
	} = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}`
	);
	const cwd = join(out, "project");
	mkdirSync(cwd, { recursive: true });
	const state = {
		sent: [],
		notifications: [],
		execs: [],
		triggers: [],
		widgets: [],
	};
	const pi = {
		sendMessage(message, options) {
			state.sent.push({ message: String(message.content), options });
		},
		sendUserMessage(message, options) {
			state.sent.push({ message: String(message), options });
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	};
	const ctx = {
		cwd,
		ui: {
			notify(message, level) {
				state.notifications.push(`${message}:${level ?? "info"}`);
			},
			setWorkingVisible() {},
			setWidget(key, content, options) {
				state.widgets.push({ key, content, options });
			},
		},
		sessionManager: {
			getSessionFile: () => join(out, "session.jsonl"),
			getBranch: () => [
				{ type: "message", message: { role: "user", content: "Ship feature" } },
			],
		},
	};

	await startGoalGeneration(pi, ctx, "Ship feature", "prompt");
	assert(
		globalThis.__PI_FLOW_ACTIVITY__?.active === true,
		"goal draft generation did not mark flow activity active",
	);
	assert(state.sent.length === 1, "goal draft prompt was not hidden");
	const draftWidget = latestWidgetText(state);
	assert(
		draftWidget.includes("🎯 目标 · 计划生成中") &&
			!draftWidget.includes("Ship feature") &&
			!draftWidget.includes("目标：Ship feature") &&
			!draftWidget.includes("回复会显示在对话里"),
		"goal draft activity box should stay compact",
	);

	await handleGoalGenerationEnd(pi, ctx, {
		messages: [
			{
				role: "assistant",
				content: "请补充范围。\n<!-- pi-flow:need-input -->",
			},
		],
	});
	assert(
		globalThis.__PI_FLOW_ACTIVITY__?.active === true,
		"goal blocking input should keep flow activity active",
	);
	assert(
		!state.notifications.some((message) =>
			message.includes("直接回复缺失信息"),
		),
		"goal clarification should not duplicate AI guidance in notifications",
	);
	const clarificationPrompt = consumeGoalClarificationInput(
		"Make it visual",
		ctx,
	);
	assert(
		clarificationPrompt?.kind === "prompt" &&
			clarificationPrompt.prompt.includes("Make it visual") &&
			clarificationPrompt.prompt.includes("生成单 session 可执行计划"),
		"blocking answer did not become a generation prompt",
	);
	const dir = join(cwd, ".flow", "goals", "G1-clarified");
	writeGoalSemanticDraft(dir, "Clarified", standalonePlan("Clarified"));
	await handleGoalGenerationEnd(pi, ctx);
	assert(
		globalThis.__PI_FLOW_ACTIVITY__?.active === false,
		"accepted clarified goal draft did not clear flow activity",
	);
}

async function concurrentGoalClarificationScenario() {
	const {
		consumeGoalClarificationInput,
		startGoalGeneration,
		handleGoalGenerationEnd,
	} = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const state = { sent: [], notifications: [], execs: [] };
	const pi = goalPi(state);
	const firstCwd = join(out, "clarify-one");
	const secondCwd = join(out, "clarify-two");
	mkdirSync(firstCwd, { recursive: true });
	mkdirSync(secondCwd, { recursive: true });
	const firstCtx = goalContext(firstCwd, join(out, "clarify-one.jsonl"), state);
	const secondCtx = goalContext(
		secondCwd,
		join(out, "clarify-two.jsonl"),
		state,
	);
	await startGoalGeneration(pi, firstCtx, "first goal", "prompt");
	await startGoalGeneration(pi, secondCtx, "second goal", "prompt");
	await handleGoalGenerationEnd(pi, firstCtx, {
		messages: [
			{ role: "assistant", content: "请补充。\n<!-- pi-flow:need-input -->" },
		],
	});
	await handleGoalGenerationEnd(pi, secondCtx, {
		messages: [
			{ role: "assistant", content: "请补充。\n<!-- pi-flow:need-input -->" },
		],
	});

	const secondPrompt = consumeGoalClarificationInput(
		"second detail",
		secondCtx,
	);
	assert(
		secondPrompt?.kind === "prompt" &&
			secondPrompt.prompt.includes("second detail"),
		"clarification was not bound to the active session",
	);
	assert(
		secondPrompt.kind === "prompt" &&
			secondPrompt.prompt.includes("second goal"),
		"clarification used the wrong pending goal",
	);
	writeGoalSemanticDraft(
		join(secondCwd, ".flow", "goals", "G1-second"),
		"Second",
		standalonePlan("Second"),
	);
	await handleGoalGenerationEnd(pi, secondCtx);
	writeGoalSemanticDraft(
		join(firstCwd, ".flow", "goals", "G1-first"),
		"First",
		standalonePlan("First"),
	);
	await handleGoalGenerationEnd(pi, firstCtx);
}

async function goalRecommendationSwitchesToFlowScenario() {
	const {
		consumeGoalClarificationInput,
		pendingGoalFlowRequest,
		startGoalGeneration,
		handleGoalGenerationEnd,
	} = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-to-flow");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], notifications: [], widgets: [] };
	const ctx = goalContext(cwd, join(out, "goal-to-flow.jsonl"), state);
	await startGoalGeneration(goalPi(state), ctx, "large request", "prompt");
	await handleGoalGenerationEnd(goalPi(state), ctx, {
		messages: [
			{
				role: "assistant",
				content: "<!-- pi-flow:recommend-flow -->\n任务太大，推荐改用 /flow。",
			},
		],
	});
	assert(
		pendingGoalFlowRequest(ctx) === "large request",
		"/flow handoff lost original request",
	);
	assert(
		latestWidgetText(state).includes("/flow 拆分执行"),
		"flow recommendation marker did not show the command choice box",
	);

	const plainCwd = join(out, "goal-to-flow-plain-text");
	mkdirSync(plainCwd, { recursive: true });
	const plainCtx = goalContext(
		plainCwd,
		join(out, "goal-to-flow-plain.jsonl"),
		state,
	);
	await startGoalGeneration(
		goalPi(state),
		plainCtx,
		"plain large request",
		"prompt",
	);
	await handleGoalGenerationEnd(goalPi(state), plainCtx, {
		messages: [{ role: "assistant", content: "范围太大，请考虑拆分。" }],
	});
	assert(
		state.notifications.some((message) =>
			message.includes("AI 未生成有效目标计划"),
		),
		"natural language without marker should be treated as generation failure",
	);
	assert(
		pendingGoalFlowRequest(plainCtx) === undefined,
		"natural language without marker should not enable /flow handoff",
	);

	const narrowCwd = join(out, "goal-to-narrow-goal");
	mkdirSync(narrowCwd, { recursive: true });
	const narrowCtx = goalContext(
		narrowCwd,
		join(out, "goal-to-narrow-goal.jsonl"),
		state,
	);
	await startGoalGeneration(
		goalPi(state),
		narrowCtx,
		"another large request",
		"prompt",
	);
	await handleGoalGenerationEnd(goalPi(state), narrowCtx, {
		messages: [
			{
				role: "assistant",
				content: "<!-- pi-flow:recommend-flow -->\n任务太大，推荐改用 /flow。",
			},
		],
	});
	const narrowAction = consumeGoalClarificationInput("只做切片 6", narrowCtx);
	assert(
		narrowAction?.kind === "prompt" &&
			narrowAction.prompt.includes("只做切片 6"),
		"non-flow response should continue goal clarification",
	);
	assert(
		pendingGoalFlowRequest(narrowCtx) === undefined,
		"narrowed goal response should clear flow handoff",
	);
}

async function removedGoalForceCommandScenario() {
	const { default: goal } = await import(
		`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-force-removed");
	mkdirSync(cwd, { recursive: true });
	const state = {
		sent: [],
		messages: [],
		notifications: [],
		execs: [],
		triggers: [],
	};
	let commandHandler;
	goal({
		registerCommand(name, options) {
			if (name === "goal") commandHandler = options.handler;
		},
		registerMessageRenderer() {},
		on() {},
		sendMessage(message, options) {
			state.messages.push({ message, options });
		},
		sendUserMessage(message, options) {
			state.sent.push({ message: String(message), options });
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	});
	const ctx = goalContext(cwd, join(out, "goal-force-removed.jsonl"), state);
	await commandHandler("force", ctx);
	const prompt = String(state.messages.at(-1)?.message.content ?? "");
	assert(
		prompt.includes("force"),
		"removed force alias should be plain request text",
	);
	assert(
		!prompt.includes("不要再次推荐 `/flow`") && state.sent.length === 0,
		"removed force alias should not use visible force prompt",
	);
}

async function clarificationCompactionScenario() {
	const {
		consumeGoalClarificationInput,
		startGoalGeneration,
		handleGoalGenerationEnd,
	} = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "compact-clarify");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], notifications: [], widgets: [] };
	const ctx = goalContext(cwd, join(out, "compact-clarify.jsonl"), state);
	await startGoalGeneration(goalPi(state), ctx, "ship compact", "prompt");
	await handleGoalGenerationEnd(goalPi(state), ctx, {
		messages: [
			{
				role: "assistant",
				content: "请补充范围。\n<!-- pi-flow:need-input -->",
			},
		],
	});
	const longClarification = `prefix-${"x".repeat(2500)}-suffix`;
	const action = consumeGoalClarificationInput(longClarification, ctx);
	assert(
		action?.prompt.includes("用户补充过长") &&
			!action.prompt.includes("-suffix"),
		"long clarification was not compacted before prompt/source merge",
	);
}

async function visibleClarificationHiddenFollowUpScenario() {
	const { default: goal } = await import(
		`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "hidden-clarify");
	mkdirSync(cwd, { recursive: true });
	const state = { messages: [], notifications: [], execs: [], triggers: [] };
	let commandHandler;
	const handlers = new Map();
	goal({
		registerCommand(name, options) {
			if (name === "goal") commandHandler = options.handler;
		},
		registerMessageRenderer() {},
		on(name, handler) {
			if (!handlers.has(name)) handlers.set(name, []);
			handlers.get(name).push(handler);
		},
		sendMessage(message, options) {
			state.messages.push({ message, options });
		},
		sendUserMessage(message, options) {
			state.triggers.push({ message, options });
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	});
	const ctx = goalContext(cwd, join(out, "hidden-clarify.jsonl"), state);
	await commandHandler("needs more detail", ctx);
	for (const handler of handlers.get("agent_end") ?? [])
		await handler(
			{
				messages: [
					{
						role: "assistant",
						content: "请补充范围。\n<!-- pi-flow:need-input -->",
					},
				],
			},
			ctx,
		);
	let result;
	for (const handler of handlers.get("input") ?? [])
		result = await handler({ source: "interactive", text: "只做 UI" }, ctx);
	assert(
		result?.action === "handled",
		"clarification input should be handled after echoing visible input",
	);
	assert(
		state.messages.some(
			(item) =>
				item.message.display === true && item.message.content === "只做 UI",
		),
		"clarification input should keep the user's original message visible",
	);
	const followUp = state.messages.findLast(
		(item) => item.message.display === false,
	);
	assert(
		followUp?.message.content.includes("你正在为 Pi Goal") &&
			followUp.message.content.includes("只做 UI"),
		"clarification follow-up prompt was not hidden",
	);
	assert(
		followUp.options?.deliverAs === "followUp",
		"clarification prompt was not queued as followUp",
	);
	assert(
		state.triggers.length === 0,
		"clarification prompt leaked into visible user messages",
	);
}

async function agentSessionClarificationHandledScenario() {
	const {
		createAgentSession,
		DefaultResourceLoader,
		SessionManager,
		SettingsManager,
	} = await import("@earendil-works/pi-coding-agent");
	const { default: flowExtension } = await import(
		`file://${join(srcOut, "index.js")}`
	);
	const { handleGoalGenerationEnd, startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}`
	);
	const cwd = join(out, "agent-session-clarify");
	const agentDir = join(out, "agent-session-agent");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: [flowExtension],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		resourceLoader,
		sessionManager: SessionManager.inMemory(),
		settingsManager,
	});
	try {
		const ctx = goalContext(cwd, undefined, { notifications: [], widgets: [] });
		const pi = {
			sendUserMessage() {},
			sendMessage() {},
			exec() {
				return Promise.resolve({ code: 0, stdout: "", stderr: "" });
			},
		};
		await startGoalGeneration(pi, ctx, "needs detail", "prompt");
		await handleGoalGenerationEnd(pi, ctx, {
			messages: [
				{ role: "assistant", content: "请补充。\n<!-- pi-flow:need-input -->" },
			],
		});
		let error;
		try {
			await session.prompt("只做 UI");
		} catch (caught) {
			error = caught;
		}
		assert(
			!error,
			`handled clarification should not fall through to AgentSession.prompt: ${error?.message}`,
		);
		assert(
			session.messages.some(
				(message) => message.role === "custom" && message.content === "只做 UI",
			),
			"handled clarification should echo the user's input into the transcript",
		);
	} finally {
		session.dispose();
	}
}

async function agentSessionAlignmentHandledScenario() {
	const {
		createAgentSession,
		DefaultResourceLoader,
		SessionManager,
		SettingsManager,
	} = await import("@earendil-works/pi-coding-agent");
	const { default: flowExtension } = await import(
		`file://${join(srcOut, "index.js")}`
	);
	const { handleGoalGenerationEnd, startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}`
	);
	const cwd = join(out, "agent-session-align");
	const agentDir = join(out, "agent-session-align-agent");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		extensionFactories: [flowExtension],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		resourceLoader,
		sessionManager: SessionManager.inMemory(),
		settingsManager,
	});
	try {
		const ctx = goalContext(cwd, undefined, { notifications: [], widgets: [] });
		const pi = {
			sendUserMessage() {},
			sendMessage() {},
			exec() {
				return Promise.resolve({ code: 0, stdout: "", stderr: "" });
			},
		};
		await startGoalGeneration(pi, ctx, "needs align", "prompt", undefined, {
			mode: "align",
			autoStart: true,
		});
		await handleGoalGenerationEnd(pi, ctx, {
			messages: [{ role: "assistant", content: "问题 1：是否限定 UI？" }],
		});
		const hiddenPromptSeen = new Promise((resolve) => {
			const unsubscribe = session.subscribe((event) => {
				if (
					event.type === "message_start" &&
					event.message.role === "custom" &&
					event.message.customType === "pi-flow-internal-prompt"
				) {
					unsubscribe();
					resolve(String(event.message.content));
				}
			});
		});
		let error;
		try {
			await session.prompt("是");
		} catch (caught) {
			error = caught;
		}
		assert(
			!error,
			`handled alignment should not fall through to AgentSession.prompt: ${error?.message}`,
		);
		const hiddenPrompt = await hiddenPromptSeen;
		assert(
			session.messages.some(
				(message) => message.role === "custom" && message.content === "是",
			),
			"handled alignment should echo the user's answer into the transcript",
		);
		assert(
			hiddenPrompt.includes("# 拷问我") &&
				hiddenPrompt.includes("Q1: 问题 1：是否限定 UI？") &&
				hiddenPrompt.includes("A1: 是"),
			"handled alignment should send hidden QA context",
		);
	} finally {
		session.dispose();
	}
}

async function goalClarificationSendFailureReleasesPendingScenario() {
	const { default: goal } = await import(
		`file://${join(srcOut, "goal.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-need-input-send-failure");
	mkdirSync(cwd, { recursive: true });
	const state = {
		sent: [],
		notifications: [],
		execs: [],
		triggers: [],
		widgets: [],
		failSend: false,
	};
	let commandHandler;
	const handlers = new Map();
	goal({
		registerCommand(name, options) {
			if (name === "goal") commandHandler = options.handler;
		},
		registerMessageRenderer() {},
		on(name, handler) {
			if (!handlers.has(name)) handlers.set(name, []);
			handlers.get(name).push(handler);
		},
		sendMessage(message, options) {
			if (state.failSend) throw new Error("busy");
			state.sent.push({ message: String(message.content), options });
		},
		sendUserMessage(message, options) {
			state.sent.push({ message: String(message), options });
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	});
	const ctx = goalContext(
		cwd,
		join(out, "goal-need-input-send-failure.jsonl"),
		state,
	);
	await commandHandler("needs more detail", ctx);
	for (const handler of handlers.get("agent_end") ?? [])
		await handler(
			{
				messages: [
					{
						role: "assistant",
						content: "请补充范围。\n<!-- pi-flow:need-input -->",
					},
				],
			},
			ctx,
		);
	state.failSend = true;
	for (const handler of handlers.get("input") ?? [])
		await handler({ source: "interactive", text: "只做 UI" }, ctx);
	assert(
		state.notifications.at(-1).includes("计划澄清提示发送失败"),
		"failed goal clarification prompt did not notify",
	);
	state.failSend = false;
	await commandHandler("second goal", ctx);
	assert(
		state.sent.at(-1).message.includes("second goal"),
		"failed goal clarification prompt kept pending generation locked",
	);
}

async function transparentInternalPromptScenario() {
	const { startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "hidden-prompt");
	mkdirSync(cwd, { recursive: true });
	const state = { hidden: [], visible: [], notifications: [], widgets: [] };
	const ctx = goalContext(cwd, join(out, "hidden-prompt.jsonl"), state);
	await startGoalGeneration(
		{
			sendMessage(message, options) {
				const item = { message: String(message.content), options };
				if (message.display === false) state.hidden.push(item);
				else state.visible.push(item);
			},
			sendUserMessage(message, options) {
				state.visible.push({ message: String(message), options });
			},
		},
		ctx,
		"ship hidden",
		"prompt",
	);
	assert(
		state.hidden.at(-1)?.message.includes("ship hidden"),
		"internal prompt should be delivered as hidden custom message",
	);
	assert(
		state.visible.length === 0,
		"internal prompt leaked into visible user messages",
	);
	assert(
		state.notifications.some((item) => item.includes("计划已开始生成")) &&
			state.widgets.length > 0,
		"hidden internal prompt missed visible anchor",
	);
}

async function goalPromptChecklistSyncScenario() {
	const {
		buildContinuePrompt,
		buildGoalPrompt,
		buildGoalSystemPrompt,
		buildResumePrompt,
	} = await import(
		`file://${join(srcOut, "goal/prompts.js")}?checklist-${Date.now()}`
	);
	const goal = { text: "Ship", iteration: 2 };
	const prompts = [
		buildGoalPrompt(goal),
		buildResumePrompt(goal),
		buildGoalSystemPrompt(goal),
		buildContinuePrompt(goal, "marker"),
	];
	for (const prompt of prompts) {
		assert(
			prompt.includes("持久 Todo"),
			"goal prompt missing todo memory rule",
		);
		assert(
			prompt.includes("开始前必须读取"),
			"goal prompt missing read-first rule",
		);
		assert(
			prompt.includes("[ ] 改为 [~]") && prompt.includes("[~] 改为 [x]"),
			"goal prompt missing step status update rule",
		);
		assert(prompt.includes("[!]"), "goal prompt missing blocked status rule");
		assert(
			prompt.includes("切换下一项前必须重新读取或检查") &&
				prompt.includes("为什么先跳过") &&
				prompt.includes("可跳到下一个未完成项"),
			"goal prompt missing reread or blocked-skip rule",
		);
		assert(
			prompt.includes("拆分过大的未完成项") &&
				prompt.includes("维护原因写入 Outcome"),
			"goal prompt missing step maintenance rule",
		);
		assert(
			prompt.includes("不要手写或修改 goal.json"),
			"goal prompt should keep goal.json plugin-owned",
		);
	}
}

async function goalPromptXmlTextEscapingScenario() {
	const { goalObjectiveBlock } = await import(
		`file://${join(srcOut, "goal/prompts.js")}?xml-text-${Date.now()}`
	);
	const text = `A & B <tag> > "quote" 'apostrophe'`;
	assert(
		goalObjectiveBlock({ text }) ===
			`<目标>\nA &amp; B &lt;tag&gt; &gt; "quote" 'apostrophe'\n</目标>`,
		"goal prompt XML text escaping changed",
	);
}

async function goalFromFileScenario() {
	const { handleGoalGenerationEnd, startGoalFromFile } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-from");
	const sessionFile = join(out, "goal-from-session.jsonl");
	mkdirSync(cwd, { recursive: true });
	const source = join(cwd, "task.md");
	writeFileSync(source, "Ship from file");
	const state = { sent: [], notifications: [], execs: [] };
	const pi = goalPi(state);
	const ctx = goalContext(cwd, sessionFile, state);
	await startGoalFromFile(pi, ctx, ["task.md"]);
	assert(
		state.sent.at(-1).message.includes("Ship from file"),
		"file argument did not include source file content",
	);
	const dir = join(cwd, ".flow", "goals", "G1-from-file");
	writeGoalSemanticDraft(dir, "From file", standalonePlan("From file"));
	await handleGoalGenerationEnd(pi, ctx);
	assert(
		existsSync(join(dir, "goal.html")),
		"file argument draft did not render goal.html",
	);
	assert(
		readFileSync(join(dir, "plan.md"), "utf8").includes("From file"),
		"file argument draft plan.md missing",
	);
}

async function handwrittenGoalJsonIsRejectedScenario() {
	const { handleGoalGenerationEnd, startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-handwritten-rejected");
	const sessionFile = join(out, "goal-handwritten-rejected-session.jsonl");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], hidden: [], notifications: [], execs: [] };
	const pi = goalPi(state);
	const ctx = goalContext(cwd, sessionFile, state);
	await startGoalGeneration(pi, ctx, "ship handwritten", "prompt");
	const dir = join(cwd, ".flow", "goals", "G1-handwritten");
	writeGoalDraft(dir, "Handwritten", standalonePlan("Handwritten"));
	const ready = await handleGoalGenerationEnd(pi, ctx);
	assert(ready === undefined, "handwritten goal.json was accepted");
	assert(
		!state.notifications.some((message) =>
			message.includes("下一步：/goal start"),
		),
		"handwritten goal.json showed success notification",
	);
}

async function semanticGoalGenerationEndScenario() {
	const { handleGoalGenerationEnd, startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const { validateGoalDir } = await import(
		`file://${join(srcOut, "goal/validator.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-semantic-generation-end");
	const sessionFile = join(out, "goal-semantic-generation-end-session.jsonl");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], hidden: [], notifications: [], execs: [] };
	const pi = goalPi(state);
	const ctx = goalContext(cwd, sessionFile, state);
	await startGoalGeneration(pi, ctx, "ship semantic only", "prompt");
	const dir = join(cwd, ".flow", "goals", "G1-semantic-only");
	writeGoalSemanticDraft(dir, "Semantic Only", standalonePlan("Semantic Only"));
	assert(
		!existsSync(join(dir, "goal.json")),
		"semantic setup prewrote goal.json",
	);
	const ready = await handleGoalGenerationEnd(pi, ctx);
	assert(
		ready?.id === "G1-semantic-only",
		`semantic goal not ready: ${ready?.id}`,
	);
	assert(
		existsSync(join(dir, "goal.json")),
		"semantic goal did not build goal.json",
	);
	const validation = validateGoalDir(dir);
	assert(
		validation.ok,
		`semantic goal build invalid: ${validation.errors.join("\n")}`,
	);
}

async function goalSemanticOverridesHandwrittenScenario() {
	const { handleGoalGenerationEnd, startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-semantic-overrides");
	const sessionFile = join(out, "goal-semantic-overrides-session.jsonl");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], hidden: [], notifications: [], execs: [] };
	const pi = goalPi(state);
	const ctx = goalContext(cwd, sessionFile, state);
	await startGoalGeneration(pi, ctx, "ship conflict", "prompt");
	const dir = join(cwd, ".flow", "goals", "G1-conflict");
	writeGoalDraft(dir, "Handwritten", standalonePlan("Conflict"));
	writeGoalSemantic(dir, "Semantic Wins", {
		type: "file",
		path: "/model/source",
		originalRequest: "model source",
	});
	const ready = await handleGoalGenerationEnd(pi, ctx);
	const goal = JSON.parse(readFileSync(join(dir, "goal.json"), "utf8"));
	assert(
		ready?.id === "G1-conflict",
		`semantic conflict not ready: ${ready?.id}`,
	);
	assert(
		goal.title === "Semantic Wins",
		`handwritten goal.json was not overwritten: ${goal.title}`,
	);
	assert(
		goal.source.originalRequest === "ship conflict" &&
			goal.source.type === "prompt" &&
			goal.source.path === null,
		"semantic conflict trusted handwritten or model source",
	);
}

async function goalSemanticRepairRebuildScenario() {
	const { handleGoalGenerationEnd, startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-semantic-repair");
	const sessionFile = join(out, "goal-semantic-repair-session.jsonl");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], hidden: [], notifications: [], execs: [] };
	const pi = goalPi(state);
	const ctx = goalContext(cwd, sessionFile, state);
	await startGoalGeneration(pi, ctx, "ship semantic", "prompt");
	const dir = join(cwd, ".flow", "goals", "G1-semantic");
	mkdirSync(dir, { recursive: true });
	writeGoalSemantic(dir, "Broken Semantic");
	writeFileSync(join(dir, "plan.md"), "# Broken\n\n## Objective\nShip\n");
	await handleGoalGenerationEnd(pi, ctx);
	assert(
		state.hidden.at(-1).message.includes("当前校验错误"),
		"invalid semantic Goal did not trigger repair prompt",
	);
	writeGoalSemantic(dir, "Fixed Semantic", {
		type: "file",
		path: "/model/source",
		originalRequest: "model source",
	});
	writeFileSync(join(dir, "plan.md"), standalonePlan("Fixed Semantic"));
	await handleGoalGenerationEnd(pi, ctx);
	const goal = JSON.parse(readFileSync(join(dir, "goal.json"), "utf8"));
	assert(
		goal.title === "Fixed Semantic",
		`semantic repair did not rebuild goal title: ${goal.title}`,
	);
	assert(
		goal.source.originalRequest === "ship semantic" &&
			goal.source.type === "prompt" &&
			goal.source.path === null,
		"semantic repair trusted model source",
	);
	assert(
		state.notifications.some((message) =>
			message.includes("下一步：/goal start"),
		),
		"repaired semantic goal plan did not show next command",
	);
}

async function malformedGoalSemanticFallbackScenario() {
	const { handleGoalGenerationEnd, startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-semantic-fallback");
	const sessionFile = join(out, "goal-semantic-fallback-session.jsonl");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], hidden: [], notifications: [], execs: [] };
	const pi = goalPi(state);
	const ctx = goalContext(cwd, sessionFile, state);
	await startGoalGeneration(pi, ctx, "ship fallback", "prompt");
	const badDir = join(cwd, ".flow", "goals", "G1-bad");
	mkdirSync(badDir, { recursive: true });
	writeFileSync(join(badDir, "goal.semantic.json"), "{");
	const goodDir = join(cwd, ".flow", "goals", "G2-good");
	writeGoalSemanticDraft(goodDir, "Fallback", standalonePlan("Fallback"));
	const ready = await handleGoalGenerationEnd(pi, ctx);
	assert(ready?.id === "G2-good", `fallback picked wrong goal: ${ready?.id}`);
	assert(
		state.notifications.some((message) =>
			message.includes("目标计划草稿组装失败"),
		),
		"malformed semantic draft did not warn and continue",
	);
}

async function malformedCurrentGoalSemanticKeepsRepairingScenario() {
	const { handleGoalGenerationEnd, startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-semantic-current-malformed");
	const sessionFile = join(
		out,
		"goal-semantic-current-malformed-session.jsonl",
	);
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], hidden: [], notifications: [], execs: [] };
	const pi = goalPi(state);
	const ctx = goalContext(cwd, sessionFile, state);
	await startGoalGeneration(pi, ctx, "ship current malformed", "prompt");
	const dir = join(cwd, ".flow", "goals", "G1-current");
	mkdirSync(dir, { recursive: true });
	writeGoalSemantic(dir, "Stale Semantic");
	writeFileSync(join(dir, "plan.md"), "# Broken\n\n## Objective\nShip\n");
	await handleGoalGenerationEnd(pi, ctx);
	writeFileSync(join(dir, "goal.semantic.json"), "{");
	writeFileSync(join(dir, "plan.md"), standalonePlan("Now Valid"));
	const ready = await handleGoalGenerationEnd(pi, ctx);
	assert(
		ready === undefined,
		"malformed current semantic accepted stale goal.json",
	);
	assert(
		!state.notifications.some((message) =>
			message.includes("下一步：/goal start"),
		),
		"malformed current semantic showed success notification",
	);
	assert(
		state.hidden.at(-1).message.includes("目标计划草稿组装失败"),
		"malformed current semantic did not keep repair prompt active",
	);
}

async function missingGoalSemanticTitleKeepsRepairingScenario() {
	const { handleGoalGenerationEnd, startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-semantic-missing-title");
	const sessionFile = join(out, "goal-semantic-missing-title-session.jsonl");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], hidden: [], notifications: [], execs: [] };
	const pi = goalPi(state);
	const ctx = goalContext(cwd, sessionFile, state);
	await startGoalGeneration(pi, ctx, "ship missing title", "prompt");
	const dir = join(cwd, ".flow", "goals", "G1-missing-title");
	writeGoalSemanticDraft(
		dir,
		"Initial Title",
		"# Broken\n\n## Objective\nShip\n",
	);
	await handleGoalGenerationEnd(pi, ctx);
	writeGoalSemantic(dir, undefined);
	writeFileSync(join(dir, "plan.md"), standalonePlan("Now Valid"));
	await handleGoalGenerationEnd(pi, ctx);
	assert(
		state.hidden.at(-1).message.includes("目标语义草稿标题必须是非空字符串"),
		"missing semantic title did not trigger repair prompt",
	);
	const goal = JSON.parse(readFileSync(join(dir, "goal.json"), "utf8"));
	assert(
		goal.title !== "untitled",
		"missing semantic title silently became untitled",
	);
	assert(
		!state.notifications.some((message) =>
			message.includes("下一步：/goal start"),
		),
		"missing semantic title showed success notification",
	);
}

async function goalRepairScenario() {
	const { handleGoalGenerationEnd, startGoalGeneration } = await import(
		`file://${join(srcOut, "goal/generation.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-repair");
	const sessionFile = join(out, "goal-repair-session.jsonl");
	mkdirSync(cwd, { recursive: true });
	const state = { sent: [], hidden: [], notifications: [], execs: [] };
	const pi = goalPi(state);
	const ctx = goalContext(cwd, sessionFile, state);
	await startGoalGeneration(pi, ctx, "ship", "prompt");
	const dir = join(cwd, ".flow", "goals", "G1-invalid");
	writeGoalSemanticDraft(dir, "Broken", "# Broken\n\n## Objective\nShip\n");
	await handleGoalGenerationEnd(pi, ctx);
	assert(
		state.hidden.at(-1).message.includes("当前校验错误"),
		"invalid Goal did not trigger hidden repair prompt",
	);
	assert(
		!state.hidden.at(-1).message.includes("严格访谈"),
		"repair prompt should not use grill semantics",
	);
	assert(
		!state.hidden.at(-1).message.includes("{{goalPath}}"),
		"repair prompt left goalPath placeholder unreplaced",
	);
	assert(
		state.hidden.at(-1).options?.deliverAs === "followUp",
		"repair prompt was not queued as followUp",
	);
	writeFileSync(join(dir, "plan.md"), standalonePlan("Fixed"));
	await handleGoalGenerationEnd(pi, ctx);
	assert(
		state.notifications.some((message) =>
			message.includes("下一步：/goal start"),
		),
		"repaired goal plan did not show next command",
	);
	assert(
		!state.notifications.some((message) => message.includes("计划已生成")),
		"goal generation summary should not repeat draft details",
	);
}

async function standaloneGoalWatcherScenario() {
	const { writeGoalHtml } = await import(
		`file://${join(srcOut, "goal/html.js")}?t=${Date.now()}-${Math.random()}`
	);
	const { closeGoalPlanWatcher, watchGoalPlan } = await import(
		`file://${join(srcOut, "goal/watcher.js")}?t=${Date.now()}-${Math.random()}`
	);
	const cwd = join(out, "goal-watch");
	const dir = join(cwd, ".flow", "goals", "G1-watch");
	const watchPlan = standalonePlan("Watch").replace(
		"## Steps\n- [ ] Run work.",
		"## Steps\n- [x] 1. **准备环境**：安装依赖并运行 `npm ci` 初始化\n- [~] **Run work**：执行主任务并验证输出\n- [!] **等待凭证**：缺少外部 token，记录阻塞",
	);
	writeGoalDraft(dir, "Watch", watchPlan);
	const goal = JSON.parse(readFileSync(join(dir, "goal.json"), "utf8"));
	goal.checks.acceptance.rounds = [
		{
			round: 1,
			result: "failed",
			summary: "旧完成验收失败",
			details: "FAIL\n\n## 发现 1\n- 问题: 验收失败详情",
		},
		{ round: 2, result: "passed", summary: "新完成验收通过" },
	];
	goal.checks.quality.rounds = [
		{
			round: 1,
			result: "failed",
			summary: "旧质量检查失败",
			details: "FAIL\n\n## 发现 1\n- 问题: 质量失败详情",
		},
	];
	writeGoalHtml(dir, goal);
	const htmlPath = join(dir, "goal.html");
	const html = readFileSync(htmlPath, "utf8");
	assert(html.includes("单任务计划"), "goal draft label missing");
	assert(html.includes(">Watch</h1>"), "goal title missing");
	assert(html.includes(">目标</span>"), "hero kind label not localized");
	assert(!html.includes(">Goal</span>"), "hero leaked English Goal label");
	assert(html.includes("任务 1/3 · 检查 1/2"), "goal progress caption missing");
	assert(
		html.includes('data-rough-ring data-percent="40"'),
		"goal ring should include check progress",
	);
	assert(
		html.includes('data-rough-bar data-percent="33" data-tone="amber"'),
		"goal task bar should only count task progress",
	);
	assert(
		html.includes(
			'data-rough-card data-tone="amber" class="bg-amber-50/40 p-5"',
		),
		"active task card should use amber frame",
	);
	assert(!html.includes("**"), "raw bold markdown leaked");
	assert(html.includes("准备环境"), "step title missing");
	assert(html.includes("进行中"), "active step status missing");
	assert(html.includes("阻塞"), "blocked step status missing");
	assert(html.includes('data-key="step-1" open'), "current step not expanded");
	assert(html.includes("data-vertical"), "step connector missing");
	assert(
		html.includes("npm ci") && !html.includes(">1. ") && !html.includes("1. <"),
		"step ordinal prefix not stripped",
	);
	assert(html.includes(">范围</p>"), "goal scope label missing");
	assert(html.includes(">任务清单</p>"), "goal checklist label missing");
	assert(!html.includes("- [ ]"), "raw checkbox markdown leaked");
	assert(html.includes(">怎么验证</p>"), "goal verification section missing");
	assert(html.includes("计划 ID"), "goal debug info missing");
	assert(!html.includes("页面文件"), "goal html leaked page file label");
	assert(!html.includes(htmlPath), "goal html leaked absolute html path");
	assert(html.includes("第 1 轮未通过"), "first failed round label missing");
	assert(html.includes("确保目标完整完成"), "goal acceptance hint missing");
	assert(html.includes("旧完成验收失败"), "goal acceptance history missing");
	assert(html.includes("第 2 轮通过"), "goal second round history missing");
	assert(html.includes("旧质量检查失败"), "goal quality history missing");
	assert(
		html.includes(
			'data-rough-card data-tone="green" class="bg-emerald-50/50 p-5"',
		),
		"passed acceptance should use its own green card",
	);
	assert(
		html.includes('data-rough-card data-tone="red" class="bg-rose-50/50 p-5"'),
		"failed quality should use its own red card",
	);
	assert(html.includes("验收失败详情"), "acceptance details missing");
	assert(html.includes("质量失败详情"), "quality details missing");
	assert(html.includes('data-key="goal-acceptance-round-1"'));
	assert(html.includes('data-key="goal-quality-round-1"'));
	assertUniqueDataKeys(html);
	assert(!html.includes("mermaid"), "mermaid should be removed");
	assert(html.includes("roughjs@4"), "goal Rough.js missing");
	assert(html.includes("data-rough-ring"), "goal progress ring missing");
	assert(html.includes("data-rough-bar"), "goal progress bar missing");
	assert(html.includes("new EventSource"), "goal live reload SSE missing");
	assert(html.includes("data-rough-card"), "goal rough card markers missing");
	assert(
		!html.includes('http-equiv="refresh"'),
		"goal meta refresh should be removed",
	);
	assert(!html.includes("执行路径"), "static goal map should be removed");
	assert(!html.includes("要做"), "goal repeated objective as work section");
	assert(!html.includes(">成果<"), "draft goal should not show empty outcome");
	assert(html.includes("<details"), "goal verification should be collapsed");
	assert(!html.includes(">draft<"), "raw goal status leaked");
	assert(!html.includes("G1-watch</p>"), "goal id leaked in hero");
	const changed = onceFileChanged(htmlPath);
	watchGoalPlan(dir);
	await new Promise((resolve) => setImmediate(resolve));
	writeFileSync(
		join(dir, "plan.md"),
		standalonePlan("Watch").replace("- [ ] Run work.", "- [x] Run work."),
	);
	await changed;
	closeGoalPlanWatcher();
}

async function workingStyleSuppressionScenario() {
	const { default: workingStyle } = await import(
		`file://${join(workingOut, "working-style.js")}?t=${Date.now()}`
	);
	const events = new Map();
	workingStyle({
		on(name, handler) {
			events.set(name, handler);
		},
	});
	const ctx = workingStyleContext();
	globalThis.__PI_FLOW_ACTIVITY__ = { active: true };
	await events.get("agent_start")({}, ctx);
	assert(
		ctx.widgets.at(-1)?.content === undefined,
		"working-style mounted fire loader during flow activity",
	);

	globalThis.__PI_FLOW_ACTIVITY__ = { active: false };
	await events.get("agent_start")({}, ctx);
	assert(
		typeof ctx.widgets.at(-1)?.content === "function",
		"working-style did not mount fire loader outside flow activity",
	);
}

function goalPi(state) {
	return {
		sendMessage(message, options) {
			const item = {
				message: String(message.content),
				options,
				display: message.display,
				type: message.customType,
			};
			state.sent.push(item);
			if (message.display === false) state.hidden?.push(item);
			else state.visible?.push(item);
		},
		sendUserMessage(message, options) {
			const item = { message: String(message), options, display: true };
			state.sent.push(item);
			state.visible?.push(item);
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	};
}

function goalContext(cwd, sessionFile, state) {
	return {
		cwd,
		ui: {
			select(title, options) {
				state.selects?.push({ title, options });
				return state.select ?? options[1];
			},
			notify(message, level) {
				state.notifications.push(`${message}:${level ?? "info"}`);
			},
			setStatus() {},
			setWorkingVisible() {},
			setWidget(key, content, options) {
				state.widgets?.push({ key, content, options });
			},
		},
		sessionManager: { getSessionFile: () => sessionFile },
	};
}

function writeGoalSemantic(dir, title, source = {}) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "goal.semantic.json"),
		`${JSON.stringify({ title, source }, null, 2)}\n`,
	);
}

function writeGoalSemanticDraft(dir, title, plan, source = {}) {
	writeGoalSemantic(dir, title, source);
	writeFileSync(join(dir, "plan.md"), plan);
}

function writeGoalDraft(dir, title, plan, language = "zh") {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "goal.json"),
		`${JSON.stringify(
			{
				schemaVersion: 5,
				language,
				id: basename(dir),
				title,
				status: "draft",
				completionCursor: null,
				source: { type: "prompt", path: null, originalRequest: title },
				createdAt: Date.now(),
				updatedAt: Date.now(),
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
			},
			null,
			2,
		)}\n`,
	);
	writeFileSync(join(dir, "plan.md"), plan);
}

function standalonePlan(title) {
	return `# ${title}\n\n## Objective\n${title}\n\n## Scope\nTest scope.\n\n## Steps\n- [ ] Run work.\n\n## Success Criteria\n- Done.\n\n## Verification\n- [ ] manual\n\n## Notes\n\n## Outcome\n`;
}

function hasChinese(text) {
	return /[\u4e00-\u9fff]/u.test(text);
}

function assertEnglishNotice(notice, expected) {
	assert(
		(notice ?? "").includes(expected) && !hasChinese(notice ?? ""),
		notice ?? "",
	);
}

function latestWidgetText(state) {
	const content = state.widgets?.at(-1)?.content;
	const widget =
		typeof content === "function"
			? content(undefined, { fg: (_color, value) => value })
			: content;
	return widget?.render ? widget.render(100).join("\n") : "";
}

function onceFileChanged(path) {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			watcher.close();
			reject(new Error(`file did not change: ${path}`));
		}, 1000);
		const watcher = watch(path, () => {
			clearTimeout(timeout);
			watcher.close();
			resolve();
		});
	});
}

function workingStyleContext() {
	const widgets = [];
	return {
		widgets,
		ui: {
			setWorkingVisible() {},
			setWidget(key, content, options) {
				widgets.push({ key, content, options });
			},
		},
	};
}

function assertUniqueDataKeys(html) {
	const keys = [...html.matchAll(/data-key="([^"]+)"/gu)].map(
		(match) => match[1],
	);
	assert(
		new Set(keys).size === keys.length,
		`duplicate data-key: ${keys.join(", ")}`,
	);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
