import { execFileSync, spawn } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	watch,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-flow-test-${runId}`);
process.env.PI_CODING_AGENT_DIR = join(out, "agent-state");
const srcOut = join(out, "src");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "prompts"), join(out, "prompts"), { recursive: true });
mkdirSync(join(out, "assets"), { recursive: true });
cpSync(join(root, "assets", "logo.png"), join(out, "assets", "logo.png"));
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	["--outDir", srcOut, "--rootDir", "src", "--noEmit", "false"],
	{ cwd: root, stdio: "inherit" },
);
function writeFlowTestConfig({
	state = false,
	quality = false,
	generation,
	modelRoles,
	language = "zh",
	runner = {},
} = {}) {
	writeFileSync(
		join(out, "config.json"),
		JSON.stringify({
			language,
			...(generation === undefined ? {} : { generation }),
			...(modelRoles === undefined ? {} : { modelRoles }),
			runner: {
				command: runner.command ?? "pi",
				tools: runner.tools ?? [],
				excludeTools: runner.excludeTools ?? [],
				timeoutMs: runner.timeoutMs ?? 1000,
				extensions: runner.extensions ?? [],
			},
			models: [{ model: "x", thinking: "off" }],
			acceptance: {
				enabled: state,
			},
			quality: {
				enabled: quality,
				mode: "autoFix",
				runAfterCompletion: quality,
			},
		}),
	);
}
writeFlowTestConfig();

try {
	await runScenario(flowGoalPromptChecklistSyncScenario);
	await runScenario(completionListenerUsesFreshApiAfterReloadScenario);
	await runScenario(flowGoalRuntimePromptContextScenario);
	await runScenario(privateWorkerRequiresParentScenario);
	await runScenario(workerAlreadyCompleteNoticeFormatScenario);
	await runScenario(privateWorkerCompletionExitScenario);
	await runScenario(privateWorkerControlDisconnectScenario);
	await runScenario(workerSpawnConfigScenario);
	await runScenario(parallelLaneBoardThreeGoalScenario);
	await runScenario(parallelRunSuccessScenario);
	await runScenario(parallelStatusPreservesLiveReportScenario);
	await runScenario(parallelRunFailureScenario);
	await runScenario(parallelRunRecoveryScenario);
	await runScenario(flowParallelStopGoScenario);
	await runScenario(flowParallelStopAllResultsCompleteScenario);
	await runScenario(parallelFanInLockScenario);
	await runScenario(flowConcurrentRecoveryFanInLockScenario);
	await runScenario(flowLockStaleScenario);
	await runScenario(flowConcurrentGoLockScenario);
	await runScenario(schemaScenario);
	await runScenario(badJsonScenario);
	await runScenario(flowIdSafetyScenario);
	await runScenario(flowBareIdMessageScenario);
	await runScenario(flowTargetRoutingScenario);
	await runScenario(flowResumeTargetHintUsesGoScenario);
	await runScenario(flowCurrentGoalOwnerRoutingScenario);
	await runScenario(flowPreDraftTargetRoutingScenario);
	await runScenario(flowCommandRoutingSafetyScenario);
	await runScenario(flowControlCommandShapeScenario);
	await runScenario(flowIndependentStartWhileRunningScenario);
	await runScenario(flowRootSymlinkScenario);
	await runScenario(statusValidationScenario);
	await runScenario(statusRewritesNonParallelHtmlScenario);
	await runScenario(statusTextHidesSessionPathScenario);
	await runScenario(malformedRepairScenario);
	await runScenario(runningValidationScenario);
	await runScenario(htmlScenario);
	await runScenario(generationAlignConfigScenario);
	await runScenario(flowModelSwitchFailurePersistsPreDraftScenario);
	await runScenario(flowPromptSendFailureShowsPreDraftIdScenario);
	await runScenario(flowMissingGenerationContinueScenario);
	await runScenario(flowNoIdGenerationContinueScenario);
	await runScenario(flowExplicitPreDraftContinueKeepsTargetScenario);
	await runScenario(flowPromptedContinueDoesNotOverwriteInflightTargetScenario);
	await runScenario(flowExplicitPreDraftRepairKeepsTargetScenario);
	await runScenario(flowCrossSessionGenerationContinueScenario);
	await runScenario(flowCrossSessionOldReplyTargetIgnoredScenario);
	await runScenario(flowCrossSessionOldPromptTargetIgnoredScenario);
	await runScenario(
		flowReboundLivePromptDoesNotBlockOldSessionContinueScenario,
	);
	await runScenario(flowReboundLivePromptDoesNotBlockOldSessionReplyScenario);
	await runScenario(flowCrossSessionCompletedTargetIgnoresOldPromptScenario);
	await runScenario(flowCrossSessionFinalConfirmInputScenario);
	await runScenario(flowExplicitAligningRecoveryReplyTargetScenario);
	await runScenario(flowExplicitWaitingStageDirectReplyTargetScenario);
	await runScenario(flowExplicitReplyTargetPersistsAcrossRoundsScenario);
	await runScenario(flowRecoveredInputKeepsCommandAutoStartScenario);
	await runScenario(flowCrossSessionFinalConfirmAutoStartContextScenario);
	await runScenario(flowCrossSessionWaitingStagesPlannerSwitchScenario);
	await runScenario(flowAlignmentStageWriteFailureRollsBackScenario);
	await runScenario(flowRepairAlignmentWriteFailureRollsBackScenario);
	await runScenario(flowPreDraftStatusTextScenario);
	await runScenario(flowPreDraftDirectReplyAmbiguousScenario);
	await runScenario(generationAlignCommandConfigScenario);
	await runScenario(flowAlignmentActivityCopyScenario);
	await runScenario(flowDuplicatePreDraftStartBlockedScenario);
	await runScenario(flowReadyWithoutAlignedRequestScenario);
	await runScenario(flowRestoredAlignmentContextScenario);
	await runScenario(flowStreamingAlignmentInputDoesNotEchoScenario);
	await runScenario(englishFlowAlignmentStartGenerationScenario);
	await runScenario(generateScenario);
	await runScenario(generatedSummaryBareIdScenario);
	await runScenario(flowAutoStartUsesCommandContextScenario);
	await runScenario(flowAutoStartWithoutCommandContextStaysDraftScenario);
	await runScenario(flowHandwrittenRejectedScenario);
	await runScenario(semanticFlowGenerationEndScenario);
	await runScenario(flowSemanticOverridesHandwrittenScenario);
	await runScenario(malformedCurrentFlowSemanticKeepsRepairingScenario);
	await runScenario(missingFlowSemanticTitleKeepsRepairingScenario);
	await runScenario(flowClarificationScenario);
	await runScenario(flowContinueDraftStartsScenario);
	await runScenario(flowStopDraftGoScenario);
	await runScenario(flowReportServerSurvivesSessionShutdownScenario);
	await runScenario(flowSessionStartRebindsReportStatusScenario);
	await runScenario(flowClarificationSendFailureClearsPendingScenario);
	await runScenario(flowRepairSendFailureClearsPendingScenario);
	await runScenario(preDraftGenerationScenario);
	await runScenario(englishFlowGeneratedSummaryUsesArtifactLanguageScenario);
	await runScenario(flowGoalSendFailureRollsBackScenario);
	await runScenario(flowStartPromptSkipsAfterStopScenario);
	await runScenario(flowGenerationStopIgnoresLatePromptScenario);
	await runScenario(flowPreDraftStopGoScenario);
	await runScenario(flowSequentialStopGoScenario);
	await runScenario(flowStopConsumesQueuedContinuationPromptScenario);
	await runScenario(flowStartPromptSurvivesSessionNameSyncScenario);
	await runScenario(flowStartSessionNameDoesNotSelfReportBusyScenario);
	await runScenario(flowRollbackUsesSchedulingLockScenario);
	await runScenario(flowRollbackPreservesConcurrentSessionNameScenario);
	await runScenario(verifyCurrentSnapshotUsesLatestFlowScenario);
	await runScenario(completionWithEventCommandContextScenario);
	await runScenario(completionWithoutRememberedContextScenario);
	await runScenario(flowHandoffCriteriaDeviationScenario);
	await runScenario(stuckRefactorBContinueScenario);
	await runScenario(completionEventUsesRememberedCommandContextScenario);
	await runScenario(completionEmitUsesEmittedContextScenario);
	await runScenario(completionCommandConsumesStoredFactScenario);
	await runScenario(flowStartWithoutNewSessionScenario);
	await runScenario(flowStartNewSessionThrowScenario);
	await runScenario(flowStartNewSessionPreReplacementStaleThrowScenario);
	await runScenario(flowStartNewSessionPostReplacementThrowScenario);
	await runScenario(englishFlowDynamicNotificationsScenario);
	await runScenario(englishFlowCardsUseArtifactLanguageScenario);
	await runScenario(flowStartUsesReplacementContextScenario);
	await runScenario(flowResumeMissingRuntimeGoalHiddenPromptScenario);
	await runScenario(startResumeCancelScenario);
	await runScenario(sessionNameSyncScenario);
	await runScenario(snapshotMutationScenario);
	await runScenario(snapshotCheckboxMutationMessageScenario);
	await runScenario(flowGoalWatcherScenario);
	await runScenario(flowParallelMainGoalWatcherScenario);
	await runScenario(flowParallelWatcherScenario);
	await runScenario(goalRuntimeSessionIsolationScenario);
	await runScenario(sessionContextIsolationScenario);
	await runScenario(ownershipScenario);
	await runScenario(singleStepCompletionNoSaveFailureScenario);
	await runScenario(finalizeRetryCursorContinueScenario);
	await runScenario(completionScenario);
	await runScenario(completionFactClearsGoalUiScenario);
	console.log("flow smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

async function runScenario(fn, name = fn.name) {
	try {
		await fn();
	} catch (error) {
		console.error(`flow smoke failed in ${name}`);
		throw error;
	}
}

async function flowGoalPromptChecklistSyncScenario() {
	const { planGoalPrompt } = await importModule("flow/prompt.js");
	const { buildContinuePrompt, buildGoalSystemPrompt, buildResumePrompt } =
		await importModule("goal/prompts.js");
	const goal = {
		index: 0,
		title: "Ship",
		role: "normal",
		file: "G1-plan.md",
		result: {
			summary: null,
			handoff: null,
			handoffGenerated: false,
			criteriaChanged: false,
		},
		checks: emptyChecks(),
	};
	const flow = { id: "F1", language: "zh", goals: [goal] };
	const prompt = planGoalPrompt(flow, goal, "# Ship\n\n## Steps\n\n- [ ] Ship");
	assert(
		prompt.includes("当前 Goal plan 完整 snapshot（初始计划状态）") &&
			prompt.includes("已满足首轮计划读取") &&
			prompt.includes(
				"第一次进度更新前不要为了复述同一状态重复读取当前 markdown",
			) &&
			prompt.includes("任何进度更新后，以当前计划 markdown 为权威"),
		"flow start prompt missing initial snapshot state",
	);
	assert(
		prompt.includes("前序 Handoff"),
		"flow start prompt missing handoff block",
	);
	assert(
		prompt.includes("只执行当前 Goal"),
		"flow prompt missing step boundary",
	);
	assert(
		prompt.includes("system prompt 注入的 Flow 步骤规则"),
		"flow prompt missing system-rule pointer",
	);
	assert(
		prompt.includes("不要手写或修改 flow.json"),
		"flow prompt should keep flow.json plugin-owned",
	);
	assert(
		!prompt.includes("开始某项前立刻从 [ ] 改为 [~]") &&
			!prompt.includes("[~] 改为 [x]") &&
			!prompt.includes("必须按 Verification 跑验证"),
		"flow start prompt repeated the full execution manual",
	);
	assert(
		!prompt.includes("开始前必须读取当前计划 markdown"),
		"flow start prompt should not force a duplicate startup read",
	);
	const flowTodoContext = {
		planPath: ".flow/F1/G1-plan.md",
		recordSection: "Handoff",
		stateFile: "flow.json",
	};
	const activeGoal = { text: "Ship", iteration: 2, language: "zh" };
	const systemPrompt = buildGoalSystemPrompt(activeGoal, flowTodoContext);
	assert(
		systemPrompt.includes(".flow/F1/G1-plan.md"),
		"flow system prompt missing current goal file",
	);
	assert(
		systemPrompt.includes("持久 Todo") &&
			systemPrompt.includes("HTML 实时进度来源") &&
			systemPrompt.includes("初始计划状态") &&
			systemPrompt.includes("从 [ ] 改为 [~]") &&
			systemPrompt.includes("从 [~] 改为 [x]") &&
			systemPrompt.includes("[!]") &&
			systemPrompt.includes("禁止最终集中补账"),
		"flow system prompt missing todo status-change rule",
	);
	assert(
		systemPrompt.includes("切换下一项前必须重新读取或检查") &&
			systemPrompt.includes("为什么先跳过") &&
			systemPrompt.includes("可跳到下一个未完成项"),
		"flow system prompt missing reread or blocked-skip rule",
	);
	assert(
		systemPrompt.includes("Handoff") &&
			systemPrompt.includes("维护原因写入 Handoff") &&
			systemPrompt.includes("完成前必须按 Verification 跑验证"),
		"flow system prompt missing Handoff or Verification rule",
	);
	assert(
		systemPrompt.includes("不要手写或修改 flow.json"),
		"flow system prompt should keep flow.json plugin-owned",
	);
	assert(
		!systemPrompt.includes("当前 plan.md"),
		"flow system prompt should not mention standalone plan.md",
	);
	const resumePrompt = buildResumePrompt(activeGoal, flowTodoContext);
	const continuePrompt = buildContinuePrompt(
		activeGoal,
		"marker",
		flowTodoContext,
	);
	for (const runtimePrompt of [resumePrompt, continuePrompt]) {
		assert(
			runtimePrompt.includes("继续前必须读取 .flow/F1/G1-plan.md") &&
				runtimePrompt.includes("第一个未完成项") &&
				runtimePrompt.includes("不要依赖旧 snapshot"),
			"resume/continue prompt missing current plan read requirement",
		);
		assert(
			!runtimePrompt.includes("从 [ ] 改为 [~]") &&
				!runtimePrompt.includes("从 [~] 改为 [x]") &&
				!runtimePrompt.includes("维护原因写入 Handoff"),
			"resume/continue prompt repeated the full execution manual",
		);
	}
	const workerPrompt = buildGoalSystemPrompt({
		...activeGoal,
		artifactDir: join(out, "worker", "G1"),
	});
	assert(
		workerPrompt.includes(join(out, "worker", "G1", "plan.md")) &&
			workerPrompt.includes("Handoff") &&
			workerPrompt.includes("state.json"),
		"worker goal prompt did not use worker plan/Handoff/state semantics",
	);
}

async function completionListenerUsesFreshApiAfterReloadScenario() {
	const { planSnapshotHash } = await importModule("plan/snapshot.js");
	const { emitFlowGoalCompleted } =
		await importCachedModule("flow/completion.js");
	const cwd = tempDir("completion-listener-fresh-api");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	await loadExtension(state);
	state.staleApis.add(state.extensionApis.at(-1));
	await loadExtension(state);
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFileSync(sessionFile, "");
	const flow = readFlow(dir);
	const snapshot = readFileSync(join(dir, flow.goals[0].file), "utf8");
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	flow.goals[0].sessionFile = sessionFile;
	flow.goals[0].snapshot = snapshot;
	flow.goals[0].snapshotHash = planSnapshotHash(snapshot);
	writeFlow(dir, flow);
	const ctx = commandContext(state, cwd, sessionFile);
	emitFlowGoalCompleted(completionEntry(sessionFile).data, ctx);
	await flushScheduledGoalStart();
	const saved = readFlow(dir);
	assert(saved.status === "complete", "stale listener did not complete flow");
	const completeCards = state.customMessages.filter(
		(item) => item.message.details?.title === "Flow 已完成",
	);
	assert(
		completeCards.length === 1,
		"fresh Flow complete card was not sent once",
	);
	assert(
		completeCards[0].options.triggerTurn === true,
		"Flow complete card did not trigger final reply",
	);
	assert(
		!state.notifications.some(
			(message) =>
				message.includes("结果卡片发送失败") || message.includes("stale pi"),
		),
		state.notifications.join("\n"),
	);
}

async function flowGoalRuntimePromptContextScenario() {
	const cwd = tempDir("flow-runtime-prompt");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { handlers } = await loadExtension(state);
	const { startGoalFromFlow } = await importCachedModule("goal.js");
	const sessionFile = join(cwd, "flow-session.jsonl");
	writeFileSync(sessionFile, "");
	const flow = readFlow(dir);
	writeFlow(dir, {
		...flow,
		status: "running",
		startedAt: Date.now(),
		currentGoal: 0,
		goals: [
			{ ...flow.goals[0], status: "running", sessionFile },
			flow.goals[1],
		],
	});
	const ctx = commandContext(state, cwd, sessionFile);
	assert(
		await startGoalFromFlow("Flow objective", ctx),
		"flow goal did not start",
	);
	const result = await emitLast(
		handlers,
		"before_agent_start",
		{ prompt: "go", systemPrompt: "base" },
		ctx,
	);
	const systemPrompt = result?.systemPrompt ?? "";
	assert(
		systemPrompt.includes(".flow/F1/G1-plan.md"),
		"flow system prompt missing current goal file",
	);
	assert(
		systemPrompt.includes("Handoff") &&
			systemPrompt.includes("不要手写或修改 flow.json"),
		"flow system prompt missing flow-owned todo context",
	);
	assert(
		!systemPrompt.includes("当前 plan.md"),
		"flow system prompt mentioned standalone plan.md",
	);
}

async function privateWorkerRequiresParentScenario() {
	const cwd = tempDir("private-worker-no-parent");
	const dir = createFlow(cwd, "F1", { planCount: 3 });
	const state = newState(cwd);
	const { handlers } = await loadExtension(state);
	const workerDir = join(dir, "workers", "G1");
	const ctx = commandContext(state, cwd, join(workerDir, "session.jsonl"));

	await emit(handlers, "session_start", {}, ctx);

	assert(
		!existsSync(join(workerDir, "plan.md")),
		"worker started without parent env",
	);
	assert(
		!existsSync(join(workerDir, "state.json")),
		"worker state written without parent env",
	);
	assert(
		!existsSync(join(workerDir, "result.json")),
		"worker result written without parent env",
	);
}

async function workerAlreadyCompleteNoticeFormatScenario() {
	const { goalAlreadyCompleteMessage } = await importModule(
		"flow/execution/worker-command.js",
	);
	assertNoticeMessageFormat(
		goalAlreadyCompleteMessage({ index: 1 }, "zh"),
		"✅",
		"无需启动 worker",
	);
	assertNoticeMessageFormat(
		goalAlreadyCompleteMessage({ index: 1 }, "en"),
		"✅",
		"Worker start skipped",
	);
}

async function privateWorkerCompletionExitScenario() {
	const run = await startPrivateWorkerChild("private-worker-completion", "F1");
	let exited = false;
	const exitPromise = waitForChildExit(run.child).then((exit) => {
		exited = true;
		return exit;
	});
	try {
		await run.control.socket;
		await waitForFile(join(run.cwd, "private-worker-started"));
		await waitForFile(join(run.workerDir, "result.json"));
		const copiedPlan = readFileSync(join(run.workerDir, "plan.md"), "utf8");
		assert(
			copiedPlan === readFileSync(join(run.dir, "G2-plan.md"), "utf8"),
			"private worker plan.md was not copied from the selected flow goal",
		);
		const artifact = readGoalArtifact(run.workerDir);
		assert(
			["running", "complete"].includes(artifact.status),
			`private worker state missing: ${artifact.status}`,
		);
		assert(
			artifact.sessionFile === run.sessionPath,
			"private worker session mismatch",
		);
		assert(
			!existsSync(join(run.workerDir, "goal.html")),
			"worker goal.html was generated",
		);
		const result = JSON.parse(
			readFileSync(join(run.workerDir, "result.json"), "utf8"),
		);
		assert(
			result.sessionFile === run.sessionPath &&
				result.parallelRunId === run.parallelRunId,
			"private worker result.json missing session or parallelRunId",
		);
		assert(
			readFileSync(join(run.dir, "flow.json"), "utf8") === run.beforeFlowJson,
			"private worker modified flow.json",
		);
		const exit = await exitPromise;
		assert(exit.code === 0 && exit.signal === null, JSON.stringify(exit));
	} finally {
		run.control.server.close();
		removePrivateWorkerSocket(run.socketPath);
		if (!exited) run.child.kill("SIGKILL");
	}
}

async function privateWorkerControlDisconnectScenario() {
	const run = await startPrivateWorkerChild("private-worker-control", "F1", {
		emitAgentEnd: false,
	});
	let exited = false;
	const exitPromise = waitForChildExit(run.child).then((exit) => {
		exited = true;
		return exit;
	});
	try {
		const controlSocket = await run.control.socket;
		await waitForFile(join(run.cwd, "private-worker-started"));
		controlSocket.destroy();
		const exit = await exitPromise;
		assert(exit.code === 1 && exit.signal === null, JSON.stringify(exit));
		assert(
			!existsSync(join(run.workerDir, "result.json")),
			"private worker wrote result after control disconnect",
		);
		assert(
			readFileSync(join(run.dir, "flow.json"), "utf8") === run.beforeFlowJson,
			"private worker modified flow.json before disconnect",
		);
	} finally {
		run.control.server.close();
		removePrivateWorkerSocket(run.socketPath);
		if (!exited) run.child.kill("SIGKILL");
	}
}

async function startPrivateWorkerChild(cwdName, flowId, scriptOptions = {}) {
	const { privateWorkerEnv, privateWorkerMessage } = await importModule(
		"flow/execution/worker-protocol.js",
	);
	const cwd = tempDir(cwdName);
	const dir = createFlow(cwd, flowId, { planCount: 3 });
	const flow = readFlow(dir);
	const parallelRunId = "P-private-worker";
	writeFlow(dir, {
		...flow,
		status: "running",
		startedAt: Date.now(),
		parallelRun: { id: parallelRunId, goalIndexes: [1], startedAt: Date.now() },
	});
	const beforeFlowJson = readFileSync(join(dir, "flow.json"), "utf8");
	const workerDir = join(dir, "workers", "G1");
	const sessionPath = join(workerDir, "session.jsonl");
	const job = {
		flowId,
		flowDir: dir,
		goalIndex: 1,
		parallelRunId,
		sessionPath,
	};
	const socketPath = privateWorkerSocketPath(cwd);
	const token = "private-worker-token";
	const control = privateWorkerControlServer(privateWorkerMessage, job, token);
	await listenPrivateWorkerServer(control.server, socketPath);
	const child = spawn(
		process.execPath,
		[writePrivateWorkerChildScript(cwd, scriptOptions)],
		{
			cwd,
			env: {
				...process.env,
				...privateWorkerEnv({ ...job, socketPath, token }),
				FLOW_SMOKE_CWD: cwd,
				FLOW_SMOKE_SESSION: sessionPath,
				FLOW_SMOKE_SRC_OUT: srcOut,
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	return {
		beforeFlowJson,
		child,
		control,
		cwd,
		dir,
		parallelRunId,
		sessionPath,
		socketPath,
		workerDir,
	};
}

async function workerSpawnConfigScenario() {
	const { spawnWorker } = await importModule("flow/parallel/spawner.js");
	const { PRIVATE_WORKER_ENV } = await importModule(
		"flow/execution/worker-protocol.js",
	);
	const { flowMainExtensionPath } = await importModule(
		"shared/child-extensions.js",
	);
	const cwd = tempDir("worker-spawn-config");
	const command = installFakeWorkerRunner(cwd);
	const flowId = "F1";
	const flowDir = join(cwd, ".flow", flowId);
	const userExtension = join(cwd, "user-extension.ts");
	let handle;
	let exited = false;
	writeFlowTestConfig({
		runner: {
			command,
			tools: ["read"],
			excludeTools: ["write"],
			extensions: [userExtension],
		},
	});
	try {
		handle = spawnWorker({
			flowId,
			goalIndex: 2,
			flowDir,
			parallelRunId: "P-worker-spawn-config",
			cwd,
		});
		const eventPromise = firstWorkerEvent(handle);
		const exitPromise = workerExit(handle).then((exit) => {
			exited = true;
			return exit;
		});
		const argsPath = join(cwd, "worker-spawn-args.json");
		await waitForFile(argsPath);
		writeFileSync(join(cwd, "release-worker-spawn"), "");
		const [event, exit] = await Promise.all([eventPromise, exitPromise]);
		const invocation = JSON.parse(readFileSync(argsPath, "utf8"));
		const args = invocation.args;
		const joined = args.join(" ");
		const sessionFile = join(flowDir, "workers", "G2", "session.jsonl");
		const extensions = flagValues(args, "-e");
		assert(invocation.command === command, JSON.stringify(invocation));
		assert(exit.code === 0 && exit.signal === null, JSON.stringify(exit));
		assert(event.type === "agent_start", JSON.stringify(event));
		assert(flagValue(args, "--mode") === "json", joined);
		assert(flagValue(args, "--session") === sessionFile, joined);
		assert(!args.includes("-p"), joined);
		assert(invocation.env[PRIVATE_WORKER_ENV.flowId] === flowId, joined);
		assert(invocation.env[PRIVATE_WORKER_ENV.goalIndex] === "2", joined);
		assert(
			invocation.env[PRIVATE_WORKER_ENV.parallelRunId] ===
				"P-worker-spawn-config",
			joined,
		);
		assert(
			invocation.env[PRIVATE_WORKER_ENV.sessionPath] === sessionFile,
			joined,
		);
		assert(invocation.env[PRIVATE_WORKER_ENV.socketPath], joined);
		assert(invocation.env[PRIVATE_WORKER_ENV.token], joined);
		assert(args.includes("--no-extensions"), joined);
		assert(extensions.includes(flowMainExtensionPath()), joined);
		assert(extensions.includes(userExtension), joined);
		assert(!args.includes("--tools"), joined);
		assert(!args.includes("--exclude-tools"), joined);
	} finally {
		if (handle && !exited) handle.kill();
		writeFlowTestConfig();
	}
}

async function parallelLaneBoardThreeGoalScenario() {
	const { showParallelLaneBoard } = await importModule(
		"flow/parallel/lane-ui.js",
	);
	const cwd = tempDir("parallel-lane-board");
	const dir = createThreeParallelFlow(cwd, "F1");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.parallelRun = parallelRun([1, 2, 3]);
	flow.goals[1].status = "running";
	flow.goals[2].status = "running";
	flow.goals[3].status = "running";
	const state = newState(cwd);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	const board = showParallelLaneBoard(ctx, dir, flow, [1, 2, 3]);

	let text = latestWidgetText(state);
	assert(text.includes("3 lanes"), `lane count missing:\n${text}`);
	assert(
		text.includes("Goal 2") &&
			text.includes("Goal 3") &&
			text.includes("Goal 4"),
		`three parallel goals missing:\n${text}`,
	);
	assert(count(text, "验收: 等待") === 3, text);

	writeWorkerGoalArtifact(dir, flow, 1, runningChecks());
	board.updateWorkerEvent(1, { type: "message_end" });
	text = latestWidgetText(state);
	assert(text.includes("验收: 进行中"), text);

	writeWorkerGoalArtifact(dir, flow, 1, passedChecks());
	board.updateWorkerEvent(1, { type: "agent_end" });
	text = latestWidgetText(state);
	assert(text.includes("✓ G2") && text.includes("验收: 通过"), text);

	writeWorkerGoalArtifact(dir, flow, 2, failedChecks());
	board.updateWorkerEvent(2, { type: "agent_end" });
	text = latestWidgetText(state);
	assert(text.includes("✗ G3") && text.includes("验收: 失败"), text);

	board.updateWorkerExit(3, 1, null);
	text = latestWidgetText(state);
	assert(text.includes("✗ G4") && text.includes("验收: 错误"), text);
	board.dispose();
	assert(
		state.widgets.filter((item) => item.key === "flow-parallel-lanes").at(-1)
			?.content === undefined,
		"lane board was not cleared",
	);
}

async function parallelRunSuccessScenario() {
	const cwd = tempDir("parallel-batch-success");
	const dir = createParallelFlow(cwd, "F1");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE = "1";
	let start;
	let startedParallelRunId;
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));

		start = commands.get("flow").handler("go F1", ctx);
		await Promise.all([
			waitForFile(join(cwd, "worker-1.started")),
			waitForFile(join(cwd, "worker-2.started")),
		]);
		await waitForCondition(
			() => latestWidgetText(state).includes("tool: bash"),
			"parallel lane widget did not show worker tool event",
		);
		const laneText = latestWidgetText(state);
		const { isFlowEditorInputHidden } = await importCachedModule(
			"shared/activity-frame.js",
		);
		assert(
			isFlowEditorInputHidden(),
			"parallel batch did not hide editor input",
		);
		assert(
			laneText.includes("Goal 2") && laneText.includes("Goal 3"),
			`parallel lane widget missing batch goals:\n${laneText}`,
		);
		assert(
			state.widgets.some(
				(item) =>
					item.key === "flow-parallel-lanes" &&
					item.options?.placement === "aboveEditor" &&
					item.content,
			),
			"parallel lane widget was not mounted above editor",
		);
		assert(
			state.workingVisible.includes(false),
			"parallel batch did not hide default working row",
		);
		const { planSnapshotHash } = await importModule("flow/snapshot.js");
		const startedFlow = readFlow(dir);
		assert(startedFlow.status === "running", "parallel start not persisted");
		assert(startedFlow.currentGoal === 1, "parallel currentGoal not persisted");
		startedParallelRunId = startedFlow.parallelRun?.id;
		assert(startedParallelRunId, "parallelRun id not persisted");
		assert(
			JSON.stringify(startedFlow.parallelRun?.goalIndexes) ===
				JSON.stringify([1, 2]),
			"parallelRun goal indexes not persisted",
		);
		for (const goalIndex of [1, 2]) {
			const goal = startedFlow.goals[goalIndex];
			const snapshot = readFileSync(join(dir, goal.file), "utf8");
			assert(goal.status === "running", `G${goalIndex} start not persisted`);
			assert(
				goal.sessionFile ===
					join(dir, "workers", `G${goalIndex}`, "session.jsonl"),
				`G${goalIndex} worker session not persisted`,
			);
			assert(
				goal.snapshot === snapshot,
				`G${goalIndex} snapshot not persisted`,
			);
			assert(
				goal.snapshotHash === planSnapshotHash(snapshot),
				`G${goalIndex} snapshot hash not persisted`,
			);
		}
		writeFileSync(join(cwd, "release-workers"), "");
		await start;
		await flushScheduledGoalStart();

		const flow = readFlow(dir);
		assert(flow.goals[1].status === "complete", "parallel G2 not complete");
		assert(flow.goals[2].status === "complete", "parallel G3 not complete");
		assert(
			flow.goals[3].status === "running",
			"next serial goal did not start",
		);
		assert(flow.currentGoal === 3, "parallel fan-in did not advance to G4");
		assert(flow.parallelRun === null, "parallel run was not cleared");
		assert(
			state.widgets.filter((item) => item.key === "flow-parallel-lanes").at(-1)
				?.content === undefined,
			"parallel lane widget was not cleared",
		);
		assert(
			state.workingVisible.includes(true),
			"parallel batch did not restore default working row",
		);
		assert(
			!isFlowEditorInputHidden(),
			"parallel batch did not restore editor input",
		);
		assert(state.newSessions.length === 1, "G4 did not start in a new session");
		assert(
			existsSync(join(dir, "workers", "G1", "result.json")) &&
				existsSync(join(dir, "workers", "G2", "result.json")),
			"worker result.json files missing",
		);
		for (const goalIndex of [1, 2]) {
			const result = JSON.parse(
				readFileSync(
					join(dir, "workers", `G${goalIndex}`, "result.json"),
					"utf8",
				),
			);
			assert(
				result.parallelRunId === startedParallelRunId,
				`G${goalIndex} result missing parallelRunId`,
			);
		}
	} finally {
		delete process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE;
		writeFileSync(join(cwd, "release-workers"), "");
		if (start) await start.catch(() => undefined);
		restorePi();
	}
}

async function parallelStatusPreservesLiveReportScenario() {
	const cwd = tempDir("parallel-status-live-report");
	const dir = createParallelFlow(cwd, "F1");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE = "1";
	let start;
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));

		start = commands.get("flow").handler("go F1", ctx);
		await Promise.all([
			waitForFile(join(cwd, "worker-1.started")),
			waitForFile(join(cwd, "worker-2.started")),
		]);
		const htmlPath = join(dir, "flow.html");
		await waitForFile(htmlPath);
		const workerDir = join(dir, "workers", "G1");
		const changed = onceFileChanged(htmlPath);
		writeFileSync(
			join(workerDir, "plan.md"),
			planMarkdown(2, false).replace(
				"Do work.",
				"Worker live status survives.",
			),
		);
		await changed;
		const before = readFileSync(htmlPath, "utf8");
		assert(
			before.includes("Worker live status survives."),
			"parallel watcher did not write worker live report",
		);

		for (const command of ["status F1", "status F1"]) {
			await commands.get("flow").handler(command, ctx);
			const statusMessage = state.notifications.at(-1) ?? "";
			assert(statusMessage.includes("Flow: F1"), statusMessage);
			assert(statusMessage.includes("当前: Goal 2"), statusMessage);
			assert(
				statusMessage.includes("🌐 网页报告: http://127.0.0.1:"),
				statusMessage,
			);
			const after = readFileSync(htmlPath, "utf8");
			assert(
				after.includes("Worker live status survives."),
				`parallel ${command} overwrote worker live report`,
			);
			assert(after === before, `parallel ${command} rewrote flow.html`);
		}

		writeFileSync(join(cwd, "release-workers"), "");
		await start;
		await flushScheduledGoalStart();
	} finally {
		delete process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE;
		writeFileSync(join(cwd, "release-workers"), "");
		if (start) await start.catch(() => undefined);
		restorePi();
	}
}

async function parallelRunFailureScenario() {
	const cwd = tempDir("parallel-batch-failure");
	const dir = createParallelFailureRetryFlow(cwd, "F1");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_FAIL_INDEX = "2";
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));

		await commands.get("flow").handler("go F1", ctx);

		const flow = readFlow(dir);
		assert(
			flow.goals[1].status === "complete",
			"successful worker was not fan-in completed after batch failure",
		);
		assert(
			flow.goals[2].status === "pending",
			"failed worker did not return to pending",
		);
		assert(
			flow.goals[2].sessionFile === null,
			"failed worker kept stale worker session",
		);
		assert(
			flow.goals[3].status === "pending",
			"batch failure started unbatched ready goal",
		);
		assert(
			flow.goals[4].status === "pending",
			"batch failure started final goal",
		);
		assert(flow.status === "running", "batch failure stopped the flow");
		assert(
			flow.currentGoal === 2,
			"current goal did not point to failed worker",
		);
		assert(flow.parallelRun === null, "failed parallel run was not cleared");
		assert(
			flow.errors.length === 1,
			"batch failure should only list failed workers",
		);
		const error = flow.errors[0] ?? "";
		assert(
			error.includes("第 3 步 · Goal 3"),
			`batch failure missing failed step label: ${error}`,
		);
		assert(
			error.includes("退出码 1"),
			`batch failure missing exit code: ${error}`,
		);
		assert(
			error.includes("缺少 result.json"),
			`batch failure missing result.json state: ${error}`,
		);
		assert(state.newSessions.length === 0, "batch failure should not start G4");
		delete process.env.PI_FLOW_FAKE_FAIL_INDEX;
		await commands.get("flow").handler("go", ctx);
		await flushScheduledGoalStart();
		const retried = readFlow(dir);
		assert(
			retried.goals[1].status === "complete",
			"manual retry reran successful worker",
		);
		assert(
			retried.goals[2].status === "running",
			"manual retry did not start failed worker",
		);
		assert(
			retried.goals[3].status === "pending",
			"manual retry started unrelated ready goal",
		);
		assert(
			retried.parallelRun === null,
			"manual retry recreated a parallel run",
		);
		assert(
			state.newSessions.length === 1,
			"manual retry did not open one session",
		);
		const workerRuns = readFileSync(join(cwd, "worker-runs.log"), "utf8")
			.trim()
			.split("\n");
		assert(
			workerRuns.filter((item) => item === "1").length === 1,
			`successful worker reran: ${workerRuns.join(",")}`,
		);
		assert(
			workerRuns.filter((item) => item === "2").length === 1,
			`failed worker reran as parallel worker: ${workerRuns.join(",")}`,
		);
		assert(
			workerRuns.filter((item) => item === "3").length === 0,
			`unrelated ready worker ran: ${workerRuns.join(",")}`,
		);
	} finally {
		delete process.env.PI_FLOW_FAKE_FAIL_INDEX;
		restorePi();
	}
}

async function parallelRunRecoveryScenario() {
	await parallelRunPartialRecoveryScenario();
	await parallelRunCompleteRecoveryScenario();
	await parallelRunEmptyRecoveryScenario();
}

async function parallelRunPartialRecoveryScenario() {
	const cwd = tempDir("parallel-recovery-partial");
	const dir = await createCrashedParallelFlow(cwd, "F1");
	writeWorkerResult(dir, 1, "P-crashed", "done 1");
	writeWorkerResult(dir, 2, "P-old", "stale 2");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));

	await commands.get("flow").handler("go", ctx);
	await flushScheduledGoalStart();

	const flow = readFlow(dir);
	assert(flow.parallelRun === null, "partial recovery kept parallelRun");
	assert(
		flow.goals[1].status === "complete",
		"partial recovery did not fan-in matching result",
	);
	assert(
		flow.goals[2].status === "running",
		"partial recovery did not restart missing result",
	);
	assert(
		flow.goals[2].goalId === null,
		"partial recovery consumed stale result",
	);
	assert(
		state.newSessions.length === 1,
		"partial recovery did not continue scheduling",
	);
	assertRecoveryNotice(state, ["已收口 第 2 步", "已重置 第 3 步"]);
}

async function parallelRunCompleteRecoveryScenario() {
	const cwd = tempDir("parallel-recovery-complete");
	const dir = await createCrashedParallelFlow(cwd, "F1");
	writeWorkerResult(dir, 1, "P-crashed", "done 1");
	writeWorkerResult(dir, 2, "P-crashed", "done 2");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));

	await commands.get("flow").handler("go", ctx);
	await flushScheduledGoalStart();

	const flow = readFlow(dir);
	assert(flow.parallelRun === null, "complete recovery kept parallelRun");
	assert(flow.goals[1].status === "complete", "complete recovery missed G2");
	assert(flow.goals[2].status === "complete", "complete recovery missed G3");
	assert(
		flow.goals[3].status === "running",
		"complete recovery did not start next step",
	);
	assert(
		state.newSessions.length === 1,
		"complete recovery did not continue scheduling",
	);
	assertRecoveryNotice(state, ["已收口 第 2 步", "第 3 步", "已重置 无"]);
}

async function parallelRunEmptyRecoveryScenario() {
	const cwd = tempDir("parallel-recovery-empty");
	const dir = await createCrashedParallelFlow(cwd, "F1");
	writeWorkerResult(dir, 1, "P-old", "stale 1");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE = "1";
	let run;
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		run = commands.get("flow").handler("go", ctx);
		await Promise.all([
			waitForFile(join(cwd, "worker-1.started")),
			waitForFile(join(cwd, "worker-2.started")),
		]);
		const restarted = readFlow(dir);
		assert(
			restarted.parallelRun?.id !== "P-crashed",
			"empty recovery reused crashed run id",
		);
		assert(
			JSON.stringify(restarted.parallelRun?.goalIndexes) ===
				JSON.stringify([1, 2]),
			"empty recovery did not start next parallel batch",
		);
		assertRecoveryNotice(state, ["已收口 无", "已重置 第 2 步", "第 3 步"]);
		writeFileSync(join(cwd, "release-workers"), "");
		await run;
		await flushScheduledGoalStart();
		const flow = readFlow(dir);
		assert(
			flow.parallelRun === null,
			"empty recovery final fan-in kept parallelRun",
		);
		assert(
			flow.goals[1].status === "complete",
			"empty recovery rerun missed G2",
		);
		assert(
			flow.goals[2].status === "complete",
			"empty recovery rerun missed G3",
		);
		assert(
			flow.goals[3].status === "running",
			"empty recovery did not start final step",
		);
	} finally {
		delete process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE;
		writeFileSync(join(cwd, "release-workers"), "");
		if (run) await run.catch(() => undefined);
		restorePi();
	}
}

async function flowParallelStopGoScenario() {
	const cwd = tempDir("parallel-stop-go");
	const dir = createParallelFlow(cwd, "F1");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_HANG = "1";
	let run;
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		run = commands.get("flow").handler("go F1", ctx);
		await Promise.all([
			waitForFile(join(cwd, "worker-1.started")),
			waitForFile(join(cwd, "worker-2.started")),
		]);
		await commands.get("flow").handler("stop F1", ctx);
		await run;
		let flow = readFlow(dir);
		assert(flow.status === "paused", "parallel stop did not pause Flow");
		assert(flow.parallelRun === null, "parallel stop kept parallelRun");
		assert(
			flow.goals[0].status === "complete",
			"parallel stop lost previous completion",
		);
		assert(
			flow.goals[1].status === "pending",
			"parallel stop did not reset G2",
		);
		assert(
			flow.goals[2].status === "pending",
			"parallel stop did not reset G3",
		);
		assert(
			existsSync(join(cwd, "worker-1.killed")) &&
				existsSync(join(cwd, "worker-2.killed")),
			"parallel stop did not abort workers",
		);

		delete process.env.PI_FLOW_FAKE_HANG;
		await commands.get("flow").handler("go F1", ctx);
		await flushScheduledGoalStart();
		flow = readFlow(dir);
		assert(
			flow.parallelRun === null,
			"parallel go after stop kept parallelRun",
		);
		assert(
			flow.goals[1].status === "complete",
			"parallel go after stop missed G2",
		);
		assert(
			flow.goals[2].status === "complete",
			"parallel go after stop missed G3",
		);
		assert(
			flow.goals[3].status === "running",
			"parallel go after stop did not schedule next step",
		);
	} finally {
		delete process.env.PI_FLOW_FAKE_HANG;
		if (run) await run.catch(() => undefined);
		restorePi();
	}
}

async function flowParallelStopAllResultsCompleteScenario() {
	const cwd = tempDir("parallel-stop-all-results-complete");
	const dir = createParallelFlow(cwd, "F1");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.parallelRun = {
		id: "P-stop-complete",
		goalIndexes: [1, 2],
		startedAt: Date.now(),
	};
	for (const goalIndex of [1, 2]) {
		flow.goals[goalIndex].status = "running";
		flow.goals[goalIndex].sessionFile = join(
			dir,
			"workers",
			`G${goalIndex}`,
			"session.jsonl",
		);
	}
	flow.goals[3].status = "complete";
	writeFlow(dir, flow);
	writeWorkerResult(dir, 1, "P-stop-complete", "done 1");
	writeWorkerResult(dir, 2, "P-stop-complete", "done 2");

	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("stop F1", ctx);
	const stopped = readFlow(dir);
	assert(
		stopped.status === "complete",
		"parallel stop with all results did not complete Flow",
	);
	assert(
		stopped.parallelRun === null,
		"complete parallel stop kept parallelRun",
	);
	assert(
		stopped.goals.every((goal) => goal.status === "complete"),
		"complete parallel stop left incomplete goals",
	);
	await commands.get("flow").handler("go F1", ctx);
	assert(state.newSessions.length === 0, "go after complete stop started work");
	assert(
		(state.notifications.at(-1) ?? "").includes("已完成"),
		`go after complete stop did not report completion: ${state.notifications.at(-1)}`,
	);
}

async function flowLockStaleScenario() {
	const { acquireFlowLock } = await importModule("flow/lock.js");
	const cwd = tempDir("flow-lock-stale");
	const dir = createFlow(cwd, "F1");
	const first = acquireFlowLock(dir, "first");
	assert(first.ok, "first lock was not acquired");
	const busy = acquireFlowLock(dir, "second");
	assert(!busy.ok, "live lock was not reported busy");
	assert(busy.owner?.action === "first", "busy lock owner was not reported");
	first.release();

	writeFileSync(
		join(dir, ".flow.lock"),
		`${JSON.stringify({ action: "stale", pid: missingPid(), startedAt: 1 })}\n`,
	);
	const recovered = acquireFlowLock(dir, "recovered");
	assert(recovered.ok, "stale lock was not recovered");
	recovered.release();
	assert(!existsSync(join(dir, ".flow.lock")), "released lock file remained");
}

async function flowConcurrentGoLockScenario() {
	const cwd = tempDir("flow-concurrent-go");
	const dir = createFlow(cwd, "F1", { planCount: 3 });
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.goals[0].status = "complete";
	writeFlow(dir, flow);
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	const originalNewSession = ctx.newSession.bind(ctx);
	let releaseFirst;
	const firstEntered = new Promise((resolve) => {
		ctx.newSession = async (options) => {
			if (!releaseFirst) {
				resolve();
				await new Promise((release) => {
					releaseFirst = release;
				});
			}
			return originalNewSession(options);
		};
	});

	const first = commands.get("flow").handler("go", ctx);
	await firstEntered;
	await commands.get("flow").handler("status F1", ctx);
	assert(
		!state.notifications.at(-1).includes("Flow 正在处理"),
		"status was blocked by the scheduling lock",
	);
	await commands.get("flow").handler("go", ctx);
	assert(
		state.notifications.some((item) => item.includes("Flow 正在处理")),
		"concurrent go did not report the active lock",
	);
	releaseFirst();
	await first;
	await flushScheduledGoalStart();

	const saved = readFlow(dir);
	assert(state.newSessions.length === 1, "concurrent go opened two sessions");
	assert(saved.goals[1].status === "running", "next step did not start");
	assert(saved.goals[2].status === "pending", "final step started too early");
}

async function parallelFanInLockScenario() {
	const { withFlowLock } = await importModule("flow/lock.js");
	const { settleParallelRun } = await importModule("flow/parallel/fan-in.js");
	const cwd = tempDir("parallel-fan-in-lock");
	const dir = await createCrashedParallelFlow(cwd, "F1");
	writeWorkerResult(dir, 1, "P-crashed", "done 1");
	writeWorkerResult(dir, 2, "P-crashed", "done 2");
	let first;
	let releaseFirst;
	const firstEntered = new Promise((resolve) => {
		releaseFirst = async () => undefined;
		first = withFlowLock(dir, "fan-in first", async () => {
			resolve();
			await new Promise((release) => {
				releaseFirst = release;
			});
			return settleParallelRun(dir, readFlow(dir), [], {
				requireSuccessfulExit: false,
				recovery: true,
			});
		});
	});
	await firstEntered;
	let secondRan = false;
	const second = await withFlowLock(dir, "fan-in second", () => {
		secondRan = true;
		return settleParallelRun(dir, readFlow(dir), [], {
			requireSuccessfulExit: false,
			recovery: true,
		});
	});
	assert(!second.ok, "second fan-in acquired lock while first was active");
	assert(!secondRan, "second fan-in wrote while first was active");
	releaseFirst();
	const result = await first;
	assert(result.ok, "first fan-in lost its lock");
	const flow = readFlow(dir);
	assert(flow.parallelRun === null, "fan-in lock kept parallelRun");
	assert(flow.goals[1].status === "complete", "fan-in lock missed G2");
	assert(flow.goals[2].status === "complete", "fan-in lock missed G3");
}

async function flowConcurrentRecoveryFanInLockScenario() {
	const { acquireFlowLock } = await importModule("flow/lock.js");
	const cwd = tempDir("flow-concurrent-recovery-fan-in");
	const dir = await createCrashedParallelFlow(cwd, "F1");
	writeWorkerResult(dir, 1, "P-crashed", "done 1");
	writeWorkerResult(dir, 2, "P-crashed", "done 2");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	const lock = acquireFlowLock(dir, "recover parallel F1");
	assert(lock.ok, "recovery fan-in lock was not acquired");
	try {
		await commands.get("flow").handler("go", ctx);
		let flow = readFlow(dir);
		assert(flow.parallelRun?.id === "P-crashed", "busy recovery changed flow");
		assert(state.newSessions.length === 0, "busy recovery started next step");
		assert(
			state.notifications.some((item) => item.includes("Flow 正在处理")),
			"busy recovery did not notify user",
		);
		lock.release();
		await commands.get("flow").handler("go", ctx);
		await flushScheduledGoalStart();
		flow = readFlow(dir);
		assert(flow.parallelRun === null, "recovery fan-in kept parallelRun");
		assert(flow.goals[1].status === "complete", "recovery missed G2");
		assert(flow.goals[2].status === "complete", "recovery missed G3");
		assert(flow.goals[3].status === "running", "recovery missed next step");
		assert(
			state.newSessions.length === 1,
			"recovery started duplicate sessions",
		);
	} finally {
		if (lock.ok) lock.release();
	}
}

function assertRecoveryNotice(state, parts) {
	const notice = state.notifications.find((item) =>
		item.includes("Flow 并行恢复"),
	);
	assertNoticeFormat(notice, "🔁", parts[0]);
	for (const part of parts)
		assert(notice.includes(part), `recovery notice missing ${part}: ${notice}`);
}

async function schemaScenario() {
	const { validateFlowDir } = await importModule("flow/validator.js");
	const { createPreDraftFlow, listFlowIds } =
		await importModule("flow/store.js");
	const preDraftCwd = tempDir("schema-predraft");
	const preDraft = createPreDraftFlow(preDraftCwd, {
		language: "zh",
		status: "generating",
		source: { type: "prompt", path: null, originalRequest: "draft" },
	});
	assert(preDraft.id === "F1", "pre-draft did not allocate bare F1 id");
	assert(
		preDraft.dir === join(preDraftCwd, ".flow", "F1"),
		"pre-draft dir was not bare F<N>",
	);
	assert(
		preDraft.flow.status === "generating" &&
			preDraft.flow.goals.length === 0 &&
			preDraft.flow.currentGoal === 0 &&
			preDraft.flow.startedAt === null,
		"pre-draft minimal flow shape was wrong",
	);
	assert(
		validateFlowDir(preDraft.dir).ok,
		`pre-draft validation failed: ${validateFlowDir(preDraft.dir).errors.join(" | ")}`,
	);
	const pausedPreDraft = readFlow(preDraft.dir);
	pausedPreDraft.status = "paused";
	writeFlow(preDraft.dir, pausedPreDraft);
	assert(
		validateFlowDir(preDraft.dir).ok,
		"paused pre-draft with empty goals should be valid",
	);
	const cancelledPreDraft = readFlow(preDraft.dir);
	cancelledPreDraft.status = "cancelled";
	writeFlow(preDraft.dir, cancelledPreDraft);
	const cancelledValidation = validateFlowDir(preDraft.dir);
	assert(!cancelledValidation.ok, "old cancelled pre-draft should be invalid");
	assert(
		cancelledValidation.errors.includes("Flow 状态不受支持") &&
			!cancelledValidation.errors.join("\n").includes("cancelled"),
		"old cancelled status leaked its internal enum",
	);
	mkdirSync(join(preDraftCwd, ".flow", "F2-old"));
	const secondPreDraft = createPreDraftFlow(preDraftCwd, {
		language: "zh",
		status: "aligning",
		source: { type: "prompt", path: null, originalRequest: "align" },
	});
	assert(secondPreDraft.id === "F2", "old slug dir affected allocation");
	assert(
		JSON.stringify(listFlowIds(preDraftCwd)) === JSON.stringify(["F1", "F2"]),
		"old slug dir was listed as a valid Flow",
	);
	const cwd = tempDir("schema");
	const dir = join(cwd, ".flow", "F1");
	assert(!validateFlowDir(dir).ok, "missing flow.json passed");
	createFlow(cwd, "F1", { planCount: 3 });
	{
		const validation = validateFlowDir(dir);
		assert(
			validation.ok,
			`valid flow failed: ${validation.errors.join(" | ")}`,
		);
	}
	for (const invalidStatus of ["aligning", "generating"]) {
		const postDraftFlow = readFlow(dir);
		postDraftFlow.status = invalidStatus;
		writeFlow(dir, postDraftFlow);
		assert(
			validateFlowDir(dir).errors.includes("pre-draft Flow goals 必须为 []"),
			`${invalidStatus} Flow with goals was accepted`,
		);
		createFlow(cwd, "F1", { planCount: 3 });
	}
	const pausedDraft = readFlow(dir);
	pausedDraft.status = "paused";
	writeFlow(dir, pausedDraft);
	assert(
		validateFlowDir(dir).ok,
		`paused unstarted flow rejected: ${validateFlowDir(dir).errors.join(" | ")}`,
	);
	const pausedRunning = readFlow(dir);
	pausedRunning.startedAt = Date.now();
	pausedRunning.goals[0].status = "running";
	writeFlow(dir, pausedRunning);
	assert(
		validateFlowDir(dir).ok,
		`paused executed flow rejected: ${validateFlowDir(dir).errors.join(" | ")}`,
	);
	pausedRunning.pausedFrom = "running";
	writeFlow(dir, pausedRunning);
	assert(
		validateFlowDir(dir).errors.includes("pausedFrom 不是合法 Flow 字段"),
		"pausedFrom lifecycle field was not rejected",
	);
	delete pausedRunning.pausedFrom;
	pausedRunning.parallelRun = parallelRun([0]);
	writeFlow(dir, pausedRunning);
	assert(
		validateFlowDir(dir).errors.includes("paused Flow parallelRun 必须为 null"),
		"paused parallelRun was not rejected",
	);
	createFlow(cwd, "F1", { planCount: 3 });
	const flowWithParallelFields = readFlow(dir);
	flowWithParallelFields.parallelRun = parallelRun([0, 1]);
	flowWithParallelFields.goals[1].dependsOn = [0];
	flowWithParallelFields.goals[0].writeScope = ["src/api/**"];
	writeFlow(dir, flowWithParallelFields);
	assert(
		validateFlowDir(dir).ok,
		`parallel flow fields rejected: ${validateFlowDir(dir).errors.join(" | ")}`,
	);
	flowWithParallelFields.parallelRun = parallelRun([99]);
	writeFlow(dir, flowWithParallelFields);
	assert(
		validateFlowDir(dir).errors.some((error) =>
			error.includes("parallelRun.goalIndexes[0] 必须指向 goals 下标"),
		),
		"bad parallelRun goal index not rejected",
	);
	flowWithParallelFields.parallelRun = parallelRun([0, 1]);
	flowWithParallelFields.goals[1].dependsOn = "G1";
	writeFlow(dir, flowWithParallelFields);
	assert(
		validateFlowDir(dir).errors.some((error) =>
			error.includes("goals[1].dependsOn 必须是数组"),
		),
		"bad dependsOn not rejected",
	);
	createFlow(cwd, "F1");
	const missingStartedAt = readFlow(dir);
	delete missingStartedAt.startedAt;
	writeFileSync(join(dir, "flow.json"), JSON.stringify(missingStartedAt));
	assert(
		validateFlowDir(dir).errors.includes("startedAt 计划必须为 null"),
		"missing startedAt not rejected",
	);
	createFlow(cwd, "F1");
	const runningWithoutStartedAt = readFlow(dir);
	runningWithoutStartedAt.status = "running";
	writeFlow(dir, runningWithoutStartedAt);
	assert(
		validateFlowDir(dir).errors.includes("startedAt 运行态必须是时间戳"),
		"running flow without startedAt not rejected",
	);
	createFlow(cwd, "F1");
	const flowWithErrorReview = readFlow(dir);
	flowWithErrorReview.goals[0].checks = {
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result: "error", summary: "review crashed" }],
			active: null,
		},
		quality: { enabled: false, rounds: [], active: null },
	};
	writeFlow(dir, flowWithErrorReview);
	assert(
		validateFlowDir(dir).ok,
		`flow review error round rejected: ${validateFlowDir(dir).errors.join(" | ")}`,
	);
	const flow = readFlow(dir);
	writeFileSync(
		join(dir, "flow.json"),
		JSON.stringify({ ...flow, schemaVersion: 1 }),
	);
	assert(
		validateFlowDir(dir).errors.includes("schemaVersion 必须为 9"),
		"bad schemaVersion not rejected",
	);
	const typedFlow = readFlow(dir);
	typedFlow.goals[0].sessionFile = 42;
	writeFlow(dir, typedFlow);
	assert(
		validateFlowDir(dir).errors.some((error) =>
			error.includes("sessionFile 必须是字符串或 null"),
		),
		"bad optional plan field not rejected",
	);
	const pathDir = createFlow(cwd, "F2");
	const pathFlow = readFlow(pathDir);
	pathFlow.goals[0].file = "../../README.md";
	writeFlow(pathDir, pathFlow);
	assert(
		validateFlowDir(pathDir).errors.some((error) =>
			error.includes("文件路径不能逃出 flow 目录"),
		),
		"path traversal plan file not rejected",
	);
	pathFlow.goals[0].file = ".";
	writeFlow(pathDir, pathFlow);
	assert(
		validateFlowDir(pathDir).errors.some((error) =>
			error.includes("文件必须是普通文件"),
		),
		"dot Goal path threw or was not rejected",
	);
	pathFlow.goals[0].file = "subdir/..";
	writeFlow(pathDir, pathFlow);
	assert(
		validateFlowDir(pathDir).errors.some((error) =>
			error.includes("文件必须是普通文件"),
		),
		"subdir/.. Goal path threw or was not rejected",
	);
	mkdirSync(join(pathDir, "link-parent"));
	const outsideDir = tempDir("schema-outside");
	writeFileSync(join(outsideDir, "outside.md"), planMarkdown(1, false));
	symlinkSync(outsideDir, join(pathDir, "link-parent", "escape"));
	pathFlow.goals[0].file = "link-parent/escape/outside.md";
	writeFlow(pathDir, pathFlow);
	assert(
		validateFlowDir(pathDir).errors.some((error) =>
			error.includes("文件路径不能逃出 flow 目录"),
		),
		"parent symlink escape Goal path not rejected",
	);
	const maxDir = createFlow(cwd, "F3", { planCount: 11 });
	assert(validateFlowDir(maxDir).ok, "11 goals should pass");
	createFlow(cwd, "F4", { planCount: 12 });
	assert(
		validateFlowDir(join(cwd, ".flow", "F4")).errors.some((error) =>
			error.includes("超过 10"),
		),
		">10 execution goals not rejected",
	);
	const duplicateDir = createFlow(cwd, "F5", { planCount: 4 });
	const duplicateFlow = readFlow(duplicateDir);
	duplicateFlow.goals[2].role = "final_acceptance";
	writeFlow(duplicateDir, duplicateFlow);
	const duplicateErrors = validateFlowDir(duplicateDir).errors;
	assert(
		duplicateErrors.includes(
			"多步 Flow 必须有 1 个最终验收步骤（role: final_acceptance）",
		),
		"duplicate final acceptance not rejected",
	);
	assert(
		duplicateErrors.includes("goals[2] 非最终步骤必须是 normal"),
		"non-last final acceptance not rejected",
	);
}

async function badJsonScenario() {
	const cwd = tempDir("bad-json");
	const dir = createFlow(cwd, "F1");
	writeFileSync(join(dir, "flow.json"), "{ bad json");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("status F1", ctx);
	assertNoticeFormat(state.notifications.at(-1), "❌", "Expected property");
	await commands.get("flow").handler("go F1", ctx);
	assertNoticeFormat(state.notifications.at(-1), "❌", "Expected property");
	for (const command of ["status", "go"]) {
		await commands.get("flow").handler(command, ctx);
		assertNoticeFormat(state.notifications.at(-1), "❌", "Expected property");
	}
}

async function flowIdSafetyScenario() {
	const cwd = tempDir("flow-id-safety");
	mkdirSync(join(cwd, ".flow"), { recursive: true });
	const outside = tempDir("flow-id-outside");
	const outsideFlow = createFlow(outside, "F1");
	symlinkSync(outsideFlow, join(cwd, ".flow", "F1"));
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	for (const command of [
		"status ../escape",
		"go ../escape",
		`status ${outsideFlow}`,
	]) {
		await commands.get("flow").handler(command, ctx);
		assert(
			state.notifications.at(-1).includes("flow id 非法"),
			`unsafe flow id not rejected for ${command}`,
		);
	}
	await commands.get("flow").handler("status F1", ctx);
	assert(
		state.notifications.at(-1).includes("普通目录"),
		"symlink flow directory not rejected",
	);
	await commands.get("flow").handler("status", ctx);
	assertNoticeFormat(state.notifications.at(-1), "⚠️", "请指定 Flow id");
}

async function flowBareIdMessageScenario() {
	const missingCwd = tempDir("flow-short-id-missing");
	createFlow(missingCwd, "F2");
	const missingState = newState(missingCwd);
	const { commands: missingCommands } = await loadExtension(missingState);
	const missingCtx = commandContext(
		missingState,
		missingCwd,
		join(missingCwd, "planning.jsonl"),
	);
	for (const command of ["status F1", "go F1"]) {
		await missingCommands.get("flow").handler(command, missingCtx);
		const notice = missingState.notifications.at(-1) ?? "";
		assert(
			notice.includes("未找到 Flow") && notice.includes("编号：F1"),
			`missing id did not name requested id for ${command}`,
		);
	}

	const oldIdCwd = tempDir("flow-old-id-rejected");
	createFlow(oldIdCwd, "F1");
	const oldIdState = newState(oldIdCwd);
	const { commands: oldIdCommands } = await loadExtension(oldIdState);
	const oldIdCtx = commandContext(
		oldIdState,
		oldIdCwd,
		join(oldIdCwd, "planning.jsonl"),
	);
	for (const command of ["status F1-old", "go F1-old"]) {
		await oldIdCommands.get("flow").handler(command, oldIdCtx);
		assert(
			oldIdState.notifications.at(-1).includes("flow id 非法"),
			`old slug id was accepted for ${command}`,
		);
	}
}

async function flowTargetRoutingScenario() {
	const explicitCwd = tempDir("flow-target-explicit");
	createFlow(explicitCwd, "F1");
	createFlow(explicitCwd, "F2");
	const explicitState = newState(explicitCwd);
	const { commands: explicitCommands } = await loadExtension(explicitState);
	const explicitCtx = commandContext(
		explicitState,
		explicitCwd,
		join(explicitCwd, "planning.jsonl"),
	);
	await explicitCommands.get("flow").handler("status F2", explicitCtx);
	assert(
		explicitState.notifications.at(-1).includes("Flow: F2") &&
			!explicitState.notifications.at(-1).includes("Flow: F1"),
		"explicit id status selected the wrong Flow",
	);
	await explicitCommands.get("flow").handler("status F2", explicitCtx);
	assert(
		explicitState.notifications.at(-1).includes("Flow: F2"),
		"bare id status did not resolve to the unique Flow",
	);

	const uniqueCwd = tempDir("flow-target-unique-running");
	markFlowRunning(createFlow(uniqueCwd, "F1"));
	const uniqueState = newState(uniqueCwd);
	const { commands: uniqueCommands } = await loadExtension(uniqueState);
	await uniqueCommands
		.get("flow")
		.handler(
			"status",
			commandContext(uniqueState, uniqueCwd, join(uniqueCwd, "planning.jsonl")),
		);
	assert(
		uniqueState.notifications.at(-1).includes("Flow: F1"),
		"bare status did not select the only running Flow",
	);

	const draftCwd = tempDir("flow-target-unique-draft");
	createFlow(draftCwd, "F1");
	const draftState = newState(draftCwd);
	const { commands: draftCommands } = await loadExtension(draftState);
	await draftCommands
		.get("flow")
		.handler(
			"status",
			commandContext(draftState, draftCwd, join(draftCwd, "planning.jsonl")),
		);
	assert(
		draftState.notifications.at(-1).includes("Flow: F1"),
		"bare status did not select the only draft Flow",
	);

	const pausedCwd = tempDir("flow-target-unique-paused");
	const pausedDir = createFlow(pausedCwd, "F1");
	writeFlow(pausedDir, { ...readFlow(pausedDir), status: "paused" });
	const pausedState = newState(pausedCwd);
	const { commands: pausedCommands } = await loadExtension(pausedState);
	await pausedCommands
		.get("flow")
		.handler(
			"status",
			commandContext(pausedState, pausedCwd, join(pausedCwd, "planning.jsonl")),
		);
	assert(
		pausedState.notifications.at(-1).includes("状态: 已暂停"),
		"bare status did not select the only paused Flow",
	);

	for (const invalidStatus of ["aligning", "generating"]) {
		const invalidCwd = tempDir(`flow-target-invalid-${invalidStatus}`);
		const invalidDir = createFlow(invalidCwd, "F1");
		writeFlow(invalidDir, { ...readFlow(invalidDir), status: invalidStatus });
		const invalidState = newState(invalidCwd);
		const { commands: invalidCommands } = await loadExtension(invalidState);
		await invalidCommands
			.get("flow")
			.handler(
				"status",
				commandContext(
					invalidState,
					invalidCwd,
					join(invalidCwd, "planning.jsonl"),
				),
			);
		assertNoticeFormat(
			invalidState.notifications.at(-1),
			"⚠️",
			"请指定 Flow id",
		);
	}

	const ownerCwd = tempDir("flow-target-owner");
	markFlowRunning(createFlow(ownerCwd, "F1"));
	const ownerSession = join(ownerCwd, "owned-session.jsonl");
	markFlowRunning(createFlow(ownerCwd, "F2"), ownerSession);
	const ownerState = newState(ownerCwd);
	const { commands: ownerCommands } = await loadExtension(ownerState);
	await ownerCommands
		.get("flow")
		.handler("status", commandContext(ownerState, ownerCwd, ownerSession));
	assert(
		ownerState.notifications.at(-1).includes("Flow: F2") &&
			!ownerState.notifications.at(-1).includes("多个可推进的 Flow"),
		"bare status in an owned session did not select its Flow",
	);

	const parallelOwnerCwd = tempDir("flow-target-parallel-owner");
	const parallelOwnerDir = await createCrashedParallelFlow(
		parallelOwnerCwd,
		"F1",
	);
	createFlow(parallelOwnerCwd, "F2");
	const parallelOwnerState = newState(parallelOwnerCwd);
	const { commands: parallelOwnerCommands } =
		await loadExtension(parallelOwnerState);
	await parallelOwnerCommands
		.get("flow")
		.handler(
			"status",
			commandContext(
				parallelOwnerState,
				parallelOwnerCwd,
				join(parallelOwnerDir, "workers", "G2", "session.jsonl"),
			),
		);
	assert(
		parallelOwnerState.notifications.at(-1).includes("Flow: F1") &&
			!parallelOwnerState.notifications.at(-1).includes("多个可推进的 Flow"),
		"bare status in a non-current parallel worker session did not select its Flow",
	);

	const ambiguousCwd = tempDir("flow-target-ambiguous-running");
	markFlowRunning(createFlow(ambiguousCwd, "F1"));
	markFlowRunning(createFlow(ambiguousCwd, "F2"));
	const ambiguousState = newState(ambiguousCwd);
	const { commands: ambiguousCommands } = await loadExtension(ambiguousState);
	await ambiguousCommands
		.get("flow")
		.handler(
			"status",
			commandContext(
				ambiguousState,
				ambiguousCwd,
				join(ambiguousCwd, "planning.jsonl"),
			),
		);
	const ambiguousNotice = ambiguousState.notifications.at(-1);
	assert(
		ambiguousNotice.includes("多个可推进的 Flow") &&
			ambiguousNotice.includes("F1 · /flow status F1") &&
			ambiguousNotice.includes("F2 · /flow status F2"),
		`ambiguous advanceable Flows did not list copyable commands: ${ambiguousNotice}`,
	);
}

async function flowResumeTargetHintUsesGoScenario() {
	const cwd = tempDir("flow-resume-target-hint");
	for (const id of ["F1", "F2"]) {
		const dir = createFlow(cwd, id);
		writeFlow(dir, { ...readFlow(dir), status: "paused" });
	}
	const state = newState(cwd);
	await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	const { resumeFlow } = await importModule("flow/execution/resume.js");
	await resumeFlow({}, ctx);
	const notice = state.notifications.at(-1) ?? "";
	assert(
		notice.includes("多个可推进的 Flow") &&
			notice.includes("F1 · /flow go F1") &&
			notice.includes("F2 · /flow go F2") &&
			!notice.includes("/flow continue"),
		`resume target hint should use go commands: ${notice}`,
	);
}

async function flowCurrentGoalOwnerRoutingScenario() {
	const statusCwd = tempDir("flow-current-goal-owner-status");
	const statusSessionA = join(statusCwd, "session-a.jsonl");
	const statusSessionB = join(statusCwd, "session-b.jsonl");
	createHandoffRunningFlow(statusCwd, "F1", statusSessionA, statusSessionB);
	markFlowRunning(createFlow(statusCwd, "F2"), statusSessionA);
	const statusState = newState(statusCwd);
	const { commands: statusCommands } = await loadExtension(statusState);
	await statusCommands
		.get("flow")
		.handler("status", commandContext(statusState, statusCwd, statusSessionA));
	assert(
		statusState.notifications.at(-1).includes("Flow: F2") &&
			!statusState.notifications.at(-1).includes("多个可推进的 Flow"),
		"bare status used historical completed step session as running owner",
	);

	const continueCwd = tempDir("flow-current-goal-owner-continue");
	const continueSessionA = join(continueCwd, "session-a.jsonl");
	const continueSessionB = join(continueCwd, "session-b.jsonl");
	createHandoffRunningFlow(
		continueCwd,
		"F1",
		continueSessionA,
		continueSessionB,
	);
	markFlowRunning(createFlow(continueCwd, "F2"), continueSessionA);
	const continueState = newState(continueCwd);
	const { commands: continueCommands } = await loadExtension(continueState);
	await continueCommands
		.get("flow")
		.handler(
			"go",
			commandContext(continueState, continueCwd, continueSessionA),
		);
	assert(
		continueState.switches.length === 0 &&
			!continueState.notifications.at(-1).includes("多个可推进的 Flow"),
		"bare go did not route to the current session's running step",
	);
}

async function flowPreDraftTargetRoutingScenario() {
	const uniqueCwd = tempDir("flow-predraft-target-unique");
	writePreDraftFlow(uniqueCwd, "F1", {
		status: "generating",
		stage: "generating",
		sessionFile: join(uniqueCwd, "old-session.jsonl"),
		originalRequest: "unique pre-draft",
	});
	const uniqueState = newState(uniqueCwd);
	const { commands: uniqueCommands } = await loadExtension(uniqueState);
	await uniqueCommands
		.get("flow")
		.handler(
			"status",
			commandContext(uniqueState, uniqueCwd, join(uniqueCwd, "planning.jsonl")),
		);
	assert(
		uniqueState.notifications.at(-1).includes("Flow: F1") &&
			uniqueState.notifications.at(-1).includes("正在撰写计划"),
		"bare status did not select the only active pre-draft Flow",
	);

	const ownerCwd = tempDir("flow-predraft-target-owner");
	markFlowRunning(createFlow(ownerCwd, "F1"));
	const ownerSession = join(ownerCwd, "owned-predraft.jsonl");
	writePreDraftFlow(ownerCwd, "F2", {
		status: "aligning",
		stage: "awaiting_alignment_input",
		sessionFile: ownerSession,
		lastAlignmentQuestion: "问题 1：范围？",
	});
	const ownerState = newState(ownerCwd);
	const { commands: ownerCommands } = await loadExtension(ownerState);
	await ownerCommands
		.get("flow")
		.handler("status", commandContext(ownerState, ownerCwd, ownerSession));
	assert(
		ownerState.notifications.at(-1).includes("Flow: F2") &&
			!ownerState.notifications.at(-1).includes("Flow: F1"),
		"session-owned pre-draft Flow did not take routing priority",
	);

	const pausedOwnerCwd = tempDir("flow-predraft-target-paused-owner");
	const pausedOwnerSession = join(pausedOwnerCwd, "paused-owner.jsonl");
	writePreDraftFlow(pausedOwnerCwd, "F1", {
		status: "paused",
		stage: "generating",
		sessionFile: pausedOwnerSession,
	});
	writePreDraftFlow(pausedOwnerCwd, "F2", {
		status: "paused",
		stage: "generating",
		sessionFile: join(pausedOwnerCwd, "other.jsonl"),
	});
	const pausedOwnerState = newState(pausedOwnerCwd);
	const { commands: pausedOwnerCommands } =
		await loadExtension(pausedOwnerState);
	const pausedOwnerCtx = commandContext(
		pausedOwnerState,
		pausedOwnerCwd,
		pausedOwnerSession,
	);
	await pausedOwnerCommands.get("flow").handler("status", pausedOwnerCtx);
	assert(
		pausedOwnerState.notifications.at(-1).includes("Flow: F1") &&
			!pausedOwnerState.notifications.at(-1).includes("多个可推进的 Flow"),
		"paused pre-draft Flow did not take session ownership priority",
	);
	const { flowOwnerForSession } = await importModule("flow/ownership.js");
	assert(
		flowOwnerForSession(pausedOwnerCtx)?.id === "F1",
		"paused pre-draft Flow was not reported as the session owner",
	);

	const ambiguousCwd = tempDir("flow-predraft-target-ambiguous");
	writePreDraftFlow(ambiguousCwd, "F1", {
		status: "generating",
		stage: "generating",
		sessionFile: join(ambiguousCwd, "a.jsonl"),
	});
	writePreDraftFlow(ambiguousCwd, "F2", {
		status: "aligning",
		stage: "awaiting_final_confirm",
		sessionFile: join(ambiguousCwd, "b.jsonl"),
	});
	markFlowRunning(createFlow(ambiguousCwd, "F3"));
	const ambiguousState = newState(ambiguousCwd);
	const { commands: ambiguousCommands } = await loadExtension(ambiguousState);
	const ambiguousCtx = commandContext(
		ambiguousState,
		ambiguousCwd,
		join(ambiguousCwd, "planning.jsonl"),
	);
	await ambiguousCommands.get("flow").handler("go", ambiguousCtx);
	const notice = ambiguousState.notifications.at(-1);
	assert(
		notice.includes("多个可推进的 Flow") &&
			notice.includes("F1 · /flow go F1") &&
			notice.includes("F2 · /flow go F2") &&
			notice.includes("F3 · /flow go F3"),
		`bare go did not require id for multiple advanceable Flows: ${notice}`,
	);
	await ambiguousCommands.get("flow").handler("go F2", ambiguousCtx);
	const selectedAlignment = JSON.parse(
		readFileSync(join(ambiguousCwd, ".flow", "F2", "alignment.json"), "utf8"),
	);
	assert(
		selectedAlignment.stage === "generating" &&
			latestWidgetText(ambiguousState).includes("🌊 Flow · 撰写计划中"),
		`explicit id go did not generate the selected pre-draft Flow: stage=${selectedAlignment.stage}; widget=${latestWidgetText(ambiguousState)}`,
	);
}

async function flowCommandRoutingSafetyScenario() {
	const { emitFlowGoalCompleted } =
		await importCachedModule("flow/completion.js");
	const { planSnapshotHash } = await importModule("plan/snapshot.js");

	const commandCwd = tempDir("flow-command-routing-safety");
	const commandF3 = createFlow(commandCwd, "F3");
	const commandF4 = createFlow(commandCwd, "F4");
	const commandF3Session = join(commandCwd, "f3.jsonl");
	const commandF4Session = join(commandCwd, "f4.jsonl");
	writeFileSync(commandF3Session, "");
	writeFileSync(commandF4Session, "");
	markFlowRunningWithSnapshot(commandF3, commandF3Session, planSnapshotHash);
	markFlowRunningWithSnapshot(commandF4, commandF4Session, planSnapshotHash);
	const commandState = newState(commandCwd);
	const { commands } = await loadExtension(commandState);
	const planningCtx = commandContext(
		commandState,
		commandCwd,
		join(commandCwd, "planning.jsonl"),
	);
	await commands.get("flow").handler("go", planningCtx);
	const continueNotice = commandState.notifications.at(-1) ?? "";
	assert(
		continueNotice.includes("多个可推进的 Flow") &&
			continueNotice.includes("F3 · /flow go F3") &&
			continueNotice.includes("F4 · /flow go F4"),
		`bare go did not require an explicit Flow id: ${continueNotice}`,
	);
	const completionCwd = tempDir("flow-completion-routing-safety");
	const completionF3 = createFlow(completionCwd, "F3", { planCount: 3 });
	const completionF4 = createFlow(completionCwd, "F4", { planCount: 3 });
	const completionF3Session = join(completionCwd, "f3.jsonl");
	const completionF4Session = join(completionCwd, "f4.jsonl");
	writeFileSync(completionF3Session, "");
	writeFileSync(completionF4Session, "");
	markFlowRunningWithSnapshot(
		completionF3,
		completionF3Session,
		planSnapshotHash,
	);
	markFlowRunningWithSnapshot(
		completionF4,
		completionF4Session,
		planSnapshotHash,
	);
	const completionState = newState(completionCwd);
	await loadExtension(completionState);
	const completionCtx = commandContext(
		completionState,
		completionCwd,
		join(completionCwd, "planning.jsonl"),
	);
	emitFlowGoalCompleted(
		completionEntry(completionF4Session).data,
		completionCtx,
	);
	await flushScheduledGoalStart();
	const savedF3 = readFlow(completionF3);
	const savedF4 = readFlow(completionF4);
	assert(
		savedF3.currentGoal === 0 && savedF3.goals[0].status === "running",
		"F4 completion fact was written into F3",
	);
	assert(
		savedF4.currentGoal === 1 && savedF4.goals[0].status === "complete",
		"F4 completion fact did not advance F4",
	);
	const savedF4AfterFirstFact = JSON.stringify(savedF4);
	emitFlowGoalCompleted(
		completionEntry(completionF3Session).data,
		completionCtx,
	);
	await flushScheduledGoalStart();
	const savedF3AfterOwnFact = readFlow(completionF3);
	assert(
		savedF3AfterOwnFact.currentGoal === 1 &&
			savedF3AfterOwnFact.goals[0].status === "complete",
		"F3 completion fact did not advance F3",
	);
	assert(
		JSON.stringify(readFlow(completionF4)) === savedF4AfterFirstFact,
		"F3 completion fact changed F4",
	);
}

async function flowControlCommandShapeScenario() {
	await assertFlowRequestStartsGeneration("go login", "go login");
	await assertFlowRequestStartsGeneration(
		"go fix login bug",
		"go fix login bug",
	);
	await assertFlowRequestStartsGeneration(
		"status dashboard bug",
		"status dashboard bug",
	);
	await assertFlowRequestStartsGeneration(
		"go https://example.com/login",
		"go https://example.com/login",
	);
	for (const command of ["start F1", "continue F1", "pause F1", "cancel F1"])
		await assertOldFlowCommandStartsGeneration(command);

	const goCwd = tempDir("flow-go-control-shape");
	const goDir = createFlow(goCwd, "F1");
	const goState = newState(goCwd);
	const { commands: goCommands } = await loadExtension(goState);
	await goCommands
		.get("flow")
		.handler(
			"go F1",
			commandContext(goState, goCwd, join(goCwd, "planning.jsonl")),
		);
	await flushScheduledGoalStart();
	assert(
		readFlow(goDir).status === "running" && goState.newSessions.length === 1,
		"/flow go F1 should keep control-command semantics",
	);

	const statusCwd = tempDir("flow-status-control-shape");
	createFlow(statusCwd, "F1");
	const statusState = newState(statusCwd);
	const { commands: statusCommands } = await loadExtension(statusState);
	await statusCommands
		.get("flow")
		.handler(
			"status F1",
			commandContext(statusState, statusCwd, join(statusCwd, "planning.jsonl")),
		);
	assert(
		(statusState.notifications.at(-1) ?? "").includes("Flow: F1") &&
			statusState.hiddenMessages.length === 0,
		"/flow status F1 should keep hidden status-command semantics",
	);
}

async function assertFlowRequestStartsGeneration(command, request) {
	const cwd = tempDir(
		`flow-command-request-${request.replace(/[^\p{L}\p{N}-]+/gu, "-")}`,
	);
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	await commands
		.get("flow")
		.handler(command, commandContext(state, cwd, join(cwd, "planning.jsonl")));
	assert(
		state.hiddenMessages.at(-1)?.includes(request) &&
			existsSync(join(cwd, ".flow", "F1", "alignment.json")),
		`/flow ${command} should start generation as a request`,
	);
}

async function assertOldFlowCommandStartsGeneration(command) {
	const cwd = tempDir(
		`flow-old-command-${command.replace(/[^\p{L}\p{N}-]+/gu, "-")}`,
	);
	const existingDir = createFlow(cwd, "F1");
	const before = JSON.stringify(readFlow(existingDir));
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	await commands
		.get("flow")
		.handler(command, commandContext(state, cwd, join(cwd, "planning.jsonl")));
	assert(
		JSON.stringify(readFlow(existingDir)) === before,
		`/flow ${command} changed an existing Flow`,
	);
	assert(
		state.hiddenMessages.at(-1)?.includes(command) &&
			existsSync(join(cwd, ".flow", "F2", "alignment.json")),
		`/flow ${command} should be treated as a new request, not a control command`,
	);
}

function markFlowRunning(dir, sessionFile = null) {
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	flow.goals[0].sessionFile = sessionFile;
	writeFlow(dir, flow);
}

function createHandoffRunningFlow(cwd, id, oldSessionFile, currentSessionFile) {
	const dir = createFlow(cwd, id, { planCount: 2 });
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.goals[0].status = "complete";
	flow.goals[0].sessionFile = oldSessionFile;
	flow.goals[1].status = "running";
	flow.goals[1].sessionFile = currentSessionFile;
	writeFlow(dir, flow);
	return dir;
}

function markFlowRunningWithSnapshot(dir, sessionFile, planSnapshotHash) {
	const flow = readFlow(dir);
	const goal = flow.goals[0];
	const snapshot = readFileSync(join(dir, goal.file), "utf8");
	flow.status = "running";
	flow.startedAt = Date.now();
	goal.status = "running";
	goal.sessionFile = sessionFile;
	goal.snapshot = snapshot;
	goal.snapshotHash = planSnapshotHash(snapshot);
	writeFlow(dir, flow);
}

async function flowIndependentStartWhileRunningScenario() {
	const cwd = tempDir("flow-independent-start");
	const runningDir = createFlow(cwd, "F3");
	const draftDir = createFlow(cwd, "F4");
	const runningSession = join(cwd, "f3-session.jsonl");
	writeFileSync(runningSession, "");
	markFlowRunning(runningDir, runningSession);
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const { writeFlowHtml } = await importCachedModule("flow/html.js");
	const { closeFlowGoalWatcher, watchCurrentFlowGoal } =
		await importCachedModule("flow/watcher.js");
	const runningFlow = readFlow(runningDir);
	writeFlowHtml(runningDir, runningFlow);
	watchCurrentFlowGoal(runningDir, runningFlow);
	await new Promise((resolve) => setImmediate(resolve));
	const runningBefore = JSON.stringify(readFlow(runningDir));

	await commands
		.get("flow")
		.handler("go F4", commandContext(state, cwd, join(cwd, "planning.jsonl")));
	await flushScheduledGoalStart();
	const started = readFlow(draftDir);
	const startedCtx = state.activeCtx;
	assert(
		startedCtx,
		"independent start did not create an active session context",
	);
	assert(
		started.status === "running" && started.goals[0].status === "running",
		"draft Flow did not start while another Flow was running",
	);
	assert(state.newSessions.length === 1, "independent start skipped session");
	assert(
		JSON.stringify(readFlow(runningDir)) === runningBefore,
		"starting F4 changed F3 state",
	);
	await commands
		.get("flow")
		.handler("go F4", commandContext(state, cwd, join(cwd, "planning.jsonl")));
	assert(state.newSessions.length === 1, "same Flow started twice");
	await emit(handlers, "session_shutdown", {}, startedCtx);

	const runningHtml = join(runningDir, "flow.html");
	const changed = onceFileChanged(runningHtml);
	const runningGoalFile = join(runningDir, runningFlow.goals[0].file);
	writeFileSync(
		runningGoalFile,
		readFileSync(runningGoalFile, "utf8").replace(
			"- [ ] Do work.",
			"- [x] F3 watcher survived F4 start.",
		),
	);
	await changed;
	assert(
		readFileSync(runningHtml, "utf8").includes("F3 watcher survived F4 start."),
		"starting F4 closed F3 watcher",
	);
	closeFlowGoalWatcher();
}

async function flowRootSymlinkScenario() {
	const cwd = tempDir("flow-root-symlink");
	const externalProject = tempDir("flow-root-external");
	createFlow(externalProject, "F1");
	symlinkSync(join(externalProject, ".flow"), join(cwd, ".flow"));
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	for (const command of ["status", "status F1", "go"]) {
		await commands.get("flow").handler(command, ctx);
		assert(
			state.notifications.at(-1).includes(".flow 不是普通目录"),
			`.flow symlink root not rejected for ${command}`,
		);
	}
	await commands.get("flow").handler("new draft", ctx);
	assert(
		state.notifications.at(-1).includes(".flow 不是普通目录"),
		"generation did not reject .flow symlink root",
	);
	assert(
		state.sentMessages.length === 0,
		"generation prompt sent for unsafe .flow root",
	);
}

async function statusValidationScenario() {
	const cwd = tempDir("status-validation");
	const dir = createFlow(cwd, "F1");
	const flow = readFlow(dir);
	flow.errors = [42];
	writeFlow(dir, flow);
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("status F1", ctx);
	assertNoticeFormat(
		state.notifications.at(-1),
		"❌",
		"errors 必须是字符串数组",
	);

	const oldStatusCwd = tempDir("status-validation-old-cancelled");
	const oldStatusDir = createFlow(oldStatusCwd, "F1");
	writeFlow(oldStatusDir, { ...readFlow(oldStatusDir), status: "cancelled" });
	const oldStatusState = newState(oldStatusCwd);
	const { commands: oldStatusCommands } = await loadExtension(oldStatusState);
	await oldStatusCommands
		.get("flow")
		.handler(
			"status F1",
			commandContext(
				oldStatusState,
				oldStatusCwd,
				join(oldStatusCwd, "planning.jsonl"),
			),
		);
	const oldStatusNotice = oldStatusState.notifications.at(-1);
	assertNoticeFormat(oldStatusNotice, "❌", "Flow 状态不受支持");
	assert(
		!oldStatusNotice.includes("cancelled"),
		`old cancelled Flow status leaked its internal enum: ${oldStatusNotice}`,
	);
}

async function statusRewritesNonParallelHtmlScenario() {
	const cwd = tempDir("status-rewrites-html");
	const dir = createFlow(cwd, "F1");
	const htmlPath = join(dir, "flow.html");
	writeFileSync(htmlPath, "stale flow html");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));

	await commands.get("flow").handler("status F1", ctx);
	const html = readFileSync(htmlPath, "utf8");
	assert(html.includes("Test Flow"), "nonparallel status did not render flow");
	assert(
		!html.includes("stale flow html"),
		"nonparallel status did not rewrite html",
	);
}

async function statusTextHidesSessionPathScenario() {
	const { statusText } = await importModule("flow/execution/status.js");
	const cwd = tempDir("status-session-path");
	const dir = createFlow(cwd, "F1", { planCount: 3 });
	const sessionFile = join(cwd, "goal-session.jsonl");
	const flow = readFlow(dir);
	flow.goals[0].sessionFile = sessionFile;
	flow.goals[0].sessionName = "实现登录";
	flow.goals[1].sessionFile = join(cwd, "second-session.jsonl");
	const text = statusText(flow);
	assert(text.includes("下一步: /flow go F1"), text);
	flow.status = "running";
	const runningText = statusText(flow);
	assert(runningText.includes("下一步: /flow go F1"), runningText);
	assert(text.includes("会话: 实现登录"), text);
	assert(text.includes("会话: 已启动"), text);
	assert(text.includes("会话: 尚未启动"), text);
	assert(!text.includes(sessionFile), text);
	assert(!text.includes("second-session.jsonl"), text);
}

async function malformedRepairScenario() {
	const startCwd = tempDir("malformed-start");
	const startDir = createFlow(startCwd, "F1");
	const malformedFlow = readFlow(startDir);
	delete malformedFlow.source;
	malformedFlow.goals = {};
	writeFlow(startDir, malformedFlow);
	const startState = newState(startCwd);
	const { commands: startCommands } = await loadExtension(startState);
	const startCtx = commandContext(
		startState,
		startCwd,
		join(startCwd, "planning.jsonl"),
	);
	await startCommands.get("flow").handler("go F1", startCtx);
	assert(
		startState.hiddenMessages.at(-1).includes("goals 必须是数组") &&
			startState.sentMessages.length === 0,
		"start repair prompt should be hidden with malformed validation error",
	);
	assert(
		readFileSync(join(startDir, "flow.html"), "utf8").includes(
			"goals 必须是数组",
		),
		"start malformed flow did not render error page",
	);

	const generateCwd = tempDir("malformed-generate");
	const generateState = newState(generateCwd);
	const { commands: generateCommands, handlers } =
		await loadExtension(generateState);
	const generateCtx = commandContext(
		generateState,
		generateCwd,
		join(generateCwd, "planning.jsonl"),
	);
	await generateCommands.get("flow").handler("make malformed", generateCtx);
	const generateDir = writeFlowSemanticDraft(generateCwd, "F1", {
		invalidMarkdown: true,
	});
	await emit(handlers, "agent_end", { messages: [] }, generateCtx);
	assert(
		generateState.hiddenMessages.at(-1).includes("缺少章节"),
		`generation repair prompt missing hidden semantic validation error: ${generateState.hiddenMessages.at(-1)}`,
	);
	assert(
		readFileSync(join(generateDir, "flow.html"), "utf8").includes("缺少章节"),
		"generation semantic validation error did not render error page",
	);
}

async function runningValidationScenario() {
	const cwd = tempDir("running-validation");
	const dir = createFlow(cwd, "F1");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals = {};
	writeFlow(dir, flow);
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", ctx);
	assert(
		state.hiddenMessages.at(-1).includes("goals 必须是数组"),
		"invalid running flow did not send repair prompt on go",
	);
	assertNoticeFormat(state.notifications.at(-1), "🛠️", "完成后会自动校验");
	entriesFor(state, ctx.sessionManager.getSessionFile()).push({
		type: "custom",
		customType: "pi-flow-goal-completed",
		data: {
			goalId: "goal",
			summary: "summary",
			acceptance: "acceptance",
			sessionFile: ctx.sessionManager.getSessionFile(),
			checks: emptyChecks(),
		},
	});
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assertNoticeFormat(state.notifications.at(-1), "❌", "goals 必须是数组");
}

async function htmlScenario() {
	const { writeFlowErrorHtml, writeFlowHtml } =
		await importModule("flow/html.js");
	const cwd = tempDir("html");
	const dir = createFlow(cwd, "F1", { planCount: 2 });
	const firstPlanPath = join(dir, "G1-plan.md");
	writeFileSync(
		firstPlanPath,
		readFileSync(firstPlanPath, "utf8").replace(
			"- [ ] Do work.",
			"- [~] **准备环境**：安装依赖并初始化数据库\n- [!] **等待凭证**：缺少外部 token，记录阻塞",
		),
	);
	const draftFlow = readFlow(dir);
	draftFlow.source = {
		...draftFlow.source,
		type: "file",
		path: join(cwd, "src", "app.ts"),
	};
	const draftHtml = readFileSync(writeFlowHtml(dir, draftFlow), "utf8");
	assert(
		!draftHtml.includes("Flow 计划"),
		"hero status label should be hidden",
	);
	assert(!draftHtml.includes("多步骤计划"), "draft label should be neutral");
	assert(
		draftHtml.includes("/flow go F1") && !draftHtml.includes("/flow status F1"),
		"draft command chips should only show go with bare id",
	);
	assert(
		draftHtml.includes("文件 · src/app.ts"),
		"source path should be project-relative",
	);
	assert(
		!draftHtml.includes("html/src/app.ts"),
		"source path should not include project directory prefix",
	);
	const singleDraftDir = createFlow(cwd, "F2");
	const singleDraftHtml = readFileSync(
		writeFlowHtml(singleDraftDir, readFlow(singleDraftDir)),
		"utf8",
	);
	assert(
		!singleDraftHtml.includes("Flow 计划") &&
			!singleDraftHtml.includes("多步骤计划"),
		"single-step draft flow should not show hero status label",
	);
	assert(draftHtml.includes("待执行"), "pending label not localized");
	assert(
		!draftHtml.includes("第 1 步 · Goal 1"),
		"goal card header should not repeat the step label as an eyebrow",
	);
	assert(draftHtml.includes(">范围</p>"), "flow goal scope label missing");
	assert(
		draftHtml.includes(">怎么算完成</p>"),
		"flow goal criteria label missing",
	);
	assert(!draftHtml.includes("- Done."), "raw bullet markdown leaked");
	assert(
		!draftHtml.includes("要做"),
		"flow repeated objective as work section",
	);
	assert(draftHtml.includes("尚未启动"), "session label not localized");
	assert(draftHtml.includes(">怎么验证</p>"), "verification section missing");
	assert(draftHtml.includes("原始需求与调试"), "debug details missing");
	assert(draftHtml.includes("0/2 步完成"), "progress caption missing");
	assert(!draftHtml.includes("mermaid"), "mermaid should be removed");
	assert(
		!draftHtml.includes("执行进度"),
		"flow stepper label should be hidden",
	);
	assert(
		draftHtml.includes("data:image/png;base64") &&
			draftHtml.includes(">Flow</span>"),
		"flow brand mark missing",
	);
	assert(draftHtml.includes("data-rough-node"), "flow stepper nodes missing");
	assert(draftHtml.includes("data-rough-ring"), "flow progress ring missing");
	assert(
		draftHtml.includes("[data-rough-card]{border-radius:18px") &&
			draftHtml.includes("[data-rough-seal]{border-radius:9999px") &&
			draftHtml.includes("roundedRectPath"),
		"rough card/seal rounded contract missing",
	);
	assert(
		draftHtml.includes("M140,128a12,12") && !draftHtml.includes("▸"),
		"details summary should use local dots icon, not CSS triangle",
	);
	assert(
		draftHtml.includes(">完成验收</p>") &&
			draftHtml.includes('data-tooltip="确保目标完整完成"'),
		"flow goal review phase missing",
	);
	assert(
		draftHtml.includes(">质量检查</p>") &&
			draftHtml.includes('data-tooltip="把关实现质量"'),
		"flow quality review phase missing",
	);
	assert(
		draftHtml.includes("M221.87,83.16") && draftHtml.includes("M208,40H48"),
		"check phase title icons missing",
	);
	assert(
		draftHtml.includes("等待") && !draftHtml.includes("等待执行"),
		"pending checks should show 等待, not 等待执行",
	);
	const mixedFlow = readFlow(dir);
	mixedFlow.goals[0].checks.quality.enabled = false;
	const mixedHtml = readFileSync(writeFlowHtml(dir, mixedFlow), "utf8");
	assert(
		mixedHtml.includes("等待") && mixedHtml.includes("未启用"),
		"mixed checks not reflected in pending checks",
	);
	const enabledHtml = draftHtml;
	assert(
		enabledHtml.includes("等待") && !enabledHtml.includes("未启用"),
		"enabled checks should all show 等待",
	);
	const parallelFlow = readFlow(dir);
	parallelFlow.status = "running";
	parallelFlow.startedAt = Date.now();
	parallelFlow.parallelRun = parallelRun([0, 1]);
	parallelFlow.goals[0].status = "running";
	parallelFlow.goals[1].status = "running";
	const parallelHtml = readFileSync(writeFlowHtml(dir, parallelFlow), "utf8");
	assert(
		count(parallelHtml, "当前</span>") === 2 &&
			!parallelHtml.includes(" · 当前"),
		"parallel batch did not mark every active goal current with status pills",
	);
	assert(
		parallelHtml.includes('data-tone="blue" class="mt-[18px] h-1'),
		"parallel batch stepper line did not show active tone",
	);
	const pausedFlow = readFlow(dir);
	pausedFlow.status = "paused";
	pausedFlow.startedAt = Date.now();
	pausedFlow.goals[0].status = "running";
	const pausedHtml = readFileSync(writeFlowHtml(dir, pausedFlow), "utf8");
	assert(
		pausedHtml.includes('data-rough-seal data-tone="amber"') &&
			pausedHtml.includes("已暂停"),
		"paused current goal did not render an amber status pill",
	);
	assert(
		draftHtml.includes('data-key="g0-step-0" open') &&
			draftHtml.includes("准备环境") &&
			draftHtml.includes("进行中") &&
			draftHtml.includes("阻塞") &&
			!draftHtml.includes("**"),
		"flow step list not aligned with goal rendering",
	);
	assert(draftHtml.includes("<details"), "verification should be collapsed");
	assert(!draftHtml.includes("pending"), "pending leaked into html");
	assert(
		!draftHtml.includes("未绑定 session"),
		"internal session label leaked",
	);
	const flow = readFlow(dir);
	const sessionFile = join(cwd, "goal-session.jsonl");
	flow.status = "complete";
	flow.errors = ["bad plan"];
	flow.goals[0].status = "complete";
	flow.goals[0].sessionFile = sessionFile;
	flow.goals[0].sessionName = "实现登录";
	flow.goals[0].result.handoff = "- 已交接\n- `pnpm test` 通过";
	flow.goals[0].checks = passedChecks();
	flow.goals[0].checks.acceptance.rounds = [
		{
			round: 1,
			result: "failed",
			summary: "旧失败摘要",
			details: "FAIL\n\n## 发现 1\n- 问题: 验收失败详情",
		},
		{ round: 2, result: "passed", summary: "新通过摘要" },
	];
	flow.goals[0].checks.quality.rounds = [
		{
			round: 1,
			result: "failed",
			summary: "旧质量失败",
			details: "FAIL\n\n## 发现 1\n- 问题: 质量失败详情",
		},
		{ round: 2, result: "passed", summary: "新质量通过" },
	];
	flow.goals[1].status = "complete";
	flow.goals[1].result.handoff = "final handoff";
	flow.goals[1].result.summary = "summary";
	flow.goals[1].checks = passedChecks();
	const htmlPath = writeFlowHtml(dir, flow);
	const html = readFileSync(htmlPath, "utf8");
	assert(html.includes("https://cdn.tailwindcss.com"), "Tailwind missing");
	assert(html.includes("roughjs@4"), "Rough.js missing");
	assert(!html.includes("mermaid"), "mermaid should be removed");
	assert(html.includes("new EventSource"), "live reload SSE missing");
	assert(html.includes("data-rough-card"), "rough card markers missing");
	assert(
		!html.includes('http-equiv="refresh"'),
		"meta refresh should be removed",
	);
	assert(count(html, "<article") === 2, "plan cards missing");
	assert(html.includes("全部完成"), "completion card missing");
	assert(html.includes("已通过"), "goal check status missing");
	assert(html.includes("校验错误"), "error card missing");
	assert(!html.includes("页面文件"), "flow html leaked page file label");
	assert(!html.includes(htmlPath), "flow html leaked absolute html path");
	assert(!html.includes(sessionFile), "flow html leaked session file path");
	assert(html.includes("第 1 轮未通过"), "first failed round label missing");
	assert(html.includes("旧失败摘要"), "acceptance failure history missing");
	assert(html.includes("新通过摘要"), "acceptance pass history missing");
	assert(html.includes("旧质量失败"), "quality failure history missing");
	assert(html.includes("新质量通过"), "quality pass history missing");
	assert(html.includes("第 2 轮通过"), "second round history missing");
	assert(html.includes("验收失败详情"), "acceptance details missing");
	assert(html.includes("质量失败详情"), "quality details missing");
	assert(html.includes("查看未通过原因"), "round details action unclear");
	assert(html.includes('data-key="g1-acceptance-round-1"'));
	assert(html.includes('data-key="g1-quality-round-1"'));
	assertUniqueDataKeys(html);
	assert(html.includes("实现登录"), "flow html missing session display name");
	assert(html.includes("全部 2 步已完成"), "complete subtitle missing");
	assert(!html.includes("Goal 0"), "flow html exposed 0-based Goal index");
	assert(html.includes("pnpm test"), "handoff markdown content missing");
	assert(!html.includes("- `pnpm test`"), "raw handoff markdown leaked");
	for (const label of [
		"next action",
		">Verification</p>",
		">Handoff</p>",
		"no session",
		"未绑定 session",
		">pending</span>",
		"final acceptance",
		"criteria deviation",
		"handoff generated",
		"Final Handoff",
		"Goal Summary / Review",
		"F1</p>",
		"Deviation 复核",
		">context</p>",
		">source</dt>",
		">updated</dt>",
	])
		assert(
			!html.includes(label),
			`flow html still has English UI label: ${label}`,
		);
	assert(!html.includes("application/json"), "html stores JSON state");
	const singleDir = createFlow(cwd, "F2");
	const singleFlow = readFlow(singleDir);
	singleFlow.status = "complete";
	singleFlow.goals[0].status = "complete";
	singleFlow.goals[0].checks = passedChecks();
	singleFlow.goals[0].result.criteriaChanged = true;
	const singleHtml = readFileSync(writeFlowHtml(singleDir, singleFlow), "utf8");
	assert(
		singleHtml.includes("验收口径有调整，已在本步骤检查中记录") &&
			singleHtml.includes("执行中有验收口径调整，已在步骤检查中记录"),
		"single-step criteria deviation did not use step-level wording",
	);
	assert(
		!singleHtml.includes("最终验收"),
		"single-step criteria deviation mentioned final acceptance",
	);
	singleFlow.language = "en";
	const singleEnglishHtml = readFileSync(
		writeFlowHtml(singleDir, singleFlow),
		"utf8",
	);
	assert(
		singleEnglishHtml.includes("recorded in this step's checks") &&
			!singleEnglishHtml.includes("final acceptance"),
		"English single-step criteria deviation mentioned final acceptance",
	);
	const errorHtml = readFileSync(
		writeFlowErrorHtml(dir, {
			title: "Broken Flow",
			errors: ["bad"],
			originalRequest: "原始请求",
		}),
		"utf8",
	);
	assert(errorHtml.includes("Flow 校验错误"), "error html title not Chinese");
	assert(errorHtml.includes("原始需求"), "error html source label not Chinese");
	assert(
		!errorHtml.includes("flow validation error") &&
			!errorHtml.includes("original request"),
		"error html still has English UI labels",
	);
}

async function generationAlignConfigScenario() {
	const { readGenerationConfig } = await importModule("shared/config.js");
	writeFlowTestConfig({ generation: { align: "yes" } });
	assert(
		readGenerationConfig().align === "yes",
		"generation.align yes not read",
	);
	writeFlowTestConfig({ generation: { align: "no" } });
	assert(readGenerationConfig().align === "no", "generation.align no not read");
	writeFlowTestConfig({ generation: { align: "bad" } });
	const invalid = readGenerationConfig();
	assert(
		invalid.align === "ask" && invalid.warning?.includes("generation.align"),
		"invalid generation.align did not warn and fall back",
	);
	writeFlowTestConfig();
}

async function flowModelSwitchFailurePersistsPreDraftScenario() {
	writeFlowTestConfig({
		modelRoles: {
			planner: { model: "missing/provider", thinking: "medium" },
		},
	});
	const cwd = tempDir("flow-model-switch-failure-predraft");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("model unavailable", ctx);
	const flowPath = join(cwd, ".flow", "F1", "flow.json");
	assert(
		existsSync(flowPath),
		"planner switch failure did not persist Flow id",
	);
	const flow = JSON.parse(readFileSync(flowPath, "utf8"));
	assert(
		flow.status === "paused" &&
			flow.schemaVersion === 9 &&
			flow.id === "F1" &&
			flow.goals.length === 0 &&
			flow.currentGoal === 0 &&
			flow.startedAt === null,
		`planner switch failure persisted wrong pre-draft: ${JSON.stringify(flow)}`,
	);
	assert(
		state.hiddenMessages.length === 0,
		"planner switch failure should not send generation prompt",
	);
	assert(
		state.notifications.join("\n").includes("编号：F1"),
		`planner switch failure did not expose Flow id: ${state.notifications.join(" | ")}`,
	);
	writeFlowTestConfig();
}

async function flowPromptSendFailureShowsPreDraftIdScenario() {
	const cwd = tempDir("flow-prompt-send-failure-predraft");
	const state = newState(cwd);
	state.failSend = true;
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("send unavailable", ctx);
	const flowPath = join(cwd, ".flow", "F1", "flow.json");
	assert(existsSync(flowPath), "prompt send failure did not persist Flow id");
	const flow = JSON.parse(readFileSync(flowPath, "utf8"));
	assert(
		flow.status === "generating" &&
			flow.schemaVersion === 9 &&
			flow.id === "F1" &&
			flow.goals.length === 0 &&
			flow.currentGoal === 0 &&
			flow.startedAt === null &&
			flow.errors.includes("Flow 计划提示发送失败"),
		`prompt send failure persisted wrong pre-draft: ${JSON.stringify(flow)}`,
	);
	const alignment = JSON.parse(
		readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
	);
	assert(
		alignment.stage === "generating" &&
			alignment.sessionFile === ctx.sessionManager.getSessionFile(),
		`prompt send failure persisted wrong alignment: ${JSON.stringify(alignment)}`,
	);
	const notices = state.notifications.join("\n");
	assert(
		notices.includes("编号：F1"),
		`prompt failure hid Flow id: ${notices}`,
	);
	assertNoticeFormat(
		state.notifications.find((item) => item.includes("Flow 计划提示发送失败")),
		"❌",
		"busy",
	);
	state.failSend = false;
	await commands.get("flow").handler("go F1", ctx);
	assert(
		state.hiddenMessages.at(-1).includes("send unavailable") &&
			state.hiddenMessages.at(-1).includes("补齐 draft Flow 语义草稿") &&
			!state.notifications.at(-1).includes("Flow 未在运行"),
		"/flow go did not recover a generating pre-draft prompt failure",
	);
}

async function flowMissingGenerationContinueScenario() {
	const cwd = tempDir("flow-missing-generation-continue");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("missing generation output", ctx);
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	const flow = readFlow(join(cwd, ".flow", "F1"));
	assert(
		flow.status === "generating" &&
			flow.errors.includes("AI 未生成有效 Flow 计划"),
		"missing generation result did not persist recoverable errors",
	);
	await commands.get("flow").handler("go F1", ctx);
	assert(
		state.hiddenMessages.at(-1).includes("missing generation output") &&
			state.hiddenMessages.at(-1).includes("补齐 draft Flow 语义草稿") &&
			!state.notifications.at(-1).includes("Flow 未在运行"),
		"/flow go did not recover a missing generation result",
	);
}

async function flowNoIdGenerationContinueScenario() {
	const cwd = tempDir("flow-no-id-generation-continue");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctxA = commandContext(state, cwd, join(cwd, "session-a.jsonl"));
	await commands.get("flow").handler("no id generation recovery", ctxA);
	await emit(handlers, "agent_end", { messages: [] }, ctxA);
	const ctxB = commandContext(state, cwd, join(cwd, "session-b.jsonl"));
	await commands.get("flow").handler("go", ctxB);
	const rebound = JSON.parse(
		readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
	);
	assert(
		rebound.sessionFile === ctxB.sessionManager.getSessionFile() &&
			state.hiddenMessages.at(-1).includes("no id generation recovery") &&
			!state.notifications.at(-1).includes("Flow 未在运行"),
		"bare /flow go did not recover the only active pre-draft Flow",
	);
}

async function flowExplicitPreDraftContinueKeepsTargetScenario() {
	const cwd = tempDir("flow-explicit-predraft-continue-target");
	const sessionFile = join(cwd, "planning.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "awaiting_blocking_input",
		sessionFile,
		originalRequest: "other flow",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "generating",
		sessionFile: join(cwd, "old.jsonl"),
		autoStart: false,
		originalRequest: "explicit target flow",
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("go F2", ctx);
	assert(
		state.hiddenMessages.at(-1).includes("explicit target flow"),
		"explicit pre-draft go did not send target recovery prompt",
	);
	writeFlowSemanticDraft(cwd, "F2", { title: "Explicit Target" });
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	const target = readFlow(join(cwd, ".flow", "F2"));
	const other = readFlow(join(cwd, ".flow", "F1"));
	assert(
		target.status === "draft" &&
			target.title === "Explicit Target" &&
			!existsSync(join(cwd, ".flow", "F2", "alignment.json")) &&
			other.status === "generating" &&
			existsSync(join(cwd, ".flow", "F1", "alignment.json")),
		"explicit pre-draft go result was not written to the target Flow",
	);
}

async function flowPromptedContinueDoesNotOverwriteInflightTargetScenario() {
	const cwd = tempDir("flow-prompted-continue-inflight-target");
	const sessionFile = join(cwd, "planning.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "generating",
		sessionFile,
		autoStart: false,
		originalRequest: "first prompted recovery",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "generating",
		sessionFile,
		autoStart: false,
		originalRequest: "second prompted recovery",
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("go F1", ctx);
	const promptCount = state.hiddenMessages.length;
	await commands.get("flow").handler("go F2", ctx);
	const targetBefore = JSON.stringify(readFlow(join(cwd, ".flow", "F2")));
	writeFlowSemanticDraft(cwd, "F1", { title: "First Prompted Recovery" });
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	const first = readFlow(join(cwd, ".flow", "F1"));
	assert(
		state.hiddenMessages.length === promptCount &&
			state.notifications.some((message) =>
				message.includes("正在等待 AI 返回"),
			) &&
			first.status === "draft" &&
			first.title === "First Prompted Recovery" &&
			JSON.stringify(readFlow(join(cwd, ".flow", "F2"))) === targetBefore,
		"second prompted continue overwrote the first prompt target",
	);
}

async function flowExplicitPreDraftRepairKeepsTargetScenario() {
	const cwd = tempDir("flow-explicit-predraft-repair-target");
	const sessionFile = join(cwd, "planning.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "awaiting_blocking_input",
		sessionFile,
		originalRequest: "other flow must stay unchanged",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "generating",
		sessionFile: join(cwd, "old.jsonl"),
		autoStart: false,
		originalRequest: "explicit repair target",
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("go F2", ctx);
	const otherBefore = JSON.stringify(readFlow(join(cwd, ".flow", "F1")));
	writeFlowSemanticDraft(cwd, "F2", {
		title: "Broken Explicit Target",
		invalidMarkdown: true,
	});
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		readFlow(join(cwd, ".flow", "F2")).repairAttempts === 1 &&
			state.hiddenMessages.at(-1).includes("当前校验错误"),
		"explicit pre-draft repair did not send repair prompt",
	);
	writeFlowSemanticDraft(cwd, "F2", { title: "Repaired Explicit Target" });
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	const target = readFlow(join(cwd, ".flow", "F2"));
	assert(
		JSON.stringify(readFlow(join(cwd, ".flow", "F1"))) === otherBefore &&
			target.status === "draft" &&
			target.title === "Repaired Explicit Target" &&
			!existsSync(join(cwd, ".flow", "F2", "alignment.json")),
		"explicit pre-draft repair result was not written to F2",
	);
}

async function flowCrossSessionGenerationContinueScenario() {
	const cwd = tempDir("flow-cross-session-generation-continue");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctxA = commandContext(state, cwd, join(cwd, "session-a.jsonl"));
	await commands.get("flow").handler("cross session generation", ctxA);
	await emit(handlers, "agent_end", { messages: [] }, ctxA);
	const ctxB = commandContext(state, cwd, join(cwd, "session-b.jsonl"));
	await commands.get("flow").handler("go F1", ctxB);
	const rebound = JSON.parse(
		readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
	);
	assert(
		rebound.sessionFile === ctxB.sessionManager.getSessionFile() &&
			state.hiddenMessages.at(-1).includes("cross session generation") &&
			!state.notifications.at(-1).includes("Flow 未在运行"),
		"/flow go did not rebind generating pre-draft to the current session",
	);
	writeFlowSemanticDraft(cwd, "F1", { title: "Cross Session Recovered" });
	await emit(handlers, "agent_end", { messages: [] }, ctxB);
	await flushScheduledGoalStart();
	assert(
		readFlow(join(cwd, ".flow", "F1")).status === "running" &&
			!existsSync(join(cwd, ".flow", "F1", "alignment.json")),
		"rebound generation did not finish from the new session",
	);
}

async function flowCrossSessionOldReplyTargetIgnoredScenario() {
	const cwd = tempDir("flow-cross-session-old-reply-target");
	const sessionA = join(cwd, "session-a.jsonl");
	const sessionB = join(cwd, "session-b.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "aligning",
		stage: "awaiting_alignment_input",
		sessionFile: sessionA,
		lastAlignmentQuestion: "问题 1：范围？",
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctxA = commandContext(state, cwd, sessionA);
	await commands.get("flow").handler("go F1", ctxA);
	assertNoticeFormat(state.notifications.at(-1), "⏳", "回答 Q1 继续对齐");
	const ctxB = commandContext(state, cwd, sessionB);
	await commands.get("flow").handler("go F1", ctxB);
	const before = JSON.stringify(
		JSON.parse(
			readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
		),
	);
	const oldResult = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "旧对话回复" },
		ctxA,
	);
	assert(
		oldResult === undefined &&
			JSON.stringify(
				JSON.parse(
					readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
				),
			) === before,
		"old session reply target changed a rebound pre-draft Flow",
	);
	const newResult = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "新对话回复" },
		ctxB,
	);
	const alignment = JSON.parse(
		readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
	);
	assert(
		newResult?.action === "handled" &&
			alignment.sessionFile === ctxB.sessionManager.getSessionFile() &&
			alignment.alignmentTurns.at(-1)?.answer === "新对话回复",
		"new session reply did not own the rebound pre-draft Flow",
	);
}

async function flowCrossSessionOldPromptTargetIgnoredScenario() {
	const cwd = tempDir("flow-cross-session-old-prompt-target");
	const sessionA = join(cwd, "session-a.jsonl");
	const sessionB = join(cwd, "session-b.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "aligning",
		stage: "aligning",
		sessionFile: sessionA,
		originalRequest: "cross session prompt target",
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctxA = commandContext(state, cwd, sessionA);
	await commands.get("flow").handler("go F1", ctxA);
	const ctxB = commandContext(state, cwd, sessionB);
	await commands.get("flow").handler("go F1", ctxB);
	const before = JSON.stringify(
		JSON.parse(
			readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
		),
	);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", content: "问题 1：旧对话结果？" }] },
		ctxA,
	);
	assert(
		JSON.stringify(
			JSON.parse(
				readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
			),
		) === before,
		"old session prompt target changed a rebound pre-draft Flow",
	);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", content: "问题 1：新对话结果？" }] },
		ctxB,
	);
	const alignment = JSON.parse(
		readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
	);
	assert(
		alignment.sessionFile === ctxB.sessionManager.getSessionFile() &&
			alignment.stage === "awaiting_alignment_input" &&
			alignment.lastAlignmentQuestion === "问题 1：新对话结果？",
		"new session prompt target did not own the rebound pre-draft Flow",
	);
}

async function flowReboundLivePromptDoesNotBlockOldSessionContinueScenario() {
	const cwd = tempDir("flow-rebound-live-prompt-old-continue");
	const sessionA = join(cwd, "session-a.jsonl");
	const sessionB = join(cwd, "session-b.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "generating",
		sessionFile: sessionA,
		originalRequest: "rebound live target",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "generating",
		sessionFile: join(cwd, "other.jsonl"),
		originalRequest: "old session continue target",
	});
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctxA = commandContext(state, cwd, sessionA);
	await commands.get("flow").handler("go F1", ctxA);
	const ctxB = commandContext(state, cwd, sessionB);
	await commands.get("flow").handler("go F1", ctxB);
	const promptCount = state.hiddenMessages.length;
	await commands.get("flow").handler("go F2", ctxA);
	const rebound = JSON.parse(
		readFileSync(join(cwd, ".flow", "F2", "alignment.json"), "utf8"),
	);
	assert(
		state.hiddenMessages.length === promptCount + 1 &&
			rebound.sessionFile === ctxA.sessionManager.getSessionFile() &&
			state.hiddenMessages.at(-1).includes("old session continue target"),
		"rebound live prompt blocked old session explicit continue",
	);
}

async function flowReboundLivePromptDoesNotBlockOldSessionReplyScenario() {
	const cwd = tempDir("flow-rebound-live-prompt-old-reply");
	const sessionA = join(cwd, "session-a.jsonl");
	const sessionB = join(cwd, "session-b.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "generating",
		sessionFile: sessionA,
		originalRequest: "rebound live target",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "awaiting_blocking_input",
		sessionFile: sessionA,
		originalRequest: "old session reply target",
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctxA = commandContext(state, cwd, sessionA);
	await commands.get("flow").handler("go F1", ctxA);
	const ctxB = commandContext(state, cwd, sessionB);
	await commands.get("flow").handler("go F1", ctxB);
	const result = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "补充 F2 细节" },
		ctxA,
	);
	let flow = readFlow(join(cwd, ".flow", "F2"));
	assert(
		result?.action === "handled" &&
			flow.source.originalRequest.includes("补充 F2 细节") &&
			state.hiddenMessages.at(-1).includes("old session reply target"),
		"rebound live prompt blocked old session direct reply",
	);
	await emit(handlers, "agent_end", { messages: [] }, ctxA);
	flow = readFlow(join(cwd, ".flow", "F2"));
	assert(
		flow.source.originalRequest.includes("补充 F2 细节") &&
			flow.errors.length === 0,
		"old rebound prompt agent_end polluted the old session sibling Flow",
	);
}

async function flowCrossSessionCompletedTargetIgnoresOldPromptScenario() {
	const cwd = tempDir("flow-cross-session-completed-target-old-prompt");
	const sessionA = join(cwd, "session-a.jsonl");
	const sessionB = join(cwd, "session-b.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "awaiting_blocking_input",
		sessionFile: sessionA,
		originalRequest: "other flow must survive completed stale prompt",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "generating",
		sessionFile: sessionA,
		autoStart: false,
		originalRequest: "target completed after rebind",
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctxA = commandContext(state, cwd, sessionA);
	await commands.get("flow").handler("go F2", ctxA);
	const ctxB = commandContext(state, cwd, sessionB);
	await commands.get("flow").handler("go F2", ctxB);
	const otherBefore = JSON.stringify(readFlow(join(cwd, ".flow", "F1")));
	writeFlowSemanticDraft(cwd, "F2", { title: "Completed After Rebind" });
	await emit(handlers, "agent_end", { messages: [] }, ctxB);
	await emit(handlers, "agent_end", { messages: [] }, ctxA);
	const target = readFlow(join(cwd, ".flow", "F2"));
	assert(
		JSON.stringify(readFlow(join(cwd, ".flow", "F1"))) === otherBefore &&
			target.status === "draft" &&
			target.title === "Completed After Rebind",
		"old prompt after cross-session completion changed the wrong Flow",
	);
}

async function flowCrossSessionFinalConfirmInputScenario() {
	const cwd = tempDir("flow-cross-session-final-confirm");
	const dir = join(cwd, ".flow", "F1");
	mkdirSync(dir, { recursive: true });
	const sessionA = join(cwd, "session-a.jsonl");
	writeFlow(dir, {
		schemaVersion: 9,
		language: "zh",
		id: "F1",
		title: "Flow F1",
		status: "aligning",
		source: { type: "prompt", path: null, originalRequest: "跨会话确认" },
		createdAt: Date.now(),
		updatedAt: Date.now(),
		startedAt: null,
		currentGoal: 0,
		parallelRun: null,
		repairAttempts: 0,
		errors: [],
		goals: [],
	});
	writeFileSync(
		join(dir, "alignment.json"),
		`${JSON.stringify(
			{
				version: 1,
				stage: "awaiting_final_confirm",
				sessionFile: sessionA,
				autoStart: true,
				alignmentTurns: [{ question: "问题 1：做 UI？", answer: "做 UI" }],
				lastAlignmentQuestion: null,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			},
			null,
			2,
		)}\n`,
	);
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctxB = commandContext(state, cwd, join(cwd, "session-b.jsonl"));
	await commands.get("flow").handler("go F1", ctxB);
	const rebound = JSON.parse(readFileSync(join(dir, "alignment.json"), "utf8"));
	assert(
		rebound.sessionFile === ctxB.sessionManager.getSessionFile() &&
			rebound.stage === "generating" &&
			state.hiddenMessages.at(-1).includes("恢复的对齐问答") &&
			state.hiddenMessages.at(-1).includes("Q1: 问题 1：做 UI？"),
		"/flow go did not generate from rebound final confirmation",
	);
}

async function flowExplicitAligningRecoveryReplyTargetScenario() {
	const cwd = tempDir("flow-explicit-aligning-reply-target");
	const sessionFile = join(cwd, "planning.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "awaiting_blocking_input",
		sessionFile,
		originalRequest: "other flow must not handle aligning reply",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "aligning",
		stage: "aligning",
		sessionFile: join(cwd, "old.jsonl"),
		originalRequest: "target aligning recovery",
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("go F2", ctx);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", content: "问题 1：F2 范围？" }] },
		ctx,
	);
	const otherBefore = JSON.stringify(readFlow(join(cwd, ".flow", "F1")));
	const result = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "回答 F2 范围" },
		ctx,
	);
	const alignment = JSON.parse(
		readFileSync(join(cwd, ".flow", "F2", "alignment.json"), "utf8"),
	);
	assert(
		result?.action === "handled" &&
			JSON.stringify(readFlow(join(cwd, ".flow", "F1"))) === otherBefore &&
			alignment.stage === "aligning" &&
			alignment.alignmentTurns.at(-1)?.answer === "回答 F2 范围",
		"explicit aligning recovery reply did not route to F2",
	);
}

async function flowExplicitWaitingStageDirectReplyTargetScenario() {
	for (const item of [
		{
			name: "alignment-input",
			status: "aligning",
			stage: "awaiting_alignment_input",
			input: "回答 F2 对齐",
			lastAlignmentQuestion: "问题 1：F2 范围？",
			assertTarget(_state, cwd, _before) {
				const alignment = JSON.parse(
					readFileSync(join(cwd, ".flow", "F2", "alignment.json"), "utf8"),
				);
				assert(
					alignment.stage === "aligning" &&
						alignment.alignmentTurns.at(-1)?.answer === "回答 F2 对齐",
					"explicit alignment reply did not route to F2",
				);
			},
		},
		{
			name: "blocking-input",
			status: "generating",
			stage: "awaiting_blocking_input",
			input: "补充 F2 生成信息",
			assertTarget(state, cwd, _before) {
				const flow = readFlow(join(cwd, ".flow", "F2"));
				assert(
					flow.status === "generating" &&
						flow.source.originalRequest.includes("补充 F2 生成信息") &&
						state.hiddenMessages.at(-1).includes("target blocking-input"),
					"explicit blocking reply did not route to F2",
				);
			},
		},
	]) {
		const cwd = tempDir(`flow-explicit-waiting-${item.name}`);
		const sessionFile = join(cwd, "planning.jsonl");
		writePreDraftFlow(cwd, "F1", {
			status: "generating",
			stage: "awaiting_blocking_input",
			sessionFile,
			originalRequest: "other flow must not handle reply",
		});
		writePreDraftFlow(cwd, "F2", {
			status: item.status,
			stage: item.stage,
			sessionFile: join(cwd, "old.jsonl"),
			originalRequest: `target ${item.name}`,
			lastAlignmentQuestion: item.lastAlignmentQuestion ?? null,
			alignmentTurns: [{ question: "问题 0：F2?", answer: "F2" }],
		});
		const state = newState(cwd);
		const { commands, handlers } = await loadExtension(state);
		const ctx = commandContext(state, cwd, sessionFile);
		await commands.get("flow").handler("go F2", ctx);
		const otherBefore = JSON.stringify(readFlow(join(cwd, ".flow", "F1")));
		const result = await emitLast(
			handlers,
			"input",
			{ source: "interactive", text: item.input },
			ctx,
		);
		assert(
			result?.action === "handled" &&
				JSON.stringify(readFlow(join(cwd, ".flow", "F1"))) === otherBefore,
			`${item.name} direct reply changed F1 or was not handled`,
		);
		item.assertTarget(state, cwd, otherBefore);
	}
}

async function flowExplicitReplyTargetPersistsAcrossRoundsScenario() {
	const cwd = tempDir("flow-explicit-reply-target-persists");
	const sessionFile = join(cwd, "planning.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "awaiting_blocking_input",
		sessionFile,
		originalRequest: "other flow must not handle repeated replies",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "aligning",
		stage: "awaiting_alignment_input",
		sessionFile: join(cwd, "old.jsonl"),
		originalRequest: "target repeated alignment",
		lastAlignmentQuestion: "问题 1：F2 第一问？",
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("go F2", ctx);
	const otherBefore = JSON.stringify(readFlow(join(cwd, ".flow", "F1")));
	await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "回答 F2 第一问" },
		ctx,
	);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", content: "问题 2：F2 第二问？" }] },
		ctx,
	);
	const result = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "回答 F2 第二问" },
		ctx,
	);
	const alignment = JSON.parse(
		readFileSync(join(cwd, ".flow", "F2", "alignment.json"), "utf8"),
	);
	assert(
		result?.action === "handled" &&
			JSON.stringify(readFlow(join(cwd, ".flow", "F1"))) === otherBefore &&
			alignment.alignmentTurns.length === 2 &&
			alignment.alignmentTurns.at(-1)?.answer === "回答 F2 第二问",
		"explicit reply target did not persist across alignment rounds",
	);
}

async function flowRecoveredInputKeepsCommandAutoStartScenario() {
	const cwd = tempDir("flow-recovered-go-keeps-command-autostart");
	const sessionFile = join(cwd, "planning.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "aligning",
		stage: "awaiting_final_confirm",
		sessionFile: join(cwd, "old.jsonl"),
		autoStart: true,
		originalRequest: "auto-start after input ctx",
		alignmentTurns: [{ question: "问题 1：做 UI？", answer: "做 UI" }],
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const commandCtx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("go F1", commandCtx);
	const eventCtx = commandContext(state, cwd, sessionFile);
	eventCtx.newSession = undefined;
	writeFlowSemanticDraft(cwd, "F1", { title: "Auto Start Keeps Command" });
	await emit(handlers, "agent_end", { messages: [] }, eventCtx);
	await flushScheduledGoalStart();
	const flow = readFlow(join(cwd, ".flow", "F1"));
	assert(
		flow.status === "running" &&
			state.newSessions.at(-1)?.from ===
				commandCtx.sessionManager.getSessionFile(),
		"event ctx overwrote recovered command auto-start context",
	);
}

async function flowCrossSessionFinalConfirmAutoStartContextScenario() {
	const cwd = tempDir("flow-cross-session-final-confirm-autostart");
	const state = newState(cwd);
	state.select = "先进行多轮问答对齐想法";
	const { commands, handlers } = await loadExtension(state);
	const ctxA = commandContext(state, cwd, join(cwd, "session-a.jsonl"));
	await commands.get("flow").handler("跨会话确认自动启动", ctxA);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", content: "问题 1：做 UI？" }] },
		ctxA,
	);
	await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "做 UI" },
		ctxA,
	);
	await emit(
		handlers,
		"agent_end",
		{
			messages: [
				{
					role: "assistant",
					content: "信息足够。\n<!-- pi-flow:ready-to-draft -->",
				},
			],
		},
		ctxA,
	);
	const ctxB = commandContext(state, cwd, join(cwd, "session-b.jsonl"));
	await commands.get("flow").handler("go F1", ctxB);
	assert(
		state.hiddenMessages.at(-1).includes("恢复的对齐问答"),
		"cross-session final confirmation did not send restored generation prompt",
	);
	writeFlowSemanticDraft(cwd, "F1", { title: "Auto Start From Rebound" });
	await emit(handlers, "agent_end", { messages: [] }, ctxB);
	await flushScheduledGoalStart();
	const newSession = state.newSessions.at(-1);
	assert(
		readFlow(join(cwd, ".flow", "F1")).status === "running" &&
			newSession?.from === ctxB.sessionManager.getSessionFile(),
		"cross-session final confirmation auto-start used the old session context",
	);
}

async function flowCrossSessionWaitingStagesPlannerSwitchScenario() {
	writeFlowTestConfig({
		modelRoles: {
			planner: { model: "missing/provider", thinking: "medium" },
		},
	});
	try {
		for (const item of [
			{
				stage: "awaiting_final_confirm",
				status: "aligning",
				input: "go",
			},
			{
				stage: "awaiting_alignment_input",
				status: "aligning",
				input: "继续补充",
			},
			{
				stage: "awaiting_blocking_input",
				status: "generating",
				input: "补充阻塞信息",
			},
		]) {
			const cwd = tempDir(`flow-cross-session-${item.stage}-planner-switch`);
			const dir = join(cwd, ".flow", "F1");
			const sessionA = join(cwd, "session-a.jsonl");
			mkdirSync(dir, { recursive: true });
			writeFlow(dir, {
				schemaVersion: 9,
				language: "zh",
				id: "F1",
				title: "Flow F1",
				status: item.status,
				source: { type: "prompt", path: null, originalRequest: "跨会话切模型" },
				createdAt: Date.now(),
				updatedAt: Date.now(),
				startedAt: null,
				currentGoal: 0,
				parallelRun: null,
				repairAttempts: 0,
				errors: [],
				goals: [],
			});
			writeFileSync(
				join(dir, "alignment.json"),
				`${JSON.stringify(
					{
						version: 1,
						stage: item.stage,
						sessionFile: sessionA,
						autoStart: true,
						alignmentTurns: [],
						lastAlignmentQuestion: "问题 1：做 UI？",
						createdAt: Date.now(),
						updatedAt: Date.now(),
					},
					null,
					2,
				)}\n`,
			);
			const state = newState(cwd);
			const { commands, handlers } = await loadExtension(state);
			const ctxB = commandContext(state, cwd, join(cwd, "session-b.jsonl"));
			await commands.get("flow").handler("go F1", ctxB);
			const hiddenBefore = state.hiddenMessages.length;
			if (item.stage === "awaiting_final_confirm") {
				assert(
					state.notifications.some(
						(notice) =>
							notice.includes("计划模型不可用") &&
							notice.includes("missing/provider"),
					),
					"final confirmation go did not block before planner switch",
				);
				continue;
			}
			const result = await emitLast(
				handlers,
				"input",
				{ source: "interactive", text: item.input },
				ctxB,
			);
			assert(
				result?.action === "handled" &&
					state.hiddenMessages.length === hiddenBefore &&
					state.notifications.some(
						(notice) =>
							notice.includes("计划模型不可用") &&
							notice.includes("missing/provider"),
					),
				`${item.stage} did not block recovered prompt before planner switch`,
			);
		}
	} finally {
		writeFlowTestConfig();
	}
}

async function flowAlignmentStageWriteFailureRollsBackScenario() {
	const cwd = tempDir("flow-alignment-write-failure-rollback");
	const state = newState(cwd);
	state.select = "先进行多轮问答对齐想法";
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("rollback alignment write", ctx);
	await emit(
		handlers,
		"agent_end",
		{
			messages: [
				{
					role: "assistant",
					content: "信息足够。\n<!-- pi-flow:ready-to-draft -->",
				},
			],
		},
		ctx,
	);
	const dir = join(cwd, ".flow", "F1");
	const beforeFlow = readFlow(dir);
	const beforeAlignment = JSON.parse(
		readFileSync(join(dir, "alignment.json"), "utf8"),
	);
	mkdirSync(join(dir, "alignment.json.tmp"));
	const hiddenBefore = state.hiddenMessages.length;
	await commands.get("flow").handler("go F1", ctx);
	const afterFlow = readFlow(dir);
	const afterAlignment = JSON.parse(
		readFileSync(join(dir, "alignment.json"), "utf8"),
	);
	assert(
		afterFlow.status === beforeFlow.status &&
			afterAlignment.stage === beforeAlignment.stage &&
			state.hiddenMessages.length === hiddenBefore &&
			state.notifications.at(-1).includes("Flow 生成状态保存失败") &&
			!existsSync(join(dir, "alignment.json.tmp")),
		"alignment write failure left half-updated generation state",
	);
}

async function flowRepairAlignmentWriteFailureRollsBackScenario() {
	const cwd = tempDir("flow-repair-alignment-write-failure");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("repair alignment rollback", ctx);
	const dir = writeFlowSemanticDraft(cwd, "F1", { invalidMarkdown: true });
	const beforeFlow = readFlow(dir);
	const beforeAlignment = JSON.parse(
		readFileSync(join(dir, "alignment.json"), "utf8"),
	);
	mkdirSync(join(dir, "alignment.json.tmp"));
	const hiddenBefore = state.hiddenMessages.length;
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	const afterFlow = readFlow(dir);
	const afterAlignment = JSON.parse(
		readFileSync(join(dir, "alignment.json"), "utf8"),
	);
	assert(
		afterFlow.status === beforeFlow.status &&
			afterFlow.goals.length === 0 &&
			afterFlow.errors.length === beforeFlow.errors.length &&
			afterAlignment.stage === beforeAlignment.stage &&
			state.hiddenMessages.length === hiddenBefore &&
			!existsSync(join(dir, "alignment.json.tmp")),
		"repair alignment write failure left half-updated generation state",
	);
	assertNoticeFormat(state.notifications.at(-1), "❌", "alignment.json.tmp");
	assert(
		state.notifications.at(-1).includes("Flow 计划修复状态保存失败"),
		"repair state failure title missing",
	);
}

async function flowPreDraftStatusTextScenario() {
	const cwd = tempDir("flow-predraft-status-text");
	const dir = writePreDraftFlow(cwd, "F1", {
		status: "aligning",
		stage: "awaiting_alignment_input",
		lastAlignmentQuestion: "问题 1：范围是什么？",
	});
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("status F1", ctx);
	const notice = state.notifications.at(-1);
	assert(
		notice.includes("状态: 等待回复") &&
			notice.includes("回答 Q1 继续对齐") &&
			notice.includes("下一步: /flow go F1") &&
			notice.includes("问题: 问题 1：范围是什么？") &&
			!notice.includes("直接回复答案") &&
			!notice.includes("网页报告") &&
			!existsSync(join(dir, "flow.html")),
		`pre-draft status was not text-only with alignment details: ${notice}`,
	);
}

async function flowPreDraftDirectReplyAmbiguousScenario() {
	const cwd = tempDir("flow-predraft-direct-reply-ambiguous");
	const sessionFile = join(cwd, "planning.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "awaiting_blocking_input",
		sessionFile,
	});
	writePreDraftFlow(cwd, "F2", {
		status: "aligning",
		stage: "awaiting_alignment_input",
		sessionFile,
		lastAlignmentQuestion: "问题 1：范围？",
	});
	const state = newState(cwd);
	const { handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	const result = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "补充答案" },
		ctx,
	);
	assert(
		result?.action === "handled" &&
			state.hiddenMessages.length === 0 &&
			state.notifications.at(-1).includes("多个未完成的 Flow 计划生成"),
		"ambiguous pre-draft direct reply should not pick one Flow",
	);
}

async function generationAlignCommandConfigScenario() {
	writeFlowTestConfig({ generation: { align: "yes" } });
	const yesCwd = tempDir("generation-align-yes-command");
	const yesState = newState(yesCwd);
	const yesExtension = await loadExtension(yesState);
	const yesCtx = commandContext(
		yesState,
		yesCwd,
		join(yesCwd, "planning.jsonl"),
	);
	await yesExtension.commands.get("flow").handler("align from config", yesCtx);
	assert(yesState.selects.length === 0, "generation.align yes showed selector");
	const yesAlignmentPrompt = yesState.hiddenMessages.at(-1);
	assert(
		yesAlignmentPrompt.includes("# 拷问我") &&
			yesState.sentMessages.length === 0,
		"generation.align yes did not start hidden alignment",
	);
	assert(
		yesAlignmentPrompt.includes(
			"先全面审视当前会话、已有需求、代码库线索和文档",
		) &&
			yesAlignmentPrompt.includes("直到达成全面共同理解") &&
			yesAlignmentPrompt.includes("一次只问一个问题") &&
			yesAlignmentPrompt.includes("2-4 个具体选项") &&
			yesAlignmentPrompt.includes("基于项目具体情况，需求以及最佳实践") &&
			yesAlignmentPrompt.includes("先探索事实源后再提出基于事实的问题") &&
			yesAlignmentPrompt.includes(
				"所有会影响实现范围、实现细节、需求、提示词语义、状态事实源、测试验证",
			) &&
			yesAlignmentPrompt.includes(
				"ready marker <!-- pi-flow:ready-to-draft -->",
			) &&
			!yesAlignmentPrompt.includes("<aligned-request>") &&
			!yesAlignmentPrompt.includes("最高杠杆") &&
			!yesAlignmentPrompt.includes("阻塞哪个未确认决策") &&
			!yesAlignmentPrompt.includes("每轮先列出未确认决策树"),
		"Chinese alignment prompt missing concise decision contract",
	);
	const flowCardIndex = yesState.customMessages.findIndex(
		(item) =>
			item.message.customType === "pi-flow-result-card" &&
			item.message.details?.title === "开始对齐 Flow" &&
			String(item.message.content).includes("等待 AI 提问"),
	);
	const flowHiddenPromptIndex = yesState.customMessages.findIndex(
		(item) => item.message.customType === "pi-flow-internal-prompt",
	);
	assert(flowCardIndex >= 0, "flow alignment start card missing");
	assert(
		flowCardIndex < flowHiddenPromptIndex,
		"flow alignment start card should be sent before hidden prompt",
	);

	writeFlowTestConfig({ generation: { align: "no" } });
	const noCwd = tempDir("generation-align-no-command");
	const noState = newState(noCwd);
	const noExtension = await loadExtension(noState);
	const noCtx = commandContext(noState, noCwd, join(noCwd, "planning.jsonl"));
	await noExtension.commands.get("flow").handler("direct from config", noCtx);
	assert(noState.selects.length === 0, "generation.align no showed selector");
	assert(
		!noState.hiddenMessages.at(-1).includes("# 拷问我") &&
			noState.hiddenMessages.at(-1).includes("direct from config") &&
			noState.sentMessages.length === 0,
		"generation.align no did not start hidden direct generation",
	);
	writeFlowSemanticDraft(noCwd, "F1");
	await emit(noExtension.handlers, "agent_end", { messages: [] }, noCtx);
	assert(
		noState.newSessions.length === 1,
		"generation.align no did not auto-start flow",
	);

	writeFlowTestConfig({ generation: { align: "bad" } });
	const invalidCwd = tempDir("generation-align-invalid-command");
	const invalidState = newState(invalidCwd);
	const invalidExtension = await loadExtension(invalidState);
	const invalidCtx = commandContext(
		invalidState,
		invalidCwd,
		join(invalidCwd, "planning.jsonl"),
	);
	await invalidExtension.commands
		.get("flow")
		.handler("invalid config", invalidCtx);
	assertNoticeFormat(
		invalidState.notifications.find((item) => item.includes("生成配置已回退")),
		"⚠️",
		"已按 ask 处理",
	);
	writeFlowTestConfig();
}

async function flowAlignmentActivityCopyScenario() {
	const cwd = tempDir("flow-alignment-activity-copy");
	const state = newState(cwd);
	state.select = "先进行多轮问答对齐想法";
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("activity copy", ctx);
	assert(
		latestWidgetText(state).includes("🌊 Flow · 对齐中") &&
			latestWidgetText(state).includes("等待 AI 提出 Q1"),
		"initial alignment activity should wait for Q1",
	);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", content: "问题 1：范围？" }] },
		ctx,
	);
	assert(
		latestWidgetText(state).includes("🌊 Flow · 等待回复") &&
			latestWidgetText(state).includes("回答 Q1 继续对齐") &&
			!latestWidgetText(state).includes("🌊 Flow · 等待回复 Q1") &&
			!latestWidgetText(state).includes("开始生成"),
		"alignment question activity should wait for Q1 reply",
	);
	const answerResult = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "范围 A" },
		ctx,
	);
	assert(
		answerResult?.action === "handled" &&
			latestWidgetText(state).includes("等待 AI 提出 Q2") &&
			!latestWidgetText(state).includes("等待 AI 提出 Q1"),
		"alignment answer should advance activity to Q2",
	);
	assertLightweightAlignmentPrompt(state.hiddenMessages.at(-1));
	await emit(
		handlers,
		"agent_end",
		{
			messages: [
				{
					role: "assistant",
					content: "信息足够。\n<!-- pi-flow:ready-to-draft -->",
				},
			],
		},
		ctx,
	);
	assert(
		latestWidgetText(state).includes("🌊 Flow · 等待确认") &&
			latestWidgetText(state).includes("运行 /flow go F1 生成计划"),
		"ready marker should show final confirmation activity",
	);
	await commands.get("flow").handler("go F1", ctx);
	assert(
		latestWidgetText(state).includes("🌊 Flow · 撰写计划中") &&
			!latestWidgetText(state).includes("Q1") &&
			!latestWidgetText(state).includes("Q2"),
		"drafting activity should be compact even after Q&A turns",
	);
	assert(
		state.hiddenMessages.at(-1).includes("activity copy") &&
			!state.hiddenMessages.at(-1).includes("Q1:") &&
			!state.hiddenMessages.at(-1).includes("A1:") &&
			!state.hiddenMessages.at(-1).includes("恢复的对齐问答"),
		"same-session generation prompt should not inject alignment Q&A",
	);
}

async function flowDuplicatePreDraftStartBlockedScenario() {
	const cwd = tempDir("flow-duplicate-predraft-start-blocked");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("first request", ctx);
	const hiddenBefore = state.hiddenMessages.length;
	await commands.get("flow").handler("second request", ctx);
	assert(
		state.hiddenMessages.length === hiddenBefore &&
			!existsSync(join(cwd, ".flow", "F2")),
		"same-session duplicate /flow should be blocked before creating F2",
	);
	assertNoticeFormat(state.notifications.at(-1), "⏳", "运行 /flow go F1 继续");
}

async function flowReadyWithoutAlignedRequestScenario() {
	const cwd = tempDir("flow-ready-missing-summary");
	const state = newState(cwd);
	state.select = "先进行多轮问答对齐想法";
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("flow missing summary", ctx);
	await emit(
		handlers,
		"agent_end",
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
		latestWidgetText(state).includes("等待确认") &&
			latestWidgetText(state).includes("运行 /flow go F1 生成计划") &&
			latestWidgetText(state).includes("继续输入则补充对齐") &&
			!latestWidgetText(state).includes("<aligned-request>"),
		"flow ready without aligned-request should wait for final confirmation",
	);
	const inputResult = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "继续限定 UI" },
		ctx,
	);
	assert(
		inputResult?.action === "handled",
		"continued flow alignment input should stop the original prompt",
	);
	assert(
		latestWidgetText(state).includes("🌊 Flow · 对齐中") &&
			latestWidgetText(state).includes("等待 AI 提出 Q2") &&
			!latestWidgetText(state).includes("已收到"),
		"flow alignment input should keep an in-progress activity box",
	);
	assert(
		state.customMessages.some(
			(item) =>
				item.message.display === true && item.message.content === "继续限定 UI",
		),
		"flow alignment answer should remain visible",
	);
	const alignment = JSON.parse(
		readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
	);
	const flow = readFlow(join(cwd, ".flow", "F1"));
	assert(
		alignment.alignmentTurns[0]?.question.includes("是否限定 UI") &&
			alignment.alignmentTurns[0]?.answer === "继续限定 UI" &&
			!("alignmentTurns" in flow),
		"alignment Q&A should be persisted outside flow.json",
	);
	assertLightweightAlignmentPrompt(state.hiddenMessages.at(-1));
	await emit(
		handlers,
		"agent_end",
		{
			messages: [
				{
					role: "assistant",
					content: "问题 2：是否需要测试？\n<!-- pi-flow:ready-to-draft -->",
				},
			],
		},
		ctx,
	);
	await commands.get("flow").handler("go F1", ctx);
	assert(
		latestWidgetText(state).includes("🌊 Flow · 撰写计划中") &&
			!latestWidgetText(state).includes("flow missing summary"),
		"go should switch to compact generation box",
	);
	assert(
		state.hiddenMessages.at(-1).includes("补齐 draft Flow 语义草稿") &&
			state.hiddenMessages.at(-1).includes("flow missing summary") &&
			!state.hiddenMessages.at(-1).includes("# 拷问我") &&
			!state.hiddenMessages.at(-1).includes("对齐记录") &&
			!state.hiddenMessages.at(-1).includes("已对齐问答") &&
			!state.hiddenMessages.at(-1).includes("Q1:") &&
			!state.hiddenMessages.at(-1).includes("A1:") &&
			!state.hiddenMessages.at(-1).includes("对齐摘要") &&
			!state.hiddenMessages.at(-1).includes("<aligned-request>"),
		"go should send flow generation prompt without alignment Q/A",
	);
}

async function flowRestoredAlignmentContextScenario() {
	const cwd = tempDir("flow-restored-alignment-context");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const sessionFile = join(cwd, "planning.jsonl");
	const ctx = commandContext(state, cwd, sessionFile);
	const dir = join(cwd, ".flow", "F99");
	mkdirSync(dir, { recursive: true });
	writeFlow(dir, {
		schemaVersion: 9,
		language: "zh",
		id: "F99",
		title: "Flow F99",
		status: "aligning",
		source: {
			type: "prompt",
			path: null,
			originalRequest: "恢复后生成计划",
		},
		createdAt: Date.now(),
		updatedAt: Date.now(),
		startedAt: null,
		currentGoal: 0,
		parallelRun: null,
		repairAttempts: 0,
		errors: [],
		goals: [],
	});
	writeFileSync(
		join(dir, "alignment.json"),
		`${JSON.stringify(
			{
				version: 1,
				stage: "awaiting_final_confirm",
				sessionFile,
				autoStart: false,
				alignmentTurns: [
					{ question: "问题 1：是否需要 UI？", answer: "需要 UI" },
				],
				lastAlignmentQuestion: null,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			},
			null,
			2,
		)}\n`,
	);
	await commands.get("flow").handler("go F99", ctx);
	const prompt = state.hiddenMessages.at(-1);
	assert(
		prompt.includes("恢复的对齐问答") &&
			prompt.includes("Q1: 问题 1：是否需要 UI？") &&
			prompt.includes("A1: 需要 UI") &&
			!prompt.includes("# 拷问我"),
		"restored generation prompt did not include persisted alignment Q&A",
	);
}

async function flowStreamingAlignmentInputDoesNotEchoScenario() {
	const cwd = tempDir("flow-streaming-alignment-input");
	const state = newState(cwd);
	state.select = "先进行多轮问答对齐想法";
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("streaming alignment", ctx);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", content: "问题 1：是否限定 UI？" }] },
		ctx,
	);
	const inputResult = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "Y", streamingBehavior: "followUp" },
		ctx,
	);
	assert(
		inputResult?.action === "handled",
		"streaming flow alignment input should be consumed",
	);
	assert(
		!state.customMessages.some(
			(item) => item.message.display === true && item.message.content === "Y",
		),
		"streaming flow alignment input should not echo as model-visible custom message",
	);
	assertLightweightAlignmentPrompt(state.hiddenMessages.at(-1));
}

function assertLightweightAlignmentPrompt(prompt) {
	assert(
		prompt.includes("继续 Flow 生成前对齐") &&
			prompt.includes("先探索事实源") &&
			prompt.includes("一次只问一个简洁问题") &&
			!prompt.includes("# 拷问我") &&
			!prompt.includes("原始需求") &&
			!prompt.includes("Original request") &&
			!prompt.includes("已对齐问答") &&
			!prompt.includes("Aligned Q&A") &&
			!prompt.includes("已有对齐摘要") &&
			!prompt.includes("Existing alignment summary") &&
			!prompt.includes("用户刚才回答") &&
			!prompt.includes("Latest user answer"),
		"flow alignment input should send lightweight hidden alignment context",
	);
}

function assertEnglishLightweightAlignmentPrompt(prompt) {
	assert(
		prompt.includes("Continue Flow alignment") &&
			prompt.includes("Ask exactly one concise question") &&
			!prompt.includes("# Question me") &&
			!prompt.includes("Original request") &&
			!prompt.includes("Aligned Q&A") &&
			!prompt.includes("Existing alignment summary") &&
			!prompt.includes("Latest user answer") &&
			!prompt.includes("<aligned-request>"),
		"English flow alignment input should send lightweight hidden context",
	);
}

async function englishFlowAlignmentStartGenerationScenario() {
	const language = await importCachedModule("shared/language.js");
	const originalLanguage = process.env.PI_FLOW_LANGUAGE;
	process.env.PI_FLOW_LANGUAGE = "en";
	language.resetRuntimeLanguageForTests();
	try {
		const cwd = tempDir("flow-english-alignment-start-generation");
		const state = newState(cwd);
		state.select = "Ask alignment questions first";
		const { commands, handlers } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		await commands.get("flow").handler("Ship English flow", ctx);
		assert(
			latestWidgetText(state).includes("🌊 Flow · Aligning") &&
				latestWidgetText(state).includes("Waiting for AI to ask Q1") &&
				!latestWidgetText(state).includes("等待"),
			"English flow aligning widget leaked Chinese or missed Q1",
		);
		const englishAlignmentPrompt = state.hiddenMessages.at(-1);
		assert(
			englishAlignmentPrompt.includes("# Question me") &&
				englishAlignmentPrompt.includes(
					"First comprehensively review the current conversation",
				) &&
				englishAlignmentPrompt.includes("comprehensive shared understanding") &&
				englishAlignmentPrompt.includes("Ask exactly one question at a time") &&
				englishAlignmentPrompt.includes("2-4 concrete options") &&
				englishAlignmentPrompt.includes("the project's specific situation") &&
				englishAlignmentPrompt.includes(
					"inspect the source of truth first and then ask a fact-based question",
				) &&
				englishAlignmentPrompt.includes(
					"all decisions that affect implementation scope, implementation details, requirements, prompt semantics, state source of truth, and test verification",
				) &&
				englishAlignmentPrompt.includes(
					"ready marker <!-- pi-flow:ready-to-draft -->",
				) &&
				!englishAlignmentPrompt.includes("<aligned-request>") &&
				!englishAlignmentPrompt.includes("highest-leverage") &&
				!englishAlignmentPrompt.includes(
					"which unconfirmed decision it blocks",
				) &&
				!englishAlignmentPrompt.includes("list the unconfirmed decision tree"),
			"English alignment prompt missing concise decision contract",
		);
		await emit(
			handlers,
			"agent_end",
			{ messages: [{ role: "assistant", content: "Question 1: Need tests?" }] },
			ctx,
		);
		assert(
			latestWidgetText(state).includes("🌊 Flow · Waiting for reply") &&
				latestWidgetText(state).includes("Answer Q1 to continue alignment") &&
				!latestWidgetText(state).includes("🌊 Flow · Waiting for Q1 reply") &&
				!latestWidgetText(state).includes("Start generation") &&
				!latestWidgetText(state).includes("等待"),
			"English flow Q1 reply widget leaked Chinese or missed copy",
		);
		const answerResult = await emitLast(
			handlers,
			"input",
			{ source: "interactive", text: "Yes" },
			ctx,
		);
		assert(
			answerResult?.action === "handled" &&
				latestWidgetText(state).includes("Waiting for AI to ask Q2") &&
				!latestWidgetText(state).includes("Waiting for AI to ask Q1"),
			"English alignment answer should advance to Q2",
		);
		assertEnglishLightweightAlignmentPrompt(state.hiddenMessages.at(-1));
		await emit(
			handlers,
			"agent_end",
			{
				messages: [
					{
						role: "assistant",
						content: "Enough info.\n<!-- pi-flow:ready-to-draft -->",
					},
				],
			},
			ctx,
		);
		assert(
			latestWidgetText(state).includes("🌊 Flow · Ready to draft") &&
				latestWidgetText(state).includes(
					"Run /flow go F1 to generate the plan",
				) &&
				!latestWidgetText(state).includes("回复「开始生成」"),
			"English flow final-confirmation widget leaked Chinese",
		);
		await commands.get("flow").handler("go F1", ctx);
		assert(
			latestWidgetText(state).includes("🌊 Flow · Drafting plan") &&
				!latestWidgetText(state).includes("Q1") &&
				!latestWidgetText(state).includes("Q2") &&
				!latestWidgetText(state).includes("计划生成中"),
			"English flow go should switch to compact generating widget",
		);
		assert(
			state.hiddenMessages
				.at(-1)
				.includes(
					"generating a recoverable multi-session Pi Flow Goal queue",
				) &&
				state.hiddenMessages.at(-1).includes("Ship English flow") &&
				state.hiddenMessages.at(-1).includes("`dependsOn`") &&
				state.hiddenMessages.at(-1).includes("`writeScope`") &&
				!state.hiddenMessages.at(-1).includes("Restored alignment Q&A") &&
				!state.hiddenMessages.at(-1).includes("Alignment summary:") &&
				!state.hiddenMessages.at(-1).includes("Q1:") &&
				!state.hiddenMessages.at(-1).includes("A1:") &&
				!state.hiddenMessages.at(-1).includes("<aligned-request>") &&
				!state.hiddenMessages.at(-1).includes("# Question me"),
			"English go should send the Flow generation prompt without same-session Q&A",
		);
	} finally {
		if (originalLanguage === undefined) delete process.env.PI_FLOW_LANGUAGE;
		else process.env.PI_FLOW_LANGUAGE = originalLanguage;
		language.resetRuntimeLanguageForTests();
	}
}

async function generateScenario() {
	const cwd = tempDir("generate");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("修登录", ctx);
	const directPrompt = state.hiddenMessages.at(-1);
	const directFlowDir = join(cwd, ".flow", "F1");
	assert(
		state.hiddenMessages.at(-1).includes("修登录") &&
			state.sentMessages.length === 0,
		"generation prompt should be hidden and keep request",
	);
	assert(
		state.hiddenMessages.at(-1).includes("<!-- pi-flow:need-input -->") &&
			state.hiddenMessages.at(-1).includes("不要做生成前深度对齐"),
		"flow plan prompt missing blocking-input guidance",
	);
	assert(
		state.hiddenMessages.at(-1).includes("禁止手写或测试 `flow.html`"),
		"flow plan prompt should leave HTML rendering to the plugin",
	);
	assert(
		state.hiddenMessages.at(-1).includes("flow.semantic.json") &&
			state.hiddenMessages.at(-1).includes("插件会组装完整 Flow 状态"),
		"flow plan prompt missing semantic artifact rule",
	);
	assert(
		directPrompt.includes(`Flow 目录：\n${directFlowDir}`) &&
			directPrompt.includes("Flow 目录已由插件分配为裸编号 `F<N>`") &&
			directPrompt.includes("不要新建其他 Flow 目录"),
		"flow plan prompt should target only the current extension-created Flow dir",
	);
	assert(
		!directPrompt.includes("恢复的对齐问答") &&
			!directPrompt.includes("已对齐问答") &&
			!directPrompt.includes("对齐记录") &&
			!directPrompt.includes("对齐摘要") &&
			!directPrompt.includes("Q1:") &&
			!directPrompt.includes("A1:"),
		"ordinary generation prompt should not include alignment Q&A or summary",
	);
	assert(
		state.hiddenMessages.at(-1).includes("`dependsOn`") &&
			state.hiddenMessages.at(-1).includes("`writeScope`"),
		"flow plan prompt missing parallel schema fields",
	);
	assert(
		!state.hiddenMessages.at(-1).includes("flow.json 最小骨架") &&
			!state.hiddenMessages.at(-1).includes("flow.json.schemaVersion"),
		"flow plan prompt still asks model to write canonical flow.json",
	);
	assert(
		state.hiddenMessages
			.at(-1)
			.includes("`Steps` 和 `Verification` 都必须使用 checkbox") &&
			state.hiddenMessages.at(-1).includes("初始只允许 `[ ]`") &&
			state.hiddenMessages.at(-1).includes("运行时 Todo"),
		"flow plan prompt missing todo checkbox rules",
	);
	assert(
		state.hiddenMessages.at(-1).includes("2–10 个用户可理解的里程碑") &&
			state.hiddenMessages
				.at(-1)
				.includes("完成后能在 `Verification` / `Handoff` 给出证据") &&
			!state.hiddenMessages.at(-1).includes("3–12 个小步骤"),
		"flow plan prompt missing milestone step rules",
	);
	assert(
		state.widgets.at(-1)?.content,
		"flow draft generation did not show activity widget",
	);
	assert(
		latestWidgetText(state).includes("🌊 Flow · 撰写计划中") &&
			!latestWidgetText(state).includes("Q1"),
		"direct generation activity should be compact without Q&A turns",
	);
	writeFlowSemanticDraft(cwd, "F1", { title: "Login Flow" });
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		state.execs.some((item) =>
			item.args.some((arg) => String(arg).startsWith("http://127.0.0.1:")),
		),
		`flow live html not opened: ${state.notifications.join(" | ")} / ${state.hiddenMessages.at(-1)}`,
	);
	await flushScheduledGoalStart();
	assertChineseFlowCard(
		state,
		"Flow 第 1 步 · Goal 1 已启动",
		"auto-start start card missing",
	);
	assert(
		state.newSessions.length === 1,
		"auto-start did not create step session",
	);

	const file = join(cwd, "plan.md");
	writeFileSync(file, "raw md plan");
	await commands.get("flow").handler(file, ctx);
	assert(
		state.hiddenMessages.at(-1).includes("raw md plan"),
		"file content missing from hidden prompt",
	);

	writeFlowSemanticDraft(cwd, "F2", {
		title: "Invalid Flow",
		invalidMarkdown: true,
	});
	const openCountBeforeInvalidRepair = openedReportCount(state);
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		openedReportCount(state) === openCountBeforeInvalidRepair,
		"invalid flow error html should not auto-open",
	);
	for (let index = 0; index < 3; index += 1)
		await emit(handlers, "agent_end", { messages: [] }, ctx);
	const repairPrompts = state.hiddenMessages.filter((message) =>
		message.includes("当前校验错误"),
	);
	assert(repairPrompts.length >= 3, "repair did not run 3 hidden rounds");
	assert(
		!state.hiddenMessages.at(-1).includes("严格访谈") &&
			!state.hiddenMessages.at(-1).includes("持续追问"),
		"repair prompt should not use grill semantics",
	);
	assert(
		repairPrompts.every((message) => message.includes("`parallelRun`")),
		"repair prompt should forbid model-written parallelRun",
	);
	assert(
		repairPrompts.every(
			(message) =>
				message.includes("2–10 个用户可理解的里程碑") &&
				message.includes("完成后能给出证据") &&
				!message.includes("3–12 个小步骤"),
		),
		"repair prompt missing milestone step rules",
	);
}

async function generatedSummaryBareIdScenario() {
	const { startGeneration } = await importCachedModule("flow/generation.js");
	const cwd = tempDir("generate-short-id-summary");
	const state = newState(cwd);
	const { handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));

	await startGeneration(
		state.extensionApis.at(-1),
		ctx,
		"修登录",
		"prompt",
		undefined,
		{ mode: "direct", autoStart: false },
	);
	writeFlowSemanticDraft(cwd, "F1", {
		title: "Flow UI Polish",
	});
	await emit(handlers, "agent_end", { messages: [] }, ctx);

	const notice = state.notifications.at(-1) ?? "";
	assertNoticeFormat(notice, "✅", "下一步：/flow go F1");
	const html = readFileSync(join(cwd, ".flow", "F1", "flow.html"), "utf8");
	assert(
		html.includes("/flow go F1") && !html.includes("/flow status F1"),
		"generated Flow HTML commands did not only show go with bare id",
	);
	assert(
		!html.includes("F1-flow-ui-polish"),
		"generated Flow HTML used slug id",
	);
}

async function flowAutoStartUsesCommandContextScenario() {
	const cwd = tempDir("flow-autostart-command-context");
	const state = newState(cwd);
	state.staleCtxAfterSessionReplacement = true;
	const { commands, handlers } = await loadExtension(state);
	const sessionFile = join(cwd, "planning.jsonl");
	const commandCtx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("auto start from event", commandCtx);
	writeFlowSemanticDraft(cwd, "F1", { title: "Auto Start" });
	const eventCtx = commandContext(state, cwd, sessionFile);
	eventCtx.newSession = undefined;
	await emit(handlers, "agent_end", { messages: [] }, eventCtx);
	await flushScheduledGoalStart();
	const flow = readFlow(join(cwd, ".flow", "F1"));
	assert(flow.status === "running", "flow auto-start ignored command context");
	assert(
		state.newSessions.length === 1,
		"flow auto-start did not create session",
	);
	assertChineseFlowCard(
		state,
		"Flow 第 1 步 · Goal 1 已启动",
		"flow auto-start did not show start card",
	);
	const startCardIndex = state.customMessages.findIndex(
		(item) => item.message.details?.title === "Flow 第 1 步 · Goal 1 已启动",
	);
	const goalPromptIndex = state.customMessages.findIndex(
		(item) =>
			item.message.customType === "pi-flow-goal-prompt" &&
			String(item.message.content).includes("只执行当前 Goal"),
	);
	assert(goalPromptIndex >= 0, "flow auto-start goal prompt missing");
	assert(
		startCardIndex < goalPromptIndex,
		"flow auto-start card should be sent before the Goal prompt that triggers tool output",
	);
	assert(
		!state.notifications.some((message) => message.includes("不支持新建会话")),
		state.notifications.join("\n"),
	);
}

async function flowAutoStartWithoutCommandContextStaysDraftScenario() {
	const cwd = tempDir("flow-autostart-no-command-context");
	const sessionFile = join(cwd, "agent-event.jsonl");
	writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "generating",
		sessionFile,
		autoStart: true,
		originalRequest: "recovered without command context",
	});
	writeFlowSemanticDraft(cwd, "F1", { title: "No Command Context" });
	const state = newState(cwd);
	const { handlers } = await loadExtension(state);
	const eventCtx = commandContext(state, cwd, sessionFile);
	eventCtx.newSession = undefined;
	await emit(handlers, "agent_end", { messages: [] }, eventCtx);
	await flushScheduledGoalStart();
	const flow = readFlow(join(cwd, ".flow", "F1"));
	const notice = state.notifications.at(-1) ?? "";
	assert(
		flow.status === "draft" && state.newSessions.length === 0,
		`auto-start without command context did not stay draft: ${notice}`,
	);
	assertNoticeFormat(notice, "⚠️", "/flow go F1");
	assert(
		!notice.includes("不支持新建会话"),
		`auto-start notice used runtime unsupported copy: ${notice}`,
	);
}

async function flowHandwrittenRejectedScenario() {
	const cwd = tempDir("flow-handwritten-rejected");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("handwritten only", ctx);
	createFlow(cwd, "F1");
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		state.notifications.at(-1).includes("AI 未生成有效 Flow 计划"),
		"handwritten flow.json was not rejected as missing semantic draft",
	);
	assert(
		!state.notifications.some((message) => message.includes("Flow 计划已生成")),
		"handwritten flow.json was accepted as generated Flow",
	);
	assert(state.newSessions.length === 0, "handwritten flow auto-started");
}

async function semanticFlowGenerationEndScenario() {
	const { validateFlowDir } = await importModule("flow/validator.js");
	const cwd = tempDir("flow-semantic-generation-end");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("ship semantic only", ctx);
	const dir = writeFlowSemanticDraft(cwd, "F1", {
		title: "Semantic Only",
	});
	const semantic = JSON.parse(
		readFileSync(join(dir, "flow.semantic.json"), "utf8"),
	);
	semantic.goals[0].writeScope = ["src/api/**"];
	semantic.goals[1].dependsOn = [0];
	writeFileSync(
		join(dir, "flow.semantic.json"),
		`${JSON.stringify(semantic, null, 2)}\n`,
	);
	const preDraft = readFlow(dir);
	const alignment = JSON.parse(
		readFileSync(join(dir, "alignment.json"), "utf8"),
	);
	assert(
		preDraft.status === "generating" &&
			preDraft.goals.length === 0 &&
			!("alignmentTurns" in preDraft) &&
			alignment.stage === "generating" &&
			alignment.sessionFile === ctx.sessionManager.getSessionFile(),
		"semantic setup did not persist pre-draft state correctly",
	);
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(readFlow(dir).status === "running", "semantic flow did not start");
	assert(
		!existsSync(join(dir, "alignment.json")),
		"generated flow kept alignment.json",
	);
	const validation = validateFlowDir(dir);
	assert(
		validation.ok,
		`semantic flow build invalid: ${validation.errors.join("\n")}`,
	);
	const flow = readFlow(dir);
	assert(flow.parallelRun === null, "semantic flow missing parallelRun null");
	assert(
		flow.goals[0].writeScope?.[0] === "src/api/**" &&
			flow.goals[1].dependsOn?.[0] === 0,
		"semantic parallel fields were not preserved",
	);
	assert(
		!("dependsOn" in flow.goals[0]) && !("writeScope" in flow.goals[1]),
		"builder wrote absent parallel fields into flow goals",
	);
}

async function flowSemanticOverridesHandwrittenScenario() {
	const cwd = tempDir("flow-semantic-overrides");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("ship semantic", ctx);
	const preDraftCreatedAt = readFlow(join(cwd, ".flow", "F1")).createdAt;
	const dir = createFlow(cwd, "F1");
	const handwritten = readFlow(dir);
	writeFlow(dir, {
		...handwritten,
		title: "Handwritten",
		source: {
			type: "file",
			path: "/model/source",
			originalRequest: "model source",
		},
	});
	writeFlowSemantic(dir, "Semantic Wins", {
		source: {
			type: "file",
			path: "/semantic/source",
			originalRequest: "semantic source",
		},
		goals: handwritten.goals,
	});
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	const flow = readFlow(dir);
	assert(
		flow.title === "Semantic Wins",
		"semantic draft did not overwrite flow.json",
	);
	assert(
		flow.source.originalRequest === "ship semantic" &&
			flow.source.type === "prompt" &&
			flow.source.path === null &&
			flow.createdAt === preDraftCreatedAt,
		"semantic flow trusted handwritten or semantic source",
	);
}

async function malformedCurrentFlowSemanticKeepsRepairingScenario() {
	const cwd = tempDir("flow-semantic-current-malformed");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("ship malformed semantic", ctx);
	const dir = writeFlowSemanticDraft(cwd, "F1", {
		title: "Broken Semantic",
		invalidMarkdown: true,
	});
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		state.hiddenMessages.at(-1).includes("当前校验错误"),
		"invalid semantic Flow did not trigger repair prompt",
	);
	writeFileSync(join(dir, "flow.semantic.json"), "{");
	writeFileSync(join(dir, "G1-plan.md"), planMarkdown(1, false));
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		!state.notifications.some((message) => message.includes("Flow 计划已生成")),
		"malformed current semantic accepted stale flow.json",
	);
	assert(
		state.hiddenMessages.at(-1).includes("Flow 计划草稿组装失败"),
		"malformed current semantic did not keep repair prompt active",
	);
}

async function missingFlowSemanticTitleKeepsRepairingScenario() {
	const cwd = tempDir("flow-semantic-missing-title");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("ship missing title", ctx);
	const dir = writeFlowSemanticDraft(cwd, "F1", {
		title: "Initial Title",
		invalidMarkdown: true,
	});
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	const staleFlow = readFlow(dir);
	writeFileSync(join(dir, "G1-plan.md"), planMarkdown(1, false));
	writeFlowSemantic(dir, undefined, { goals: staleFlow.goals });
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		state.hiddenMessages
			.at(-1)
			.includes("flow.semantic.json.title 必须是非空字符串"),
		"missing semantic title did not trigger repair prompt",
	);
	assert(
		readFlow(dir).title !== "untitled",
		"missing semantic title silently became untitled",
	);
}

async function flowClarificationScenario() {
	const cwd = tempDir("flow-need-input");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("needs flow detail", ctx);
	await emit(
		handlers,
		"agent_end",
		{
			messages: [
				{ role: "assistant", content: "请补充。\n<!-- pi-flow:need-input -->" },
			],
		},
		ctx,
	);
	const inputResult = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "拆成两个文档 Goal" },
		ctx,
	);
	assert(
		inputResult?.action === "handled",
		"flow clarification should be handled after echoing visible input",
	);
	assert(
		state.customMessages.some(
			(item) =>
				item.message.display === true &&
				item.message.content === "拆成两个文档 Goal",
		),
		"flow clarification should keep user message visible",
	);
	assert(
		state.hiddenMessages.at(-1).includes("拆成两个文档 Goal") &&
			state.hiddenMessages.at(-1).includes("生成可恢复的多会话 Goal 队列"),
		"flow blocking input did not resend hidden plan prompt",
	);
	assert(
		state.sentMessages.length === 0,
		"flow blocking input leaked plan prompt into visible messages",
	);
}

async function flowContinueDraftStartsScenario() {
	const cwd = tempDir("flow-continue-draft-starts");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go F1", ctx);
	await flushScheduledGoalStart();
	const flow = readFlow(dir);
	assert(
		flow.status === "running" &&
			flow.goals[0].status === "running" &&
			state.newSessions.length === 1,
		"/flow go F1 did not start a draft Flow",
	);

	const pausedCwd = tempDir("flow-continue-paused-draft-starts");
	const pausedDir = createFlow(pausedCwd, "F1");
	writeFlow(pausedDir, { ...readFlow(pausedDir), status: "paused" });
	const pausedState = newState(pausedCwd);
	const { commands: pausedCommands } = await loadExtension(pausedState);
	const pausedCtx = commandContext(
		pausedState,
		pausedCwd,
		join(pausedCwd, "planning.jsonl"),
	);
	await pausedCommands.get("flow").handler("go F1", pausedCtx);
	await flushScheduledGoalStart();
	const pausedFlow = readFlow(pausedDir);
	assert(
		pausedFlow.status === "running" && pausedState.newSessions.length === 1,
		"/flow go F1 did not start a paused unstarted Flow",
	);

	const completeCwd = tempDir("flow-go-complete-idempotent");
	const completeDir = createFlow(completeCwd, "F1");
	const completeFlow = readFlow(completeDir);
	writeFlow(completeDir, {
		...completeFlow,
		status: "complete",
		startedAt: Date.now(),
		goals: completeFlow.goals.map((goal) => ({
			...goal,
			status: "complete",
		})),
	});
	const completeState = newState(completeCwd);
	const { commands: completeCommands } = await loadExtension(completeState);
	await completeCommands
		.get("flow")
		.handler(
			"go F1",
			commandContext(
				completeState,
				completeCwd,
				join(completeCwd, "planning.jsonl"),
			),
		);
	assert(
		readFlow(completeDir).status === "complete" &&
			completeState.newSessions.length === 0,
		"/flow go F1 should be idempotent for a complete Flow",
	);
	assertNoticeFormat(completeState.notifications.at(-1), "✅", "网页报告:");
}

async function flowStopDraftGoScenario() {
	const cwd = tempDir("flow-stop-draft-go");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("stop F1", ctx);
	let flow = readFlow(dir);
	assert(flow.status === "paused", "draft stop did not pause Flow");
	assert(flow.startedAt === null, "draft stop changed startedAt");
	assertNoticeFormat(state.notifications.at(-1), "⚠️", "运行 /flow go F1 继续");
	await commands.get("flow").handler("go F1", ctx);
	await flushScheduledGoalStart();
	flow = readFlow(dir);
	assert(
		flow.status === "running" && state.newSessions.length === 1,
		"go did not start a stopped draft Flow",
	);

	const completeCwd = tempDir("flow-stop-complete");
	const completeDir = createFlow(completeCwd, "F1");
	const completeFlow = readFlow(completeDir);
	writeFlow(completeDir, {
		...completeFlow,
		status: "complete",
		startedAt: Date.now(),
		goals: completeFlow.goals.map((goal) => ({ ...goal, status: "complete" })),
	});
	const completeState = newState(completeCwd);
	const { commands: completeCommands } = await loadExtension(completeState);
	await completeCommands
		.get("flow")
		.handler(
			"stop F1",
			commandContext(
				completeState,
				completeCwd,
				join(completeCwd, "planning.jsonl"),
			),
		);
	assert(
		readFlow(completeDir).status === "complete" &&
			completeState.newSessions.length === 0,
		"stop should not change a complete Flow",
	);
	assertNoticeFormat(completeState.notifications.at(-1), "✅", "无需暂停");
}

async function flowReportServerSurvivesSessionShutdownScenario() {
	const cwd = tempDir("flow-report-survives-shutdown");
	createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("status F1", ctx);
	const statusMessage = state.notifications.find((item) =>
		item.includes("🌐 网页报告: http://127.0.0.1:"),
	);
	const url = statusMessage?.match(
		/http:\/\/127\.0\.0\.1:\d+\/\S+?(?=:(?:info|warning|error)$|\s|$)/u,
	)?.[0];
	assert(url, `missing report URL: ${state.notifications.join(" | ")}`);
	const flowHtml = join(cwd, ".flow", "F1", "flow.html");
	assert(existsSync(flowHtml), `flow html missing: ${flowHtml}`);
	const before = await fetch(url).then((response) => response.text());
	assert(
		before.includes("Test Flow"),
		`report not served before session shutdown at ${url}: ${before.slice(0, 120)}`,
	);
	await emit(handlers, "session_shutdown", {}, ctx);
	const after = await fetch(url).then((response) => response.text());
	assert(
		after.includes("Test Flow"),
		`session shutdown closed the live report server: ${after.slice(0, 120)}`,
	);
}

async function flowSessionStartRebindsReportStatusScenario() {
	const cwd = tempDir("flow-session-start-report-status");
	const dir = createFlow(cwd, "F1");
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFileSync(sessionFile, "");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	flow.goals[0].sessionFile = sessionFile;
	writeFlow(dir, flow);
	const { writeFlowHtml } = await importModule("flow/html.js");
	writeFlowHtml(dir, flow);
	const state = newState(cwd);
	const { handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await emit(handlers, "session_start", { reason: "resume" }, ctx);
	assert(
		state.statuses.some((item) =>
			String(item).startsWith("🌐 网页报告: http://127.0.0.1:"),
		),
		"flow session_start did not expose live report status",
	);
}

async function flowRepairSendFailureClearsPendingScenario() {
	const cwd = tempDir("flow-repair-send-failure");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("make broken flow", ctx);
	writeFlowSemanticDraft(cwd, "F1", { invalidMarkdown: true });
	state.failSend = true;
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assertNoticeFormat(state.notifications.at(-1), "❌", "busy");
	const flow = readFlow(join(cwd, ".flow", "F1"));
	const alignment = JSON.parse(
		readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
	);
	assert(
		flow.status === "generating" &&
			flow.errors.includes("Flow 计划修复提示发送失败") &&
			alignment.stage === "generating",
		"failed repair prompt should keep recoverable generation state",
	);
	state.failSend = false;
	const hiddenBeforeSecond = state.hiddenMessages.length;
	await commands.get("flow").handler("second flow", ctx);
	assert(
		state.hiddenMessages.length === hiddenBeforeSecond &&
			state.notifications.at(-1).includes("未完成的 Flow 计划生成"),
		"failed repair prompt should keep current session locked to the recoverable Flow",
	);
	await commands.get("flow").handler("go F1", ctx);
	assert(
		state.hiddenMessages.at(-1).includes("当前校验错误") &&
			state.hiddenMessages.at(-1).includes("Flow 计划修复提示发送失败") &&
			!state.notifications.at(-1).includes("Flow 未在运行"),
		"/flow go did not recover a repair prompt send failure",
	);
}

async function flowClarificationSendFailureClearsPendingScenario() {
	const cwd = tempDir("flow-need-input-send-failure");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("needs more flow detail", ctx);
	await emit(
		handlers,
		"agent_end",
		{
			messages: [
				{ role: "assistant", content: "请补充。\n<!-- pi-flow:need-input -->" },
			],
		},
		ctx,
	);
	state.failSend = true;
	await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "拆成两个阶段" },
		ctx,
	);
	assertNoticeFormat(state.notifications.at(-1), "❌", "busy");
	const flow = readFlow(join(cwd, ".flow", "F1"));
	const alignment = JSON.parse(
		readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
	);
	assert(
		flow.status === "generating" &&
			flow.source.originalRequest.includes("拆成两个阶段") &&
			flow.errors.includes("Flow 计划澄清提示发送失败") &&
			alignment.stage === "generating",
		"failed clarification prompt should keep recoverable generation state",
	);
	state.failSend = false;
	const hiddenBeforeSecond = state.hiddenMessages.length;
	await commands.get("flow").handler("second flow", ctx);
	assert(
		state.hiddenMessages.length === hiddenBeforeSecond &&
			state.notifications.at(-1).includes("未完成的 Flow 计划生成"),
		"failed flow clarification prompt should keep current session locked to the recoverable Flow",
	);
}

async function preDraftGenerationScenario() {
	const cwd = tempDir("predraft-generation");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctxA = commandContext(state, cwd, join(cwd, "a.jsonl"));
	await commands.get("flow").handler("A request", ctxA);
	await commands.get("flow").handler("A second request", ctxA);
	assert(
		state.notifications.at(-1).includes("未完成的 Flow 计划生成"),
		"second same-session generation was not rejected",
	);
	assert(state.hiddenMessages.length === 1, "rejected generation sent prompt");
	const ctxB = commandContext(state, cwd, join(cwd, "b.jsonl"));
	await commands.get("flow").handler("B request", ctxB);
	assert(
		state.hiddenMessages.length === 2,
		"different session generation should get its own Flow",
	);
	const dir = writeFlowSemanticDraft(cwd, "F1");
	await emit(handlers, "agent_end", { messages: [] }, ctxB);
	const waitingFlow = readFlow(dir);
	const otherFlow = readFlow(join(cwd, ".flow", "F2"));
	assert(
		waitingFlow.status === "generating" &&
			waitingFlow.goals.length === 0 &&
			otherFlow.status === "generating" &&
			otherFlow.errors.includes("AI 未生成有效 Flow 计划"),
		"wrong session consumed pre-draft generation",
	);
	await emit(handlers, "agent_end", { messages: [] }, ctxA);
	await flushScheduledGoalStart();
	const flow = readFlow(dir);
	assert(
		flow.status === "running",
		"owning session did not consume pre-draft generation",
	);
	assert(
		state.newSessions.length === 1,
		"owning generation did not auto-start",
	);
	assertChineseFlowCard(
		state,
		"Flow 第 1 步 · Goal 1 已启动",
		"owning generation did not show start card",
	);
}

async function englishFlowGeneratedSummaryUsesArtifactLanguageScenario() {
	const language = await importCachedModule("shared/language.js");
	const originalLanguage = process.env.PI_FLOW_LANGUAGE;
	process.env.PI_FLOW_LANGUAGE = "en";
	language.resetRuntimeLanguageForTests();
	try {
		const cwd = tempDir("flow-english-generated-summary");
		const state = newState(cwd);
		const { commands, handlers } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		await commands.get("flow").handler("English flow request", ctx);
		writeFlowSemanticDraft(cwd, "F1", {
			title: "English Flow",
		});
		await emit(handlers, "agent_end", { messages: [] }, ctx);
		await flushScheduledGoalStart();
		assertFlowCard(
			state,
			"Flow Step 1 · Goal 1 started",
			"English Flow start card was translated by artifact language",
		);
	} finally {
		if (originalLanguage === undefined) delete process.env.PI_FLOW_LANGUAGE;
		else process.env.PI_FLOW_LANGUAGE = originalLanguage;
		language.resetRuntimeLanguageForTests();
	}
}

async function flowGoalSendFailureRollsBackScenario() {
	const cwd = tempDir("flow-goal-send-failure");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	state.failSend = true;
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", ctx);
	await flushScheduledGoalStart();
	const flow = readFlow(dir);
	assert(flow.status === "draft", "failed Flow goal start left flow running");
	assert(
		flow.goals[0].sessionFile === null,
		"failed Flow goal start kept sessionFile",
	);
}

async function flowStartPromptSkipsAfterStopScenario() {
	const { prepareGoalStart, startPreparedGoal } = await importModule(
		"flow/execution/start.js",
	);
	const cwd = tempDir("flow-start-stop-before-prompt");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "goal-session.jsonl"));
	const original = readFlow(dir);
	const prepared = prepareGoalStart(ctx, dir, original, 0);
	writeFlow(dir, { ...prepared, status: "paused" });
	await startPreparedGoal(ctx, dir, original, prepared, 0);
	const flow = readFlow(dir);
	assert(flow.status === "paused", "stop before prompt was overwritten");
	assert(state.hiddenMessages.length === 0, "prompt was sent after stop");
	assert(
		!state.customMessages.some((item) =>
			String(item.message.details?.title ?? "").includes("已启动"),
		),
		"start card was sent after stop",
	);
}

async function flowGenerationStopIgnoresLatePromptScenario() {
	const cwd = tempDir("flow-generation-stop-late-prompt");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("stopped generation prompt", ctx);
	const hiddenBefore = state.hiddenMessages.length;
	await commands.get("flow").handler("stop F1", ctx);
	const stopped = readFlow(join(cwd, ".flow", "F1"));
	assert(
		stopped.status === "paused",
		`pre-draft stop did not pause: status=${stopped.status} notice=${state.notifications.at(-1)}`,
	);
	writeFlowSemanticDraft(cwd, "F1", { title: "Late Stopped Draft" });
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	const flow = readFlow(join(cwd, ".flow", "F1"));
	assert(
		flow.status === "paused" &&
			flow.goals.length === 0 &&
			state.hiddenMessages.length === hiddenBefore,
		`stopped generation prompt was processed after stop: status=${flow.status} goals=${flow.goals.length} hidden=${state.hiddenMessages.length}/${hiddenBefore}`,
	);
}

async function flowPreDraftStopGoScenario() {
	const cwd = tempDir("flow-predraft-stop-go");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	state.idle = false;
	await commands.get("flow").handler("generate then stop", ctx);
	const dir = join(cwd, ".flow", "F1");
	const hiddenBeforeStop = state.hiddenMessages.length;
	await commands.get("flow").handler("stop F1", ctx);
	let flow = readFlow(dir);
	let alignment = JSON.parse(readFileSync(join(dir, "alignment.json"), "utf8"));
	assert(flow.status === "paused", "pre-draft stop did not pause Flow");
	assert(state.aborts === 1, "pre-draft stop did not abort current turn");
	assert(
		alignment.stage === "generating" &&
			alignment.sessionFile === ctx.sessionManager.getSessionFile() &&
			alignment.autoStart === true,
		"pre-draft stop changed alignment checkpoint",
	);

	writeFlowSemanticDraft(cwd, "F1", { title: "Late stopped draft" });
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	flow = readFlow(dir);
	assert(
		flow.status === "paused" && flow.goals.length === 0,
		"late generation result changed a stopped pre-draft Flow",
	);

	state.idle = true;
	await commands.get("flow").handler("go F1", ctx);
	flow = readFlow(dir);
	alignment = JSON.parse(readFileSync(join(dir, "alignment.json"), "utf8"));
	assert(flow.status === "generating", "go did not recover stopped generation");
	assert(alignment.stage === "generating", "go changed generation stage");
	assert(
		state.hiddenMessages.length === hiddenBeforeStop + 1,
		"go did not send a fresh generation prompt",
	);
	assert(
		!existsSync(join(dir, "flow.semantic.json")) &&
			!existsSync(join(dir, "G1-plan.md")),
		"go kept stale stopped generation artifacts",
	);
}

async function flowSequentialStopGoScenario() {
	const cwd = tempDir("flow-sequential-stop-go");
	const dir = createFlow(cwd, "F1", { planCount: 3 });
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go F1", ctx);
	await flushScheduledGoalStart();
	const goalCtx = state.activeCtx;
	const sessionFile = goalCtx.sessionManager.getSessionFile();
	state.idle = false;
	await commands.get("flow").handler("stop F1", goalCtx);
	let flow = readFlow(dir);
	assert(flow.status === "paused", "running stop did not pause Flow");
	assert(
		flow.goals[0].status === "running",
		"running stop reset sequential Goal",
	);
	assert(state.aborts === 1, "running stop did not abort current Goal turn");
	assert(
		latestGoalState(state, sessionFile)?.status === "paused",
		"running stop did not pause Goal runtime",
	);

	entriesFor(state, sessionFile).push(completionEntry(sessionFile));
	await emit(handlers, "agent_end", { messages: [] }, goalCtx);
	flow = readFlow(dir);
	assert(
		flow.status === "paused" && flow.goals[0].status === "running",
		"late completion changed a paused Flow",
	);

	state.idle = true;
	await commands.get("flow").handler("go F1", goalCtx);
	flow = readFlow(dir);
	assert(flow.status === "running", "go did not mark stopped Flow running");
	assert(
		latestGoalState(state, sessionFile)?.status === "active",
		"go did not resume stopped Goal runtime",
	);
	await emit(handlers, "agent_end", { messages: [] }, goalCtx);
	flow = readFlow(dir);
	assert(
		flow.currentGoal === 0 && flow.goals[0].status === "running",
		"old completion fact was consumed after stop/go resume",
	);
}

async function flowStopConsumesQueuedContinuationPromptScenario() {
	const cwd = tempDir("flow-stop-consumes-continuation");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go F1", ctx);
	await flushScheduledGoalStart();
	const goalCtx = state.activeCtx;
	const hiddenBefore = state.hiddenMessages.length;
	await emit(handlers, "agent_end", { messages: [] }, goalCtx);
	const queuedPrompt = state.hiddenMessages.at(-1) ?? "";
	assert(
		state.hiddenMessages.length === hiddenBefore + 1 &&
			queuedPrompt.includes("pi-goal-continuation"),
		"continuation prompt was not queued",
	);
	await commands.get("flow").handler("stop F1", ctx);
	const inputResults = [];
	for (const handler of handlers.get("input") ?? [])
		inputResults.push(
			await handler(
				{ source: "extension", text: queuedPrompt },
				state.activeCtx,
			),
		);
	const flow = readFlow(dir);
	assert(
		flow.status === "paused" &&
			inputResults.some((result) => result?.action === "handled"),
		`queued continuation prompt was not consumed after stop: status=${flow.status} results=${JSON.stringify(inputResults)}`,
	);
}

async function flowStartPromptSurvivesSessionNameSyncScenario() {
	const cwd = tempDir("flow-start-session-name-before-prompt");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", ctx);
	assert(
		state.hiddenMessages.length === 1,
		"start returned before sending first prompt",
	);
	await emit(
		handlers,
		"session_info_changed",
		{ name: "Renamed before prompt" },
		state.activeCtx,
	);
	await flushScheduledGoalStart();
	const flow = readFlow(dir);
	assert(flow.status === "running", "flow did not remain running");
	assert(
		flow.goals[0].sessionName === "Renamed before prompt",
		"session name sync did not apply before prompt",
	);
	assert(
		state.hiddenMessages.length === 1,
		"prompt was lost after session rename",
	);
	assert(
		state.customMessages.filter((item) =>
			String(item.message.details?.title ?? "").includes("已启动"),
		).length === 1,
		"start prompt after session rename duplicated start card",
	);
}

async function flowStartSessionNameDoesNotSelfReportBusyScenario() {
	const cwd = tempDir("flow-start-session-name-self-event");
	createFlow(cwd, "F1");
	const state = newState(cwd);
	state.sessionNameTriggersEvent = true;
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", ctx);
	await flushScheduledGoalStart();
	assert(
		!state.notifications.some(
			(item) =>
				item.includes("会话名同步失败") || item.includes("Flow 正在处理"),
		),
		`session name self event reported busy: ${state.notifications.join(" | ")}`,
	);
	assert(
		state.hiddenMessages.length === 1,
		"self event prevented prompt start",
	);
}

async function flowRollbackUsesSchedulingLockScenario() {
	const { acquireFlowLock } = await importModule("flow/lock.js");
	const { prepareGoalStart, rollbackPreparedGoalStart } = await importModule(
		"flow/execution/start.js",
	);
	const cwd = tempDir("flow-rollback-lock");
	const dir = createFlow(cwd, "F1");
	const original = readFlow(dir);
	const state = newState(cwd);
	await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "goal-session.jsonl"));
	const prepared = prepareGoalStart(ctx, dir, original, 0);
	const lock = acquireFlowLock(dir, "other scheduling transaction");
	assert(lock.ok, "rollback lock was not acquired");
	try {
		await rollbackPreparedGoalStart(ctx, dir, original, prepared);
		const busy = readFlow(dir);
		assert(busy.status === "running", "busy rollback overwrote flow");
		assert(
			state.notifications.some((item) => item.includes("Flow 正在处理")),
			"busy rollback did not notify user",
		);
		lock.release();
		await rollbackPreparedGoalStart(ctx, dir, original, prepared);
		const rolledBack = readFlow(dir);
		assert(
			rolledBack.status === "draft",
			"locked rollback did not restore flow",
		);
	} finally {
		if (lock.ok) lock.release();
	}
}

async function flowRollbackPreservesConcurrentSessionNameScenario() {
	const { prepareGoalStart, rollbackPreparedGoalStart } = await importModule(
		"flow/execution/start.js",
	);
	const cwd = tempDir("flow-rollback-session-name");
	const dir = createFlow(cwd, "F1");
	const original = readFlow(dir);
	const state = newState(cwd);
	await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "goal-session.jsonl"));
	const prepared = prepareGoalStart(ctx, dir, original, 0);
	const renamed = readFlow(dir);
	renamed.goals[0].sessionName = "Renamed";
	writeFlow(dir, renamed);
	await rollbackPreparedGoalStart(ctx, dir, original, prepared);
	const flow = readFlow(dir);
	assert(flow.status === "running", "rollback overwrote renamed flow status");
	assert(
		flow.goals[0].sessionName === "Renamed",
		"rollback overwrote concurrent session name",
	);
}

async function verifyCurrentSnapshotUsesLatestFlowScenario() {
	const { verifyCurrentSnapshot } = await importModule(
		"flow/execution/shared.js",
	);
	const { planSnapshotHash } = await importModule("flow/snapshot.js");
	const cwd = tempDir("flow-verify-latest-snapshot");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "goal-session.jsonl"));
	const stale = readFlow(dir);
	const snapshot = readFileSync(join(dir, stale.goals[0].file), "utf8");
	stale.status = "running";
	stale.startedAt = Date.now();
	stale.goals[0].status = "running";
	stale.goals[0].sessionFile = join(cwd, "goal-session.jsonl");
	stale.goals[0].snapshot = snapshot;
	stale.goals[0].snapshotHash = planSnapshotHash(snapshot);
	writeFlow(dir, stale);
	writeFileSync(join(dir, stale.goals[0].file), `${snapshot}\nchanged\n`);
	const latest = readFlow(dir);
	latest.status = "complete";
	latest.goals[0].status = "complete";
	latest.errors = [];
	writeFlow(dir, latest);
	verifyCurrentSnapshot(ctx, dir, stale);
	const flow = readFlow(dir);
	assert(
		flow.status === "complete",
		"snapshot verify overwrote latest flow status with stale state",
	);
	assert(
		flow.errors.length === 0,
		"snapshot verify wrote stale snapshot error",
	);
}

async function completionWithEventCommandContextScenario() {
	const { planSnapshotHash } = await importModule("plan/snapshot.js");
	const cwd = tempDir("completion-event-command-context");
	const dir = createFlow(cwd, "F1", { planCount: 3 });
	const state = newState(cwd);
	const { handlers } = await loadExtension(state);
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFileSync(sessionFile, "");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	flow.goals[0].sessionFile = sessionFile;
	flow.goals[0].snapshot = readFileSync(join(dir, flow.goals[0].file), "utf8");
	flow.goals[0].snapshotHash = planSnapshotHash(flow.goals[0].snapshot);
	writeFlow(dir, flow);
	const ctx = commandContext(state, cwd, sessionFile);
	entriesFor(state, sessionFile).push(completionEntry(sessionFile));
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	await flushScheduledGoalStart();
	const completeNotice = state.notifications.find((message) =>
		message.includes("Flow 第 1 步 · Goal 1 已完成"),
	);
	assertNoticeFormat(completeNotice, "✅", "编号：F1");
	const saved = readFlow(dir);
	assert(saved.currentGoal === 1, "flow did not advance with event context");
	assert(saved.goals[0].status === "complete", "completed goal not recorded");
	assert(
		saved.goals[1].status === "running",
		"next goal did not start from event command context",
	);
	assert(
		state.newSessions.length === 1,
		"new session not started from event command context",
	);
	assert(
		state.statuses.some((item) =>
			String(item).startsWith("🌐 网页报告: http://127.0.0.1:"),
		),
		"next Flow session did not expose live report status",
	);
	assert(
		!state.customMessages.some(
			(item) => item.message.details?.title === "Flow 第 2 步 · Goal 2 已就绪",
		),
		"continue-required card shown despite event command context",
	);
}

async function completionWithoutRememberedContextScenario() {
	const { planSnapshotHash } = await importModule("plan/snapshot.js");
	const cwd = tempDir("completion-no-remembered-context");
	const dir = createFlow(cwd, "F1", { planCount: 3 });
	const state = newState(cwd);
	const { handlers } = await loadExtension(state);
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFileSync(sessionFile, "");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	flow.goals[0].sessionFile = sessionFile;
	flow.goals[0].snapshot = readFileSync(join(dir, flow.goals[0].file), "utf8");
	flow.goals[0].snapshotHash = planSnapshotHash(flow.goals[0].snapshot);
	writeFlow(dir, flow);
	const ctx = commandContext(state, cwd, sessionFile);
	ctx.newSession = undefined;
	entriesFor(state, sessionFile).push(completionEntry(sessionFile));
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	const saved = readFlow(dir);
	assert(saved.currentGoal === 1, "flow did not advance without context");
	assert(saved.goals[0].status === "complete", "completed goal not recorded");
	assert(
		saved.goals[1].status === "pending",
		"next goal started without command context",
	);
	assert(
		state.newSessions.length === 0,
		"new session started without command context",
	);
	const continueNotice = state.notifications.find((item) =>
		item.includes("Flow 已更新"),
	);
	assertNoticeFormat(continueNotice, "⚠️", "运行 /flow go F1 推进下一步");
	const continueCard = state.customMessages.find(
		(item) => item.message.details?.title === "Flow 第 2 步 · Goal 2 已就绪",
	);
	assert(
		continueCard?.message.content.includes("/flow go F1"),
		"missing continue-required card with bare id",
	);
}

async function stuckRefactorBContinueScenario() {
	const { planSnapshotHash } = await importModule("plan/snapshot.js");
	const cwd = tempDir("stuck-refactor-b-continue");
	const dir = createFlow(cwd, "F1", { planCount: 5 });
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const sessionFile = join(cwd, "step2.jsonl");
	writeFileSync(sessionFile, "");
	writeFileSync(join(dir, "G2-goal-review.md"), planMarkdown(2, false));
	const flow = readFlow(dir);
	flow.title = "把重构清单里的 B 类大文件拆干净";
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.goals[0].status = "complete";
	flow.goals[1].title = "审查逻辑拆模块并统一截断";
	flow.goals[1].file = "G2-goal-review.md";
	flow.goals[1].status = "running";
	flow.goals[1].sessionFile = sessionFile;
	flow.goals[1].snapshot = readFileSync(join(dir, "G2-goal-review.md"), "utf8");
	flow.goals[1].snapshotHash = planSnapshotHash(flow.goals[1].snapshot);
	flow.goals[1].checks = stuckRefactorBChecks();
	writeFlow(dir, flow);
	entriesFor(state, sessionFile).push(
		stuckRefactorBCompletionEntry(sessionFile),
	);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("go", ctx);
	await flushScheduledGoalStart();
	const saved = readFlow(dir);
	assert(saved.currentGoal === 2, "stuck refactor-b did not advance");
	assert(
		saved.goals[1].status === "complete",
		"stuck refactor-b goal2 not complete",
	);
	assert(
		saved.goals[1].goalId === "18876eaa-67cf-4fc3-a153-4a1294c92d37",
		"stuck refactor-b goalId not restored",
	);
	assert(
		saved.goals[1].checks.quality.active === null,
		"stuck refactor-b quality active not settled",
	);
	assert(
		saved.goals[2].status === "running",
		"stuck refactor-b goal3 not started",
	);
	assert(
		state.notifications.some((message) =>
			message.includes("Flow 第 2 步 · 审查逻辑拆模块并统一截断 已完成"),
		),
		"stuck refactor-b completion notification missing",
	);
}

async function completionEventUsesRememberedCommandContextScenario() {
	const cwd = tempDir("completion-remembered-command-context");
	const dir = createFlow(cwd, "F1", { planCount: 3 });
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const planCtx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", planCtx);
	await flushScheduledGoalStart();
	const started = readFlow(dir);
	const sessionFile = started.goals[0].sessionFile;
	const eventCtx = commandContext(state, cwd, sessionFile);
	eventCtx.newSession = undefined;
	entriesFor(state, sessionFile).push(completionEntry(sessionFile));
	await emit(handlers, "agent_end", { messages: [] }, eventCtx);
	await flushScheduledGoalStart();
	const saved = readFlow(dir);
	assert(saved.currentGoal === 1, "remembered context did not advance flow");
	assert(
		saved.goals[0].status === "complete",
		"remembered context missed completion",
	);
	assert(
		saved.goals[1].status === "running",
		"remembered context did not start next",
	);
	assert(
		state.newSessions.length === 2,
		"remembered context skipped next session",
	);
}

async function completionEmitUsesEmittedContextScenario() {
	const { planSnapshotHash } = await importModule("plan/snapshot.js");
	const { emitFlowGoalCompleted } =
		await importCachedModule("flow/completion.js");
	const cwd = tempDir("completion-emitted-context");
	const dir = createFlow(cwd, "F1", { planCount: 3 });
	const state = newState(cwd);
	await loadExtension(state);
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFileSync(sessionFile, "");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	flow.goals[0].sessionFile = sessionFile;
	flow.goals[0].snapshot = readFileSync(join(dir, flow.goals[0].file), "utf8");
	flow.goals[0].snapshotHash = planSnapshotHash(flow.goals[0].snapshot);
	writeFlow(dir, flow);
	const ctx = commandContext(state, cwd, sessionFile);
	emitFlowGoalCompleted(completionEntry(sessionFile).data, ctx);
	await flushScheduledGoalStart();
	const saved = readFlow(dir);
	assert(saved.currentGoal === 1, "emitted context did not advance flow");
	assert(
		saved.goals[0].status === "complete",
		"emitted context missed completion",
	);
	assert(
		saved.goals[1].status === "running",
		"emitted context did not start next",
	);
	assert(
		state.newSessions.length === 1,
		"emitted context skipped next session",
	);
}

async function completionCommandConsumesStoredFactScenario() {
	for (const command of ["go"]) {
		const { planSnapshotHash } = await importModule("plan/snapshot.js");
		const cwd = tempDir(`completion-command-${command}`);
		const dir = createFlow(cwd, "F1", { planCount: 3 });
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const sessionFile = join(cwd, "goal-session.jsonl");
		writeFileSync(sessionFile, "");
		const flow = readFlow(dir);
		flow.status = "running";
		flow.startedAt = Date.now();
		flow.goals[0].status = "running";
		flow.goals[0].sessionFile = sessionFile;
		flow.goals[0].snapshot = readFileSync(
			join(dir, flow.goals[0].file),
			"utf8",
		);
		flow.goals[0].snapshotHash = planSnapshotHash(flow.goals[0].snapshot);
		writeFlow(dir, flow);
		const ctx = commandContext(state, cwd, sessionFile);
		entriesFor(state, sessionFile).push(completionEntry(sessionFile));
		await commands.get("flow").handler(command, ctx);
		await flushScheduledGoalStart();
		const saved = readFlow(dir);
		assert(saved.currentGoal === 1, `${command} did not advance flow`);
		assert(
			saved.goals[0].status === "complete",
			`${command} missed completion`,
		);
		assert(
			saved.goals[1].status === "running",
			`${command} did not start next`,
		);
		assert(state.newSessions.length === 1, `${command} skipped next session`);
	}
}

async function flowStartWithoutNewSessionScenario() {
	const cwd = tempDir("flow-no-new-session");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	ctx.newSession = undefined;
	await commands.get("flow").handler("go", ctx);
	const flow = readFlow(dir);
	assert(flow.status === "draft", "unsupported newSession changed flow state");
	assert(
		state.notifications.at(-1).includes("不支持新建会话"),
		state.notifications.join("\n"),
	);
}

async function flowStartNewSessionThrowScenario() {
	const cwd = tempDir("flow-new-session-throw");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	ctx.newSession = async () => {
		throw new Error("boom");
	};
	await commands.get("flow").handler("go", ctx);
	const flow = readFlow(dir);
	assert(flow.status === "draft", "newSession failure changed flow state");
	assert(
		state.notifications.at(-1).includes("Flow 步骤会话启动失败") &&
			state.notifications.at(-1).includes("boom"),
		state.notifications.join("\n"),
	);
}

async function flowStartNewSessionPreReplacementStaleThrowScenario() {
	const cwd = tempDir("flow-new-session-pre-replacement-throw");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const sessionFile = join(cwd, "planning.jsonl");
	const ctx = commandContext(state, cwd, sessionFile);
	ctx.newSession = async () => {
		state.staleSessionFiles.add(sessionFile);
		throw new Error("boom before replacement");
	};
	let thrown = "";
	try {
		await commands.get("flow").handler("go", ctx);
	} catch (error) {
		thrown = error instanceof Error ? error.message : String(error);
	}
	const flow = readFlow(dir);
	assert(
		flow.status === "draft",
		"pre-replacement newSession failure changed flow state",
	);
	assert(
		thrown.includes("Flow 步骤会话启动失败") &&
			thrown.includes("boom before replacement"),
		thrown || "pre-replacement newSession failure was swallowed",
	);
}

async function flowStartNewSessionPostReplacementThrowScenario() {
	const cwd = tempDir("flow-new-session-post-replacement-throw");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	state.staleCtxAfterSessionReplacement = true;
	state.throwReplacedSessionFile = true;
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", ctx);
	const flow = readFlow(dir);
	assert(
		flow.status === "draft",
		"post-replacement newSession failure changed flow state",
	);
	assert(
		state.notifications.at(-1).includes("Flow 步骤会话启动失败") &&
			state.notifications.at(-1).includes("boom after replacement"),
		state.notifications.join("\n"),
	);
}

async function englishFlowDynamicNotificationsScenario() {
	const language = await importCachedModule("shared/language.js");
	const originalLanguage = process.env.PI_FLOW_LANGUAGE;
	process.env.PI_FLOW_LANGUAGE = "en";
	language.resetRuntimeLanguageForTests();
	try {
		const runningCwd = tempDir("flow-english-independent-start");
		const runningDir = createFlow(runningCwd, "F1");
		const runningFlow = readFlow(runningDir);
		writeFlow(runningDir, {
			...runningFlow,
			language: "en",
			status: "running",
			startedAt: Date.now(),
		});
		const draftDir = createFlow(runningCwd, "F2");
		writeFlow(draftDir, { ...readFlow(draftDir), language: "en" });
		const runningState = newState(runningCwd);
		const { commands: runningCommands } = await loadExtension(runningState);
		await runningCommands
			.get("flow")
			.handler(
				"go F2",
				commandContext(
					runningState,
					runningCwd,
					join(runningCwd, "planning.jsonl"),
				),
			);
		await flushScheduledGoalStart();
		assert(
			readFlow(draftDir).status === "running",
			"English draft Flow did not start beside running Flow",
		);
		assert(
			readFlow(runningDir).status === "running",
			"independent English start changed the existing running Flow",
		);
		assertFlowCard(
			runningState,
			"Flow Step 1 · Goal 1 started",
			"English independent start card used runtime language",
		);

		const throwCwd = tempDir("flow-english-new-session-throw");
		const throwDir = createFlow(throwCwd, "F1");
		writeFlow(throwDir, { ...readFlow(throwDir), language: "en" });
		const throwState = newState(throwCwd);
		const { commands: throwCommands } = await loadExtension(throwState);
		const throwCtx = commandContext(
			throwState,
			throwCwd,
			join(throwCwd, "planning.jsonl"),
		);
		throwCtx.newSession = async () => {
			throw new Error("boom");
		};
		await throwCommands.get("flow").handler("go", throwCtx);
		const throwNotice = throwState.notifications.at(-1) ?? "";
		assertNoticeFormat(throwNotice, "❌", "boom");
		assert(!hasChinese(throwNotice), throwNotice);
	} finally {
		if (originalLanguage === undefined) delete process.env.PI_FLOW_LANGUAGE;
		else process.env.PI_FLOW_LANGUAGE = originalLanguage;
		language.resetRuntimeLanguageForTests();
	}
}

async function englishFlowCardsUseArtifactLanguageScenario() {
	const language = await importCachedModule("shared/language.js");
	const originalLanguage = process.env.PI_FLOW_LANGUAGE;
	process.env.PI_FLOW_LANGUAGE = "zh";
	language.resetRuntimeLanguageForTests();
	try {
		const cwd = tempDir("flow-english-cards");
		createFlow(cwd, "F1", { language: "en", planCount: 3 });
		const state = newState(cwd);
		const { commands, handlers } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		await commands.get("flow").handler("go", ctx);
		await flushScheduledGoalStart();
		assertFlowCard(
			state,
			"Flow Step 1 · Goal 1 started",
			"Flow start card used runtime language",
		);
		let planCtx = state.activeCtx;
		await emit(
			handlers,
			"agent_end",
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			planCtx,
		);
		await flushScheduledGoalStart();
		assertFlowCard(
			state,
			"Flow Step 2 · Goal 2 started",
			"next Flow start card used runtime language",
		);
		planCtx = state.activeCtx;
		await emit(
			handlers,
			"agent_end",
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			planCtx,
		);
		await flushScheduledGoalStart();
		assertFlowCard(
			state,
			"Flow Step 3 · Final acceptance started",
			"final acceptance start card used runtime language",
		);
		planCtx = state.activeCtx;
		await emit(
			handlers,
			"agent_end",
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			planCtx,
		);
		assertFlowCard(
			state,
			"Flow complete",
			"Flow complete card used runtime language",
		);

		const readyCwd = tempDir("flow-english-ready-card");
		const readyDir = createFlow(readyCwd, "F1", {
			language: "en",
			planCount: 3,
		});
		const readyState = newState(readyCwd);
		const { handlers: readyHandlers } = await loadExtension(readyState);
		const sessionFile = join(readyCwd, "goal-session.jsonl");
		writeFileSync(sessionFile, "");
		const { planSnapshotHash } = await importModule("plan/snapshot.js");
		const readyFlow = readFlow(readyDir);
		readyFlow.status = "running";
		readyFlow.startedAt = Date.now();
		readyFlow.goals[0].status = "running";
		readyFlow.goals[0].sessionFile = sessionFile;
		readyFlow.goals[0].snapshot = readFileSync(
			join(readyDir, readyFlow.goals[0].file),
			"utf8",
		);
		readyFlow.goals[0].snapshotHash = planSnapshotHash(
			readyFlow.goals[0].snapshot,
		);
		writeFlow(readyDir, readyFlow);
		const readyCtx = commandContext(readyState, readyCwd, sessionFile);
		readyCtx.newSession = undefined;
		entriesFor(readyState, sessionFile).push(completionEntry(sessionFile));
		await emit(readyHandlers, "agent_end", { messages: [] }, readyCtx);
		assertFlowCard(
			readyState,
			"Flow Step 2 · Goal 2 ready",
			"Flow ready card used runtime language",
		);

		process.env.PI_FLOW_LANGUAGE = "en";
		language.resetRuntimeLanguageForTests();
		const zhCwd = tempDir("flow-chinese-cards");
		createFlow(zhCwd, "F1");
		const zhState = newState(zhCwd);
		const { commands: zhCommands } = await loadExtension(zhState);
		await zhCommands
			.get("flow")
			.handler(
				"go",
				commandContext(zhState, zhCwd, join(zhCwd, "planning.jsonl")),
			);
		await flushScheduledGoalStart();
		assertChineseFlowCard(
			zhState,
			"Flow 第 1 步 · Goal 1 已启动",
			"Chinese Flow start card was translated by runtime language",
		);
	} finally {
		if (originalLanguage === undefined) delete process.env.PI_FLOW_LANGUAGE;
		else process.env.PI_FLOW_LANGUAGE = originalLanguage;
		language.resetRuntimeLanguageForTests();
	}
}

async function flowStartUsesReplacementContextScenario() {
	const cwd = tempDir("flow-replaced-context");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	state.stalePiAfterSessionReplacement = true;
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", ctx);
	await flushScheduledGoalStart();
	const flow = readFlow(dir);
	assert(flow.status === "running", "stale pi made Flow start rollback");
	assert(flow.goals[0].sessionFile, "replacement session was not recorded");
	assert(
		state.hiddenMessages.at(-1).includes("只执行当前 Goal"),
		"Goal prompt was not hidden in replacement session",
	);
	assert(
		!state.sentMessages.some((message) =>
			message.includes("当前 Goal plan 完整 snapshot"),
		),
		"Flow Goal snapshot leaked into visible chat",
	);
	assert(
		state.customMessages.some(
			(item) => item.message.details?.title === "Flow 第 1 步 · Goal 1 已启动",
		),
		"Flow Goal start card missing",
	);
	assert(
		state.sessionNames.at(-1).startsWith("F1"),
		"replacement session was not named",
	);
}

async function flowResumeMissingRuntimeGoalHiddenPromptScenario() {
	const cwd = tempDir("flow-continue-hidden");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFileSync(sessionFile, "");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].sessionFile = sessionFile;
	writeFlow(dir, flow);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await emit(handlers, "session_start", { reason: "go" }, ctx);
	await commands.get("flow").handler("go", ctx);
	assert(
		state.hiddenMessages.at(-1).includes("当前 Goal plan 完整 snapshot"),
		"continue did not send hidden full prompt",
	);
	assert(
		!state.sentMessages.some((message) =>
			message.includes("当前 Goal plan 完整 snapshot"),
		),
		"continue leaked full prompt into visible chat",
	);
	assert(
		state.customMessages.some(
			(item) => item.message.details?.title === "Flow 第 1 步 · Goal 1 已启动",
		),
		"continue start card missing",
	);
}

async function startResumeCancelScenario() {
	const cwd = tempDir("start");
	createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", ctx);
	await flushScheduledGoalStart();
	const flow = readFlow(join(cwd, ".flow", "F1"));
	assert(flow.status === "running", "flow not running after start");
	assert(flow.goals[0].sessionFile, "first Goal session missing");
	assert(flow.goals[0].snapshotHash, "snapshot hash missing");
	assert(
		!existsSync(join(cwd, ".flow", "F1", "goal.json")),
		"Flow wrote child goal.json",
	);
	assert(
		!existsSync(join(cwd, ".flow", "F1", "goal.html")),
		"Flow wrote child goal.html",
	);
	assert(state.sessionNames.at(-1).startsWith("F1"), "session name missing");
	assert(
		state.hiddenMessages.at(-1).includes("只执行当前 Goal"),
		"Flow Goal prompt missing",
	);
	assert(
		!state.sentMessages.some((message) =>
			message.includes("当前 Goal plan 完整 snapshot"),
		),
		"Flow Goal snapshot leaked into visible chat",
	);

	await commands.get("flow").handler("status", ctx);
	assert(
		state.notifications.at(-1).includes("第 1 步 · Goal 1 · 执行中"),
		"status missing goal list",
	);
	await commands.get("flow").handler("go", ctx);
	assert(
		state.switches.at(-1) === flow.goals[0].sessionFile,
		"go did not switch session",
	);
}

async function sessionNameSyncScenario() {
	const { acquireFlowLock } = await importModule("flow/lock.js");
	const cwd = tempDir("session-name-sync");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { handlers } = await loadExtension(state);
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFileSync(sessionFile, "");
	let flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0] = {
		...flow.goals[0],
		status: "running",
		sessionFile,
		sessionName: "old",
	};
	writeFlow(dir, flow);
	const ctx = commandContext(state, cwd, sessionFile);
	const lock = acquireFlowLock(dir, "active scheduling transaction");
	assert(lock.ok, "session name test lock was not acquired");
	try {
		await emit(handlers, "session_info_changed", { name: "Busy" }, ctx);
		flow = readFlow(dir);
		assert(flow.goals[0].sessionName === "old", "busy sync wrote flow.json");
		assertNoticeFormat(
			state.notifications.find((item) => item.includes("会话名同步失败")),
			"⚠️",
			"Flow 正在处理",
		);
	} finally {
		lock.release();
	}
	await emit(handlers, "session_info_changed", { name: "Renamed" }, ctx);
	flow = readFlow(dir);
	assert(
		flow.goals[0].sessionName === "Renamed",
		"Flow sessionName did not sync",
	);
	await emit(handlers, "session_info_changed", { name: undefined }, ctx);
	flow = readFlow(dir);
	assert(flow.goals[0].sessionName === null, "Flow sessionName did not clear");
}

async function snapshotMutationScenario() {
	const cwd = tempDir("snapshot");
	const dir = createFlow(cwd, "F1", { planCount: 3 });
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", ctx);
	await flushScheduledGoalStart();
	const planCtx = state.activeCtx;
	let flow = readFlow(dir);
	const planFile = join(dir, flow.goals[0].file);
	writeFileSync(
		planFile,
		readFileSync(planFile, "utf8").replace(
			"Only this Goal.",
			"Changed protected scope.",
		),
	);
	await commands.get("flow").handler("go", ctx);
	assertNoticeFormat(state.notifications.at(-1), "❌", "启动后计划被修改");
	assert(
		state.notifications.at(-1).includes("第 1 步 · Goal 1 启动后计划被修改"),
		"snapshot error missing shared Flow step label",
	);
	flow = readFlow(dir);
	assert(
		flow.errors.at(-1)?.includes("Objective/Scope/Success Criteria"),
		"snapshot error not persisted",
	);
	writeFileSync(planFile, flow.goals[0].snapshot);
	await commands.get("flow").handler("go", ctx);
	flow = readFlow(dir);
	assert(flow.errors.length === 0, "snapshot error not cleared after repair");
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		planCtx,
	);
	await flushScheduledGoalStart();
	flow = readFlow(dir);
	assert(flow.currentGoal === 1, "flow did not advance after snapshot repair");
	const secondCtx = state.activeCtx;
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		secondCtx,
	);
	await flushScheduledGoalStart();
	const finalCtx = state.activeCtx;
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		finalCtx,
	);
	flow = readFlow(dir);
	assert(
		flow.status === "complete",
		"flow did not complete after snapshot repair",
	);

	const allowedCwd = tempDir("snapshot-handoff");
	const allowedDir = createFlow(allowedCwd, "F1");
	const allowedState = newState(allowedCwd);
	const { commands: allowedCommands } = await loadExtension(allowedState);
	const allowedCtx = commandContext(
		allowedState,
		allowedCwd,
		join(allowedCwd, "planning.jsonl"),
	);
	await allowedCommands.get("flow").handler("go", allowedCtx);
	await flushScheduledGoalStart();
	const allowedFlow = readFlow(allowedDir);
	const allowedFile = join(allowedDir, allowedFlow.goals[0].file);
	writeFileSync(
		`${allowedFile}`,
		`${readFileSync(allowedFile, "utf8")}handoff ok\n`,
	);
	await allowedCommands.get("flow").handler("go", allowedCtx);
	assert(
		allowedState.switches.at(-1) === allowedFlow.goals[0].sessionFile,
		"handoff-only mutation was blocked",
	);
}

async function snapshotCheckboxMutationMessageScenario() {
	const { planSnapshotError, planSnapshotHash } =
		await importModule("flow/snapshot.js");
	const cwd = tempDir("snapshot-checkbox");
	const dir = createFlow(cwd, "F1");
	const flow = readFlow(dir);
	const planFile = join(dir, flow.goals[0].file);
	const snapshot = readFileSync(planFile, "utf8").replace(
		"- Done.",
		"* [ ] Done.",
	);
	writeFileSync(planFile, snapshot.replace("* [ ] Done.", "* [x] Done."));
	flow.goals[0].snapshot = snapshot;
	flow.goals[0].snapshotHash = planSnapshotHash(snapshot);
	const error = planSnapshotError(dir, flow.goals[0], "zh") ?? "";
	assert(
		error.includes("Success Criteria 第 1 行从 [ ] 改成 [x]"),
		`checkbox snapshot error lacked line detail: ${error}`,
	);
	assert(
		error.includes("验收合同") && error.includes("Verification/Handoff"),
		`checkbox snapshot error lacked recovery guidance: ${error}`,
	);
}

async function flowGoalWatcherScenario() {
	const { writeFlowHtml } = await importModule("flow/html.js");
	const { closeFlowGoalWatcher, watchCurrentFlowGoal } =
		await importModule("flow/watcher.js");
	const cwd = tempDir("flow-goal-watch");
	const dir = createFlow(cwd, "F1");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	writeFlow(dir, flow);
	writeFlowHtml(dir, flow);
	const htmlPath = join(dir, "flow.html");
	const changed = onceFileChanged(htmlPath);
	watchCurrentFlowGoal(dir, flow);
	await new Promise((resolve) => setImmediate(resolve));
	const goalFile = join(dir, flow.goals[0].file);
	writeFileSync(
		goalFile,
		readFileSync(goalFile, "utf8").replace("- [ ] Do work.", "- [x] Do work."),
	);
	await changed;
	closeFlowGoalWatcher();
}

async function flowParallelMainGoalWatcherScenario() {
	const { writeFlowHtml } = await importModule("flow/html.js");
	const { closeFlowGoalWatcher, watchParallelBatch } =
		await importModule("flow/watcher.js");
	const cwd = tempDir("flow-parallel-main-watch");
	const dir = createThreeParallelFlow(cwd, "F1");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.parallelRun = parallelRun([1, 2, 3]);
	for (const goalIndex of [1, 2, 3]) flow.goals[goalIndex].status = "running";
	writeFlow(dir, flow);
	writeFlowHtml(dir, flow);
	const htmlPath = join(dir, "flow.html");
	watchParallelBatch(dir, flow, [1, 2, 3]);
	await new Promise((resolve) => setTimeout(resolve, 50));

	const changed = onceFileChanged(htmlPath);
	await new Promise((resolve) => setTimeout(resolve, 20));
	const goalFile = join(dir, flow.goals[1].file);
	writeFileSync(
		goalFile,
		readFileSync(goalFile, "utf8").replace(
			"- [ ] Do work.",
			"- [x] Main goal watcher checked.",
		),
	);
	await changed;
	const html = readFileSync(htmlPath, "utf8");
	assert(
		html.includes("Main goal watcher checked.") &&
			count(html, "当前</span>") === 3 &&
			!html.includes(" · 当前"),
		"parallel watcher did not render three-goal main markdown changes",
	);
	closeFlowGoalWatcher();
}

async function flowParallelWatcherScenario() {
	const { writeFlowHtml } = await importModule("flow/html.js");
	const { closeFlowGoalWatcher, watchParallelBatch } =
		await importModule("flow/watcher.js");
	const cwd = tempDir("flow-parallel-watch");
	const dir = createThreeParallelFlow(cwd, "F1");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.parallelRun = parallelRun([1, 2, 3]);
	for (const goalIndex of [1, 2, 3]) flow.goals[goalIndex].status = "running";
	writeFlow(dir, flow);
	const workerDir = join(dir, "workers", "G1");
	mkdirSync(workerDir, { recursive: true });
	writeFileSync(
		join(workerDir, "plan.md"),
		planMarkdown(2, false).replace("Do work.", "Worker live old."),
	);
	writeFileSync(
		join(workerDir, "state.json"),
		`${JSON.stringify(workerGoalArtifact(flow, 1, emptyChecks()), null, 2)}\n`,
	);
	writeFlowHtml(dir, flow);
	const htmlPath = join(dir, "flow.html");
	watchParallelBatch(dir, flow, [1, 2, 3]);
	await new Promise((resolve) => setTimeout(resolve, 50));

	const planChanged = onceFileChanged(htmlPath);
	await new Promise((resolve) => setTimeout(resolve, 20));
	writeFileSync(
		join(workerDir, "plan.md"),
		planMarkdown(2, false).replace("Do work.", "Worker live new."),
	);
	await planChanged;
	assert(
		readFileSync(htmlPath, "utf8").includes("Worker live new."),
		"parallel watcher did not render worker plan.md changes",
	);

	const passed = emptyChecks();
	passed.acceptance.rounds = [
		{ round: 1, result: "passed", summary: "worker acceptance passed" },
	];
	const checksChanged = onceFileChanged(htmlPath);
	await new Promise((resolve) => setTimeout(resolve, 20));
	writeFileSync(
		join(workerDir, "state.json"),
		`${JSON.stringify(workerGoalArtifact(flow, 1, passed), null, 2)}\n`,
	);
	await checksChanged;
	assert(
		readFileSync(htmlPath, "utf8").includes("worker acceptance passed"),
		"parallel watcher did not render worker state.json changes",
	);
	closeFlowGoalWatcher();
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

function firstWorkerEvent(handle) {
	return new Promise((resolve) => {
		const unsubscribe = handle.onEvent((event) => {
			unsubscribe();
			resolve(event);
		});
	});
}

function workerExit(handle) {
	return new Promise((resolve) =>
		handle.onExit((code, signal) => resolve({ code, signal })),
	);
}

function privateWorkerSocketPath(_cwd) {
	const id = `${process.pid}-${Date.now().toString(36)}`;
	if (process.platform === "win32") return `\\\\.\\pipe\\pf-${id}`;
	return join(tmpdir(), `pf-${id}.sock`);
}

function removePrivateWorkerSocket(path) {
	if (process.platform !== "win32") rmSync(path, { force: true });
}

function privateWorkerControlServer(privateWorkerMessage, job, token) {
	let server;
	const socket = new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error("private worker did not connect")),
			5000,
		);
		server = createServer((connection) => {
			connection.setEncoding("utf8");
			let buffer = "";
			connection.on("data", (chunk) => {
				buffer += chunk;
				const newline = buffer.indexOf("\n");
				if (newline === -1) return;
				try {
					const hello = JSON.parse(buffer.slice(0, newline));
					assert(
						hello.type === "hello" && hello.token === token,
						"private worker hello token mismatch",
					);
					clearTimeout(timeout);
					connection.write(privateWorkerMessage({ type: "start", job }));
					resolve(connection);
				} catch (error) {
					reject(error);
					connection.destroy();
				}
			});
			connection.on("error", reject);
		});
		server.on("error", reject);
	});
	return { server, socket };
}

function listenPrivateWorkerServer(server, socketPath) {
	removePrivateWorkerSocket(socketPath);
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});
}

function writePrivateWorkerChildScript(cwd, options = {}) {
	const script = join(cwd, "private-worker-child.mjs");
	const afterSessionStart =
		options.emitAgentEnd === false
			? `setInterval(() => undefined, 1000);`
			: `for (const handler of handlers.get("agent_end") ?? []) {
	await handler({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
}
record("private-worker-agent-end", "done");`;
	writeFileSync(
		script,
		`import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nconst srcOut = process.env.FLOW_SMOKE_SRC_OUT;\nconst cwd = process.env.FLOW_SMOKE_CWD;\nconst sessionFile = process.env.FLOW_SMOKE_SESSION;\nif (!srcOut || !cwd || !sessionFile) throw new Error("missing child env");\nconst { default: flowExtension } = await import("file://" + join(srcOut, "index.js"));\nconst handlers = new Map();\nconst entries = [];\nconst record = (name, value = "") => writeFileSync(join(cwd, name), String(value));\nflowExtension({\n\tregisterCommand() {},\n\tregisterTool() {},\n\tregisterMessageRenderer() {},\n\tregisterFlag() {},\n\tgetFlag() {},\n\tgetActiveTools() { return []; },\n\tsetActiveTools() {},\n\tgetAllTools() { return []; },\n\tgetCommands() { return []; },\n\tappendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },\n\tsendUserMessage() {},\n\tsendMessage(message) { record("private-worker-started", message.content); },\n\ton(name, handler) {\n\t\tif (!handlers.has(name)) handlers.set(name, []);\n\t\thandlers.get(name).push(handler);\n\t},\n\tsetSessionName() {},\n\tgetSessionName() {},\n\texec() { return Promise.resolve({ code: 0, stdout: "", stderr: "" }); },\n});\nconst ui = {\n\tasync confirm() { return true; },\n\tasync select(_title, options) { return options[0]; },\n\tnotify() {},\n\tsetStatus() {},\n\tsetWorkingVisible() {},\n\tsetWidget() {},\n};\nconst ctx = {\n\tcwd,\n\tmode: "json",\n\thasUI: true,\n\tui,\n\tisIdle() { return true; },\n\thasPendingMessages() { return false; },\n\tsessionManager: {\n\t\tgetSessionFile() { return sessionFile; },\n\t\tgetSessionDir() { return cwd; },\n\t\tgetBranch() { return entries; },\n\t\tgetEntries() { return entries; },\n\t\tappendSessionInfo() {},\n\t\tappendCustomEntry(customType, data) { entries.push({ type: "custom", customType, data }); },\n\t},\n\tasync waitForIdle() {},\n\tasync newSession() { throw new Error("unexpected newSession"); },\n\tasync switchSession() { throw new Error("unexpected switchSession"); },\n};\nfor (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);\n${afterSessionStart}\n`,
	);
	return script;
}

function waitForChildExit(child, timeoutMs = 5000) {
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(
				new Error(`child did not exit\nstdout:${stdout}\nstderr:${stderr}`),
			);
		}, timeoutMs);
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on("exit", (code, signal) => {
			clearTimeout(timeout);
			resolve({ code, signal, stdout, stderr });
		});
	});
}

function flagValue(args, flag) {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : args[index + 1];
}

function flagValues(args, flag) {
	const values = [];
	for (let index = 0; index < args.length - 1; index += 1) {
		if (args[index] === flag) values.push(args[index + 1]);
	}
	return values;
}

function waitForFile(path) {
	if (existsSync(path)) return Promise.resolve();
	mkdirSync(dirname(path), { recursive: true });
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			watcher.close();
			reject(new Error(`file did not appear: ${path}`));
		}, 5000);
		const finish = () => {
			clearTimeout(timeout);
			watcher.close();
			resolve();
		};
		const watcher = watch(dirname(path), (_event, name) => {
			if (name !== null && String(name) !== basename(path)) return;
			if (existsSync(path)) finish();
		});
		if (existsSync(path)) finish();
	});
}

async function waitForCondition(predicate, message) {
	const deadline = Date.now() + 1000;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(message);
}

async function goalRuntimeSessionIsolationScenario() {
	const {
		continueActiveGoalIfIdle,
		getGoalState,
		pauseGoalFromFlow,
		resumePausedGoalFromFlow,
		startGoalFromFlow,
	} = await importCachedModule("goal.js");
	const cwd = tempDir("goal-runtime-session-isolation");
	const state = newState(cwd);
	await loadExtension(state);
	const sessionA = join(cwd, "a.jsonl");
	const sessionB = join(cwd, "b.jsonl");
	writeFileSync(sessionA, "");
	writeFileSync(sessionB, "");
	const dirA = createFlow(cwd, "F1");
	const dirB = createFlow(cwd, "F2");
	for (const [dir, sessionFile] of [
		[dirA, sessionA],
		[dirB, sessionB],
	]) {
		const flow = readFlow(dir);
		writeFlow(dir, {
			...flow,
			status: "running",
			startedAt: Date.now(),
			goals: [
				{
					...flow.goals[0],
					status: "running",
					sessionFile,
				},
			],
		});
	}
	const ctxA = commandContext(state, cwd, sessionA);
	const ctxB = commandContext(state, cwd, sessionB);

	assert(
		await startGoalFromFlow("Goal A", ctxA),
		"session A goal did not start",
	);
	assert(
		await startGoalFromFlow("Goal B", ctxB),
		"session B goal did not start",
	);
	const goalA = getGoalState(ctxA);
	const goalB = getGoalState(ctxB);
	assert(
		goalA?.text === "Goal A",
		`session A goal overwritten: ${goalA?.text}`,
	);
	assert(goalB?.text === "Goal B", `session B goal missing: ${goalB?.text}`);
	assert(goalA.id !== goalB.id, "sessions share one goal id");

	assert(pauseGoalFromFlow(ctxA), "session A pause failed");
	assert(getGoalState(ctxA)?.status === "paused", "session A did not pause");
	assert(getGoalState(ctxB)?.status === "active", "session B was paused by A");
	assert(
		(await resumePausedGoalFromFlow(ctxA)) === "resumed",
		"session A resume failed",
	);
	assert(getGoalState(ctxA)?.status === "active", "session A did not resume");
	assert(
		getGoalState(ctxB)?.status === "active",
		"session B changed on A resume",
	);

	assert(
		(await continueActiveGoalIfIdle(ctxB)) === "continued",
		"session B continue failed",
	);
	assert(
		state.hiddenMessages.at(-1)?.includes("Goal B") &&
			!state.hiddenMessages.at(-1)?.includes("Goal A"),
		"session B continue prompt used the wrong goal",
	);
	assert(pauseGoalFromFlow(ctxB), "session B pause failed");
	assert(getGoalState(ctxB)?.status === "paused", "session B did not pause");
	assert(getGoalState(ctxA)?.status === "active", "session A was paused by B");
}

async function sessionContextIsolationScenario() {
	const { rememberFlowContext, rememberedFlowContext } =
		await importModule("flow/runtime.js");
	const cwd = tempDir("session-context");
	const ctxA = commandContext(newState(cwd), cwd, join(cwd, "a.jsonl"));
	const ctxB = commandContext(newState(cwd), cwd, join(cwd, "b.jsonl"));
	rememberFlowContext(ctxA);
	rememberFlowContext(ctxB);
	assert(
		rememberedFlowContext(ctxA.sessionManager.getSessionFile()) === ctxA,
		"same cwd session A context overwritten",
	);
	assert(
		rememberedFlowContext(ctxB.sessionManager.getSessionFile()) === ctxB,
		"same cwd session B context missing",
	);
}

async function ownershipScenario() {
	const cwd = tempDir("ownership");
	const sessionFile = join(cwd, "flow-session.jsonl");
	const dir = createFlow(cwd, "F1");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	flow.goals[0].sessionFile = sessionFile;
	writeFlow(dir, flow);
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	assert(!commands.has("goal"), "standalone goal command is still registered");
	await commands.get("flow").handler("status F1", ctx);
	assert(
		state.notifications.at(-1).includes("F1") &&
			state.notifications.at(-1).includes("第 1 步"),
		"flow status did not replace standalone ownership command",
	);
}

async function flowHandoffCriteriaDeviationScenario() {
	const cwd = tempDir("flow-handoff-criteria");
	const dir = createFlow(cwd, "F1");
	const { completeGoalWithFact } = await importModule(
		"flow/execution/advance.js",
	);
	const { replaceHandoff } = await importModule("plan/markdown.js");
	const flow = readFlow(dir);
	const goalFile = join(dir, flow.goals[0].file);
	const baseMarkdown = readFileSync(goalFile, "utf8");
	const samples = [
		["未发现 criteria deviation", false],
		["no criteria deviation", false],
		["without acceptance deviation", false],
		["standard deviation is a statistical term", false],
		["criteria deviation found", true],
		["验收标准偏差", true],
		["验收口径有调整", true],
	];
	for (const [handoff, expected] of samples) {
		writeFileSync(goalFile, replaceHandoff(baseMarkdown, handoff));
		const completed = completeGoalWithFact(dir, flow, 0, {
			goalId: `goal-${handoff}`,
			summary: "done",
			acceptance: "passed",
		});
		assert(
			completed.goals[0].result.criteriaChanged === expected,
			`flow handoff ${handoff} criteriaChanged mismatch`,
		);
	}
}

async function completionFactClearsGoalUiScenario() {
	const cwd = tempDir("completion-clears-ui");
	const dir = createFlow(cwd, "F1", { planCount: 3 });
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const { clearFlowActivities } = await importCachedModule(
		"shared/activity-frame.js",
	);
	const { startGoalFromFlow } = await importCachedModule("goal.js");
	const { planSnapshotHash } = await importCachedModule("flow/snapshot.js");
	const sessionFile = join(cwd, "final.jsonl");
	const flow = readFlow(dir);
	const finalGoal = flow.goals[2];
	const finalSnapshot = readFileSync(join(dir, finalGoal.file), "utf8");
	writeFlow(dir, {
		...flow,
		status: "running",
		startedAt: Date.now(),
		currentGoal: 2,
		goals: [
			{ ...flow.goals[0], status: "complete", handoff: "done" },
			{ ...flow.goals[1], status: "complete", handoff: "done" },
			{
				...finalGoal,
				status: "running",
				sessionFile,
				snapshot: finalSnapshot,
				snapshotHash: planSnapshotHash(finalSnapshot),
			},
		],
	});
	const ctx = commandContext(state, cwd, sessionFile);
	clearFlowActivities();
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	let interval;
	let clearedInterval;
	globalThis.setInterval = (callback, delay) => {
		interval = { callback, delay, unref() {} };
		return interval;
	};
	globalThis.clearInterval = (timer) => {
		clearedInterval = timer;
	};
	try {
		const started = await startGoalFromFlow("Final acceptance", ctx);
		assert(started, "goal did not start");
		const goalId = latestGoalState(state, sessionFile)?.id;
		assert(goalId, "goal state missing goalId");
		entriesFor(state, sessionFile).push(
			completionEntry(sessionFile, { goalId }),
		);

		await commands.get("flow").handler("go", ctx);
		interval.callback();
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}

	assert(readFlow(dir).status === "complete", "flow did not complete");
	assert(
		goalStateNullCount(state, sessionFile) === 1,
		"completion fact did not clear active Goal exactly once",
	);
	assert(clearedInterval === interval, "goal status timer was not stopped");
	assert(state.statuses.includes(undefined), state.statuses.join(" | "));
	assert(
		globalThis.__PI_FLOW_ACTIVITY__?.active === false,
		"goal activity was not cleared after flow completion",
	);
}

async function singleStepCompletionNoSaveFailureScenario() {
	const cwd = tempDir("completion-single-step");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", ctx);
	await flushScheduledGoalStart();
	const goalSessionFile = state.activeCtx.sessionManager.getSessionFile();
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		state.activeCtx,
	);
	const flow = readFlow(dir);
	assert(flow.status === "complete", "single-step flow did not complete");
	assertCardOrder(
		state,
		"Flow Goal 1 已完成",
		"Flow 已完成",
		"single-step completion cards out of order",
	);
	assert(
		cardTitleCount(state, "Flow 已完成") === 1,
		"single-step Flow complete card duplicated",
	);
	assert(
		cardTitleCount(state, "Flow Goal 1 已完成") === 1,
		"single-step Goal complete card duplicated",
	);
	assert(
		cardTitleCount(state, "Flow 第 1 步 · Goal 1 已完成") === 0,
		"single-step Goal complete card kept step label",
	);
	assert(
		state.notifications.some((message) =>
			message.includes("Flow Goal 1 已完成"),
		) &&
			!state.notifications.some((message) =>
				message.includes("Flow 第 1 步 · Goal 1 已完成"),
			),
		state.notifications.join("\n"),
	);
	const flowCompleteCard = findFlowCard(
		state,
		"Flow 已完成",
		"single-step complete card missing",
	);
	assert(
		flowCompleteCard.message.details.lines.includes("状态：已完成") &&
			!flowCompleteCard.message.details.lines.join("\n").includes("1/1 步"),
		flowCompleteCard.message.details.lines.join(" | "),
	);
	assert(
		customEntryCount(state, goalSessionFile, "pi-flow-goal-completed") === 1,
		"single-step completion fact duplicated",
	);
	assert(
		goalStateNullCount(state, goalSessionFile) === 1,
		"single-step active Goal was not cleared exactly once",
	);
	assert(
		flow.goals[0].completionCursor === null,
		`single-step completion kept cursor: ${flow.goals[0].completionCursor}`,
	);
	assert(
		!state.notifications.some((message) =>
			message.includes("完成状态保存失败"),
		),
		state.notifications.join("\n"),
	);

	const enCwd = tempDir("completion-single-step-en");
	createFlow(enCwd, "F1", { language: "en" });
	const enState = newState(enCwd);
	const { commands: enCommands, handlers: enHandlers } =
		await loadExtension(enState);
	const enCtx = commandContext(enState, enCwd, join(enCwd, "planning.jsonl"));
	await enCommands.get("flow").handler("go", enCtx);
	await flushScheduledGoalStart();
	await emit(
		enHandlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		enState.activeCtx,
	);
	const enFlowCompleteCard = findFlowCard(
		enState,
		"Flow complete",
		"English single-step complete card missing",
	);
	const enCompleteLines = enFlowCompleteCard.message.details.lines.join("\n");
	assert(
		enFlowCompleteCard.message.details.lines.includes("Status: Complete") &&
			!enCompleteLines.includes("Status: complete"),
		enCompleteLines,
	);
}

async function finalizeRetryCursorContinueScenario() {
	const { planSnapshotHash } = await importCachedModule("flow/snapshot.js");
	const { startGoalFromFlow } = await importCachedModule("goal.js");
	const cwd = tempDir("completion-finalize-retry");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFileSync(sessionFile, "");
	const flow = readFlow(dir);
	const snapshot = readFileSync(join(dir, flow.goals[0].file), "utf8");
	writeFlow(dir, {
		...flow,
		status: "running",
		startedAt: Date.now(),
		goals: [
			{
				...flow.goals[0],
				status: "running",
				completionCursor: "finalize_retry",
				sessionFile,
				snapshot,
				snapshotHash: planSnapshotHash(snapshot),
			},
		],
	});
	const ctx = commandContext(state, cwd, sessionFile);
	assert(await startGoalFromFlow("Goal 1", ctx), "flow goal did not start");
	await commands.get("flow").handler("go", ctx);
	const saved = readFlow(dir);
	assert(saved.status === "complete", "finalize_retry did not complete flow");
	assert(
		saved.goals[0].completionCursor === null,
		`finalize_retry kept cursor: ${saved.goals[0].completionCursor}`,
	);
	assert(
		!state.notifications.some((message) =>
			message.includes("完成状态保存失败"),
		),
		state.notifications.join("\n"),
	);
}

async function completionScenario() {
	const cwd = tempDir("completion");
	createFlow(cwd, "F1", { planCount: 3 });
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", ctx);
	await flushScheduledGoalStart();
	let planCtx = state.activeCtx;
	await commands.get("flow").handler("status", ctx);
	const firstSessionFile = planCtx.sessionManager.getSessionFile();
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		planCtx,
	);
	await flushScheduledGoalStart();
	let flow = readFlow(join(cwd, ".flow", "F1"));
	assert(flow.currentGoal === 1, "flow did not advance current Goal");
	assert(flow.goals[0].status === "complete", "Goal not complete");
	assertCardOrder(
		state,
		"Flow 第 1 步 · Goal 1 已完成",
		"Flow 第 2 步 · Goal 2 已启动",
		"multi-step completion cards out of order",
	);
	assert(
		cardTitleCount(state, "Flow 第 1 步 · Goal 1 已完成") === 1,
		"first Goal completion card duplicated",
	);
	assert(
		customEntryCount(state, firstSessionFile, "pi-flow-goal-completed") === 1,
		"first completion fact duplicated",
	);
	assert(
		goalStateNullCount(state, firstSessionFile) === 1,
		"first active Goal was not cleared exactly once",
	);
	assert(flow.goals[1].status === "running", "second step not started");
	assert(
		state.newSessions.at(-1)?.from === planCtx.sessionManager.getSessionFile(),
		"next plan started from wrong same-cwd session",
	);
	assert(
		flow.goals[0].result.handoffGenerated,
		"missing handoff not generated",
	);
	planCtx = state.activeCtx;
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		planCtx,
	);
	await flushScheduledGoalStart();
	flow = readFlow(join(cwd, ".flow", "F1"));
	assert(flow.currentGoal === 2, "flow did not advance to final acceptance");
	assert(flow.goals[2].status === "running", "final acceptance not started");
	assert(
		state.hiddenMessages.at(-1).includes("前序 Handoff"),
		"final acceptance prompt missing handoffs",
	);

	planCtx = state.activeCtx;
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		planCtx,
	);
	flow = readFlow(join(cwd, ".flow", "F1"));
	assert(flow.status === "complete", "final acceptance did not complete flow");
	assertCardOrder(
		state,
		"Flow 第 3 步 · Final acceptance 已完成",
		"Flow 已完成",
		"final Flow completion cards out of order",
	);
	assert(
		cardTitleCount(state, "Flow 已完成") === 1,
		"final Flow complete card duplicated",
	);
	assert(
		flow.goals[0].completionCursor === null,
		`completed flow goal kept cursor: ${flow.goals[0].completionCursor}`,
	);
	assert(
		flow.goals[0].checks &&
			flow.goals[0].checks.acceptance.active === null &&
			flow.goals[0].checks.quality.active === null,
		`completion did not persist settled checks: ${JSON.stringify(flow.goals[0].checks)}`,
	);
	assert(
		readFileSync(join(cwd, ".flow", "F1", "flow.html"), "utf8").includes(
			"全部完成",
		),
		"complete html missing",
	);
	const flowCompleteCard = state.customMessages.at(-1);
	assert(
		flowCompleteCard.message.content.includes("请基于上面的完成验收和质量检查"),
		"flow completion card missing final reply instruction",
	);
	assert(
		!flowCompleteCard.message.content.includes("报告：http://"),
		flowCompleteCard.message.content,
	);
	assert(
		!flowCompleteCard.message.content.includes("flow.html："),
		flowCompleteCard.message.content,
	);
	assert(
		flowCompleteCard.options.triggerTurn === true,
		"flow completion card did not trigger final turn",
	);
}

function parallelRun(goalIndexes) {
	return { id: "P1", goalIndexes, startedAt: 0 };
}

function createFlow(cwd, id, options = {}) {
	const dir = join(cwd, ".flow", id);
	mkdirSync(dir, { recursive: true });
	const planCount = options.planCount ?? 1;
	const goals = [];
	for (let offset = 0; offset < planCount; offset += 1) {
		const number = offset + 1;
		const final = planCount > 1 && number === planCount;
		const file = final
			? `G${number}-final-acceptance.md`
			: `G${number}-plan.md`;
		goals.push(
			goal(offset, final ? "Final acceptance" : `Goal ${number}`, file, final),
		);
		writeFileSync(join(dir, file), planMarkdown(number, final));
	}
	writeFlow(dir, {
		schemaVersion: 9,
		language: options.language ?? "zh",
		id,
		title: "Test Flow",
		status: "draft",
		source: { type: "prompt", path: null, originalRequest: "original" },
		createdAt: Date.now(),
		updatedAt: Date.now(),
		startedAt: null,
		currentGoal: 0,
		parallelRun: null,
		repairAttempts: 0,
		errors: [],
		goals,
	});
	return dir;
}

function createParallelFlow(cwd, id) {
	const dir = createFlow(cwd, id, { planCount: 4 });
	const flow = readFlow(dir);
	flow.goals[0].status = "complete";
	flow.goals[1].dependsOn = [0];
	flow.goals[1].writeScope = ["src/a/**"];
	flow.goals[2].dependsOn = [0];
	flow.goals[2].writeScope = ["src/b/**"];
	flow.goals[3].dependsOn = [1, 2];
	writeFlow(dir, flow);
	return dir;
}

async function createCrashedParallelFlow(cwd, id) {
	const { planSnapshotHash } = await importModule("flow/snapshot.js");
	const dir = createParallelFlow(cwd, id);
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.parallelRun = {
		id: "P-crashed",
		goalIndexes: [1, 2],
		startedAt: Date.now(),
	};
	for (const goalIndex of [1, 2]) {
		const goal = flow.goals[goalIndex];
		const snapshot = readFileSync(join(dir, goal.file), "utf8");
		goal.status = "running";
		goal.sessionFile = join(dir, "workers", `G${goalIndex}`, "session.jsonl");
		goal.sessionName = `worker ${goalIndex}`;
		goal.snapshot = snapshot;
		goal.snapshotHash = planSnapshotHash(snapshot);
	}
	writeFlow(dir, flow);
	return dir;
}

function writeWorkerResult(dir, goalIndex, parallelRunId, summary) {
	const resultDir = join(dir, "workers", `G${goalIndex}`);
	mkdirSync(resultDir, { recursive: true });
	writeFileSync(
		join(resultDir, "result.json"),
		`${JSON.stringify(
			{
				goalId: `worker-${goalIndex}`,
				summary,
				acceptance: "passed",
				sessionFile: join(resultDir, "session.jsonl"),
				parallelRunId,
			},
			null,
			2,
		)}\n`,
	);
}

function createThreeParallelFlow(cwd, id) {
	const dir = createFlow(cwd, id, { planCount: 5 });
	const flow = readFlow(dir);
	flow.goals[0].status = "complete";
	for (const goalIndex of [1, 2, 3]) {
		flow.goals[goalIndex].dependsOn = [0];
		flow.goals[goalIndex].writeScope = [`src/${goalIndex}/**`];
	}
	flow.goals[4].dependsOn = [1, 2, 3];
	writeFlow(dir, flow);
	return dir;
}

function createParallelFailureRetryFlow(cwd, id) {
	const dir = createFlow(cwd, id, { planCount: 5 });
	const flow = readFlow(dir);
	flow.goals[0].status = "complete";
	flow.goals[1].dependsOn = [0];
	flow.goals[1].writeScope = ["src/a/**"];
	flow.goals[2].dependsOn = [0];
	flow.goals[2].writeScope = ["src/b/**"];
	flow.goals[3].dependsOn = [0];
	flow.goals[3].writeScope = ["src/a/extra/**"];
	flow.goals[4].dependsOn = [1, 2, 3];
	writeFlow(dir, flow);
	return dir;
}

function installFakeWorkerRunner(cwd) {
	const command = join(cwd, "fake-worker-runner.mjs");
	writeFileSync(
		command,
		`#!/usr/bin/env node
import { existsSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const env = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => key.startsWith("PI_FLOW_WORKER_")),
);
writeFileSync(
	join(process.cwd(), "worker-spawn-args.json"),
	JSON.stringify({ args, command: process.argv[1], env }, null, 2),
);
await new Promise((resolve) => {
	const releasePath = join(process.cwd(), "release-worker-spawn");
	if (existsSync(releasePath)) return resolve();
	const watcher = watch(process.cwd(), (_event, name) => {
		if (name !== null && String(name) !== "release-worker-spawn") return;
		if (!existsSync(releasePath)) return;
		watcher.close();
		resolve();
	});
});
console.log(JSON.stringify({ type: "agent_start" }));
`,
	);
	chmodSync(command, 0o755);
	return command;
}

function installFakePi(cwd) {
	const bin = join(cwd, "bin");
	mkdirSync(bin, { recursive: true });
	writeFileSync(
		join(bin, "pi"),
		`#!/usr/bin/env bash\nexec node "$0.mjs" "$@"\n`,
	);
	writeFileSync(
		join(bin, "pi.mjs"),
		`import { appendFileSync, existsSync, mkdirSync, watch, writeFileSync } from "node:fs";\nimport { dirname, join } from "node:path";\nconst args = process.argv.slice(2);\nconst session = args[args.indexOf("--session") + 1];\nconst flowId = process.env.PI_FLOW_WORKER_FLOW_ID ?? "";\nconst goalIndex = process.env.PI_FLOW_WORKER_GOAL_INDEX ?? "0";\nconst parallelRunId = () => process.env.PI_FLOW_WORKER_PARALLEL_RUN_ID;\nappendFileSync(join(process.cwd(), "worker-runs.log"), goalIndex + "\\n");\nconst marker = (suffix) => join(process.cwd(), \`worker-\${goalIndex}.\${suffix}\`);\nconst waitForRelease = () => new Promise((resolve) => {\n\tconst releasePath = join(process.cwd(), "release-workers");\n\tif (existsSync(releasePath)) return resolve();\n\tconst watcher = watch(process.cwd(), (_event, name) => {\n\t\tif (name !== null && String(name) !== "release-workers") return;\n\t\tif (!existsSync(releasePath)) return;\n\t\twatcher.close();\n\t\tresolve();\n\t});\n});\nconsole.log(JSON.stringify({ type: "agent_start", goalIndex: Number(goalIndex) }));\nif (process.env.PI_FLOW_FAKE_HANG === "1") {\n\twriteFileSync(marker("started"), "");\n\tconst exit = () => {\n\t\twriteFileSync(marker("killed"), "");\n\t\tprocess.exit(0);\n\t};\n\tprocess.on("SIGTERM", exit);\n\tprocess.on("SIGINT", exit);\n\tsetInterval(() => undefined, 1000);\n} else if (process.env.PI_FLOW_FAKE_FAIL_INDEX === goalIndex) {\n\tprocess.exit(1);\n} else {\n\tconsole.log(JSON.stringify({ type: "tool_execution_end", toolCallId: "tool-" + goalIndex, toolName: "bash", result: "ok", isError: false }));\n\twriteFileSync(marker("started"), "");\n\tif (process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE === "1") {\n\t\tawait waitForRelease();\n\t}\n\tconst workerDir = dirname(session);\n\tmkdirSync(workerDir, { recursive: true });\n\twriteFileSync(join(workerDir, "result.json"), JSON.stringify({ goalId: \`worker-\${goalIndex}\`, summary: \`done \${goalIndex}\`, acceptance: "passed", sessionFile: session, parallelRunId: parallelRunId() }, null, 2));\n\tconsole.log(JSON.stringify({ type: "agent_end", messages: [] }));\n}\n`,
	);
	chmodSync(join(bin, "pi"), 0o755);
	const previousPath = process.env.PATH;
	process.env.PATH = `${bin}:${previousPath ?? ""}`;
	return () => {
		if (previousPath === undefined) delete process.env.PATH;
		else process.env.PATH = previousPath;
	};
}

function writeFlowSemanticDraft(cwd, id, options = {}) {
	const dir = join(cwd, ".flow", id);
	mkdirSync(dir, { recursive: true });
	const planCount = options.planCount ?? 3;
	const goals = [];
	for (let offset = 0; offset < planCount; offset += 1) {
		const number = offset + 1;
		const final = planCount > 1 && number === planCount;
		const file = final
			? `G${number}-final-acceptance.md`
			: `G${number}-plan.md`;
		goals.push(
			goal(offset, final ? "Final acceptance" : `Goal ${number}`, file, final),
		);
		writeFileSync(
			join(dir, file),
			options.invalidMarkdown && offset === 0
				? "# Broken\n\n## Objective\nBroken\n"
				: planMarkdown(number, final),
		);
	}
	writeFlowSemantic(dir, options.title ?? "Semantic Flow", {
		source: options.source,
		goals,
	});
	return dir;
}

function writeFlowSemantic(dir, title, options = {}) {
	writeFileSync(
		join(dir, "flow.semantic.json"),
		`${JSON.stringify(
			{
				title,
				...(options.source ? { source: options.source } : {}),
				goals: options.goals.map(({ title: goalTitle, role, file }) => ({
					title: goalTitle,
					role,
					file,
				})),
			},
			null,
			2,
		)}\n`,
	);
}

function goal(index, title, file, final = false) {
	return {
		index,
		title,
		role: final ? "final_acceptance" : "normal",
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
	};
}

function emptyChecks() {
	return {
		acceptance: { enabled: true, rounds: [], active: null },
		quality: { enabled: true, rounds: [], active: null },
	};
}

function writeWorkerGoalArtifact(dir, flow, goalIndex, checks) {
	const workerDir = join(dir, "workers", `G${goalIndex}`);
	mkdirSync(workerDir, { recursive: true });
	writeFileSync(
		join(workerDir, "state.json"),
		`${JSON.stringify(workerGoalArtifact(flow, goalIndex, checks), null, 2)}\n`,
	);
}

function workerGoalArtifact(flow, goalIndex, checks) {
	void flow;
	return {
		status: "running",
		completionCursor: null,
		runtimeGoalId: `worker-${goalIndex}`,
		sessionFile: null,
		sessionName: null,
		result: { summary: null, outcome: null },
		checks,
		updatedAt: Date.now(),
	};
}

function runningChecks() {
	return {
		...emptyChecks(),
		acceptance: {
			enabled: true,
			rounds: [],
			active: [{ label: "model", status: "running" }],
		},
	};
}

function passedChecks() {
	return {
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result: "passed", summary: "完成验收通过" }],
			active: null,
		},
		quality: {
			enabled: true,
			rounds: [{ round: 1, result: "passed", summary: "质量检查通过" }],
			active: null,
		},
	};
}

function failedChecks() {
	return {
		...emptyChecks(),
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result: "failed", summary: "完成验收失败" }],
			active: null,
		},
	};
}

function planMarkdown(index, final) {
	return `# Goal ${pad(index)}: ${final ? "Final acceptance" : "Work"}

## Objective
Do Goal ${index}.

## Scope
Only this Goal.

## Steps
- [ ] Do work.

## Success Criteria
- Done.

## Verification
- [ ] \`npm test\`

## Notes

## Handoff
`;
}

async function loadExtension(state) {
	const { default: flowExtension } = await import(
		`file://${join(srcOut, "index.js")}?t=${Date.now()}-${Math.random()}`
	);
	const commands = new Map();
	const tools = new Map();
	const handlers = new Map();
	let activeTools = [];
	const api = {
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
		registerMessageRenderer() {},
		registerFlag() {},
		getFlag() {},
		getActiveTools() {
			return activeTools;
		},
		setActiveTools(next) {
			activeTools = next;
		},
		getAllTools() {
			return [];
		},
		getCommands() {
			return [];
		},
		appendEntry(customType, data) {
			entriesFor(state, state.activeSessionFile).push({
				type: "custom",
				customType,
				data,
			});
		},
		sendUserMessage(message, options) {
			if (state.piStale || state.staleApis.has(api))
				throw new Error("stale pi");
			recordSend(state, message, options);
		},
		sendMessage(message, options = {}) {
			if (state.failSend) throw new Error("busy");
			if (state.staleApis.has(api)) throw new Error("stale pi");
			state.customMessages.push({ message, options });
			if (message.display === false)
				state.hiddenMessages.push(String(message.content));
		},
		on(name, handler) {
			if (!handlers.has(name)) handlers.set(name, []);
			handlers.get(name).push(handler);
		},
		setSessionName(name) {
			if (state.piStale || state.staleApis.has(api))
				throw new Error("stale pi");
			state.sessionNames.push(name);
			if (state.sessionNameTriggersEvent)
				queueMicrotask(() => {
					for (const handler of handlers.get("session_info_changed") ?? [])
						handler({ name }, state.activeCtx);
				});
		},
		getSessionName() {
			return state.sessionNames.at(-1);
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	};
	state.extensionApis.push(api);
	flowExtension(api);
	return { commands, tools, handlers };
}

function recordSend(state, message, options) {
	if (state.failSend) throw new Error("busy");
	const text = String(message);
	if (text === "继续执行 Pi Flow 内部任务。")
		state.triggers.push({ message: text, options });
	else state.sentMessages.push(text);
}

function commandContext(state, cwd, sessionFile, replaced = false) {
	state.activeSessionFile = sessionFile;
	const ui = {
		async confirm(title, message) {
			state.confirms.push({ title, message });
			return state.confirm;
		},
		async select(_title, options) {
			state.selects.push(options);
			return state.select ?? options[1];
		},
		notify(message, level) {
			state.notifications.push(`${message}:${level ?? "info"}`);
		},
		setStatus(_key, value) {
			state.statuses.push(value);
		},
		setWorkingVisible(value) {
			state.workingVisible.push(value);
		},
		setWidget(key, content, options) {
			state.widgets.push({ key, content, options });
		},
	};
	const ctx = {
		cwd,
		hasUI: true,
		get ui() {
			if (state.staleSessionFiles.has(sessionFile))
				throw new Error(
					"This extension ctx is stale after session replacement or reload.",
				);
			return ui;
		},
		isIdle() {
			return state.idle;
		},
		hasPendingMessages() {
			return state.pending;
		},
		sessionManager: sessionManager(state, cwd, sessionFile, replaced),
		async waitForIdle() {},
		abort() {
			state.aborts += 1;
		},
		async newSession(options) {
			const nextFile = join(cwd, `session-${++state.sessionCount}.jsonl`);
			state.newSessions.push({ from: sessionFile, to: nextFile });
			writeFileSync(nextFile, "");
			if (state.stalePiAfterSessionReplacement) state.piStale = true;
			if (state.staleCtxAfterSessionReplacement)
				state.staleSessionFiles.add(sessionFile);
			const nextCtx = commandContext(state, cwd, nextFile, true);
			state.activeCtx = nextCtx;
			await options?.withSession?.(nextCtx);
			return { cancelled: false };
		},
		async switchSession(path, options) {
			state.switches.push(path);
			if (state.stalePiAfterSessionReplacement) state.piStale = true;
			if (state.staleCtxAfterSessionReplacement)
				state.staleSessionFiles.add(sessionFile);
			const nextCtx = commandContext(state, cwd, path, true);
			state.activeCtx = nextCtx;
			await options?.withSession?.(nextCtx);
			return { cancelled: false };
		},
	};
	if (replaced) {
		ctx.sendMessage = (message, options = {}) => {
			if (state.failSend) throw new Error("busy");
			state.customMessages.push({ message, options });
			if (message.display === false)
				state.hiddenMessages.push(String(message.content));
		};
		ctx.sendUserMessage = (message, options) =>
			recordSend(state, message, options);
	}
	state.activeCtx = ctx;
	entriesFor(state, sessionFile);
	return ctx;
}

function sessionManager(state, cwd, sessionFile, replaced = false) {
	return {
		getSessionFile() {
			if (replaced && state.throwReplacedSessionFile)
				throw new Error("boom after replacement");
			return sessionFile;
		},
		getSessionDir() {
			return cwd;
		},
		getBranch() {
			return entriesFor(state, sessionFile);
		},
		getEntries() {
			return entriesFor(state, sessionFile);
		},
		appendSessionInfo(name) {
			state.sessionNames.push(name);
		},
		appendCustomEntry(customType, data) {
			entriesFor(state, sessionFile).push({
				type: "custom",
				customType,
				data,
			});
		},
	};
}

function newState(cwd) {
	return {
		cwd,
		activeSessionFile: join(cwd, "planning.jsonl"),
		activeCtx: undefined,
		confirm: true,
		idle: true,
		pending: false,
		sessionCount: 0,
		sentMessages: [],
		hiddenMessages: [],
		triggers: [],
		notifications: [],
		statuses: [],
		customMessages: [],
		widgets: [],
		workingVisible: [],
		execs: [],
		sessionNames: [],
		sessionNameTriggersEvent: false,
		switches: [],
		newSessions: [],
		extensionApis: [],
		select: undefined,
		selects: [],
		confirms: [],
		aborts: 0,
		entries: new Map(),
		failSend: false,
		piStale: false,
		stalePiAfterSessionReplacement: false,
		staleCtxAfterSessionReplacement: false,
		staleApis: new Set(),
		staleSessionFiles: new Set(),
		throwReplacedSessionFile: false,
	};
}

function entriesFor(state, sessionFile) {
	if (!state.entries.has(sessionFile)) state.entries.set(sessionFile, []);
	return state.entries.get(sessionFile);
}

function completionEntry(sessionFile, options = {}) {
	return {
		type: "custom",
		customType: "pi-flow-goal-completed",
		data: {
			goalId: options.goalId ?? "goal-1",
			summary: "done",
			acceptance: "passed",
			sessionFile,
			checks: emptyChecks(),
		},
	};
}

function stuckRefactorBCompletionEntry(sessionFile) {
	return {
		type: "custom",
		customType: "pi-flow-goal-completed",
		data: {
			goalId: "18876eaa-67cf-4fc3-a153-4a1294c92d37",
			summary: "模型 1 · gpt-5.5",
			acceptance: "模型 1 · gpt-5.5",
			sessionFile,
			checks: stuckRefactorBChecks({ settled: true }),
		},
	};
}

function stuckRefactorBChecks(options = {}) {
	const qualityRound = {
		round: 1,
		result: "passed",
		summary:
			"模型 1 · gpt-5.5\nnpm run check && npm test exit 0；review.ts 498 行，聚合与截断已按目标拆到共享模块。",
	};
	return {
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result: "passed", summary: "模型 1 · gpt-5.5" }],
			active: null,
		},
		quality: {
			enabled: true,
			rounds: [qualityRound],
			active: options.settled
				? null
				: [
						{
							label: "gpt-5.5",
							status: "passed",
							summary: "check/test passed",
						},
						{
							label: "gpt-5.4-mini",
							status: "passed",
							summary: "check/test passed",
						},
						{
							label: "grok-composer-2.5-fast",
							status: "passed",
							summary: "check/test passed",
						},
					],
		},
	};
}

async function emit(handlers, name, event, ctx) {
	for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	await flushScheduledGoalReview();
}

async function emitLast(handlers, name, event, ctx) {
	let result;
	for (const handler of handlers.get(name) ?? [])
		result = await handler(event, ctx);
	await flushScheduledGoalReview();
	return result;
}

async function flushScheduledGoalReview() {
	const { waitForScheduledGoalStateReview } = await import(
		`file://${join(srcOut, "goal.js")}`
	);
	await waitForScheduledGoalStateReview();
}

async function flushScheduledGoalStart() {
	await new Promise((resolve) => setImmediate(resolve));
}

function tempDir(name) {
	const dir = join(out, name);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	return dir;
}

function readFlow(dir) {
	return JSON.parse(readFileSync(join(dir, "flow.json"), "utf8"));
}

function readGoalArtifact(dir) {
	return JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
}

function writeFlow(dir, flow) {
	writeFileSync(join(dir, "flow.json"), `${JSON.stringify(flow, null, 2)}\n`);
}

function writePreDraftFlow(cwd, id, options = {}) {
	const dir = join(cwd, ".flow", id);
	mkdirSync(dir, { recursive: true });
	const status = options.status ?? "generating";
	writeFlow(dir, {
		schemaVersion: 9,
		language: options.language ?? "zh",
		id,
		title: options.title ?? `Flow ${id}`,
		status,
		source: {
			type: "prompt",
			path: null,
			originalRequest: options.originalRequest ?? `request ${id}`,
		},
		createdAt: Date.now(),
		updatedAt: Date.now(),
		startedAt: null,
		currentGoal: 0,
		parallelRun: null,
		repairAttempts: options.repairAttempts ?? 0,
		errors: options.errors ?? [],
		goals: [],
	});
	if (options.alignment !== false)
		writeFileSync(
			join(dir, "alignment.json"),
			`${JSON.stringify(
				{
					version: 1,
					stage: options.stage ?? status,
					sessionFile: options.sessionFile ?? null,
					autoStart: options.autoStart ?? true,
					alignmentTurns: options.alignmentTurns ?? [],
					lastAlignmentQuestion: options.lastAlignmentQuestion ?? null,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				},
				null,
				2,
			)}\n`,
		);
	return dir;
}

async function importModule(path) {
	return import(
		`file://${join(srcOut, path)}?t=${Date.now()}-${Math.random()}`
	);
}

async function importCachedModule(path) {
	return import(`file://${join(srcOut, path)}`);
}

function latestWidgetText(state) {
	const content = state.widgets.at(-1)?.content;
	const widget =
		typeof content === "function"
			? content(
					{ requestRender() {} },
					{ fg: (_color, value) => value, bold: (value) => value },
				)
			: content;
	return widget?.render ? widget.render(100).join("\n") : "";
}

function count(text, search) {
	return text.split(search).length - 1;
}

function customEntryCount(state, sessionFile, customType) {
	return entriesFor(state, sessionFile).filter(
		(item) => item.type === "custom" && item.customType === customType,
	).length;
}

function latestGoalState(state, sessionFile) {
	return entriesFor(state, sessionFile)
		.filter((item) => item.customType === "goal-state" && item.data?.goal)
		.at(-1)?.data.goal;
}

function goalStateNullCount(state, sessionFile) {
	return entriesFor(state, sessionFile).filter(
		(item) => item.customType === "goal-state" && item.data?.goal === null,
	).length;
}

function cardTitles(state) {
	return state.customMessages
		.map((item) => item.message.details?.title)
		.filter(Boolean);
}

function cardTitleCount(state, title) {
	return cardTitles(state).filter((item) => item === title).length;
}

function assertCardOrder(state, beforeTitle, afterTitle, message) {
	const titles = cardTitles(state);
	const before = titles.indexOf(beforeTitle);
	const after = titles.indexOf(afterTitle);
	assert(before >= 0 && after > before, `${message}: ${titles.join(" | ")}`);
}

function openedReportCount(state) {
	return state.execs.filter((item) =>
		item.args.some((arg) => String(arg).startsWith("http://127.0.0.1:")),
	).length;
}

function hasChinese(text) {
	return /[\u4e00-\u9fff]/u.test(text);
}

function assertFlowCard(state, title, message) {
	const card = findFlowCard(state, title, message);
	assert(!hasChinese(card.message.content), card.message.content);
	assert(
		!card.message.details.lines.some(hasChinese),
		card.message.details.lines.join("\n"),
	);
}

function assertChineseFlowCard(state, title, message) {
	const card = findFlowCard(state, title, message);
	assert(hasChinese(card.message.content), card.message.content);
	assert(
		card.message.details.lines.some(hasChinese),
		card.message.details.lines.join("\n"),
	);
}

function findFlowCard(state, title, message) {
	const card = state.customMessages.find(
		(item) => item.message.details?.title === title,
	);
	assert(
		card,
		`${message}: ${state.customMessages.map((item) => item.message.details?.title).join(" | ")}`,
	);
	return card;
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

function pad(value) {
	return String(value).padStart(2, "0");
}

function missingPid() {
	for (let pid = process.pid + 1; pid < process.pid + 10000; pid += 1) {
		try {
			process.kill(pid, 0);
		} catch (error) {
			if (error?.code === "ESRCH") return pid;
		}
	}
	return process.pid + 10000;
}

function assertNoticeFormat(notification, emoji, body) {
	assert(notification, "notice missing");
	assert(notification.endsWith(":info"), notification);
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
