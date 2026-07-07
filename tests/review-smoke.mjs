import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
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
const out = join(root, `.tmp-review-test-${runId}`);
const srcOut = join(out, "src");
const bin = join(out, "bin");
const applyInstruction =
	"将质量检查反馈视为待核实假设，而非事实；先基于当前文件、测试/检查输出和会话约束核实。反馈属实时，修根因并做最小充分修复，避免无关重构、抽象、依赖或风格改动；反馈不成立时，不应用该反馈，并说明依据（文件、命令输出或约束）。";

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
	await runScenario(readPromptMissingPrimaryIgnoresCwdScenario);
	await runScenario(passScenario);
	await runScenario(goalScopePromptScenario);
	await runScenario(currentTaskReviewPromptScenario);
	await runScenario(englishCurrentTaskReviewPromptScenario);
	await runScenario(configReadFailureNoticeScenario);
	await runScenario(autoFailureScenario);
	await runScenario(cancelledReviewDoesNotTriggerAiScenario);
	await runScenario(recoverableTransportErrorKeepsAutoLoopScenario);
	await runScenario(piRetryableErrorKeepsAutoLoopScenario);
	await runScenario(piRetryableErrorStopsAfterGuardScenario);
	await runScenario(multiReviewerFailureScenario);
	await runScenario(mixedReviewerFailureAndErrorScenario);
	await runScenario(passAndFormatInvalidReviewerPassesScenario);
	await runScenario(passAndErrorReviewerStopsScenario);
	await runScenario(goalScopeCancelNotificationUsesResumeCommandScenario);
	await runScenario(processFailureRetriesScenario);
	await runScenario(emptyReviewOutputRetriesScenario);
	await runScenario(emptyReviewOutputFailsOnceScenario);
	await runScenario(reviewRoundTimeUsesCurrentStepScenario);
	await runScenario(failedReviewOmitsTotalTimeScenario);
	await runScenario(markdownBoldPassScenario);
	await runScenario(legacyNeedsChangesVerdictScenario);
	await runScenario(unrejectedPassScenario);
	await runScenario(invalidReviewOutputStopsScenario);
	await runScenario(semiFailureScenario);
	await runScenario(
		() =>
			processScenario("missing", join(bin, "missing"), 1000, (result) => {
				assert(result.startsWith("Review failed to start:"), result);
			}),
		"processScenario missing",
	);
	await runScenario(
		() =>
			processScenario("timeout", script("sleep 1"), 100, (result) => {
				assert(result === null, "timeout did not cancel");
			}),
		"processScenario timeout",
	);
	console.log("review smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

async function runScenario(fn, name = fn.name) {
	try {
		await fn();
	} catch (error) {
		console.error(`review smoke failed in ${name}`);
		throw error;
	}
}

async function promptContractScenario() {
	const { parseCheckVerdictLine } = await import(
		`file://${join(srcOut, "shared/review-verdict.js")}?strict-${Date.now()}`
	);
	const prompt = readFileSync(join(root, "prompts", "zh", "review.md"), "utf8");
	assert(prompt.includes("# 质量检查"), prompt);
	assert(!prompt.includes("任务：会话质量检查"), prompt);
	assert(!prompt.includes("工具安全"), prompt);
	assert(prompt.includes("第一行只能是：PASS 或 FAIL"), prompt);
	assert(prompt.includes("输出契约"), prompt);
	assert(prompt.includes("若 PASS，第二行写一句极简质量检查摘要"), prompt);
	assert(!prompt.includes("完成验收"), prompt);
	assert(parseCheckVerdictLine("PASS") === "PASS", "PASS was rejected");
	assert(parseCheckVerdictLine("FAIL") === "FAIL", "FAIL was rejected");
	assert(
		parseCheckVerdictLine("PASS 质量 OK") === undefined,
		"non-exact PASS line was accepted",
	);
}

async function readPromptMissingPrimaryIgnoresCwdScenario() {
	const { readPrompt } = await import(
		`file://${join(srcOut, "shared/prompts.js")}?missing-primary-${Date.now()}`
	);
	const extensionPrompt = join(out, "prompts", "zh", "review.md");
	const backupPrompt = `${extensionPrompt}.bak`;
	const cwd = join(out, "cwd-prompt-fallback");
	mkdirSync(join(cwd, "prompts", "zh"), { recursive: true });
	writeFileSync(
		join(cwd, "prompts", "zh", "review.md"),
		"cwd prompt must not load",
	);
	const previousCwd = process.cwd();
	renameSync(extensionPrompt, backupPrompt);
	process.chdir(cwd);
	try {
		let error;
		try {
			readPrompt("review");
		} catch (caught) {
			error = caught;
		}
		assert(error, "missing extension prompt did not throw");
		assert(
			String(error.message).includes(extensionPrompt),
			`missing prompt error did not point to extension prompt: ${error.message}`,
		);
	} finally {
		process.chdir(previousCwd);
		if (existsSync(backupPrompt)) renameSync(backupPrompt, extensionPrompt);
	}
}

async function passScenario() {
	writeReviewConfig("autoFix", reviewCommand(["PASS\n质量 OK\n"]));
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质量检查通过",
		card.message.details.title,
	);
	assert(card.options.triggerTurn === true, JSON.stringify(card.options));
	assert(card.message.content.includes("质量 OK"), card.message.content);
	assert(card.message.content.includes("简洁最终回复"), card.message.content);
	assert(!card.message.content.includes("/ 总"), card.message.content);
	assert(
		state.statuses.includes("💯 quality/质量检查 · 0s"),
		state.statuses.join(" | "),
	);
	assert(
		!state.statuses.some(
			(item) => item?.includes("质量检查") && item.includes("/ 总"),
		),
		state.statuses.join(" | "),
	);
	assert(
		state.sentMessages.length === 0,
		"review used user prompt instead of card",
	);
}

async function goalScopePromptScenario() {
	const command = captureReviewCommand("PASS\n质量 OK\n");
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { runConfiguredReview } = await import(
		`file://${join(srcOut, "review.js")}?goal-scope-${Date.now()}`
	);
	await runConfiguredReview(mockPi(state), mockContext(state), {
		scope: {
			kind: "goal",
			goalText: "Ship goal scoped review",
			plan: {
				path: "plan.md",
				text: "# Plan\n\n## Success Criteria\n- Planned proof.",
			},
		},
	});
	const args = readFileSync(`${command}.args`, "utf8");
	assert(args.includes("<goal>\nShip goal scoped review\n</goal>"), args);
	assert(args.includes("计划（plan.md）："), args);
	assert(args.includes("Planned proof."), args);
	assert(args.includes("目标文本用于限定质量问题的相关性"), args);
	assert(args.includes("计划用于限定 scope"), args);
	assert(args.includes("不得作为质量通过证据"), args);
}

async function currentTaskReviewPromptScenario() {
	const command = captureReviewCommand("PASS\n质量 OK\n");
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const args = readFileSync(`${command}.args`, "utf8");
	assert(args.includes("当前会话当前任务的交付质量"), args);
	assert(args.includes("会话记录："), args);
	assert(args.includes("修改文件:"), args);
	assert(args.includes("引用文件:"), args);
	assert(!args.includes("\n\nTranscript:\n"), args);
	assert(!args.includes("Modified files:"), args);
	assert(args.includes("首条用户消息是原始需求锚点"), args);
	assert(args.includes("后续用户消息可能覆盖、缩小或修正原始需求"), args);
	assert(args.includes("最近 assistant 最终回复是交付声明"), args);
	assert(
		!args.includes("最近一次 assistant 最终回复，以及它对最近用户请求"),
		args,
	);
}

async function englishCurrentTaskReviewPromptScenario() {
	const command = captureReviewCommand("PASS\nQuality OK\n");
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { runConfiguredReview } = await import(
		`file://${join(srcOut, "review.js")}?english-current-task-${Date.now()}`
	);
	await runConfiguredReview(mockPi(state), mockContext(state), {
		scope: { kind: "review", language: "en" },
	});
	const args = readFileSync(`${command}.args`, "utf8");
	assert(args.includes("Delivery quality for the current task"), args);
	assert(args.includes("Transcript:"), args);
	assert(args.includes("Modified files:"), args);
	assert(args.includes("Referenced files:"), args);
	assert(args.includes("None detected"), args);
	assert(!args.includes("会话记录"), args);
	assert(!args.includes("相关文件线索"), args);
	assert(!args.includes("未检测到"), args);
}

async function configReadFailureNoticeScenario() {
	writeFileSync(join(out, "config.json"), "{");
	const state = createState();
	const { commands } = await loadExtension(state);
	await commands.get("review").handler("", mockContext(state));
	const notice = state.notifications.find((item) =>
		item.includes("质量检查配置读取失败"),
	);
	assertNoticeFormat(notice, "❌", "config.json 不是合法 JSON");
	writeReviewConfig("manual", reviewCommand(["PASS\n质量 OK\n"]));
}

async function autoFailureScenario() {
	writeReviewConfig(
		"autoFix",
		reviewCommand([
			"FAIL\n\n## 质量检查未通过\n\n## 发现 1\n- 问题: x\n\n## 发现 2\n- 问题: y\n",
		]),
	);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质量检查未通过",
		card.message.details.title,
	);
	assert(
		card.message.content.startsWith("[质量检查未通过]"),
		card.message.content,
	);
	assert(!card.message.content.includes("⏱ 用时"), card.message.content);
	assert(card.options.triggerTurn === true, JSON.stringify(card.options));
	assert(
		card.message.content.includes("## 质量检查未通过"),
		card.message.content,
	);
	assert(card.message.content.includes("下一步："), card.message.content);
	const displayLines = card.message.details.lines.join("\n");
	assert(!displayLines.includes("需要修改"), displayLines);
	assert(!displayLines.includes("FAIL"), displayLines);
	assert(displayLines.includes("发现 1"), displayLines);
	assert(displayLines.includes("发现 1\n• 问题: x\n\n发现 2"), displayLines);
	assert(displayLines.includes("⏱ 用时："), displayLines);
	assertFooterLayout(card.message.details.lines, "⏱ 用时：");
	assert(
		state.statuses.some((item) => item?.startsWith("💯 quality/质量修复中 · ")),
		state.statuses.join(" | "),
	);
	assert(
		state.statuses.some(
			(item) => item?.includes("质量修复中") && item.includes("/ 总"),
		),
		state.statuses.join(" | "),
	);
	assert(
		!card.message.details.lines.join("\n").includes("下一步"),
		"next step leaked",
	);
}

async function cancelledReviewDoesNotTriggerAiScenario() {
	writeReviewConfig("autoFix", script("sleep 30"));
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	const running = commands.get("review").handler("", ctx);
	await new Promise((resolve) => setImmediate(resolve));
	const { cancelActiveFlowActivity } = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}`
	);
	cancelActiveFlowActivity();
	await running;
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质量检查错误",
		card.message.details.title,
	);
	assert(!card.options.triggerTurn, JSON.stringify(card.options));
	assert(!card.options.deliverAs, JSON.stringify(card.options));
	assert(state.sentMessages.length === 0, state.sentMessages.join("\n"));
}

async function recoverableTransportErrorKeepsAutoLoopScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质量检查未通过\n- 问题: transient\n",
		"PASS\n质量 OK\n",
	]);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	await emitAll(events, "agent_end", recoverableWebSocketEndEvent(), ctx);
	assert(reviewRunCount(command) === 1, "transient websocket reran review");
	const retryNotice = state.notifications.find((item) =>
		item.includes("质量检查自动循环仍在等待"),
	);
	assertNoticeFormat(retryNotice, "⏳", "等待 Pi 自动重试\n未停止");
	assert(
		!state.notifications.some((item) => item.includes("自动循环已停止")),
		state.notifications.join("\n"),
	);
	await emitAll(
		events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(reviewRunCount(command) === 2, "review did not resume after recovery");
	assert(
		state.messages.at(-1).message.details.title === "第 2 轮质量检查通过",
		state.messages.at(-1).message.details.title,
	);
}

async function piRetryableErrorKeepsAutoLoopScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质量检查未通过\n- 问题: retryable\n",
		"PASS\n质量 OK\n",
	]);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	await emitAll(events, "agent_end", piRetryableRateLimitEndEvent(), ctx);
	assert(reviewRunCount(command) === 1, "Pi retryable error reran review");
	const retryNotice = state.notifications.find((item) =>
		item.includes("质量检查自动循环仍在等待"),
	);
	assertNoticeFormat(retryNotice, "⏳", "等待 Pi 自动重试\n未停止");
	assert(
		!state.notifications.some((item) => item.includes("自动循环已停止")),
		state.notifications.join("\n"),
	);
	await emitAll(
		events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(reviewRunCount(command) === 2, "review did not resume after Pi retry");
	assert(
		state.messages.at(-1).message.details.title === "第 2 轮质量检查通过",
		state.messages.at(-1).message.details.title,
	);
}

async function piRetryableErrorStopsAfterGuardScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质量检查未通过\n- 问题: retry exhausted\n",
		"PASS\n质量 OK\n",
	]);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	await withFakeTimeouts(async (timers) => {
		await emitAll(events, "agent_end", piRetryableRateLimitEndEvent(), ctx);
		const guard = timers.find((timer) => timer.delay === 20_000);
		assert(
			guard,
			`retry exhaustion guard missing: ${timers.map((t) => t.delay)}`,
		);
		await fireTimer(guard);
	});
	assert(reviewRunCount(command) === 1, "retry exhaustion reran review");
	const stoppedNotice = state.notifications.find((item) =>
		item.includes("质量检查自动循环已停止"),
	);
	assertNoticeFormat(stoppedNotice, "⚠️", "Pi 自动重试耗尽");
	await emitAll(
		events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(reviewRunCount(command) === 1, "stopped review resumed after guard");
}

async function emptyReviewOutputRetriesScenario() {
	const command = reviewCommand(["", "", "PASS\n质量 OK\n"]);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质量检查通过",
		card.message.details.title,
	);
	assert(
		reviewRunCount(command) === 3,
		`unexpected retry count: ${reviewRunCount(command)}`,
	);
	assert(
		!state.notifications.some((item) => item.includes("review 输出为空")),
		state.notifications.join("\n"),
	);
}

async function emptyReviewOutputFailsOnceScenario() {
	const command = reviewCommand(["", "", ""]);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	assert(reviewErrorCard(state), "empty output did not send error card");
	const errors = state.notifications.filter((item) =>
		item.includes("review 输出为空：stdout 为空。无审查结论。"),
	);
	assert(errors.length === 1, state.notifications.join("\n"));
	assert(errors[0].includes("已尝试 3 次"), errors[0]);
	assert(
		reviewRunCount(command) === 3,
		`unexpected retry count: ${reviewRunCount(command)}`,
	);
}

async function reviewRoundTimeUsesCurrentStepScenario() {
	writeReviewConfig(
		"autoFix",
		reviewCommand([
			"FAIL\n\n## 质量检查未通过\n- 问题: x\n",
			"PASS\n质量 OK\n",
		]),
	);
	const originalNow = Date.now;
	let now = 1_000_000;
	Date.now = () => now;
	try {
		const state = createState();
		const { commands, events } = await loadExtension(state);
		const ctx = mockContext(state);
		await events.get("session_start")?.at(-1)?.({}, ctx);
		await commands.get("review").handler("", ctx);
		now += 120_000;
		await emitAll(
			events,
			"agent_end",
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
		const pass = state.messages.at(-1);
		assert(
			pass.message.details.title === "第 2 轮质量检查通过",
			pass.message.details.title,
		);
		assert(!pass.message.content.includes("⏱ 用时"), pass.message.content);
		assert(
			pass.message.details.lines.join("\n").includes("用时：0s / 总 2m"),
			pass.message.details.lines.join("\n"),
		);
		assertFooterLayout(pass.message.details.lines, "⏱ 用时：");
		assert(
			state.statuses.some((item) =>
				item?.startsWith("💯 quality/第 2 轮质量检查 · 0s / 总 2m"),
			),
			state.statuses.join(" | "),
		);
	} finally {
		Date.now = originalNow;
	}
}

async function failedReviewOmitsTotalTimeScenario() {
	writeReviewConfig(
		"autoFix",
		reviewCommand([
			"FAIL\n\n## 质量检查未通过\n- 问题: first\n",
			"FAIL\n\n## 质量检查未通过\n- 问题: second\n",
		]),
	);
	const originalNow = Date.now;
	let now = 1_000_000;
	Date.now = () => now;
	try {
		const state = createState();
		const { commands, events } = await loadExtension(state);
		const ctx = mockContext(state);
		await events.get("session_start")?.at(-1)?.({}, ctx);
		await commands.get("review").handler("", ctx);
		now += 120_000;
		await emitAll(
			events,
			"agent_end",
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
		const failure = state.messages.at(-1);
		assert(
			failure.message.details.title === "第 2 轮质量检查未通过",
			failure.message.details.title,
		);
		assert(
			!failure.message.content.includes("⏱ 用时"),
			failure.message.content,
		);
		assert(
			failure.message.details.lines.join("\n").includes("用时：0s") &&
				!failure.message.details.lines.join("\n").includes("用时：0s / 总"),
			failure.message.details.lines.join("\n"),
		);
	} finally {
		Date.now = originalNow;
	}
}

async function markdownBoldPassScenario() {
	writeReviewConfig("autoFix", reviewCommand(["**PASS**\n质量 OK\n"]));
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质量检查通过",
		card.message.details.title,
	);
}

async function legacyNeedsChangesVerdictScenario() {
	writeReviewConfig(
		"autoFix",
		reviewCommand(["FAIL\n\n## 质量检查未通过\n- 问题: legacy\n"]),
	);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质量检查未通过",
		card.message.details.title,
	);
}

async function unrejectedPassScenario() {
	writeReviewConfig(
		"autoFix",
		reviewCommand(["FAIL\n\n## 质量检查未通过\n- 问题: x\n"]),
	);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质量检查未通过",
		card.message.details.title,
	);
}

async function invalidReviewOutputStopsScenario() {
	writeReviewConfig("autoFix", reviewCommand(["未完成\n"]));
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	assert(
		reviewErrorCard(state),
		"invalid review output did not send error card",
	);
	assert(
		state.notifications.some(
			(item) => item.includes("review 输出格式无效") && item.includes("未完成"),
		),
		state.notifications.join("\n"),
	);
}

async function semiFailureScenario() {
	writeReviewConfig(
		"manual",
		reviewCommand(["FAIL\n\n## 质量检查未通过\n- 问题: x\n"]),
	);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	assert(state.editorText.includes(applyInstruction), state.editorText);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质量检查未通过",
		card.message.details.title,
	);
	assert(
		card.message.content.startsWith("[质量检查未通过]"),
		card.message.content,
	);
	assert(!card.message.content.includes("⏱ 用时"), card.message.content);
	assert(!card.options.triggerTurn, JSON.stringify(card.options));
}

async function processScenario(name, command, timeoutMs, verify) {
	const { runReviewProcess } = await import(
		`file://${join(srcOut, "review.js")}?process=${name}-${Date.now()}`
	);
	const result = await runReviewProcess(
		{
			enabled: true,
			command,
			model: "x",
			thinking: "off",
			tools: [],
			excludeTools: [],
			timeoutMs,
			mode: "autoFix",
		},
		"prompt",
		root,
	);
	verify(result);
}

async function multiReviewerFailureScenario() {
	const first = reviewCommand(["PASS\n质量 OK\n"]);
	const second = reviewCommand(["FAIL\n\n## 质量检查未通过\n- 问题: second\n"]);
	writeReviewConfig("autoFix", first, [
		{ model: "test/first", thinking: "off", command: first },
		{ model: "test/second", thinking: "high", command: second },
	]);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质量检查未通过",
		card.message.details.title,
	);
	assert(
		card.message.content.includes("模型 2 · second"),
		card.message.content,
	);
	assert(card.message.content.includes("second"), card.message.content);
	assert(!card.message.content.includes("质量 OK"), card.message.content);
	const renderedWidgets = renderWidgets(state, "review-progress");
	assert(
		renderedWidgets.some(
			(text) =>
				text.includes("💯 会话 · 质量检查中") &&
				text.includes("对象：当前任务交付") &&
				text.includes("证据：首条用户需求 + 最近上下文 + 文件线索"),
		),
		renderedWidgets.join("\n---\n"),
	);
	assert(
		renderedWidgets.some((text) => text.includes("2·second ❌：second")),
		renderedWidgets.join("\n---\n"),
	);
	const displayLines = card.message.details.lines.join("\n");
	assert(displayLines.includes("⏱ 用时："), displayLines);
}

async function mixedReviewerFailureAndErrorScenario() {
	const failed = reviewCommand(["FAIL\n\n## 质量检查未通过\n- 问题: mixed\n"]);
	writeReviewConfig("autoFix", failed, [
		{ model: "test/failed", thinking: "off", command: failed },
		{
			model: "test/missing",
			thinking: "off",
			command: join(bin, "missing-reviewer"),
		},
	]);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质量检查未通过",
		card.message.details.title,
	);
	assert(
		card.message.content.includes("模型 1 · failed"),
		card.message.content,
	);
	assert(card.message.content.includes("- 问题: mixed"), card.message.content);
	assert(
		!card.message.content.includes("模型 2 · missing"),
		card.message.content,
	);
	assert(!card.message.content.includes("系统错误"), card.message.content);
	assert(
		!card.message.content.includes("Review failed to start"),
		card.message.content,
	);
	const lines = card.message.details.lines.join("\n");
	assert(lines.includes("模型 1 · failed"), lines);
	assert(lines.includes("• 问题: mixed"), lines);
	assert(lines.includes("\n\n---\n\n非修复项：模型系统错误"), lines);
	assert(lines.includes("模型 2 · missing"), lines);
	assert(!lines.includes("FAIL"), lines);
	assert(lines.includes("⏱ 用时："), lines);
	assertFooterLayout(card.message.details.lines, "⏱ 用时：");
}

async function processFailureRetriesScenario() {
	const command = reviewCommand([]);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	assert(reviewErrorCard(state), "process failure did not send error card");
	assert(
		reviewRunCount(command) === 3,
		`unexpected retry count: ${reviewRunCount(command)}`,
	);
	assert(
		state.notifications.some((item) => item.includes("已尝试 3 次")),
		state.notifications.join("\n"),
	);
}

async function passAndFormatInvalidReviewerPassesScenario() {
	const passed = reviewCommand(["PASS\n质量 OK\n"]);
	const invalid = reviewCommand(["已完成\n格式串台\n"]);
	writeReviewConfig("autoFix", passed, [
		{ model: "test/passed", thinking: "off", command: passed },
		{ model: "test/invalid", thinking: "off", command: invalid },
	]);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质量检查通过",
		card.message.details.title,
	);
	assert(card.message.content.includes("质量 OK"), card.message.content);
	const [summary, infra = ""] = card.message.content.split("\n---\n");
	assert(!summary.includes("invalid"), card.message.content);
	assert(
		infra.includes("格式无效（已忽略该模型结论）") &&
			infra.includes("模型 2 · invalid"),
		card.message.content,
	);
	const detailLines = card.message.details.lines.join("\n");
	assert(!detailLines.split("---")[0].includes("invalid"), detailLines);
	assert(detailLines.includes("模型 2 · invalid"), detailLines);
	assert(
		!state.notifications.some((item) => item.includes("review 输出格式无效")),
		state.notifications.join("\n"),
	);
}

async function goalScopeCancelNotificationUsesResumeCommandScenario() {
	const { cancelNotification } = await import(
		`file://${join(srcOut, "review", "view.js")}?cancel=${Date.now()}`
	);
	const flowMessage = cancelNotification({
		options: {
			scope: {
				kind: "goal",
				goalText: "Flow goal",
				resumeCommand: "/flow go",
			},
		},
	});
	assertNoticeMessageFormat(
		flowMessage,
		"⚠️",
		"质量检查已取消\n运行 /flow go 继续",
	);
	assert(!flowMessage.includes("/goal continue"), flowMessage);
	const goalMessage = cancelNotification({
		options: { scope: { kind: "goal", goalText: "Goal" } },
	});
	assertNoticeMessageFormat(
		goalMessage,
		"⚠️",
		"质量检查已取消\n运行 /flow go 继续",
	);
	assert(!goalMessage.includes("/goal continue"), goalMessage);
	const reviewMessage = cancelNotification({ options: {} });
	assertNoticeMessageFormat(reviewMessage, "🛑", "已按你的操作停止");
	const englishMessage = cancelNotification({
		options: { scope: { kind: "review", language: "en" } },
	});
	assertNoticeMessageFormat(englishMessage, "🛑", "Stopped by user");
}

async function passAndErrorReviewerStopsScenario() {
	const passed = reviewCommand(["PASS\n质量 OK\n"]);
	writeReviewConfig("autoFix", passed, [
		{ model: "test/passed", thinking: "off", command: passed },
		{
			model: "test/missing",
			thinking: "off",
			command: join(bin, "missing-pass-reviewer"),
		},
	]);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	assert(reviewErrorCard(state), "pass+error did not send error card");
	assert(
		state.notifications.some((item) => item.includes("模型 2 · missing")),
		state.notifications.join("\n"),
	);
	assert(
		state.notifications.some((item) => item.includes("Review failed to start")),
		state.notifications.join("\n"),
	);
}

function writeReviewConfig(mode, command, models = undefined) {
	writeFileSync(
		join(out, "config.json"),
		JSON.stringify({
			language: "zh",
			runner: {
				command,
				tools: [],
				excludeTools: [],
				timeoutMs: 10000,
				extensions: [],
			},
			models: models ?? [{ model: "x", thinking: "off" }],
			quality: {
				enabled: true,
				mode: qualityMode(mode),
				runAfterCompletion: true,
			},
		}),
	);
}

function qualityMode(mode) {
	return mode;
}

function reviewCommand(outputs) {
	const path = join(bin, `review-${Math.random().toString(16).slice(2)}`);
	const files = outputs.map((output, index) => {
		const outputFile = `${path}.${index}.out`;
		writeFileSync(outputFile, output);
		return outputFile;
	});
	writeFileSync(
		path,
		`#!/bin/sh\ncount_file='${path}.count'\ncount=$(cat "$count_file" 2>/dev/null || echo 0)\ncount=$((count + 1))\necho "$count" > "$count_file"\ncase "$count" in\n${files.map((file, index) => `${index + 1}) cat '${file}' ;;`).join("\n")}\n*) exit 9 ;;\nesac\n`,
		{ mode: 0o755 },
	);
	return path;
}

function captureReviewCommand(output) {
	const path = join(
		bin,
		`capture-review-${Math.random().toString(16).slice(2)}`,
	);
	writeFileSync(
		path,
		`#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n  printf '%s\n---ARG---\n' "$1"\n  shift\ndone > '${path}.args'\nprintf '%s' '${output}'\n`,
		{ mode: 0o755 },
	);
	return path;
}

function script(body) {
	const path = join(bin, `script-${Math.random().toString(16).slice(2)}`);
	writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	return path;
}

function reviewRunCount(command) {
	return Number(readFileSync(`${command}.count`, "utf8").trim());
}

function recoverableWebSocketEndEvent() {
	return {
		messages: [
			{
				role: "assistant",
				stopReason: "error",
				errorMessage: "WebSocket closed 1006 Connection ended",
				diagnostics: [
					{
						type: "provider_transport_failure",
						error: { code: 1006 },
						details: {
							configuredTransport: "autoFix",
							eventsEmitted: true,
							phase: "after_message_stream_start",
						},
					},
				],
			},
		],
	};
}

function piRetryableRateLimitEndEvent() {
	return {
		messages: [
			{
				role: "assistant",
				stopReason: "error",
				errorMessage: "provider returned error: 429 rate limit exceeded",
			},
		],
	};
}

async function loadExtension(state) {
	const module = await import(
		`file://${join(srcOut, "review.js")}?t=${Date.now()}-${Math.random()}`
	);
	const reviewExtension = module.default;
	const commands = new Map();
	const events = new Map();
	reviewExtension({
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerMessageRenderer() {},
		sendMessage(message, options = {}) {
			state.messages.push({ message, options });
		},
		sendUserMessage(message, options = {}) {
			state.sentMessages.push({ message, options });
		},
		on(name, handler) {
			if (!events.has(name)) events.set(name, []);
			if (name !== "agent_end") return events.get(name).push(handler);
			events.get(name).push(async (...args) => {
				await handler(...args);
				await module.waitForScheduledReviewAgentEnd();
			});
		},
	});
	return { commands, events };
}

async function emitAll(events, name, event, ctx) {
	for (const handler of events.get(name) ?? []) await handler(event, ctx);
}

async function withFakeTimeouts(run) {
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	const timers = [];
	globalThis.setTimeout = (callback, delay, ...args) => {
		const timer = { callback, delay, args, cleared: false, unref() {} };
		timers.push(timer);
		return timer;
	};
	globalThis.clearTimeout = (timer) => {
		if (timer && typeof timer === "object") timer.cleared = true;
	};
	try {
		await run(timers);
	} finally {
		globalThis.setTimeout = originalSetTimeout;
		globalThis.clearTimeout = originalClearTimeout;
	}
}

async function fireTimer(timer) {
	assert(timer && !timer.cleared, `timer already cleared: ${timer?.delay}`);
	timer.cleared = true;
	timer.callback(...timer.args);
	await Promise.resolve();
	await Promise.resolve();
}

function createState() {
	return {
		messages: [],
		sentMessages: [],
		notifications: [],
		statuses: [],
		editorText: "",
		widgets: [],
	};
}

function mockPi(state) {
	return {
		sendMessage(message, options = {}) {
			state.messages.push({ message, options });
		},
		sendUserMessage(message, options = {}) {
			state.sentMessages.push({ message, options });
		},
	};
}

function mockContext(state) {
	return {
		cwd: root,
		hasUI: true,
		ui: {
			notify(message, level) {
				state.notifications.push(`${message}:${level ?? "info"}`);
			},
			setStatus(_key, value) {
				state.statuses.push(value);
			},
			setEditorText(value) {
				state.editorText = value;
			},
			setWorkingVisible() {},
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
			getBranch() {
				return [];
			},
		},
	};
}

function renderWidgets(state, key) {
	return state.widgets
		.filter((item) => item.key === key && typeof item.content === "function")
		.map((item) =>
			item
				.content({}, { fg: (_color, text) => text })
				.render(100)
				.map(stripAnsi)
				.join("\n"),
		);
}

function stripAnsi(text) {
	const ansiEscape = String.fromCharCode(27);
	return text.replace(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "g"), "");
}

function reviewErrorCard(state) {
	const titles = state.messages.map((item) => item.message.details?.title);
	return (
		titles.includes("质量检查中") &&
		titles.includes("质量检查错误") &&
		!titles.includes("质量检查未通过")
	);
}

function assertFooterLayout(lines, footerPrefix) {
	const index = lines.findIndex((line) => line.startsWith(footerPrefix));
	assert(index >= 3, `footer missing: ${lines.join("|")}`);
	assert(
		lines[index - 3] === "" &&
			lines[index - 2] === "---" &&
			lines[index - 1] === "",
		`footer separator missing: ${lines.join("|")}`,
	);
}

function assertNoticeFormat(notification, emoji, body, level = "info") {
	assert(notification, "notice missing");
	assert(notification.endsWith(`:${level}`), notification);
	assertNoticeMessageFormat(
		notification.replace(/:(info|warning|error)$/u, ""),
		emoji,
		body,
	);
}

function assertNoticeMessageFormat(message, emoji, body) {
	assert(message.startsWith(`${emoji} `), message);
	const bodyIndex = message.indexOf("\n\n");
	assert(bodyIndex > 0, message);
	assert(message.slice(bodyIndex + 2).includes(body), message);
	assert(!/[。.]$/u.test(message), message);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
