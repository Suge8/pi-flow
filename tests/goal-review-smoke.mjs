import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-goal-review-test-${runId}`);
process.env.PI_CODING_AGENT_DIR = join(out, "agent-state");
// 断言是中文文案；固定运行时语言，避免 standalone goal 回落机器 locale 导致环境相关失败。
process.env.PI_FLOW_LANGUAGE = "zh";
const defaultCwd = join(out, "project");
const srcOut = join(out, "dist");
const bin = join(out, "bin");
const diagnosticRouters = new Map();

rmSync(out, { recursive: true, force: true });
mkdirSync(bin, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
cpSync(join(root, "prompts"), join(out, "prompts"), { recursive: true });
prepareTestDist(root, srcOut);

try {
	await runScenario(promptContractScenario);
	await runScenario(reviewFormatScenario);
	await runScenario(reviewAggregateKeepsPassedDetailsScenario);
	await runScenario(checksValidationScenario);
	await runScenario(checkRunRecoveryRulesScenario);
	await runScenario(checkDisciplineHelpersScenario);
	await runScenario(flowAcceptancePromptIncludesPlanScenario);
	await runScenario(flowAcceptanceExcludesForkPrefixScenario);
	await runScenario(flowAcceptanceLiveProgressScenario);
	await runScenario(flowAcceptancePlanChangeNoteScenario);
	await runScenario(flowAcceptanceMissingEvidencePausesScenario);
	await runScenario(flowContinuationTodoReminderScenario);
	await runScenario(flowAcceptanceTodoGateScenario);
	await runScenario(flowAcceptanceTodoGateDeliveryScenario);
	await runScenario(flowRevisionPermissionInjectionTimingScenario);
	await runScenario(flowAcceptanceAdvisorConsultScenario);
	await runScenario(flowAcceptanceAdvisorReceiptRecoveryScenario);
	await runScenario(flowAcceptanceAdvisorEscScenario);
	await runScenario(flowAdvisorReceivesCompleteFailureHistoryScenario);
	await runScenario(manualAdvisorNoFailureScenario);
	await runScenario(manualAdvisorDisabledScenario);
	await runScenario(manualAdvisorPersistentDeliveryScenario);
	await runScenario(manualAdvisorActiveDeliveryPrecedesRepairCursorScenario);
	await runScenario(manualAdvisorEscScenario);
	await runScenario(flowBlockedOnUserScenario);
	await runScenario(flowBlockedOnUserHtmlFailureScenario);
	await runScenario(flowBlockedOnUserLockRecoveryScenario);
	await runScenario(flowCheckboxAttributionScenario);
	await runScenario(flowCheckboxCountChangeAttributionScenario);
	await runScenario(flowCheckboxAttributionLockRecoveryScenario);
	await runScenario(workerCheckboxAttributionScenario);
	await runScenario(workerAcceptanceConfigErrorHandoffScenario);
	await runScenario(workerAcceptanceHardCapHandoffScenario);
	await runScenario(flowQualityAdvisorConsultScenario);
	await runScenario(flowAdvisorFailureDoesNotBlockScenario);
	await runScenario(flowAdvisorStopDuringConsultScenario);
	await runScenario(flowQualityAdvisorStopDuringConsultScenario);
	await runScenario(flowQualityRevisionPermissionScenario);
	await runScenario(flowAcceptanceCancelHasSingleSurfaceScenario);
	await runScenario(flowQualityCancelHasSingleSurfaceScenario);
	await runScenario(flowAcceptanceConfigErrorPausesCleanlyScenario);
	await runScenario(flowAcceptanceContextModelFailurePausesScenario);
	await runScenario(flowQualityConfigErrorPausesCleanlyScenario);
	await runScenario(flowAcceptanceConfigErrorPauseRespectsFlowLockScenario);
	await runScenario(flowQualityMidLoopConfigErrorPausesScenario);
	await runScenario(flowQualityRepairCursorSurvivesAbortScenario);
	await runScenario(flowCheckHardCapPausesScenario);
	await runScenario(flowAcceptanceHardCapDeliveryFailureScenario);
	await runScenario(flowQualityHardCapDeliveryFailureScenario);
	await runScenario(flowConnectionNoticeFormatScenario);
	await runScenario(flowRetryExhaustionHasSingleSurfaceScenario);
	await runScenario(goalConnectionNoticeFormatScenario);
	await runScenario(goalArtifactSaveFailureNoticeFormatScenario);
	await runScenario(flowAcceptanceSystemErrorNoticeFormatScenario);
	await runScenario(flowAcceptanceSystemErrorDeliveryFailureScenario);
	await runScenario(flowLiveReviewsSyncScenario);
	await runScenario(flowAcceptanceResumesMissingReviewerScenario);
	await runScenario(flowBusyRestartResumesOnAgentEndScenario);
	await runScenario(flowAcceptanceDeliveryFailureRetriesAfterRestartScenario);
	await runScenario(
		flowAcceptancePassDeliveryFailureRetriesAfterRestartScenario,
	);
	await runScenario(flowQualityDeliveryFailureRetriesAfterRestartScenario);
	await runScenario(flowAcceptancePostDeliveryLockFailureScenario);
	await runScenario(flowQualityPostDeliveryLockFailureScenario);
	await runScenario(flowAcceptanceCanonicalReconciliationScenario);
	await runScenario(flowQualityCanonicalReconciliationScenario);
	await runScenario(flowInterruptedRepairShowsRecoveryHintScenario);
	await runScenario(flowRepairAgentEndResumesQualityScenario);
	await runScenario(flowLiveReviewLockBusyNotifiesScenario);
	await runScenario(flowGoalCompleteWithQualityReviewScenario);
	await runScenario(flowQualityFailThenPassPersistsBothRoundsScenario);
	await runScenario(flowQualityPassCursorSurvivesCrashBeforeFinalizeScenario);
	await runScenario(flowQualityPassPersistsIgnoredReviewerScenario);
	await runScenario(flowHtmlKeepsFullModelFeedbackScenario);
	await runScenario(flowQualityReviewFailureUsesFlowContinueScenario);
	await runScenario(flowAcceptanceWritesRespectFlowLockScenario);
	await runScenario(flowRuntimeWritesRespectFlowLockScenario);
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

async function attentionProbe() {
	const { piAttentionSignal } = await import(
		`file://${join(srcOut, "shared/activity-signal.js")}`
	);
	const sources = [];
	return {
		sources,
		unsubscribe: piAttentionSignal().subscribe((request) =>
			sources.push(request.source),
		),
	};
}

async function activityProbe() {
	const { piActivitySignal } = await import(
		`file://${join(srcOut, "shared/activity-signal.js")}`
	);
	const states = [];
	return {
		states,
		unsubscribe: piActivitySignal().subscribe((state) => states.push(state)),
	};
}

function acceptanceActivityStarted(probe) {
	return probe.states.some((state) =>
		state.sources.some((source) => source.startsWith("pi-flow:audit:")),
	);
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
	const englishGoalPrompt = readFileSync(
		join(root, "prompts", "en", "goal-audit.md"),
		"utf8",
	);
	const englishReviewPrompt = readFileSync(
		join(root, "prompts", "en", "review.md"),
		"utf8",
	);
	const advisorPrompt = readFileSync(
		join(root, "prompts", "zh", "advisor.md"),
		"utf8",
	);
	const englishAdvisorPrompt = readFileSync(
		join(root, "prompts", "en", "advisor.md"),
		"utf8",
	);
	assert(goalPrompt.includes("# 验收"), goalPrompt);
	assert(goalPrompt.includes("第一行只能是：PASS 或 FAIL"), goalPrompt);
	assert(goalPrompt.includes("输出契约"), goalPrompt);
	assert(reviewPrompt.includes("第一行只能是：PASS 或 FAIL"), reviewPrompt);
	assert(reviewPrompt.includes("输出契约"), reviewPrompt);
	assert(!goalPrompt.includes("任务：验收"), goalPrompt);
	assert(!goalPrompt.includes("工具安全"), goalPrompt);
	assert(
		reviewPrompt.includes("先写一句极简质检摘要") &&
			reviewPrompt.includes("证据锚点") &&
			reviewPrompt.includes("只有低严重度改善建议时必须 PASS") &&
			reviewPrompt.includes("必须实际读取与本次变更相关的源码文件"),
		reviewPrompt,
	);
	assert(
		goalPrompt.includes("证据锚点") &&
			goalPrompt.includes("锚定到具体目标要求") &&
			goalPrompt.includes("由后续质检负责") &&
			goalPrompt.includes("顾问建议不是验收证据"),
		goalPrompt,
	);
	assert(reviewPrompt.includes("顾问建议不是质检证据"), reviewPrompt);
	assert(
		advisorPrompt.includes("根因结论：") &&
			advisorPrompt.includes("系统临时目录") &&
			advisorPrompt.includes("不得通过 bash 绕过 write/edit") &&
			advisorPrompt.includes("Context Evidence"),
		advisorPrompt,
	);
	assert(
		englishAdvisorPrompt.includes("Root-cause conclusion:") &&
			englishAdvisorPrompt.includes("system temporary directory") &&
			englishAdvisorPrompt.includes("Never use bash to bypass"),
		englishAdvisorPrompt,
	);
	const concurrentRule =
		"证实文件在验证期间被并行修改时，丢弃该次结果；读取最新文件后重跑，以最后一次完整结果为准。";
	assert(goalPrompt.includes(concurrentRule), goalPrompt);
	assert(reviewPrompt.includes(concurrentRule), reviewPrompt);
	const englishConcurrentRule =
		"When files are confirmed to have changed concurrently during verification, discard that result; reread the latest files and rerun, using the latest complete result.";
	assert(englishGoalPrompt.includes(englishConcurrentRule), englishGoalPrompt);
	assert(
		englishReviewPrompt.includes(englishConcurrentRule),
		englishReviewPrompt,
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

async function reviewAggregateKeepsPassedDetailsScenario() {
	const { aggregateReviewOutcomes } = await import(
		`file://${join(srcOut, "review/aggregate.js")}?t=${Date.now()}`
	);
	const passedTail =
		"通过模型尾部唯一完整输出 npm run check node dist/validate-draft.js";
	const outcome = aggregateReviewOutcomes(
		[
			{
				index: 0,
				label: "gpt-5.4",
				status: "failed",
				reviewer: { model: "openai/gpt-5.4" },
				result: {
					kind: "needs_changes",
					review: "FAIL\n\n## 发现 1\n- 问题: 失败模型完整反馈",
				},
			},
			{
				index: 1,
				label: "gpt-5.4-mini",
				status: "passed",
				reviewer: { model: "openai/gpt-5.4-mini" },
				result: { kind: "pass", summary: passedTail },
			},
		],
		"zh",
	);
	assert(outcome.kind === "needs_changes", JSON.stringify(outcome));
	assert(outcome.review.includes("失败模型完整反馈"), outcome.review);
	assert(!outcome.review.includes(passedTail), outcome.review);
	assert(outcome.details?.includes("模型 2 · gpt-5.4-mini"), outcome.details);
	assert(outcome.details?.includes(passedTail), outcome.details);
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
				active: {
					round: 2,
					generation: "generation",
					runId: "run-1",
					inputHash: "input",
					models: [
						{
							key: "reviewer",
							label: "reviewer",
							outcome: null,
						},
					],
				},
			},
			quality: { enabled: false, rounds: [], active: null },
		},
		errors,
	);
	assert(errors.length === 0, `valid check error round rejected: ${errors}`);
}

async function checkRunRecoveryRulesScenario() {
	const { settleCheckModel, startCheckRun } = await import(
		`file://${join(srcOut, "shared/check-run.js")}?t=${Date.now()}`
	);
	const reviewer = (model, thinking = "off") => ({
		model,
		thinking,
		command: "pi",
		tools: ["read"],
		excludeTools: ["write", "edit"],
		timeoutMs: 1000,
		openaiFast: false,
		extensions: [],
	});
	const first = startCheckRun(null, 1, "same-input", [
		reviewer("test/a"),
		reviewer("test/b"),
	]);
	const settled = settleCheckModel(first, first.generation, 0, {
		result: "passed",
		summary: "A passed",
		details: "PASS\nA passed",
	});
	assert(settled, "current generation result was rejected");
	assert(
		settleCheckModel(first, "stale-generation", 0, {
			result: "passed",
			summary: "stale",
			details: "stale",
		}) === undefined,
		"stale generation result was accepted",
	);
	const sameReviewers = startCheckRun(settled, 1, "same-input", [
		reviewer("test/a"),
		reviewer("test/b"),
	]);
	assert(sameReviewers.runId === settled.runId, "same run lost its receipt id");
	const resumed = startCheckRun(settled, 1, "same-input", [
		reviewer("test/a"),
		reviewer("test/c"),
	]);
	assert(
		resumed.models[0].outcome?.summary === "A passed" &&
			resumed.models[1].outcome === null &&
			resumed.runId !== settled.runId,
		JSON.stringify(resumed),
	);
	const changedInput = startCheckRun(resumed, 1, "changed-input", [
		reviewer("test/a"),
		reviewer("test/c"),
	]);
	assert(
		changedInput.models.every((model) => model.outcome === null),
		JSON.stringify(changedInput),
	);
}

async function flowAcceptancePromptIncludesPlanScenario() {
	const command = captureCommand(
		"PASS\n验收 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-plan");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	const longObjective = `Flow objective ${"extra ".repeat(40)}`;
	await module.startGoalFromFlow(longObjective, ctx);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const args = readFileSync(`${command}.args`, "utf8");
	assert(args.includes("计划（"), args);
	assert(args.includes("上下文证据："), args);
	assert(args.includes("来源：原始 getBranch() 事件"), args);
	assert(args.includes("Coverage："), args);
	assert(!args.includes("相关文件线索："), args);
	assert(args.includes(".flow/F1/G1-login.md"), args);
	assert(args.includes("## Success Criteria\n- Flow plan proof."), args);
	assert(!args.includes("计划修订检测"), "unchanged plan injected change note");
	const flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.acceptance.rounds[0].summary === "验收 OK" &&
			flow.goals[0].checks.acceptance.rounds[0].details.includes("验收 OK"),
		JSON.stringify(flow.goals[0].checks),
	);
	const acceptanceStartCard = state.messages.find(
		(item) => item.message.details?.title === "验收中",
	);
	assert(acceptanceStartCard, "acceptance start card missing");
	const acceptanceGoalLine = acceptanceStartCard.message.details.lines.find(
		(line) => line.startsWith("目标："),
	);
	assert(
		acceptanceStartCard.message.details.lines.includes("Flow：Login") &&
			!acceptanceStartCard.message.details.lines
				.join("\n")
				.includes("第 1 步") &&
			acceptanceGoalLine?.endsWith("…") &&
			acceptanceGoalLine.length <= 123,
		acceptanceStartCard.message.details.lines.join(" | "),
	);
	const acceptanceCard = state.messages.find(
		(item) => item.message.details?.title === "验收通过",
	);
	assert(acceptanceCard, "acceptance pass card missing");
	assertFooterLayout(acceptanceCard.message.details.lines, "⏱ 用时：");
}

async function flowAcceptanceExcludesForkPrefixScenario() {
	const command = captureCommand(
		"PASS\n验收 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-fork-prefix");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	// fork 会话：前缀是计划期对话，goal 创建时的 leaf 即证据锚点。
	state.entries.push(
		{
			type: "message",
			id: "prefix-1",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: {
				role: "user",
				content: [{ type: "text", text: "PLAN-PREFIX-MARKER exploration" }],
			},
		},
		{
			type: "message",
			id: "anchor-1",
			parentId: "prefix-1",
			timestamp: new Date().toISOString(),
			message: {
				role: "assistant",
				content: [{ type: "text", text: "plan ready" }],
			},
		},
	);
	ctx.sessionManager.getLeafId = () => state.entries.at(-1)?.id ?? null;
	await module.startGoalFromFlow("Flow objective", ctx);
	// 锚点之后的执行期事实：必须进入评审证据。
	state.entries.push({
		type: "message",
		id: "exec-1",
		parentId: state.entries.at(-1)?.id ?? null,
		timestamp: new Date().toISOString(),
		message: {
			role: "user",
			content: [{ type: "text", text: "EXEC-EVIDENCE-MARKER please also log" }],
		},
	});
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const args = readFileSync(`${command}.args`, "utf8");
	assert(
		args.includes("EXEC-EVIDENCE-MARKER"),
		`execution-phase evidence missing from review prompt: ${args.slice(0, 400)}`,
	);
	assert(
		!args.includes("PLAN-PREFIX-MARKER"),
		"fork prefix leaked into review evidence",
	);
	const goalEntry = state.entries
		.filter((entry) => entry.customType === "goal-state" && entry.data?.goal)
		.at(-1);
	assert(
		goalEntry?.data?.goal?.sessionAnchorId === "anchor-1",
		`goal did not persist the evidence anchor: ${goalEntry?.data?.goal?.sessionAnchorId}`,
	);
}

async function flowAcceptanceLiveProgressScenario() {
	const cwd = join(out, "flow-acceptance-live-progress");
	const sessionFile = join(cwd, "goal-session.jsonl");
	const command = jsonEventCommand(
		assistantProgressEvents(
			"PASS\n验收 OK\n证据：文件=src/acceptance.ts；命令=npm test\n",
			"src/acceptance.ts",
		),
	);
	writeConfig({ acceptance: true, quality: false, command });
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	const { activeProgressSnapshot } = await import(
		`file://${join(srcOut, "shared/agent-progress.js")}`
	);
	enableMonitorProbe(ctx, state, activeProgressSnapshot);
	await module.startGoalFromFlow("Flow objective", ctx);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const widgets = widgetTexts(state);
	assert(
		state.monitorScopes?.includes("acceptance") &&
			widgets.some((text) =>
				text.includes("gpt-5.4-mini · 读取 src/acceptance.ts · 1 calls"),
			) &&
			widgets.some((text) => text.includes("Alt+S 详情")),
		`${JSON.stringify(state.monitorScopes)}\n${widgets.join("\n---\n")}`,
	);
}

async function checkDisciplineHelpersScenario() {
	const {
		planCheckboxSignature,
		planRevisionDiff,
		todoClosureReminder,
		todoUpdateReminder,
		unfinishedCheckboxItems,
		REVISION_PERMISSION_AFTER_FAILURES,
		MAX_CONSECUTIVE_CHECK_FAILURES,
		ADVISOR_CONSULT_INTERVAL,
		shouldConsultAdvisor,
	} = await import(`file://${join(srcOut, "goal", "check-discipline.js")}`);
	assert(REVISION_PERMISSION_AFTER_FAILURES === 2, "revision threshold");
	assert(MAX_CONSECUTIVE_CHECK_FAILURES === 10, "hard cap threshold");
	assert(ADVISOR_CONSULT_INTERVAL === 2, "advisor interval");
	assert(
		[2, 4, 6, 8].every(shouldConsultAdvisor) &&
			[0, 1, 3, 5, 9, 10].every((failures) => !shouldConsultAdvisor(failures)),
		"advisor consultation rhythm changed",
	);
	const plan = "## Steps\n- [ ] a\n- [x] b\n\n## Notes\ntext\n";
	assert(planCheckboxSignature(plan) === " x", planCheckboxSignature(plan));
	assert(
		planCheckboxSignature(plan.replace("- [ ] a", "- [~] a")) === "~x",
		"checkbox change must change signature",
	);
	assert(
		planCheckboxSignature(plan.replace("text", "other")) === " x",
		"non-checkbox edit must not change signature",
	);
	assert(planCheckboxSignature(undefined) === undefined, "undefined plan");
	assert(todoUpdateReminder("zh").includes("进度提醒"), "zh reminder");
	assert(todoUpdateReminder("en").includes("Progress reminder"), "en reminder");
	const openItems = unfinishedCheckboxItems(
		"## Steps\n- [ ] a\n- [~] b\n- [!] c\n- [x] d\n\n## Verification\n- [ ] `t`\n",
	);
	assert(
		JSON.stringify(openItems) ===
			JSON.stringify(["- [ ] a", "- [~] b", "- [ ] `t`"]),
		JSON.stringify(openItems),
	);
	const closureZh = todoClosureReminder(openItems, "Handoff", "zh");
	assert(
		closureZh.includes("收口检查") &&
			closureZh.includes("- [~] b") &&
			closureZh.includes("Handoff"),
		closureZh,
	);
	assert(
		todoClosureReminder(openItems, "Handoff", "en").includes("Closure check"),
		"en closure reminder",
	);
	assert(
		planRevisionDiff(plan, plan.replace("- [ ] a", "- [x] a")) === undefined,
		"checkbox-only progress must not count as revision",
	);
	const revised = plan.replace("text", "revised reason");
	const diff = planRevisionDiff(plan, revised);
	assert(
		diff.includes("- [Notes] text") &&
			diff.includes("+ [Notes] revised reason"),
		diff,
	);
	const reordered = plan.replace("- [ ] a\n- [x] b", "- [x] b\n- [ ] a");
	assert(
		planRevisionDiff(plan, reordered) === undefined,
		"same-section reorder must not count as revision",
	);
	const movedAcrossSections = plan.replace(
		"- [x] b\n\n## Notes",
		"\n## Notes\n- [x] b",
	);
	const movedDiff = planRevisionDiff(plan, movedAcrossSections);
	assert(
		movedDiff.includes("- [Steps] - [] b") &&
			movedDiff.includes("+ [Notes] - [] b"),
		movedDiff,
	);
}

async function flowAcceptancePlanChangeNoteScenario() {
	const command = captureCommand(
		"PASS\n验收 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-plan-change");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	const planPath = join(cwd, ".flow", "F1", "G1-login.md");
	writeFileSync(
		planPath,
		readFileSync(planPath, "utf8").replace(
			"- Flow plan proof.",
			"- Flow plan proof v2.",
		),
	);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const args = readFileSync(`${command}.args`, "utf8");
	assert(args.includes("计划修订检测"), args.slice(0, 2000));
	assert(
		args.includes("+ [Success Criteria] - Flow plan proof v2."),
		args.slice(0, 2000),
	);
	assert(args.includes("降低标准逃避问题"), args.slice(0, 2000));
}

async function flowAcceptanceMissingEvidencePausesScenario() {
	const cases = [
		{
			dir: "flow-acceptance-missing-evidence",
			output: "PASS\n验收 OK 但无证据行\n",
			needle: "缺少证据锚点行",
		},
		{
			dir: "flow-acceptance-command-only-evidence",
			output: "PASS\n验收 OK\n证据：命令=npm test\n",
			needle: "缺少文件段",
		},
		{
			dir: "flow-acceptance-missing-summary",
			output: "PASS\n证据：文件=src/app.ts；命令=npm test\n",
			needle: "缺少摘要行",
		},
	];
	for (const item of cases) {
		const command = captureCommand(item.output);
		writeConfig({ acceptance: true, quality: false, command });
		const cwd = join(out, item.dir);
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
		assert(
			module.getGoalState(ctx)?.status === "paused",
			`${item.dir}: invalid PASS did not pause: ${module.getGoalState(ctx)?.status}`,
		);
		const errorCard = state.messages.find(
			(entry) => entry.message.details?.title === "验收未完成",
		);
		assert(
			errorCard,
			state.messages.map((entry) => entry.message.details?.title).join(" | "),
		);
		assert(
			errorCard.message.content.includes(item.needle),
			errorCard.message.content,
		);
	}
}

async function flowContinuationTodoReminderScenario() {
	writeConfig({ acceptance: false, quality: false });
	const cwd = join(out, "flow-todo-reminder");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	await handlers.get("agent_start")({}, ctx);
	handlers.get("tool_execution_end")(
		{ toolCallId: "t1", toolName: "write", result: {}, isError: false },
		ctx,
	);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "length" }] },
		ctx,
	);
	const staleContinue = state.sentMessages.at(-1);
	assert(staleContinue.includes("进度提醒"), staleContinue);
	await handlers.get("before_agent_start")(
		{ prompt: staleContinue, systemPrompt: "" },
		ctx,
	);
	await handlers.get("agent_start")({}, ctx);
	handlers.get("tool_execution_end")(
		{ toolCallId: "t2", toolName: "edit", result: {}, isError: false },
		ctx,
	);
	const planPath = join(cwd, ".flow", "F1", "G1-login.md");
	writeFileSync(
		planPath,
		readFileSync(planPath, "utf8").replace(
			"- [x] Ship login.",
			"- [~] Ship login.",
		),
	);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "length" }] },
		ctx,
	);
	const freshContinue = state.sentMessages.at(-1);
	assert(
		freshContinue.includes("继续活动的 Flow 步骤") &&
			!freshContinue.includes("进度提醒"),
		freshContinue,
	);
}

async function flowAcceptanceTodoGateScenario() {
	const command = captureCommand(
		"PASS\n验收 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-todo-gate");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const planPath = join(cwd, ".flow", "F1", "G1-login.md");
	writeFileSync(
		planPath,
		readFileSync(planPath, "utf8").replace(
			"- [x] Ship login.",
			"- [~] Ship login.\n- [ ] Ship logout.",
		),
	);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const gatePrompt = state.sentMessages.at(-1);
	assert(
		gatePrompt.includes("收口检查") &&
			gatePrompt.includes("- [~] Ship login.") &&
			gatePrompt.includes("- [ ] Ship logout.") &&
			gatePrompt.includes("Handoff"),
		gatePrompt,
	);
	assert(
		!existsSync(`${command}.args`),
		"acceptance ran despite open checkboxes",
	);
	// 同一验收轮只拦一次：再次自然结束时放行，交给验收仲裁。
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(existsSync(`${command}.args`), "second stop did not reach acceptance");
	const acceptanceCard = state.messages.find(
		(item) => item.message.details?.title === "验收通过",
	);
	assert(acceptanceCard, "acceptance pass card missing after gate passthrough");
}

async function flowAcceptanceTodoGateDeliveryScenario() {
	const command = captureCommand(
		"PASS\n验收 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-todo-gate-delivery");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const planPath = join(cwd, ".flow", "F1", "G1-login.md");
	writeFileSync(
		planPath,
		readFileSync(planPath, "utf8").replace(
			"- [x] Ship login.",
			"- [ ] Ship login.",
		),
	);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	const sentBefore = state.sentMessages.length;

	// 排队消息挡住投递：推迟验收，不消耗闸门，也不发闸门提醒。
	state.pendingMessages = true;
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		!existsSync(`${command}.args`),
		"acceptance started despite queued messages",
	);
	assert(
		state.sentMessages.length === sentBefore,
		"gate prompt sent while messages pending",
	);

	// 发送异常：推迟验收，通知并请求接管。
	state.pendingMessages = false;
	state.failGoalPromptSend = true;
	const attention = await attentionProbe();
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	attention.unsubscribe();
	assert(
		!existsSync(`${command}.args`),
		"acceptance started despite gate send failure",
	);
	assert(
		attention.sources.length > 0,
		"gate send failure did not request attention",
	);
	assert(
		state.notifications.some((item) => item.includes("收口提醒发送失败")),
		state.notifications.join("\n"),
	);
	const failedAttention = readFlow(cwd).attention;
	assert(
		failedAttention?.kind === "system_error" &&
			failedAttention.message.includes("收口提醒发送失败") &&
			failedAttention.message.includes("/flow go"),
		`gate send failure did not persist canonical attention: ${JSON.stringify(failedAttention)}`,
	);

	// 恢复后闸门正常投递一次，再次结束才进入验收。
	state.failGoalPromptSend = false;
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		state.sentMessages.at(-1).includes("收口检查"),
		state.sentMessages.at(-1),
	);
	assert(
		!existsSync(`${command}.args`),
		"acceptance ran together with gate prompt",
	);
	// 闸门成功重投后自清自己写的 attention（「/flow go」入口另有统一清空）。
	assert(
		readFlow(cwd).attention === null,
		"successful gate redelivery left stale attention in flow.json",
	);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		existsSync(`${command}.args`),
		"acceptance did not start after gate consumed",
	);
}

async function flowRevisionPermissionInjectionTimingScenario() {
	const command = captureCommand("FAIL\n验收不通过\n");
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-revision-timing");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	for (let round = 1; round <= 3; round += 1) {
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	}
	const failCards = state.messages.filter((item) =>
		item.message.details?.title.includes("验收未通过"),
	);
	assert(failCards.length === 3, `fail cards: ${failCards.length}`);
	assert(
		!failCards[0].message.content.includes("修订许可"),
		"revision clause leaked before round 2",
	);
	assert(
		failCards[1].message.content.includes("修订许可") &&
			failCards[1].message.content.includes("连续 2 轮检查未通过"),
		failCards[1].message.content,
	);
	assert(
		failCards[2].message.content.includes("连续 3 轮检查未通过"),
		failCards[2].message.content,
	);
}

async function flowAcceptanceAdvisorConsultScenario() {
	const failCommand = captureCommand("FAIL\n验收不通过\n");
	const advice = [
		"根因结论：当前路径把跨模块状态同步问题当成单点空值处理；失败历史和文件调用链证明两个写入口会提交相互冲突的状态。",
		"关键洞察：真正的杠杆点是确定唯一状态事实源，再让其他模块订阅状态变化；继续在消费端补分支只会制造下一轮不一致。",
		"建议方向：先追踪两处写入口，保留一个写 owner，再用真实恢复路径验证事件只提交一次。",
		"验证与转向：并发恢复测试应稳定只产生一次提交；若仍重复，转查事件去重键与锁事务边界。",
		"标准修订：否；现有标准与用户目标一致。advice-tail-preserved",
	].join("\n");
	assert(advice.length > 200, `advisor fixture is too short: ${advice.length}`);
	const advisor = advisorScript(advice);
	// advisor 角色未显式配置（current）：咨询子进程回落第一个 reviewer 的 model/thinking，
	// command 回落 background.command。
	writeConfig({
		acceptance: true,
		quality: false,
		command: advisor,
		models: [
			{ model: "test/gpt-5.4-mini", thinking: "off", command: failCommand },
		],
	});
	const cwd = join(out, "flow-acceptance-advisor");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	const { activeProgressSnapshot } = await import(
		`file://${join(srcOut, "shared/agent-progress.js")}`
	);
	enableMonitorProbe(ctx, state, activeProgressSnapshot);
	await module.startGoalFromFlow("Flow objective", ctx);
	for (let round = 1; round <= 6; round += 1) {
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	}
	const failCards = state.messages.filter((item) =>
		item.message.details?.title.includes("验收未通过"),
	);
	assert(failCards.length === 6, `fail cards: ${failCards.length}`);
	const roundTwo = failCards[1];
	assert(
		!roundTwo.message.content.includes("顾问建议") &&
			roundTwo.message.details.lines.some((line) =>
				line.includes("连续 2 轮未通过 · 正在咨询顾问"),
			),
		roundTwo.message.content,
	);
	const advisorWidgets = widgetTexts(state);
	assert(
		state.monitorScopes?.includes("advisor") &&
			advisorWidgets.some((text) =>
				text.includes("gpt-5.4-mini · 读取 src/advisor.ts · 1 calls"),
			) &&
			advisorWidgets.some((text) => text.includes("Alt+S 详情")),
		`${JSON.stringify(state.monitorScopes)}\n${advisorWidgets.join("\n---\n")}`,
	);
	const adviceCard = state.messages.find(
		(item) =>
			item.message.details?.title === "顾问建议" &&
			item.message.details?.deliveryId?.endsWith(":repair"),
	);
	assert(adviceCard, state.notifications.join("\n"));
	assert(
		state.messages.indexOf(roundTwo) < state.messages.indexOf(adviceCard),
		"acceptance failure card must precede advisor card",
	);
	assert(
		roundTwo.options.triggerTurn !== true &&
			adviceCard.options.triggerTurn === true &&
			roundTwo.message.details.deliveryId.endsWith(":failed"),
		"acceptance repair turn was not anchored to the advisor card",
	);
	assert(
		adviceCard.message.details.advisor?.advice === advice &&
			adviceCard.message.details.lines.includes(advice),
		"advisor card did not preserve the structured advice",
	);
	const repairPrompt = adviceCard.message.content;
	assert(
		repairPrompt.indexOf("验收结果：") < repairPrompt.indexOf("顾问建议：") &&
			repairPrompt.indexOf("顾问建议：") < repairPrompt.indexOf("下一步：") &&
			repairPrompt.includes("advice-tail-preserved"),
		"advisor repair prompt order changed",
	);
	assert(
		[failCards[0], failCards[2], failCards[4]].every(
			(card) => !card.message.content.includes("顾问建议"),
		),
		"advisor advice leaked into a non-interval failure card",
	);
	const adviceCards = state.messages.filter(
		(item) =>
			item.message.details?.title === "顾问建议" &&
			item.message.details?.deliveryId?.endsWith(":repair"),
	);
	assert(
		adviceCards.length === 3 &&
			adviceCards[2].message.details.advisor?.advice === advice &&
			!failCards[5].message.content.includes("顾问建议"),
		`acceptance advisor cards: ${adviceCards.length}`,
	);
	const calls = Number(readFileSync(`${advisor}.count`, "utf8").trim());
	assert(calls === 3, `advisor calls: ${calls}`);
	const args = readFileSync(`${advisor}.args`, "utf8");
	assert(args.includes("--model"), args.slice(0, 500));
	assert(
		args.includes("test/gpt-5.4-mini"),
		`advisor did not fall back to the first reviewer model: ${args.slice(0, 500)}`,
	);
	assert(
		args.includes("--no-session") &&
			args.includes("read,grep,find,ls,bash") &&
			args.includes("write,edit") &&
			!args.includes("write,edit,bash"),
		`advisor must share reviewer check tools: ${args.slice(0, 500)}`,
	);
	assert(
		args.includes("失败发现历史：") &&
			args.includes("上下文证据：") &&
			args.includes("Coverage：") &&
			args.includes("你是独立顾问模型") &&
			args.includes("根因结论：") &&
			args.includes("调查与工具纪律"),
		args.slice(0, 3000),
	);
	const acceptanceChecks = readFlow(cwd).goals[0].checks.acceptance;
	const rounds = acceptanceChecks.rounds;
	assert(
		rounds.length === 6 && acceptanceChecks.active === null,
		`stored acceptance checks: ${JSON.stringify(acceptanceChecks)}`,
	);
	// 顾问建议结构化落盘：advisor 字段承载，details 不再嵌文本。
	const storedAdvice = rounds[1].advisor?.advice ?? "";
	assert(
		storedAdvice === advice &&
			rounds[1].advisor.model === "test/gpt-5.4-mini" &&
			rounds[2].advisor === undefined &&
			rounds[3].advisor?.advice === advice &&
			rounds[5].advisor?.advice === advice,
		JSON.stringify(rounds),
	);
	const { renderFlowHtml } = await import(
		`file://${join(srcOut, "flow/html.js")}?advisor=${Date.now()}`
	);
	const html = renderFlowHtml(join(cwd, ".flow", "F1"), readFlow(cwd));
	assert(
		html.includes("顾问建议 ·") &&
			html.includes('data-tooltip-size="lg"') &&
			html.includes("根因结论：当前路径") &&
			html.includes("advice-tail-preserved") &&
			html.includes('class="mt-2"><div data-advisor-slot') &&
			html.includes("[&+li]:mt-3") &&
			!html.includes('data-advisor-slot class="my-2.5') &&
			!html.includes("…全文"),
		"advisor capsule, spacing, or full hover advice missing from Flow HTML",
	);
	// 跨轮收敛：第 2 轮起验收 prompt 必须携带当前轮次与往轮发现清单。
	const auditPrompt = readFileSync(`${failCommand}.args`, "utf8");
	assert(
		auditPrompt.includes("当前为第 6 轮") &&
			auditPrompt.includes("往轮发现清单（由新到旧）："),
		auditPrompt.slice(0, 2000),
	);
}

async function flowAcceptanceAdvisorReceiptRecoveryScenario() {
	const reviewer = countedScript(
		["FAIL\n验收不通过\n"],
		"*) cat '{{last}}' ;;",
	);
	const advice =
		"根因结论：receipt 恢复必须复用已完成咨询\n建议方向：从建议卡恢复结构化数据";
	const advisor = advisorScript(advice);
	writeConfig({
		acceptance: true,
		quality: false,
		command: advisor,
		models: [{ model: "test/reviewer", thinking: "off", command: reviewer }],
		modelRoles: { advisor: { model: "test/advisor", thinking: "off" } },
	});
	const cwd = join(out, "flow-acceptance-advisor-receipt");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	state.failAfterResultCardTitle = "顾问建议";
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	let flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.acceptance.rounds.length === 2 &&
			flow.goals[0].checks.acceptance.rounds[1].advisor === undefined &&
			flow.goals[0].checks.acceptance.active?.round === 2,
		`repair receipt crash lost the durable failure: ${JSON.stringify(flow.goals[0].checks.acceptance)}`,
	);
	assert(
		Number(readFileSync(`${advisor}.count`, "utf8").trim()) === 1,
		"advisor did not run exactly once before recovery",
	);
	loaded.handlers.get("session_shutdown")({}, ctx);

	state.failAfterResultCardTitle = undefined;
	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await waitFor(
		() => readFlow(cwd).goals[0].completionCursor === "acceptance_repair",
		"repair receipt did not settle acceptance history",
	);
	flow = readFlow(cwd);
	const adviceCards = state.messages.filter(
		(item) =>
			item.message.details?.title === "顾问建议" &&
			item.message.details?.deliveryId?.endsWith(":repair"),
	);
	assert(
		Number(readFileSync(`${advisor}.count`, "utf8").trim()) === 1 &&
			adviceCards.length === 1 &&
			flow.goals[0].checks.acceptance.rounds[1]?.advisor?.advice === advice,
		`acceptance repair receipt recovery: ${JSON.stringify({ calls: Number(readFileSync(`${advisor}.count`, "utf8").trim()), cards: adviceCards.length, advisor: flow.goals[0].checks.acceptance.rounds[1]?.advisor })}`,
	);
	await loaded.module.pauseGoalFromFlow(ctx);
}

async function flowAcceptanceAdvisorEscScenario() {
	const reviewer = script("FAIL\n验收不通过\n");
	writeConfig({
		acceptance: true,
		quality: false,
		command: shellScript("sleep 30"),
		models: [{ model: "test/reviewer", thinking: "off", command: reviewer }],
		modelRoles: { advisor: { model: "test/advisor", thinking: "off" } },
	});
	const cwd = join(out, "flow-acceptance-advisor-esc");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const loaded = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const pending = loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await waitFor(
		() => widgetTexts(state).some((text) => text.includes("顾问介入中")),
		"automatic advisor consultation did not start",
	);
	const roundTwo = state.messages.find((item) =>
		item.message.details?.title.includes("第 2 轮验收未通过"),
	);
	assert(
		roundTwo?.message.details.lines.some((line) =>
			line.includes("正在咨询顾问"),
		),
		"failure card was blocked by the automatic advisor",
	);
	const { cancelActiveFlowActivity } = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}`
	);
	cancelActiveFlowActivity();
	await pending;
	const flow = readFlow(cwd);
	assert(
		flow.goals[0].completionCursor === "acceptance_repair" &&
			flow.goals[0].checks.acceptance.rounds[1]?.advisor === undefined &&
			!state.messages.some(
				(item) => item.message.details?.title === "顾问建议",
			) &&
			state.entries.some(
				(entry) =>
					entry.customType === "pi-flow-goal-prompt" &&
					entry.display === false &&
					entry.content.includes("将验收反馈视为待核实假设"),
			),
		"Esc did not skip only the consultation and continue repair",
	);
	await loaded.module.pauseGoalFromFlow(ctx);
}

async function flowAdvisorReceivesCompleteFailureHistoryScenario() {
	const tailMarkers = [1, 2].map((round) => `round-${round}-tail-after-2000`);
	const failures = tailMarkers.map(
		(marker, index) =>
			`FAIL\n第 ${index + 1} 轮失败\n${"长失败证据。".repeat(420)}${marker}\n`,
	);
	const failCommand = sequenceScript(failures);
	const advisor = advisorScript("根因结论：已综合两轮完整失败发现。");
	writeConfig({
		acceptance: true,
		quality: false,
		command: advisor,
		models: [
			{ model: "test/gpt-5.4-mini", thinking: "off", command: failCommand },
		],
	});
	const cwd = join(out, "flow-advisor-complete-history");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	for (let round = 1; round <= 2; round += 1)
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	const prompt = readFileSync(`${advisor}.args`, "utf8");
	for (const marker of tailMarkers)
		assert(prompt.includes(marker), `advisor history omitted ${marker}`);
	assert(
		prompt.includes("第 1 轮") && prompt.includes("第 2 轮"),
		prompt.slice(0, 4000),
	);
}

async function manualAdvisorNoFailureScenario() {
	const advisor = advisorScript("建议路径：不应被调用");
	writeConfig({
		acceptance: true,
		quality: false,
		command: advisor,
		modelRoles: { advisor: { model: "test/advisor-x", thinking: "off" } },
	});
	const cwd = join(out, "manual-advisor-no-failure");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { commands, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	await commands.get("advisor").handler("", ctx);
	assert(
		state.notifications.some(
			(item) =>
				item.includes("顾问无可诊断项") &&
				item.includes("没有尚未解决的失败检查"),
		),
		state.notifications.join("\n"),
	);
	assert(!existsSync(`${advisor}.count`), "zero-failure advisor was spawned");
}

async function manualAdvisorDisabledScenario() {
	const advisor = advisorScript("建议路径：不应被调用");
	const fixture = await failedManualAdvisorFixture(
		"manual-advisor-disabled",
		advisor,
		false,
	);
	await fixture.commands.get("advisor").handler("", fixture.ctx);
	assert(
		fixture.state.notifications.some(
			(item) => item.includes("顾问已关闭") && item.includes("advisor.enabled"),
		),
		fixture.state.notifications.join("\n"),
	);
	assert(!existsSync(`${advisor}.count`), "disabled advisor was spawned");
}

async function manualAdvisorPersistentDeliveryScenario() {
	const advice =
		"根因结论：状态事实源分散\n关键洞察：局部补丁无法消除双写\n建议方向：改用事件驱动\n验证与转向：确认状态只提交一次\n标准修订：否";
	const advisor = advisorScript(advice);
	const fixture = await failedManualAdvisorFixture(
		"manual-advisor-delivery",
		advisor,
	);
	await fixture.commands.get("advisor").handler("", fixture.ctx);
	const afterConsult = readFlow(fixture.cwd);
	assert(
		afterConsult.goals[0].pendingAdvisor?.phase === "acceptance" &&
			afterConsult.goals[0].pendingAdvisor?.round === 1,
		`manual advisor outbox missing: ${JSON.stringify(afterConsult.goals[0])}`,
	);
	assert(
		afterConsult.goals[0].checks.acceptance.rounds[0].advisor?.advice ===
			advice,
		"manual advice not attached to the failed round",
	);
	const card = fixture.state.messages.find(
		(item) => item.message.details?.title === "顾问建议",
	);
	assert(
		card?.message.content.includes(advice) &&
			card.message.details.context === "check-result" &&
			card.message.content.includes("/flow go F1"),
		`manual advisor card: ${JSON.stringify(card)}`,
	);

	// outbox 未消费前重复调用只提示，不重复烧模型。
	await fixture.commands.get("advisor").handler("", fixture.ctx);
	assert(
		fixture.state.notifications.some((item) => item.includes("顾问建议已排队")),
		fixture.state.notifications.join("\n"),
	);
	assert(
		Number(readFileSync(`${advisor}.count`, "utf8").trim()) === 1,
		"queued advice triggered a duplicate consult",
	);

	// 模拟扩展重载：待投递引用只在 flow.json，恢复后仍能送达并清空。
	const reloaded = await loadGoalExtension(fixture.state);
	await reloaded.handlers.get("session_start")({}, fixture.ctx);
	assert(
		(await reloaded.module.resumePausedGoalFromFlow(fixture.ctx)) === "resumed",
		"reloaded paused goal did not resume",
	);
	assert(
		fixture.state.sentMessages.some(
			(message) =>
				message.includes("用户手动咨询的顾问建议") &&
				message.includes("改用事件驱动"),
		),
		fixture.state.sentMessages.join("\n---\n"),
	);
	const { buildContextEvidence } = await import(
		`file://${join(srcOut, "shared/context-evidence.js")}`
	);
	const reviewEvidence = buildContextEvidence({
		entries: fixture.state.entries,
		projection: "review",
		language: "zh",
		modelReferences: ["test/reviewer"],
		modelRegistry: fixture.ctx.modelRegistry,
		fixedPrompt: "",
	});
	assert(reviewEvidence.ok, reviewEvidence.error?.message);
	assert(
		!reviewEvidence.packet.text.includes("改用事件驱动"),
		"manual advisor advice leaked into Context Evidence",
	);
	assert(
		readFlow(fixture.cwd).goals[0].pendingAdvisor === null,
		"manual advisor outbox was not consumed",
	);
	await reloaded.commands.get("advisor").handler("", fixture.ctx);
	assert(
		fixture.state.notifications.some((item) =>
			item.includes("本轮已有顾问建议"),
		) && Number(readFileSync(`${advisor}.count`, "utf8").trim()) === 1,
		"an advised round was consulted again",
	);

	// 再暂停/恢复一次，已消费建议不得重复投递。
	await reloaded.module.pauseGoalFromFlow(fixture.ctx);
	markFixtureFlowPaused(fixture.cwd);
	await reloaded.module.resumePausedGoalFromFlow(fixture.ctx);
	assert(
		fixture.state.sentMessages.filter((message) =>
			message.includes("用户手动咨询的顾问建议"),
		).length === 1,
		"manual advisor advice was delivered more than once",
	);
}

async function manualAdvisorActiveDeliveryPrecedesRepairCursorScenario() {
	const advice =
		"根因结论：消费端补丁掩盖了双写\n关键洞察：修复层级错误\n建议方向：先修状态源\n验证与转向：确认恢复路径只提交一次\n标准修订：否";
	const advisor = advisorScript(advice);
	const fixture = await failedManualAdvisorFixture(
		"manual-advisor-active-delivery",
		advisor,
		true,
		false,
	);
	await fixture.commands.get("advisor").handler("", fixture.ctx);
	fixture.state.entries.push({
		type: "message",
		id: `assistant-${fixture.state.entries.length + 1}`,
		parentId: fixture.state.entries.at(-1)?.id ?? null,
		timestamp: new Date().toISOString(),
		message: {
			role: "assistant",
			content: [{ type: "text", text: "上一回合停止" }],
			stopReason: "stop",
		},
	});
	assert(
		(await fixture.module.continueActiveGoalIfIdle(fixture.ctx)) ===
			"continued",
		"active goal did not continue with queued advisor advice",
	);
	assert(
		fixture.state.sentMessages.at(-1).includes("先修状态源") &&
			readFlow(fixture.cwd).goals[0].pendingAdvisor === null,
		"repair cursor bypassed queued advisor advice",
	);
}

async function manualAdvisorEscScenario() {
	const advisor = shellScript("sleep 30");
	const fixture = await failedManualAdvisorFixture(
		"manual-advisor-esc",
		advisor,
	);
	const pending = fixture.commands.get("advisor").handler("", fixture.ctx);
	await waitFor(
		() =>
			widgetTexts(fixture.state).some((text) => text.includes("顾问介入中")),
		"manual advisor activity did not start",
	);
	const advisorActivity = widgetTexts(fixture.state)
		.filter((text) => text.includes("顾问介入中"))
		.at(-1);
	assert(
		advisorActivity && !advisorActivity.includes("思考中 · 0 calls"),
		`manual advisor rendered a spinner before its first event:\n${advisorActivity}`,
	);
	const { cancelActiveFlowActivity } = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}`
	);
	cancelActiveFlowActivity();
	const raced = await Promise.race([
		pending.then(() => "done"),
		new Promise((resolve) => setTimeout(() => resolve("slow"), 10000)),
	]);
	assert(raced === "done", "Esc did not abort the manual advisor subprocess");
	const goal = readFlow(fixture.cwd).goals[0];
	assert(goal.pendingAdvisor === null, "Esc left a pending advisor outbox");
	assert(
		goal.checks.acceptance.rounds[0].advisor === undefined,
		"Esc persisted partial advisor advice",
	);
	assert(
		!fixture.state.messages.some(
			(item) => item.message.details?.title === "顾问建议",
		),
		"Esc still emitted an advisor card",
	);
}

async function failedManualAdvisorFixture(
	name,
	advisorCommand,
	enabled = true,
	pause = true,
) {
	writeConfig({
		acceptance: true,
		quality: false,
		command: advisorCommand,
		advisor: { enabled },
		models: [
			{
				model: "test/gpt-5.4-mini",
				thinking: "off",
				command: script("FAIL\n验收不通过\n"),
			},
		],
		modelRoles: { advisor: { model: "test/advisor-x", thinking: "off" } },
	});
	const cwd = join(out, name);
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const loaded = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	if (pause) {
		await loaded.module.pauseGoalFromFlow(ctx);
		markFixtureFlowPaused(cwd);
	}
	return { ...loaded, state, ctx, cwd };
}

function markFixtureFlowPaused(cwd) {
	const flow = readFlow(cwd);
	flow.status = "paused";
	writeFileSync(
		join(cwd, ".flow", "F1", "flow.json"),
		`${JSON.stringify(flow, null, 2)}\n`,
	);
}

async function flowBlockedOnUserScenario() {
	const failCommand = script("FAIL\n验收不通过\n");
	writeConfig({ acceptance: true, quality: false, command: failCommand });
	const cwd = join(out, "flow-blocked-on-user");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	state.simulateAgentLifecycle = true;
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	// 修复回合声明阻塞于用户操作：不得再送检查或模型消息，原子暂停并请求接管。
	const customMessagesBeforeBlock = state.entries.filter(
		(entry) => entry.type === "custom_message",
	).length;
	const agentStartsBeforeBlock = state.agentStarts;
	await handlers.get("agent_end")(
		{
			messages: [
				{
					role: "assistant",
					stopReason: "stop",
					content: [
						{
							type: "text",
							text: "已完成分析，等待用户操作。\nBLOCKED: 去系统设置关闭辅助功能权限",
						},
					],
				},
			],
		},
		ctx,
	);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`blocked status: ${module.getGoalState(ctx)?.status}`,
	);
	const failCards = state.messages.filter((item) =>
		item.message.details?.title.includes("验收未通过"),
	);
	assert(failCards.length === 1, `blocked fail cards: ${failCards.length}`);
	assert(
		!state.messages.some(
			(item) => item.message.details?.title === "需要你操作",
		),
		"blocked handoff emitted a redundant result card",
	);
	assert(
		state.entries.filter((entry) => entry.type === "custom_message").length ===
			customMessagesBeforeBlock,
		"blocked handoff queued another model message",
	);
	assert(
		state.agentStarts === agentStartsBeforeBlock,
		`blocked handoff restarted agent: ${state.agentStarts}`,
	);
	const blockedFlow = readFlow(cwd);
	assert(
		blockedFlow.status === "paused" &&
			blockedFlow.attention?.kind === "user_action_required" &&
			blockedFlow.attention.message.includes("去系统设置关闭辅助功能权限"),
		`blocked canonical state: ${JSON.stringify(blockedFlow)}`,
	);
	const takeoverBox = renderGoalWidgets(state, "goal-progress").at(-1) ?? "";
	assert(
		takeoverBox.includes("等待你接管") &&
			takeoverBox.includes("待办：去系统设置关闭辅助功能权限") &&
			takeoverBox.includes("/flow go F1"),
		`blocked takeover box: ${takeoverBox}`,
	);
}

async function flowBlockedOnUserHtmlFailureScenario() {
	const failCommand = script("FAIL\n验收不通过\n");
	writeConfig({ acceptance: true, quality: false, command: failCommand });
	const cwd = join(out, "flow-blocked-html-failure");
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
	const htmlPath = join(cwd, ".flow", "F1", "flow.html");
	rmSync(htmlPath, { recursive: true, force: true });
	mkdirSync(htmlPath);

	await handlers.get("agent_end")(
		{
			messages: [
				{
					role: "assistant",
					stopReason: "stop",
					content: [
						{
							type: "text",
							text: "BLOCKED: 完成真机焦点验证",
						},
					],
				},
			],
		},
		ctx,
	);
	const flow = readFlow(cwd);
	const takeoverBox = renderGoalWidgets(state, "goal-progress").at(-1) ?? "";
	assert(
		flow.status === "paused" &&
			flow.attention?.kind === "user_action_required" &&
			module.getGoalState(ctx)?.status === "paused" &&
			takeoverBox.includes("等待你接管") &&
			takeoverBox.includes("完成真机焦点验证"),
		`HTML projection failure split blocked state: ${JSON.stringify({ flow, takeoverBox })}`,
	);
	assert(
		state.notifications.some((message) =>
			message.includes("Flow 报告刷新失败"),
		),
		`HTML projection failure was silent: ${state.notifications.join(" | ")}`,
	);
}

async function flowBlockedOnUserLockRecoveryScenario() {
	const failCommand = script("FAIL\n验收不通过\n");
	writeConfig({ acceptance: true, quality: false, command: failCommand });
	const cwd = join(out, "flow-blocked-lock-recovery");
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
	const { acquireFlowLock } = await import(
		`file://${join(srcOut, "flow/lock.js")}`
	);
	const lock = acquireFlowLock(join(cwd, ".flow", "F1"), "hold BLOCKED");
	assert(lock.ok, "failed to acquire BLOCKED fixture lock");
	let released = false;
	try {
		await handlers.get("agent_end")(
			{
				messages: [
					{
						role: "assistant",
						stopReason: "stop",
						content: [
							{
								type: "text",
								text: "BLOCKED: 完成锁竞争后的人工验证",
							},
						],
					},
				],
			},
			ctx,
		);
		const pendingBox = renderGoalWidgets(state, "goal-progress").at(-1) ?? "";
		assert(
			readFlow(cwd).status === "running" &&
				pendingBox.includes("等待你接管") &&
				pendingBox.includes("完成锁竞争后的人工验证") &&
				!pendingBox.includes("执行中"),
			`locked BLOCKED kept active UI: ${pendingBox}`,
		);

		const reloaded = await loadGoalExtension(state);
		const restartCtx = mockContext(state, cwd, sessionFile);
		await reloaded.handlers.get("session_start")({}, restartCtx);
		lock.release();
		released = true;
		await waitFor(() => {
			const flow = readFlow(cwd);
			return (
				flow.status === "paused" &&
				flow.attention?.kind === "user_action_required" &&
				reloaded.module.getGoalState(restartCtx)?.status === "paused"
			);
		}, "BLOCKED did not commit after restart and Flow lock release");
	} finally {
		if (!released) lock.release();
	}
}

async function flowCheckboxAttributionScenario() {
	writeConfig({ acceptance: false, quality: false });
	const cwd = join(out, "flow-checkbox-attribution");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const planPath = join(cwd, ".flow", "F1", "G1-login.md");
	writeFileSync(
		planPath,
		readFileSync(planPath, "utf8").replace(
			"- [x] Ship login.",
			"- [ ] First change.\n- [ ] Second change.\n- [ ] Third change.\n- [ ] External change.\n- [ ] Failed change.\n- [ ] Concurrent A.\n- [ ] Concurrent B.",
		),
	);
	const existingAt = new Date(2026, 0, 2, 3, 4, 1).getTime();
	const existingFlow = readFlow(cwd);
	existingFlow.goals[0].checkAttribution = {
		"Verification\u0000test\u00001": {
			model: "test/previous-executor",
			thinking: "low",
			at: existingAt,
		},
	};
	writeFileSync(
		join(cwd, ".flow", "F1", "flow.json"),
		`${JSON.stringify(existingFlow, null, 2)}\n`,
	);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	await handlers.get("agent_start")({}, ctx);
	let toolCall = 0;
	const beginPlanEdit = async (edits, path = ".flow/F1/G1-login.md") => {
		const call = {
			toolCallId: `plan-edit-${++toolCall}`,
			toolName: "edit",
			input: { path, edits },
		};
		await handlers.get("tool_call")(call, ctx);
		return call;
	};
	const applyPlanEdits = (edits) => {
		let plan = readFileSync(planPath, "utf8");
		for (const edit of edits) {
			assert(plan.includes(edit.oldText), `test edit missing: ${edit.oldText}`);
			plan = plan.replace(edit.oldText, edit.newText);
		}
		writeFileSync(planPath, plan);
	};
	const finishPlanEdit = (call, at, isError = false) => {
		Date.now = () => at;
		return handlers.get("tool_result")({ ...call, isError, content: [] }, ctx);
	};
	const runPlanEdit = async (edits, at, options = {}) => {
		const call = await beginPlanEdit(edits, options.path);
		options.interleave?.();
		if (options.apply !== false) applyPlanEdits(edits);
		await finishPlanEdit(call, at, options.isError);
	};
	const blockedWrite = await handlers.get("tool_call")(
		{
			toolCallId: "plan-write",
			toolName: "write",
			input: { path: ".flow/F1/G1-login.md", content: "rewritten" },
		},
		ctx,
	);
	assert(
		blockedWrite?.block === true && blockedWrite.reason.includes("精确 edit"),
		`active plan write was not blocked: ${JSON.stringify(blockedWrite)}`,
	);
	const blockedInexactEdit = await handlers.get("tool_call")(
		{
			toolCallId: "inexact-plan-edit",
			toolName: "edit",
			input: {
				path: ".flow/F1/G1-login.md",
				edits: [{ oldText: "missing checkbox", newText: "replacement" }],
			},
		},
		ctx,
	);
	assert(
		blockedInexactEdit?.block === true &&
			blockedInexactEdit.reason.includes("互不重叠"),
		`inexact plan edit was not blocked: ${JSON.stringify(blockedInexactEdit)}`,
	);

	const firstAt = new Date(2026, 0, 2, 3, 4, 5).getTime();
	const secondAt = firstAt + 1_000;
	const recheckedAt = firstAt + 3_000;
	const concurrentAAt = firstAt + 5_000;
	const concurrentBAt = firstAt + 6_000;
	const originalNow = Date.now;
	try {
		await runPlanEdit(
			[{ oldText: "- [ ] First change.", newText: "- [x] First change." }],
			firstAt,
			{
				interleave: () =>
					writeFileSync(
						planPath,
						readFileSync(planPath, "utf8").replace(
							"- [ ] External change.",
							"- [x] External change.",
						),
					),
			},
		);
		const firstFlow = readFlow(cwd);
		const firstEntries = Object.entries(
			firstFlow.goals[0].checkAttribution ?? {},
		);
		const firstChange = firstEntries.find(([key]) =>
			key.includes("First change."),
		);
		const existing = firstEntries.find(([key]) => key.includes("test"));
		assert(
			firstEntries.length === 2 &&
				firstChange?.[1].at === firstAt &&
				existing?.[1].at === existingAt &&
				!firstEntries.some(([key]) => key.includes("External change.")),
			`external change attribution: ${JSON.stringify(firstEntries)}`,
		);

		await runPlanEdit(
			[{ oldText: "## Notes\n", newText: "## Notes\nNo checkbox change.\n" }],
			firstAt + 500,
		);
		assert(
			readFlow(cwd).updatedAt === firstFlow.updatedAt,
			"non-checkbox edit rewrote Flow attribution state",
		);

		await runPlanEdit(
			[
				{
					oldText: "- [ ] Second change.",
					newText: "- [x] Second change.",
				},
				{
					oldText: "- [ ] Third change.",
					newText: "- [x] Third change.",
				},
			],
			secondAt,
		);
		await runPlanEdit(
			[
				{
					oldText: "- [x] Second change.",
					newText: "- [x] Renamed second change.",
				},
			],
			firstAt + 2_000,
		);
		assert(
			Object.entries(readFlow(cwd).goals[0].checkAttribution ?? {}).some(
				([key, value]) =>
					key.includes("Renamed second change.") && value.at === secondAt,
			),
			"checked text edit reset its attribution",
		);

		await runPlanEdit(
			[{ oldText: "- [x] First change.", newText: "- [ ] First change." }],
			firstAt + 2_500,
		);
		assert(
			!Object.keys(readFlow(cwd).goals[0].checkAttribution ?? {}).some((key) =>
				key.includes("First change."),
			),
			"unchecked item kept stale attribution",
		);
		await runPlanEdit(
			[{ oldText: "- [ ] First change.", newText: "- [x] First change." }],
			recheckedAt,
		);
		await runPlanEdit(
			[
				{
					oldText: "- [x] First change.",
					newText: "- [x] Renamed first change.",
				},
			],
			recheckedAt + 1_000,
		);

		const concurrentA = [
			{ oldText: "- [ ] Concurrent A.", newText: "- [x] Concurrent A." },
		];
		const concurrentB = [
			{ oldText: "- [ ] Concurrent B.", newText: "- [x] Concurrent B." },
		];
		const callA = await beginPlanEdit(concurrentA);
		const callB = await beginPlanEdit(concurrentB);
		applyPlanEdits(concurrentA);
		applyPlanEdits(concurrentB);
		await finishPlanEdit(callB, concurrentBAt);
		await finishPlanEdit(callA, concurrentAAt);
		await runPlanEdit(
			[
				{
					oldText: "- [x] Concurrent A.\n- [x] Concurrent B.",
					newText: "- [x] Concurrent B.\n- [x] Concurrent A.",
				},
			],
			firstAt + 6_500,
		);
		const reordered = readFlow(cwd).goals[0].checkAttribution ?? {};
		assert(
			Object.entries(reordered).some(
				([key, value]) =>
					key.includes("Concurrent A.") && value.at === concurrentAAt,
			) &&
				Object.entries(reordered).some(
					([key, value]) =>
						key.includes("Concurrent B.") && value.at === concurrentBAt,
				),
			"checkbox reorder moved attribution between items",
		);

		const failed = [
			{ oldText: "- [ ] Failed change.", newText: "- [x] Failed change." },
		];
		const failedCall = await beginPlanEdit(failed);
		applyPlanEdits(failed);
		await finishPlanEdit(failedCall, firstAt + 7_000, true);
		assert(
			!Object.keys(readFlow(cwd).goals[0].checkAttribution ?? {}).some((key) =>
				key.includes("Failed change."),
			),
			"failed edit attributed a checkbox transition",
		);
	} finally {
		Date.now = originalNow;
	}

	const attribution = readFlow(cwd).goals[0].checkAttribution ?? {};
	const entries = Object.entries(attribution);
	const first = entries.find(([key]) => key.includes("Renamed first change."));
	const second = entries.find(([key]) =>
		key.includes("Renamed second change."),
	);
	const third = entries.find(([key]) => key.includes("Third change."));
	const concurrentA = entries.find(([key]) => key.includes("Concurrent A."));
	const concurrentB = entries.find(([key]) => key.includes("Concurrent B."));
	const existing = entries.find(([key]) => key.includes("test"));
	assert(
		entries.length === 6 &&
			first?.[1].at === recheckedAt &&
			second?.[1].at === secondAt &&
			third?.[1].at === secondAt &&
			concurrentA?.[1].at === concurrentAAt &&
			concurrentB?.[1].at === concurrentBAt &&
			existing?.[1].at === existingAt &&
			[first, second, third, concurrentA, concurrentB].every(
				(entry) =>
					entry?.[1].model === "test/executor-model" &&
					entry[1].thinking === "high",
			) &&
			!entries.some(
				([key]) =>
					key.includes("External change.") || key.includes("Failed change."),
			),
		`checkbox attribution: ${JSON.stringify(attribution)}`,
	);

	const flowJsonPath = join(cwd, ".flow", "F1", "flow.json");
	const beforeRender = readFileSync(flowJsonPath, "utf8");
	const { renderFlowHtml } = await import(
		`file://${join(srcOut, "flow/html.js")}?attribution=${Date.now()}`
	);
	const html = renderFlowHtml(join(cwd, ".flow", "F1"), readFlow(cwd));
	renderFlowHtml(join(cwd, ".flow", "F1"), readFlow(cwd));
	assert(
		html.includes("executor-model") &&
			html.includes(">high</span>") &&
			html.includes("01-02 03:04:06") &&
			html.includes("01-02 03:04:08") &&
			html.includes("01-02 03:04:10") &&
			html.includes("01-02 03:04:11"),
		"checkbox attribution model or second-level time missing from Flow HTML",
	);
	assert(
		readFileSync(flowJsonPath, "utf8") === beforeRender,
		"rendering or refreshing the report mutated attribution state",
	);
}

async function flowCheckboxCountChangeAttributionScenario() {
	writeConfig({ acceptance: false, quality: false });
	const cwd = join(out, "flow-checkbox-count-change-attribution");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const planPath = join(cwd, ".flow", "F1", "G1-login.md");
	writeFileSync(
		planPath,
		readFileSync(planPath, "utf8").replace(
			"- [x] Ship login.",
			[
				"- [x] Removed change.",
				"- [ ] Existing change.",
				"- [x] Duplicate anchor.",
				"- [x] Duplicate change.",
				"- [x] Duplicate change.",
				"- [x] Rename me.",
				"- [x] Move me.",
				"- [x] Ambiguous A.",
				"- [x] Ambiguous B.",
				"- [x] Ambiguous duplicate.",
				"- [x] Ambiguous duplicate.",
				"- [ ] Mixed delete.",
				"- [x] Mixed delete.",
				"- [x] Mixed insert.",
				"- [ ] Mixed check.",
				"- [x] Mixed check.",
				"- [ ] Mixed swap.",
				"- [x] Mixed swap.",
			].join("\n"),
		),
	);
	const oldAt = new Date(2026, 0, 2, 3, 4, 1).getTime();
	const duplicateFirstAt = oldAt + 100;
	const duplicateSecondAt = oldAt + 200;
	const renameAt = oldAt + 300;
	const moveAt = oldAt + 400;
	const ambiguousAAt = oldAt + 500;
	const ambiguousBAt = oldAt + 600;
	const ambiguousDuplicateFirstAt = oldAt + 700;
	const ambiguousDuplicateSecondAt = oldAt + 800;
	const mixedDeleteAt = oldAt + 900;
	const mixedInsertAt = oldAt + 1_000;
	const mixedCheckAt = oldAt + 1_100;
	const mixedSwapAt = oldAt + 1_200;
	const key = (text, occurrence = 1) => `Steps\u0000${text}\u0000${occurrence}`;
	const existingFlow = readFlow(cwd);
	existingFlow.goals[0].checkAttribution = {
		[key("Removed change.")]: modelAttribution(oldAt),
		[key("Duplicate change.")]: modelAttribution(duplicateFirstAt),
		[key("Duplicate change.", 2)]: modelAttribution(duplicateSecondAt),
		[key("Rename me.")]: modelAttribution(renameAt),
		[key("Move me.")]: modelAttribution(moveAt),
		[key("Ambiguous A.")]: modelAttribution(ambiguousAAt),
		[key("Ambiguous B.")]: modelAttribution(ambiguousBAt),
		[key("Ambiguous duplicate.")]: modelAttribution(ambiguousDuplicateFirstAt),
		[key("Ambiguous duplicate.", 2)]: modelAttribution(
			ambiguousDuplicateSecondAt,
		),
		[key("Mixed delete.")]: modelAttribution(mixedDeleteAt),
		[key("Mixed insert.")]: modelAttribution(mixedInsertAt),
		[key("Mixed check.")]: modelAttribution(mixedCheckAt),
		[key("Mixed swap.")]: modelAttribution(mixedSwapAt),
	};
	writeFileSync(
		join(cwd, ".flow", "F1", "flow.json"),
		`${JSON.stringify(existingFlow, null, 2)}\n`,
	);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	await handlers.get("agent_start")({}, ctx);
	let toolCall = 0;
	const runPlanEdit = async (edits, at) => {
		const call = {
			toolCallId: `count-change-edit-${++toolCall}`,
			toolName: "edit",
			input: { path: ".flow/F1/G1-login.md", edits },
		};
		await handlers.get("tool_call")(call, ctx);
		let plan = readFileSync(planPath, "utf8");
		for (const edit of edits) plan = plan.replace(edit.oldText, edit.newText);
		writeFileSync(planPath, plan);
		Date.now = () => at;
		await handlers.get("tool_result")(
			{ ...call, isError: false, content: [] },
			ctx,
		);
	};
	const originalNow = Date.now;
	const mixedAt = oldAt + 1_000;
	const duplicateInsertAt = oldAt + 2_000;
	try {
		await runPlanEdit(
			[{ oldText: "- [x] Removed change.\n", newText: "" }],
			oldAt + 500,
		);
		assert(
			!(
				key("Removed change.") in
				(readFlow(cwd).goals[0].checkAttribution ?? {})
			),
			"deleted checked item kept stale attribution",
		);

		await runPlanEdit(
			[
				{
					oldText: "- [ ] Existing change.",
					newText:
						"- [x] Existing change.\n- [x] Added change.\n- [x] Removed change.",
				},
			],
			mixedAt,
		);
		const mixed = readFlow(cwd).goals[0].checkAttribution ?? {};
		assert(
			mixed[key("Existing change.")]?.at === mixedAt &&
				mixed[key("Added change.")]?.at === mixedAt &&
				mixed[key("Removed change.")]?.at === mixedAt,
			`count-changing completion attribution: ${JSON.stringify(mixed)}`,
		);

		await runPlanEdit(
			[
				{
					oldText: "- [x] Duplicate anchor.",
					newText: "- [x] Duplicate anchor.\n- [x] Duplicate change.",
				},
			],
			duplicateInsertAt,
		);
		const inserted = readFlow(cwd).goals[0].checkAttribution ?? {};
		assert(
			inserted[key("Duplicate change.")]?.at === duplicateInsertAt &&
				inserted[key("Duplicate change.", 2)]?.at === duplicateFirstAt &&
				inserted[key("Duplicate change.", 3)]?.at === duplicateSecondAt,
			`duplicate insertion moved attribution: ${JSON.stringify(inserted)}`,
		);

		await runPlanEdit(
			[
				{
					oldText: "- [x] Duplicate anchor.\n- [x] Duplicate change.",
					newText: "- [x] Duplicate anchor.",
				},
			],
			oldAt + 2_500,
		);
		const deletedDuplicate = readFlow(cwd).goals[0].checkAttribution ?? {};
		assert(
			deletedDuplicate[key("Duplicate change.")]?.at === duplicateFirstAt &&
				deletedDuplicate[key("Duplicate change.", 2)]?.at ===
					duplicateSecondAt &&
				!(key("Duplicate change.", 3) in deletedDuplicate),
			`duplicate deletion moved attribution: ${JSON.stringify(deletedDuplicate)}`,
		);

		await runPlanEdit(
			[
				{
					oldText: "- [x] Rename me.\n- [x] Move me.",
					newText: "- [x] Move me.\n- [x] Renamed item.",
				},
			],
			oldAt + 3_000,
		);
		const renamed = readFlow(cwd).goals[0].checkAttribution ?? {};
		assert(
			renamed[key("Renamed item.")]?.at === renameAt &&
				renamed[key("Move me.")]?.at === moveAt &&
				!(key("Rename me.") in renamed),
			`rename and reorder moved attribution: ${JSON.stringify(renamed)}`,
		);

		const ambiguousAt = oldAt + 4_000;
		await runPlanEdit(
			[
				{
					oldText: "- [x] Ambiguous A.\n- [x] Ambiguous B.",
					newText: "- [x] Ambiguous C.\n- [x] Ambiguous D.",
				},
			],
			ambiguousAt,
		);
		const ambiguous = readFlow(cwd).goals[0].checkAttribution ?? {};
		assert(
			ambiguous[key("Ambiguous C.")]?.at === ambiguousAt &&
				ambiguous[key("Ambiguous D.")]?.at === ambiguousAt &&
				!(key("Ambiguous A.") in ambiguous) &&
				!(key("Ambiguous B.") in ambiguous),
			`ambiguous rename reused old attribution: ${JSON.stringify(ambiguous)}`,
		);

		const ambiguousDuplicateAt = oldAt + 4_500;
		await runPlanEdit(
			[
				{
					oldText: "- [x] Ambiguous duplicate.\n- [x] Ambiguous duplicate.",
					newText: "- [x] Ambiguous duplicate.",
				},
			],
			ambiguousDuplicateAt,
		);
		const ambiguousDuplicate = readFlow(cwd).goals[0].checkAttribution ?? {};
		assert(
			ambiguousDuplicate[key("Ambiguous duplicate.")]?.at ===
				ambiguousDuplicateAt &&
				!(key("Ambiguous duplicate.", 2) in ambiguousDuplicate),
			`ambiguous duplicate reused old attribution: ${JSON.stringify(ambiguousDuplicate)}`,
		);

		await runPlanEdit(
			[
				{
					oldText: "- [ ] Mixed delete.\n- [x] Mixed delete.",
					newText: "- [x] Mixed delete.",
				},
			],
			oldAt + 5_000,
		);
		await runPlanEdit(
			[
				{
					oldText: "- [x] Mixed insert.",
					newText: "- [ ] Mixed insert.\n- [x] Mixed insert.",
				},
			],
			oldAt + 6_000,
		);
		const mixedTransitionAt = oldAt + 7_000;
		await runPlanEdit(
			[
				{
					oldText: "- [ ] Mixed check.\n- [x] Mixed check.",
					newText: "- [x] Mixed check.\n- [x] Mixed check.",
				},
			],
			mixedTransitionAt,
		);
		const mixedSwapCompletionAt = oldAt + 8_000;
		await runPlanEdit(
			[
				{
					oldText: "- [ ] Mixed swap.\n- [x] Mixed swap.",
					newText: "- [x] Mixed swap.\n- [ ] Mixed swap.",
				},
			],
			mixedSwapCompletionAt,
		);
		const mixedDuplicates = readFlow(cwd).goals[0].checkAttribution ?? {};
		assert(
			mixedDuplicates[key("Mixed delete.")]?.at === mixedDeleteAt &&
				mixedDuplicates[key("Mixed insert.")]?.at === mixedInsertAt &&
				mixedDuplicates[key("Mixed check.")]?.at === mixedTransitionAt &&
				mixedDuplicates[key("Mixed check.", 2)]?.at === mixedCheckAt &&
				mixedDuplicates[key("Mixed swap.")]?.at === mixedSwapCompletionAt,
			`mixed-state duplicate refreshed attribution: ${JSON.stringify(mixedDuplicates)}`,
		);
	} finally {
		Date.now = originalNow;
	}
}

function modelAttribution(at) {
	return { model: "test/previous-executor", thinking: "low", at };
}

async function flowCheckboxAttributionLockRecoveryScenario() {
	writeConfig({ acceptance: false, quality: false });
	const { acquireFlowLock } = await import(
		`file://${join(srcOut, "flow/lock.js")}?checkbox-lock=${Date.now()}`
	);
	const cwd = join(out, "flow-checkbox-attribution-lock-recovery");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const planPath = join(cwd, ".flow", "F1", "G1-login.md");
	writeFileSync(
		planPath,
		readFileSync(planPath, "utf8").replace(
			"- [x] Ship login.",
			[
				"- [ ] Lock retry A.",
				"- [ ] Lock retry B.",
				"- [ ] Lock retry pause.",
				"- [ ] Lock retry advance.",
			].join("\n"),
		),
	);
	const flowPath = join(cwd, ".flow", "F1", "flow.json");
	const initialFlow = readFlow(cwd);
	initialFlow.goals.push({
		...initialFlow.goals[0],
		index: 1,
		title: "Next",
		file: "G2-next.md",
		status: "pending",
		sessionFile: null,
		checks: emptyChecks(),
	});
	writeFileSync(flowPath, `${JSON.stringify(initialFlow, null, 2)}\n`);
	writeFileSync(
		join(cwd, ".flow", "F1", "G2-next.md"),
		"# Next\n\n## Steps\n- [ ] Next work.\n\n## Verification\n- [ ] Verify next.\n",
	);
	const state = createState();
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	await loaded.handlers.get("agent_start")({}, ctx);
	let toolCall = 0;
	const editWhileLocked = async (text, at, action) => {
		const call = {
			toolCallId: `locked-checkbox-edit-${++toolCall}`,
			toolName: "edit",
			input: {
				path: ".flow/F1/G1-login.md",
				edits: [
					{
						oldText: `- [ ] ${text}`,
						newText: `- [x] ${text}`,
					},
				],
			},
		};
		await loaded.handlers.get("tool_call")(call, ctx);
		const lock = acquireFlowLock(join(cwd, ".flow", "F1"), action);
		assert(lock.ok, `checkbox attribution lock failed: ${action}`);
		writeFileSync(
			planPath,
			readFileSync(planPath, "utf8").replace(`- [ ] ${text}`, `- [x] ${text}`),
		);
		const originalNow = Date.now;
		try {
			Date.now = () => at;
			await loaded.handlers.get("tool_result")(
				{ ...call, isError: false, content: [] },
				ctx,
			);
		} finally {
			Date.now = originalNow;
		}
		return lock;
	};
	const firstAt = new Date(2026, 0, 2, 3, 4, 20).getTime();
	const secondAt = firstAt + 1_000;
	const pausedAt = firstAt + 2_000;
	const advancedAt = firstAt + 3_000;
	const firstLock = await editWhileLocked(
		"Lock retry A.",
		firstAt,
		"hold first attribution",
	);
	assert(
		!readFlow(cwd).goals[0].checkAttribution,
		"locked attribution wrote through flow lock",
	);
	const pendingGoal = state.entries
		.filter((entry) => entry.customType === "goal-state")
		.at(-1)?.data?.goal;
	assert(
		pendingGoal?.checkAttribution?.["Steps\u0000Lock retry A.\u00001"]?.at ===
			firstAt,
		"locked attribution was not durable in the session entry",
	);
	const outbox = state.entries
		.filter((entry) => entry.customType === "checkbox-attribution-outbox")
		.at(-1)?.data?.pending?.[0];
	assert(
		outbox?.flowId === "F1" &&
			outbox.goalIndex === 0 &&
			outbox.goalFile === "G1-login.md" &&
			outbox.changes.some(
				(change) =>
					change.key === "Steps\u0000Lock retry A.\u00001" &&
					change.after?.at === firstAt,
			),
		"locked attribution outbox lost its stable target or original time",
	);
	firstLock.release();
	await waitFor(
		() =>
			readFlow(cwd).goals[0].checkAttribution?.[
				"Steps\u0000Lock retry A.\u00001"
			]?.at === firstAt,
		"released lock did not flush pending attribution",
	);
	assert(
		readFileSync(join(cwd, ".flow", "F1", "flow.html"), "utf8").includes(
			"01-02 03:04:20",
		),
		"released lock did not refresh checkbox attribution HTML",
	);

	const secondLock = await editWhileLocked(
		"Lock retry B.",
		secondAt,
		"hold attribution through restart",
	);
	loaded.handlers.get("session_shutdown")({}, ctx);
	secondLock.release();
	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	const recovered = readFlow(cwd).goals[0].checkAttribution ?? {};
	assert(
		recovered["Steps\u0000Lock retry A.\u00001"]?.at === firstAt &&
			recovered["Steps\u0000Lock retry B.\u00001"]?.at === secondAt,
		`restart lost pending attribution time: ${JSON.stringify(recovered)}`,
	);

	const pauseLock = await editWhileLocked(
		"Lock retry pause.",
		pausedAt,
		"pause while attribution is pending",
	);
	const pausedFlow = readFlow(cwd);
	pausedFlow.status = "paused";
	pausedFlow.goals[0].status = "paused";
	pausedFlow.goals[0].checkAttribution = {
		...(pausedFlow.goals[0].checkAttribution ?? {}),
		"Steps\u0000Concurrent fact.\u00001": modelAttribution(pausedAt + 500),
	};
	writeFileSync(flowPath, `${JSON.stringify(pausedFlow, null, 2)}\n`);
	pauseLock.release();
	await waitFor(
		() =>
			readFlow(cwd).goals[0].checkAttribution?.[
				"Steps\u0000Lock retry pause.\u00001"
			]?.at === pausedAt,
		"paused step lost pending attribution",
	);
	const pausedAttribution = readFlow(cwd).goals[0].checkAttribution ?? {};
	assert(
		pausedAttribution["Steps\u0000Concurrent fact.\u00001"]?.at ===
			pausedAt + 500 &&
			readFileSync(join(cwd, ".flow", "F1", "flow.html"), "utf8").includes(
				"01-02 03:04:22",
			),
		"paused attribution delta overwrote concurrent state or skipped HTML",
	);
	const resumedFlow = readFlow(cwd);
	resumedFlow.status = "running";
	resumedFlow.goals[0].status = "running";
	writeFileSync(flowPath, `${JSON.stringify(resumedFlow, null, 2)}\n`);

	const advanceLock = await editWhileLocked(
		"Lock retry advance.",
		advancedAt,
		"advance while attribution is pending",
	);
	const advancedFlow = readFlow(cwd);
	advancedFlow.goals[0].status = "complete";
	advancedFlow.goals[1].status = "running";
	advancedFlow.goals[1].sessionFile = join(cwd, "next-session.jsonl");
	advancedFlow.currentGoal = 1;
	writeFileSync(flowPath, `${JSON.stringify(advancedFlow, null, 2)}\n`);
	advanceLock.release();
	await waitFor(
		() =>
			readFlow(cwd).goals[0].checkAttribution?.[
				"Steps\u0000Lock retry advance.\u00001"
			]?.at === advancedAt,
		"advanced step lost pending attribution",
	);
	const settled = readFlow(cwd);
	assert(
		!settled.goals[1].checkAttribution?.[
			"Steps\u0000Lock retry advance.\u00001"
		] &&
			readFileSync(join(cwd, ".flow", "F1", "flow.html"), "utf8").includes(
				"01-02 03:04:23",
			),
		"advanced attribution targeted the wrong step or skipped HTML",
	);
}

function writeWorkerArtifactFixture(dir, sessionFile) {
	const artifactPath = join(dir, "G1-worker.json");
	writeFileSync(
		artifactPath,
		`${JSON.stringify(
			{
				schemaVersion: 3,
				flowId: "F1",
				goalIndex: 0,
				goalTitle: "Login",
				goalFile: "G1-login.md",
				parallelRunId: "P1",
				status: "running",
				completionCursor: null,
				runtimeGoalId: null,
				sessionFile,
				sessionName: "F1-G1 Login",
				result: { summary: null, outcome: null },
				checks: emptyChecks(),
				checkAttribution: {},
				handoff: null,
				completion: null,
				updatedAt: Date.now(),
			},
			null,
			2,
		)}\n`,
	);
	return artifactPath;
}

async function startWorkerArtifactGoal(module, ctx, dir, artifactPath) {
	await module.startGoalFromFlow("Worker objective", ctx, {
		artifact: {
			artifactId: "G1",
			artifactPlanPath: join(dir, "G1-login.md"),
			artifactPlanDisplayPath: ".flow/F1/G1-login.md",
			artifactStatePath: artifactPath,
			artifactStateDisplayPath: "G1-worker.json",
		},
		rememberFlowContext: false,
	});
}

// worker 拓扑的接管收口：异常事实写自身 artifact（paused + handoff）并发 blocked 事件，禁碰父 flow.json。
async function workerAcceptanceConfigErrorHandoffScenario() {
	writeConfig({ acceptance: true, quality: false });
	const cwd = join(out, "worker-acceptance-config-error");
	const sessionFile = join(cwd, "worker-session.jsonl");
	writeFlow(cwd, sessionFile);
	const dir = join(cwd, ".flow", "F1");
	const artifactPath = writeWorkerArtifactFixture(dir, sessionFile);
	const state = createState();
	state.missingModels.add("test/gpt-5.4-mini");
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	const { onFlowGoalBlocked } = await import(
		`file://${join(srcOut, "flow/goal-events.js")}`
	);
	const blockedEvents = [];
	const unsubscribe = onFlowGoalBlocked((handoff) =>
		blockedEvents.push(handoff),
	);
	const flowJsonBefore = readFileSync(join(dir, "flow.json"), "utf8");
	try {
		await startWorkerArtifactGoal(module, ctx, dir, artifactPath);
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	} finally {
		unsubscribe();
	}
	const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
	assert(
		artifact.status === "paused" &&
			artifact.handoff?.kind === "user_action_required" &&
			artifact.handoff.message.length > 0 &&
			artifact.completion === null,
		`config error artifact: ${JSON.stringify({ status: artifact.status, handoff: artifact.handoff })}`,
	);
	assert(
		blockedEvents.some((item) => item.message === artifact.handoff.message),
		`config error blocked event missing: ${JSON.stringify(blockedEvents)}`,
	);
	assert(
		readFileSync(join(dir, "flow.json"), "utf8") === flowJsonBefore,
		"worker config error touched parent flow.json",
	);
}

async function workerAcceptanceHardCapHandoffScenario() {
	const command = captureCommand("FAIL\n仍未通过\n");
	writeConfig({
		acceptance: true,
		quality: false,
		command,
		advisor: { enabled: false },
	});
	const cwd = join(out, "worker-acceptance-hard-cap");
	const sessionFile = join(cwd, "worker-session.jsonl");
	writeFlow(cwd, sessionFile);
	const dir = join(cwd, ".flow", "F1");
	const artifactPath = writeWorkerArtifactFixture(dir, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	const { onFlowGoalBlocked } = await import(
		`file://${join(srcOut, "flow/goal-events.js")}`
	);
	const blockedEvents = [];
	const unsubscribe = onFlowGoalBlocked((handoff) =>
		blockedEvents.push(handoff),
	);
	const flowJsonBefore = readFileSync(join(dir, "flow.json"), "utf8");
	// worker 修订仲裁基线取自 flow.json 快照：启动前修订计划，检查 prompt 必须注入 diff。
	const workerPlanPath = join(dir, "G1-login.md");
	writeFileSync(
		workerPlanPath,
		readFileSync(workerPlanPath, "utf8").replace(
			"- Flow plan proof.",
			"- Flow plan proof revised.",
		),
	);
	try {
		await startWorkerArtifactGoal(module, ctx, dir, artifactPath);
		for (let round = 1; round <= 10; round += 1) {
			await handlers.get("agent_end")(
				{ messages: [{ role: "assistant", stopReason: "stop" }] },
				ctx,
			);
		}
	} finally {
		unsubscribe();
	}
	const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
	assert(
		artifact.status === "paused" &&
			artifact.handoff?.kind === "user_action_required" &&
			artifact.handoff.message.includes("连续 10 轮") &&
			artifact.completion === null,
		`hard cap artifact: ${JSON.stringify({ status: artifact.status, handoff: artifact.handoff })}`,
	);
	assert(
		blockedEvents.some((item) => item.message === artifact.handoff.message),
		`hard cap blocked event missing: ${JSON.stringify(blockedEvents)}`,
	);
	assert(
		readFileSync(join(dir, "flow.json"), "utf8") === flowJsonBefore,
		"worker hard cap touched parent flow.json",
	);
	const workerCheckArgs = readFileSync(`${command}.args`, "utf8");
	assert(
		workerCheckArgs.includes("计划修订检测") &&
			workerCheckArgs.includes(
				"+ [Success Criteria] - Flow plan proof revised.",
			),
		`worker plan change note missing: ${workerCheckArgs.slice(0, 2000)}`,
	);
}

async function workerCheckboxAttributionScenario() {
	writeConfig({ acceptance: false, quality: false });
	const cwd = join(out, "worker-checkbox-attribution");
	const sessionFile = join(cwd, "worker-session.jsonl");
	writeFlow(cwd, sessionFile);
	const dir = join(cwd, ".flow", "F1");
	const planPath = join(dir, "G1-login.md");
	const artifactPath = join(dir, "G1-worker.json");
	const existingAt = new Date(2026, 0, 2, 3, 4, 1).getTime();
	const at = new Date(2026, 0, 2, 3, 4, 9).getTime();
	writeFileSync(
		planPath,
		readFileSync(planPath, "utf8").replace(
			"- [x] Ship login.",
			"- [x] Existing change.\n- [ ] New change.",
		),
	);
	writeFileSync(
		artifactPath,
		`${JSON.stringify(
			{
				schemaVersion: 3,
				flowId: "F1",
				goalIndex: 0,
				goalTitle: "Login",
				goalFile: "G1-login.md",
				parallelRunId: "P1",
				status: "running",
				completionCursor: null,
				runtimeGoalId: null,
				sessionFile,
				sessionName: "F1-G1 Login",
				result: { summary: null, outcome: null },
				checks: emptyChecks(),
				checkAttribution: {
					"Steps\u0000Existing change.\u00001": {
						model: "test/previous-worker",
						thinking: "low",
						at: existingAt,
					},
				},
				handoff: null,
				completion: null,
				updatedAt: Date.now(),
			},
			null,
			2,
		)}\n`,
	);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Worker objective", ctx, {
		artifact: {
			artifactId: "G1",
			artifactPlanPath: planPath,
			artifactPlanDisplayPath: ".flow/F1/G1-login.md",
			artifactStatePath: artifactPath,
			artifactStateDisplayPath: "G1-worker.json",
		},
		rememberFlowContext: false,
	});
	await handlers.get("agent_start")({}, ctx);
	const originalNow = Date.now;
	try {
		const edit = {
			toolCallId: "worker-plan-edit",
			toolName: "edit",
			input: {
				path: planPath,
				edits: [
					{
						oldText: "- [ ] New change.",
						newText: "- [x] New change.",
					},
				],
			},
		};
		await handlers.get("tool_call")(edit, ctx);
		writeFileSync(
			planPath,
			readFileSync(planPath, "utf8").replace(
				"- [ ] New change.",
				"- [x] New change.",
			),
		);
		Date.now = () => at;
		await handlers.get("tool_result")(
			{ ...edit, isError: false, content: [] },
			ctx,
		);
	} finally {
		Date.now = originalNow;
	}
	const entries = Object.entries(
		JSON.parse(readFileSync(artifactPath, "utf8")).checkAttribution ?? {},
	);
	const existing = entries.find(([key]) => key.includes("Existing change."));
	const added = entries.find(([key]) => key.includes("New change."));
	assert(
		entries.length === 2 &&
			existing?.[1].at === existingAt &&
			existing?.[1].model === "test/previous-worker" &&
			added?.[1].at === at &&
			added?.[1].model === "test/executor-model",
		`worker checkbox attribution: ${JSON.stringify(entries)}`,
	);
}

async function flowQualityAdvisorConsultScenario() {
	const failCommand = script("FAIL\n质量不达标\n");
	const advisor = advisorScript("建议路径：改用事件驱动实现");
	writeConfig({
		acceptance: false,
		quality: true,
		command: advisor,
		models: [
			{ model: "test/gpt-5.4-mini", thinking: "off", command: failCommand },
		],
		modelRoles: {
			advisor: { model: "test/advisor-x", thinking: "off" },
		},
	});
	const cwd = join(out, "flow-quality-advisor");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	// 跑满 10 轮到硬上限收口，避免质检循环在场景间泄漏 awaitingAgent 状态。
	for (let round = 1; round <= 10; round += 1) {
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	}
	const failCards = state.messages.filter((item) =>
		item.message.details?.title.includes("质检未通过"),
	);
	assert(failCards.length === 10, `quality fail cards: ${failCards.length}`);
	const roundTwo = failCards[1];
	assert(
		!roundTwo.message.content.includes("顾问建议") &&
			roundTwo.message.details.lines.some((line) =>
				line.includes("连续 2 轮未通过 · 正在咨询顾问"),
			),
		roundTwo.message.content,
	);
	const adviceCards = state.messages.filter(
		(item) =>
			item.message.details?.title === "顾问建议" &&
			item.message.details?.deliveryId?.endsWith(":repair"),
	);
	assert(
		adviceCards.length === 4,
		`quality advisor cards: ${adviceCards.length}`,
	);
	const roundTwoAdvice = adviceCards[0];
	assert(
		state.messages.indexOf(roundTwo) < state.messages.indexOf(roundTwoAdvice) &&
			roundTwoAdvice.options.triggerTurn === true &&
			roundTwoAdvice.message.details.advisor?.advice.includes(
				"建议路径：改用事件驱动实现",
			),
		"quality failure card must precede the advisor repair card",
	);
	const repairPrompt = roundTwoAdvice.message.content;
	assert(
		repairPrompt.indexOf("检查结果：") < repairPrompt.indexOf("顾问建议：") &&
			repairPrompt.indexOf("顾问建议：") < repairPrompt.indexOf("下一步：") &&
			repairPrompt.indexOf("下一步：") < repairPrompt.indexOf("修订许可") &&
			adviceCards[1].message.content.includes("修订许可"),
		"quality advisor repair prompt order changed",
	);
	assert(
		failCards.every((card) => !card.message.content.includes("顾问建议")) &&
			!failCards[9].message.details.lines.some((line) =>
				line.includes("正在咨询顾问"),
			),
		"quality advisor advice leaked into a failure card",
	);
	const calls = Number(readFileSync(`${advisor}.count`, "utf8").trim());
	assert(calls === 4, `quality advisor calls: ${calls}`);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`quality hard cap status: ${module.getGoalState(ctx)?.status}`,
	);
	const args = readFileSync(`${advisor}.args`, "utf8");
	assert(
		args.includes("test/advisor-x"),
		`explicit advisor model not used: ${args.slice(0, 500)}`,
	);
	const rounds = readFlow(cwd).goals[0].checks.quality.rounds;
	assert(
		rounds[1].advisor?.advice.includes("建议路径：改用事件驱动实现") &&
			rounds[1].advisor.model === "test/advisor-x" &&
			rounds[7].advisor?.advice.includes("建议路径：改用事件驱动实现"),
		JSON.stringify(rounds),
	);
}

async function flowAdvisorFailureDoesNotBlockScenario() {
	// 顾问与 Reviewer 共用后台配置；测试路由器仅按 prompt/model 模拟不同结果。
	const cases = [
		{ dir: "flow-advisor-broken", runnerCommand: shellScript("exit 7") },
		{ dir: "flow-advisor-empty", runnerCommand: shellScript("exit 0") },
		{
			dir: "flow-advisor-timeout",
			runnerCommand: shellScript("sleep 10"),
			timeoutMs: 5000,
		},
		{
			dir: "flow-advisor-model-window",
			runnerCommand: shellScript("exit 9"),
			missingAdvisor: true,
		},
	];
	for (const item of cases) {
		const failCommand = script("FAIL\n验收不通过\n");
		writeConfig({
			acceptance: true,
			quality: false,
			command: item.runnerCommand,
			models: [
				{
					model: "test/gpt-5.4-mini",
					thinking: "off",
					command: failCommand,
				},
			],
			modelRoles: { advisor: { model: "test/advisor-x", thinking: "off" } },
			...(item.timeoutMs ? { timeoutMs: item.timeoutMs } : {}),
		});
		const cwd = join(out, item.dir);
		const sessionFile = join(cwd, "goal-session.jsonl");
		writeFlow(cwd, sessionFile);
		const state = createState();
		if (item.missingAdvisor) state.missingModels.add("test/advisor-x");
		const { handlers, module } = await loadGoalExtension(state);
		const ctx = mockContext(state, cwd, sessionFile);
		await module.startGoalFromFlow("Flow objective", ctx);
		for (let round = 1; round <= 3; round += 1) {
			await handlers.get("agent_end")(
				{ messages: [{ role: "assistant", stopReason: "stop" }] },
				ctx,
			);
		}
		const failCards = state.messages.filter((entry) =>
			entry.message.details?.title.includes("验收未通过"),
		);
		assert(
			failCards.length === 3,
			`${item.dir} fail cards: ${failCards.length}`,
		);
		const roundThree = failCards[2].message.content;
		assert(
			!roundThree.includes("顾问建议") && roundThree.includes("修订许可"),
			`${item.dir}: ${roundThree}`,
		);
		assert(
			module.getGoalState(ctx)?.status === "active",
			`${item.dir} advisor failure blocked repair: ${module.getGoalState(ctx)?.status}`,
		);
		// 咨询期间以「顾问介入中」活动框呈现（不再发 notice）；失败仍必须显式通知。
		assert(
			widgetTexts(state).some((text) => text.includes("顾问介入中")),
			`${item.dir} consulting activity box missing`,
		);
		const failure = state.notifications.find((entry) =>
			entry.includes("顾问咨询失败"),
		);
		assertNoticeFormat(failure, "⚠️", "检查反馈已照常投递");
	}
}

async function flowAdvisorStopDuringConsultScenario() {
	const failCommand = script("FAIL\n验收不通过\n");
	writeConfig({
		acceptance: true,
		quality: false,
		command: shellScript("sleep 30"),
		models: [
			{ model: "test/gpt-5.4-mini", thinking: "off", command: failCommand },
		],
		modelRoles: { advisor: { model: "test/advisor-x", thinking: "off" } },
	});
	const cwd = join(out, "flow-advisor-stop-race");
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
	const pending = handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await waitFor(
		() => widgetTexts(state).some((text) => text.includes("顾问介入中")),
		"advisor consultation did not start",
	);
	const paused = await module.pauseGoalFromFlow(ctx);
	assert(paused === true, "stop during consultation did not pause the goal");
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`stop during consultation status: ${module.getGoalState(ctx)?.status}`,
	);
	// abort 必须终止顾问子进程（sleep 30）；若未终止，agent_end 会等到超时，这里会判 slow。
	const raced = await Promise.race([
		pending.then(() => "done"),
		new Promise((resolve) => setTimeout(() => resolve("slow"), 10000)),
	]);
	assert(raced === "done", "advisor subprocess was not aborted on stop");
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`advisor completion reactivated stopped goal: ${module.getGoalState(ctx)?.status}`,
	);
	const failCards = state.messages.filter((item) =>
		item.message.details?.title.includes("验收未通过"),
	);
	assert(
		failCards.length === 2 &&
			failCards[1].message.details.lines.some((line) =>
				line.includes("正在咨询顾问"),
			),
		`round-2 failure fact was not durable before stop: ${failCards.length}`,
	);
	assert(
		!state.notifications.some((item) => item.includes("顾问咨询失败")),
		state.notifications.join("\n"),
	);
}

async function flowQualityAdvisorStopDuringConsultScenario() {
	const failCommand = script("FAIL\n质量不达标\n");
	writeConfig({
		acceptance: false,
		quality: true,
		command: shellScript("sleep 30"),
		models: [
			{ model: "test/gpt-5.4-mini", thinking: "off", command: failCommand },
		],
		modelRoles: { advisor: { model: "test/advisor-x", thinking: "off" } },
	});
	const cwd = join(out, "flow-quality-advisor-stop-race");
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
	const pending = handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await waitFor(
		() => widgetTexts(state).some((text) => text.includes("顾问介入中")),
		"quality advisor consultation did not start",
	);
	const paused = await module.pauseGoalFromFlow(ctx);
	assert(paused === true, "quality stop during consultation did not pause");
	const raced = await Promise.race([
		pending.then(() => "done"),
		new Promise((resolve) => setTimeout(() => resolve("slow"), 10000)),
	]);
	assert(
		raced === "done",
		"quality advisor subprocess was not aborted on stop",
	);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`quality advisor completion changed stopped goal: ${module.getGoalState(ctx)?.status}`,
	);
	const failCards = state.messages.filter((item) =>
		item.message.details?.title.includes("质检未通过"),
	);
	assert(
		failCards.length === 2 &&
			failCards[1].message.details.lines.some((line) =>
				line.includes("正在咨询顾问"),
			),
		`round-2 quality failure fact was not durable before stop: ${failCards.length}`,
	);
	assert(
		!state.notifications.some((item) => item.includes("顾问咨询失败")),
		state.notifications.join("\n"),
	);
}

async function flowQualityRevisionPermissionScenario() {
	const command = captureCommand("FAIL\n质量不达标\n");
	writeConfig({ acceptance: false, quality: true, command });
	const cwd = join(out, "flow-quality-revision");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	for (let round = 1; round <= 10; round += 1) {
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	}
	const qualityArgs = readFileSync(`${command}.args`, "utf8");
	assert(
		qualityArgs.includes("范围完整性已由前置验收把关") &&
			qualityArgs.includes("重心放在实现质量"),
		qualityArgs.slice(0, 2000),
	);
	const failCards = state.messages.filter((item) =>
		item.message.details?.title.includes("质检未通过"),
	);
	assert(failCards.length === 10, `quality fail cards: ${failCards.length}`);
	assert(
		!failCards[0].message.content.includes("修订许可"),
		"quality revision clause leaked before round 2",
	);
	assert(
		failCards[1].message.content.includes("修订许可"),
		failCards[1].message.content,
	);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`quality hard cap status: ${module.getGoalState(ctx)?.status}`,
	);
	const blockedCards = state.messages.filter((item) =>
		item.message.content?.includes("已连续 10 轮检查未通过"),
	);
	assert(
		blockedCards.length === 1,
		`quality hard cap cards: ${blockedCards.length}`,
	);
	assert(
		!state.messages.some((item) =>
			/未完成/u.test(item.message.details?.title ?? ""),
		),
		state.messages.map((item) => item.message.details?.title).join(" | "),
	);
}

async function flowAcceptanceCancelHasSingleSurfaceScenario() {
	const command = interruptOnceScript(
		"PASS\n验收通过\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-cancel-single-surface");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	const attention = await attentionProbe();
	const completing = handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await new Promise((resolve) => setImmediate(resolve));
	const { cancelActiveFlowActivity } = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}`
	);
	state.dropGoalStateWrites = true;
	cancelActiveFlowActivity();
	await completing;
	state.dropGoalStateWrites = false;
	attention.unsubscribe();
	assert(
		attention.sources.length === 0,
		`cancelled acceptance requested attention: ${attention.sources.join(" | ")}`,
	);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`cancelled acceptance status: ${module.getGoalState(ctx)?.status}`,
	);
	const cancelNotices = state.notifications.filter((item) =>
		item.includes("验收已取消"),
	);
	assert(cancelNotices.length === 1, state.notifications.join("\n"));
	assertNoticeFormat(cancelNotices[0], "⏸", "验收已取消");
	const flow = readFlow(cwd);
	assert(
		flow.status === "paused" && flow.goals[0].status === "running",
		`acceptance cancel canonical status: ${JSON.stringify(flow.goals[0])}`,
	);
	assert(
		flow.goals[0].completionCursor === "acceptance_retry" &&
			flow.goals[0].checks.acceptance.active === null &&
			flow.goals[0].checks.acceptance.rounds.length === 0,
		`acceptance cancel checkpoint: ${JSON.stringify(flow.goals[0])}`,
	);
	assert(
		!state.messages.some((entry) =>
			/验收错误|验收未完成/u.test(entry.message.details?.title ?? ""),
		),
		state.messages.map((entry) => entry.message.details?.title).join(" | "),
	);
	const goalWidgets = state.widgets.filter(
		(entry) => entry.key === "goal-progress",
	);
	assert(
		goalWidgets.at(-1)?.content,
		"acceptance cancel cleared paused widget",
	);
	assert(
		widgetTexts({ widgets: [goalWidgets.at(-1)] }).some((text) =>
			text.includes("已暂停"),
		),
		"acceptance cancel did not retain paused widget",
	);
	const runsBeforeRestart = scriptRunCount(command);
	const reloaded = await loadGoalExtension(state);
	const restartCtx = mockContext(state, cwd, sessionFile);
	reloaded.handlers.get("session_start")({}, restartCtx);
	assert(
		reloaded.module.getGoalState(restartCtx)?.status === "paused",
		"canonical pause did not reconcile a stale session Goal",
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert(
		scriptRunCount(command) === runsBeforeRestart,
		`restart changed cancelled acceptance runs: ${runsBeforeRestart} -> ${scriptRunCount(command)}`,
	);
}

async function flowQualityCancelHasSingleSurfaceScenario() {
	writeConfig({
		acceptance: false,
		quality: true,
		command: shellScript("sleep 30"),
	});
	const cwd = join(out, "flow-quality-cancel-single-surface");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	const completing = handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert(
		!widgetTexts(state).some((text) => text.includes("思考中 · 0 calls")),
		"goal-scoped quality rendered a reviewer spinner before its first event",
	);
	const { cancelActiveFlowActivity } = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}`
	);
	cancelActiveFlowActivity();
	await completing;
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`cancelled quality status: ${module.getGoalState(ctx)?.status}`,
	);
	const terminalCards = state.messages.filter((entry) =>
		/质检错误|质检未完成|未完成/u.test(entry.message.details?.title ?? ""),
	);
	assert(
		terminalCards.length === 0,
		`cancel sent terminal cards: ${terminalCards.map((entry) => entry.message.details?.title).join(" | ")}`,
	);
	const cancelNotices = state.notifications.filter((item) =>
		item.includes("质检已取消"),
	);
	assert(cancelNotices.length === 1, state.notifications.join("\n"));
	assertNoticeFormat(cancelNotices[0], "⏸", "质检已取消");
	const flow = readFlow(cwd);
	assert(
		flow.status === "paused" && flow.goals[0].status === "running",
		`quality cancel canonical status: ${JSON.stringify(flow.goals[0])}`,
	);
	assert(
		flow.goals[0].completionCursor === "quality_retry" &&
			flow.goals[0].checks.quality.active === null &&
			flow.goals[0].checks.quality.rounds.length === 0,
		`quality cancel checkpoint: ${JSON.stringify(flow.goals[0])}`,
	);
}

async function flowAcceptanceConfigErrorPausesCleanlyScenario() {
	writeConfig({ acceptance: true, quality: false });
	const cwd = join(out, "flow-acceptance-config-error");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	writeConfig({
		acceptance: true,
		quality: false,
		modelRoles: { executor: { model: "current" } },
	});
	const activity = await activityProbe();
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	activity.unsubscribe();
	assert(
		!acceptanceActivityStarted(activity),
		"acceptance config error emitted a false activity signal",
	);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`acceptance config error goal status: ${module.getGoalState(ctx)?.status}`,
	);
	const flow = readFlow(cwd);
	assert(
		flow.status === "paused",
		`acceptance config error Flow status: ${flow.status}`,
	);
	assert(
		flow.goals[0].completionCursor === "acceptance_retry" &&
			flow.goals[0].checks.acceptance.rounds.length === 0 &&
			flow.goals[0].checks.acceptance.active === null,
		`acceptance config error state: ${JSON.stringify(flow.goals[0])}`,
	);
	assert(
		!state.messages.some((item) => item.message.details?.title === "验收中"),
		"acceptance config error emitted a false start card",
	);
	const blocked = state.messages.filter((item) =>
		item.message.content.includes("验收配置读取失败"),
	);
	assert(
		blocked.length === 1,
		`acceptance config error cards: ${blocked.length}`,
	);
	assert(
		blocked[0].message.content.includes("验收无法启动"),
		blocked[0].message.content,
	);
}

async function flowAcceptanceContextModelFailurePausesScenario() {
	writeConfig({ acceptance: true, quality: false });
	const cwd = join(out, "flow-acceptance-context-model-error");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	state.missingModels.add("test/gpt-5.4-mini");
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		"unbudgeted acceptance continued",
	);
	const flow = readFlow(cwd);
	assert(
		flow.status === "paused" &&
			flow.goals[0].checks.acceptance.active === null &&
			flow.goals[0].checks.acceptance.rounds.length === 0,
		JSON.stringify(flow.goals[0].checks.acceptance),
	);
	const card = state.messages.find((item) =>
		item.message.content.includes("无法解析模型窗口"),
	);
	assert(card?.message.content.includes("验收无法启动"), JSON.stringify(card));
}

async function flowQualityConfigErrorPausesCleanlyScenario() {
	const command = captureCommand("FAIL\n质量不达标\n");
	writeConfig({ acceptance: false, quality: true, command });
	const cwd = join(out, "flow-quality-config-error");
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
	assert(
		await module.pauseGoalFromFlow(ctx),
		"quality repair did not pause before config error repro",
	);
	assert(
		(await module.resumePausedGoalFromFlow(ctx)) === "resumed",
		"quality repair did not resume before config error repro",
	);
	const qualityStarts = state.messages.filter(
		(item) => item.message.details?.title === "质检中",
	).length;
	writeConfig({
		acceptance: false,
		quality: true,
		command,
		modelRoles: { executor: { model: "current" } },
	});
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`config error goal status: ${module.getGoalState(ctx)?.status}`,
	);
	const flow = readFlow(cwd);
	assert(flow.status === "paused", `config error Flow status: ${flow.status}`);
	assert(
		flow.goals[0].completionCursor === "quality_retry",
		`config error cursor: ${flow.goals[0].completionCursor}`,
	);
	assert(
		state.messages.filter((item) => item.message.details?.title === "质检中")
			.length === qualityStarts,
		"config error emitted a false quality start card",
	);
	const blocked = state.messages.filter((item) =>
		item.message.content.includes("质检配置读取失败"),
	);
	assert(blocked.length === 1, `config error cards: ${blocked.length}`);
	assert(
		blocked[0].message.content.includes("质检无法启动"),
		blocked[0].message.content,
	);
	const reviewWidgets = state.widgets.filter(
		(item) => item.key === "review-progress",
	);
	assert(
		reviewWidgets.at(-1)?.content === undefined,
		"config error left the quality repair widget visible",
	);
	const goalWidgets = state.widgets.filter(
		(item) => item.key === "goal-progress",
	);
	assert(
		widgetTexts({ widgets: [goalWidgets.at(-1)] }).some((text) =>
			text.includes("已暂停"),
		),
		"config error did not leave one paused goal widget",
	);

	const passCommand = captureCommand(
		"PASS\n质量通过\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeConfig({ acceptance: false, quality: true, command: passCommand });
	writeFileSync(
		join(cwd, ".flow", "F1", "flow.json"),
		JSON.stringify({ ...flow, status: "running" }),
	);
	const promptsBeforeResume = state.sentMessages.length;
	assert(
		(await module.resumePausedGoalFromFlow(ctx)) === "continued",
		"fixed config did not continue directly from quality_retry",
	);
	const passArgs = readFileSync(`${passCommand}.args`, "utf8");
	assert(
		passArgs.includes("以下目标对应的交付质量"),
		"fixed config did not retry quality",
	);
	assert(
		state.sentMessages.length === promptsBeforeResume,
		"fixed config reran the repair prompt instead of quality",
	);
}

async function flowAcceptanceConfigErrorPauseRespectsFlowLockScenario() {
	const command = sequenceScript([
		"PASS\n验收通过\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeConfig({ acceptance: true, quality: false, command });
	const { acquireFlowLock } = await import(
		`file://${join(srcOut, "flow/lock.js")}?config-lock=${Date.now()}`
	);
	const cwd = join(out, "flow-acceptance-config-error-lock");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	// 运行后写入非法配置（executor 不允许 current）：验收启动时触发配置错误路径。
	writeConfig({
		acceptance: true,
		quality: false,
		command,
		modelRoles: { executor: { model: "current" } },
	});
	const flowDir = join(cwd, ".flow", "F1");
	const lock = acquireFlowLock(flowDir, "config error pause repro");
	assert(lock.ok, "flow lock was not acquired");
	try {
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
		// canonical 提交失败时禁止假暂停：session Goal 保持 active，flow 保持 running。
		assert(
			module.getGoalState(ctx)?.status === "active",
			`lock conflict produced a fake pause: ${module.getGoalState(ctx)?.status}`,
		);
		const flow = readFlow(cwd);
		assert(
			flow.status === "running",
			`lock conflict changed flow status: ${flow.status}`,
		);
		assert(
			!state.messages.some((item) =>
				(item.message.details?.title ?? "").includes("已暂停"),
			),
			"lock conflict emitted a pause card",
		);
	} finally {
		lock.release();
	}
}

async function flowQualityMidLoopConfigErrorPausesScenario() {
	const command = sequenceScript(["FAIL\n质量缺陷\n"]);
	writeConfig({ acceptance: false, quality: true, command });
	const cwd = join(out, "flow-quality-midloop-config-error");
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
	assert(
		scriptRunCount(command) === 1,
		`first quality round did not run: ${scriptRunCount(command)}`,
	);
	// 修复回合期间直接写入非法配置（不 pause/resume，保持活跃循环）。
	writeFileSync(join(out, "config.json"), "{");
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`mid-loop config error goal status: ${module.getGoalState(ctx)?.status}`,
	);
	assert(
		scriptRunCount(command) === 1,
		`stale reviewer ran after config became invalid: ${scriptRunCount(command)}`,
	);
	const flow = readFlow(cwd);
	assert(
		flow.status === "paused" &&
			flow.goals[0].completionCursor === "quality_repair",
		`mid-loop config error flow state: ${flow.status}/${flow.goals[0].completionCursor}`,
	);
	assert(
		state.messages.filter((item) => item.message.details?.title === "质检中")
			.length === 1,
		"invalid mid-loop config emitted a second quality start card",
	);
	writeConfig({ acceptance: false, quality: true, command });
}

async function flowQualityRepairCursorSurvivesAbortScenario() {
	const command = captureCommand("FAIL\n质量不达标\n");
	writeConfig({ acceptance: false, quality: true, command });
	const cwd = join(out, "flow-quality-repair-cursor");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	for (let round = 1; round <= 2; round += 1) {
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
		const cursor = readFlow(cwd).goals[0].completionCursor;
		assert(
			cursor === "quality_repair",
			`round ${round} repair cursor: ${cursor}`,
		);
	}
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "aborted" }] },
		ctx,
	);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`aborted repair status: ${module.getGoalState(ctx)?.status}`,
	);
	const pausedCards = state.messages.filter((item) =>
		item.message.details?.title.includes("Flow 第 1 步 · Login 已暂停"),
	);
	assert(
		pausedCards.length === 1,
		`aborted repair cards: ${pausedCards.length}`,
	);
	assert(
		!state.notifications.some((item) => item.includes("质检自动循环已停止")),
		state.notifications.join("\n"),
	);
	const cursor = readFlow(cwd).goals[0].completionCursor;
	assert(cursor === "quality_repair", `aborted repair cursor: ${cursor}`);
	const qualityStartsBeforeResume = state.messages.filter(
		(item) => item.message.details?.title === "质检中",
	).length;
	const resumed = await module.resumePausedGoalFromFlow(ctx);
	assert(resumed === "resumed", `paused repair resume result: ${resumed}`);
	assert(
		module.getGoalState(ctx)?.status === "active",
		`resumed repair status: ${module.getGoalState(ctx)?.status}`,
	);
	assert(
		state.sentMessages.at(-1)?.includes("用户恢复此步骤后已离场"),
		`paused repair resume prompt: ${state.sentMessages.at(-1)}`,
	);
	const qualityStartsAfterResume = state.messages.filter(
		(item) => item.message.details?.title === "质检中",
	).length;
	assert(
		qualityStartsAfterResume === qualityStartsBeforeResume,
		"paused quality repair resume restarted the quality check instead of continuing the repair",
	);
}

async function flowCheckHardCapPausesScenario() {
	const command = captureCommand("FAIL\n验收不通过\n");
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-check-hard-cap");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	const attention = await attentionProbe();
	for (let round = 1; round <= 10; round += 1) {
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	}
	attention.unsubscribe();
	assert(
		attention.sources.length === 1 &&
			attention.sources[0].startsWith("pi-flow:goal:"),
		`hard-cap attention mismatch: ${attention.sources.join(" | ")}`,
	);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`goal status: ${module.getGoalState(ctx)?.status}`,
	);
	const pausedCard = state.messages.find(
		(item) => item.message.details?.title === "Flow Login 已暂停",
	);
	assert(
		pausedCard,
		state.messages.map((item) => item.message.details?.title).join(" | "),
	);
	assert(
		pausedCard.message.content.includes("已连续 10 轮检查未通过") &&
			pausedCard.message.content.includes("/flow go F1"),
		pausedCard.message.content,
	);
	const failCards = state.messages.filter((item) =>
		item.message.details?.title.includes("验收未通过"),
	);
	assert(failCards.length === 9, `repair cards: ${failCards.length}`);
}

async function flowAcceptanceHardCapDeliveryFailureScenario() {
	const command = countedScript(["FAIL\n验收不通过\n"], "*) cat '{{last}}' ;;");
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-hard-cap-delivery");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	state.failResultCardTitle = "Flow Login 已暂停";
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	for (let round = 1; round <= 10; round += 1)
		await loaded.handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	let flow = readFlow(cwd);
	assert(
		loaded.module.getGoalState(ctx)?.status === "active" &&
			flow.goals[0].completionCursor === "acceptance_retry" &&
			flow.goals[0].checks.acceptance.rounds.length === 9 &&
			flow.goals[0].checks.acceptance.active?.round === 10,
		`acceptance hard-cap delivery failure committed pause: ${JSON.stringify(flow.goals[0])}`,
	);
	const runsBeforeRestart = scriptRunCount(command);
	loaded.handlers.get("session_shutdown")({}, ctx);

	state.failResultCardTitle = undefined;
	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await waitFor(
		() => loaded.module.getGoalState(ctx)?.status === "paused",
		"acceptance hard-cap feedback did not retry",
	);
	flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.acceptance.rounds.length === 10 &&
			flow.goals[0].checks.acceptance.active === null,
		JSON.stringify(flow.goals[0].checks.acceptance),
	);
	assert(
		scriptRunCount(command) === runsBeforeRestart,
		"acceptance hard-cap reviewer reran",
	);
	assert(
		resultCardCount(state, "Flow Login 已暂停") === 1,
		"hard-cap card duplicated",
	);
}

async function flowQualityHardCapDeliveryFailureScenario() {
	const command = countedScript(["FAIL\n质量不通过\n"], "*) cat '{{last}}' ;;");
	writeConfig({ acceptance: false, quality: true, command });
	const cwd = join(out, "flow-quality-hard-cap-delivery");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	state.failAfterResultCardTitle = "第 10 轮质检未通过";
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	for (let round = 1; round <= 10; round += 1)
		await loaded.handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	let flow = readFlow(cwd);
	assert(
		loaded.module.getGoalState(ctx)?.status === "active" &&
			flow.goals[0].completionCursor === "quality_retry" &&
			flow.goals[0].checks.quality.rounds.length === 9 &&
			flow.goals[0].checks.quality.active?.round === 10,
		`quality hard-cap delivery failure committed pause: ${JSON.stringify(flow.goals[0])}`,
	);
	const runsBeforeRestart = scriptRunCount(command);
	loaded.handlers.get("session_shutdown")({}, ctx);

	state.failAfterResultCardTitle = undefined;
	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await waitFor(
		() => loaded.module.getGoalState(ctx)?.status === "paused",
		"quality hard-cap receipt did not converge",
	);
	flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.quality.rounds.length === 10 &&
			flow.goals[0].checks.quality.active === null,
		JSON.stringify(flow.goals[0].checks.quality),
	);
	assert(
		scriptRunCount(command) === runsBeforeRestart,
		"quality hard-cap reviewer reran",
	);
	assert(
		resultCardCount(state, "第 10 轮质检未通过") === 1,
		"quality hard-cap card duplicated",
	);
}

async function flowConnectionNoticeFormatScenario() {
	writeConfig({ acceptance: false, quality: false });
	const cwd = join(out, "flow-connection-notice");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	await handlers.get("agent_end")(recoverableWebSocketEndEvent(), ctx);
	const notice = state.notifications.find((item) =>
		item.includes("Flow 连接中断"),
	);
	assertNoticeFormat(notice, "⏳", "等待 Pi 自动重试");
}

async function flowRetryExhaustionHasSingleSurfaceScenario() {
	writeConfig({ acceptance: false, quality: false });
	const cwd = join(out, "flow-retry-exhaustion-single-surface");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	const attention = await attentionProbe();
	await withFakeTimeouts(async (timers) => {
		await handlers.get("agent_end")(recoverableWebSocketEndEvent(), ctx);
		const guard = timers.find((timer) => timer.delay === 20_000);
		assert(
			guard,
			`retry exhaustion guard missing: ${timers.map((timer) => timer.delay)}`,
		);
		fireTimer(guard);
	});
	attention.unsubscribe();
	assert(
		attention.sources.length === 0,
		`retry pause with auto-resume requested attention: ${attention.sources.join(" | ")}`,
	);
	assert(
		module.getGoalState(ctx)?.status === "paused",
		`retry exhaustion status: ${module.getGoalState(ctx)?.status}`,
	);
	const cards = state.messages.filter((item) =>
		item.message.details?.title.includes("Flow 连接重试已暂停"),
	);
	assert(cards.length === 1, `retry exhaustion cards: ${cards.length}`);
	assert(
		!state.notifications.some((item) => item.includes("Pi 自动重试耗尽")),
		state.notifications.join("\n"),
	);
}

async function goalConnectionNoticeFormatScenario() {
	writeConfig({ acceptance: false, quality: false });
	const cwd = join(out, "goal-connection-notice");
	const sessionFile = join(cwd, "goal-session.jsonl");
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Standalone objective", ctx);
	await handlers.get("agent_end")(recoverableWebSocketEndEvent(), ctx);
	const notice = state.notifications.find((item) =>
		item.includes("目标连接中断"),
	);
	assertNoticeFormat(notice, "⏳", "等待 Pi 自动重试");
	assert(
		!state.notifications.some((item) => item.includes("目标 连接中断")),
		state.notifications.join("\n"),
	);
}

async function goalArtifactSaveFailureNoticeFormatScenario() {
	const { syncStandaloneGoalArtifact } = await import(
		`file://${join(srcOut, "goal/persistence.js")}?artifact-save-${Date.now()}`
	);
	const state = createState();
	const ctx = mockContext(state);
	const missingArtifactDir = join(
		out,
		"missing-goal-artifact",
		"intentionally-long-path-to-trigger-notification-truncation",
		"with-enough-segments-to-match-ci-runner-path-length",
	);
	const goal = {
		id: "goal-artifact-save-failure",
		language: "zh",
		status: "active",
		artifactPlanPath: join(missingArtifactDir, "G1-plan.md"),
		artifactStatePath: join(missingArtifactDir, "G1-worker.json"),
		stateReviewHistory: [],
		qualityReviewHistory: [],
	};
	syncStandaloneGoalArtifact(ctx, goal, undefined);
	const notice = state.notifications.find((item) =>
		item.includes("目标状态保存失败"),
	);
	assertNoticeFormat(notice, "❌", "ENOENT");
	assert(notice.includes("…"), `notice was not truncated: ${notice}`);
	assert(!notice.includes("..."), notice);
}

async function flowAcceptanceSystemErrorNoticeFormatScenario() {
	writeConfig({
		acceptance: true,
		quality: false,
		command: script("not-valid"),
	});
	const cwd = join(out, "flow-acceptance-system-error-notice");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	const attention = await attentionProbe();
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	attention.unsubscribe();
	assert(
		attention.sources.length === 1 &&
			attention.sources[0].startsWith("pi-flow:goal:"),
		`acceptance error attention mismatch: ${attention.sources.join(" | ")}`,
	);
	const card = state.messages.find(
		(entry) => entry.message.details?.title === "验收未完成",
	);
	assert(card, "acceptance incomplete card missing");
	assert(card.message.content.includes("/flow go F1"), card.message.content);
	assert(
		readFlow(cwd).goals[0].checks.acceptance.active === null,
		"acceptance system error kept active checkpoint",
	);
	assert(
		!state.notifications.some((item) => item.includes("Flow 已暂停")),
		state.notifications.join("\n"),
	);
}

async function flowAcceptanceSystemErrorDeliveryFailureScenario() {
	const command = countedScript(["not-valid\n"], "*) cat '{{last}}' ;;");
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-error-delivery");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	state.failResultCardTitle = "验收未完成";
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	let flow = readFlow(cwd);
	assert(
		loaded.module.getGoalState(ctx)?.status === "active" &&
			flow.goals[0].completionCursor === "acceptance_retry" &&
			flow.goals[0].checks.acceptance.active?.models[0]?.outcome?.result ===
				"error",
		`acceptance error delivery failure committed stop: ${JSON.stringify(flow.goals[0])}`,
	);
	const runsBeforeRestart = scriptRunCount(command);
	loaded.handlers.get("session_shutdown")({}, ctx);

	state.failResultCardTitle = undefined;
	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await waitFor(
		() => loaded.module.getGoalState(ctx)?.status === "paused",
		"acceptance error feedback did not retry",
	);
	flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.acceptance.active === null &&
			flow.goals[0].checks.acceptance.rounds[0]?.result === "error",
		JSON.stringify(flow.goals[0].checks.acceptance),
	);
	assert(scriptRunCount(command) === runsBeforeRestart, "error reviewer reran");
	assert(resultCardCount(state, "验收未完成") === 1, "error card duplicated");
}

async function flowAcceptanceWritesRespectFlowLockScenario() {
	writeConfig({
		acceptance: true,
		quality: false,
		command: script("PASS\n验收通过\n证据：文件=src/app.ts；命令=npm test\n"),
	});
	const { acquireFlowLock } = await import(
		`file://${join(srcOut, "flow/lock.js")}?acceptance=${Date.now()}`
	);
	const cwd = join(out, "flow-acceptance-runtime-lock");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	const lock = acquireFlowLock(
		join(cwd, ".flow", "F1"),
		"active scheduling transaction",
	);
	assert(lock.ok, "acceptance runtime write lock was not acquired");
	const activity = await activityProbe();
	try {
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
		assert(
			!acceptanceActivityStarted(activity),
			"checkpoint failure emitted a false acceptance activity signal",
		);
		const flow = readFlow(cwd);
		assert(flow.status === "running", "acceptance lock changed Flow status");
		assert(
			!state.messages.some(
				(entry) => entry.message.details?.title === "验收中",
			),
			"checkpoint failure emitted a false acceptance start card",
		);
		assert(
			!renderGoalWidgets(state, "goal-progress").some((text) =>
				text.includes("验收中"),
			),
			"checkpoint failure displayed an acceptance activity widget",
		);
		assert(
			flow.goals[0].checks.acceptance.rounds.length === 0 &&
				flow.goals[0].checks.acceptance.active === null,
			"acceptance checkpoint wrote through Flow lock",
		);
		assert(
			module.getGoalState(ctx)?.status === "active",
			`acceptance lock diverged Goal status: ${module.getGoalState(ctx)?.status}`,
		);
		assert(
			!state.messages.some((entry) =>
				/验收未完成|Flow .*已暂停/u.test(entry.message.details?.title ?? ""),
			),
			state.messages.map((entry) => entry.message.details?.title).join(" | "),
		);
		assert(
			!state.notifications.some((item) =>
				/验收启动失败|checkpoint 写入失败/u.test(item),
			),
			state.notifications.join("\n"),
		);
		assert(
			state.notifications.filter((item) => item.includes("Flow 正在处理"))
				.length === 1,
			state.notifications.join("\n"),
		);
	} finally {
		activity.unsubscribe();
		lock.release();
	}
}

async function flowRuntimeWritesRespectFlowLockScenario() {
	writeConfig({
		acceptance: false,
		quality: true,
		command: sequenceScript(["FAIL\n质量问题\n"]),
	});
	const { acquireFlowLock } = await import(
		`file://${join(srcOut, "flow/lock.js")}?t=${Date.now()}`
	);
	const cwd = join(out, "flow-runtime-lock");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	const flowDir = join(cwd, ".flow", "F1");
	const lock = acquireFlowLock(flowDir, "active scheduling transaction");
	assert(lock.ok, "runtime write lock was not acquired");
	try {
		await handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
		const flow = readFlow(cwd);
		assert(
			flow.goals[0].completionCursor === null,
			"completion cursor wrote through flow lock",
		);
		assert(
			flow.goals[0].checks.quality.rounds.length === 0,
			"review checks wrote through flow lock",
		);
		assert(flow.status === "running", "runtime lock changed flow status");
		assert(
			!state.messages.some(
				(entry) => entry.message.details?.title === "质检中",
			),
			"checkpoint failure emitted a false quality start card",
		);
		assert(
			!state.widgets.some(
				(item) => item.key === "review-progress" && item.content !== undefined,
			),
			"checkpoint failure displayed a quality activity widget",
		);
		assert(
			module.getGoalState(ctx)?.status === "active",
			`runtime lock diverged Goal status: ${module.getGoalState(ctx)?.status}`,
		);
		const { isReviewLoopActive } = await import(
			`file://${join(srcOut, "review.js")}`
		);
		assert(!isReviewLoopActive(), "runtime lock left quality loop active");
		assert(
			!state.messages.some((entry) =>
				/质检未完成|Flow .*已暂停/u.test(entry.message.details?.title ?? ""),
			),
			state.messages.map((entry) => entry.message.details?.title).join(" | "),
		);
		assert(
			state.notifications.filter((item) => item.includes("Flow 正在处理"))
				.length === 1,
			state.notifications.join("\n"),
		);
	} finally {
		lock.release();
	}
}

async function flowLiveReviewsSyncScenario() {
	writeConfig({
		acceptance: true,
		quality: false,
		command: shellScript("sleep 30"),
	});
	const cwd = join(out, "flow-live-checks");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow live objective", ctx);
	const { piActivitySignal } = await import(
		`file://${join(srcOut, "shared/activity-signal.js")}`
	);
	const pendingReview = handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const flowJson = join(cwd, ".flow", "F1", "flow.json");
	const live = await waitFor(
		() =>
			JSON.parse(readFileSync(flowJson, "utf8")).goals[0].checks?.acceptance
				.active,
		"flow.json never received live review progress",
	);
	assert(
		piActivitySignal().state.active === true,
		"acceptance activity signal was not enabled after checkpoint commit",
	);
	assert(
		!widgetTexts(state).some((text) => text.includes("思考中 · 0 calls")),
		"acceptance rendered a reviewer spinner before its first event",
	);
	assert(
		live.models.some((item) => item.outcome === null),
		JSON.stringify(live),
	);
	handlers.get("session_shutdown")({}, ctx);
	await pendingReview;
	assert(
		piActivitySignal().state.active === false,
		"acceptance activity signal was not cleared",
	);
	const settled = JSON.parse(readFileSync(flowJson, "utf8")).goals[0].checks;
	assert(
		settled.acceptance.active?.models.some((item) => item.outcome === null),
		`shutdown discarded review checkpoint: ${JSON.stringify(settled.acceptance.active)}`,
	);
}

async function flowAcceptanceResumesMissingReviewerScenario() {
	const passed = countedScript(
		["PASS\n验收 OK\n证据：文件=src/app.ts；命令=npm test\n"],
		"*) cat '{{last}}' ;;",
	);
	const interrupted = interruptOnceScript(
		"PASS\n恢复 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeConfig({
		acceptance: true,
		quality: false,
		command: passed,
		models: [
			{ model: "test/passed", thinking: "off", command: passed },
			{
				model: "test/interrupted",
				thinking: "off",
				command: interrupted,
			},
		],
	});
	const cwd = join(out, "flow-acceptance-reviewer-resume");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	const firstRun = loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await waitFor(
		() => {
			const active = readFlow(cwd).goals[0].checks.acceptance.active;
			return (
				active?.models[0]?.outcome?.result === "passed" &&
				active.models[1]?.outcome === null &&
				scriptRunCount(interrupted) === 1
			);
		},
		"acceptance reviewer checkpoint was not committed",
		8000,
	);
	loaded.handlers.get("session_shutdown")({}, ctx);
	await firstRun;

	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await waitFor(
		() => readFlow(cwd).goals[0].checks.acceptance.rounds.length === 1,
		"session_start did not auto-resume the interrupted acceptance",
		8000,
	);
	const flow = readFlow(cwd);
	assert(scriptRunCount(passed) === 1, "passed acceptance reviewer reran");
	assert(
		scriptRunCount(interrupted) === 2,
		`unfinished acceptance reviewer count: ${scriptRunCount(interrupted)}`,
	);
	assert(
		state.entries.filter(
			(entry) =>
				entry.type === "custom_message" &&
				entry.customType === "pi-flow-result-card" &&
				entry.details?.title === "验收中",
		).length === 2,
		"resume did not record both acceptance start cards",
	);
	assert(
		flow.goals[0].checks.acceptance.rounds.length === 1 &&
			flow.goals[0].checks.acceptance.rounds[0].round === 1 &&
			flow.goals[0].checks.acceptance.active === null,
		JSON.stringify(flow.goals[0].checks.acceptance),
	);
}

async function flowBusyRestartResumesOnAgentEndScenario() {
	const passed = countedScript(
		["PASS\n验收 OK\n证据：文件=src/app.ts；命令=npm test\n"],
		"*) cat '{{last}}' ;;",
	);
	const interrupted = interruptOnceScript(
		"PASS\n恢复 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeConfig({
		acceptance: true,
		quality: false,
		command: passed,
		models: [
			{ model: "test/passed", thinking: "off", command: passed },
			{
				model: "test/interrupted",
				thinking: "off",
				command: interrupted,
			},
		],
	});
	const cwd = join(out, "flow-busy-restart-resume");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	const firstRun = loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await waitFor(
		() => {
			const active = readFlow(cwd).goals[0].checks.acceptance.active;
			return (
				active?.models[0]?.outcome?.result === "passed" &&
				active.models[1]?.outcome === null &&
				scriptRunCount(interrupted) === 1
			);
		},
		"busy resume checkpoint was not committed",
		8000,
	);
	loaded.handlers.get("session_shutdown")({}, ctx);
	await firstRun;

	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	let idle = false;
	ctx.isIdle = () => idle;
	loaded.handlers.get("session_start")({}, ctx);
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
	assert(scriptRunCount(interrupted) === 1, "busy restart resumed immediately");
	idle = true;
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await waitFor(
		() => readFlow(cwd).goals[0].checks.acceptance.rounds.length === 1,
		"idle agent_end did not resume acceptance",
	);
	assert(scriptRunCount(passed) === 1, "completed reviewer reran after busy");
	assert(
		scriptRunCount(interrupted) === 2,
		`unfinished reviewer count after busy: ${scriptRunCount(interrupted)}`,
	);
}

async function flowAcceptanceDeliveryFailureRetriesAfterRestartScenario() {
	const command = countedScript(["FAIL\n验收缺陷\n"], "*) cat '{{last}}' ;;");
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-delivery-retry");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	state.failResultCardTitle = "验收未通过";
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	let flow = readFlow(cwd);
	assert(
		flow.goals[0].completionCursor === "acceptance_retry" &&
			flow.goals[0].checks.acceptance.rounds.length === 0 &&
			flow.goals[0].checks.acceptance.active?.models?.[0]?.outcome?.result ===
				"failed",
		`acceptance delivery failure committed repair state: ${JSON.stringify(flow.goals[0])}`,
	);
	assert(scriptRunCount(command) === 1, "acceptance reviewer count changed");
	loaded.handlers.get("session_shutdown")({}, ctx);

	state.failResultCardTitle = undefined;
	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await waitFor(
		() => readFlow(cwd).goals[0].completionCursor === "acceptance_repair",
		"restart did not redeliver acceptance feedback",
	);
	flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.acceptance.rounds[0]?.result === "failed" &&
			flow.goals[0].checks.acceptance.active === null,
		`acceptance redelivery did not settle checkpoint: ${JSON.stringify(flow.goals[0].checks.acceptance)}`,
	);
	assert(
		scriptRunCount(command) === 1,
		`completed acceptance reviewer reran: ${scriptRunCount(command)}`,
	);
	await loaded.module.pauseGoalFromFlow(ctx);
}

async function flowAcceptancePassDeliveryFailureRetriesAfterRestartScenario() {
	const command = countedScript(
		["PASS\n验收通过 OK\n证据：文件=src/app.ts；命令=npm test\n"],
		"*) cat '{{last}}' ;;",
	);
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-pass-delivery-retry");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	state.failResultCardTitle = "验收通过";
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const interrupted = readFlow(cwd).goals[0];
	assert(
		interrupted.completionCursor === "acceptance_retry" &&
			interrupted.checks.acceptance.rounds.length === 0 &&
			interrupted.checks.acceptance.active?.models?.[0]?.outcome?.result ===
				"passed",
		`pass delivery failure committed settlement early: ${JSON.stringify(interrupted.checks.acceptance)}`,
	);
	assert(
		scriptRunCount(command) === 1,
		`acceptance reviewer runs before redelivery: ${scriptRunCount(command)}`,
	);
	loaded.handlers.get("session_shutdown")({}, ctx);

	state.failResultCardTitle = undefined;
	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await waitFor(
		() =>
			readFlow(cwd).goals[0].checks.acceptance.rounds[0]?.result === "passed",
		"restart did not redeliver the acceptance pass card",
	);
	const settled = readFlow(cwd).goals[0];
	assert(
		settled.checks.acceptance.active === null,
		`pass redelivery did not settle checkpoint: ${JSON.stringify(settled.checks.acceptance)}`,
	);
	assert(
		scriptRunCount(command) === 1,
		`passed acceptance reviewer reran: ${scriptRunCount(command)}`,
	);
	assert(
		state.messages.filter((item) => item.message.details?.title === "验收通过")
			.length === 1,
		"acceptance pass card was not delivered exactly once",
	);
}

async function flowQualityDeliveryFailureRetriesAfterRestartScenario() {
	const command = countedScript(["FAIL\n质量缺陷\n"], "*) cat '{{last}}' ;;");
	writeConfig({ acceptance: false, quality: true, command });
	const cwd = join(out, "flow-quality-delivery-retry");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	state.failResultCardTitle = "质检未通过";
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	let flow = readFlow(cwd);
	assert(
		flow.goals[0].completionCursor === "quality_retry" &&
			flow.goals[0].checks.quality.rounds.length === 0 &&
			flow.goals[0].checks.quality.active?.models?.[0]?.outcome?.result ===
				"failed",
		`quality delivery failure committed repair state: ${JSON.stringify(flow.goals[0])}`,
	);
	assert(scriptRunCount(command) === 1, "quality reviewer count changed");
	loaded.handlers.get("session_shutdown")({}, ctx);

	state.failResultCardTitle = undefined;
	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await waitFor(
		() => readFlow(cwd).goals[0].completionCursor === "quality_repair",
		"restart did not redeliver quality feedback",
	);
	flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.quality.rounds[0]?.result === "failed" &&
			flow.goals[0].checks.quality.active === null,
		`quality redelivery did not settle checkpoint: ${JSON.stringify(flow.goals[0].checks.quality)}`,
	);
	assert(
		scriptRunCount(command) === 1,
		`completed quality reviewer reran: ${scriptRunCount(command)}`,
	);
	await loaded.module.pauseGoalFromFlow(ctx);
}

async function flowAcceptancePostDeliveryLockFailureScenario() {
	const command = countedScript(["FAIL\n验收缺陷\n"], "*) cat '{{last}}' ;;");
	const original = proxyCommand(command);
	const added = countedScript(
		["FAIL\n新增验收模型缺陷\n"],
		"*) cat '{{last}}' ;;",
	);
	writeConfig({
		acceptance: true,
		quality: false,
		command,
		models: [{ model: "test/original", thinking: "off", command: original }],
	});
	const cwd = join(out, "flow-acceptance-post-delivery-lock");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const { acquireFlowLock } = await import(
		`file://${join(srcOut, "flow/lock.js")}?post-acceptance=${Date.now()}`
	);
	const state = createState();
	let lock;
	state.afterResultCardSend = (message) => {
		if (message.details?.title !== "验收未通过" || lock) return;
		lock = acquireFlowLock(join(cwd, ".flow", "F1"), "post-delivery test");
		assert(lock.ok, "post-delivery acceptance lock was not acquired");
	};
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	let flow = readFlow(cwd);
	assert(
		flow.goals[0].completionCursor === "acceptance_retry" &&
			flow.goals[0].checks.acceptance.active?.models[0]?.outcome?.result ===
				"failed" &&
			flow.goals[0].checks.acceptance.rounds.length === 0,
		`post-delivery acceptance state split: ${JSON.stringify(flow.goals[0])}`,
	);
	assert(resultCardCount(state, "验收未通过") === 1, "acceptance card missing");
	state.afterResultCardSend = undefined;
	lock.release();
	loaded.handlers.get("session_shutdown")({}, ctx);
	writeConfig({
		acceptance: true,
		quality: false,
		command,
		models: [
			{ model: "test/original", thinking: "off", command: original },
			{ model: "test/added", thinking: "off", command: added },
		],
	});

	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await waitFor(
		() => readFlow(cwd).goals[0].completionCursor === "acceptance_repair",
		"acceptance receipt did not converge to repair",
	);
	flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.acceptance.active === null &&
			flow.goals[0].checks.acceptance.rounds[0]?.result === "failed",
		JSON.stringify(flow.goals[0].checks.acceptance),
	);
	assert(
		scriptRunCount(command) === 1 && scriptRunCount(added) === 1,
		"acceptance reviewer-set recovery reran unchanged reviewer",
	);
	const cards = resultCards(state, "验收未通过");
	assert(
		cards.length === 2,
		`updated acceptance feedback missing: ${cards.length}`,
	);
	assert(
		cards[0].message.details.deliveryId !==
			cards[1].message.details.deliveryId &&
			cards[1].message.content.includes("新增验收模型缺陷"),
		"acceptance recovery reused stale receipt",
	);
	await loaded.module.pauseGoalFromFlow(ctx);
}

async function flowQualityPostDeliveryLockFailureScenario() {
	const command = countedScript(["FAIL\n质量缺陷\n"], "*) cat '{{last}}' ;;");
	const original = proxyCommand(command);
	const added = countedScript(
		["FAIL\n新增质检模型缺陷\n"],
		"*) cat '{{last}}' ;;",
	);
	writeConfig({
		acceptance: false,
		quality: true,
		command,
		models: [{ model: "test/original", thinking: "off", command: original }],
	});
	const cwd = join(out, "flow-quality-post-delivery-lock");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const { acquireFlowLock } = await import(
		`file://${join(srcOut, "flow/lock.js")}?post-quality=${Date.now()}`
	);
	const state = createState();
	let lock;
	state.afterResultCardSend = (message) => {
		if (message.details?.title !== "质检未通过" || lock) return;
		lock = acquireFlowLock(join(cwd, ".flow", "F1"), "post-delivery test");
		assert(lock.ok, "post-delivery quality lock was not acquired");
	};
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	let flow = readFlow(cwd);
	assert(
		flow.goals[0].completionCursor === "quality_retry" &&
			flow.goals[0].checks.quality.active?.models[0]?.outcome?.result ===
				"failed" &&
			flow.goals[0].checks.quality.rounds.length === 0,
		`post-delivery quality state split: ${JSON.stringify(flow.goals[0])}`,
	);
	assert(resultCardCount(state, "质检未通过") === 1, "quality card missing");
	state.afterResultCardSend = undefined;
	lock.release();
	loaded.handlers.get("session_shutdown")({}, ctx);
	writeConfig({
		acceptance: false,
		quality: true,
		command,
		models: [
			{ model: "test/original", thinking: "off", command: original },
			{ model: "test/added", thinking: "off", command: added },
		],
	});

	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await waitFor(
		() => readFlow(cwd).goals[0].completionCursor === "quality_repair",
		"quality receipt did not converge to repair",
	);
	flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.quality.active === null &&
			flow.goals[0].checks.quality.rounds[0]?.result === "failed",
		JSON.stringify(flow.goals[0].checks.quality),
	);
	assert(
		scriptRunCount(command) === 1 && scriptRunCount(added) === 1,
		"quality reviewer-set recovery reran unchanged reviewer",
	);
	const cards = resultCards(state, "质检未通过");
	assert(
		cards.length === 2,
		`updated quality feedback missing: ${cards.length}`,
	);
	assert(
		cards[0].message.details.deliveryId !==
			cards[1].message.details.deliveryId &&
			cards[1].message.content.includes("新增质检模型缺陷"),
		"quality recovery reused stale receipt",
	);
	await loaded.module.pauseGoalFromFlow(ctx);
}

async function flowAcceptanceCanonicalReconciliationScenario() {
	const command = script("FAIL\n验收缺陷\n");
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-acceptance-canonical-reconcile");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	state.dropGoalStateWrites = true;
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		readFlow(cwd).goals[0].checks.acceptance.rounds.length === 1,
		"acceptance canonical checkpoint was not committed",
	);

	state.dropGoalStateWrites = false;
	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await loaded.module.pauseGoalFromFlow(ctx);
	const goal = latestPersistedGoal(state);
	assert(
		goal.stateReviewRounds === 1 &&
			goal.stateReviewHistory.length === 1 &&
			goal.consecutiveCheckFailures === 1,
		`acceptance session state was not reconciled: ${JSON.stringify(goal)}`,
	);
}

async function flowQualityCanonicalReconciliationScenario() {
	const command = script("FAIL\n质量缺陷\n");
	writeConfig({ acceptance: false, quality: true, command });
	const cwd = join(out, "flow-quality-canonical-reconcile");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	state.dropGoalStateWrites = true;
	await loaded.handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		readFlow(cwd).goals[0].checks.quality.rounds.length === 1,
		"quality canonical checkpoint was not committed",
	);

	state.dropGoalStateWrites = false;
	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await loaded.module.pauseGoalFromFlow(ctx);
	const goal = latestPersistedGoal(state);
	assert(
		goal.qualityReviewHistory.length === 1 &&
			goal.consecutiveCheckFailures === 1,
		`quality session state was not reconciled: ${JSON.stringify(goal)}`,
	);
}

function latestPersistedGoal(state) {
	return state.entries
		.filter(
			(entry) => entry.type === "custom" && entry.customType === "goal-state",
		)
		.at(-1)?.data?.goal;
}

function resultCards(state, title) {
	return state.messages.filter((item) => item.message.details?.title === title);
}

function resultCardCount(state, title) {
	return resultCards(state, title).length;
}

async function flowInterruptedRepairShowsRecoveryHintScenario() {
	const command = countedScript(
		["PASS\n验收 OK\n证据：文件=src/app.ts；命令=npm test\n"],
		"*) cat '{{last}}' ;;",
	);
	writeConfig({ acceptance: true, quality: false, command });
	const cwd = join(out, "flow-interrupted-repair-hint");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	let loaded = await loadGoalExtension(state);
	let ctx = mockContext(state, cwd, sessionFile);
	await loaded.module.startGoalFromFlow("Flow objective", ctx);
	const flowJson = join(cwd, ".flow", "F1", "flow.json");
	const flow = JSON.parse(readFileSync(flowJson, "utf8"));
	flow.goals[0].completionCursor = "quality_repair";
	writeFileSync(flowJson, `${JSON.stringify(flow, null, 2)}\n`);

	loaded = await loadGoalExtension(state);
	ctx = mockContext(state, cwd, sessionFile);
	loaded.handlers.get("session_start")({}, ctx);
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
	assert(
		scriptRunCount(command) === 0,
		"repair interruption auto-ran a check on session_start",
	);
	const box = renderGoalWidgets(state, "goal-progress").at(-1) ?? "";
	assert(
		box.includes("已中断") && box.includes("/flow go F1"),
		`interrupted repair box missing recovery hint: ${box}`,
	);
}

async function flowRepairAgentEndResumesQualityScenario() {
	const command = captureCommand(
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeConfig({ acceptance: true, quality: true, command });
	const cwd = join(out, "flow-repair-agent-end-quality");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	const flowJson = join(cwd, ".flow", "F1", "flow.json");
	const flow = JSON.parse(readFileSync(flowJson, "utf8"));
	flow.goals[0].completionCursor = "quality_repair";
	writeFileSync(flowJson, `${JSON.stringify(flow, null, 2)}\n`);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const args = readFileSync(`${command}.args`, "utf8");
	assert(
		args.includes("审查对象"),
		"agent_end after quality repair did not resume the quality check",
	);
	assert(
		!args.includes("原执行模型完成声明"),
		"agent_end after quality repair re-ran acceptance",
	);
}

async function flowLiveReviewLockBusyNotifiesScenario() {
	writeConfig({
		acceptance: true,
		quality: false,
		command: shellScript("sleep 2"),
	});
	const { acquireFlowLock } = await import(
		`file://${join(srcOut, "flow/lock.js")}?t=${Date.now()}`
	);
	const cwd = join(out, "flow-live-checks-lock-busy");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow live objective", ctx);
	const flowDir = join(cwd, ".flow", "F1");
	const lock = acquireFlowLock(flowDir, "active scheduling transaction");
	assert(lock.ok, "live review sync lock was not acquired");
	try {
		const pendingReview = handlers.get("agent_end")(
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
		await waitFor(
			() => state.notifications.find((item) => item.includes("Flow 正在处理")),
			"busy live review sync did not notify user",
		);
		const flow = readFlow(cwd);
		assert(
			flow.goals[0].checks.acceptance.active === null,
			"live review sync wrote through flow lock",
		);
		handlers.get("session_shutdown")({}, ctx);
		await pendingReview;
	} finally {
		lock.release();
	}
}

async function flowGoalCompleteWithQualityReviewScenario() {
	const command = captureCommand(
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
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
	assert(titles.includes("质检中"), titles.join(" | "));
	assert(titles.includes("质检通过"), titles.join(" | "));
	const qualityStartCard = state.messages.find(
		(item) => item.message.details?.title === "质检中",
	);
	assert(qualityStartCard, "quality start card missing");
	assert(
		qualityStartCard.message.details.lines.includes("Flow：Login") &&
			!qualityStartCard.message.details.lines.join("\n").includes("第 1 步"),
		qualityStartCard.message.details.lines.join(" | "),
	);
	const qualityWidget = widgetTexts(state).find((text) =>
		text.includes("💯 Flow · 质检中"),
	);
	assert(qualityWidget, widgetTexts(state).join("\n---\n"));
	assert(
		qualityWidget.includes("Login") &&
			!qualityWidget.includes("Flow objective") &&
			!qualityWidget.includes("第 1 步"),
		qualityWidget,
	);
	assert(
		!titles.includes("Flow Login 已完成"),
		`single-step Flow completion card should be sent by advance: ${titles.join(" | ")}`,
	);
	const qualityCard = state.messages.find(
		(item) => item.message.details?.title === "质检通过",
	);
	assert(qualityCard, "quality pass card missing");
	assertFooterLayout(qualityCard.message.details.lines, "⏱ 用时：");
	assert(
		!qualityCard.message.details.lines.join("\n").includes("/ 总"),
		qualityCard.message.details.lines.join(" | "),
	);
	const flow = readFlow(cwd);
	assert(
		flow.goals[0].checks.quality.rounds[0].result === "passed" &&
			flow.goals[0].checks.quality.rounds[0].details.includes("质量 OK") &&
			flow.goals[0].checks.acceptance.enabled === false,
		JSON.stringify(flow.goals[0].checks),
	);
}

async function flowQualityFailThenPassPersistsBothRoundsScenario() {
	const command = sequenceScript([
		"FAIL\n\n## 发现 1\n- 问题: 首轮质量缺陷\n",
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeConfig({ acceptance: false, quality: true, command });
	const cwd = join(out, "flow-quality-fail-then-pass");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	// 第 1 轮质检 FAIL → 修复回合；第 2 轮 PASS → 完成链。
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const rounds = readFlow(cwd).goals[0].checks.quality.rounds;
	assert(
		rounds.length === 2 &&
			rounds[0].result === "failed" &&
			rounds[1].result === "passed" &&
			rounds[1].details.includes("质量 OK"),
		`final pass round missing from canonical history: ${JSON.stringify(rounds)}`,
	);
	// completion fact 由 reviewStats.history 生成，必须包含最终通过轮（fan-in/worker 链消费该 fact）。
	const fact = state.entries
		.filter(
			(entry) =>
				entry.type === "custom" &&
				entry.customType === "pi-flow-goal-completed",
		)
		.at(-1)?.data;
	const factRounds = fact?.checks?.quality?.rounds ?? [];
	assert(
		factRounds.length === 2 &&
			factRounds[0]?.result === "failed" &&
			factRounds[1]?.result === "passed",
		`completion fact lost the final pass round: ${JSON.stringify(factRounds)}`,
	);
	assert(
		module.getGoalState(ctx) === undefined,
		`goal did not complete after fail-then-pass: ${JSON.stringify(module.getGoalState(ctx))}`,
	);
}

async function flowQualityPassCursorSurvivesCrashBeforeFinalizeScenario() {
	const command = sequenceScript([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeConfig({ acceptance: false, quality: true, command });
	const cwd = join(out, "flow-quality-pass-finalize-crash");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const state = createState();
	const { handlers, module } = await loadGoalExtension(state);
	const ctx = mockContext(state, cwd, sessionFile);
	await module.startGoalFromFlow("Flow objective", ctx);
	// 注入：PASS 结算提交后、onPass 收口（completion fact）失败，模拟收口前中断。
	state.dropCompletionFactWrites = true;
	await handlers.get("agent_end")(
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const interrupted = readFlow(cwd).goals[0];
	assert(
		interrupted.completionCursor === "finalize_retry",
		`pass settlement did not advance cursor atomically: ${interrupted.completionCursor}`,
	);
	assert(
		interrupted.checks.quality.rounds.at(-1)?.result === "passed" &&
			interrupted.checks.quality.active === null,
		`pass settlement left inconsistent checks: ${JSON.stringify(interrupted.checks.quality)}`,
	);
	assert(
		scriptRunCount(command) === 1,
		`reviewer runs before recovery: ${scriptRunCount(command)}`,
	);
	// 恢复：finalize_retry 直接从 canonical 历史收口，禁止重跑 reviewer。
	state.dropCompletionFactWrites = false;
	const resumed = await module.resumePausedGoalFromFlow(ctx);
	assert(resumed === "continued", `finalize recovery result: ${resumed}`);
	assert(
		scriptRunCount(command) === 1,
		`recovery reran the passed quality check: ${scriptRunCount(command)}`,
	);
	const fact = state.entries
		.filter(
			(entry) =>
				entry.type === "custom" &&
				entry.customType === "pi-flow-goal-completed",
		)
		.at(-1)?.data;
	const factRounds = fact?.checks?.quality?.rounds ?? [];
	assert(
		factRounds.at(-1)?.result === "passed",
		`completion fact lost the pass round after recovery: ${JSON.stringify(factRounds)}`,
	);
}

async function flowQualityPassPersistsIgnoredReviewerScenario() {
	const passDetails =
		"质量 OK，验证命令 node dist/validate-draft.js、npm run check、node tests/flow-smoke.mjs 均通过，尾部唯一完整 PASS 输出";
	const passed = script(
		`PASS\n${passDetails}\n证据：文件=src/flow.ts；命令=npm run check\n`,
	);
	const invalid = script("已完成\n格式串台\n");
	writeConfig({
		acceptance: false,
		quality: true,
		command: passed,
		models: [
			{ model: "test/passed", thinking: "off", command: passed },
			{ model: "test/invalid", thinking: "off", command: invalid },
		],
	});
	const cwd = join(out, "flow-quality-pass-ignored-reviewer");
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
	const flow = readFlow(cwd);
	const round = flow.goals[0].checks.quality.rounds[0];
	assert(
		round.result === "passed" &&
			round.details.includes("模型 1 · passed") &&
			round.details.includes(passDetails) &&
			round.details.includes("格式无效（已忽略该模型结论）") &&
			round.details.includes("模型 2 · invalid"),
		JSON.stringify(flow.goals[0].checks.quality.rounds[0]),
	);
	const { renderFlowHtml } = await import(
		`file://${join(srcOut, "flow/html.js")}?ignored=${Date.now()}`
	);
	const html = renderFlowHtml(join(cwd, ".flow", "F1"), flow);
	assert(
		html.includes("格式无效（已忽略该模型结论）") && html.includes("invalid"),
		"ignored reviewer output should be persisted into Flow HTML",
	);
	assert(
		html.includes(`data-tooltip="${passDetails}`) &&
			!html.includes("尾部唯一完整 PASS 输…"),
		"passed reviewer tooltip should keep full output when ignored reviewers exist",
	);
}

async function flowHtmlKeepsFullModelFeedbackScenario() {
	const cwd = join(out, "flow-html-full-model-feedback");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFlow(cwd, sessionFile);
	const flow = readFlow(cwd);
	const longFeedback = `${"完整模型反馈。".repeat(180)}尾部唯一反馈`;
	flow.goals[0].checks.acceptance.rounds = [
		{
			round: 1,
			result: "failed",
			summary: "短摘要",
			details: `FAIL\n\n模型 1 · gpt-5.4\n## 发现 1\n- 问题: ${longFeedback}`,
			models: [{ label: "gpt-5.4", status: "failed", summary: "短摘要" }],
		},
	];
	const { renderFlowHtml } = await import(
		`file://${join(srcOut, "flow/html.js")}?feedback=${Date.now()}`
	);
	const html = renderFlowHtml(join(cwd, ".flow", "F1"), flow);
	assert(html.includes("尾部唯一反馈"), "model hover feedback was truncated");
	assert(
		html.includes("tip.contains(event.target)"),
		"hover detail should stay open while its own content scrolls",
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
	await module.pauseGoalFromFlow(ctx);
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
							eventsEmitted: true,
							phase: "after_message_stream_start",
						},
					},
				],
			},
		],
	};
}

function writeConfig({
	acceptance = false,
	quality = false,
	command,
	models,
	modelRoles,
	advisor,
	openaiFast = false,
	timeoutMs = 30000,
}) {
	mkdirSync(out, { recursive: true });
	const runnerCommand =
		command ?? script("PASS\nOK\n证据：文件=src/app.ts；命令=npm test\n");
	const reviewers = models ?? [{ model: "test/gpt-5.4-mini", thinking: "off" }];
	writeFileSync(
		join(out, "config.json"),
		JSON.stringify({
			background: {
				command: routedDiagnosticCommand(runnerCommand, reviewers),
				extensions: [],
			},
			checks: {
				tools: ["read", "grep", "find", "ls", "bash"],
				// 预算宽松：高负载并发环境（如多模型验收）下 shell 启动可能超数秒，
				// 过紧的超时会把子进程误杀成 unavailable，造成时序抖动。
				timeoutMinutes: timeoutMs / 60_000,
				openaiFast,
			},
			modelRoles: {
				reviewers: reviewers.map(({ model, thinking }) => ({
					model,
					thinking,
				})),
				...(modelRoles ?? {}),
			},
			...(advisor ? { advisor } : {}),
			acceptance: { enabled: acceptance },
			quality: {
				enabled: quality,
				mode: "autoFix",
				runAfterCompletion: quality,
			},
		}),
	);
}

function routedDiagnosticCommand(defaultCommand, reviewers) {
	const routes = reviewers.filter(
		(reviewer) => reviewer.command && reviewer.command !== defaultCommand,
	);
	if (routes.length === 0) return defaultCommand;
	let path = diagnosticRouters.get(defaultCommand);
	if (!path) {
		path = join(bin, `diagnostic-router-${diagnosticRouters.size + 1}`);
		diagnosticRouters.set(defaultCommand, path);
	}
	const cases = routes
		.map(
			(reviewer) =>
				`${shellQuote(reviewer.model)}) exec ${shellQuote(reviewer.command)} "$@" ;;`,
		)
		.join("\n");
	// bash (not dash) so missing-exec stderr is "No such file or directory" on both macOS and Ubuntu
	writeFileSync(
		path,
		`#!/bin/bash
model=''
previous=''
prompt=''
for argument in "$@"; do
  if [ "$previous" = '--model' ]; then model="$argument"; fi
  previous="$argument"
  prompt="$argument"
done
case "$prompt" in
  *"# 顾问"*|*"# Advisor"*) exec ${shellQuote(defaultCommand)} "$@" ;;
esac
case "$model" in
${cases}
esac
exec ${shellQuote(defaultCommand)} "$@"
`,
		{ mode: 0o755 },
	);
	return path;
}

function shellQuote(value) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function proxyCommand(command) {
	return shellScript(`exec '${command.replaceAll("'", "'\\''")}' "$@"`);
}

function script(output) {
	return shellScript(`printf '%s' ${shellQuote(assistantJson(output))}`);
}

function interruptOnceScript(output) {
	mkdirSync(bin, { recursive: true });
	const path = join(bin, `interrupt-${Math.random().toString(16).slice(2)}`);
	writeFileSync(
		path,
		`#!/usr/bin/env node
import fs from "node:fs";
const countPath = ${JSON.stringify(`${path}.count`)};
const count = Number(fs.existsSync(countPath) ? fs.readFileSync(countPath, "utf8") : 0) + 1;
fs.writeFileSync(countPath, String(count));
if (count === 1) {
  process.on("SIGTERM", () => process.exit(0));
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(${JSON.stringify(assistantJson(output))});
}
`,
		{ mode: 0o755 },
	);
	return path;
}

function scriptRunCount(command) {
	try {
		return Number(readFileSync(`${command}.count`, "utf8").trim());
	} catch {
		return 0;
	}
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
printf '%s' ${shellQuote(assistantJson(output))}
`,
		{ mode: 0o755 },
	);
	return path;
}

function advisorScript(output) {
	const path = join(bin, `advisor-${Math.random().toString(16).slice(2)}`);
	writeFileSync(
		path,
		`#!/bin/sh
count_file='${path}.count'
count=$(cat "$count_file" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$count_file"
while [ "$#" -gt 0 ]; do
  printf '%s\n---ARG---\n' "$1"
  shift
done > '${path}.args'
printf '%s' ${shellQuote(jsonEvents(assistantProgressEvents(output, "src/advisor.ts")))}
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
		writeFileSync(file, assistantJson(output));
		return file;
	});
	writeFileSync(
		path,
		`#!/bin/sh\ncount_file='${path}.count'\ncount=$(cat "$count_file" 2>/dev/null || echo 0)\ncount=$((count + 1))\necho "$count" > "$count_file"\ncase "$count" in\n${files.map((file, index) => `${index + 1}) cat '${file}' ;;`).join("\n")}\n${fallbackCase.replace("{{last}}", files.at(-1))}\nesac\n`,
		{ mode: 0o755 },
	);
	return path;
}

function assistantJson(text) {
	if (!text) return "";
	return `${JSON.stringify({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text }] },
	})}\n`;
}

function assistantProgressEvents(text, path) {
	return [
		{
			type: "tool_execution_start",
			toolCallId: "read-1",
			toolName: "read",
			args: { path },
		},
		{
			type: "tool_execution_end",
			toolCallId: "read-1",
			toolName: "read",
			isError: false,
		},
		JSON.parse(assistantJson(text)),
	];
}

function jsonEvents(events) {
	return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function jsonEventCommand(events) {
	const path = join(bin, `events-${Math.random().toString(16).slice(2)}`);
	writeFileSync(
		path,
		`#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(jsonEvents(events))});\n`,
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
	const { default: advisorExtension } = await import(
		`file://${join(srcOut, "advisor.js")}?t=${Date.now()}-${Math.random()}`
	);
	const handlers = new Map();
	const commands = new Map();
	const api = {
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerTool() {},
		registerMessageRenderer() {},
		getThinkingLevel() {
			return "high";
		},
		appendEntry(customType, data) {
			state.entries.push({
				type: "custom",
				id: `custom-${state.entries.length + 1}`,
				parentId: state.entries.at(-1)?.id ?? null,
				timestamp: new Date().toISOString(),
				customType,
				data,
			});
		},
		sendUserMessage(message) {
			state.sentMessages.push(String(message));
		},
		sendMessage(message, options = {}) {
			if (
				state.simulateAgentLifecycle &&
				state.inAgentEnd &&
				options.deliverAs !== "nextTurn"
			)
				state.queuedAgentStarts += 1;
			if (
				state.failResultCardTitle &&
				message.details?.title === state.failResultCardTitle
			)
				throw new Error("injected result card delivery failure");
			state.entries.push({
				type: "custom_message",
				id: `message-${state.entries.length + 1}`,
				parentId: state.entries.at(-1)?.id ?? null,
				timestamp: new Date().toISOString(),
				customType: message.customType,
				content: message.content,
				display: message.display,
				details: message.details,
			});
			if (
				message.customType === "pi-flow-goal-prompt" ||
				message.customType === "pi-flow-advisor-direction"
			) {
				if (state.failGoalPromptSend)
					throw new Error("injected goal prompt send failure");
				state.sentMessages.push(String(message.content));
				return;
			}
			if (message.details?.title) state.messages.push({ message, options });
			state.afterResultCardSend?.(message);
			if (
				state.failAfterResultCardTitle &&
				message.details?.title === state.failAfterResultCardTitle
			)
				throw new Error("injected post-delivery failure");
		},
		on(name, handler) {
			if (name !== "agent_end") return handlers.set(name, handler);
			handlers.set(name, async (...args) => {
				state.inAgentEnd = true;
				try {
					await handler(...args);
				} finally {
					state.inAgentEnd = false;
				}
				while (state.queuedAgentStarts > 0) {
					state.queuedAgentStarts -= 1;
					state.agentStarts += 1;
					await handlers.get("agent_start")?.({}, args[1]);
				}
				await module.waitForScheduledGoalStateReview();
			});
		},
	};
	module.default(api);
	advisorExtension(api);
	return { commands, handlers, module };
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

function fireTimer(timer) {
	assert(timer && !timer.cleared, `timer already cleared: ${timer?.delay}`);
	timer.cleared = true;
	timer.callback(...timer.args);
}

function createState() {
	return {
		entries: [],
		messages: [],
		sentMessages: [],
		notifications: [],
		statuses: [],
		widgets: [],
		missingModels: new Set(),
		simulateAgentLifecycle: false,
		inAgentEnd: false,
		queuedAgentStarts: 0,
		agentStarts: 0,
	};
}

function mockContext(state, cwd = defaultCwd, sessionFile = undefined) {
	return {
		cwd,
		hasUI: true,
		model: { provider: "test", id: "executor-model", contextWindow: 200_000 },
		modelRegistry: {
			find(provider, modelId) {
				if (state.missingModels.has(`${provider}/${modelId}`)) return undefined;
				return { provider, id: modelId, contextWindow: 200_000 };
			},
		},
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
			return state.pendingMessages ?? false;
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
				if (customType === "goal-state" && state.dropGoalStateWrites) return;
				if (
					customType === "pi-flow-goal-completed" &&
					state.dropCompletionFactWrites
				)
					return;
				state.entries.push({
					type: "custom",
					id: `custom-${state.entries.length + 1}`,
					parentId: state.entries.at(-1)?.id ?? null,
					timestamp: new Date().toISOString(),
					customType,
					data,
				});
			},
		},
	};
}

function writeFlow(cwd, sessionFile) {
	const dir = join(cwd, ".flow", "F1");
	mkdirSync(dir, { recursive: true });
	const planMarkdown =
		"# Login\n\n## Objective\nFlow objective\n\n## Scope\nFlow scope.\n\n## Steps\n- [x] Ship login.\n\n## Success Criteria\n- Flow plan proof.\n\n## Verification\n- [x] test\n\n## Notes\n\n## Handoff\n";
	writeFileSync(join(dir, "G1-login.md"), planMarkdown);
	writeFileSync(
		join(dir, "flow.json"),
		`${JSON.stringify(
			{
				schemaVersion: 17,
				language: "zh",
				id: "F1",
				title: "Login",
				status: "running",
				source: { type: "prompt", text: "login" },
				createdAt: Date.now(),
				updatedAt: Date.now(),
				startedAt: Date.now(),
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
						title: "Login",
						role: "normal",
						file: "G1-login.md",
						status: "running",
						startedAt: Date.now(),
						completedAt: null,
						completionCursor: null,
						sessionFile,
						sessionName: null,
						// 生产不变量：running 步骤必有启动快照（修订仲裁基线）。
						snapshot: planMarkdown,
						goalId: null,
						result: {
							summary: null,
							handoff: null,
							handoffGenerated: false,
							criteriaChanged: false,
						},
						checks: emptyChecks(),
						pendingAdvisor: null,
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
		readFileSync(join(cwd, ".flow", "F1", "flow.json"), "utf8"),
	);
}

function emptyChecks() {
	return {
		acceptance: { enabled: true, rounds: [], active: null },
		quality: { enabled: true, rounds: [], active: null },
	};
}

function renderGoalWidgets(state, key) {
	return state.widgets
		.filter((item) => item.key === key && typeof item.content === "function")
		.map((item) =>
			item
				.content({}, { fg: (_color, text) => text })
				.render(100)
				.map(stripGoalAnsi)
				.join("\n"),
		);
}

function stripGoalAnsi(text) {
	const ansiEscape = String.fromCharCode(27);
	return text.replace(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "g"), "");
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

function enableMonitorProbe(ctx, state, activeProgressSnapshot) {
	ctx.mode = "tui";
	ctx.ui.custom = () => {
		state.monitorScopes ??= [];
		state.monitorScopes.push(activeProgressSnapshot().scopes.at(-1)?.kind);
		return Promise.resolve("scope-closed");
	};
}

function widgetTexts(state) {
	return state.widgets
		.map(({ content }) => renderWidgetContent(content))
		.filter(Boolean);
}

function renderWidgetContent(content) {
	if (!content) return "";
	const widget =
		typeof content === "function"
			? content(
					{ requestRender() {} },
					{ fg: (_color, value) => value, bold: (value) => value },
				)
			: content;
	return widget?.render ? widget.render(100).join("\n") : String(widget);
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
	const message = notification.replace(/:(info|warning|error)$/u, "");
	assert(message.startsWith(`${emoji} `), message);
	const bodyIndex = message.indexOf("\n\n");
	assert(bodyIndex > 0, message);
	assert(message.slice(bodyIndex + 2).includes(body), message);
	assert(!/[。.]$/u.test(message), message);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
