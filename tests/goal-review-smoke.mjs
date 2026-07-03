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
	await runScenario(goalAcceptancePromptIncludesPlanScenario);
	await runScenario(englishGoalAcceptancePromptScenario);
	await runScenario(autoGoalStateReviewFailureScenario);
	await runScenario(goalStatusHidesInternalIterationScenario);
	await runScenario(multiAuditorFailureScenario);
	await runScenario(multiAuditorPassScenario);
	await runScenario(mixedAuditorFailureAndErrorScenario);
	await runScenario(passAndErrorAuditorPausesScenario);
	await runScenario(goalAuditFormatInvalidIgnoredWhenOthersPassScenario);
	await runScenario(goalStateReviewSystemFailurePausesScenario);
	await runScenario(goalStateReviewTimeoutPausesScenario);
	await runScenario(interruptedReviewDoesNotLeakIntoNextGoalScenario);
	await runScenario(cancelDuringReviewDoesNotCrashScenario);
	await runScenario(flowLiveReviewsSyncScenario);
	await runScenario(flowGoalStateReviewUsesFlowStartedAtScenario);
	await runScenario(flowMissingStartedAtFailsClosedScenario);
	await runScenario(flowCancelDuringReviewScenario);
	await runScenario(abortedAgentEndPausesGoalScenario);
	await runScenario(goalCompleteWithoutQualityReviewScenario);
	await runScenario(completionStatusSetIgnoresStaleContextScenario);
	await runScenario(completionStatusClearIgnoresStaleContextScenario);
	await runScenario(startFlowGoalClearsCompletionStatusTimerScenario);
	await runScenario(goalContinuePausedResumesScenario);
	await runScenario(goalContinueRejectsInvalidArtifactScenario);
	await runScenario(transportRetryDoesNotQueueGoalFollowUpScenario);
	await runScenario(retryExhaustionPausesThenAutoResumesScenario);
	await runScenario(englishGoalRetryExhaustionUsesArtifactLanguageScenario);
	await runScenario(retryAutoResumeCancelsOnUserInputScenario);
	await runScenario(websocketLimitAutoContinueScenario);
	await runScenario(goalCompletionIncludesStateReviewHistoryScenario);
	await runScenario(yieldForGoalReviewCardScenario);
	await runScenario(stateReviewPassCardBeforeQualityScenario);
	await runScenario(goalCompleteWithQualityReviewScenario);
	await runScenario(
		goalScopedManualQualityReviewIncludesGoalInstructionScenario,
	);
	await runScenario(englishGoalReviewsUseArtifactLanguageScenario);
	await runScenario(chineseGoalReviewsUseArtifactLanguageScenario);
	await runScenario(
		goalStatusDuringQualityReviewKeepsReviewStatusOwnerScenario,
	);
	await runScenario(qualityReviewStopShowsCompletionBlockedCardScenario);
	await runScenario(flowQualityReviewErrorUsesFlowContinueScenario);
	await runScenario(flowQualityReviewCancelUsesFlowContinueScenario);
	await runScenario(qualityReviewStopResumeAbortedPausesScenario);
	await runScenario(goalCompletionIncludesQualityReviewHistoryScenario);
	await runScenario(goalQualityRepairOwnsActivityBoxScenario);
	await runScenario(flowQualityRepairOwnsActivityBoxScenario);
	await runScenario(goalQualityRepairResumeOwnsActivityBoxScenario);
	await runScenario(flowQualityRepairResumeOwnsActivityBoxScenario);
	await runScenario(goalCompletionFactWriteFailurePausesScenario);
	await runScenario(flowGoalCompleteCardTitleScenario);
	await runScenario(persistedGoalLoadedBeforeAgentEndScenario);
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

async function goalAcceptancePromptIncludesPlanScenario() {
	const command = captureCommand("PASS\n验收 OK\n");
	writeConfig({
		goal: { enabled: true, reviewOnComplete: false },
		command,
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "验收读取计划");
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
	assert(!args.includes("Modified files:"), args);
	assert(!args.includes("None detected"), args);
	assert(args.includes("G1-test/plan.md"), args);
	assert(args.includes("## Success Criteria\n- Done."), args);
}

async function englishGoalAcceptancePromptScenario() {
	const command = captureCommand("PASS\nAcceptance OK\n");
	writeConfig({
		goal: { enabled: true, reviewOnComplete: false },
		command,
	});
	const { auditGoalCompletion } = await import(
		`file://${join(srcOut, "auditor.js")}?english-audit-${Date.now()}`
	);
	const cwd = join(out, "english-audit");
	mkdirSync(cwd, { recursive: true });
	await auditGoalCompletion(
		{
			text: "Ship English acceptance",
			language: "en",
			plan: {
				path: "plan.md",
				text: "# Plan\n\n## Success Criteria\n- Done.",
			},
		},
		"Claimed done",
		{
			cwd,
			sessionManager: { getBranch: () => [fileToolEntry("src/auditor.ts")] },
		},
	);
	const args = readFileSync(`${command}.args`, "utf8");
	assert(args.includes("Transcript:"), args);
	assert(args.includes("Relevant file clues:"), args);
	assert(args.includes("Modified files:"), args);
	assert(args.includes("Referenced files:"), args);
	assert(args.includes("src/auditor.ts"), args);
	assert(!args.includes("会话记录"), args);
	assert(!args.includes("相关文件线索"), args);
	assert(!args.includes("修改文件"), args);
}

async function autoGoalStateReviewFailureScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: false },
		command: script("FAIL\n\n## 完成验收发现目标未完成\n- 问题: 缺验证\n"),
	});
	const state = createState();
	const { commands, tools, handlers } = await loadGoalExtension(state);
	assert(
		!tools.has("goal" + "_complete"),
		"removed completion tool registered",
	);
	let now = 1_000_000;
	const originalDateNow = Date.now;
	Date.now = () => now;
	const ctx = mockContext(state);
	const setStatus = ctx.ui.setStatus;
	let reviewStarted = false;
	ctx.ui.setStatus = (key, value) => {
		setStatus(key, value);
		if (!reviewStarted && value?.includes("完成验收")) {
			reviewStarted = true;
			now += 60_000;
		}
	};
	try {
		await startGoal(commands, ctx, "补齐验证");
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	} finally {
		Date.now = originalDateNow;
	}
	const titles = state.messages
		.map((item) => item.message.details?.title)
		.filter(Boolean);
	assert(
		titles.join(" | ") === "完成验收中 | 完成验收未通过",
		titles.join(" | "),
	);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "完成验收未通过",
		card.message.details.title,
	);
	assert(card.options.triggerTurn === true, JSON.stringify(card.options));
	assert(
		card.message.content.includes("<目标>\n补齐验证\n</目标>"),
		card.message.content,
	);
	assert(
		card.message.content.includes("完成验收发现目标未完成"),
		card.message.content,
	);
	assert(card.message.content.includes("下一步："), card.message.content);
	assert(!card.message.content.includes("/ 总"), card.message.content);
	assert(
		state.statuses.includes("🎯 goal/目标进行中 · 0s"),
		state.statuses.join(" | "),
	);
	assert(
		!state.statuses.some((item) => item?.includes("第 2 轮目标进行中")),
		state.statuses.join(" | "),
	);
	assert(
		state.statuses.includes("🎯 goal/完成验收 · 0s"),
		state.statuses.join(" | "),
	);
	assert(
		!state.statuses.some(
			(item) => item?.includes("完成验收") && item.includes("/ 总"),
		),
		state.statuses.join(" | "),
	);
	assert(
		state.statuses.some((item) =>
			item?.startsWith("🎯 goal/验收补完中 · 0s / 总 1m"),
		),
		state.statuses.join(" | "),
	);
	assert(
		!card.message.details.lines.join("\n").includes("下一步"),
		"next step leaked to card",
	);
	const widgets = widgetTexts(state, "goal-progress");
	assert(
		widgets.some(
			(text) =>
				text.includes("🎯 目标 · 完成验收中") &&
				text.includes("补齐验证") &&
				!text.includes("目标：补齐验证"),
		),
		widgets.join("\n---\n"),
	);
	assert(
		widgets.some(
			(text) =>
				text.includes("🎯 目标 · 验收补完中") &&
				text.includes("补齐验证") &&
				!text.includes("目标：补齐验证"),
		),
		widgets.join("\n---\n"),
	);
}

async function goalStatusHidesInternalIterationScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const state = createState();
	const { commands } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "隐藏内部轮次");
	await commands.get("goal").handler("status", ctx);
	const summary = state.notifications.at(-1);
	assert(summary.includes("目标：隐藏内部轮次"), summary);
	assert(!summary.includes("迭代："), summary);
}

async function multiAuditorFailureScenario() {
	const first = script("PASS\nOK\n");
	const second = script("FAIL\n缺少第二验证\n");
	writeConfig({
		command: first,
		goal: {
			enabled: true,
			reviewOnComplete: false,
			models: [
				{ model: "test/first", thinking: "off", command: first },
				{ model: "test/second", thinking: "high", command: second },
			],
		},
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "多模型完成验收");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const card = state.messages.at(-1);
	assert(
		card,
		JSON.stringify({
			notifications: state.notifications,
			statuses: state.statuses,
			sentMessages: state.sentMessages,
		}),
	);
	assert(
		card.message.details.title === "完成验收未通过",
		card.message.details.title,
	);
	assert(
		card.message.content.includes("模型 2 · second"),
		card.message.content,
	);
	assert(card.message.content.includes("缺少第二验证"), card.message.content);
	assert(!card.message.content.includes("OK"), card.message.content);
	const artifact = JSON.parse(
		readFileSync(
			join(ctx.cwd, ".flow", "goals", "G1-test", "goal.json"),
			"utf8",
		),
	);
	assert(artifact.checks, "goal.json missing checks");
	assert(
		artifact.checks.acceptance.enabled === true,
		"state review not enabled",
	);
	assert(
		artifact.checks.acceptance.rounds.length === 1 &&
			artifact.checks.acceptance.rounds[0].result === "failed",
		JSON.stringify(artifact.checks),
	);
	assert(
		artifact.checks.acceptance.active === null,
		"state review active not cleared after round",
	);
	assert(
		artifact.checks.quality.enabled === false,
		"quality review should be disabled",
	);
	const html = readFileSync(
		join(ctx.cwd, ".flow", "goals", "G1-test", "goal.html"),
		"utf8",
	);
	assert(html.includes("完成验收"), "goal html missing review card");
	assert(html.includes("未启用"), "goal html missing disabled quality label");
	assert(!html.includes("第 1 轮"), "goal html leaked first round label");
	assert(
		html.includes("任务 0/1 · 检查 0/1"),
		"check slots missing from progress caption",
	);
	assert(html.includes("未通过"), "review state missing from checks card");
	assert(
		!html.includes("完成验收 · 未通过"),
		"check state should not repeat in step list",
	);
}

async function multiAuditorPassScenario() {
	const first = script("PASS");
	const second = script("PASS\n实现与目标一致\n");
	writeConfig({
		command: first,
		goal: {
			enabled: true,
			reviewOnComplete: false,
			models: [
				{ model: "test/first", thinking: "off", command: first },
				{ model: "test/second", thinking: "high", command: second },
			],
		},
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "多模型通过审查");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const card = state.messages.find(
		(item) => item.message.details.title === "完成验收通过",
	);
	assert(card, JSON.stringify(state.messages.map((m) => m.message.details)));
	const lines = card.message.details.lines;
	assert(
		lines.includes("---"),
		`pass card missing separator: ${lines.join("|")}`,
	);
	assert(
		lines.some((line) => line.startsWith("模型 1 ·")) &&
			lines.some((line) => line.startsWith("模型 2 ·")),
		lines.join("|"),
	);
	assert(
		!lines.includes("已完成"),
		`verdict leaked into pass card: ${lines.join("|")}`,
	);
	assert(
		lines.every((line) => !line.includes("\n")),
		`embedded newline in card lines: ${JSON.stringify(lines)}`,
	);
}

async function mixedAuditorFailureAndErrorScenario() {
	const failed = script("FAIL\n缺少 mixed 验证\n");
	writeConfig({
		command: failed,
		goal: {
			enabled: true,
			reviewOnComplete: false,
			models: [
				{ model: "test/failed", thinking: "off", command: failed },
				{
					model: "test/missing",
					thinking: "off",
					command: join(bin, "missing-auditor"),
				},
			],
		},
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "混合完成验收");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "完成验收未通过",
		card.message.details.title,
	);
	assert(
		card.message.content.includes("模型 1 · failed"),
		card.message.content,
	);
	assert(
		card.message.content.includes("缺少 mixed 验证"),
		card.message.content,
	);
	assert(
		!card.message.content.includes("模型 2 · missing"),
		card.message.content,
	);
	assert(
		!card.message.content.includes("完成验收启动失败"),
		card.message.content,
	);
	const lines = card.message.details.lines.join("\n");
	assert(lines.includes("非修复项：模型系统错误"), lines);
	assert(lines.includes("模型 2 · missing"), lines);
	assert(lines.includes("完成验收启动失败"), lines);
	assert(lines.includes("⏱ 用时："), lines);
	assert(
		!state.statuses.some((item) => item?.includes("目标已暂停")),
		state.statuses.join(" | "),
	);
}

async function passAndErrorAuditorPausesScenario() {
	const passed = script("PASS\nOK\n");
	writeConfig({
		command: passed,
		goal: {
			enabled: true,
			reviewOnComplete: false,
			models: [
				{ model: "test/passed", thinking: "off", command: passed },
				{
					model: "test/missing",
					thinking: "off",
					command: join(bin, "missing-pass-auditor"),
				},
			],
		},
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "通过加错误应暂停");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details?.title);
	assert(titles.includes("完成验收中"), titles.join(" | "));
	assert(titles.includes("完成验收错误"), titles.join(" | "));
	assert(!titles.includes("目标已完成"), titles.join(" | "));
	assert(
		state.notifications.some((item) => item.includes("模型 2 · missing")),
		state.notifications.join("\n"),
	);
	assert(
		state.notifications.some((item) => item.includes("完成验收启动失败")),
		state.notifications.join("\n"),
	);
	assert(
		state.statuses.some((item) => item?.includes("目标已暂停")),
		state.statuses.join(" | "),
	);
}

async function goalAuditFormatInvalidIgnoredWhenOthersPassScenario() {
	const good = script("PASS\n验证通过\n");
	const bad = script("npm test 全绿\n表格不应在第一行\n");
	writeConfig({
		goal: {
			enabled: true,
			reviewOnComplete: false,
			models: [
				{ model: "test/good", thinking: "off", command: good },
				{ model: "test/bad", thinking: "off", command: bad },
			],
		},
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "格式无效不暂停");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const card = state.messages.find(
		(item) => item.message.details?.title === "完成验收通过",
	);
	assert(
		card,
		`expected pass card: ${state.messages.map((m) => m.message.details?.title).join(" | ")}`,
	);
	assert(
		!state.notifications.some((item) => item.includes("Flow 已暂停")),
		state.notifications.join("\n"),
	);
	assert(
		card.message.content.includes("格式无效（已忽略该模型结论）"),
		card.message.content,
	);
}

async function goalStateReviewSystemFailurePausesScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: false },
		command: join(bin, "missing-reviewer"),
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "超时不要继续");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details?.title);
	assert(titles.includes("完成验收中"), titles.join(" | "));
	assert(titles.includes("完成验收错误"), titles.join(" | "));
	assert(
		state.notifications.some((item) => item.includes("完成验收启动失败")),
		state.notifications.join("\n"),
	);
	assert(
		state.statuses.some((item) => item?.includes("目标已暂停")),
		state.statuses.join(" | "),
	);
}

async function goalStateReviewTimeoutPausesScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: false },
		command: shellScript("sleep 2"),
		timeoutMs: 1000,
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "超时不要继续");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details?.title);
	assert(titles.includes("完成验收中"), titles.join(" | "));
	assert(titles.includes("完成验收错误"), titles.join(" | "));
	assert(
		state.notifications.some((item) => item.includes("完成验收超时")),
		state.notifications.join("\n"),
	);
	assert(
		state.statuses.some((item) => item?.includes("目标已暂停")),
		state.statuses.join(" | "),
	);
}

async function goalCompleteWithoutQualityReviewScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "完成目标");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details?.title);
	assert(
		!titles.some((title) => title?.includes("完成验收")),
		titles.join(" | "),
	);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "目标已完成",
		card.message.details.title,
	);
	assert(card.options.triggerTurn === true, JSON.stringify(card.options));
	assert(
		card.message.content.includes("完成验收：未启用"),
		card.message.content,
	);
	assert(
		card.message.content.includes("质量检查：未启用"),
		card.message.content,
	);
	assert(card.message.content.includes("简洁最终回复"), card.message.content);
}

async function completionStatusSetIgnoresStaleContextScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "完成时 session 已切换");
	ctx.ui.setStatus = (_key, value) => {
		if (value === "🎯 目标已完成") {
			throw new Error(
				"This extension ctx is stale after session replacement or reload.",
			);
		}
		state.statuses.push(value);
	};
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		state.messages.at(-1).message.details.title === "目标已完成",
		state.messages.at(-1).message.details.title,
	);
}

async function completionStatusClearIgnoresStaleContextScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "完成后立即切换 session");

	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	let completionBannerSeen = false;
	ctx.ui.setStatus = (_key, value) => {
		if (value === "🎯 目标已完成") completionBannerSeen = true;
		if (completionBannerSeen && value === undefined) {
			throw new Error(
				"This extension ctx is stale after session replacement or reload.",
			);
		}
		state.statuses.push(value);
	};
	globalThis.setTimeout = (callback) => {
		callback();
		return { unref() {} };
	};
	globalThis.clearTimeout = () => undefined;
	try {
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	} finally {
		globalThis.setTimeout = originalSetTimeout;
		globalThis.clearTimeout = originalClearTimeout;
	}
	assert(completionBannerSeen, "completion banner was not shown");
}

async function startFlowGoalClearsCompletionStatusTimerScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const state = createState();
	const { commands, handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "完成后马上启动下一 goal");

	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	let completionTimer;
	let clearedTimer;
	globalThis.setTimeout = (callback, delay) => {
		completionTimer = { callback, delay };
		return completionTimer;
	};
	globalThis.clearTimeout = (timer) => {
		clearedTimer = timer;
	};
	try {
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
		assert(
			completionTimer?.delay === 8_000,
			"completion timer was not scheduled",
		);
		await module.startGoalFromFlow("Next flow goal", ctx);
		assert(
			clearedTimer === completionTimer,
			"next flow goal did not clear completion timer",
		);
	} finally {
		globalThis.setTimeout = originalSetTimeout;
		globalThis.clearTimeout = originalClearTimeout;
	}
}

async function goalContinuePausedResumesScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const state = createState();
	const { commands } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "暂停后继续命令");
	await commands.get("goal").handler("pause", ctx);
	await commands.get("goal").handler("continue", ctx);
	assert(
		state.sentMessages.length === 2,
		"/goal continue on paused goal should send one resume prompt",
	);
	assert(
		state.notifications.at(-1).includes("目标已恢复"),
		state.notifications.join("\n"),
	);
	const widgetText = latestWidgetText(state);
	assert(widgetText.includes("🎯 目标 · 执行中"), widgetText);
	assert(widgetText.includes("暂停后继续命令"), widgetText);
	assert(!widgetText.includes("目标：暂停后继续命令"), widgetText);
	assert(widgetText.includes("Esc/Ctrl+C 暂停"), widgetText);
}

async function goalContinueRejectsInvalidArtifactScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const state = createState();
	const { commands } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "无效 artifact 不应恢复");
	await commands.get("goal").handler("pause", ctx);
	const goalJson = join(ctx.cwd, ".flow", "goals", "G1-test", "goal.json");
	const artifact = JSON.parse(readFileSync(goalJson, "utf8"));
	writeFileSync(
		goalJson,
		`${JSON.stringify({ ...artifact, schemaVersion: 4 }, null, 2)}\n`,
	);
	await commands.get("goal").handler("continue", ctx);
	assert(
		state.notifications.at(-1).includes("目标校验失败"),
		state.notifications.join("\n"),
	);
	assert(
		state.sentMessages.length === 1,
		"invalid artifact continue should not send a resume prompt",
	);
	const latestGoal = state.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data.goal;
	assert(latestGoal?.status === "paused", JSON.stringify(latestGoal));
	assert(
		JSON.parse(readFileSync(goalJson, "utf8")).status === "paused",
		"invalid artifact continue changed goal.json status",
	);
}

async function transportRetryDoesNotQueueGoalFollowUpScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "长任务连接重试");
	assert(
		state.sentMessages.length === 1,
		"goal start did not send initial prompt",
	);
	await handlers.get("agent_end")(
		{ messages: [sseHeadersTimeoutAssistantError()] },
		ctx,
	);
	await handlers.get("agent_end")(
		{ messages: [sseHeadersTimeoutAssistantError()] },
		ctx,
	);
	const notificationsBeforeWebSocket = state.notifications.length;
	await handlers.get("agent_end")(
		{ messages: [recoverableWebSocketAssistantError()] },
		ctx,
	);
	assert(
		state.sentMessages.length === 1,
		"recoverable transport errors should let Pi retry without queuing follow-up",
	);
	assert(
		state.notifications.length === notificationsBeforeWebSocket + 1 &&
			state.notifications.at(-1).includes("连接中断，等待 Pi 自动重试"),
		state.notifications.join("\n"),
	);
	assert(!state.statuses.includes("🎯 目标已暂停"), state.statuses.join(" | "));
	assert(
		state.statuses.includes("🎯 goal/目标进行中 · 0s"),
		state.statuses.join(" | "),
	);
	assert(
		!state.statuses.some((item) => /第 [2-9] 轮/u.test(item ?? "")),
		state.statuses.join(" | "),
	);
}

async function retryExhaustionPausesThenAutoResumesScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	await withFakeTimeouts(async (timers) => {
		const state = createState();
		const { commands, handlers } = await loadGoalExtension(state);
		const ctx = mockContext(state);
		await startGoal(commands, ctx, "长任务耗尽重试后恢复");
		await handlers.get("agent_end")(
			{ messages: [sseHeadersTimeoutAssistantError()] },
			ctx,
		);
		const guard = timers.find((timer) => timer.delay === 20_000);
		assert(
			guard,
			`retry exhaustion guard missing: ${timers.map((t) => t.delay)}`,
		);
		await fireTimer(guard);
		const paused = state.entries
			.filter((entry) => entry.customType === "goal-state")
			.at(-1)?.data.goal;
		assert(paused?.status === "paused", JSON.stringify(paused));
		assert(
			state.messages.some(
				(item) => item.message.details?.title === "目标连接重试已暂停",
			),
			"missing retry exhausted card",
		);
		const auto = timers.find((timer) => timer.delay === 300_000);
		assert(auto, `auto resume timer missing: ${timers.map((t) => t.delay)}`);
		await fireTimer(auto);
		assert(
			state.messages.some(
				(item) => item.message.details?.title === "目标自动恢复",
			),
			"missing auto resume card",
		);
		assert(
			state.sentMessages.at(-1).includes("用户明确恢复了已暂停的 /goal"),
			state.sentMessages.at(-1),
		);
	});
}

async function englishGoalRetryExhaustionUsesArtifactLanguageScenario() {
	writeConfig({
		language: "zh",
		goal: { enabled: false, reviewOnComplete: false },
	});
	await withFakeTimeouts(async (timers) => {
		const state = createState();
		const { commands, handlers } = await loadGoalExtension(state);
		const ctx = mockContext(state);
		await startGoal(commands, ctx, "Long retry", "en");
		await handlers.get("agent_end")(
			{ messages: [sseHeadersTimeoutAssistantError()] },
			ctx,
		);
		const guard = timers.find((timer) => timer.delay === 20_000);
		assert(guard, "retry exhaustion guard missing");
		await fireTimer(guard);
		const retryCard = state.messages.find(
			(item) => item.message.details?.title === "Goal retry pause",
		);
		assert(retryCard, "missing English retry exhausted card");
		assert(!hasChinese(retryCard.message.content), retryCard.message.content);
		const retryNotice = state.notifications.at(-1) ?? "";
		assert(
			retryNotice.includes("Goal paused: Pi automatic retries are exhausted") &&
				!hasChinese(retryNotice),
			retryNotice,
		);
		const auto = timers.find((timer) => timer.delay === 300_000);
		assert(auto, "auto resume timer missing");
		await fireTimer(auto);
		const autoCard = state.messages.find(
			(item) => item.message.details?.title === "Goal auto-resume",
		);
		assert(autoCard, "missing English auto resume card");
		assert(!hasChinese(autoCard.message.content), autoCard.message.content);
	});
}

async function retryAutoResumeCancelsOnUserInputScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	await withFakeTimeouts(async (timers) => {
		const state = createState();
		const { commands, handlers } = await loadGoalExtension(state);
		const ctx = mockContext(state);
		await startGoal(commands, ctx, "长任务自动恢复可取消");
		await handlers.get("agent_end")(
			{ messages: [sseHeadersTimeoutAssistantError()] },
			ctx,
		);
		const guard = timers.find((timer) => timer.delay === 20_000);
		assert(guard, "retry exhaustion guard missing");
		await fireTimer(guard);
		const auto = timers.find((timer) => timer.delay === 300_000);
		assert(auto && !auto.cleared, "auto resume timer not scheduled");
		await handlers.get("input")(
			{ source: "interactive", text: "我来处理" },
			ctx,
		);
		assert(auto.cleared, "user input did not cancel auto resume timer");
		await fireTimer({ ...auto, cleared: false });
		assert(
			!state.sentMessages.at(-1).includes("用户明确恢复了已暂停的 /goal"),
			state.sentMessages.join("\n"),
		);
	});
}

async function websocketLimitAutoContinueScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "长任务自动恢复");
	await handlers.get("agent_end")(
		{ messages: [websocketLimitAssistantError()] },
		ctx,
	);
	const autoContinue = state.sentMessages.at(-1);
	assert(autoContinue.includes("继续活动的 /goal"), autoContinue);
	assert(
		state.notifications.some((item) =>
			item.includes("60 分钟上限，已自动继续"),
		),
		state.notifications.join("\n"),
	);
	assert(!state.statuses.includes("🎯 目标已暂停"), state.statuses.join(" | "));

	handlers.get("before_agent_start")(
		{ prompt: autoContinue, systemPrompt: "base" },
		ctx,
	);
	await handlers.get("agent_end")(
		{ messages: [websocketLimitAssistantError()] },
		ctx,
	);
	assert(
		state.sentMessages.at(-1) === autoContinue,
		"repeated websocket limit should not enqueue another continuation",
	);
	assert(state.statuses.includes("🎯 目标已暂停"), state.statuses.join(" | "));
	assert(
		state.notifications.some((item) => item.includes("已暂停防止循环")),
		state.notifications.join("\n"),
	);

	const diagnosticsState = createState();
	const diagnosticsExtension = await loadGoalExtension(diagnosticsState);
	const diagnosticsCtx = mockContext(diagnosticsState);
	await startGoal(
		diagnosticsExtension.commands,
		diagnosticsCtx,
		"长任务 diagnostics 自动恢复",
	);
	await diagnosticsExtension.handlers.get("agent_end")(
		{ messages: [websocketLimitDiagnosticsAssistantError()] },
		diagnosticsCtx,
	);
	assert(
		diagnosticsState.sentMessages.at(-1).includes("继续活动的 /goal"),
		diagnosticsState.sentMessages.join("\n"),
	);
	assert(
		diagnosticsState.notifications.some((item) =>
			item.includes("60 分钟上限，已自动继续"),
		),
		diagnosticsState.notifications.join("\n"),
	);
}

function sseHeadersTimeoutAssistantError() {
	return {
		role: "assistant",
		stopReason: "error",
		errorMessage: "Codex SSE response headers timed out after 20000ms",
	};
}

function recoverableWebSocketAssistantError() {
	return {
		role: "assistant",
		stopReason: "error",
		errorMessage: "WebSocket closed 1006 Connection ended",
		diagnostics: [
			{
				type: "provider_transport_failure",
				error: { code: 1006 },
				details: {
					eventsEmitted: true,
					phase: "after_message_stream_start",
				},
			},
		],
	};
}

function websocketLimitAssistantError() {
	return {
		role: "assistant",
		stopReason: "error",
		errorMessage: `Codex error: ${JSON.stringify(websocketLimitPayload())}`,
	};
}

function websocketLimitDiagnosticsAssistantError() {
	return {
		role: "assistant",
		stopReason: "error",
		diagnostics: [
			{
				type: "provider_transport_failure",
				error: websocketLimitPayload(),
			},
		],
	};
}

function websocketLimitPayload() {
	return {
		type: "error",
		error: {
			type: "invalid_request_error",
			code: "websocket_connection_limit_reached",
			message:
				"Responses websocket connection limit reached (60 minutes). Create a new websocket connection to continue.",
		},
		status: 400,
	};
}

async function goalCompletionIncludesStateReviewHistoryScenario() {
	const failCommand = script(
		"FAIL\n\n## 完成验收发现目标未完成\n- 问题: 缺验证\n",
	);
	writeConfig({
		goal: {
			enabled: true,
			reviewOnComplete: false,
			models: [
				{ model: "test/auditor", thinking: "off", command: failCommand },
			],
		},
		command: failCommand,
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "补齐验证");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const passCommand = script("PASS\n验证通过\n");
	writeConfig({
		goal: {
			enabled: true,
			reviewOnComplete: false,
			models: [
				{ model: "test/auditor", thinking: "off", command: passCommand },
			],
		},
		command: passCommand,
	});
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details?.title);
	assert(
		titles.filter((title) => title?.endsWith("完成验收中")).length === 2,
		titles.join(" | "),
	);
	assert(
		titles.indexOf("完成验收中") < titles.indexOf("完成验收未通过"),
		titles.join(" | "),
	);
	assert(
		titles.indexOf("第 2 轮完成验收中") < titles.indexOf("第 2 轮完成验收通过"),
		titles.join(" | "),
	);
	const stateReviewPass = state.messages.find(
		(item) => item.message.details.title === "第 2 轮完成验收通过",
	);
	assert(stateReviewPass, "missing second state review pass card");
	assert(
		!stateReviewPass.message.content.includes("⏱ 用时"),
		stateReviewPass.message.content,
	);
	assert(
		stateReviewPass.message.details.lines.join("\n").includes("/ 总"),
		stateReviewPass.message.details.lines.join("\n"),
	);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "目标已完成",
		card.message.details.title,
	);
	assert(card.message.content.includes("完成验收："), card.message.content);
	assert(
		card.message.content.includes("第 1 轮未通过 · 缺验证"),
		card.message.content,
	);
	assert(
		card.message.content.includes("第 2 轮通过 · 验证通过"),
		card.message.content,
	);
}

async function yieldForGoalReviewCardScenario() {
	const { yieldForGoalReviewCard } = await import(
		`file://${join(srcOut, "goal.js")}?yield=${Date.now()}`
	);
	let settled = false;
	const pending = yieldForGoalReviewCard().then(() => {
		settled = true;
	});
	assert(!settled, "yieldForGoalReviewCard should defer to next macrotask");
	await pending;
	assert(settled, "yieldForGoalReviewCard should resolve after setImmediate");
}

async function stateReviewPassCardBeforeQualityScenario() {
	writeConfig({
		goal: {
			enabled: true,
			reviewOnComplete: true,
			models: [{ model: "test/auditor", thinking: "off" }],
		},
		review: {
			enabled: true,
			mode: "autoFix",
			models: [{ model: "test/reviewer", thinking: "off" }],
		},
		command: sequenceScript(["PASS\n状态 OK\n", "PASS\n质量 OK\n"]),
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "状态卡先于质量检查");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details?.title);
	const stateStart = titles.indexOf("完成验收中");
	const stateMsg = state.messages.findIndex(
		(item) => item.message.details?.title === "完成验收通过",
	);
	const qualityMsg = state.messages.findIndex((item) =>
		item.message.details?.title?.includes("质量检查"),
	);
	assert(stateStart >= 0, `missing state start card: ${titles.join(" | ")}`);
	assert(stateMsg >= 0, `missing state pass card: ${titles.join(" | ")}`);
	assert(qualityMsg >= 0, `missing quality card: ${titles.join(" | ")}`);
	assert(
		stateStart < stateMsg && stateMsg < qualityMsg,
		`state review lifecycle must precede quality review: ${titles.join(" | ")}`,
	);
	assertGoalReviewUiClearedBeforeQualityReview(state);
}

async function goalCompleteWithQualityReviewScenario() {
	writeConfig({
		goal: { enabled: false, reviewOnComplete: true },
		review: { enabled: true, mode: "autoFix" },
		command: script("PASS\n质量 OK\n"),
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "完成并审查");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details.title);
	const qualityStartIndex = titles.indexOf("质量检查中");
	const qualityReviewIndex = titles.indexOf("质量检查通过");
	assert(
		!titles.some((title) => title.includes("完成验收")),
		`disabled state review sent a card: ${titles.join(" | ")}`,
	);
	assert(qualityStartIndex >= 0, titles.join(" | "));
	assert(
		!state.messages[qualityStartIndex].message.content.includes("前置："),
		state.messages[qualityStartIndex].message.content,
	);
	assert(
		!state.messages[qualityStartIndex].message.content.includes("通过后："),
		state.messages[qualityStartIndex].message.content,
	);
	assert(qualityReviewIndex >= 0, titles.join(" | "));
	assert(
		qualityStartIndex < qualityReviewIndex,
		`quality review did not start before pass card: ${titles.join(" | ")}`,
	);
	assert(titles.at(-1) === "目标已完成", titles.join(" | "));
	const quality = state.messages[qualityReviewIndex];
	assert(!quality.options.triggerTurn, JSON.stringify(quality.options));
	const final = state.messages.at(-1);
	assert(
		final.options.triggerTurn === true,
		"completion did not trigger final turn",
	);
	assert(
		final.message.content.includes("完成验收：未启用"),
		final.message.content,
	);
	assert(
		final.message.content.includes("质量检查：通过 · 质量 OK"),
		final.message.content,
	);
	assert(
		!final.message.content.includes("报告：http://"),
		final.message.content,
	);
	assert(!final.message.content.includes("goal.html："), final.message.content);
	assert(
		state.statuses.includes("🎯 goal/质量检查 · 0s"),
		state.statuses.join(" | "),
	);
	assert(
		state.statusEntries.some(
			(item) => item.key === "goal" && item.value?.includes("质量检查"),
		),
		JSON.stringify(state.statusEntries),
	);
	const reviewWidgets = widgetTexts(state, "review-progress");
	assert(
		reviewWidgets.some(
			(text) =>
				text.includes("💯 目标 · 质量检查中") &&
				text.includes("完成并审查") &&
				!text.includes("目标：完成并审查"),
		),
		reviewWidgets.join("\n---\n"),
	);
	assert(
		!state.statusEntries.some(
			(item) => item.key === "review" && item.value?.includes("质量检查"),
		),
		"goal completion chain quality review wrote competing review status",
	);
	const artifact = JSON.parse(
		readFileSync(
			join(ctx.cwd, ".flow", "goals", "G1-test", "goal.json"),
			"utf8",
		),
	);
	assert(artifact.checks, "goal.json missing checks");
	assert(
		artifact.checks.quality.enabled === true &&
			artifact.checks.quality.rounds.length === 1 &&
			artifact.checks.quality.rounds[0].result === "passed",
		JSON.stringify(artifact.checks),
	);
	assert(artifact.status === "complete", artifact.status);
	const completion = state.entries.findLast(
		(entry) => entry.customType === "pi-flow-goal-completed",
	);
	assert(
		completion?.data.acceptance === "完成验收未启用",
		JSON.stringify(completion),
	);
	assert(
		completion.data.summary === "完成验收未启用",
		JSON.stringify(completion.data),
	);
}

async function goalScopedManualQualityReviewIncludesGoalInstructionScenario() {
	writeConfig({
		goal: { enabled: false, reviewOnComplete: true },
		review: { enabled: true, mode: "manual" },
		command: script("FAIL\n\n## 质量检查未通过\n- 问题: x\n"),
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "手动质量修复");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(state.editorText.includes("待核实假设，而非事实"), state.editorText);
	assert(
		state.editorText.includes(
			"处理完反馈后继续完成原目标；不要只处理检查反馈。",
		),
		state.editorText,
	);
	assert(state.editorText.includes("## 质量检查未通过"), state.editorText);
	const card = state.messages.find(
		(item) => item.message.details.title === "质量检查未通过",
	);
	assert(card, "missing quality failure card");
	assert(!card.options.triggerTurn, JSON.stringify(card.options));
}

async function englishGoalReviewsUseArtifactLanguageScenario() {
	writeConfig({
		language: "zh",
		goal: { enabled: true, reviewOnComplete: true },
		review: { enabled: true, mode: "autoFix" },
		command: sequenceScript(["PASS\nComplete\n", "PASS\nQuality ok\n"]),
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "Ship English artifact", "en");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details.title);
	for (const title of [
		"Completion acceptance in progress",
		"Completion acceptance passed",
		"Quality check in progress",
		"Quality check passed",
		"Goal complete",
	])
		assert(titles.includes(title), titles.join(" | "));
	assert(
		!titles.some((title) => /[\u4e00-\u9fff]/u.test(title)),
		titles.join(" | "),
	);
	const visibleText = state.messages
		.map((item) => item.message.content)
		.join("\n---\n");
	assert(!hasChinese(visibleText), visibleText);
	assert(
		state.statusEntries.some(
			(item) => item.key === "goal" && item.value?.includes("quality check"),
		),
		JSON.stringify(state.statusEntries),
	);
	const reviewWidgets = widgetTexts(state, "review-progress");
	assert(
		reviewWidgets.some((text) =>
			text.includes("💯 Goal · Quality check in progress"),
		),
		reviewWidgets.join("\n---\n"),
	);
}

async function chineseGoalReviewsUseArtifactLanguageScenario() {
	writeConfig({
		language: "en",
		goal: { enabled: true, reviewOnComplete: true },
		review: { enabled: true, mode: "autoFix" },
		command: sequenceScript(["PASS\n完成\n", "PASS\n质量通过\n"]),
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "中文产物");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details.title);
	for (const title of [
		"完成验收中",
		"完成验收通过",
		"质量检查中",
		"质量检查通过",
		"目标已完成",
	])
		assert(titles.includes(title), titles.join(" | "));
	assert(
		!titles.some((title) =>
			/Completion acceptance|Quality check|Goal complete/u.test(title),
		),
		titles.join(" | "),
	);
}

async function goalStatusDuringQualityReviewKeepsReviewStatusOwnerScenario() {
	writeConfig({
		goal: { enabled: false, reviewOnComplete: true },
		review: { enabled: true, mode: "autoFix" },
		command: shellScript("sleep 30"),
	});
	const state = createState();
	const reviewWidgetShown = new Promise((resolve) => {
		state.onReviewWidgetShown = resolve;
	});
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "质量检查期间查看状态");
	const pending = handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await reviewWidgetShown;
	const beforeStatus = state.statusEntries.length;
	await commands.get("goal").handler("status", ctx);
	assert(
		state.notifications.at(-1).includes("目标：质量检查期间查看状态"),
		state.notifications.at(-1),
	);
	const leakedStatus = state.statusEntries
		.slice(beforeStatus)
		.find(
			(item) =>
				item.key === "goal" &&
				item.value?.startsWith("🎯 goal/") &&
				!/(第 \d+ 轮)?质量(检查|修复中)/u.test(item.value),
		);
	assert(
		!leakedStatus,
		`/goal status competed with quality review: ${JSON.stringify(leakedStatus)}`,
	);
	const { cancelActiveFlowActivity } = await import(
		`file://${join(srcOut, "shared", "activity-frame.js")}`
	);
	cancelActiveFlowActivity();
	await pending;
}

async function qualityReviewStopShowsCompletionBlockedCardScenario() {
	writeConfig({
		goal: { enabled: false, reviewOnComplete: true },
		review: { enabled: true, mode: "autoFix" },
		command: script("格式无效\n"),
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "质量检查异常需明确收口");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details?.title);
	assert(
		titles.includes("质量检查中"),
		`missing quality start card: ${titles.join(" | ")}`,
	);
	assert(titles.includes("质量检查错误"), titles.join(" | "));
	assert(
		titles.includes("目标完成未收口"),
		`missing completion blocked card: ${titles.join(" | ")}`,
	);
	assert(!titles.includes("目标已完成"), titles.join(" | "));
	const artifact = JSON.parse(
		readFileSync(
			join(ctx.cwd, ".flow", "goals", "G1-test", "goal.json"),
			"utf8",
		),
	);
	assert(
		artifact.checks.quality.rounds[0]?.result === "error",
		JSON.stringify(artifact.checks.quality),
	);
	const latestGoalState = state.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data.goal;
	assert(latestGoalState?.status === "paused", JSON.stringify(latestGoalState));
	assert(
		state.messages
			.find((item) => item.message.details?.title === "目标完成未收口")
			?.message.content.includes("卡点：质量检查未收口"),
		"blocked card did not explain quality review checkpoint",
	);
}

async function flowQualityReviewErrorUsesFlowContinueScenario() {
	writeConfig({
		goal: { enabled: false, reviewOnComplete: true },
		review: { enabled: true, mode: "autoFix" },
		command: script("格式无效\n"),
	});
	const cwd = join(out, "flow-quality-error-cwd");
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
	const errorCard = state.messages.find(
		(item) => item.message.details?.title === "质量检查错误",
	);
	assert(errorCard, "missing quality error card");
	assert(
		errorCard.message.content.includes("下一步：/flow continue"),
		errorCard.message.content,
	);
	assert(
		!errorCard.message.content.includes("/goal continue"),
		errorCard.message.content,
	);
	const blocked = state.messages.find(
		(item) => item.message.details?.title === "Flow 第 1 步 · Login 未完成",
	);
	assert(
		blocked?.message.content.includes("下一步：/flow continue"),
		blocked?.message.content,
	);
}

async function flowQualityReviewCancelUsesFlowContinueScenario() {
	writeConfig({
		goal: { enabled: false, reviewOnComplete: true },
		review: { enabled: true, mode: "autoFix" },
		command: shellScript("sleep 30"),
	});
	const cwd = join(out, "flow-quality-cancel-cwd");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const reviewWidgetShown = new Promise((resolve) => {
		state.onReviewWidgetShown = resolve;
	});
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	const pending = handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await reviewWidgetShown;
	const { cancelActiveFlowActivity } = await import(
		`file://${join(srcOut, "shared", "activity-frame.js")}`
	);
	cancelActiveFlowActivity();
	await pending;
	const errorCard = state.messages.find(
		(item) => item.message.details?.title === "质量检查错误",
	);
	assert(errorCard, "missing quality cancel error card");
	assert(
		errorCard.message.content.includes("/flow continue"),
		errorCard.message.content,
	);
	assert(
		!errorCard.message.content.includes("/goal continue"),
		errorCard.message.content,
	);
	const blocked = state.messages.find(
		(item) => item.message.details?.title === "Flow 第 1 步 · Login 未完成",
	);
	assert(blocked, "missing blocked card after cancel");
	assert(
		blocked.message.content.includes("/flow continue"),
		blocked.message.content,
	);
	assert(
		!blocked.message.content.includes("/goal continue"),
		blocked.message.content,
	);
	const flow = JSON.parse(
		readFileSync(join(cwd, ".flow", "flows", "F1-login", "flow.json"), "utf8"),
	);
	const qualityRound = flow.goals[0].checks.quality.rounds[0];
	assert(qualityRound.result === "error", JSON.stringify(qualityRound));
	assert(qualityRound.summary.includes("/flow continue"), qualityRound.summary);
	assert(
		!qualityRound.summary.includes("/goal continue"),
		qualityRound.summary,
	);
}

async function qualityReviewStopResumeAbortedPausesScenario() {
	writeConfig({
		goal: { enabled: false, reviewOnComplete: true },
		review: { enabled: true, mode: "autoFix" },
		command: script("格式无效\n"),
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "质量检查暂停后恢复");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const sentBeforeContinue = state.sentMessages.length;
	await commands.get("goal").handler("continue", ctx);
	assert(
		state.sentMessages.length === sentBeforeContinue,
		"quality retry should not send a resume prompt",
	);
	const titles = state.messages.map((item) => item.message.details?.title);
	assert(
		titles.includes("第 2 轮质量检查错误"),
		`quality retry did not run the next quality round: ${titles.join(" | ")}`,
	);
	assert(
		!titles.includes("完成验收中"),
		`quality retry unexpectedly reran acceptance: ${titles.join(" | ")}`,
	);
	const artifact = JSON.parse(
		readFileSync(
			join(ctx.cwd, ".flow", "goals", "G1-test", "goal.json"),
			"utf8",
		),
	);
	assert(
		artifact.completionCursor === "quality_retry",
		artifact.completionCursor,
	);
	assert(
		artifact.checks.quality.rounds.length === 2 &&
			artifact.checks.quality.rounds.every((round) => round.result === "error"),
		JSON.stringify(artifact.checks.quality.rounds),
	);
	const latestGoalState = state.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data.goal;
	assert(latestGoalState?.status === "paused", JSON.stringify(latestGoalState));
}

async function goalCompletionIncludesQualityReviewHistoryScenario() {
	const passMarker = join(out, "quality-review-pass.marker");
	const command = shellScript(`if [ -f '${passMarker}' ]; then
	printf '%s' 'PASS
质量已验证
'
else
	printf '%s' 'FAIL

## 质量检查未通过
- 问题: 缺少质量验证
'
fi`);
	writeConfig({
		goal: { enabled: false, reviewOnComplete: true },
		review: {
			enabled: true,
			mode: "autoFix",
			models: [{ model: "test/reviewer", thinking: "off", command }],
		},
		command,
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "完成并修复质量反馈");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const beforeRepairAgentEnd = state.statusEntries.length;
	writeFileSync(passMarker, "pass");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const leakedGoalStatus = state.statusEntries
		.slice(beforeRepairAgentEnd)
		.find(
			(item) =>
				item.key === "goal" &&
				item.value?.startsWith("🎯 goal/") &&
				!/(第 \d+ 轮)?质量(检查|修复中)/u.test(item.value),
		);
	assert(
		!leakedGoalStatus,
		`goal runtime status competed with quality review: ${JSON.stringify(leakedGoalStatus)}`,
	);
	const final = state.messages.at(-1);
	assert(
		final.message.details.title === "目标已完成",
		final.message.details.title,
	);
	assert(final.message.content.includes("质量检查："), final.message.content);
	assert(
		final.message.content.includes("第 1 轮未通过 · 缺少质量验证"),
		final.message.content,
	);
	assert(
		final.message.content.includes("第 2 轮通过 · 质量已验证"),
		final.message.content,
	);
	assert(
		state.statuses.some(
			(item) =>
				item?.startsWith("🎯 goal/质量修复中 · ") && item.includes("/ 总"),
		),
		state.statuses.join(" | "),
	);
}

async function goalQualityRepairOwnsActivityBoxScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: true },
		review: {
			enabled: true,
			mode: "autoFix",
		},
		command: sequenceScript([
			"PASS\n验收 OK\n",
			"FAIL\n\n## 质量检查未通过\n- 问题: 缺少质量验证\n",
			"PASS\n质量已验证\n",
		]),
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "完成并修复质量反馈");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await handlers.get("agent_start")({}, ctx);
	assert(
		!currentWidgetText(state, "goal-progress"),
		`goal activity box competed during quality repair:\n${currentWidgetText(state, "goal-progress")}`,
	);
	const repairWidget = currentWidgetText(state, "review-progress");
	assert(
		repairWidget.includes("💯 目标 · 质量修复中") &&
			!repairWidget.includes("取消"),
		repairWidget || "missing repair widget",
	);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assertGoalBoxClearedBeforeReview(state, "💯 目标 · 第 2 轮质量检查中");
}

async function flowQualityRepairOwnsActivityBoxScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: true },
		review: {
			enabled: true,
			mode: "autoFix",
		},
		command: sequenceScript([
			"PASS\n验收 OK\n",
			"FAIL\n\n## 质量检查未通过\n- 问题: 缺少 Flow 质量验证\n",
			"PASS\n质量已验证\n",
		]),
	});
	const cwd = join(out, "flow-quality-repair-widget");
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
	await handlers.get("agent_start")({}, ctx);
	assert(
		!currentWidgetText(state, "goal-progress"),
		`flow activity box competed during quality repair:\n${currentWidgetText(state, "goal-progress")}`,
	);
	const repairWidget = currentWidgetText(state, "review-progress");
	assert(
		repairWidget.includes("💯 Flow · 质量修复中") &&
			repairWidget.includes("第 1 步 · Login") &&
			!repairWidget.includes("取消"),
		repairWidget || "missing flow repair widget",
	);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assertGoalBoxClearedBeforeReview(state, "💯 Flow · 第 2 轮质量检查中");
}

async function goalQualityRepairResumeOwnsActivityBoxScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: true },
		review: {
			enabled: true,
			mode: "autoFix",
		},
		command: sequenceScript([
			"PASS\n验收 OK\n",
			"FAIL\n\n## 质量检查未通过\n- 问题: 缺少质量验证\n",
		]),
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "恢复后继续修复质量反馈");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "aborted" }] },
		ctx,
	);
	const paused = state.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data.goal;
	assert(paused?.status === "paused", JSON.stringify(paused));
	await commands.get("goal").handler("continue", ctx);
	assert(
		!currentWidgetText(state, "goal-progress"),
		`goal activity box competed after quality repair resume:\n${currentWidgetText(state, "goal-progress")}`,
	);
	const repairWidget = currentWidgetText(state, "review-progress");
	assert(
		repairWidget.includes("💯 目标 · 质量修复中") &&
			!repairWidget.includes("等待质量检查"),
		repairWidget || "missing resumed repair widget",
	);
	assert(
		!state.statuses.some((item) => item?.includes("等待质量检查")),
		state.statuses.join(" | "),
	);
}

async function flowQualityRepairResumeOwnsActivityBoxScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: true },
		review: {
			enabled: true,
			mode: "autoFix",
		},
		command: sequenceScript([
			"PASS\n验收 OK\n",
			"FAIL\n\n## 质量检查未通过\n- 问题: 缺少 Flow 质量验证\n",
		]),
	});
	const cwd = join(out, "flow-quality-repair-resume-widget");
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
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "aborted" }] },
		ctx,
	);
	const paused = state.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data.goal;
	assert(paused?.status === "paused", JSON.stringify(paused));
	const result = await module.resumePausedGoalFromFlow(ctx);
	assert(result === "resumed", result);
	assert(
		!currentWidgetText(state, "goal-progress"),
		`flow activity box competed after quality repair resume:\n${currentWidgetText(state, "goal-progress")}`,
	);
	const repairWidget = currentWidgetText(state, "review-progress");
	assert(
		repairWidget.includes("💯 Flow · 质量修复中") &&
			repairWidget.includes("第 1 步 · Login") &&
			!repairWidget.includes("等待质量检查"),
		repairWidget || "missing resumed flow repair widget",
	);
	assert(
		!state.statuses.some((item) => item?.includes("等待质量检查")),
		state.statuses.join(" | "),
	);
}

async function goalCompletionFactWriteFailurePausesScenario() {
	writeConfig({
		goal: { enabled: false, reviewOnComplete: true },
		review: { enabled: true, mode: "autoFix" },
		command: script("PASS\n质量 OK\n"),
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state);
	await startGoal(commands, ctx, "完成事实必须写入");
	let failCompletionFactWrite = true;
	ctx.sessionManager.appendCustomEntry = (customType, data) => {
		if (customType === "pi-flow-goal-completed" && failCompletionFactWrite)
			throw new Error("disk full");
		state.entries.push({ type: "custom", customType, data });
	};
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const titles = state.messages.map((item) => item.message.details?.title);
	assert(titles.includes("目标完成事实写入失败"), titles.join(" | "));
	assert(!titles.includes("目标已完成"), titles.join(" | "));
	const latestGoalState = state.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data.goal;
	assert(latestGoalState?.status === "paused", JSON.stringify(latestGoalState));
	let artifact = JSON.parse(
		readFileSync(
			join(ctx.cwd, ".flow", "goals", "G1-test", "goal.json"),
			"utf8",
		),
	);
	assert(
		artifact.completionCursor === "finalize_retry",
		artifact.completionCursor,
	);
	assert(
		state.notifications.some((item) =>
			item.includes("目标完成事实写入失败：disk full"),
		),
		state.notifications.join("\n"),
	);
	const messageCount = state.messages.length;
	failCompletionFactWrite = false;
	await commands.get("goal").handler("continue", ctx);
	const retryTitles = state.messages
		.slice(messageCount)
		.map((item) => item.message.details?.title);
	assert(retryTitles.includes("目标已完成"), retryTitles.join(" | "));
	assert(
		!retryTitles.some((title) => title?.includes("质量检查")),
		`finalize retry reran quality check: ${retryTitles.join(" | ")}`,
	);
	artifact = JSON.parse(
		readFileSync(
			join(ctx.cwd, ".flow", "goals", "G1-test", "goal.json"),
			"utf8",
		),
	);
	assert(artifact.completionCursor === null, artifact.completionCursor);
}

function assertGoalReviewUiClearedBeforeQualityReview(state) {
	const goalClear = state.widgets.findIndex(
		(item) => item.key === "goal-progress" && item.content === undefined,
	);
	const reviewSet = state.widgets.findIndex(
		(item) => item.key === "review-progress" && item.content !== undefined,
	);
	assert(goalClear >= 0, "goal review widget was not cleared");
	assert(reviewSet >= 0, "quality review widget was not shown");
	assert(
		goalClear < reviewSet,
		"quality review started before goal review UI cleared",
	);
	const staleGoalStatus = state.statusEntries.findIndex(
		(item) => item.key === "goal" && item.value === undefined,
	);
	const qualityStatus = state.statusEntries.findIndex(
		(item) => item.key === "goal" && item.value?.includes("质量检查"),
	);
	assert(staleGoalStatus >= 0, "goal review status was not cleared");
	assert(qualityStatus >= 0, "quality review status was not shown");
	assert(
		!state.statusEntries.some(
			(item) => item.key === "review" && item.value?.includes("质量检查"),
		),
		"goal completion chain quality review wrote competing review status",
	);
	assert(
		staleGoalStatus < qualityStatus,
		"quality review status started before goal review status cleared",
	);
}

async function flowGoalCompleteCardTitleScenario() {
	const command = captureCommand("PASS\n质量 OK\n");
	writeConfig({
		goal: { enabled: false, reviewOnComplete: true },
		review: { enabled: true },
		command,
	});
	const cwd = join(out, "flow-cwd");
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
	const cards = state.messages.filter((item) => item.message.details);
	const titles = cards.map((item) => item.message.details.title);
	const qualityStartIndex = titles.indexOf("质量检查中");
	const qualityReviewIndex = titles.indexOf("质量检查通过");
	assert(
		!titles.some((title) => title.includes("完成验收")),
		`disabled state review sent a card: ${titles.join(" | ")}`,
	);
	assert(qualityStartIndex >= 0, titles.join(" | "));
	assert(
		cards[qualityStartIndex].message.content.includes("Flow：第 1 步 · Login"),
		cards[qualityStartIndex].message.content,
	);
	assert(
		!cards[qualityStartIndex].message.content.includes("通过后："),
		cards[qualityStartIndex].message.content,
	);
	assert(qualityReviewIndex >= 0, titles.join(" | "));
	assert(
		qualityStartIndex < qualityReviewIndex,
		`flow quality review result came before start card: ${titles.join(" | ")}`,
	);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "Flow 第 1 步 · Login 已完成",
		card.message.details.title,
	);
	assert(
		card.message.content.startsWith("[Flow 第 1 步 · Login 已完成]"),
		card.message.content,
	);
	assert(!card.message.content.includes("⏱ 总用时"), card.message.content);
	assert(
		card.message.details.lines.join("\n").includes("⏱ 总用时：当前步骤") &&
			card.message.details.lines.join("\n").includes("/ Flow 总"),
		card.message.details.lines.join("\n"),
	);
	assert(
		state.statuses.some(
			(item) =>
				item?.startsWith("🌊 flow/第 1 步 · Login/目标进行中 · ") &&
				item.includes("/ 总"),
		),
		state.statuses.join(" | "),
	);
	const goalWidgets = widgetTexts(state, "goal-progress");
	assert(
		goalWidgets.some(
			(text) =>
				text.includes("🌊 Flow · 执行中") &&
				text.includes("第 1 步 · Login") &&
				text.includes("进度：1/1") &&
				!text.includes("步骤：第 1 步 · Login") &&
				!text.includes("后续："),
		),
		goalWidgets.join("\n---\n"),
	);
	const reviewWidgets = widgetTexts(state, "review-progress");
	assert(
		reviewWidgets.some(
			(text) =>
				text.includes("💯 Flow · 质量检查中") &&
				text.includes("第 1 步 · Login") &&
				!text.includes("步骤：第 1 步 · Login"),
		),
		reviewWidgets.join("\n---\n"),
	);
	assert(
		state.statuses.some(
			(item) =>
				item?.startsWith("🌊 flow/第 1 步 · Login/质量检查 · ") &&
				item.includes("/ 总"),
		),
		state.statuses.join(" | "),
	);
	assert(
		!state.statusEntries.some(
			(item) => item.key === "review" && item.value?.includes("质量检查"),
		),
		"flow goal quality review wrote competing review status",
	);
	const args = readFileSync(`${command}.args`, "utf8");
	assert(args.includes("计划（.flow/flows/F1-login/G1-login.md）："), args);
	assert(args.includes("Flow plan proof."), args);
	const completion = state.entries.findLast(
		(entry) => entry.customType === "pi-flow-goal-completed",
	);
	assert(completion, "flow completion fact missing");
	const factChecks = completion.data.checks;
	assert(factChecks, "completion fact missing checks snapshot");
	assert(
		factChecks.acceptance.enabled === false &&
			factChecks.quality.enabled === true &&
			factChecks.quality.rounds.length === 1 &&
			factChecks.quality.rounds[0].result === "passed" &&
			factChecks.acceptance.active === null &&
			factChecks.quality.active === null,
		JSON.stringify(factChecks),
	);
}

async function persistedGoalLoadedBeforeAgentEndScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const cwd = join(out, "flow-persisted-cwd");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const now = Date.now();
	const state = createState();
	state.entries.push({
		type: "custom",
		customType: "goal-state",
		data: {
			goal: {
				id: "persisted-goal",
				text: "Flow Goal session 已启动。\n\n当前 Goal plan 完整 snapshot：\n\n# giant",
				status: "active",
				startedAt: now,
				updatedAt: now,
				iteration: 0,
				stateReviewRounds: 0,
				stateReviewHistory: [],
				tokensUsed: 0,
				timeUsedSeconds: 0,
				baselineTokens: 0,
				stepStartedAt: now,
			},
		},
	});
	const { handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await handlers.get("agent_start")({}, ctx);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "Flow 第 1 步 · Login 已完成",
		card.message.details.title,
	);
	assert(!card.message.content.includes("完整 snapshot"), card.message.content);
}

function writeConfig(overrides) {
	mkdirSync(out, { recursive: true });
	const command = overrides.command ?? script("PASS\nOK\n");
	const goal = overrides.goal ?? {};
	const review = overrides.review ?? {};
	const model = { model: "test/gpt-5.4-mini", thinking: "off" };
	const config = {
		...(overrides.language === undefined
			? {}
			: { language: overrides.language }),
		runner: {
			command,
			tools: [],
			excludeTools: [],
			timeoutMs: overrides.timeoutMs ?? 5000,
			extensions: [],
		},
		models: overrides.models ?? goal.models ?? review.models ?? [model],
		acceptance: {
			enabled: goal.enabled ?? false,
		},
		quality: {
			enabled: review.enabled ?? false,
			mode: qualityMode(review.mode),
			runAfterCompletion: goal.reviewOnComplete ?? false,
		},
	};
	writeFileSync(join(out, "config.json"), JSON.stringify(config));
}

function qualityMode(mode) {
	return mode ?? "autoFix";
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
	return countedScript(outputs, "*) exit 9 ;;");
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
	const goalExtension = module.default;
	const commands = new Map();
	const tools = new Map();
	const handlers = new Map();
	goalExtension({
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
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
			assert(
				!state.inAgentEnd,
				`custom message sent before agent_end returned: ${message.details?.title ?? message.customType}`,
			);
			assert(
				!state.streaming,
				`custom message sent while streaming: ${message.details?.title ?? message.customType}`,
			);
			if (message.details?.title) state.messages.push({ message, options });
		},
		on(name, handler) {
			if (name !== "agent_end") return handlers.set(name, handler);
			handlers.set(name, async (...args) => {
				state.inAgentEnd = true;
				state.streaming = true;
				try {
					await handler(...args);
				} finally {
					state.inAgentEnd = false;
					state.streaming = false;
				}
				await module.waitForScheduledGoalStateReview();
			});
		},
	});
	return { commands, tools, handlers, module };
}

function fileToolEntry(path) {
	return {
		type: "message",
		id: `tool-${Math.random().toString(16).slice(2)}`,
		parentId: null,
		timestamp: new Date("2026-01-01T00:00:02.000Z").toISOString(),
		message: {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "read-1",
					name: "read",
					arguments: { path },
				},
			],
			provider: "test",
			model: "test",
			stopReason: "toolUse",
			timestamp: Date.parse("2026-01-01T00:00:02.000Z"),
		},
	};
}

function createState() {
	return {
		entries: [],
		messages: [],
		sentMessages: [],
		notifications: [],
		statuses: [],
		statusEntries: [],
		widgets: [],
		inAgentEnd: false,
		streaming: false,
		onReviewWidgetShown: undefined,
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
			setStatus(key, value) {
				state.statuses.push(value);
				state.statusEntries.push({ key, value });
			},
			setWorkingVisible() {},
			setEditorText(text) {
				state.editorText = text;
			},
			setWidget(key, content) {
				state.widgets.push({ key, content });
				if (key === "review-progress" && content) state.onReviewWidgetShown?.();
			},
		},
		isIdle() {
			return !state.streaming;
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
		},
	};
}

function latestWidgetText(state) {
	return widgetTexts(state).at(-1) ?? "";
}

function currentWidgetText(state, key) {
	const entry = [...(state.widgets ?? [])]
		.reverse()
		.find((item) => item.key === key);
	return widgetText(entry?.content);
}

function assertGoalBoxClearedBeforeReview(state, reviewTitle) {
	const reviewIndex = state.widgets.findIndex(
		(item) =>
			item.key === "review-progress" &&
			widgetText(item.content).includes(reviewTitle),
	);
	assert(reviewIndex >= 0, `missing review widget: ${reviewTitle}`);
	const previousGoal = state.widgets
		.slice(0, reviewIndex)
		.reverse()
		.find((item) => item.key === "goal-progress");
	assert(
		!previousGoal || previousGoal.content === undefined,
		`goal widget was active before ${reviewTitle}:\n${widgetText(previousGoal?.content)}`,
	);
}

function widgetTexts(state, key) {
	return (state.widgets ?? [])
		.filter((item) => !key || item.key === key)
		.map((item) => widgetText(item.content))
		.filter(Boolean);
}

function widgetText(content) {
	const widget =
		typeof content === "function"
			? content(undefined, { fg: (_color, value) => value })
			: content;
	return widget?.render ? widget.render(120).join("\n") : "";
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
	assert(!timer.cleared, `timer already cleared: ${timer.delay}`);
	timer.cleared = true;
	timer.callback(...timer.args);
	await Promise.resolve();
	await Promise.resolve();
}

async function interruptedReviewDoesNotLeakIntoNextGoalScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: false },
		command: shellScript("sleep 2"),
		timeoutMs: 5000,
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const firstCwd = join(out, "leak-first");
	const firstCtx = mockContext(state, firstCwd);
	await startGoal(commands, firstCtx, "第一个目标");
	const pendingReview = handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		firstCtx,
	);
	const firstGoalJson = join(
		firstCwd,
		".flow",
		"goals",
		"G1-test",
		"goal.json",
	);
	await waitFor(
		() =>
			JSON.parse(readFileSync(firstGoalJson, "utf8")).checks?.acceptance.active,
		"state review never published live progress",
	);
	handlers.get("session_shutdown")({}, firstCtx);
	await pendingReview;
	const first = JSON.parse(readFileSync(firstGoalJson, "utf8"));
	assert(
		first.checks.acceptance.active === null &&
			first.checks.quality.active === null,
		`shutdown left live review on disk: ${JSON.stringify(first.checks)}`,
	);
	const firstHtml = readFileSync(
		join(firstCwd, ".flow", "goals", "G1-test", "goal.html"),
		"utf8",
	);
	assert(!firstHtml.includes("检查中"), "shutdown left 检查中 in goal.html");

	const secondState = createState();
	const secondCwd = join(out, "leak-second");
	const secondCtx = mockContext(secondState, secondCwd);
	handlers.get("session_start")({}, secondCtx);
	await startGoal(commands, secondCtx, "第二个目标");
	const second = JSON.parse(
		readFileSync(
			join(secondCwd, ".flow", "goals", "G1-test", "goal.json"),
			"utf8",
		),
	);
	assert(second.checks, "second goal missing checks");
	assert(
		second.checks.acceptance.active === null,
		`stale state review leaked: ${JSON.stringify(second.checks.acceptance.active)}`,
	);
	assert(
		second.checks.quality.active === null,
		`stale quality review leaked: ${JSON.stringify(second.checks.quality.active)}`,
	);
	assert(
		second.checks.acceptance.rounds.length === 0,
		`stale rounds leaked: ${JSON.stringify(second.checks.acceptance.rounds)}`,
	);
}

async function flowLiveReviewsSyncScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: false },
		command: shellScript("sleep 2"),
		timeoutMs: 5000,
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
	const flowJson = join(cwd, ".flow", "flows", "F1-login", "flow.json");
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
		join(cwd, ".flow", "flows", "F1-login", "flow.html"),
		"utf8",
	);
	assert(
		!html.includes("检查中"),
		"flow.html kept stale 检查中 after shutdown",
	);
}

async function flowGoalStateReviewUsesFlowStartedAtScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: false },
		command: script("PASS\nFlow OK\n"),
	});
	const cwd = join(out, "flow-state-review-time");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const flowJson = join(cwd, ".flow", "flows", "F1-login", "flow.json");
	const flow = JSON.parse(readFileSync(flowJson, "utf8"));
	const now = Date.now();
	flow.startedAt = now - 120_000;
	writeFileSync(flowJson, JSON.stringify(flow, null, 2));
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	const originalNow = Date.now;
	Date.now = () => now;
	try {
		await module.startGoalFromFlow("Flow timed objective", ctx);
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	} finally {
		Date.now = originalNow;
	}
	const stateReviewStatus = state.statuses.find((item) =>
		item?.startsWith("🌊 flow/第 1 步 · Login/完成验收 · "),
	);
	assert(stateReviewStatus, state.statuses.join(" | "));
	assert(stateReviewStatus.includes("/ 总 2m"), stateReviewStatus);
	const card = state.messages.find(
		(item) => item.message.details?.title === "完成验收通过",
	);
	assert(card, "missing flow goal state review pass card");
	assert(!card.message.content.includes("⏱ 用时"), card.message.content);
	assert(
		card.message.details.lines.join("\n").includes("⏱ 用时：0s / 总 2m"),
		card.message.details.lines.join("\n"),
	);
}

async function abortedAgentEndPausesGoalScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const ctx = mockContext(state, join(out, "aborted-pause"));
	await startGoal(commands, ctx, "中断暂停");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "aborted" }] },
		ctx,
	);
	assert(
		state.notifications.some((item) =>
			item.includes("目标已因执行中断暂停。运行 /goal continue 继续。"),
		),
		state.notifications.join("\n"),
	);
}

async function flowMissingStartedAtFailsClosedScenario() {
	writeConfig({ goal: { enabled: false, reviewOnComplete: false } });
	const cwd = join(out, "flow-missing-started-at-cwd");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const flowPath = join(cwd, ".flow", "flows", "F1-login", "flow.json");
	const flow = JSON.parse(readFileSync(flowPath, "utf8"));
	flow.startedAt = null;
	writeFileSync(flowPath, `${JSON.stringify(flow, null, 2)}\n`);
	const state = createState();
	const { module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	let errorMessage = "";
	try {
		await module.startGoalFromFlow("Flow objective", ctx);
	} catch (error) {
		errorMessage = error instanceof Error ? error.message : String(error);
	}
	assert(errorMessage.includes("running Flow 缺少 startedAt"), errorMessage);
	assert(
		!state.statuses.some((item) => item?.startsWith("🎯 goal/")),
		state.statuses.join(" | "),
	);
}

async function flowCancelDuringReviewScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: false },
		command: shellScript("sleep 2"),
		timeoutMs: 5000,
	});
	const cwd = join(out, "flow-cancel-review");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	// cancelFlow 走完整校验：补成合法两步 flow（执行步 + 最终验收）。
	const flowDir = join(cwd, ".flow", "flows", "F1-login");
	const cancelFlowState = JSON.parse(
		readFileSync(join(flowDir, "flow.json"), "utf8"),
	);
	cancelFlowState.goals.push({
		...cancelFlowState.goals[0],
		index: 1,
		title: "Final",
		role: "final_acceptance",
		file: "G2-final.md",
		status: "pending",
		sessionFile: null,
	});
	writeFileSync(
		join(flowDir, "flow.json"),
		JSON.stringify(cancelFlowState, null, 2),
	);
	const flowPlanMd = (title) =>
		`# ${title}\n\n## Objective\n${title}\n\n## Scope\nOnly this.\n\n## Steps\n- [ ] Do work.\n\n## Success Criteria\n- Done.\n\n## Verification\n- [ ] manual\n\n## Notes\n\n## Handoff\n`;
	writeFileSync(join(flowDir, "G1-login.md"), flowPlanMd("Login"));
	writeFileSync(join(flowDir, "G2-final.md"), flowPlanMd("Final"));
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow cancel objective", ctx);
	const pendingReview = handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const flowJson = join(cwd, ".flow", "flows", "F1-login", "flow.json");
	await waitFor(
		() =>
			JSON.parse(readFileSync(flowJson, "utf8")).goals[0].checks?.acceptance
				.active,
		"flow.json never received live review progress",
	);
	const { cancelFlow } = await import(
		`file://${join(srcOut, "flow/execution.js")}?t=${Date.now()}`
	);
	await cancelFlow(ctx);
	await pendingReview;
	const flow = JSON.parse(readFileSync(flowJson, "utf8"));
	assert(
		flow.status === "cancelled",
		`${flow.status} | ${state.notifications.join(" || ")}`,
	);
	assert(
		flow.goals[0].checks.acceptance.active === null,
		`cancel left live review in flow.json: ${JSON.stringify(flow.goals[0].checks.acceptance.active)}`,
	);
	const html = readFileSync(
		join(cwd, ".flow", "flows", "F1-login", "flow.html"),
		"utf8",
	);
	assert(!html.includes("检查中"), "flow.html kept stale 检查中 after cancel");
}

async function cancelDuringReviewDoesNotCrashScenario() {
	writeConfig({
		goal: { enabled: true, reviewOnComplete: false },
		command: shellScript("sleep 2"),
		timeoutMs: 5000,
	});
	const state = createState();
	const { commands, handlers } = await loadGoalExtension(state);
	const cwd = join(out, "cancel-during-review");
	const ctx = mockContext(state, cwd);
	await startGoal(commands, ctx, "检查中被清除");
	const pendingReview = handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const goalJson = join(cwd, ".flow", "goals", "G1-test", "goal.json");
	await waitFor(
		() => JSON.parse(readFileSync(goalJson, "utf8")).checks?.acceptance.active,
		"state review never published live progress",
	);
	await commands.get("goal").handler("cancel", ctx);
	await pendingReview;
	const artifact = JSON.parse(readFileSync(goalJson, "utf8"));
	assert(artifact.status === "cancelled", artifact.status);
	assert(
		artifact.checks.acceptance.active === null,
		`cleared goal kept live review: ${JSON.stringify(artifact.checks.acceptance.active)}`,
	);
	assert(
		state.notifications.some((item) => item.includes("目标已取消")),
		state.notifications.join("\n"),
	);
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
	const { validateGoalDir } = await import(
		`file://${join(srcOut, "goal/validator.js")}?t=${Date.now()}`
	);
	const dir = join(out, "checks-validation", ".flow", "goals", "G1-checks");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "plan.md"),
		"# t\n\n## Objective\nt\n\n## Scope\ns\n\n## Steps\n- [ ] a\n\n## Success Criteria\n- c\n\n## Verification\n- [ ] v\n\n## Notes\n\n## Outcome\n",
	);
	const base = {
		schemaVersion: 5,
		language: "zh",
		id: "G1-checks",
		title: "t",
		status: "draft",
		completionCursor: null,
		source: { type: "prompt", path: null, originalRequest: "r" },
		createdAt: 1,
		updatedAt: 1,
		repairAttempts: 0,
		errors: [],
		sessionFile: null,
		sessionName: null,
		snapshot: null,
		snapshotHash: null,
		runtimeGoalId: null,
		result: { summary: null, outcome: null },
	};
	const write = (checks) =>
		writeFileSync(join(dir, "goal.json"), JSON.stringify({ ...base, checks }));

	write({});
	const bad = validateGoalDir(dir);
	assert(!bad.ok, "empty checks object passed validation");
	assert(
		bad.errors.some((error) => error.includes("checks.acceptance")),
		bad.errors.join(" | "),
	);
	let draftFailed = false;
	try {
		execFileSync("node", [join(root, "scripts/validate-draft.mjs"), dir], {
			stdio: "pipe",
		});
	} catch (error) {
		draftFailed = true;
		assert(
			String(error.stderr).includes("checks.acceptance"),
			String(error.stderr),
		);
	}
	assert(draftFailed, "validate-draft.mjs accepted empty checks object");

	write({
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result: "failed", summary: "s" }],
			active: [{ label: "m", status: "running" }],
		},
		quality: { enabled: false, rounds: [], active: null },
	});
	const good = validateGoalDir(dir);
	assert(good.ok, good.errors.join(" | "));

	write({
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result: "error", summary: "review crashed" }],
			active: null,
		},
		quality: { enabled: false, rounds: [], active: null },
	});
	const errorRound = validateGoalDir(dir);
	assert(
		errorRound.ok,
		`goal review error round rejected: ${errorRound.errors.join(" | ")}`,
	);

	write({
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result: "maybe", summary: "s" }],
			active: [{ label: "", status: "odd" }],
		},
		quality: { enabled: "yes", rounds: {}, active: [] },
	});
	const invalid = validateGoalDir(dir);
	assert(!invalid.ok, "invalid checks payload passed validation");
	for (const fragment of [
		"checks.acceptance.rounds[0].result",
		"checks.acceptance.active[0].label",
		"checks.acceptance.active[0].status",
		"checks.quality.enabled",
		"checks.quality.rounds",
	])
		assert(
			invalid.errors.some((error) => error.includes(fragment)),
			`${fragment} not rejected: ${invalid.errors.join(" | ")}`,
		);
}

function emptyChecks() {
	return {
		acceptance: { enabled: true, rounds: [], active: null },
		quality: { enabled: true, rounds: [], active: null },
	};
}

async function startGoal(commands, ctx, objective, language = "zh") {
	const dir = join(ctx.cwd, ".flow", "goals", "G1-test");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "goal.json"),
		`${JSON.stringify(
			{
				schemaVersion: 5,
				language,
				id: "G1-test",
				title: objective,
				status: "draft",
				completionCursor: null,
				source: { type: "prompt", path: null, originalRequest: objective },
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
				checks: emptyChecks(),
			},
			null,
			2,
		)}\n`,
	);
	writeFileSync(
		join(dir, "plan.md"),
		`# ${objective}\n\n## Objective\n${objective}\n\n## Scope\nTest scope.\n\n## Steps\n- [ ] Run work.\n\n## Success Criteria\n- Done.\n\n## Verification\n- [ ] manual\n\n## Notes\n\n## Outcome\n`,
	);
	await commands.get("goal").handler("start G1-test", ctx);
}

function writeFlow(cwd, sessionFile) {
	const dir = join(cwd, ".flow", "flows", "F1-login");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "G1-login.md"),
		"# Login\n\n## Objective\nFlow objective\n\n## Scope\nFlow scope.\n\n## Steps\n- [x] Ship login.\n\n## Success Criteria\n- Flow plan proof.\n\n## Verification\n- [x] test\n\n## Notes\n\n## Handoff\n",
	);
	writeFileSync(
		join(dir, "flow.json"),
		`${JSON.stringify(
			{
				schemaVersion: 5,
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

function hasChinese(text) {
	return /[\u4e00-\u9fff]/u.test(text);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
