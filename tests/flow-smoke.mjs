import { execFileSync } from "node:child_process";
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
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	["--outDir", srcOut, "--rootDir", "src", "--noEmit", "false"],
	{ cwd: root, stdio: "inherit" },
);
function writeFlowTestConfig({
	state = false,
	quality = false,
	generation,
	runner = {},
} = {}) {
	writeFileSync(
		join(out, "config.json"),
		JSON.stringify({
			...(generation === undefined ? {} : { generation }),
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
	await runScenario(flowGoalRuntimePromptContextScenario);
	await runScenario(flowWorkerCommandScenario);
	await runScenario(workerSpawnConfigScenario);
	await runScenario(parallelLaneBoardThreeGoalScenario);
	await runScenario(parallelBatchSuccessScenario);
	await runScenario(parallelBatchFailureScenario);
	await runScenario(parallelBatchCancelScenario);
	await runScenario(schemaScenario);
	await runScenario(badJsonScenario);
	await runScenario(flowIdSafetyScenario);
	await runScenario(flowRootSymlinkScenario);
	await runScenario(statusValidationScenario);
	await runScenario(statusTextHidesSessionPathScenario);
	await runScenario(malformedRepairScenario);
	await runScenario(runningValidationScenario);
	await runScenario(htmlScenario);
	await runScenario(generationAlignConfigScenario);
	await runScenario(generationAlignCommandConfigScenario);
	await runScenario(flowReadyWithoutAlignedRequestScenario);
	await runScenario(flowStreamingAlignmentInputDoesNotEchoScenario);
	await runScenario(englishFlowAlignmentStartGenerationScenario);
	await runScenario(generateScenario);
	await runScenario(flowAutoStartUsesCommandContextScenario);
	await runScenario(flowHandwrittenRejectedScenario);
	await runScenario(semanticFlowGenerationEndScenario);
	await runScenario(flowSemanticOverridesHandwrittenScenario);
	await runScenario(malformedCurrentFlowSemanticKeepsRepairingScenario);
	await runScenario(missingFlowSemanticTitleKeepsRepairingScenario);
	await runScenario(flowClarificationScenario);
	await runScenario(flowDirectStatusCancelScenario);
	await runScenario(flowReportServerSurvivesSessionShutdownScenario);
	await runScenario(flowSessionStartRebindsReportStatusScenario);
	await runScenario(flowClarificationSendFailureClearsPendingScenario);
	await runScenario(flowRepairSendFailureClearsPendingScenario);
	await runScenario(goalRecommendationFlowCommandScenario);
	await runScenario(failedGoalFlowHandoffRetainsGoalScenario);
	await runScenario(pendingGenerationScenario);
	await runScenario(englishFlowGeneratedSummaryUsesArtifactLanguageScenario);
	await runScenario(flowGoalSendFailureRollsBackScenario);
	await runScenario(completionWithEventCommandContextScenario);
	await runScenario(completionWithoutRememberedContextScenario);
	await runScenario(stuckRefactorBContinueScenario);
	await runScenario(completionEventUsesRememberedCommandContextScenario);
	await runScenario(completionEmitUsesEmittedContextScenario);
	await runScenario(completionCommandConsumesStoredFactScenario);
	await runScenario(flowHandoffCriteriaDeviationScenario);
	await runScenario(flowStartWithoutNewSessionScenario);
	await runScenario(flowStartNewSessionThrowScenario);
	await runScenario(flowStartNewSessionPreReplacementStaleThrowScenario);
	await runScenario(flowStartNewSessionPostReplacementThrowScenario);
	await runScenario(englishFlowDynamicNotificationsScenario);
	await runScenario(flowRuntimeNotificationsUseArtifactLanguageScenario);
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
	await runScenario(sessionContextIsolationScenario);
	await runScenario(ownershipScenario);
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
	const flow = { id: "F1-test", goals: [goal] };
	const prompt = planGoalPrompt(flow, goal, "# Ship\n\n## Steps\n\n- [ ] Ship");
	assert(prompt.includes("持久 Todo"), "flow prompt missing todo memory rule");
	assert(
		prompt.includes("开始前必须读取"),
		"flow prompt missing read-first rule",
	);
	assert(
		prompt.includes("[ ] 改为 [~]") && prompt.includes("[~] 改为 [x]"),
		"flow prompt missing checkbox update rule",
	);
	assert(prompt.includes("[!]"), "flow prompt missing blocked status rule");
	assert(
		prompt.includes("切换下一项前必须重新读取或检查") &&
			prompt.includes("为什么先跳过") &&
			prompt.includes("可跳到下一个未完成项"),
		"flow prompt missing reread or blocked-skip rule",
	);
	assert(
		prompt.includes(".flow/flows/F1-test/G1-plan.md"),
		"flow prompt missing current plan path",
	);
	assert(
		prompt.includes("不要手写或修改 flow.json"),
		"flow prompt should keep flow.json plugin-owned",
	);
	const flowTodoContext = {
		planPath: ".flow/flows/F1-test/G1-plan.md",
		recordSection: "Handoff",
		stateFile: "flow.json",
	};
	const activeGoal = { text: "Ship", iteration: 2 };
	const flowRuntimePrompts = [
		buildGoalSystemPrompt(activeGoal, flowTodoContext),
		buildResumePrompt(activeGoal, flowTodoContext),
		buildContinuePrompt(activeGoal, "marker", flowTodoContext),
	];
	for (const runtimePrompt of flowRuntimePrompts) {
		assert(
			runtimePrompt.includes(".flow/flows/F1-test/G1-plan.md"),
			"flow runtime prompt missing current goal file",
		);
		assert(
			runtimePrompt.includes("持久 Todo") &&
				runtimePrompt.includes("开始前必须读取") &&
				runtimePrompt.includes("[ ] 改为 [~]") &&
				runtimePrompt.includes("[~] 改为 [x]") &&
				runtimePrompt.includes("[!]"),
			"flow runtime prompt missing todo loop rule",
		);
		assert(
			runtimePrompt.includes("切换下一项前必须重新读取或检查") &&
				runtimePrompt.includes("为什么先跳过") &&
				runtimePrompt.includes("可跳到下一个未完成项"),
			"flow runtime prompt missing reread or blocked-skip rule",
		);
		assert(
			runtimePrompt.includes("Handoff") &&
				runtimePrompt.includes("维护原因写入 Handoff"),
			"flow runtime prompt missing Handoff maintenance rule",
		);
		assert(
			runtimePrompt.includes("不要手写或修改 flow.json"),
			"flow runtime prompt should keep flow.json plugin-owned",
		);
		assert(
			!runtimePrompt.includes("当前 plan.md"),
			"flow runtime prompt should not mention standalone plan.md",
		);
	}
}

async function flowGoalRuntimePromptContextScenario() {
	const cwd = tempDir("flow-runtime-prompt");
	const dir = createFlow(cwd, "F1-runtime-prompt");
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
		systemPrompt.includes(".flow/flows/F1-runtime-prompt/G1-plan.md"),
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

async function flowWorkerCommandScenario() {
	const cwd = tempDir("flow-worker-command");
	const dir = createFlow(cwd, "F1-worker-command", { planCount: 3 });
	const flow = readFlow(dir);
	writeFlow(dir, {
		...flow,
		status: "running",
		startedAt: Date.now(),
	});
	const beforeFlowJson = readFileSync(join(dir, "flow.json"), "utf8");
	const state = newState(cwd);
	state.stalePiAfterSessionReplacement = true;
	const { commands, handlers } = await loadExtension(state);
	const launcherSessionFile = join(cwd, "launcher-session.jsonl");
	const ctx = commandContext(state, cwd, launcherSessionFile);

	await commands.get("flow").handler("worker F1-worker-command 1", ctx);

	const workerDir = join(dir, "workers", "G1");
	const sessionFile = join(workerDir, "session.jsonl");
	const workerCtx = commandContext(state, cwd, sessionFile);
	const copiedPlan = readFileSync(join(workerDir, "plan.md"), "utf8");
	assert(
		copiedPlan === readFileSync(join(dir, "G2-plan.md"), "utf8"),
		"worker plan.md was not copied from the selected flow goal",
	);
	const artifact = readGoalArtifact(workerDir);
	assert(artifact.status === "running", "worker goal artifact not running");
	assert(
		state.switches.at(-1) === sessionFile &&
			artifact.sessionFile === sessionFile,
		"worker goal artifact did not switch into worker session file",
	);
	assert(
		artifact.snapshot === copiedPlan && artifact.snapshotHash,
		"worker goal artifact missing snapshot",
	);
	assert(existsSync(join(workerDir, "goal.html")), "worker goal.html missing");
	assert(
		state.hiddenMessages
			.at(-1)
			.includes(".flow/flows/F1-worker-command/workers/G1/plan.md"),
		"worker prompt did not point at worker plan.md",
	);
	assert(
		readFileSync(join(dir, "flow.json"), "utf8") === beforeFlowJson,
		"worker start modified flow.json",
	);

	workerCtx.mode = "json";
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		workerCtx,
	);
	const result = JSON.parse(
		readFileSync(join(workerDir, "result.json"), "utf8"),
	);
	assert(
		result.goalId &&
			result.sessionFile === sessionFile &&
			result.checks?.acceptance,
		"worker result.json did not persist completion fact",
	);
	assert(
		readFileSync(join(dir, "flow.json"), "utf8") === beforeFlowJson,
		"worker completion event modified flow.json",
	);
	assert(
		readFileSync(join(dir, "flow.json"), "utf8") === beforeFlowJson,
		"worker agent_end modified flow.json",
	);
}

async function workerSpawnConfigScenario() {
	const { spawnWorker } = await importModule("flow/parallel/spawner.js");
	const { flowMainExtensionPath } = await importModule(
		"shared/child-extensions.js",
	);
	const cwd = tempDir("worker-spawn-config");
	const command = installFakeWorkerRunner(cwd);
	const flowId = "F1-worker-spawn-config";
	const flowDir = join(cwd, ".flow", "flows", flowId);
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
		handle = spawnWorker({ flowId, goalIndex: 2, flowDir, cwd });
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
		assert(
			args.at(-2) === "-p" && args.at(-1) === `/flow worker ${flowId} 2`,
			joined,
		);
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
	const dir = createThreeParallelFlow(cwd, "F1-lane-board");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.parallelBatch = [1, 2, 3];
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

async function parallelBatchSuccessScenario() {
	const cwd = tempDir("parallel-batch-success");
	const dir = createParallelFlow(cwd, "F1-parallel-success");
	const beforeFlowJson = readFileSync(join(dir, "flow.json"), "utf8");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE = "1";
	let start;
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));

		start = commands.get("flow").handler("start F1-parallel-success", ctx);
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
		assert(
			readFileSync(join(dir, "flow.json"), "utf8") === beforeFlowJson,
			"parallel batch start modified flow.json before workers completed",
		);
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
		assert(flow.parallelBatch === null, "parallel batch was not cleared");
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
	} finally {
		delete process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE;
		writeFileSync(join(cwd, "release-workers"), "");
		if (start) await start.catch(() => undefined);
		restorePi();
	}
}

async function parallelBatchFailureScenario() {
	const cwd = tempDir("parallel-batch-failure");
	const dir = createParallelFlow(cwd, "F1-parallel-failure");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_FAIL_INDEX = "2";
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));

		await commands.get("flow").handler("start F1-parallel-failure", ctx);

		const flow = readFlow(dir);
		assert(
			flow.goals[1].status === "running",
			"successful worker was fan-in completed after batch failure",
		);
		assert(
			flow.goals[2].status === "running",
			"failed worker status changed unexpectedly",
		);
		assert(
			flow.goals[3].status === "pending",
			"batch failure started next goal",
		);
		assert(
			flow.parallelBatch?.length === 2,
			"failed batch did not stay active for summary",
		);
		assert(
			flow.errors.some((error) => error.includes("result.json")),
			"batch failure missing summary error",
		);
		assert(state.newSessions.length === 0, "batch failure should not start G4");
	} finally {
		delete process.env.PI_FLOW_FAKE_FAIL_INDEX;
		restorePi();
	}
}

async function parallelBatchCancelScenario() {
	const cwd = tempDir("parallel-batch-cancel");
	const dir = createParallelFlow(cwd, "F1-parallel-cancel");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_HANG = "1";
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		const start = commands.get("flow").handler("start F1-parallel-cancel", ctx);
		await Promise.all([
			waitForFile(join(cwd, "worker-1.started")),
			waitForFile(join(cwd, "worker-2.started")),
		]);

		await commands.get("flow").handler("cancel", ctx);

		const flow = readFlow(dir);
		assert(flow.status === "cancelled", "parallel cancel did not cancel flow");
		assert(flow.parallelBatch === null, "parallel cancel did not clear batch");
		assert(existsSync(join(cwd, "worker-1.killed")), "worker 1 was not killed");
		assert(existsSync(join(cwd, "worker-2.killed")), "worker 2 was not killed");
		await start;
	} finally {
		delete process.env.PI_FLOW_FAKE_HANG;
		restorePi();
	}
}

async function schemaScenario() {
	const { validateFlowDir } = await importModule("flow/validator.js");
	const cwd = tempDir("schema");
	const dir = join(cwd, ".flow", "flows", "F1-schema");
	assert(!validateFlowDir(dir).ok, "missing flow.json passed");
	createFlow(cwd, "F1-schema");
	assert(validateFlowDir(dir).ok, "valid flow failed");
	const flowWithParallelFields = readFlow(dir);
	flowWithParallelFields.parallelBatch = [0, 1];
	flowWithParallelFields.goals[1].dependsOn = [0];
	flowWithParallelFields.goals[0].writeScope = ["src/api/**"];
	writeFlow(dir, flowWithParallelFields);
	assert(
		validateFlowDir(dir).ok,
		`parallel flow fields rejected: ${validateFlowDir(dir).errors.join(" | ")}`,
	);
	flowWithParallelFields.goals[1].dependsOn = "G1";
	writeFlow(dir, flowWithParallelFields);
	assert(
		validateFlowDir(dir).errors.some((error) =>
			error.includes("goals[1].dependsOn 必须是数组"),
		),
		"bad dependsOn not rejected",
	);
	createFlow(cwd, "F1-schema");
	const missingStartedAt = readFlow(dir);
	delete missingStartedAt.startedAt;
	writeFileSync(join(dir, "flow.json"), JSON.stringify(missingStartedAt));
	assert(
		validateFlowDir(dir).errors.includes("startedAt 计划必须为 null"),
		"missing startedAt not rejected",
	);
	createFlow(cwd, "F1-schema");
	const runningWithoutStartedAt = readFlow(dir);
	runningWithoutStartedAt.status = "running";
	writeFlow(dir, runningWithoutStartedAt);
	assert(
		validateFlowDir(dir).errors.includes("startedAt 运行态必须是时间戳"),
		"running flow without startedAt not rejected",
	);
	createFlow(cwd, "F1-schema");
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
		validateFlowDir(dir).errors.includes("schemaVersion 必须为 5"),
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
	const pathDir = createFlow(cwd, "F2-path");
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
	const maxDir = createFlow(cwd, "F3-max", { planCount: 11 });
	assert(validateFlowDir(maxDir).ok, "11 goals should pass");
	createFlow(cwd, "F4-too-many", { planCount: 12 });
	assert(
		validateFlowDir(join(cwd, ".flow", "flows", "F4-too-many")).errors.some(
			(error) => error.includes("超过 10"),
		),
		">10 execution goals not rejected",
	);
	const duplicateDir = createFlow(cwd, "F5-duplicate-final", { planCount: 2 });
	const duplicateFlow = readFlow(duplicateDir);
	duplicateFlow.goals[0].role = "final_acceptance";
	writeFlow(duplicateDir, duplicateFlow);
	const duplicateErrors = validateFlowDir(duplicateDir).errors;
	assert(
		duplicateErrors.includes(
			"只能有 1 个最终验收步骤（role: final_acceptance）",
		),
		"duplicate final acceptance not rejected",
	);
	assert(
		duplicateErrors.includes("goals[0] 非最终步骤必须是 normal"),
		"non-last final acceptance not rejected",
	);
}

async function badJsonScenario() {
	const cwd = tempDir("bad-json");
	const dir = createFlow(cwd, "F1-bad-json");
	writeFileSync(join(dir, "flow.json"), "{ bad json");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("status F1-bad-json", ctx);
	assert(
		state.notifications.at(-1).includes("flow.json 读取失败"),
		"bad json status threw or hid parse error",
	);
	await commands.get("flow").handler("start F1-bad-json", ctx);
	assert(
		state.notifications.at(-1).includes("flow.json 读取失败"),
		"bad json start threw or hid parse error",
	);
	for (const command of ["status", "continue", "cancel"]) {
		await commands.get("flow").handler(command, ctx);
		assert(
			state.notifications.at(-1).includes("flow.json 读取失败"),
			`bad json scan path not reported for ${command}`,
		);
	}
	await commands.get("goal").handler("pause", ctx);
	assert(
		state.notifications.at(-1).includes("Flow 状态读取失败"),
		"bad json did not fail closed for /goal mutation",
	);
}

async function flowIdSafetyScenario() {
	const cwd = tempDir("flow-id-safety");
	mkdirSync(join(cwd, ".flow", "flows"), { recursive: true });
	const outside = tempDir("flow-id-outside");
	const outsideFlow = createFlow(outside, "F1-target");
	symlinkSync(outsideFlow, join(cwd, ".flow", "flows", "F1-link"));
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	for (const command of [
		"status ../escape",
		"start ../escape",
		`status ${outsideFlow}`,
	]) {
		await commands.get("flow").handler(command, ctx);
		assert(
			state.notifications.at(-1).includes("flow id 非法"),
			`unsafe flow id not rejected for ${command}`,
		);
	}
	await commands.get("flow").handler("status F1-link", ctx);
	assert(
		state.notifications.at(-1).includes("普通目录"),
		"symlink flow directory not rejected",
	);
	await commands.get("flow").handler("status", ctx);
	assert(
		state.notifications.at(-1).includes("没有 Flow"),
		"symlink flow directory was scanned as flow",
	);
}

async function flowRootSymlinkScenario() {
	const cwd = tempDir("flow-root-symlink");
	const externalProject = tempDir("flow-root-external");
	createFlow(externalProject, "F1-outside");
	symlinkSync(join(externalProject, ".flow"), join(cwd, ".flow"));
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	for (const command of ["status", "status F1-outside", "start"]) {
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
	const dir = createFlow(cwd, "F1-invalid-status");
	const flow = readFlow(dir);
	flow.errors = [42];
	writeFlow(dir, flow);
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("status F1-invalid-status", ctx);
	assert(
		state.notifications.at(-1).includes("Flow 校验失败"),
		"invalid status flow was rendered instead of rejected",
	);
	assert(
		state.notifications.at(-1).includes("errors 必须是字符串数组"),
		"invalid errors[] element was not reported",
	);
}

async function statusTextHidesSessionPathScenario() {
	const { statusText } = await importModule("flow/execution/status.js");
	const cwd = tempDir("status-session-path");
	const dir = createFlow(cwd, "F1-status-session-path", { planCount: 3 });
	const sessionFile = join(cwd, "goal-session.jsonl");
	const flow = readFlow(dir);
	flow.goals[0].sessionFile = sessionFile;
	flow.goals[0].sessionName = "实现登录";
	flow.goals[1].sessionFile = join(cwd, "second-session.jsonl");
	const text = statusText(flow);
	assert(text.includes("会话: 实现登录"), text);
	assert(text.includes("会话: 已启动"), text);
	assert(text.includes("会话: 尚未启动"), text);
	assert(!text.includes(sessionFile), text);
	assert(!text.includes("second-session.jsonl"), text);
}

async function malformedRepairScenario() {
	const startCwd = tempDir("malformed-start");
	const startDir = createFlow(startCwd, "F1-malformed-start");
	const startFlow = readFlow(startDir);
	delete startFlow.source;
	startFlow.goals = {};
	writeFlow(startDir, startFlow);
	const startState = newState(startCwd);
	const { commands: startCommands } = await loadExtension(startState);
	const startCtx = commandContext(
		startState,
		startCwd,
		join(startCwd, "planning.jsonl"),
	);
	await startCommands.get("flow").handler("start F1-malformed-start", startCtx);
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
	const generateDir = writeFlowSemanticDraft(
		generateCwd,
		"F1-malformed-generate",
		{ invalidMarkdown: true },
	);
	await emit(handlers, "agent_end", { messages: [] }, generateCtx);
	assert(
		generateState.hiddenMessages.at(-1).includes("缺少章节"),
		"generation repair prompt missing hidden semantic validation error",
	);
	assert(
		readFileSync(join(generateDir, "flow.html"), "utf8").includes("缺少章节"),
		"generation semantic validation error did not render error page",
	);
}

async function runningValidationScenario() {
	const cwd = tempDir("running-validation");
	const dir = createFlow(cwd, "F1-invalid-running");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals = {};
	writeFlow(dir, flow);
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	for (const command of ["continue", "cancel"]) {
		await commands.get("flow").handler(command, ctx);
		assert(
			state.notifications.at(-1).includes("Flow 校验失败"),
			`invalid running flow was not rejected for ${command}`,
		);
		assert(
			state.notifications.at(-1).includes("goals 必须是数组"),
			`invalid running flow error missing for ${command}`,
		);
	}
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
	assert(
		state.notifications.at(-1).includes("Flow 校验失败"),
		"invalid running flow was not rejected on agent_end",
	);
}

async function htmlScenario() {
	const { writeFlowErrorHtml, writeFlowHtml } =
		await importModule("flow/html.js");
	const cwd = tempDir("html");
	const dir = createFlow(cwd, "F1-html");
	const firstPlanPath = join(dir, "G1-plan.md");
	writeFileSync(
		firstPlanPath,
		readFileSync(firstPlanPath, "utf8").replace(
			"- [ ] Do work.",
			"- [~] **准备环境**：安装依赖并初始化数据库\n- [!] **等待凭证**：缺少外部 token，记录阻塞",
		),
	);
	const draftHtml = readFileSync(writeFlowHtml(dir, readFlow(dir)), "utf8");
	assert(draftHtml.includes("多步骤计划"), "draft label missing");
	assert(draftHtml.includes("待执行"), "pending label not localized");
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
	assert(draftHtml.includes("执行进度"), "flow stepper label missing");
	assert(draftHtml.includes("data-rough-node"), "flow stepper nodes missing");
	assert(draftHtml.includes("data-rough-ring"), "flow progress ring missing");
	assert(draftHtml.includes(">完成验收</p>"), "flow goal review phase missing");
	assert(
		draftHtml.includes(">质量检查</p>"),
		"flow quality review phase missing",
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
	parallelFlow.parallelBatch = [0, 1];
	parallelFlow.goals[0].status = "running";
	parallelFlow.goals[1].status = "running";
	const parallelHtml = readFileSync(writeFlowHtml(dir, parallelFlow), "utf8");
	assert(
		count(parallelHtml, " · 当前") === 2,
		"parallel batch did not mark every active goal current",
	);
	assert(
		parallelHtml.includes('data-tone="blue" class="mt-[18px] h-1'),
		"parallel batch stepper line did not show active tone",
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
		"F1-html</p>",
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
	assert(
		yesState.hiddenMessages.at(-1).includes("# 拷问我") &&
			yesState.sentMessages.length === 0,
		"generation.align yes did not start hidden alignment",
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
	writeFlowSemanticDraft(noCwd, "F1-direct-config");
	await emit(noExtension.handlers, "agent_end", { messages: [] }, noCtx);
	assert(
		noState.newSessions.length === 1,
		"generation.align no did not auto-start flow",
	);
	writeFlowTestConfig();
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
		latestWidgetText(state).includes("等待回复") &&
			latestWidgetText(state).includes("回答问题继续对齐") &&
			latestWidgetText(state).includes("回复「开始生成」直接生成计划") &&
			!latestWidgetText(state).includes("回复 Y"),
		"flow ready without aligned-request should wait for an alignment reply",
	);
	const inputResult = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "Y" },
		ctx,
	);
	assert(
		inputResult?.action === "handled",
		"consumed flow alignment input should stop the original prompt",
	);
	assert(
		latestWidgetText(state).includes("🌊 Flow · 对齐中") &&
			latestWidgetText(state).includes("等待 AI 追问") &&
			!latestWidgetText(state).includes("已收到"),
		"flow alignment input should keep an in-progress activity box",
	);
	assert(
		state.customMessages.some(
			(item) => item.message.display === true && item.message.content === "Y",
		),
		"flow alignment answer should remain visible",
	);
	assert(
		state.hiddenMessages.at(-1).includes("# 拷问我") &&
			state.hiddenMessages.at(-1).includes("Q1: 问题 1：是否限定 UI？") &&
			state.hiddenMessages.at(-1).includes("A1: Y") &&
			!state.hiddenMessages.at(-1).includes("schemaVersion"),
		"Y after malformed flow ready should continue hidden alignment with QA context",
	);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", content: "问题 2：是否需要测试？" }] },
		ctx,
	);
	const startResult = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "开始生成" },
		ctx,
	);
	assert(
		startResult?.action === "handled",
		"start generation reply should be consumed",
	);
	assert(
		latestWidgetText(state).includes("🌊 Flow · 计划生成中") &&
			!latestWidgetText(state).includes("flow missing summary"),
		"start generation reply should switch to compact generation box",
	);
	assert(
		state.hiddenMessages.at(-1).includes("创建一个 draft Flow") &&
			state.hiddenMessages.at(-1).includes("已对齐问答") &&
			state.hiddenMessages.at(-1).includes("Q1: 问题 1：是否限定 UI？") &&
			state.hiddenMessages.at(-1).includes("A1: Y") &&
			!state.hiddenMessages.at(-1).includes("# 拷问我"),
		"start generation reply should send flow generation prompt with aligned Q/A",
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
	assert(
		state.hiddenMessages.at(-1).includes("# 拷问我") &&
			state.hiddenMessages.at(-1).includes("Q1: 问题 1：是否限定 UI？") &&
			state.hiddenMessages.at(-1).includes("A1: Y"),
		"streaming flow alignment input should still send hidden alignment context",
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
				latestWidgetText(state).includes("Waiting for AI to ask") &&
				!latestWidgetText(state).includes("等待"),
			"English flow aligning widget leaked Chinese",
		);
		await emit(
			handlers,
			"agent_end",
			{
				messages: [
					{
						role: "assistant",
						content:
							"Enough info.\n<!-- pi-flow:ready-to-draft -->\n<aligned-request>- Goal: Ship English flow</aligned-request>",
					},
				],
			},
			ctx,
		);
		assert(
			latestWidgetText(state).includes("🌊 Flow · Waiting for confirmation") &&
				latestWidgetText(state).includes(
					"Reply “Start generation” to generate the plan",
				) &&
				!latestWidgetText(state).includes("回复「开始生成」"),
			"English flow final-confirmation widget leaked Chinese",
		);
		const startResult = await emitLast(
			handlers,
			"input",
			{ source: "interactive", text: "Start generation" },
			ctx,
		);
		assert(
			startResult?.action === "handled",
			"English flow start generation reply should be consumed",
		);
		assert(
			latestWidgetText(state).includes("🌊 Flow · Generating plan") &&
				!latestWidgetText(state).includes("计划生成中"),
			"English flow start generation should switch to generating widget",
		);
		assert(
			state.hiddenMessages
				.at(-1)
				.includes(
					"generating a recoverable multi-session Pi Flow Goal queue",
				) &&
				state.hiddenMessages.at(-1).includes("Alignment summary:") &&
				state.hiddenMessages.at(-1).includes("`dependsOn`") &&
				state.hiddenMessages.at(-1).includes("`writeScope`") &&
				!state.hiddenMessages.at(-1).includes("# Interrogate me"),
			"English start generation should send the Flow generation prompt",
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
		state.widgets.at(-1)?.content,
		"flow draft generation did not show activity widget",
	);
	writeFlowSemanticDraft(cwd, "F1-login", { title: "Login Flow" });
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		state.execs.some((item) =>
			item.args.some((arg) => String(arg).startsWith("http://127.0.0.1:")),
		),
		"flow live html not opened",
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

	writeFlowSemanticDraft(cwd, "F2-invalid", {
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
	assert(
		state.hiddenMessages.filter((message) => message.includes("当前校验错误"))
			.length >= 3,
		"repair did not run 3 hidden rounds",
	);
	assert(
		!state.hiddenMessages.at(-1).includes("严格访谈") &&
			!state.hiddenMessages.at(-1).includes("持续追问"),
		"repair prompt should not use grill semantics",
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
	writeFlowSemanticDraft(cwd, "F1-autostart", { title: "Auto Start" });
	const eventCtx = commandContext(state, cwd, sessionFile);
	eventCtx.newSession = undefined;
	await emit(handlers, "agent_end", { messages: [] }, eventCtx);
	await flushScheduledGoalStart();
	const flow = readFlow(join(cwd, ".flow", "flows", "F1-autostart"));
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

async function flowHandwrittenRejectedScenario() {
	const cwd = tempDir("flow-handwritten-rejected");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("handwritten only", ctx);
	createFlow(cwd, "F1-handwritten");
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
	const dir = writeFlowSemanticDraft(cwd, "F1-semantic-only", {
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
	assert(
		!existsSync(join(dir, "flow.json")),
		"semantic setup prewrote flow.json",
	);
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		existsSync(join(dir, "flow.json")),
		"semantic flow did not build flow.json",
	);
	const validation = validateFlowDir(dir);
	assert(
		validation.ok,
		`semantic flow build invalid: ${validation.errors.join("\n")}`,
	);
	const flow = readFlow(dir);
	assert(
		flow.parallelBatch === null,
		"semantic flow missing parallelBatch null",
	);
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
	const dir = createFlow(cwd, "F1-conflict");
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
			flow.source.path === null,
		"semantic flow trusted handwritten or semantic source",
	);
}

async function malformedCurrentFlowSemanticKeepsRepairingScenario() {
	const cwd = tempDir("flow-semantic-current-malformed");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("ship malformed semantic", ctx);
	const dir = writeFlowSemanticDraft(cwd, "F1-current", {
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
	const dir = writeFlowSemanticDraft(cwd, "F1-missing-title", {
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

async function flowDirectStatusCancelScenario() {
	const cwd = tempDir("flow-direct-status-cancel");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("direct flow", ctx);
	await commands.get("flow").handler("status", ctx);
	assert(
		state.notifications.some((item) => item.includes("计划生成中")),
		"pending flow status was not shown",
	);
	await commands.get("flow").handler("cancel", ctx);
	assert(
		state.notifications.some((item) => item.includes("Flow 计划生成已取消")),
		"pending flow cancel did not clear generation",
	);
}

async function flowReportServerSurvivesSessionShutdownScenario() {
	const cwd = tempDir("flow-report-survives-shutdown");
	createFlow(cwd, "F1-live-report");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("status F1-live-report", ctx);
	const statusMessage = state.notifications.find((item) =>
		item.includes("🌐 网页报告: http://127.0.0.1:"),
	);
	const url = statusMessage?.match(
		/http:\/\/127\.0\.0\.1:\d+\/\S+?(?=:(?:info|warning|error)$|\s|$)/u,
	)?.[0];
	assert(url, `missing report URL: ${state.notifications.join(" | ")}`);
	const flowHtml = join(cwd, ".flow", "flows", "F1-live-report", "flow.html");
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
	const dir = createFlow(cwd, "F1-session-report");
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
	writeFlowSemanticDraft(cwd, "F1-broken", { invalidMarkdown: true });
	state.failSend = true;
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		state.notifications.at(-1).includes("Flow 计划修复提示发送失败"),
		"failed repair prompt did not notify",
	);
	state.failSend = false;
	await commands.get("flow").handler("second flow", ctx);
	assert(
		state.hiddenMessages.at(-1).includes("second flow"),
		"failed repair prompt kept pending generation locked",
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
	assert(
		state.notifications.at(-1).includes("Flow 计划澄清提示发送失败"),
		"failed flow clarification prompt did not notify",
	);
	state.failSend = false;
	await commands.get("flow").handler("second flow", ctx);
	assert(
		state.hiddenMessages.at(-1).includes("second flow"),
		"failed flow clarification prompt kept pending generation locked",
	);
}

async function goalRecommendationFlowCommandScenario() {
	const cwd = tempDir("goal-flow-command");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("goal").handler("large goal request", ctx);
	await emit(
		handlers,
		"agent_end",
		{
			messages: [
				{
					role: "assistant",
					content: "<!-- pi-flow:recommend-flow -->\n范围太大，请运行 /flow。",
				},
			],
		},
		ctx,
	);
	await commands.get("flow").handler("", ctx);
	assert(
		state.hiddenMessages.at(-1).includes("large goal request"),
		"/flow did not consume pending goal request",
	);
	const handoffWidget = latestWidgetText(state);
	assert(
		handoffWidget.includes("🌊 Flow · 计划生成中") &&
			!handoffWidget.includes("large goal request") &&
			!handoffWidget.includes("总目标：large goal request") &&
			!handoffWidget.includes("正在规划 .flow draft"),
		"goal-to-flow handoff cleared or misrendered the Flow draft activity box",
	);
}

async function failedGoalFlowHandoffRetainsGoalScenario() {
	const cwd = tempDir("goal-flow-handoff-retain");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("existing flow draft", ctx);
	await commands.get("goal").handler("large goal request", ctx);
	await emit(
		handlers,
		"agent_end",
		{
			messages: [
				{
					role: "assistant",
					content: "<!-- pi-flow:recommend-flow -->\n范围太大，推荐 /flow。",
				},
			],
		},
		ctx,
	);
	await commands.get("flow").handler("", ctx);
	assert(
		state.notifications.at(-1).includes("已有 Flow 计划在生成中"),
		"failed /flow handoff did not report existing flow draft",
	);
	await commands.get("goal").handler("force", ctx);
	assert(
		state.hiddenMessages.at(-1).includes("large goal request"),
		"failed /flow handoff cleared pending goal",
	);
}

async function pendingGenerationScenario() {
	const cwd = tempDir("pending-generation");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctxA = commandContext(state, cwd, join(cwd, "a.jsonl"));
	await commands.get("flow").handler("A request", ctxA);
	const ctxB = commandContext(state, cwd, join(cwd, "b.jsonl"));
	await commands.get("flow").handler("B request", ctxB);
	assert(
		state.notifications.at(-1).includes("已有 Flow 计划在生成中"),
		"second same-cwd generation was not rejected",
	);
	assert(state.hiddenMessages.length === 1, "rejected generation sent prompt");
	const dir = writeFlowSemanticDraft(cwd, "F1-a");
	await emit(handlers, "agent_end", { messages: [] }, ctxB);
	assert(
		!existsSync(join(dir, "flow.json")),
		"wrong session consumed pending generation",
	);
	await emit(handlers, "agent_end", { messages: [] }, ctxA);
	await flushScheduledGoalStart();
	const flow = readFlow(dir);
	assert(
		flow.status === "running",
		"owning session did not consume pending generation",
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
		writeFlowSemanticDraft(cwd, "F1-english-summary", {
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
	const dir = createFlow(cwd, "F1-send-failure");
	const state = newState(cwd);
	state.failSend = true;
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("start", ctx);
	await flushScheduledGoalStart();
	const flow = readFlow(dir);
	assert(flow.status === "draft", "failed Flow goal start left flow running");
	assert(
		flow.goals[0].sessionFile === null,
		"failed Flow goal start kept sessionFile",
	);
}

async function completionWithEventCommandContextScenario() {
	const { planSnapshotHash } = await importModule("plan/snapshot.js");
	const cwd = tempDir("completion-event-command-context");
	const dir = createFlow(cwd, "F1-event-context");
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
	assert(
		state.notifications.some((message) =>
			message.includes("Flow 第 1 步 · Goal 1 已完成"),
		),
		"completion notification used shared Flow step label",
	);
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
			(item) =>
				item.message.details?.title ===
				"Flow 第 2 步 · Final acceptance 已就绪",
		),
		"continue-required card shown despite event command context",
	);
}

async function completionWithoutRememberedContextScenario() {
	const { planSnapshotHash } = await importModule("plan/snapshot.js");
	const cwd = tempDir("completion-no-remembered-context");
	const dir = createFlow(cwd, "F1-no-context");
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
	assert(
		state.customMessages.some(
			(item) =>
				item.message.details?.title ===
					"Flow 第 2 步 · Final acceptance 已就绪" &&
				item.message.content.includes("/flow continue"),
		),
		"missing continue-required card",
	);
}

async function stuckRefactorBContinueScenario() {
	const { planSnapshotHash } = await importModule("plan/snapshot.js");
	const cwd = tempDir("stuck-refactor-b-continue");
	const dir = createFlow(cwd, "F1-refactor-b", { planCount: 5 });
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
	await commands.get("flow").handler("continue", ctx);
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
	const dir = createFlow(cwd, "F1-remembered-context");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const planCtx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("start", planCtx);
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
	const dir = createFlow(cwd, "F1-emitted-context");
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
	for (const command of ["continue"]) {
		const { planSnapshotHash } = await importModule("plan/snapshot.js");
		const cwd = tempDir(`completion-command-${command}`);
		const dir = createFlow(cwd, `F1-command-${command}`);
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
	const dir = createFlow(cwd, "F1-no-new-session");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	ctx.newSession = undefined;
	await commands.get("flow").handler("start", ctx);
	const flow = readFlow(dir);
	assert(flow.status === "draft", "unsupported newSession changed flow state");
	assert(
		state.notifications.at(-1).includes("不支持新建会话"),
		state.notifications.join("\n"),
	);
}

async function flowStartNewSessionThrowScenario() {
	const cwd = tempDir("flow-new-session-throw");
	const dir = createFlow(cwd, "F1-new-session-throw");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	ctx.newSession = async () => {
		throw new Error("boom");
	};
	await commands.get("flow").handler("start", ctx);
	const flow = readFlow(dir);
	assert(flow.status === "draft", "newSession failure changed flow state");
	assert(
		state.notifications.at(-1).includes("Flow 步骤会话启动失败：boom"),
		state.notifications.join("\n"),
	);
}

async function flowStartNewSessionPreReplacementStaleThrowScenario() {
	const cwd = tempDir("flow-new-session-pre-replacement-throw");
	const dir = createFlow(cwd, "F1-pre-replacement-throw");
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
		await commands.get("flow").handler("start", ctx);
	} catch (error) {
		thrown = error instanceof Error ? error.message : String(error);
	}
	const flow = readFlow(dir);
	assert(
		flow.status === "draft",
		"pre-replacement newSession failure changed flow state",
	);
	assert(
		thrown.includes("Flow 步骤会话启动失败：boom before replacement"),
		thrown || "pre-replacement newSession failure was swallowed",
	);
}

async function flowStartNewSessionPostReplacementThrowScenario() {
	const cwd = tempDir("flow-new-session-post-replacement-throw");
	const dir = createFlow(cwd, "F1-post-replacement-throw");
	const state = newState(cwd);
	state.staleCtxAfterSessionReplacement = true;
	state.throwReplacedSessionFile = true;
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("start", ctx);
	const flow = readFlow(dir);
	assert(
		flow.status === "draft",
		"post-replacement newSession failure changed flow state",
	);
	assert(
		state.notifications
			.at(-1)
			.includes("Flow 步骤会话启动失败：boom after replacement"),
		state.notifications.join("\n"),
	);
}

async function englishFlowDynamicNotificationsScenario() {
	const language = await importCachedModule("shared/language.js");
	const originalLanguage = process.env.PI_FLOW_LANGUAGE;
	process.env.PI_FLOW_LANGUAGE = "en";
	language.resetRuntimeLanguageForTests();
	try {
		const runningCwd = tempDir("flow-english-running-notice");
		const runningDir = createFlow(runningCwd, "F1-running-en");
		const runningFlow = readFlow(runningDir);
		writeFlow(runningDir, {
			...runningFlow,
			language: "en",
			status: "running",
			startedAt: Date.now(),
		});
		const draftDir = createFlow(runningCwd, "F2-draft-en");
		writeFlow(draftDir, { ...readFlow(draftDir), language: "en" });
		const runningState = newState(runningCwd);
		const { commands: runningCommands } = await loadExtension(runningState);
		await runningCommands
			.get("flow")
			.handler(
				"start F2-draft-en",
				commandContext(
					runningState,
					runningCwd,
					join(runningCwd, "planning.jsonl"),
				),
			);
		const runningNotice = runningState.notifications.at(-1) ?? "";
		assert(
			runningNotice.includes("A Flow is already running: F1-running-en") &&
				!hasChinese(runningNotice),
			runningNotice,
		);

		const throwCwd = tempDir("flow-english-new-session-throw");
		const throwDir = createFlow(throwCwd, "F1-new-session-throw-en");
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
		await throwCommands.get("flow").handler("start", throwCtx);
		const throwNotice = throwState.notifications.at(-1) ?? "";
		assert(
			throwNotice.includes("Flow step session start failed: boom") &&
				!hasChinese(throwNotice),
			throwNotice,
		);
	} finally {
		if (originalLanguage === undefined) delete process.env.PI_FLOW_LANGUAGE;
		else process.env.PI_FLOW_LANGUAGE = originalLanguage;
		language.resetRuntimeLanguageForTests();
	}
}

async function flowRuntimeNotificationsUseArtifactLanguageScenario() {
	const language = await importCachedModule("shared/language.js");
	const originalLanguage = process.env.PI_FLOW_LANGUAGE;
	process.env.PI_FLOW_LANGUAGE = "zh";
	language.resetRuntimeLanguageForTests();
	try {
		const cwd = tempDir("flow-artifact-language-notifications");
		createFlow(cwd, "F1-english-notices", { language: "en" });
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		await commands.get("flow").handler("start", ctx);
		await flushScheduledGoalStart();
		await commands.get("flow").handler("pause", ctx);
		assertFlowNotice(state.notifications.at(-1), "Flow paused");
		await commands.get("flow").handler("cancel", ctx);
		assertFlowNotice(state.confirms.at(-1)?.title, "Cancel Flow?");
		assertFlowNotice(state.confirms.at(-1)?.message, "will be cancelled");
		assertFlowNotice(state.notifications.at(-1), "Flow cancelled");

		process.env.PI_FLOW_LANGUAGE = "en";
		language.resetRuntimeLanguageForTests();
		const zhCwd = tempDir("flow-chinese-notices");
		createFlow(zhCwd, "F1-chinese-notices");
		const zhState = newState(zhCwd);
		const { commands: zhCommands } = await loadExtension(zhState);
		const zhCtx = commandContext(zhState, zhCwd, join(zhCwd, "planning.jsonl"));
		await zhCommands.get("flow").handler("start", zhCtx);
		await flushScheduledGoalStart();
		await zhCommands.get("flow").handler("pause", zhCtx);
		const zhNotice = zhState.notifications.at(-1) ?? "";
		assert(zhNotice.includes("Flow 已暂停") && hasChinese(zhNotice), zhNotice);
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
		createFlow(cwd, "F1-english-cards", { language: "en" });
		const state = newState(cwd);
		const { commands, handlers } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		await commands.get("flow").handler("start", ctx);
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
			"Flow Step 2 · Final acceptance started",
			"next Flow start card used runtime language",
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
		const readyDir = createFlow(readyCwd, "F1-ready-en", { language: "en" });
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
			"Flow Step 2 · Final acceptance ready",
			"Flow ready card used runtime language",
		);

		process.env.PI_FLOW_LANGUAGE = "en";
		language.resetRuntimeLanguageForTests();
		const zhCwd = tempDir("flow-chinese-cards");
		createFlow(zhCwd, "F1-chinese-cards");
		const zhState = newState(zhCwd);
		const { commands: zhCommands } = await loadExtension(zhState);
		await zhCommands
			.get("flow")
			.handler(
				"start",
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
	const dir = createFlow(cwd, "F1-replaced-context");
	const state = newState(cwd);
	state.stalePiAfterSessionReplacement = true;
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("start", ctx);
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
		state.sessionNames.at(-1).startsWith("F1-G1"),
		"replacement session was not named",
	);
}

async function flowResumeMissingRuntimeGoalHiddenPromptScenario() {
	const cwd = tempDir("flow-continue-hidden");
	const dir = createFlow(cwd, "F1-continue-hidden");
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
	await emit(handlers, "session_start", { reason: "continue" }, ctx);
	await commands.get("flow").handler("continue", ctx);
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
	createFlow(cwd, "F1-start");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("start", ctx);
	await flushScheduledGoalStart();
	let flow = readFlow(join(cwd, ".flow", "flows", "F1-start"));
	assert(flow.status === "running", "flow not running after start");
	assert(flow.goals[0].sessionFile, "first Goal session missing");
	assert(flow.goals[0].snapshotHash, "snapshot hash missing");
	assert(
		!existsSync(join(cwd, ".flow", "flows", "F1-start", "goal.json")),
		"Flow wrote child goal.json",
	);
	assert(
		!existsSync(join(cwd, ".flow", "flows", "F1-start", "goal.html")),
		"Flow wrote child goal.html",
	);
	assert(state.sessionNames.at(-1).startsWith("F1-G1"), "session name missing");
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
	await commands.get("flow").handler("continue", ctx);
	assert(
		state.switches.at(-1) === flow.goals[0].sessionFile,
		"continue did not switch session",
	);
	await commands.get("flow").handler("cancel", state.activeCtx);
	flow = readFlow(join(cwd, ".flow", "flows", "F1-start"));
	assert(flow.status === "cancelled", "cancel did not mark cancelled");
	assert(
		existsSync(join(cwd, ".flow", "flows", "F1-start")),
		"cancel deleted files",
	);
}

async function sessionNameSyncScenario() {
	const cwd = tempDir("session-name-sync");
	const dir = createFlow(cwd, "F1-session-name");
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
	const goalDir = createGoalArtifact(
		cwd,
		"G1-session-name",
		sessionFile,
		"old",
	);
	const ctx = commandContext(state, cwd, sessionFile);
	await emit(handlers, "session_info_changed", { name: "Renamed" }, ctx);
	flow = readFlow(dir);
	assert(
		flow.goals[0].sessionName === "Renamed",
		"Flow sessionName did not sync",
	);
	let goalArtifact = readGoalArtifact(goalDir);
	assert(
		goalArtifact.sessionName === "Renamed",
		"Goal sessionName did not sync",
	);
	await emit(handlers, "session_info_changed", { name: undefined }, ctx);
	flow = readFlow(dir);
	goalArtifact = readGoalArtifact(goalDir);
	assert(flow.goals[0].sessionName === null, "Flow sessionName did not clear");
	assert(goalArtifact.sessionName === null, "Goal sessionName did not clear");
}

async function snapshotMutationScenario() {
	const cwd = tempDir("snapshot");
	const dir = createFlow(cwd, "F1-snapshot");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("start", ctx);
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
	await commands.get("flow").handler("continue", ctx);
	assert(
		state.notifications.at(-1).includes("启动后计划被修改"),
		"continue did not reject protected plan mutation",
	);
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
	await commands.get("flow").handler("continue", ctx);
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
	const allowedDir = createFlow(allowedCwd, "F1-handoff-only");
	const allowedState = newState(allowedCwd);
	const { commands: allowedCommands } = await loadExtension(allowedState);
	const allowedCtx = commandContext(
		allowedState,
		allowedCwd,
		join(allowedCwd, "planning.jsonl"),
	);
	await allowedCommands.get("flow").handler("start", allowedCtx);
	await flushScheduledGoalStart();
	const allowedFlow = readFlow(allowedDir);
	const allowedFile = join(allowedDir, allowedFlow.goals[0].file);
	writeFileSync(
		`${allowedFile}`,
		`${readFileSync(allowedFile, "utf8")}handoff ok\n`,
	);
	await allowedCommands.get("flow").handler("continue", allowedCtx);
	assert(
		allowedState.switches.at(-1) === allowedFlow.goals[0].sessionFile,
		"handoff-only mutation was blocked",
	);
}

async function snapshotCheckboxMutationMessageScenario() {
	const { planSnapshotError, planSnapshotHash } =
		await importModule("flow/snapshot.js");
	const cwd = tempDir("snapshot-checkbox");
	const dir = createFlow(cwd, "F1-snapshot-checkbox");
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
	const dir = createFlow(cwd, "F1-watch");
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
	const dir = createThreeParallelFlow(cwd, "F1-parallel-main-watch");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.parallelBatch = [1, 2, 3];
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
		html.includes("Main goal watcher checked.") && count(html, " · 当前") === 3,
		"parallel watcher did not render three-goal main markdown changes",
	);
	closeFlowGoalWatcher();
}

async function flowParallelWatcherScenario() {
	const { writeFlowHtml } = await importModule("flow/html.js");
	const { closeFlowGoalWatcher, watchParallelBatch } =
		await importModule("flow/watcher.js");
	const cwd = tempDir("flow-parallel-watch");
	const dir = createThreeParallelFlow(cwd, "F1-parallel-watch");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.parallelBatch = [1, 2, 3];
	for (const goalIndex of [1, 2, 3]) flow.goals[goalIndex].status = "running";
	writeFlow(dir, flow);
	const workerDir = join(dir, "workers", "G1");
	mkdirSync(workerDir, { recursive: true });
	writeFileSync(
		join(workerDir, "plan.md"),
		planMarkdown(2, false).replace("Do work.", "Worker live old."),
	);
	writeFileSync(
		join(workerDir, "goal.json"),
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
		join(workerDir, "goal.json"),
		`${JSON.stringify(workerGoalArtifact(flow, 1, passed), null, 2)}\n`,
	);
	await checksChanged;
	assert(
		readFileSync(htmlPath, "utf8").includes("worker acceptance passed"),
		"parallel watcher did not render worker goal.json changes",
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
	const dir = createFlow(cwd, "F1-owned");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	flow.goals[0].sessionFile = sessionFile;
	writeFlow(dir, flow);
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("goal").handler("status", ctx);
	assert(!state.notifications.at(-1).includes("被禁止"), "goal status blocked");
	await commands.get("goal").handler("pause", ctx);
	assert(
		state.notifications.at(-1).includes("Flow F1-owned"),
		"goal mutation not blocked",
	);

	const other = commandContext(
		state,
		tempDir("ownership-free"),
		join(cwd, "free.jsonl"),
	);
	entriesFor(state, other.sessionManager.getSessionFile()).push({
		type: "message",
		message: { role: "user", content: "Ship normal goal" },
	});
	await commands.get("goal").handler("", other);
	assert(
		state.hiddenMessages.at(-1).includes("生成单 session 可执行计划"),
		"normal goal draft broken",
	);
}

async function flowHandoffCriteriaDeviationScenario() {
	const cwd = tempDir("flow-handoff-criteria");
	const dir = createFlow(cwd, "F1-handoff-criteria");
	const { completeGoalWithFact } = await importModule(
		"flow/execution/continue.js",
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
	const dir = createFlow(cwd, "F1-complete-clears-ui");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const { clearFlowActivities } = await importCachedModule(
		"shared/activity-frame.js",
	);
	const { startGoalFromFlow } = await importCachedModule("goal.js");
	const { planSnapshotHash } = await importCachedModule("flow/snapshot.js");
	const sessionFile = join(cwd, "final.jsonl");
	const flow = readFlow(dir);
	const finalGoal = flow.goals[1];
	const finalSnapshot = readFileSync(join(dir, finalGoal.file), "utf8");
	writeFlow(dir, {
		...flow,
		status: "running",
		startedAt: Date.now(),
		currentGoal: 1,
		goals: [
			{ ...flow.goals[0], status: "complete", handoff: "done" },
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
		entriesFor(state, sessionFile).push(completionEntry(sessionFile));

		await commands.get("flow").handler("continue", ctx);
		interval.callback();
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}

	assert(readFlow(dir).status === "complete", "flow did not complete");
	assert(clearedInterval === interval, "goal status timer was not stopped");
	assert(state.statuses.includes(undefined), state.statuses.join(" | "));
	assert(
		globalThis.__PI_FLOW_ACTIVITY__?.active === false,
		"goal activity was not cleared after flow completion",
	);
}

async function completionScenario() {
	const cwd = tempDir("completion");
	createFlow(cwd, "F1-complete");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("start", ctx);
	await flushScheduledGoalStart();
	let planCtx = state.activeCtx;
	await commands.get("flow").handler("status", ctx);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		planCtx,
	);
	await flushScheduledGoalStart();
	let flow = readFlow(join(cwd, ".flow", "flows", "F1-complete"));
	assert(flow.currentGoal === 1, "flow did not advance current Goal");
	assert(flow.goals[0].status === "complete", "Goal not complete");
	assert(flow.goals[1].status === "running", "final acceptance not started");
	assert(
		state.newSessions.at(-1)?.from === planCtx.sessionManager.getSessionFile(),
		"next plan started from wrong same-cwd session",
	);
	assert(
		flow.goals[0].result.handoffGenerated,
		"missing handoff not generated",
	);
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
	flow = readFlow(join(cwd, ".flow", "flows", "F1-complete"));
	assert(flow.status === "complete", "final acceptance did not complete flow");
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
		readFileSync(
			join(cwd, ".flow", "flows", "F1-complete", "flow.html"),
			"utf8",
		).includes("全部完成"),
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

function createFlow(cwd, id, options = {}) {
	const dir = join(cwd, ".flow", "flows", id);
	mkdirSync(dir, { recursive: true });
	const planCount = options.planCount ?? 2;
	const goals = [];
	for (let offset = 0; offset < planCount; offset += 1) {
		const number = offset + 1;
		const final = number === planCount;
		const file = final
			? `G${number}-final-acceptance.md`
			: `G${number}-plan.md`;
		goals.push(
			goal(offset, final ? "Final acceptance" : `Goal ${number}`, file, final),
		);
		writeFileSync(join(dir, file), planMarkdown(number, final));
	}
	writeFlow(dir, {
		schemaVersion: 5,
		language: options.language ?? "zh",
		id,
		title: "Test Flow",
		status: "draft",
		source: { type: "prompt", path: null, originalRequest: "original" },
		createdAt: Date.now(),
		updatedAt: Date.now(),
		startedAt: null,
		currentGoal: 0,
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

function installFakeWorkerRunner(cwd) {
	const command = join(cwd, "fake-worker-runner.mjs");
	writeFileSync(
		command,
		`#!/usr/bin/env node
import { existsSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
writeFileSync(
	join(process.cwd(), "worker-spawn-args.json"),
	JSON.stringify({ args, command: process.argv[1] }, null, 2),
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
		`import { existsSync, mkdirSync, watch, writeFileSync } from "node:fs";\nimport { dirname, join } from "node:path";\nconst args = process.argv.slice(2);\nconst session = args[args.indexOf("--session") + 1];\nconst prompt = args[args.indexOf("-p") + 1] ?? "";\nconst goalIndex = prompt.trim().split(/\\s+/u).at(-1) ?? "0";\nconst marker = (suffix) => join(process.cwd(), \`worker-\${goalIndex}.\${suffix}\`);\nconst waitForRelease = () => new Promise((resolve) => {\n\tconst releasePath = join(process.cwd(), "release-workers");\n\tif (existsSync(releasePath)) return resolve();\n\tconst watcher = watch(process.cwd(), (_event, name) => {\n\t\tif (name !== null && String(name) !== "release-workers") return;\n\t\tif (!existsSync(releasePath)) return;\n\t\twatcher.close();\n\t\tresolve();\n\t});\n});\nconsole.log(JSON.stringify({ type: "agent_start", goalIndex: Number(goalIndex) }));\nif (process.env.PI_FLOW_FAKE_HANG === "1") {\n\twriteFileSync(marker("started"), "");\n\tconst exit = () => {\n\t\twriteFileSync(marker("killed"), "");\n\t\tprocess.exit(0);\n\t};\n\tprocess.on("SIGTERM", exit);\n\tprocess.on("SIGINT", exit);\n\tsetInterval(() => undefined, 1000);\n} else if (process.env.PI_FLOW_FAKE_FAIL_INDEX === goalIndex) {\n\tprocess.exit(1);\n} else {\n\tconsole.log(JSON.stringify({ type: "tool_execution_end", toolCallId: "tool-" + goalIndex, toolName: "bash", result: "ok", isError: false }));\n\twriteFileSync(marker("started"), "");\n\tif (process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE === "1") {\n\t\tawait waitForRelease();\n\t}\n\tconst workerDir = dirname(session);\n\tmkdirSync(workerDir, { recursive: true });\n\twriteFileSync(join(workerDir, "result.json"), JSON.stringify({ goalId: \`worker-\${goalIndex}\`, summary: \`done \${goalIndex}\`, acceptance: "passed", sessionFile: session }, null, 2));\n\tconsole.log(JSON.stringify({ type: "agent_end", messages: [] }));\n}\n`,
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
	const dir = join(cwd, ".flow", "flows", id);
	mkdirSync(dir, { recursive: true });
	const planCount = options.planCount ?? 2;
	const goals = [];
	for (let offset = 0; offset < planCount; offset += 1) {
		const number = offset + 1;
		const final = number === planCount;
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

function createGoalArtifact(cwd, id, sessionFile, sessionName) {
	const dir = join(cwd, ".flow", "goals", id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "plan.md"), goalPlanMarkdown());
	writeFileSync(
		join(dir, "goal.json"),
		`${JSON.stringify(
			{
				schemaVersion: 5,
				language: "zh",
				id,
				title: "Standalone Goal",
				status: "running",
				completionCursor: null,
				source: { type: "prompt", path: null, originalRequest: "original" },
				createdAt: Date.now(),
				updatedAt: Date.now(),
				repairAttempts: 0,
				errors: [],
				sessionFile,
				sessionName,
				snapshot: null,
				snapshotHash: null,
				runtimeGoalId: "runtime-goal",
				result: { summary: null, outcome: null },
				checks: emptyChecks(),
			},
			null,
			2,
		)}\n`,
	);
	return dir;
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
		join(workerDir, "goal.json"),
		`${JSON.stringify(workerGoalArtifact(flow, goalIndex, checks), null, 2)}\n`,
	);
}

function workerGoalArtifact(flow, goalIndex, checks) {
	const goal = flow.goals[goalIndex];
	return {
		schemaVersion: 5,
		language: flow.language,
		id: `G${goalIndex}`,
		title: goal.title,
		status: "running",
		completionCursor: null,
		source: flow.source,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		repairAttempts: 0,
		errors: [],
		sessionFile: null,
		sessionName: null,
		snapshot: null,
		snapshotHash: null,
		runtimeGoalId: `worker-${goalIndex}`,
		result: { summary: null, outcome: null },
		checks,
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

function goalPlanMarkdown() {
	return `# Standalone Goal

## Objective
Do standalone goal.

## Scope
Only this Goal.

## Steps
- [ ] Do work.

## Success Criteria
- Done.

## Verification
- [ ] \`npm test\`

## Notes

## Outcome
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
	flowExtension({
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
			if (state.piStale) throw new Error("stale pi");
			recordSend(state, message, options);
		},
		sendMessage(message, options = {}) {
			if (state.failSend) throw new Error("busy");
			state.customMessages.push({ message, options });
			if (message.display === false)
				state.hiddenMessages.push(String(message.content));
		},
		on(name, handler) {
			if (!handlers.has(name)) handlers.set(name, []);
			handlers.get(name).push(handler);
		},
		setSessionName(name) {
			if (state.piStale) throw new Error("stale pi");
			state.sessionNames.push(name);
		},
		getSessionName() {
			return state.sessionNames.at(-1);
		},
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	});
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
		switches: [],
		newSessions: [],
		select: undefined,
		selects: [],
		confirms: [],
		entries: new Map(),
		failSend: false,
		piStale: false,
		stalePiAfterSessionReplacement: false,
		staleCtxAfterSessionReplacement: false,
		staleSessionFiles: new Set(),
		throwReplacedSessionFile: false,
	};
}

function entriesFor(state, sessionFile) {
	if (!state.entries.has(sessionFile)) state.entries.set(sessionFile, []);
	return state.entries.get(sessionFile);
}

function completionEntry(sessionFile) {
	return {
		type: "custom",
		customType: "pi-flow-goal-completed",
		data: {
			goalId: "goal-1",
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
	return JSON.parse(readFileSync(join(dir, "goal.json"), "utf8"));
}

function writeFlow(dir, flow) {
	writeFileSync(join(dir, "flow.json"), `${JSON.stringify(flow, null, 2)}\n`);
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

function openedReportCount(state) {
	return state.execs.filter((item) =>
		item.args.some((arg) => String(arg).startsWith("http://127.0.0.1:")),
	).length;
}

function hasChinese(text) {
	return /[\u4e00-\u9fff]/u.test(text);
}

function assertFlowNotice(notice, expected) {
	assert(
		(notice ?? "").includes(expected) && !hasChinese(notice ?? ""),
		notice ?? "",
	);
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

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
