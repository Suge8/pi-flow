import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	watch,
	writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";
import { acquireReportPortTestLock } from "./report-port-lock.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-flow-test-${runId}`);
process.env.PI_CODING_AGENT_DIR = join(out, "agent-state");
// 默认断言是中文文案；en 场景自行设置/恢复该变量；固定运行时语言避免机器 locale 引入环境相关失败。
process.env.PI_FLOW_LANGUAGE = "zh";
const srcOut = join(out, "dist");
const TEST_CHECK_TIMEOUT_MINUTES = 0.5;

cleanupStaleFakeWorkers();
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
cpSync(join(root, "prompts"), join(out, "prompts"), { recursive: true });
mkdirSync(join(out, "assets"), { recursive: true });
cpSync(join(root, "assets", "logo.png"), join(out, "assets", "logo.png"));
prepareTestDist(root, srcOut);
function writeFlowTestConfig({
	state = false,
	quality = false,
	generation,
	modelRoles,
	language = "zh",
	background = {},
	checks = {},
	prewalk = false,
	report = { bind: "127.0.0.1", port: 49327, publicBaseUrl: null },
} = {}) {
	writeFileSync(
		join(out, "config.json"),
		JSON.stringify({
			language,
			...(generation === undefined ? {} : { generation }),
			background: {
				command: background.command ?? "pi",
				extensions: background.extensions ?? [],
			},
			checks: {
				tools: checks.tools ?? [],
				timeoutMinutes: checks.timeoutMinutes ?? TEST_CHECK_TIMEOUT_MINUTES,
				openaiFast: checks.openaiFast ?? false,
			},
			modelRoles: {
				reviewers: [{ model: "test/x", thinking: "off" }],
				...(modelRoles ?? {}),
			},
			prewalk: {
				enabled: prewalk,
			},
			report,
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
const releaseReportPortLock = await acquireReportPortTestLock();

try {
	await runScenario(staleFakeWorkerMatchScenario);
	await runScenario(sessionTransitionGateScenario);
	await runScenario(advisorCommandRegistrationScenario);
	await runScenario(bootstrapLazyActivationScenario);
	await runScenario(bootstrapRegistrationRetryScenario);
	await runScenario(flowReportPublicationLifecycleScenario);
	await runScenario(flowReportPortConflictIsolationScenario);
	await runScenario(flowGoalPromptChecklistSyncScenario);
	await runScenario(completionListenerUsesFreshApiAfterReloadScenario);
	await runScenario(flowGoalRuntimePromptContextScenario);
	await runScenario(privateWorkerRequiresParentScenario);
	await runScenario(workerAlreadyCompleteNoticeFormatScenario);
	await runScenario(privateWorkerCompletionExitScenario);
	await runScenario(privateWorkerBlockedExitScenario);
	await runScenario(privateWorkerTodoGateSendFailureScenario);
	await runScenario(privateWorkerInitialPromptScenario);
	await runScenario(privateWorkerControlDisconnectScenario);
	await runScenario(workerSpawnConfigScenario);
	await runScenario(parallelLaneBoardThreeGoalScenario);
	await runScenario(parallelRunSuccessScenario);
	await runScenario(flowParallelStartHtmlFailureScenario);
	await runScenario(flowParallelStopHtmlFailureScenario);
	await runScenario(parallelVisibleEditorEscScenario);
	await runScenario(parallelToParallelRunSuccessScenario);
	await runScenario(parallelStatusPreservesLiveReportScenario);
	await runScenario(parallelRunFailureScenario);
	await runScenario(parallelMissingCompletionProgressScenario);
	await runScenario(parallelBlockedGoScenario);
	await runScenario(parallelBlockedRecoveryScenario);
	await runScenario(parallelRunRecoveryScenario);
	await runScenario(flowParallelStopGoScenario);
	await runScenario(flowParallelConsoleShutdownScenario);
	await runScenario(flowParallelConsoleInputScenario);
	await runScenario(flowParallelStopAllResultsCompleteScenario);
	await runScenario(parallelFanInLockScenario);
	await runScenario(flowConcurrentRecoveryFanInLockScenario);
	await runScenario(flowLockStaleScenario);
	await runScenario(flowConcurrentGoLockScenario);
	await runScenario(flowPrewalkForkStartScenario);
	await runScenario(parallelPrewalkForkScenario);
	await runScenario(flowGoalTurnDoesNotHoldLockScenario);
	await runScenario(schemaScenario);
	await runScenario(currentSchemaOnlyScenario);
	await runScenario(badJsonScenario);
	await runScenario(flowIdSafetyScenario);
	await runScenario(flowBareIdMessageScenario);
	await runScenario(flowBareGoCompleteHintScenario);
	await runScenario(flowWorkspaceHintScenario);
	await runScenario(workerArtifactSingleWriterScenario);
	await runScenario(workerResumeCursorScenario);
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
	await runScenario(flowRepairHtmlFailureScenario);
	await runScenario(runningValidationScenario);
	await runScenario(htmlScenario);
	await runScenario(flowPromptLiteralPlaceholderScenario);
	await runScenario(flowConversationContextEvidenceScenario);
	await runScenario(flowConversationContextEvidenceModelFailureScenario);
	await runScenario(generationAlignConfigScenario);
	await runScenario(flowModelSwitchFailurePersistsPreDraftScenario);
	await runScenario(flowGoalStartCardCopyScenario);
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
	await runScenario(flowAlignmentDeepDepthPersistenceScenario);
	await runScenario(flowAlignmentQuestionGoDraftsScenario);
	await runScenario(flowPromptMarkerHiddenScenario);
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
	await runScenario(invalidWriteScopeTriggersRepairScenario);
	await runScenario(flowSemanticOverridesHandwrittenScenario);
	await runScenario(malformedCurrentFlowSemanticKeepsRepairingScenario);
	await runScenario(missingFlowSemanticTitleKeepsRepairingScenario);
	await runScenario(flowClarificationScenario);
	await runScenario(flowSerialStartHtmlFailureScenario);
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
	await runScenario(flowGenerationCallbackWaitsForLockScenario);
	await runScenario(flowGenerationStopWinsQueuedCallbackScenario);
	await runScenario(flowGenerationPromptWaitsForLockScenario);
	await runScenario(flowGenerationLockedAlignmentInputContinuesScenario);
	await runScenario(flowGenerationLockedBlockingInputContinuesScenario);
	await runScenario(flowGenerationSameRevisionPromptDeliveryScenario);
	await runScenario(flowGenerationStopDuringPromptSwitchScenario);
	await runScenario(flowGenerationTakeoverDuringPromptSwitchScenario);
	await runScenario(alignmentRevisionStrictlyIncreasesScenario);
	await runScenario(flowGenerationSameRevisionCallbacksScenario);
	await runScenario(flowGenerationTakeoverRejectsLateLoaderScenario);
	await runScenario(flowGenerationReconcilesAlignmentFirstScenario);
	await runScenario(flowGenerationRecoversDraftWithoutMetaScenario);
	await runScenario(flowGenerationCleansFinalAlignmentResidueScenario);
	await runScenario(flowGenerationStopIgnoresLatePromptScenario);
	await runScenario(flowGenerationSessionShutdownCleanupScenario);
	await runScenario(flowPreDraftStopGoScenario);
	await runScenario(flowSequentialStopGoScenario);
	await runScenario(flowBlockedGoScenario);
	await runScenario(flowStopDuringRunningQualityScenario);
	await runScenario(flowStopWhileQualityAwaitsRepairScenario);
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
	await runScenario(completionLockConflictRetainsFactScenario);
	await runScenario(flowStartWithoutNewSessionScenario);
	await runScenario(flowStartNewSessionThrowScenario);
	await runScenario(flowStartNewSessionPreReplacementStaleThrowScenario);
	await runScenario(flowStartNewSessionPostReplacementThrowScenario);
	await runScenario(englishFlowDynamicNotificationsScenario);
	await runScenario(englishFlowCardsUseArtifactLanguageScenario);
	await runScenario(flowStartUsesReplacementContextScenario);
	await runScenario(flowResumeMissingSessionScenario);
	await runScenario(flowStartedGoalMissingSessionStopsScenario);
	await runScenario(flowResumeMissingSessionEvidenceScenario);
	await runScenario(flowResumeMissingRuntimeGoalScenario);
	await runScenario(flowResumePendingRuntimeGoalHiddenPromptScenario);
	await runScenario(startResumeCancelScenario);
	await runScenario(sessionNameSyncScenario);
	await runScenario(snapshotMutationScenario);
	await runScenario(snapshotRecoveryPrecheckScenario);
	await runScenario(planFileWatcherSharingScenario);
	await runScenario(flowGoalWatcherScenario);
	await runScenario(flowParallelMainGoalWatcherScenario);
	await runScenario(flowParallelWatcherScenario);
	await runScenario(flowWatcherEventStormScenario);
	await runScenario(goalRuntimeSessionIsolationScenario);
	await runScenario(sessionContextIsolationScenario);
	await runScenario(soakRetainedContextGateScenario);
	await runScenario(ownershipScenario);
	await runScenario(singleStepCompletionNoSaveFailureScenario);
	await runScenario(flowFinalCompletionHtmlFailureScenario);
	await runScenario(finalizeRetryCursorContinueScenario);
	await runScenario(finalizeRetryRefreshesResumeBoundaryScenario);
	await runScenario(completionScenario);
	await runScenario(completionFactClearsGoalUiScenario);
	console.log("flow smoke ok");
} finally {
	await shutdownReportDaemon();
	cleanupFakeWorkersUnder(out);
	rmSync(out, { recursive: true, force: true });
	await releaseReportPortLock();
}

async function shutdownReportDaemon() {
	try {
		const client = await import(
			pathToFileURL(join(srcOut, "shared", "report-client.js")).href
		);
		await client.closeReportClient();
	} catch {}
	const endpointPath = join(
		process.env.PI_CODING_AGENT_DIR,
		"pi-flow-report",
		"endpoint.json",
	);
	let pid;
	try {
		pid = JSON.parse(readFileSync(endpointPath, "utf8")).pid;
	} catch {
		return;
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch (error) {
		if (error?.code !== "ESRCH") throw error;
	}
	// Detached daemon 不是当前进程的 child，无 exit 事件可订阅；测试清理只能按记录 PID 限时确认。
	const startedAt = performance.now();
	while (performance.now() - startedAt < 5_000) {
		if (!processExists(pid)) {
			try {
				if (JSON.parse(readFileSync(endpointPath, "utf8")).pid === pid)
					rmSync(endpointPath, { force: true });
			} catch {}
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`report daemon ${pid} did not stop`);
}

function cleanupStaleFakeWorkers() {
	for (const item of fakeWorkerProcesses()) {
		if (!existsSync(item.root)) killPidTree(item.pid, "SIGKILL");
	}
}

function cleanupFakeWorkersUnder(root) {
	for (const item of fakeWorkerProcesses()) {
		if (item.root === root) killPidTree(item.pid, "SIGKILL");
	}
}

function fakeWorkerProcesses() {
	if (process.platform === "win32") return [];
	try {
		return execFileSync("ps", ["-axww", "-o", "pid=", "-o", "command="], {
			encoding: "utf8",
		})
			.split("\n")
			.flatMap(fakeWorkerProcess)
			.filter((item) => item.pid !== process.pid && item.pid !== process.ppid);
	} catch {
		return [];
	}
}

function fakeWorkerProcess(line) {
	const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
	if (!match) return [];
	const pid = Number(match[1]);
	const root = fakeWorkerRoot(match[2]);
	return Number.isInteger(pid) && pid > 0 && root ? [{ pid, root }] : [];
}

function fakeWorkerRoot(command) {
	const args = command.trim().split(/\s+/u);
	return fakePiRoot(args[1]) ?? fakeWorkerChildRoot(args);
}

function fakePiRoot(arg) {
	return (
		/^(.*\/pi-flow-flow-test-[^/]+)\/[^/]+\/bin\/pi\.mjs$/u.exec(
			arg ?? "",
		)?.[1] ?? undefined
	);
}

function fakeWorkerChildRoot(args) {
	if (args[1] !== "-e") return undefined;
	for (const arg of args) {
		const root =
			/^(.*\/pi-flow-flow-test-[^/]+)\/[^/]+\/worker-\d+\.child-killed$/u.exec(
				arg,
			)?.[1];
		if (root) return root;
	}
	return undefined;
}

function killPidTree(pid, signal) {
	try {
		process.kill(-pid, signal);
	} catch {}
	try {
		process.kill(pid, signal);
	} catch {}
}

function staleFakeWorkerMatchScenario() {
	const fakePi = join(out, "parallel", "bin", "pi.mjs");
	const fakeChild = join(out, "parallel", "worker-1.child-killed");
	assert(
		fakeWorkerRoot(`node ${fakePi} --session x`) === out,
		"fake pi command not matched",
	);
	assert(
		fakeWorkerRoot(`node -e const ${fakeChild} child-pid`) === out,
		"fake worker child command not matched",
	);
	assert(
		!fakeWorkerRoot(
			`node /usr/local/bin/pi --no-session -p prompt ${fakePi} ${fakeChild}`,
		),
		"review prompt text was matched as a fake worker",
	);
}

async function runScenario(fn, name = fn.name) {
	let timeout;
	try {
		await Promise.race([
			fn(),
			new Promise((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`scenario timed out: ${name}`)),
					90_000,
				);
				timeout.unref?.();
			}),
		]);
	} catch (error) {
		cleanupFakeWorkersUnder(out);
		console.error(`flow smoke failed in ${name}`);
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

function trackParallelProgress(onProgressChanged) {
	const statuses = new Map();
	const unsubscribe = onProgressChanged((snapshot) => {
		for (const scope of snapshot.scopes) {
			if (scope.kind !== "parallel") continue;
			for (const agent of scope.agents) {
				const seen = statuses.get(agent.agentKey) ?? [];
				seen.push(agent.progress.status);
				statuses.set(agent.agentKey, seen);
			}
		}
	});
	return {
		saw(agentKey, status) {
			return statuses.get(agentKey)?.includes(status) === true;
		},
		unsubscribe,
	};
}

async function sessionTransitionGateScenario() {
	const {
		cancelSessionTransition,
		pendingSessionTransitionCount,
		requestSessionTransition,
		waitForSessionTransitions,
	} = await importCachedModule("flow/session-transition.js");
	const cwd = tempDir("session-transition-gate");
	const ctx = commandContext(newState(cwd), cwd, join(cwd, "planning.jsonl"));
	let releaseIdle;
	ctx.waitForIdle = () =>
		new Promise((resolve) => {
			releaseIdle = resolve;
		});
	let runs = 0;
	const request = {
		key: "flow:F1",
		ctx,
		run: async () => {
			runs += 1;
		},
		onError: (error) => {
			throw error;
		},
	};
	assert(requestSessionTransition(request), "transition was not accepted");
	assert(
		requestSessionTransition(request),
		"duplicate transition was not merged",
	);
	assert(
		!requestSessionTransition({ ...request, key: "flow:F2" }),
		"conflicting transition replaced the active request",
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert(runs === 0, "transition ran before Pi became idle");
	releaseIdle();
	await waitForSessionTransitions();
	assert(
		runs === 1 && pendingSessionTransitionCount() === 0,
		"transition did not run exactly once and release its state",
	);
	let releaseCancelledWait;
	ctx.waitForIdle = () =>
		new Promise((resolve) => {
			releaseCancelledWait = resolve;
		});
	assert(
		requestSessionTransition(request),
		"cancellable transition was rejected",
	);
	await new Promise((resolve) => setImmediate(resolve));
	cancelSessionTransition(ctx.sessionManager.getSessionFile());
	await waitForSessionTransitions();
	releaseCancelledWait();
	await new Promise((resolve) => setImmediate(resolve));
	assert(runs === 1, "cancelled transition still ran");
}

async function advisorCommandRegistrationScenario() {
	const cwd = tempDir("advisor-command-registration");
	const state = newState(cwd);
	const { commands, shortcuts } = await loadExtension(state);
	assert(commands.has("advisor"), "/advisor command was not registered");
	assert(
		shortcuts.get("alt+s")?.description === "打开子代理监控" &&
			!shortcuts.has("ctrl+f"),
		"Alt+S monitor shortcut was not registered cleanly",
	);
	assert(
		commands.get("advisor").description === "咨询顾问模型",
		`unexpected /advisor description: ${commands.get("advisor").description}`,
	);
}

async function bootstrapLazyActivationScenario() {
	// Flow runtime 是进程级单例：本场景依赖「本进程尚未激活 flow runtime」，
	// 必须先于任何 flow 激活运行（包括场景内部的 review checkpoint 子检查）。
	const reviewState = newState(tempDir("bootstrap-review-checkpoint"));
	entriesFor(reviewState, reviewState.activeSessionFile).push({
		type: "custom",
		customType: "review-checkpoint",
		data: {
			version: 3,
			active: null,
			round: 1,
			phase: "awaiting_agent",
			reportRun: 1,
			history: [],
		},
	});
	const reviewExtension = await loadExtension(reviewState);
	await emit(
		reviewExtension.handlers,
		"session_start",
		{},
		commandContext(reviewState, reviewState.cwd, reviewState.activeSessionFile),
	);
	assert(
		(reviewExtension.handlers.get("agent_end") ?? []).length === 1,
		"standalone review checkpoint loaded more than Review runtime",
	);

	const cwd = tempDir("bootstrap-lazy-activation");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, state.activeSessionFile);
	assert(
		["flow", "review", "advisor"].every((name) => commands.has(name)),
		"bootstrap did not register all command shells",
	);
	await emit(handlers, "session_start", {}, ctx);
	assert(
		(handlers.get("agent_end") ?? []).length === 0,
		"idle session loaded a runtime",
	);
	await Promise.all([
		commands.get("flow").handler("status F999", ctx),
		commands.get("flow").handler("status F998", ctx),
	]);
	assert(
		(handlers.get("agent_end") ?? []).length === 3,
		"concurrent Flow activation duplicated or missed runtime listeners",
	);
	await commands.get("flow").handler("status F997", ctx);
	await emit(handlers, "session_start", {}, ctx);
	await emit(handlers, "session_start", {}, ctx);
	assert(
		(handlers.get("agent_end") ?? []).length === 3,
		"repeated command or Session start duplicated runtime listeners",
	);

	// stale-ctx 回归：flow runtime 加载后，session 重建（新 pi）的 session_start
	// 必须补注册全部运行时，否则引擎会继续持有已失效 session 的 pi。
	const replacementState = newState(cwd);
	const replacement = await loadExtension(replacementState);
	await emit(
		replacement.handlers,
		"session_start",
		{},
		commandContext(replacementState, cwd, replacementState.activeSessionFile),
	);
	assert(
		(replacement.handlers.get("agent_end") ?? []).length === 3,
		"session replacement did not re-register flow runtime on fresh pi",
	);
}

async function bootstrapRegistrationRetryScenario() {
	for (const scenario of [
		{
			name: "review",
			command: "review",
			args: "",
			failEvent: "agent_start",
			preservedEvent: "session_shutdown",
		},
		{
			name: "goal",
			command: "flow",
			args: "status F999",
			failEvent: "tool_call",
			preservedEvent: "tool_execution_end",
		},
		{
			name: "flow",
			command: "flow",
			args: "status F999",
			failEvent: "message_end",
			preservedEvent: "tool_call",
		},
	]) {
		const state = newState(tempDir(`bootstrap-retry-${scenario.name}`));
		const { commands, handlers } = await loadExtension(state);
		const ctx = commandContext(state, state.cwd, state.activeSessionFile);
		state.failRuntimeEventOnce = scenario.failEvent;
		let error;
		try {
			await commands.get(scenario.command).handler(scenario.args, ctx);
		} catch (caught) {
			error = caught;
		}
		assert(
			String(error?.message).includes("injected registration failure"),
			`${scenario.name} activation did not expose registration failure`,
		);
		const preservedCount = (handlers.get(scenario.preservedEvent) ?? []).length;
		assert(
			preservedCount > 0,
			`${scenario.name} did not reach partial registration`,
		);
		await commands.get(scenario.command).handler(scenario.args, ctx);
		assert(
			(handlers.get(scenario.preservedEvent) ?? []).length === preservedCount,
			`${scenario.name} retry duplicated ${scenario.preservedEvent}`,
		);
		assert(
			(handlers.get(scenario.failEvent) ?? []).length > 0,
			`${scenario.name} retry did not register ${scenario.failEvent}`,
		);
	}
}

async function flowReportPublicationLifecycleScenario() {
	// 真实完成链：多步串行中间 Live → 最终 Recent；同路径更高 createdAt 重进 Live。
	const cwd = tempDir("directory-serial-lifecycle");
	const dir = createFlow(cwd, "F1", { planCount: 2 });
	const htmlPath = join(dir, "flow.html");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFileSync(sessionFile, "");
	const flow = readFlow(dir);
	const createdAt = flow.createdAt;
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 0;
	flow.goals[0].status = "running";
	flow.goals[0].sessionFile = sessionFile;
	flow.goals[0].snapshot = readFileSync(join(dir, flow.goals[0].file), "utf8");
	writeFlow(dir, flow);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("status F1", ctx);
	await waitForDirectoryRecord(
		htmlPath,
		(record) => record?.state === "live" && record.generation === createdAt,
		"serial mid-run was not Live",
	);
	const { emitFlowGoalCompleted } =
		await importCachedModule("flow/completion.js");
	emitFlowGoalCompleted(completionEntry(sessionFile).data, ctx);
	await flushScheduledGoalStart();
	const mid = readFlow(dir);
	assert(
		mid.status === "running",
		`expected running after step1: ${mid.status}`,
	);
	assert(mid.goals[0].status === "complete", "step1 not complete");
	assert(mid.goals[1].status === "running", "step2 not started");
	await waitForDirectoryRecord(
		htmlPath,
		(record) => record?.state === "live" && record.generation === createdAt,
		"serial after step1 left Live",
	);
	const nextSession = mid.goals[1].sessionFile;
	assert(nextSession, "step2 session missing");
	const nextCtx = commandContext(state, cwd, nextSession);
	emitFlowGoalCompleted(
		completionEntry(nextSession, {
			goalId: mid.goals[1].goalId ?? "goal-2",
		}).data,
		nextCtx,
	);
	await flushScheduledGoalStart();
	const done = readFlow(dir);
	assert(done.status === "complete", `expected complete: ${done.status}`);
	await waitForDirectoryRecord(
		htmlPath,
		(record) => record?.state === "complete" && record.generation === createdAt,
		"serial final was not Recent",
	);
	const reopenedAt = createdAt + 10_000;
	const reopened = {
		...done,
		status: "running",
		createdAt: reopenedAt,
		updatedAt: reopenedAt,
		completedAt: null,
		currentGoal: 0,
		goals: done.goals.map((goal, index) => ({
			...goal,
			status: index === 0 ? "running" : "pending",
			completedAt: null,
			sessionFile: index === 0 ? sessionFile : null,
			goalId: index === 0 ? "goal-reopen" : null,
		})),
	};
	writeFlow(dir, reopened);
	await commands.get("flow").handler("status F1", ctx);
	await waitForDirectoryRecord(
		htmlPath,
		(record) => record?.state === "live" && record.generation === reopenedAt,
		"reopened Flow did not re-enter Live with higher generation",
	);
	await shutdownReportDaemon();
}

async function waitForDirectoryRecord(
	htmlPath,
	match,
	message,
	timeoutMs = 5_000,
) {
	const deadline = Date.now() + timeoutMs;
	let last;
	while (Date.now() < deadline) {
		last = directoryRecordFor(htmlPath);
		if (match(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`${message}: ${JSON.stringify(last)}`);
}

function directoryRecordFor(htmlPath) {
	const ledgerPath = join(
		process.env.PI_CODING_AGENT_DIR,
		"pi-flow-report",
		"directory.json",
	);
	try {
		const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
		const absolute = resolve(htmlPath);
		return ledger.records.find(
			(record) => record.path === absolute || record.realPath === absolute,
		);
	} catch {
		return undefined;
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
		!systemPrompt.includes("切换下一项前必须重新读取") &&
			systemPrompt.includes("单行精确编辑") &&
			systemPrompt.includes("为什么先跳过") &&
			systemPrompt.includes("可跳到下一个未完成项"),
		"flow system prompt missing single-line edit or blocked-skip rule",
	);
	assert(
		systemPrompt.includes("同一发现连续两轮同向修复") &&
			systemPrompt.includes("穷举 3–5 个替代方案"),
		"flow system prompt missing anti-loop rule",
	);
	assert(
		systemPrompt.includes("由编排系统注入") &&
			systemPrompt.includes("不是用户发言") &&
			systemPrompt.includes("不要向用户提问") &&
			!systemPrompt.includes("pi-flow"),
		"flow system prompt missing orchestration-source rule",
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
	assert(
		resumePrompt.includes("<目标>") &&
			!continuePrompt.includes("<目标>") &&
			continuePrompt.includes("目标与规则见 system prompt"),
		"continuation prompt should not repeat the goal block",
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
	const repairResumeZh = buildResumePrompt(
		activeGoal,
		flowTodoContext,
		undefined,
		{
			repair: true,
		},
	);
	const repairResumeEn = buildResumePrompt(
		{ ...activeGoal, language: "en" },
		flowTodoContext,
		undefined,
		{ repair: true },
	);
	assert(repairResumeZh === "继续", `zh repair resume: ${repairResumeZh}`);
	assert(repairResumeEn === "Continue.", `en repair resume: ${repairResumeEn}`);
	const repairWithAdvisor = buildResumePrompt(
		activeGoal,
		flowTodoContext,
		"建议方向：先修状态源",
		{ repair: true },
	);
	assert(
		repairWithAdvisor.includes("用户手动咨询的顾问建议") &&
			repairWithAdvisor.includes("建议方向：先修状态源") &&
			repairWithAdvisor.endsWith("\n\n继续") &&
			!repairWithAdvisor.includes("<目标>") &&
			!repairWithAdvisor.includes("第一个未完成项"),
		`repair resume with advisor: ${repairWithAdvisor}`,
	);
	const workerPlanPath = join(out, "worker", "G1-plan.md");
	const workerPrompt = buildGoalSystemPrompt(
		{
			...activeGoal,
			artifactId: "G1",
			artifactPlanPath: workerPlanPath,
			artifactPlanDisplayPath: ".flow/F1/G1-plan.md",
			artifactStatePath: join(out, "worker", "G1-worker.json"),
			artifactStateDisplayPath: "G1-worker.json",
		},
		{
			planPath: workerPlanPath,
			recordSection: "Handoff",
			stateFile: "G1-worker.json",
		},
	);
	assert(
		workerPrompt.includes(workerPlanPath) &&
			workerPrompt.includes("Handoff") &&
			workerPrompt.includes("G1-worker.json"),
		"worker goal prompt did not use current worker artifact semantics",
	);
}

async function completionListenerUsesFreshApiAfterReloadScenario() {
	const { emitFlowGoalCompleted } =
		await importCachedModule("flow/completion.js");
	const cwd = tempDir("completion-listener-fresh-api");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const first = await loadExtension(state);
	await first.commands
		.get("flow")
		.handler("status F1", commandContext(state, cwd, state.activeSessionFile));
	state.staleApis.add(state.extensionApis.at(-1));
	const second = await loadExtension(state);
	await second.commands
		.get("flow")
		.handler("status F1", commandContext(state, cwd, state.activeSessionFile));
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFileSync(sessionFile, "");
	const flow = readFlow(dir);
	const snapshot = readFileSync(join(dir, flow.goals[0].file), "utf8");
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	flow.goals[0].sessionFile = sessionFile;
	flow.goals[0].snapshot = snapshot;
	writeFlow(dir, flow);
	const ctx = commandContext(state, cwd, sessionFile);
	emitFlowGoalCompleted(completionEntry(sessionFile).data, ctx);
	await flushScheduledGoalStart();
	const saved = readFlow(dir);
	assert(saved.status === "complete", "stale listener did not complete flow");
	const completeCards = state.customMessages.filter(
		(item) => item.message.details?.title === "Flow Goal 1 已完成",
	);
	assert(
		completeCards.length === 1,
		`fresh Flow complete card count=${completeCards.length}: ${state.customMessages
			.map((item) => item.message.details?.title)
			.join(" | ")} / ${state.notifications.join(" | ")}`,
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
		completedAt: null,
		currentGoal: 0,
		goals: [
			{ ...flow.goals[0], status: "running", sessionFile },
			flow.goals[1],
		],
	});
	const ctx = commandContext(state, cwd, sessionFile);
	await emit(handlers, "session_start", {}, ctx);
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
	const ctx = commandContext(state, cwd, join(cwd, "orphan-worker.jsonl"));

	await emit(handlers, "session_start", {}, ctx);

	assert(
		!existsSync(join(dir, "G1-worker.json")),
		"worker state written without parent env",
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
		await waitForFile(run.workerArtifactPath);
		await waitForCondition(
			() => Boolean(readWorkerArtifact(run.workerArtifactPath)?.completion),
			"private worker completion was not written",
		);
		const artifact = readWorkerArtifact(run.workerArtifactPath);
		assert(
			["running", "complete"].includes(artifact.status),
			`private worker state missing: ${artifact.status}`,
		);
		assert(
			artifact.sessionFile === run.sessionPath,
			"private worker session mismatch",
		);
		assert(
			artifact.completion?.sessionFile === run.sessionPath &&
				artifact.completion?.parallelRunId === run.parallelRunId,
			"private worker completion missing session or parallelRunId",
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

async function privateWorkerBlockedExitScenario() {
	const reason = "完成真机窗口焦点验证";
	const run = await startPrivateWorkerChild("private-worker-blocked", "F1", {
		blockedReason: reason,
	});
	let exited = false;
	const exitPromise = waitForChildExit(run.child).then((exit) => {
		exited = true;
		return exit;
	});
	try {
		await run.control.socket;
		await waitForCondition(
			() =>
				readWorkerArtifact(run.workerArtifactPath)?.handoff?.message === reason,
			"private worker BLOCKED handoff was not written",
		);
		const artifact = readWorkerArtifact(run.workerArtifactPath);
		assert(
			artifact.status === "paused" &&
				artifact.handoff?.kind === "user_action_required" &&
				artifact.completion === null,
			`private worker BLOCKED artifact: ${JSON.stringify(artifact)}`,
		);
		assert(
			readFileSync(join(run.dir, "flow.json"), "utf8") === run.beforeFlowJson,
			"private worker modified flow.json on BLOCKED",
		);
		const exit = await exitPromise;
		assert(exit.code === 0 && exit.signal === null, JSON.stringify(exit));
	} finally {
		run.control.server.close();
		removePrivateWorkerSocket(run.socketPath);
		if (!exited) run.child.kill("SIGKILL");
		await exitPromise.catch(() => undefined);
	}
}

async function privateWorkerTodoGateSendFailureScenario() {
	const run = await startPrivateWorkerChild("private-worker-todo-gate", "F1", {
		failGoalPromptSend: true,
		prepare: (dir) => {
			const planFile = join(dir, "G2-plan.md");
			writeFileSync(
				planFile,
				readFileSync(planFile, "utf8").replace(
					"- [x] Do work.",
					"- [ ] Do work.",
				),
			);
		},
	});
	let exited = false;
	const exitPromise = waitForChildExit(run.child).then((exit) => {
		exited = true;
		return exit;
	});
	try {
		await run.control.socket;
		// 闸门投递失败：worker 把异常事实写进自身 artifact（paused + handoff）后退出。
		await waitForCondition(
			() =>
				readWorkerArtifact(run.workerArtifactPath)?.handoff?.message?.includes(
					"收口提醒发送失败",
				) ?? false,
			"todo gate send failure handoff was not written",
		);
		const artifact = readWorkerArtifact(run.workerArtifactPath);
		assert(
			artifact.status === "paused" &&
				artifact.handoff?.kind === "user_action_required" &&
				artifact.handoff.message.includes("/flow go") &&
				artifact.completion === null,
			`todo gate failure artifact: ${JSON.stringify(artifact)}`,
		);
		// 单写者约束：worker 不得触碰父 flow.json（含 setFlowAttention）。
		assert(
			readFileSync(join(run.dir, "flow.json"), "utf8") === run.beforeFlowJson,
			"todo gate failure wrote parent flow.json from worker",
		);
		const exit = await exitPromise;
		assert(exit.code === 0 && exit.signal === null, JSON.stringify(exit));
	} finally {
		run.control.server.close();
		removePrivateWorkerSocket(run.socketPath);
		if (!exited) run.child.kill("SIGKILL");
		await exitPromise.catch(() => undefined);
	}
}

async function privateWorkerInitialPromptScenario() {
	const { PRIVATE_WORKER_ENV } = await importModule(
		"flow/execution/worker-protocol.js",
	);
	const run = await startPrivateWorkerChild(
		"private-worker-initial-prompt",
		"F1",
		{
			env: { [PRIVATE_WORKER_ENV.initialPrompt]: "1" },
		},
	);
	let exited = false;
	const exitPromise = waitForChildExit(run.child).then((exit) => {
		exited = true;
		return exit;
	});
	try {
		await run.control.socket;
		await waitForFile(run.workerArtifactPath);
		await waitForCondition(
			() => Boolean(readWorkerArtifact(run.workerArtifactPath)?.completion),
			"initial-prompt worker completion was not written",
		);
		const exit = await exitPromise;
		assert(exit.code === 0 && exit.signal === null, JSON.stringify(exit));
		assert(
			!existsSync(join(run.cwd, "private-worker-started")),
			"initial-prompt worker sent a duplicate hidden prompt",
		);
		const artifact = readWorkerArtifact(run.workerArtifactPath);
		assert(
			artifact.completion?.parallelRunId === run.parallelRunId,
			"initial-prompt worker completion missing parallelRunId",
		);
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
			!readWorkerArtifact(run.workerArtifactPath)?.completion,
			"private worker wrote completion after control disconnect",
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
		parallelRun: {
			id: parallelRunId,
			goalIndexes: [1],
			startedAt: Date.now(),
			consoleSessionFile: join(cwd, "console.jsonl"),
			consoleSessionName: "F1-G2 parallel",
		},
	});
	const beforeFlowJson = readFileSync(join(dir, "flow.json"), "utf8");
	const workerArtifactPath = join(dir, "G2-worker.json");
	const sessionPath = join(cwd, `${flowId}-G2 Goal 2.jsonl`);
	const job = {
		flowId,
		flowDir: dir,
		goalIndex: 1,
		parallelRunId,
		sessionPath,
	};
	scriptOptions.prepare?.(dir);
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
				...(scriptOptions.env ?? {}),
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
		workerArtifactPath,
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
		background: {
			command,
			extensions: [userExtension],
		},
		checks: { tools: ["read"] },
	});
	try {
		const sessionFile = join(cwd, "F1-G3 Goal 3.jsonl");
		writeFileSync(join(cwd, "release-worker-spawn"), "");
		handle = spawnWorker({
			flowId,
			goalIndex: 2,
			flowDir,
			parallelRunId: "P-worker-spawn-config",
			cwd,
			initialPrompt: "run worker prompt",
			sessionFile,
		});
		const eventPromise = firstWorkerEvent(handle);
		const exitPromise = workerExit(handle).then((exit) => {
			exited = true;
			return exit;
		});
		const argsPath = join(cwd, "worker-spawn-args.json");
		await waitForFile(argsPath);
		const [event, exit] = await Promise.all([eventPromise, exitPromise]);
		const invocation = JSON.parse(readFileSync(argsPath, "utf8"));
		const args = invocation.args;
		const joined = args.join(" ");
		const extensions = flagValues(args, "-e");
		assert(invocation.command === command, JSON.stringify(invocation));
		assert(exit.code === 0 && exit.signal === null, JSON.stringify(exit));
		assert(event.type === "agent_start", JSON.stringify(event));
		assert(flagValue(args, "--mode") === "json", joined);
		assert(flagValue(args, "--session") === sessionFile, joined);
		assert(args.includes("-p"), joined);
		assert(args.at(-1) === "run worker prompt", joined);
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
		assert(invocation.env[PRIVATE_WORKER_ENV.initialPrompt] === "1", joined);
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
	const { activeParallelLaneBoardCount, showParallelLaneBoard } =
		await importModule("flow/parallel/lane-ui.js");
	const { openProgressScope } = await importModule("shared/agent-progress.js");
	const { ACTIVITY_SPINNER_FRAMES } = await importModule(
		"shared/activity-spinner.js",
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
	const originalNow = Date.now;
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	let now = 1000;
	let tick;
	let intervalCleared = false;
	let board;
	let progressScope;
	Date.now = () => now;
	globalThis.setInterval = (callback) => {
		tick = callback;
		return { unref() {} };
	};
	globalThis.clearInterval = () => {
		intervalCleared = true;
	};
	try {
		assert(
			activeParallelLaneBoardCount() === 0,
			"lane board count was not initially empty",
		);
		progressScope = openProgressScope("parallel", "F1 parallel");
		const progressAgents = new Map(
			[1, 2, 3].map((goalIndex) => [
				goalIndex,
				progressScope.register(`G${goalIndex + 1}`, `Goal ${goalIndex + 1}`),
			]),
		);
		board = showParallelLaneBoard(ctx, dir, flow, [1, 2, 3], {
			scopeId: progressScope.id,
			agents: progressAgents,
		});
		assert(
			activeParallelLaneBoardCount() === 1,
			"mounted lane board was not counted",
		);
		const widgetMountCount = () =>
			state.widgets.filter(
				(item) =>
					item.key === "flow-parallel-lanes" && item.content !== undefined,
			).length;
		assert(widgetMountCount() === 1, "lane board was not mounted exactly once");
		const widgetFactory = state.widgets.find(
			(item) =>
				item.key === "flow-parallel-lanes" &&
				typeof item.content === "function",
		)?.content;
		assert(
			typeof widgetFactory === "function",
			"lane board factory was not set",
		);
		const terminal = { rows: 30 };
		const mountedWidget = widgetFactory(
			{ terminal, requestRender() {} },
			{ fg: (_color, value) => value, bold: (value) => value },
		);
		const expandedLines = mountedWidget.render(100);
		terminal.rows = 5;
		const compactLines = mountedWidget.render(100);
		assert(
			expandedLines.length === 17 &&
				compactLines.length === 5 &&
				widgetMountCount() === 1,
			`mounted lane board did not respond to terminal resize: ${expandedLines.length} -> ${compactLines.length}`,
		);

		let text = latestWidgetText(state);
		assert(
			text.includes("F1-G2+G3+G4 并行控制台"),
			`console title missing:\n${text}`,
		);
		assert(
			text.includes("Goal 2") &&
				text.includes("Goal 3") &&
				text.includes("Goal 4"),
			`three parallel goals missing:\n${text}`,
		);
		assert(
			text.includes("「/flow stop F1」暂停 · 「/flow go F1」继续"),
			`console command hint missing:\n${text}`,
		);
		assert(
			!text.includes("验收："),
			`empty check slots should be hidden:\n${text}`,
		);
		const firstSpinner =
			ACTIVITY_SPINNER_FRAMES[
				Math.floor(now / 100) % ACTIVITY_SPINNER_FRAMES.length
			];
		assert(
			text.includes(`${firstSpinner} 思考中`),
			`running lane missing thinking spinner:\n${text}`,
		);
		assertRunningLaneFirstActivity(text, "G2", `${firstSpinner} 思考中`);
		assert(typeof tick === "function", "lane board timer was not started");
		now = 2500;
		writeWorkerGoalArtifact(dir, flow, 1, qualityFailedChecks());
		tick();
		text = latestWidgetText(state);
		assert(text.includes("2s"), `lane elapsed did not refresh:\n${text}`);
		assert(
			!text.includes("优化中") && widgetMountCount() === 1,
			`elapsed tick read lane state or remounted the widget:\n${text}`,
		);
		const refreshedSpinner =
			ACTIVITY_SPINNER_FRAMES[
				Math.floor(now / 100) % ACTIVITY_SPINNER_FRAMES.length
			];
		assert(
			refreshedSpinner !== firstSpinner &&
				text.includes(`${refreshedSpinner} 思考中`),
			`running lane spinner did not refresh:\n${text}`,
		);
		board.updateWorkerEvent(1);
		text = latestWidgetText(state);
		assert(
			text.includes("优化中") && widgetMountCount() === 1,
			`worker event did not refresh its lane without remounting:\n${text}`,
		);
		writeWorkerGoalArtifact(dir, flow, 1, emptyChecks());
		board.updateWorkerEvent(1);
		flow.goals[1].title =
			"这是一个故意很长用于验证紧凑布局仍能看见当前活动和静默告警的并行步骤标题";
		now = 181_000;
		tick();
		text = latestWidgetText(state);
		assert(
			text.includes("⚠ 3 分钟无活动"),
			`silent lane warning missing:\n${text}`,
		);
		const compactSilent = renderWidgetContent(
			state.widgets.at(-1)?.content,
			80,
			5,
		);
		const compactSilentLane = compactSilent
			.split("\n")
			.find((line) => line.includes("G2") && line.includes("calls"));
		assert(
			compactSilentLane?.includes("⚠ 3 分钟无活动") &&
				compactSilentLane.includes("0 calls · 0.0k tok"),
			`compact lane hid its silent warning:\n${compactSilent}`,
		);

		now = 182_000;
		const toolStart = {
			type: "tool_execution_start",
			toolCallId: "lane-bash",
			toolName: "bash",
			args: { command: "echo lane" },
		};
		progressScope.feed("G2", toolStart);
		text = latestWidgetText(state);
		assert(
			text.includes("bash echo lane · 0s") &&
				text.includes("1 calls · 0.0k tok"),
			`lane tool progress missing:\n${text}`,
		);
		const compactTool = renderWidgetContent(
			state.widgets.at(-1)?.content,
			80,
			5,
		);
		const compactToolLane = compactTool
			.split("\n")
			.find((line) => line.includes("G2") && line.includes("calls"));
		assert(
			compactToolLane?.includes("bash echo lane · 0s") &&
				compactToolLane.includes("1 calls · 0.0k tok"),
			`compact lane hid its current tool:\n${compactTool}`,
		);
		flow.goals[1].title = "Goal 2";
		now = 183_000;
		const toolEnd = {
			type: "tool_execution_end",
			toolCallId: "lane-bash",
			toolName: "bash",
			isError: false,
		};
		progressScope.feed("G2", toolEnd);
		text = latestWidgetText(state);
		assert(text.includes("✓ bash echo lane · 1s"), text);

		writeWorkerGoalArtifact(dir, flow, 1, runningChecks());
		const messageEnd = {
			type: "message_end",
			message: {
				role: "assistant",
				usage: { totalTokens: 9_045, cost: { total: 0.02 } },
			},
		};
		progressScope.feed("G2", messageEnd);
		board.updateWorkerEvent(1);
		text = latestWidgetText(state);
		assert(
			text.includes("验收：… 进行中") && text.includes("1 calls · 9.0k tok"),
			text,
		);

		writeWorkerGoalArtifact(dir, flow, 1, qualityFailedChecks());
		board.updateWorkerEvent(1);
		text = latestWidgetText(state);
		assert(
			!text.includes("✓ G2") &&
				text.includes("优化中") &&
				text.includes("验收：✓ 通过") &&
				text.includes("质检：✗ 失败"),
			text,
		);

		writeWorkerGoalArtifact(dir, flow, 2, failedChecks());
		board.updateWorkerEvent(2);
		text = latestWidgetText(state);
		assert(
			text.includes("G3") &&
				text.includes("补完中") &&
				text.includes("验收：✗ 失败"),
			text,
		);

		board.updateWorkerExit(3, 1, null);
		text = latestWidgetText(state);
		assert(
			text.includes("✗ G4") &&
				text.includes("已中断") &&
				text.includes("退出码 1"),
			text,
		);
		board.dispose();
		progressScope.close();
		assert(
			activeParallelLaneBoardCount() === 0,
			"disposed lane board remained active",
		);
		assert(intervalCleared, "lane board timer was not cleared");
		const widgetCalls = state.widgets.filter(
			(item) => item.key === "flow-parallel-lanes",
		);
		assert(
			widgetMountCount() === 1 &&
				widgetCalls.length === 2 &&
				widgetCalls.at(-1)?.content === undefined,
			"lane board was remounted or not cleared exactly once",
		);
	} finally {
		if (!intervalCleared) board?.dispose();
		progressScope?.close();
		Date.now = originalNow;
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
}

async function parallelRunSuccessScenario() {
	const cwd = tempDir("parallel-batch-success");
	const dir = createParallelFlow(cwd, "F1");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE = "1";
	let progressTracker;
	let start;
	let startedParallelRunId;
	let watcherProbe;
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		const { onProgressChanged } = await importCachedModule(
			"shared/agent-progress.js",
		);
		progressTracker = trackParallelProgress(onProgressChanged);
		watcherProbe = installDirectoryWatchProbe(dir);

		start = commands.get("flow").handler("go F1", ctx);
		await waitForParallelRunPrepared(dir, [1, 2]);
		const orchestratorSession = state.newSessions[0]?.to;
		assert(
			state.newSessions.length === 1 &&
				state.newSessions[0].from === join(cwd, "planning.jsonl"),
			"parallel batch did not open an orchestrator session",
		);
		assert(
			state.sessionNames.includes("F1-G2+G3 并行控制台"),
			"parallel console session was not named",
		);
		await waitForCondition(
			() => latestWidgetText(state).includes("✓ bash echo worker"),
			"parallel lane widget did not show structured worker progress",
			30_000,
		);
		const laneText = latestWidgetText(state);
		assert(
			watcherProbe.active() === 1 && watcherProbe.maximum() === 1,
			`parallel batch used ${watcherProbe.active()} active / ${watcherProbe.maximum()} peak OS watchers`,
		);
		const { isFlowEditorInputHidden } = await importCachedModule(
			"shared/activity-frame.js",
		);
		assert(
			!isFlowEditorInputHidden(),
			"parallel console should keep editor input visible",
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
			assert(
				goal.status === "running" &&
					Number.isFinite(goal.startedAt) &&
					goal.completedAt === null,
				`G${goalIndex} start timestamp not persisted`,
			);
			assert(
				goal.sessionFile ===
					join(cwd, `F1-G${goalIndex + 1} Goal ${goalIndex + 1}.jsonl`),
				`G${goalIndex} worker session not persisted`,
			);
			assert(
				!goal.sessionFile.startsWith(dir),
				`G${goalIndex} worker session was stored under flow dir`,
			);
			assert(
				goal.snapshot === snapshot,
				`G${goalIndex} snapshot not persisted`,
			);
		}
		await waitForDirectoryRecord(
			join(dir, "flow.html"),
			(record) => record?.state === "live",
			"running parallel batch was not Live in directory",
		);
		writeFileSync(join(cwd, "release-workers"), "");
		await start;
		await flushScheduledGoalStart();

		const flow = readFlow(dir);
		assert(flow.goals[1].status === "complete", "parallel G2 not complete");
		assert(flow.goals[2].status === "complete", "parallel G3 not complete");
		assert(
			progressTracker.saw("G2", "complete") &&
				progressTracker.saw("G3", "complete"),
			"successful workers were not published as complete progress",
		);
		assert(
			[1, 2].every(
				(index) =>
					Number.isFinite(flow.goals[index].completedAt) &&
					flow.goals[index].completedAt >= flow.goals[index].startedAt,
			),
			"parallel fan-in did not stamp completed goals",
		);
		assert(
			flow.goals[3].status === "running",
			"next serial goal did not start",
		);
		assert(flow.currentGoal === 3, "parallel fan-in did not advance to G4");
		assert(flow.parallelRun === null, "parallel run was not cleared");
		assert(
			watcherProbe.active() === 1 && watcherProbe.maximum() === 1,
			"parallel fan-in retained batch watchers or opened overlapping watchers",
		);
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
			"parallel console left editor input hidden",
		);
		assert(
			state.newSessions.length === 2 &&
				state.newSessions[1].from === orchestratorSession,
			"G4 did not start from the console session",
		);
		assert(
			state.customMessages.some(
				(item) =>
					item.message.details?.title === "Flow 并行已收口" &&
					item.message.content.includes("第 2 步 · Goal 2：done 1") &&
					item.message.content.includes(
						"下一步：第 4 步 · Final acceptance 将在 Resume 中打开",
					),
			),
			`parallel console result card missing: ${state.customMessages
				.map(
					(item) => `${item.message.details?.title}\n${item.message.content}`,
				)
				.join("\n---\n")}`,
		);
		assert(
			existsSync(join(dir, "G2-worker.json")) &&
				existsSync(join(dir, "G3-worker.json")),
			"worker artifact files missing",
		);
		assert(
			!existsSync(join(dir, "workers")),
			"parallel runtime created an unsupported workers dir",
		);
		for (const goalIndex of [1, 2]) {
			const artifact = readWorkerArtifact(
				join(dir, `G${goalIndex + 1}-worker.json`),
			);
			assert(
				artifact.completion?.parallelRunId === startedParallelRunId,
				`G${goalIndex} completion missing parallelRunId`,
			);
		}
	} finally {
		progressTracker?.unsubscribe();
		delete process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE;
		writeFileSync(join(cwd, "release-workers"), "");
		if (start) await start.catch(() => undefined);
		watcherProbe?.restore();
		restorePi();
	}
}

async function flowParallelStartHtmlFailureScenario() {
	const cwd = tempDir("parallel-start-html-failure");
	const dir = createParallelFlow(cwd, "F1");
	breakFlowHtml(dir);
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE = "1";
	let start;
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		start = commands.get("flow").handler("go F1", ctx);
		await waitForParallelRunPrepared(dir, [1, 2]);
		const { activeParallelBatchForDir } = await importCachedModule(
			"flow/parallel/batch-runner.js",
		);
		assert(
			activeParallelBatchForDir(dir),
			"HTML failure prevented active parallel batch registration",
		);
		await Promise.all([
			waitForFile(join(cwd, "worker-1.started")),
			waitForFile(join(cwd, "worker-2.started")),
		]);
		writeFileSync(join(cwd, "release-workers"), "");
		await start;
		await flushScheduledGoalStart();
		const flow = readFlow(dir);
		assert(
			flow.goals[1].status === "complete" &&
				flow.goals[2].status === "complete" &&
				flow.goals[3].status === "running" &&
				flow.parallelRun === null,
			`HTML failure stopped parallel fan-in or next scheduling: ${JSON.stringify(flow)}`,
		);
		assertReportRefreshFailure(state);
		assertNoPlanRepair(state);
	} finally {
		delete process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE;
		writeFileSync(join(cwd, "release-workers"), "");
		if (start) await start.catch(() => undefined);
		restorePi();
	}
}

async function flowParallelStopHtmlFailureScenario() {
	const cwd = tempDir("parallel-stop-html-failure");
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
		breakFlowHtml(dir);
		await commands.get("flow").handler("stop F1", ctx);
		await run;
		const { activeParallelBatchForDir } = await importCachedModule(
			"flow/parallel/batch-runner.js",
		);
		const flow = readFlow(dir);
		assert(
			flow.status === "paused" &&
				flow.goals[1].status === "paused" &&
				flow.goals[2].status === "paused" &&
				!activeParallelBatchForDir(dir),
			`HTML failure left parallel stop unsettled: ${JSON.stringify(flow)}`,
		);
		assertReportRefreshFailure(state);
		assert(
			state.notifications.some((message) => message.includes("Flow 已暂停")),
			`HTML failure suppressed stop notice: ${state.notifications.join(" | ")}`,
		);
		assertNoPlanRepair(state);
	} finally {
		delete process.env.PI_FLOW_FAKE_HANG;
		if (run) await run.catch(() => undefined);
		restorePi();
	}
}

async function parallelToParallelRunSuccessScenario() {
	const cwd = tempDir("parallel-to-parallel-success");
	const dir = createParallelToParallelFlow(cwd, "F1");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE = "1";
	let start;
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));

		start = commands.get("flow").handler("go F1", ctx);
		await waitForParallelRunPrepared(dir, [1, 2]);
		writeFileSync(join(cwd, "release-workers"), "");
		await start;
		await flushScheduledGoalStart();

		const flow = readFlow(dir);
		assert(flow.goals[1].status === "complete", "first batch G2 missed");
		assert(flow.goals[2].status === "complete", "first batch G3 missed");
		assert(flow.goals[3].status === "complete", "second batch G4 missed");
		assert(flow.goals[4].status === "complete", "second batch G5 missed");
		assert(flow.goals[5].status === "running", "final step did not start");
		assert(flow.currentGoal === 5, "parallel-to-parallel did not advance");
		assert(flow.parallelRun === null, "parallel-to-parallel kept parallelRun");
		assert(
			state.sessionNames.includes("F1-G2+G3 并行控制台") &&
				state.sessionNames.includes("F1-G4+G5 并行控制台"),
			`parallel console sessions missing: ${state.sessionNames.join(", ")}`,
		);
		const workerRuns = readFileSync(join(cwd, "worker-runs.log"), "utf8")
			.trim()
			.split("\n");
		assert(
			JSON.stringify([...workerRuns].sort()) ===
				JSON.stringify(["1", "2", "3", "4"]),
			`parallel-to-parallel workers were not one per lane: ${workerRuns.join(",")}`,
		);
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
		await waitForParallelRunPrepared(dir, [1, 2]);
		const htmlPath = join(dir, "flow.html");
		await waitForFile(htmlPath);
		await changeSourceUntilHtmlMatches(
			htmlPath,
			() =>
				writeFileSync(
					join(dir, "G2-plan.md"),
					planMarkdown(2, false).replace(
						"Do work.",
						"Worker live status survives.",
					),
				),
			(content) => content.includes("Worker live status survives."),
		);
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
		const successfulCompletedAt = flow.goals[1].completedAt;
		assert(
			Number.isFinite(successfulCompletedAt),
			"successful worker completion timestamp was not persisted",
		);
		assert(flow.goals[2].status === "paused", "failed worker did not pause");
		assert(
			flow.goals[2].sessionFile,
			"failed worker did not keep worker session",
		);
		assert(
			flow.goals[3].status === "pending",
			"batch failure started unbatched ready goal",
		);
		assert(
			flow.goals[4].status === "pending",
			"batch failure started final goal",
		);
		assert(flow.status === "paused", "batch failure did not pause the flow");
		assert(
			flow.currentGoal === 2,
			"current goal did not point to failed worker",
		);
		assert(flow.parallelRun?.id, "failed parallel run was not preserved");
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
			error.includes("缺少 worker completion"),
			`batch failure missing completion state: ${error}`,
		);
		assert(
			error.includes("stderr：fake worker failed 2"),
			`batch failure missing stderr: ${error}`,
		);
		assert(
			state.newSessions.length === 1 &&
				state.sessionNames.includes("F1-G2+G3 并行控制台"),
			"batch failure did not stay within the console session",
		);
		delete process.env.PI_FLOW_FAKE_FAIL_INDEX;
		await commands.get("flow").handler("go", ctx);
		await flushScheduledGoalStart();
		const retried = readFlow(dir);
		assert(
			retried.goals[1].status === "complete",
			"manual retry reran successful worker",
		);
		assert(
			retried.goals[1].completedAt === successfulCompletedAt,
			"manual retry rewrote successful worker completion timestamp",
		);
		assert(
			retried.goals[2].status === "complete",
			"manual retry did not complete failed worker",
		);
		assert(
			retried.goals[3].status === "running",
			"manual retry did not start next ready goal",
		);
		assert(
			retried.parallelRun === null,
			"manual retry recreated a parallel run",
		);
		assert(
			state.newSessions.length === 2 && state.switches.length === 1,
			"manual retry did not restore console and open next session",
		);
		const workerRuns = readFileSync(join(cwd, "worker-runs.log"), "utf8")
			.trim()
			.split("\n");
		assert(
			workerRuns.filter((item) => item === "1").length === 1,
			`successful worker reran: ${workerRuns.join(",")}`,
		);
		assert(
			workerRuns.filter((item) => item === "2").length === 2,
			`failed worker did not rerun once: ${workerRuns.join(",")}`,
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

async function parallelMissingCompletionProgressScenario() {
	const cwd = tempDir("parallel-missing-completion-progress");
	const dir = createParallelFlow(cwd, "F1");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_MISSING_COMPLETION_INDEX = "2";
	let progressTracker;
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		const { onProgressChanged } = await importCachedModule(
			"shared/agent-progress.js",
		);
		progressTracker = trackParallelProgress(onProgressChanged);

		await commands.get("flow").handler("go F1", ctx);
		assert(
			progressTracker.saw("G3", "error"),
			"exit 0 without completion was not published as error progress",
		);
		const flow = readFlow(dir);
		assert(flow.status === "paused", "missing completion did not pause Flow");
		assert(
			flow.goals[2].status === "paused",
			"missing completion did not pause its lane",
		);
	} finally {
		progressTracker?.unsubscribe();
		delete process.env.PI_FLOW_FAKE_MISSING_COMPLETION_INDEX;
		restorePi();
	}
}

async function parallelBlockedGoScenario() {
	const cwd = tempDir("parallel-blocked-go");
	const dir = createParallelFlow(cwd, "F1");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_BLOCK_INDEX = "1";
	process.env.PI_FLOW_FAKE_BLOCK_REASON = "完成真机窗口焦点验证";
	process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE = "1";
	let progressTracker;
	let run;
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const planningCtx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		const { onProgressChanged } = await importCachedModule(
			"shared/agent-progress.js",
		);
		progressTracker = trackParallelProgress(onProgressChanged);
		run = commands.get("flow").handler("go F1", planningCtx);
		await waitForParallelRunPrepared(dir, [1, 2]);
		const settled = await Promise.race([
			run.then(() => true),
			new Promise((resolve) => setTimeout(() => resolve(false), 30_000)),
		]);
		assert(settled, "parallel BLOCKED waited for the other lane");
		assert(
			progressTracker.saw("G2", "error"),
			"BLOCKED worker was not published as error progress",
		);

		let flow = readFlow(dir);
		assert(
			flow.status === "paused" &&
				flow.currentGoal === 1 &&
				flow.goals[1].status === "paused" &&
				flow.goals[2].status === "paused" &&
				flow.attention?.kind === "user_action_required" &&
				flow.attention.message === "完成真机窗口焦点验证" &&
				flow.parallelRun?.goalIndexes.join(",") === "1,2",
			`parallel BLOCKED state: ${JSON.stringify(flow)}`,
		);
		await assertFakeWorkerParentsGone(cwd, [1, 2], true);
		assert(
			!state.customMessages.some(
				(item) => item.message.details?.title === "Flow 并行已收口",
			),
			"parallel BLOCKED emitted a settlement card",
		);
		const takeoverBox = latestWidgetTextForKey(state, "goal-progress");
		assert(
			takeoverBox.includes("等待你接管") &&
				takeoverBox.includes("待办：完成真机窗口焦点验证") &&
				takeoverBox.includes("/flow go F1"),
			`parallel BLOCKED takeover box: ${takeoverBox}`,
		);

		delete process.env.PI_FLOW_FAKE_BLOCK_INDEX;
		delete process.env.PI_FLOW_FAKE_BLOCK_REASON;
		delete process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE;
		await commands.get("flow").handler("go F1", planningCtx);
		await flushScheduledGoalStart();
		flow = readFlow(dir);
		assert(
			flow.attention === null &&
				flow.parallelRun === null &&
				flow.goals[1].status === "complete" &&
				flow.goals[2].status === "complete" &&
				flow.goals[3].status === "running",
			`parallel BLOCKED resume state: ${JSON.stringify(flow)}`,
		);
		assert(
			readWorkerArtifact(join(dir, "G2-worker.json"))?.handoff === null,
			"parallel BLOCKED handoff survived resume",
		);
	} finally {
		progressTracker?.unsubscribe();
		delete process.env.PI_FLOW_FAKE_BLOCK_INDEX;
		delete process.env.PI_FLOW_FAKE_BLOCK_REASON;
		delete process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE;
		writeFileSync(join(cwd, "release-workers"), "");
		if (run) await run.catch(() => undefined);
		restorePi();
	}
}

async function parallelBlockedRecoveryScenario() {
	const cwd = tempDir("parallel-blocked-recovery");
	const dir = await createCrashedParallelFlow(cwd, "F1");
	writeWorkerHandoff(
		dir,
		readFlow(dir),
		2,
		"P-crashed",
		"完成重启后的真机验证",
	);
	const restorePi = installFakePi(cwd);
	try {
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));

		await commands.get("flow").handler("go F1", ctx);
		let flow = readFlow(dir);
		assert(
			flow.status === "paused" &&
				flow.currentGoal === 2 &&
				flow.goals[1].status === "paused" &&
				flow.goals[2].status === "paused" &&
				flow.attention?.message === "完成重启后的真机验证",
			`parallel recovered BLOCKED state: ${JSON.stringify(flow)}`,
		);
		assert(
			!existsSync(join(cwd, "worker-runs.log")),
			"parallel recovery restarted workers before takeover",
		);

		await commands.get("flow").handler("go F1", ctx);
		await flushScheduledGoalStart();
		flow = readFlow(dir);
		assert(
			flow.attention === null &&
				flow.parallelRun === null &&
				flow.goals[1].status === "complete" &&
				flow.goals[2].status === "complete" &&
				flow.goals[3].status === "running",
			`parallel recovered BLOCKED resume: ${JSON.stringify(flow)}`,
		);
	} finally {
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
	const interruptedChecks = emptyChecks();
	interruptedChecks.acceptance.active = {
		round: 1,
		generation: "interrupted-generation",
		runId: "interrupted-run",
		inputHash: "interrupted-input",
		models: [
			{
				key: "model-a",
				label: "model-a",
				outcome: {
					result: "passed",
					summary: "model-a passed",
					details: "PASS\nmodel-a passed",
				},
			},
			{
				key: "model-b",
				label: "model-b",
				outcome: {
					result: "passed",
					summary: "model-b passed",
					details: "PASS\nmodel-b passed",
				},
			},
			{ key: "model-c", label: "model-c", outcome: null },
		],
	};
	writeWorkerGoalArtifact(dir, readFlow(dir), 2, interruptedChecks);
	const restorePi = installFakePi(cwd);
	try {
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
			flow.goals[2].status === "complete",
			"partial recovery did not restart and complete missing result",
		);
		assert(
			flow.goals[3].status === "running",
			"partial recovery did not continue to next step",
		);
		const workerRuns = readFileSync(join(cwd, "worker-runs.log"), "utf8")
			.trim()
			.split("\n");
		assert(
			workerRuns.filter((item) => item === "1").length === 0,
			`partial recovery reran completed worker: ${workerRuns.join(",")}`,
		);
		assert(
			workerRuns.filter((item) => item === "2").length === 1,
			`partial recovery did not rerun missing worker once: ${workerRuns.join(",")}`,
		);
		const resumedCheck = readWorkerArtifact(join(dir, "G3-worker.json"))?.checks
			.acceptance.active;
		assert(
			resumedCheck?.models[0]?.outcome?.summary === "model-a passed" &&
				resumedCheck.models[1]?.outcome?.summary === "model-b passed" &&
				resumedCheck.models[2]?.outcome === null,
			`parallel recovery discarded reviewer checkpoint: ${JSON.stringify(resumedCheck)}`,
		);
		assertRecoveryNotice(state, ["已收口 第 2 步", "已重置 第 3 步"]);
	} finally {
		restorePi();
	}
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
		await waitForParallelRunPrepared(dir, [1, 2]);
		const restarted = readFlow(dir);
		assert(
			restarted.parallelRun?.id === "P-crashed",
			"empty recovery did not reconcile the existing run id",
		);
		assert(
			JSON.stringify(restarted.parallelRun?.goalIndexes) ===
				JSON.stringify([1, 2]),
			"empty recovery did not start next parallel batch",
		);
		await waitForCondition(
			() => state.notifications.some((item) => item.includes("Flow 并行恢复")),
			"empty recovery notice missing",
			30_000,
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
		await assertFakeWorkerParentsGone(cwd, [1, 2]);
	} finally {
		delete process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE;
		writeFileSync(join(cwd, "release-workers"), "");
		if (run) await run.catch(() => undefined);
		restorePi();
	}
}

async function parallelVisibleEditorEscScenario() {
	const cwd = tempDir("parallel-visible-editor-esc");
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
		const { handleFlowActivityInput } = await importCachedModule(
			"shared/activity-frame.js",
		);
		const consumed = handleFlowActivityInput("escape", {
			matches(data, action) {
				return data === "escape" && action === "app.interrupt";
			},
		});
		if (!consumed) await commands.get("flow").handler("stop F1", ctx);
		await run;
		assert(consumed, "visible parallel console did not capture Esc");
		const flow = readFlow(dir);
		assert(flow.status === "paused", "parallel Esc did not pause Flow");
		assert(
			flow.goals[1].status === "paused" && flow.goals[2].status === "paused",
			"parallel Esc did not pause active lanes",
		);
	} finally {
		delete process.env.PI_FLOW_FAKE_HANG;
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
			waitForFile(join(cwd, "worker-1.child-killed.started")),
			waitForFile(join(cwd, "worker-2.child-killed.started")),
		]);
		await commands.get("flow").handler("stop F1", ctx);
		await run;
		let flow = readFlow(dir);
		assert(flow.status === "paused", "parallel stop did not pause Flow");
		assert(flow.parallelRun?.id, "parallel stop did not preserve parallelRun");
		assert(
			flow.goals[0].status === "complete",
			"parallel stop lost previous completion",
		);
		assert(flow.goals[1].status === "paused", "parallel stop did not pause G2");
		assert(flow.goals[2].status === "paused", "parallel stop did not pause G3");
		assert(
			existsSync(join(cwd, "worker-1.killed")) &&
				existsSync(join(cwd, "worker-2.killed")),
			"parallel stop did not abort workers",
		);
		await Promise.all([
			waitForFile(join(cwd, "worker-1.child-killed")),
			waitForFile(join(cwd, "worker-2.child-killed")),
		]);
		await assertFakeWorkersGone(cwd, [1, 2]);

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

async function flowParallelConsoleShutdownScenario() {
	const { rememberedFlowContext } = await importCachedModule("flow/runtime.js");
	const cwd = tempDir("parallel-console-shutdown");
	const dir = createParallelFlow(cwd, "F1");
	const restorePi = installFakePi(cwd);
	process.env.PI_FLOW_FAKE_HANG = "1";
	let run;
	try {
		const state = newState(cwd);
		const { commands, handlers } = await loadExtension(state);
		const planningCtx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		run = commands.get("flow").handler("go F1", planningCtx);
		await Promise.all([
			waitForFile(join(cwd, "worker-1.started")),
			waitForFile(join(cwd, "worker-2.started")),
			waitForFile(join(cwd, "worker-1.child-killed.started")),
			waitForFile(join(cwd, "worker-2.child-killed.started")),
		]);
		const consoleCtx = state.activeCtx;
		let flow = readFlow(dir);
		assert(
			flow.parallelRun?.consoleSessionFile ===
				consoleCtx.sessionManager.getSessionFile(),
			"parallel console session did not own parallelRun",
		);

		await emit(handlers, "session_shutdown", {}, consoleCtx);
		await run;
		assert(
			rememberedFlowContext(consoleCtx.sessionManager.getSessionFile()) ===
				undefined,
			"stable parallel stop retained console context",
		);
		flow = readFlow(dir);
		assert(flow.status === "paused", "console shutdown did not pause Flow");
		assert(
			flow.parallelRun?.id,
			"console shutdown did not preserve parallelRun for reconcile",
		);
		assert(
			flow.goals[1].status === "paused" && flow.goals[2].status === "paused",
			"console shutdown did not pause unfinished lanes",
		);
		assert(
			existsSync(join(cwd, "worker-1.killed")) &&
				existsSync(join(cwd, "worker-2.killed")),
			"console shutdown did not abort workers",
		);
		await Promise.all([
			waitForFile(join(cwd, "worker-1.child-killed")),
			waitForFile(join(cwd, "worker-2.child-killed")),
		]);
		await assertFakeWorkersGone(cwd, [1, 2]);

		delete process.env.PI_FLOW_FAKE_HANG;
		await commands.get("flow").handler("go F1", planningCtx);
		await flushScheduledGoalStart();
		flow = readFlow(dir);
		assert(
			flow.parallelRun === null,
			"go after console shutdown kept parallelRun",
		);
		assert(
			flow.goals[1].status === "complete" &&
				flow.goals[2].status === "complete",
			"go after console shutdown did not complete paused lanes",
		);
		assert(
			flow.goals[3].status === "running",
			"go after console shutdown did not schedule next step",
		);
	} finally {
		delete process.env.PI_FLOW_FAKE_HANG;
		if (run) await run.catch(() => undefined);
		restorePi();
	}
}

async function flowParallelConsoleInputScenario() {
	const cwd = tempDir("parallel-console-input");
	const dir = createParallelFlow(cwd, "F1");
	const consoleSession = join(cwd, "console.jsonl");
	writeFileSync(consoleSession, "");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.parallelRun = {
		id: "P-console-input",
		goalIndexes: [1, 2],
		startedAt: Date.now(),
		consoleSessionFile: consoleSession,
		consoleSessionName: "F1-G2+G3 并行控制台",
	};
	flow.goals[1].status = "running";
	flow.goals[2].status = "running";
	writeFlow(dir, flow);
	const state = newState(cwd);
	const { handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, consoleSession);
	await emit(handlers, "session_start", {}, ctx);

	const blocked = await emitLast(
		handlers,
		"input",
		{ source: "user", text: "hello" },
		ctx,
	);
	assert(blocked?.action === "handled", "console input was not intercepted");
	assert(
		state.notifications
			.at(-1)
			?.includes("控制台只允许「/flow go F1」或「/flow stop F1」"),
		`console input notice missing: ${state.notifications.at(-1)}`,
	);
	assert(state.sentMessages.length === 0, "console input reached the LLM");

	const allowed = await emitLast(
		handlers,
		"input",
		{ source: "user", text: "/flow go F1" },
		ctx,
	);
	assert(allowed === undefined, "console command input was intercepted");
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
		consoleSessionFile: join(cwd, "console.jsonl"),
		consoleSessionName: "F1-G2+G3 并行控制台",
	};
	for (const goalIndex of [1, 2]) {
		flow.goals[goalIndex].status = "running";
		flow.goals[goalIndex].sessionFile = join(
			cwd,
			`F1-G${goalIndex + 1} Goal ${goalIndex + 1}.jsonl`,
		);
	}
	flow.goals[3].status = "complete";
	writeFlow(dir, flow);
	writeWorkerResult(dir, 1, "P-stop-complete", "done 1");
	writeWorkerResult(dir, 2, "P-stop-complete", "done 2");

	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	// 真实 status 命令登记 Live；stop 收口后必须在 go 前断言 Recent。
	const htmlPath = join(dir, "flow.html");
	await commands.get("flow").handler("status F1", ctx);
	await waitForDirectoryRecord(
		htmlPath,
		(record) => record?.state === "live",
		"pre-stop parallel Flow was not Live in directory",
	);
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
	assert(
		Number.isFinite(stopped.completedAt) &&
			[1, 2].every((index) =>
				Number.isFinite(stopped.goals[index].completedAt),
			),
		"parallel stop completion did not stamp parent timestamps",
	);
	await waitForDirectoryRecord(
		htmlPath,
		(record) =>
			record?.state === "complete" && record.generation === stopped.createdAt,
		"stop complete left directory Live",
	);
	await commands.get("flow").handler("go F1", ctx);
	assert(state.newSessions.length === 0, "go after complete stop started work");
	assert(
		(state.notifications.at(-1) ?? "").includes("已完成"),
		`go after complete stop did not report completion: ${state.notifications.at(-1)}`,
	);
}

async function flowPrewalkForkStartScenario() {
	const cwd = tempDir("flow-prewalk-fork");
	initGitWorkspace(cwd);
	writeFlowTestConfig({ prewalk: true });
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const sessionFile = join(cwd, "planning.jsonl");
	const ctx = commandContext(state, cwd, sessionFile);
	const forks = [];
	ctx.getContextUsage = () => ({
		percent: 20,
		tokens: 1000,
		contextWindow: 200_000,
	});
	ctx.sessionManager.getLeafId = () => "leaf-9";
	entriesFor(state, sessionFile).push({ type: "message", id: "leaf-9" });
	let forkFile;
	ctx.fork = async (entryId, options) => {
		forks.push({ entryId, position: options?.position });
		forkFile = join(cwd, `fork-${forks.length}.jsonl`);
		writeFileSync(forkFile, "");
		const nextCtx = commandContext(state, cwd, forkFile, true);
		nextCtx.sessionManager.getLeafId = () => entryId;
		state.activeCtx = nextCtx;
		await options?.withSession?.(nextCtx);
		return { cancelled: false };
	};
	// 先触发按需初始化（flow:initialize 会重置 prewalk 运行态），再模拟生成完成记忆；
	// 生产时序同构：生成命令先初始化，生成成功后才 remember。
	await commands.get("flow").handler("status F1", ctx);
	const prewalk = await importCachedModule("flow/prewalk.js");
	prewalk.rememberGenerationSession(dir, ctx);

	await commands.get("flow").handler("go F1", ctx);
	assert(
		forks.length === 1 &&
			forks[0].entryId === "leaf-9" &&
			forks[0].position === "at",
		`goal start did not fork at the plan session leaf: ${JSON.stringify(forks)}`,
	);
	assert(
		state.newSessions.length === 0,
		"fork start must not open a fresh session",
	);
	assert(
		state.hiddenMessages.some((text) => text.includes("延续自计划会话")),
		"forked goal prompt did not lift the generation-phase restriction",
	);
	const saved = readFlow(dir);
	assert(
		saved.status === "running" && saved.goals[0].sessionFile === forkFile,
		"forked session was not recorded as the goal session",
	);
	const goalEntry = entriesFor(state, forkFile)
		.filter(
			(entry) => entry.type === "custom" && entry.customType === "goal-state",
		)
		.at(-1);
	assert(
		goalEntry?.data?.goal?.sessionAnchorId === "leaf-9",
		"forked goal did not record the evidence anchor",
	);

	// 同一生成会话记忆已消费：再次启动（如重跑）回退冷启动，不重复 fork。
	assert(
		prewalk.planTrajectoryForkPoint(ctx, dir, { startedAt: null }) ===
			undefined,
		"generation session memory was not consumed by the fork start",
	);
	writeFlowTestConfig();
}

async function parallelPrewalkForkScenario() {
	const cwd = tempDir("parallel-prewalk-fork");
	initGitWorkspace(cwd);
	writeFlowTestConfig({ prewalk: true });
	const dir = createFlow(cwd, "F1", { planCount: 3 });
	const flow = readFlow(dir);
	flow.goals[0].dependsOn = [];
	flow.goals[0].writeScope = ["src/a/**"];
	flow.goals[1].dependsOn = [];
	flow.goals[1].writeScope = ["src/b/**"];
	flow.goals[2].dependsOn = [0, 1];
	writeFlow(dir, flow);
	const restorePi = installFakePi(cwd);
	try {
		const state = newState(cwd);
		const { commands, handlers } = await loadExtension(state);
		const sessionFile = join(cwd, "planning.jsonl");
		// 真实生成会话 JSONL：并行分支用 SessionManager.open 读磁盘文件。
		const { CURRENT_SESSION_VERSION } = await import(
			"@earendil-works/pi-coding-agent"
		);
		writeFileSync(
			sessionFile,
			`${[
				{
					type: "session",
					version: CURRENT_SESSION_VERSION,
					id: "gen-session",
					timestamp: new Date().toISOString(),
					cwd,
				},
				{
					type: "message",
					id: "u1",
					parentId: null,
					timestamp: new Date().toISOString(),
					message: {
						role: "user",
						content: [{ type: "text", text: "explore" }],
					},
				},
				{
					type: "message",
					id: "a1",
					parentId: "u1",
					timestamp: new Date().toISOString(),
					message: {
						role: "assistant",
						content: [{ type: "text", text: "plan written" }],
					},
				},
			]
				.map((item) => JSON.stringify(item))
				.join("\n")}\n`,
		);
		const ctx = commandContext(state, cwd, sessionFile);
		ctx.getContextUsage = () => ({
			percent: 20,
			tokens: 1000,
			contextWindow: 200_000,
		});
		ctx.sessionManager.getLeafId = () => "a1";
		// 模拟宿主：newSession 替换前先对旧会话派发 session_shutdown（回归：
		// shutdown 不得清除生成会话记忆，否则并行首批 fork 永远不可达）。
		const originalNewSession = ctx.newSession.bind(ctx);
		ctx.newSession = async (options) => {
			await emit(handlers, "session_shutdown", {}, ctx);
			return originalNewSession(options);
		};
		// 先触发按需初始化，再模拟生成完成记忆（同生产时序）。
		await commands.get("flow").handler("status F1", ctx);
		const prewalk = await importCachedModule("flow/prewalk.js");
		prewalk.rememberGenerationSession(dir, ctx);

		await commands.get("flow").handler("go F1", ctx);
		await flushScheduledGoalStart();

		const saved = readFlow(dir);
		for (const goalIndex of [0, 1]) {
			const workerSession = saved.goals[goalIndex].sessionFile;
			assert(
				workerSession && existsSync(workerSession),
				`G${goalIndex + 1} worker session file missing: ${workerSession}`,
			);
			assert(
				workerSession !== sessionFile,
				"worker must not reuse the generation session file",
			);
			const lines = readFileSync(workerSession, "utf8").trim().split("\n");
			const header = JSON.parse(lines[0]);
			assert(
				header.parentSession === sessionFile,
				`G${goalIndex + 1} worker session is not branched from the generation session`,
			);
			assert(
				lines.some((line) => line.includes("plan written")),
				`G${goalIndex + 1} worker session is missing the plan trajectory prefix`,
			);
			const prompt = readFileSync(
				join(cwd, `worker-${goalIndex}.prompt`),
				"utf8",
			);
			assert(
				prompt.includes("延续自计划会话"),
				`G${goalIndex + 1} worker prompt did not lift the generation-phase restriction`,
			);
		}
		assert(
			saved.goals[0].status === "complete" &&
				saved.goals[1].status === "complete",
			"parallel prewalk workers did not complete",
		);
		assert(
			readFileSync(sessionFile, "utf8").includes("plan written"),
			"generation session file must stay untouched",
		);
	} finally {
		restorePi();
		writeFlowTestConfig();
	}
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

async function flowGoalTurnDoesNotHoldLockScenario() {
	const { acquireFlowLock } = await importModule("flow/lock.js");
	const cwd = tempDir("flow-goal-turn-lock");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	const originalNewSession = ctx.newSession.bind(ctx);
	let promptStarted;
	let rejectTurn;
	const promptStartedPromise = new Promise((resolve) => {
		promptStarted = resolve;
	});
	const turnPromise = new Promise((_resolve, reject) => {
		rejectTurn = reject;
	});
	ctx.newSession = (options) =>
		originalNewSession({
			...options,
			withSession: async (sessionCtx) => {
				const sendMessage = sessionCtx.sendMessage.bind(sessionCtx);
				sessionCtx.sendMessage = (message, sendOptions) => {
					sendMessage(message, sendOptions);
					promptStarted();
					return turnPromise;
				};
				await options?.withSession?.(sessionCtx);
			},
		});

	const started = commands.get("flow").handler("go F1", ctx);
	await promptStartedPromise;
	try {
		const startCompleted = await Promise.race([
			started.then(() => true),
			new Promise((resolve) => setImmediate(() => resolve(false))),
		]);
		assert(startCompleted, "serial Goal start waited for the agent turn");
		assert(
			!existsSync(join(dir, ".flow.lock")),
			"serial Goal held the Flow lock for the agent turn",
		);
		const attributionWrite = acquireFlowLock(dir, "live attribution");
		assert(
			attributionWrite.ok,
			"live attribution could not acquire the Flow lock",
		);
		attributionWrite.release();
		rejectTurn(new Error("injected agent turn failure"));
		await new Promise((resolve) => setImmediate(resolve));
		assert(
			state.notifications.some((item) => item.includes("执行回合失败")),
			"agent turn failure was not reported with execution semantics",
		);
		assert(
			!state.notifications.some((item) => item.includes("目标提示发送失败")),
			"agent turn failure was misreported as prompt delivery failure",
		);
	} finally {
		rejectTurn(new Error("test cleanup"));
		await started;
	}
}

async function parallelFanInLockScenario() {
	const { withFlowLock } = await importModule("flow/lock.js");
	const { settleParallelRun } = await importModule("flow/parallel/fan-in.js");
	const cwd = tempDir("parallel-fan-in-lock");
	const dir = await createCrashedParallelFlow(cwd, "F1");
	const state = newState(cwd);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
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
			return settleParallelRun(ctx, dir, readFlow(dir), [], {
				requireSuccessfulExit: false,
				recovery: true,
			});
		});
	});
	await firstEntered;
	let secondRan = false;
	const second = await withFlowLock(dir, "fan-in second", () => {
		secondRan = true;
		return settleParallelRun(ctx, dir, readFlow(dir), [], {
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
	const { rememberFlowContext, rememberedFlowContext } =
		await importCachedModule("flow/runtime.js");
	const cwd = tempDir("flow-concurrent-recovery-fan-in");
	const dir = await createCrashedParallelFlow(cwd, "F1");
	writeWorkerResult(dir, 1, "P-crashed", "done 1");
	writeWorkerResult(dir, 2, "P-crashed", "done 2");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const consoleSessionFile = readFlow(dir).parallelRun.consoleSessionFile;
	const consoleCtx = commandContext(state, cwd, consoleSessionFile);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("status F1", ctx);
	rememberFlowContext(consoleCtx);
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
		assert(
			rememberedFlowContext(consoleSessionFile) === consoleCtx,
			"lock conflict released retryable console context",
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
		assert(
			rememberedFlowContext(consoleSessionFile) === undefined,
			"successful recovery cutover retained old console context",
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
	const { FLOW_SCHEMA_VERSION } = await importModule("flow/types.js");
	assert(FLOW_SCHEMA_VERSION === 17, "current Flow schema version changed");
	const { createPreDraftFlow, listFlowIds } =
		await importModule("flow/store.js");
	const { readAlignmentState } = await importModule(
		"shared/generation-state.js",
	);
	const preDraftCwd = tempDir("schema-predraft");
	const preDraft = createPreDraftFlow(preDraftCwd, {
		language: "zh",
		status: "generating",
		source: { type: "prompt", text: "draft" },
		sessionFile: null,
		autoStart: true,
		depth: "standard",
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
			preDraft.flow.startedAt === null &&
			preDraft.flow.completedAt === null,
		"pre-draft minimal flow shape was wrong",
	);
	assert(
		validateFlowDir(preDraft.dir).ok,
		`pre-draft validation failed: ${validateFlowDir(preDraft.dir).errors.join(" | ")}`,
	);
	assert(
		preDraft.alignment.depth === "standard" &&
			readAlignmentState(preDraft.dir).depth === "standard",
		"current alignment state was rejected",
	);
	const incompleteAlignment = JSON.parse(
		readFileSync(join(preDraft.dir, "alignment.json"), "utf8"),
	);
	delete incompleteAlignment.depth;
	writeFileSync(
		join(preDraft.dir, "alignment.json"),
		`${JSON.stringify(incompleteAlignment)}\n`,
	);
	let alignmentError = "";
	try {
		readAlignmentState(preDraft.dir);
	} catch (error) {
		alignmentError = String(error);
	}
	assert(
		alignmentError.includes("alignment.json depth"),
		"incomplete alignment state was accepted",
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
	assert(!cancelledValidation.ok, "unsupported pre-draft status was accepted");
	assert(
		cancelledValidation.errors.includes("Flow 状态不受支持") &&
			!cancelledValidation.errors.join("\n").includes("cancelled"),
		"unsupported status leaked its internal enum",
	);
	mkdirSync(join(preDraftCwd, ".flow", "F2-invalid"));
	const secondPreDraft = createPreDraftFlow(preDraftCwd, {
		language: "zh",
		status: "aligning",
		source: { type: "prompt", text: "align" },
		sessionFile: null,
		autoStart: false,
		depth: "standard",
	});
	assert(secondPreDraft.id === "F2", "noncanonical dir affected allocation");
	assert(
		JSON.stringify(listFlowIds(preDraftCwd)) === JSON.stringify(["F1", "F2"]),
		"noncanonical dir was listed as a valid Flow",
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
	const sourceCases = [
		{
			name: "conversation",
			valid: {
				type: "conversation",
				transcript: [
					{ kind: "user", at: "2026-01-01", text: "需求" },
					{
						kind: "visible_supplement",
						at: "2026-01-02",
						text: "补充",
					},
				],
			},
			invalid: { type: "conversation", transcript: [] },
			error: "source.transcript 必须是非空数组",
		},
		{
			name: "prompt",
			valid: { type: "prompt", text: "需求" },
			invalid: { type: "prompt", text: "需求", path: null },
			error: "source.path 不是合法 Flow 字段",
		},
		{
			name: "file",
			valid: { type: "file", path: "requirements.md", text: "需求" },
			invalid: { type: "file", text: "需求" },
			error: "source.path 必须是非空字符串",
		},
	];
	for (const sourceCase of sourceCases) {
		const sourceDir = createFlow(
			cwd,
			`F${20 + sourceCases.indexOf(sourceCase)}`,
		);
		const sourceFlow = readFlow(sourceDir);
		sourceFlow.source = sourceCase.valid;
		writeFlow(sourceDir, sourceFlow);
		assert(
			validateFlowDir(sourceDir).ok,
			`${sourceCase.name} source was rejected`,
		);
		sourceFlow.source = sourceCase.invalid;
		writeFlow(sourceDir, sourceFlow);
		assert(
			validateFlowDir(sourceDir).errors.includes(sourceCase.error),
			`${sourceCase.name} invalid source was accepted`,
		);
	}
	const unknownSourceDir = createFlow(cwd, "F23");
	const unknownSourceFlow = readFlow(unknownSourceDir);
	unknownSourceFlow.source = { type: "url", text: "需求" };
	writeFlow(unknownSourceDir, unknownSourceFlow);
	assert(
		validateFlowDir(unknownSourceDir).errors.includes(
			"source.type 必须是 conversation、prompt 或 file",
		),
		"unknown source type was accepted",
	);
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
		validateFlowDir(dir).ok,
		"paused parallelRun should be valid for reconcile",
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
	flowWithParallelFields.parallelRun = {
		id: "P-missing-console",
		goalIndexes: [0, 1],
		startedAt: Date.now(),
	};
	writeFlow(dir, flowWithParallelFields);
	assert(
		validateFlowDir(dir).errors.some((error) =>
			error.includes("parallelRun.consoleSessionFile 必须是非空字符串"),
		),
		"missing parallelRun console session was not rejected",
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
	const missingFlowCompletedAt = readFlow(dir);
	delete missingFlowCompletedAt.completedAt;
	writeFileSync(join(dir, "flow.json"), JSON.stringify(missingFlowCompletedAt));
	assert(
		validateFlowDir(dir).errors.includes("completedAt 必须是 null 或时间戳"),
		"missing flow completedAt not rejected",
	);
	createFlow(cwd, "F1");
	const missingGoalTimes = readFlow(dir);
	delete missingGoalTimes.goals[0].startedAt;
	delete missingGoalTimes.goals[0].completedAt;
	writeFileSync(join(dir, "flow.json"), JSON.stringify(missingGoalTimes));
	const missingGoalTimeErrors = validateFlowDir(dir).errors;
	assert(
		missingGoalTimeErrors.includes("goals[0].startedAt 必须是 null 或时间戳") &&
			missingGoalTimeErrors.includes(
				"goals[0].completedAt 必须是 null 或时间戳",
			),
		"missing goal timestamps not rejected",
	);
	createFlow(cwd, "F1");
	const invalidRoundTime = readFlow(dir);
	invalidRoundTime.goals[0].checks.acceptance.rounds = [
		{ round: 1, result: "failed", summary: "failed", elapsedMs: -1 },
	];
	invalidRoundTime.goals[0].checks.quality.active = {
		...activeCheck("reviewer"),
		startedAt: "now",
	};
	writeFlow(dir, invalidRoundTime);
	const invalidCheckTimeErrors = validateFlowDir(dir).errors;
	assert(
		invalidCheckTimeErrors.some((error) => error.includes("elapsedMs")) &&
			invalidCheckTimeErrors.some((error) =>
				error.includes("active.startedAt"),
			),
		"invalid check timestamps not rejected",
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
	createFlow(cwd, "F1");
	const pendingWithoutAdvice = readFlow(dir);
	pendingWithoutAdvice.goals[0].checks.acceptance.rounds = [
		{ round: 1, result: "failed", summary: "未通过" },
	];
	pendingWithoutAdvice.goals[0].pendingAdvisor = {
		phase: "acceptance",
		round: 1,
	};
	writeFlow(dir, pendingWithoutAdvice);
	assert(
		validateFlowDir(dir).errors.some((error) =>
			error.includes("必须指向含顾问建议的未通过检查轮"),
		),
		"pending advisor without persisted advice was accepted",
	);
	pendingWithoutAdvice.goals[0].checks.acceptance.rounds[0].advisor = {
		model: "test/advisor",
		thinking: "high",
		advice: "改走事件驱动",
	};
	writeFlow(dir, pendingWithoutAdvice);
	assert(
		validateFlowDir(dir).ok,
		`valid pending advisor rejected: ${validateFlowDir(dir).errors.join(" | ")}`,
	);
	const invalidAlignment = readFlow(dir);
	invalidAlignment.meta = {
		plannedBy: null,
		alignment: { kind: "recorded", turns: [] },
	};
	writeFlow(dir, invalidAlignment);
	assert(
		validateFlowDir(dir).errors.includes("meta.alignment.turns 必须是非空数组"),
		"empty recorded alignment was accepted",
	);
	invalidAlignment.meta = {
		plannedBy: null,
		alignment: null,
		unexpected: true,
	};
	writeFlow(dir, invalidAlignment);
	assert(
		validateFlowDir(dir).errors.includes("meta.unexpected 不是合法 Flow 字段"),
		"unknown alignment field was accepted",
	);
	const flow = readFlow(dir);
	writeFileSync(
		join(dir, "flow.json"),
		JSON.stringify({ ...flow, schemaVersion: 1 }),
	);
	assert(
		validateFlowDir(dir).errors.some((error) =>
			error.includes("schemaVersion 必须为 17"),
		),
		"bad schemaVersion not rejected",
	);
	createFlow(cwd, "F1");
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
		duplicateErrors.includes("最终验收步骤最多 1 个（role: final_acceptance）"),
		"duplicate final acceptance not rejected",
	);
	assert(
		duplicateErrors.includes("goals[2] 非最终步骤必须是 normal"),
		"non-last final acceptance not rejected",
	);
	const noFinalDir = createFlow(cwd, "F6", { planCount: 4 });
	const noFinalFlow = readFlow(noFinalDir);
	noFinalFlow.goals = noFinalFlow.goals.map((goal) => ({
		...goal,
		role: "normal",
	}));
	writeFlow(noFinalDir, noFinalFlow);
	const noFinalResult = validateFlowDir(noFinalDir);
	assert(
		noFinalResult.ok,
		`multi-step flow without final acceptance rejected: ${noFinalResult.errors.join("\n")}`,
	);
	const singleFinalDir = createFlow(cwd, "F7", { planCount: 1 });
	const singleFinalFlow = readFlow(singleFinalDir);
	singleFinalFlow.goals.push({
		...singleFinalFlow.goals[0],
		index: 1,
		title: "最终验收",
		role: "final_acceptance",
	});
	writeFlow(singleFinalDir, singleFinalFlow);
	const singleFinalResult = validateFlowDir(singleFinalDir);
	assert(
		singleFinalResult.ok,
		`single-step flow with final acceptance rejected: ${singleFinalResult.errors.join("\n")}`,
	);
}

async function currentSchemaOnlyScenario() {
	const { findFlow, listFlows } = await importModule("flow/store.js");
	const { validateFlowDir } = await importModule("flow/validator.js");
	const cwd = tempDir("current-schema-only");
	createFlow(cwd, "F1");
	const oldDir = createFlow(cwd, "F2");
	const oldFlow = readFlow(oldDir);
	oldFlow.schemaVersion = 15;
	writeFlow(oldDir, oldFlow);
	const oldText = readFileSync(join(oldDir, "flow.json"), "utf8");
	const malformedDir = join(cwd, ".flow", "F3");
	mkdirSync(malformedDir);
	writeFileSync(join(malformedDir, "flow.json"), "{bad json");

	assert(
		JSON.stringify(listFlows(cwd).map((location) => location.id)) ===
			JSON.stringify(["F1"]),
		"automatic Flow scan included unsupported state",
	);
	assert(!validateFlowDir(oldDir).ok, "schema v15 was accepted");
	assert(
		readFileSync(join(oldDir, "flow.json"), "utf8") === oldText,
		"unsupported Flow was rewritten",
	);
	let explicitError = "";
	try {
		findFlow(cwd, "F2");
	} catch (error) {
		explicitError = String(error);
	}
	assert(
		explicitError.includes("schemaVersion 必须为 17"),
		`explicit old Flow error was unclear: ${explicitError}`,
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
		assertNoticeFormat(state.notifications.at(-1), "⚠️", "请指定 Flow id");
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

async function flowBareGoCompleteHintScenario() {
	const cwd = tempDir("flow-bare-go-complete");
	const dir = createFlow(cwd, "F1");
	const flow = readFlow(dir);
	writeFlow(dir, {
		...flow,
		status: "complete",
		startedAt: Date.now(),
		goals: flow.goals.map((goal) => ({ ...goal, status: "complete" })),
	});
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go", ctx);
	const notice = state.notifications.at(-1) ?? "";
	assert(
		notice.includes("没有可推进的 Flow") &&
			notice.includes("F1 已完成") &&
			notice.includes("/flow go F1"),
		`bare go with complete flow lacked completion hint: ${notice}`,
	);
}

async function flowWorkspaceHintScenario() {
	const { flowWorkspaceHint } = await importModule("flow/workspace-hint.js");
	const bare = join(tmpdir(), `pi-flow-hint-${runId}`);
	rmSync(bare, { recursive: true, force: true });
	mkdirSync(bare, { recursive: true });
	try {
		assert(
			flowWorkspaceHint(bare, "zh")?.includes("不在 git 仓库内"),
			"non-git cwd did not warn about flow root location",
		);
	} finally {
		rmSync(bare, { recursive: true, force: true });
	}
	const repo = tempDir("workspace-hint-repo");
	mkdirSync(join(repo, ".git"));
	assert(
		flowWorkspaceHint(repo, "zh")?.includes(".gitignore"),
		"missing .flow ignore did not hint",
	);
	writeFileSync(join(repo, ".gitignore"), "node_modules/\n.flow/\n");
	assert(
		flowWorkspaceHint(repo, "zh") === undefined,
		"ignored .flow still hinted",
	);
	const nested = join(repo, "packages", "app");
	mkdirSync(nested, { recursive: true });
	assert(
		flowWorkspaceHint(nested, "zh") === undefined,
		"nested cwd ignored repo-root .gitignore",
	);
	const worktree = tempDir("workspace-hint-worktree");
	writeFileSync(join(worktree, ".git"), "gitdir: elsewhere\n");
	assert(
		flowWorkspaceHint(worktree, "zh")?.includes(".gitignore"),
		"worktree .git file was not treated as a repository",
	);
}

async function workerArtifactSingleWriterScenario() {
	const { appendWorkerEvent, readWorkerEvents, workerEventsPath } =
		await importModule("flow/parallel/worker-artifact.js");
	const { readLane } = await importModule("flow/parallel/lane-model.js");
	const cwd = tempDir("worker-artifact-single-writer");
	const dir = createParallelFlow(cwd, "F1");
	const flow = readFlow(dir);
	writeWorkerGoalArtifact(dir, flow, 1, emptyChecks());
	const artifactPath = join(dir, "G2-worker.json");
	const before = readFileSync(artifactPath, "utf8");
	appendWorkerEvent(dir, 1, {
		type: "tool_execution_start",
		toolName: "bash",
	});
	appendWorkerEvent(dir, 1, { type: "agent_end" });
	appendWorkerEvent(dir, 1, {
		type: "process_error",
		error: "worker socket closed",
	});
	assert(
		readFileSync(artifactPath, "utf8") === before,
		"parent event write touched the worker-owned artifact",
	);
	assert(
		existsSync(workerEventsPath(dir, 1)) &&
			readWorkerEvents(dir, 1).length === 3,
		"parent events were not persisted to the events file",
	);
	const lane = readLane(dir, readFlow(dir), 1, undefined);
	assert(
		!lane.activities.some((line) => line.includes("命令")) &&
			lane.activities.includes("worker socket closed"),
		`lane activities retained progress summaries or lost process errors: ${JSON.stringify(lane.activities)}`,
	);
}

async function workerResumeCursorScenario() {
	const { resumableWorkerCursor } = await importModule(
		"flow/parallel/worker-artifact.js",
	);
	const artifact = {
		parallelRunId: "P1",
		completion: null,
		completionCursor: "quality_retry",
	};
	assert(
		resumableWorkerCursor(artifact, "P1") === "quality_retry",
		"retry cursor was not resumable",
	);
	assert(
		resumableWorkerCursor(
			{ ...artifact, completionCursor: "finalize_retry" },
			"P1",
		) === "finalize_retry",
		"finalize cursor was not resumable",
	);
	assert(
		resumableWorkerCursor(
			{ ...artifact, completionCursor: "quality_repair" },
			"P1",
		) === null,
		"repair cursor must rerun execution, not skip it",
	);
	assert(
		resumableWorkerCursor({ ...artifact, completion: {} }, "P1") === null,
		"completed artifact must not resume",
	);
	assert(
		resumableWorkerCursor(artifact, "P2") === null &&
			resumableWorkerCursor(undefined, "P1") === null,
		"foreign or missing artifact must not resume",
	);

	const { workerInitialPrompt } = await importModule(
		"flow/execution/worker-command.js",
	);
	const cwd = tempDir("worker-resume-prompt");
	const dir = await createCrashedParallelFlow(cwd, "F1");
	const flow = readFlow(dir);
	writeWorkerGoalArtifact(dir, flow, 1, runningChecks(), "acceptance_retry");
	const holdPrompt = workerInitialPrompt(dir, flow, 1);
	assert(
		holdPrompt.includes("等待收口") && !holdPrompt.includes("## Steps"),
		`resume respawn leaked the execution prompt: ${holdPrompt.slice(0, 120)}`,
	);
	const executionPrompt = workerInitialPrompt(dir, flow, 2);
	assert(
		!executionPrompt.includes("等待收口") &&
			executionPrompt.includes("Do Goal 3"),
		`fresh worker lost the execution prompt: ${executionPrompt.slice(0, 120)}`,
	);
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
	await createCrashedParallelFlow(parallelOwnerCwd, "F1");
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
				join(parallelOwnerCwd, "F1-G3 Goal 3.jsonl"),
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
			ambiguousNotice.includes("F1 · 「/flow status F1」") &&
			ambiguousNotice.includes("F2 · 「/flow status F2」"),
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
			notice.includes("F1 · 「/flow go F1」") &&
			notice.includes("F2 · 「/flow go F2」") &&
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
		requestText: "unique pre-draft",
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
			uniqueState.notifications.at(-1).includes("洞察全部上下文，生成全面计划"),
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
			notice.includes("F1 · 「/flow go F1」") &&
			notice.includes("F2 · 「/flow go F2」") &&
			notice.includes("F3 · 「/flow go F3」"),
		`bare go did not require id for multiple advanceable Flows: ${notice}`,
	);
	await ambiguousCommands.get("flow").handler("go F2", ambiguousCtx);
	const selectedAlignment = JSON.parse(
		readFileSync(join(ambiguousCwd, ".flow", "F2", "alignment.json"), "utf8"),
	);
	assert(
		selectedAlignment.stage === "generating" &&
			latestWidgetText(ambiguousState).includes("🌊 Flow · 生成中"),
		`explicit id go did not generate the selected pre-draft Flow: stage=${selectedAlignment.stage}; widget=${latestWidgetText(ambiguousState)}`,
	);
}

async function flowCommandRoutingSafetyScenario() {
	const { emitFlowGoalCompleted } =
		await importCachedModule("flow/completion.js");

	const commandCwd = tempDir("flow-command-routing-safety");
	const commandF3 = createFlow(commandCwd, "F3");
	const commandF4 = createFlow(commandCwd, "F4");
	const commandF3Session = join(commandCwd, "f3.jsonl");
	const commandF4Session = join(commandCwd, "f4.jsonl");
	writeFileSync(commandF3Session, "");
	writeFileSync(commandF4Session, "");
	markFlowRunningWithSnapshot(commandF3, commandF3Session);
	markFlowRunningWithSnapshot(commandF4, commandF4Session);
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
			continueNotice.includes("F3 · 「/flow go F3」") &&
			continueNotice.includes("F4 · 「/flow go F4」"),
		`bare go did not require an explicit Flow id: ${continueNotice}`,
	);
	const completionCwd = tempDir("flow-completion-routing-safety");
	const completionF3 = createFlow(completionCwd, "F3", { planCount: 3 });
	const completionF4 = createFlow(completionCwd, "F4", { planCount: 3 });
	const completionF3Session = join(completionCwd, "f3.jsonl");
	const completionF4Session = join(completionCwd, "f4.jsonl");
	writeFileSync(completionF3Session, "");
	writeFileSync(completionF4Session, "");
	markFlowRunningWithSnapshot(completionF3, completionF3Session);
	markFlowRunningWithSnapshot(completionF4, completionF4Session);
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

function markFlowRunningWithSnapshot(dir, sessionFile) {
	const flow = readFlow(dir);
	const goal = flow.goals[0];
	const snapshot = readFileSync(join(dir, goal.file), "utf8");
	flow.status = "running";
	flow.startedAt = Date.now();
	goal.status = "running";
	goal.sessionFile = sessionFile;
	goal.snapshot = snapshot;
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
	const runningGoalFile = join(runningDir, runningFlow.goals[0].file);
	const changedGoal = readFileSync(runningGoalFile, "utf8").replace(
		"- [x] Do work.",
		"- [x] F3 watcher survived F4 start.",
	);
	await changeSourceUntilHtmlMatches(
		runningHtml,
		() => writeFileSync(runningGoalFile, changedGoal),
		(content) => content.includes("F3 watcher survived F4 start."),
	);
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
	assert(text.includes("下一步: 「/flow go F1」"), text);
	flow.status = "running";
	const runningText = statusText(flow);
	assert(runningText.includes("下一步: 「/flow go F1」"), runningText);
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

async function flowRepairHtmlFailureScenario() {
	const startCwd = tempDir("repair-html-failure");
	const startDir = createFlow(startCwd, "F1");
	const malformedFlow = readFlow(startDir);
	delete malformedFlow.source;
	malformedFlow.goals = {};
	writeFlow(startDir, malformedFlow);
	breakFlowHtml(startDir);
	const startState = newState(startCwd);
	const { commands: startCommands } = await loadExtension(startState);
	const startCtx = commandContext(
		startState,
		startCwd,
		join(startCwd, "planning.jsonl"),
	);
	await startCommands.get("flow").handler("go F1", startCtx);
	assert(
		startState.confirms.length === 1 &&
			startState.hiddenMessages.at(-1)?.includes("goals 必须是数组"),
		"error HTML failure stopped validation repair confirmation or prompt",
	);
	assert(
		readFlow(startDir).errors.some((error) =>
			error.includes("goals 必须是数组"),
		),
		"validation errors were not committed before error HTML failure",
	);
	assertReportRefreshFailure(startState);

	const generateCwd = tempDir("generation-repair-html-failure");
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
	breakFlowHtml(generateDir);
	await emit(handlers, "agent_end", { messages: [] }, generateCtx);
	const generated = readFlow(generateDir);
	assert(
		generated.status === "generating" &&
			generated.repairAttempts === 1 &&
			generateState.hiddenMessages.at(-1)?.includes("缺少章节"),
		"error HTML failure stopped generation repair prompt",
	);
	assertReportRefreshFailure(generateState);
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
	const {
		elapsedTimeHtml,
		formatElapsedMinutes,
		shouldHideTranscriptExpander,
		STEP_FLOW_MIN_CLEARANCE,
		STEP_FLOW_ROUGH_OPTIONS,
		stepFlowConnectorPath,
		stepFlowTargetHeight,
	} = await importModule("shared/report-html.js");
	assert(
		[1_000, 42_000, 192_000, 720_000].map(formatElapsedMinutes).join(",") ===
			"<0.1m,0.7m,3.2m,12m" && !elapsedTimeHtml(42_000).includes("<svg"),
		"minute elapsed formatting changed",
	);
	const cwd = tempDir("html");
	const dir = createFlow(cwd, "F1", { planCount: 2 });
	const firstPlanPath = join(dir, "G1-plan.md");
	writeFileSync(
		firstPlanPath,
		readFileSync(firstPlanPath, "utf8").replace(
			"- [x] Do work.",
			[
				"- [x] **梳理范围**：确认报告页信息层级",
				"- [~] **准备环境**：安装依赖并初始化数据库",
				"- [ ] **实现布局**：完成折叠与响应式双列",
				"- [!] **等待凭证**：缺少外部 token，记录阻塞",
				"- [ ] **补齐验证**：覆盖宽屏与窄屏结构",
				"- [ ] **收口文档**：同步当前展示规则",
			].join("\n"),
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
		draftHtml.includes('data-copy-command="/flow go F1"') &&
			draftHtml.includes("navigator.clipboard.writeText") &&
			draftHtml.includes('document.execCommand("copy")') &&
			draftHtml.includes("已复制"),
		"flow command chip should expose working copy feedback",
	);
	assert(
		draftHtml.includes(
			"rounded-full bg-[var(--report-surface-soft)] pl-2.5 pr-0.5",
		),
		"flow command chips should stay compact around the copy action",
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
	const fiveStepDir = createFlow(cwd, "F99");
	const fiveStepPath = join(fiveStepDir, "G1-plan.md");
	writeFileSync(
		fiveStepPath,
		readFileSync(fiveStepPath, "utf8").replace(
			"- [x] Do work.",
			Array.from(
				{ length: 5 },
				(_, index) =>
					`- [${index === 2 ? "~" : " "}] **${`长步骤 ${index + 1} 包含完整标题证据。`.repeat(8)}**：${"包含展开详情与验证证据。".repeat(8)}`,
			).join("\n"),
		),
	);
	const fiveStepHtml = readFileSync(
		writeFlowHtml(fiveStepDir, readFlow(fiveStepDir)),
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
	assert(draftHtml.includes("范围"), "flow goal scope label missing");
	assert(
		draftHtml.includes(
			'data-success-criteria data-rough-card data-tone="blue" class="min-w-0',
		) &&
			draftHtml.includes("data-criteria-header") &&
			draftHtml.includes("data-criteria-list") &&
			draftHtml.includes(">标准</p>") &&
			draftHtml.includes(">1 项</span>") &&
			draftHtml.includes('d="M13 5h8"'),
		"flow goal criteria card hierarchy missing",
	);
	assert(!draftHtml.includes("- Done."), "raw bullet markdown leaked");
	const moreTooltips = [
		...draftHtml.matchAll(/data-hover-chip data-tooltip="([^"]+)"/gu),
	].map((match) => match[1]);
	assert(
		moreTooltips.length === 2 &&
			moreTooltips.every(
				(tooltip) =>
					tooltip.includes("怎么验证") &&
					!tooltip.includes("验收标准") &&
					!tooltip.includes("Done."),
			),
		`goal more tooltip still contains success criteria: ${moreTooltips.join(" | ")}`,
	);
	assert(
		!draftHtml.includes("要做"),
		"flow repeated objective as work section",
	);
	assert(draftHtml.includes("尚未启动"), "session label not localized");
	assert(draftHtml.includes("怎么验证"), "verification section missing");
	assert(draftHtml.includes("需求记录"), "request log missing");
	assert(
		draftHtml.includes('data-modal-open="dlg-request-record"') &&
			draftHtml.includes('<dialog id="dlg-request-record"') &&
			draftHtml.includes("data-request-source-text") &&
			!draftHtml.includes("data-report-transcript"),
		"file request log should open a plain-text modal, not fake a transcript",
	);
	assert(!draftHtml.includes(">计划 ID</p>"), "request log leaked plan id");
	const conversationDir = createFlow(cwd, "F3");
	const conversationFlow = readFlow(conversationDir);
	const transcriptCwd = process.cwd();
	conversationFlow.source = {
		type: "conversation",
		transcript: [
			{
				kind: "user",
				at: "2026-07-13T08:10:00.000Z",
				text: `保留 ${transcriptCwd}/src/flow/html.ts <>&"\n第二行`,
			},
			{
				kind: "visible_supplement",
				at: "2026-07-13T08:11:00.000Z",
				text: `补充 ${transcriptCwd}/src/shared/report-transcript.ts <>&"`,
			},
			{
				kind: "assistant_final",
				at: "2026-07-13T08:12:00.000Z",
				text: "**结构化回复**\n\n- 条目",
			},
		],
	};
	conversationFlow.meta = {
		plannedBy: null,
		alignment: {
			kind: "recorded",
			turns: [{ question: "需要保留时间吗？", answer: "需要" }],
		},
	};
	const conversationHtml = readFileSync(
		writeFlowHtml(conversationDir, conversationFlow),
		"utf8",
	);
	const userTurn = conversationHtml.indexOf('data-transcript-kind="user"');
	const supplementTurn = conversationHtml.indexOf(
		'data-transcript-kind="visible_supplement"',
	);
	const assistantTurn = conversationHtml.indexOf(
		'data-transcript-kind="assistant_final"',
	);
	assert(
		conversationHtml.includes("data-report-transcript") &&
			conversationHtml.includes("data-request-qa") &&
			conversationHtml.includes("需要保留时间吗？") &&
			userTurn >= 0 &&
			userTurn < supplementTurn &&
			supplementTurn < assistantTurn,
		"conversation request log should render one ordered transcript thread",
	);
	assert(
		conversationHtml.includes("data-transcript-role") &&
			conversationHtml.includes('<time datetime="2026-07-13T08:10:00.000Z"') &&
			conversationHtml.includes(
				`保留 ${transcriptCwd}/src/flow/html.ts &lt;&gt;&amp;&quot;\n第二行`,
			) &&
			conversationHtml.includes(
				`补充 ${transcriptCwd}/src/shared/report-transcript.ts &lt;&gt;&amp;&quot;`,
			) &&
			!conversationHtml.includes("保留 ./src/flow/html.ts") &&
			!conversationHtml.includes("补充 ./src/shared/report-transcript.ts") &&
			conversationHtml.includes(">结构化回复</strong>") &&
			!conversationHtml.includes("**结构化回复**"),
		"transcript roles, timestamps, verbatim user text, or assistant markdown missing",
	);
	const userRoleHtml = conversationHtml.slice(userTurn, supplementTurn);
	const supplementRoleHtml = conversationHtml.slice(
		supplementTurn,
		assistantTurn,
	);
	assert(
		userRoleHtml.includes("font-semibold text-stone-700 dark:text-stone-300") &&
			userRoleHtml.includes('text-sky-800 dark:text-sky-300"><svg') &&
			!userRoleHtml.includes("font-semibold text-sky-800"),
		"user semantic color should stay on the role icon, not the role name",
	);
	assert(
		supplementRoleHtml.includes(
			'text-sky-800 dark:text-sky-300 opacity-55"><svg',
		) &&
			!supplementRoleHtml.includes("font-semibold text-sky-800") &&
			!supplementRoleHtml.includes("font-semibold opacity-55"),
		"user addition fading should stay on the icon and accent, not the role name",
	);
	assert(
		shouldHideTranscriptExpander(true, 240, 240) &&
			!shouldHideTranscriptExpander(true, 480, 240) &&
			!shouldHideTranscriptExpander(false, 480, 480),
		"transcript expander should stay visible after expanded content is reopened",
	);
	assert(
		conversationHtml.includes('data-transcript-body data-collapsed="true"') &&
			conversationHtml.includes("data-transcript-expand hidden") &&
			conversationHtml.includes(
				'[data-transcript-body][data-collapsed="true"]',
			) &&
			conversationHtml.includes(
				"[data-transcript-expand][hidden]{display:none!important}",
			) &&
			conversationHtml.includes("syncTranscriptExpanders(dialog)") &&
			conversationHtml.includes(
				"button.hidden = shouldHideTranscriptExpander(",
			) &&
			conversationHtml.includes('body.dataset.collapsed === "true"') &&
			conversationHtml.includes("@media (prefers-reduced-motion:reduce)"),
		"long transcript bodies should clamp with an expandable reduced-motion fallback",
	);
	const noRecordFlow = readFlow(singleDraftDir);
	noRecordFlow.source.text = "";
	const noRecordHtml = readFileSync(
		writeFlowHtml(singleDraftDir, noRecordFlow),
		"utf8",
	);
	assert(
		!noRecordHtml.includes("需求记录") && !noRecordHtml.includes("dlg-context"),
		"empty request log should be hidden",
	);
	writeFileSync(
		join(singleDraftDir, "alignment.json"),
		`${JSON.stringify({
			version: 1,
			stage: "aligning",
			sessionFile: null,
			autoStart: false,
			depth: "standard",
			alignmentTurns: [{ question: "范围？", answer: "src/pages/**" }],
			lastAlignmentQuestion: null,
			createdAt: 0,
			updatedAt: 0,
		})}\n`,
	);
	const qaHtml = readFileSync(
		writeFlowHtml(singleDraftDir, noRecordFlow),
		"utf8",
	);
	assert(
		qaHtml.includes("需求记录") &&
			qaHtml.includes("data-request-qa") &&
			qaHtml.includes("QA 记录") &&
			qaHtml.includes("范围？") &&
			qaHtml.includes("src/pages/**") &&
			qaHtml.includes("提示词</span>"),
		"request log should show structured QA and source when original request is empty",
	);
	assert(
		draftHtml.includes(">验收</span>") && draftHtml.includes(">质检</span>"),
		"stepper check chips missing",
	);
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
	assert(
		draftHtml.includes('[data-goal-select][data-goal-tone="blue"]:hover') &&
			draftHtml.includes('[data-goal-select][data-goal-tone="green"]:hover'),
		"stepper hover color should follow goal status",
	);
	assert(
		draftHtml.includes("data-rough-ring") &&
			draftHtml.includes("ring-ink") &&
			draftHtml.includes("rough-ring-progress") &&
			!draftHtml.includes("ring-sketch") &&
			!draftHtml.includes("data-ring-dot") &&
			!draftHtml.includes("data-ring-glow"),
		"flow progress ring should use subtle ink animation only",
	);
	assert(
		draftHtml.includes('class="h-5 w-5 rotate-3d-soft"') &&
			draftHtml.includes('d="m15.194 13.707') &&
			draftHtml.includes("line-redraw") &&
			draftHtml.includes("28%,72%") &&
			draftHtml.includes("line-redraw 1.5s") &&
			draftHtml.includes(".rotate-3d-soft>*") &&
			!draftHtml.includes('class="h-5 w-5 spin-soft"') &&
			!draftHtml.includes('d="M12 6v6l4 2"'),
		"active detail step should use slower rotate-3d line redraw, not spinner or clock",
	);
	assert(
		draftHtml.includes("[data-rough-card]{border-radius:18px") &&
			draftHtml.includes("[data-rough-node]") &&
			draftHtml.includes("roundedRectPath"),
		"rough card/node rounded contract missing",
	);
	assert(
		draftHtml.includes("data-hover-chip") &&
			!draftHtml.includes("data-hover-chip data-rough-seal") &&
			!/<[^>]*data-hover-chip[^>]*0_0_0_1px/u.test(draftHtml),
		"hover chips should use the modern shared style without rough or ring borders",
	);
	assert(
		draftHtml.includes("cursor-pointer") && !draftHtml.includes("cursor-help"),
		"hover controls should use pointer cursor",
	);
	assert(
		draftHtml.includes(
			"dialog [data-modal-shell]{opacity:0;transform:scale(.985)",
		) &&
			draftHtml.includes("main>:not(dialog){animation:rise") &&
			draftHtml.includes(
				"modal-closing [data-modal-shell]{opacity:0;transform:scale(.99)",
			),
		"modal should use non-directional fade animation",
	);
	assert(
		draftHtml.includes('circle cx="12" cy="12" r="1"') &&
			!draftHtml.includes("▸"),
		"more action should use local dots icon, not CSS triangle",
	);
	assert(
		draftHtml.includes(">验收</p>") &&
			draftHtml.includes('data-tooltip="确保目标完整完成"'),
		"flow goal review phase missing",
	);
	assert(
		draftHtml.includes("data-theme-toggle") &&
			draftHtml.includes("pi-flow-theme") &&
			draftHtml.includes(".dark\\:hidden:is(.dark *)") &&
			draftHtml.includes("prefers-color-scheme: dark") &&
			draftHtml.includes("dark:hidden") &&
			draftHtml.includes("dark:inline") &&
			draftHtml.includes("flex items-center justify-between gap-3 px-1 pb-1") &&
			!draftHtml.includes("fixed right-4 top-4"),
		"theme toggle / system dark mode boot missing or fixed-positioned",
	);
	assert(
		draftHtml.includes('flow-tooltip[data-size="lg"]') &&
			draftHtml.includes("max-height:min(58vh,30rem);overflow:auto") &&
			draftHtml.includes("width:max-content") &&
			draftHtml.includes('tip.addEventListener("mouseenter", clearHide)') &&
			draftHtml.includes("tip.contains(event.target)") &&
			draftHtml.includes('data-tooltip-size="lg"'),
		"large hover details should be readable, scrollable, and hoverable",
	);
	assert(
		draftHtml.includes(">质检</p>") &&
			draftHtml.includes('data-tooltip="把关实现质量"'),
		"flow quality review phase missing",
	);
	assert(
		draftHtml.includes('circle cx="12" cy="12" r="10"') &&
			draftHtml.includes("M20 13c0 5-3.5 7.5"),
		"check phase title icons missing",
	);
	assert(
		draftHtml.includes("等待") &&
			!draftHtml.includes("等待执行") &&
			!draftHtml.includes(
				'shrink-0 text-xs font-medium text-stone-500">等待</span>',
			),
		"pending checks should not repeat waiting status in cards",
	);
	// 头部状态语义：meta 元信息 / paused 平静态 / attention 警示态（attention 优先于 paused）。
	const metaFlow = readFlow(dir);
	metaFlow.meta = {
		plannedBy: { model: "test/planner-z", thinking: "high" },
		alignment: {
			kind: "recorded",
			turns: [
				{ question: "保留 <问题一> 与质量审查", answer: "保留 & 回答一" },
				{ question: "问题二", answer: "回答二" },
			],
		},
	};
	const metaHtml = readFileSync(writeFlowHtml(dir, metaFlow), "utf8");
	assert(
		metaHtml.includes("planner-z") &&
			metaHtml.includes(">high</span>") &&
			metaHtml.includes("对齐 2 轮") &&
			metaHtml.includes("data-model-chip") &&
			metaHtml.includes("bg-[var(--report-chip)]") &&
			metaHtml.includes(
				'data-tooltip="Q1: 保留 &lt;问题一&gt; 与质量审查\nA1: 保留 &amp; 回答一\n---\nQ2: 问题二\nA2: 回答二"',
			) &&
			!metaHtml.includes("对齐原文"),
		"recorded alignment should use the model chip and exact Q/A tooltip",
	);
	const pausedHeaderFlow = readFlow(dir);
	pausedHeaderFlow.status = "paused";
	pausedHeaderFlow.goals[0].status = "paused";
	const pausedHeaderHtml = readFileSync(
		writeFlowHtml(dir, pausedHeaderFlow),
		"utf8",
	);
	assert(
		pausedHeaderHtml.includes("已暂停") &&
			pausedHeaderHtml.includes("/flow go F1") &&
			!pausedHeaderHtml.includes(">paused<") &&
			!pausedHeaderHtml.includes("需要接管"),
		"paused header state missing or leaked raw enum",
	);
	const attentionFlow = readFlow(dir);
	attentionFlow.status = "paused";
	attentionFlow.startedAt = Date.now() - 42_000;
	attentionFlow.goals[0].status = "running";
	attentionFlow.goals[0].startedAt = attentionFlow.startedAt;
	attentionFlow.attention = {
		kind: "check_hard_cap",
		message: "已连续 10 轮检查未通过，自动暂停防止无限循环",
		at: Date.now(),
	};
	const attentionHtml = readFileSync(writeFlowHtml(dir, attentionFlow), "utf8");
	assert(
		attentionHtml.includes("需要接管 · 已自动暂停") &&
			attentionHtml.includes("已连续 10 轮检查未通过") &&
			attentionHtml.includes("tone-red-surface") &&
			attentionHtml.includes("rgba(150,45,60,.12)") &&
			attentionHtml.includes('data-copy-command="/flow go F1"') &&
			!attentionHtml.includes(' data-elapsed-since="'),
		"attention header state or resume command copy action missing",
	);
	assert(
		(attentionHtml.match(/已暂停 ·/g) ?? []).length === 0,
		"attention must take precedence over the paused line",
	);
	const mixedFlow = readFlow(dir);
	mixedFlow.goals[0].checks.quality.enabled = false;
	const mixedHtml = readFileSync(writeFlowHtml(dir, mixedFlow), "utf8");
	assert(
		mixedHtml.includes("等待") && !mixedHtml.includes("未启用"),
		"disabled empty checks should be hidden",
	);
	const enabledHtml = draftHtml;
	assert(
		enabledHtml.includes("等待") && !enabledHtml.includes("未启用"),
		"enabled checks should show waiting only in compact progress",
	);
	const checkingFlow = readFlow(dir);
	const checkingNow = Date.now();
	checkingFlow.status = "running";
	checkingFlow.startedAt = checkingNow - 42_000;
	checkingFlow.goals[0].status = "running";
	checkingFlow.goals[0].startedAt = checkingNow - 42_000;
	checkingFlow.goals[0].checks = {
		acceptance: {
			enabled: true,
			rounds: [],
			active: {
				...activeCheck("model-a"),
				startedAt: checkingNow - 192_000,
				models: [
					{
						key: "model-a",
						label: "model-a",
						outcome: {
							result: "failed",
							summary: "模型 A 短摘要",
							details: "FAIL\n模型 A 完整检查结果",
						},
					},
					{
						key: "model-b",
						label: "model-b",
						outcome: {
							result: "failed",
							summary: "模型 B 短摘要",
							details: "FAIL\n模型 B 完整检查结果",
						},
					},
					{ key: "model-c", label: "model-c", outcome: null },
				],
			},
		},
		quality: {
			enabled: true,
			rounds: [],
			active: {
				...activeCheck("model-q"),
				startedAt: checkingNow - 720_000,
			},
		},
	};
	const checkingHtml = readFileSync(writeFlowHtml(dir, checkingFlow), "utf8");
	assert(
		checkingHtml.includes('data-copy-command="/flow go F1"') &&
			checkingHtml.includes('data-copy-command="/flow stop F1"'),
		"running footer should copy both control commands",
	);
	assert(
		checkingHtml.includes("模型 A 完整检查结果") &&
			checkingHtml.includes("模型 B 完整检查结果"),
		"settled models should expose full feedback before the active round finishes",
	);
	assert(
		checkingHtml.includes("0.7m") &&
			checkingHtml.includes("3.2m") &&
			checkingHtml.includes("12m") &&
			checkingHtml.includes("data-step-meta") &&
			checkingHtml.includes("data-step-elapsed") &&
			count(checkingHtml, ' data-elapsed-since="') === 4 &&
			checkingHtml.includes("timer = setInterval(update, 60_000)") &&
			checkingHtml.includes('document.addEventListener("visibilitychange"') &&
			checkingHtml.includes("document.hidden ? stop() : start()"),
		"running report did not expose one visibility-aware minute timer",
	);
	assert(
		checkingHtml.includes("验收中") &&
			checkingHtml.includes("质检中") &&
			checkingHtml.includes('data-tooltip="验收中"') &&
			checkingHtml.includes('data-tooltip="质检中"') &&
			checkingHtml.includes('class="h-6 w-6 bot-soft"') &&
			checkingHtml.includes('<rect width="16" height="12"') &&
			!checkingHtml.includes(".bot-soft>*") &&
			checkingHtml.includes('class="h-5 w-5 rotate-3d-soft"') &&
			count(checkingHtml, 'class="h-3.5 w-3.5 spin-soft"') >= 2 &&
			checkingHtml.includes('class="h-3 w-3 spin-soft"') &&
			checkingHtml.includes('d="M21 12a9 9 0 1 1-6.219-8.56"') &&
			!checkingHtml.includes('d="M12 6v6l4 2"'),
		"active checks should keep LoaderCircle while top uses bot and detail uses rotate-3d",
	);
	const attentionCheckingFlow = structuredClone(checkingFlow);
	attentionCheckingFlow.attention = {
		kind: "system_error",
		message: "检查系统错误",
		at: Date.now(),
	};
	attentionCheckingFlow.goals[0].checks.acceptance.rounds = [
		{ round: 1, result: "failed", summary: "验收失败" },
	];
	attentionCheckingFlow.goals[0].checks.acceptance.active.round = 2;
	const attentionCheckingHtml = readFileSync(
		writeFlowHtml(dir, attentionCheckingFlow),
		"utf8",
	);
	const pausedCheckingFlow = structuredClone(checkingFlow);
	pausedCheckingFlow.status = "paused";
	const pausedCheckingHtml = readFileSync(
		writeFlowHtml(dir, pausedCheckingFlow),
		"utf8",
	);
	const pausedLaneFlow = structuredClone(checkingFlow);
	pausedLaneFlow.parallelRun = parallelRun([0, 1]);
	pausedLaneFlow.goals[0].status = "paused";
	const pausedLaneHtml = readFileSync(
		writeFlowHtml(dir, pausedLaneFlow),
		"utf8",
	);
	const activeAnimation =
		/class="[^"]*\b(?:spin-soft|pulse-soft|bot-soft)\b[^"]*"/u;
	assert(
		attentionCheckingHtml.includes(">2轮</span>"),
		"static active checkpoint lost its round count",
	);
	for (const [label, staticHtml, marker] of [
		["attention", attentionCheckingHtml, "需要接管 · 检查系统错误"],
		["paused", pausedCheckingHtml, "已暂停"],
		["paused lane", pausedLaneHtml, "data-parallel-stepper"],
	])
		assert(
			staticHtml.includes(marker) &&
				!staticHtml.includes(' data-elapsed-since="') &&
				!staticHtml.includes("验收中") &&
				!staticHtml.includes("质检中") &&
				!activeAnimation.test(staticHtml),
			`${label} report kept active check semantics`,
		);
	const consultingFlow = structuredClone(checkingFlow);
	consultingFlow.goals[0].checks.acceptance.consulting = true;
	const consultingHtml = readFileSync(
		writeFlowHtml(dir, consultingFlow),
		"utf8",
	);
	assert(
		consultingHtml.includes("data-advisor-consulting") &&
			consultingHtml.includes("[&>[data-advisor-consulting]]:mt-2") &&
			!consultingHtml.includes('data-advisor-consulting><div class="my-2.5'),
		"consulting advisor spacing should be owned by the round list",
	);
	const repairingFlow = readFlow(dir);
	repairingFlow.status = "running";
	repairingFlow.startedAt = Date.now();
	repairingFlow.goals[0].status = "running";
	repairingFlow.goals[0].checks = {
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result: "failed", summary: "验收失败" }],
			active: null,
		},
		quality: {
			enabled: true,
			rounds: [{ round: 1, result: "failed", summary: "质检失败" }],
			active: null,
		},
	};
	const repairingHtml = readFileSync(writeFlowHtml(dir, repairingFlow), "utf8");
	assert(
		repairingHtml.includes("补完中") &&
			repairingHtml.includes("优化中") &&
			count(repairingHtml, 'class="h-3.5 w-3.5 spin-soft"') >= 2,
		"repair labels should be phase-specific and show loader icons",
	);
	const parallelFlow = readFlow(dir);
	parallelFlow.status = "running";
	parallelFlow.startedAt = Date.now();
	parallelFlow.parallelRun = parallelRun([0, 1]);
	parallelFlow.goals[0].status = "running";
	parallelFlow.goals[1].status = "running";
	const parallelHtml = readFileSync(writeFlowHtml(dir, parallelFlow), "utf8");
	assert(
		parallelHtml.includes("border-l border-dashed border-stone-300"),
		"running command chips should have a dashed divider",
	);
	assert(
		!parallelHtml.includes("当前</span>") && !parallelHtml.includes(" · 当前"),
		"parallel batch should not render redundant current status pills",
	);
	assert(
		parallelHtml.includes("data-parallel-stepper") &&
			parallelHtml.includes("data-parallel-group") &&
			parallelHtml.includes('data-parallel-group data-tone="blue"') &&
			parallelHtml.includes("data-parallel-divider") &&
			parallelHtml.includes("M15 6a9 9 0 0 0-9 9V3") &&
			!parallelHtml.includes("∥") &&
			parallelHtml.includes("rough-branch-layer") &&
			!parallelHtml.includes("data-parallel-label"),
		"parallel batch stepper branch did not show grouped connector",
	);
	const pausedFlow = readFlow(dir);
	pausedFlow.status = "paused";
	pausedFlow.startedAt = Date.now() - 42_000;
	pausedFlow.goals[0].status = "running";
	pausedFlow.goals[0].startedAt = pausedFlow.startedAt;
	const pausedHtml = readFileSync(writeFlowHtml(dir, pausedFlow), "utf8");
	assert(
		!pausedHtml.includes('data-rough-seal data-tone="amber"') &&
			pausedHtml.includes(
				'text-amber-800 dark:text-amber-300">已暂停</span>',
			) &&
			pausedHtml.includes("0.7m") &&
			!pausedHtml.includes(' data-elapsed-since="'),
		"paused current goal should render a static amber state and duration",
	);
	assert(
		draftHtml.includes("安装依赖并初始化数据库") &&
			!draftHtml.includes('data-tooltip="安装依赖并初始化数据库"') &&
			draftHtml.includes("准备环境") &&
			draftHtml.includes("进行中") &&
			draftHtml.includes("阻塞") &&
			!draftHtml.includes("**准备环境**") &&
			!draftHtml.includes("**等待凭证**"),
		"flow step list not aligned with goal rendering",
	);
	assert(
		count(draftHtml, "<div data-step-flow-container") === 2 &&
			count(draftHtml, "<ol data-step-flow") === 2 &&
			draftHtml.includes('<div data-step-flow-container class="relative">') &&
			!draftHtml.includes('data-step-flow-container class="relative mt-5"') &&
			!draftHtml.includes("data-step-columns") &&
			!draftHtml.includes("data-step-column") &&
			draftHtml.includes("data-step-copy") &&
			draftHtml.includes("data-step-detail") &&
			draftHtml.includes("rough-step-flow-layer") &&
			draftHtml.includes("layoutStepFlows") &&
			draftHtml.includes("drawStepFlowConnector"),
		"six-step goal should render one semantic list with dynamic flow layout",
	);
	assert(
		draftHtml.includes("container-type:inline-size") &&
			draftHtml.includes("@container (min-width:901px)") &&
			draftHtml.includes(
				"@container (min-width:420px) and (max-width:900px)",
			) &&
			draftHtml.includes("clamp(220px,42cqi,288px)") &&
			draftHtml.includes("@container (max-width:419px)") &&
			!draftHtml.includes("xl:grid-cols-[minmax(0,1fr)_340px]"),
		"goal body should use one gap-free container-query layout",
	);
	const connectorRoute = stepFlowConnectorPath({
		source: { x: 36, y: 198 },
		target: { x: 524, y: 18 },
		gutterLeft: 476,
		gutterRight: 524,
		sourceCopyLeft: 52,
		contentBottom: 216,
		channelY: 248,
		minimumClearance: STEP_FLOW_MIN_CLEARANCE,
	});
	assert(
		connectorRoute &&
			connectorRoute.sourceLaneX > 36 &&
			52 - connectorRoute.sourceLaneX >= STEP_FLOW_MIN_CLEARANCE &&
			connectorRoute.gutterX > 476 &&
			connectorRoute.gutterX < 524 &&
			connectorRoute.channelY - 216 >= STEP_FLOW_MIN_CLEARANCE &&
			STEP_FLOW_ROUGH_OPTIONS.seed > 0,
		`step flow connector left its reserved channels: ${JSON.stringify(connectorRoute)}`,
	);
	assert(
		stepFlowConnectorPath({
			source: { x: 36, y: 198 },
			target: { x: 524, y: 18 },
			gutterLeft: 476,
			gutterRight: 524,
			sourceCopyLeft: 52,
			contentBottom: 216,
			channelY: 226,
			minimumClearance: STEP_FLOW_MIN_CLEARANCE,
		}) === undefined,
		"step flow connector should skip rendering without enough clearance",
	);
	assert(
		stepFlowTargetHeight([60, 60, 60, 60], 289) === undefined &&
			stepFlowTargetHeight([60, 60, 60, 60, 60, 60, 60, 60], 289) === 289 &&
			stepFlowTargetHeight([60, 60, 100, 60, 60], 180) === 220,
		"step flow height should stay single-column until content exceeds the aside",
	);
	assert(
		count(singleDraftHtml, "<div data-step-flow-container") === 1 &&
			count(singleDraftHtml, "<ol data-step-flow") === 1 &&
			count(fiveStepHtml, "<div data-step-flow-container") === 1 &&
			count(fiveStepHtml, "<ol data-step-flow") === 1 &&
			count(fiveStepHtml, "<div data-step-row") === 5 &&
			!draftHtml.includes("data-step-list") &&
			!singleDraftHtml.includes("data-step-list") &&
			!fiveStepHtml.includes("data-step-list"),
		"all goal sizes should enter the same height-driven step flow",
	);
	assert(
		count(draftHtml, "<div data-step-row") === 7 &&
			!draftHtml.includes("<details data-step-details") &&
			!draftHtml.includes("data-step-disclosure") &&
			!draftHtml.includes("details[open]") &&
			!draftHtml.includes('querySelectorAll("details")') &&
			!draftHtml.includes("sessionStorage"),
		"step details should stay visible without disclosure state",
	);
	assert(
		draftHtml.includes("<span>更多</span></span>") &&
			!draftHtml.includes("<span>更多</span></button>"),
		"draft goal details should keep the hover trigger",
	);
	assert(!draftHtml.includes("pending"), "pending leaked into html");
	assert(
		!draftHtml.includes("未绑定 session"),
		"internal session label leaked",
	);
	const flow = readFlow(dir);
	const sessionFile = join(cwd, "goal-session.jsonl");
	flow.status = "complete";
	flow.startedAt = Date.UTC(2026, 6, 14, 8, 0, 0);
	flow.completedAt = flow.startedAt + 900_000;
	flow.errors = ["bad plan"];
	flow.goals[0].status = "complete";
	flow.goals[0].startedAt = flow.startedAt;
	flow.goals[0].completedAt = flow.startedAt + 42_000;
	flow.goals[0].sessionFile = sessionFile;
	flow.goals[0].sessionName = "实现登录";
	flow.goals[0].result.handoff = "- 已交接\n- `pnpm test` 通过";
	flow.goals[0].checks = passedChecks();
	const longModelFeedback = `${"完整模型反馈。".repeat(180)}尾部唯一反馈`;
	flow.goals[0].checks.acceptance.rounds = [
		{
			round: 1,
			result: "failed",
			summary: "旧失败摘要",
			elapsedMs: 192_000,
			details: `FAIL\n\n模型 1 · gpt-5.4\n## 发现 1\n- 问题: ${longModelFeedback}`,
			models: [{ label: "gpt-5.4", status: "failed", summary: "短摘要" }],
		},
		{
			round: 2,
			result: "passed",
			summary: "新通过摘要",
			elapsedMs: 1_000,
		},
	];
	flow.goals[0].checks.quality.rounds = [
		{
			round: 1,
			result: "failed",
			summary: "旧质量失败",
			elapsedMs: 720_000,
			details: "FAIL\n\n## 发现 1\n- 问题: 质量失败详情",
		},
		{ round: 2, result: "passed", summary: "新质量通过" },
	];
	flow.goals[1].status = "complete";
	flow.goals[1].startedAt = flow.startedAt + 180_000;
	flow.goals[1].completedAt = flow.startedAt + 900_000;
	flow.goals[1].result.handoff = "final handoff";
	flow.goals[1].result.summary = "summary";
	flow.goals[1].checks = passedChecks();
	// 遗留建议聚合：质检输出的「## 建议（非阻塞）」段进完成卡。
	flow.goals[1].checks.quality.rounds = [
		{
			round: 1,
			result: "passed",
			summary: "质检通过",
			details:
				"PASS\n质检通过\n证据：文件=src/app.ts；命令=npm test\n\n## 建议（非阻塞）\n- 建议给 parse 增加输入上限",
		},
	];
	const htmlPath = writeFlowHtml(dir, flow);
	const html = readFileSync(htmlPath, "utf8");
	assert(
		html.includes("tailwindcss v3.4.17") &&
			html.includes(".max-w-\\[1480px\\]") &&
			html.includes(
				".lg\\:grid-cols-\\[minmax\\(0\\2c 1fr\\)_auto_minmax\\(0\\2c 1fr\\)\\]",
			) &&
			!html.includes("<script src=") &&
			!html.includes("cdn."),
		"self-contained Tailwind CSS or dynamic report classes missing",
	);
	assert(
		html.includes("var rough=") &&
			html.includes('"seed":17') &&
			html.includes('"roughness":0.8'),
		"inlined Rough.js or deterministic connector options missing",
	);
	const script = /<script>([\s\S]*)<\/script>/u.exec(html)?.[1];
	const cspHash = /script-src 'sha256-([^']+)'/u.exec(html)?.[1];
	assert(script && cspHash, "strict report CSP missing");
	assert(
		createHash("sha256").update(script).digest("base64") === cspHash &&
			!html.includes(`unsafe-${"eval"}`) &&
			!html.includes("script-src 'unsafe-inline'"),
		"report CSP does not authorize exactly the inlined script",
	);
	assert(!html.includes("mermaid"), "mermaid should be removed");
	assert(
		html.includes('new EventSource("events")'),
		"relative live reload SSE missing",
	);
	assert(html.includes("data-rough-card"), "rough card markers missing");
	assert(
		!html.includes('http-equiv="refresh"'),
		"meta refresh should be removed",
	);
	assert(count(html, "<article") === 2, "plan cards missing");
	assert(
		html.includes("data-flow-timing") &&
			html.includes("开始于") &&
			html.includes("完成于") &&
			html.includes("0.7m") &&
			html.includes("3.2m") &&
			html.includes("12m") &&
			html.includes("&lt;0.1m") &&
			!html.includes(' data-elapsed-since="'),
		"complete report did not render static Flow/step/round timing",
	);
	const completeMoreTooltips = [
		...html.matchAll(/data-hover-chip data-tooltip="([^"]+)"/gu),
	].map((match) => match[1]);
	assert(
		completeMoreTooltips.some(
			(tooltip) => tooltip.includes("开始于\n") && tooltip.includes("完成于\n"),
		),
		"step more details omitted start/completion timestamps",
	);
	assert(
		html.includes("全部完成 · 2 步") &&
			html.includes("交付详情") &&
			html.includes('data-modal-open="dlg-delivery-details"') &&
			html.includes('<dialog id="dlg-delivery-details"') &&
			html.includes('class="mt-4 flex justify-end"') &&
			!html.includes("最终交接") &&
			!html.includes("Final handoff"),
		"completion title or delivery-details action missing",
	);
	assert(
		html.includes("遗留建议") &&
			html.includes("建议给 parse 增加输入上限") &&
			html.includes("第 2 步"),
		"remaining suggestions digest missing from completion card",
	);
	assert(
		!html.includes("<details data-step-details") &&
			html.includes("data-step-detail"),
		"completed goal details should stay visible",
	);
	assert(
		html.includes('<article data-rough-card data-tone="green"') &&
			html.includes(
				'shrink-0 text-xs font-medium text-emerald-800 dark:text-emerald-300">已完成</span>',
			) &&
			!html.includes(
				'shrink-0 text-xs font-medium text-emerald-800 dark:text-emerald-300">已通过</span>',
			),
		"completed goal card should use green edge and hide repeated passed statuses",
	);
	assert(html.includes("校验错误"), "error card missing");
	assert(!html.includes("页面文件"), "flow html leaked page file label");
	assert(!html.includes(htmlPath), "flow html leaked absolute html path");
	assert(!html.includes(sessionFile), "flow html leaked session file path");
	assert(
		html.includes("第 1 轮") && html.includes("未通过"),
		"first failed round label missing",
	);
	assert(html.includes("gpt-5.4"), "acceptance failure history missing");
	assert(html.includes("新通过摘要"), "acceptance pass history missing");
	assert(html.includes("旧质量失败"), "quality failure history missing");
	assert(html.includes("新质量通过"), "quality pass history missing");
	assert(
		html.includes("第 2 轮") && html.includes("通过"),
		"second round history missing",
	);
	assert(html.includes("尾部唯一反馈"), "acceptance details missing");
	assert(
		html.includes("尾部唯一反馈") && html.includes("gpt-5.4"),
		"model hover details should include full untruncated model feedback",
	);
	assert(html.includes("质量失败详情"), "quality details missing");
	const modelChipHtml =
		html.match(
			/<span tabindex="0" data-model-chip[\s\S]*?<\/span><\/span>/gu,
		) ?? [];
	assert(
		!html.includes("查看未通过原因") &&
			modelChipHtml.length > 0 &&
			html.includes('data-tooltip-side="auto"') &&
			!html.includes("data-model-chip data-rough-seal") &&
			modelChipHtml.every(
				(chip) =>
					!chip.includes('circle cx="12" cy="12" r="10"') &&
					!chip.includes("M21.801 10"),
			) &&
			!html.includes("mt-0.5 grid h-4 w-4 shrink-0 place-items-center"),
		"round details should use modern hover model chips with simple non-circled icons",
	);
	assertUniqueDataKeys(html);
	assert(html.includes("实现登录"), "flow html missing session display name");
	assert(html.includes("全部完成 · 2 步"), "complete title missing");
	assert(!html.includes("Goal 0"), "flow html exposed 0-based Goal index");
	assert(
		!html.includes("pnpm test"),
		"step more modal should not repeat handoff content",
	);
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
		singleHtml.includes("执行中有验收口径调整，已在步骤检查中记录"),
		"single-step criteria deviation did not use step-level wording",
	);
	assert(
		!singleHtml.includes("最终验收"),
		"single-step criteria deviation mentioned final acceptance",
	);
	singleFlow.language = "en";
	singleFlow.goals[0].result.handoff = "Delivery notes";
	const singleEnglishHtml = readFileSync(
		writeFlowHtml(singleDir, singleFlow),
		"utf8",
	);
	assert(
		singleEnglishHtml.includes("recorded in this step's checks") &&
			singleEnglishHtml.includes("All complete · 1 step") &&
			singleEnglishHtml.includes("Delivery details") &&
			singleEnglishHtml.includes(">Criteria</p>") &&
			singleEnglishHtml.includes(">1 item</span>") &&
			!singleEnglishHtml.includes("Final handoff") &&
			!singleEnglishHtml.includes("final acceptance"),
		"English completion copy or single-step criteria wording regressed",
	);
	const errorHtml = readFileSync(
		writeFlowErrorHtml(dir, {
			title: "Broken Flow",
			errors: ["bad"],
			requestText: "原始请求",
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

async function flowPromptLiteralPlaceholderScenario() {
	const { generationPrompt, repairPrompt } =
		await importModule("flow/prompt.js");
	const literal =
		"literal {{source}} {{flowPath}} {{language}} {{validateCommand}} $&";
	const generated = generationPrompt({
		requestText: literal,
		sourceType: "conversation",
		language: "zh",
		flowPath: "/tmp/F1",
	});
	const repaired = repairPrompt({
		errors: [literal],
		requestText: literal,
		language: "zh",
		flowPath: "/tmp/F1",
	});
	assert(
		generated.split(literal).length - 1 === 1,
		`generation prompt rewrote literal placeholders: ${generated}`,
	);
	assert(
		repaired.split(literal).length - 1 === 2,
		`repair prompt rewrote literal placeholders: ${repaired}`,
	);
}

async function flowConversationContextEvidenceScenario() {
	writeFlowTestConfig({ generation: { align: "no" } });
	const cwd = tempDir("flow-conversation-context-evidence");
	const sessionFile = join(cwd, "planning.jsonl");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	entriesFor(state, sessionFile).push(
		{
			type: "message",
			id: "user-context",
			parentId: null,
			timestamp: "2026-01-01T00:00:00.000Z",
			message: {
				role: "user",
				content: [
					{
						type: "text",
						text: '保留原始格式和字面模板：\n```json\n{\n  "enabled": true\n}\n```\nliteral {{source}} {{flowPath}} {{language}} {{validateCommand}}',
					},
				],
				timestamp: 0,
			},
		},
		{
			type: "custom_message",
			id: "hidden-context",
			parentId: "user-context",
			timestamp: "2026-01-01T00:00:01.000Z",
			customType: "pi-flow-internal-prompt",
			content: "GENERATION_INTERNAL_SENTINEL",
			display: false,
		},
	);
	await commands.get("flow").handler("", ctx);
	const flow = readFlow(join(cwd, ".flow", "F1"));
	const literal =
		"literal {{source}} {{flowPath}} {{language}} {{validateCommand}}";
	const turn = flow.source.transcript?.[0];
	assert(
		flow.source.type === "conversation" &&
			flow.source.transcript.length === 1 &&
			turn.kind === "user" &&
			turn.at === "2026-01-01T00:00:00.000Z" &&
			turn.text.includes('```json\n{\n  "enabled": true\n}\n```') &&
			turn.text.includes(literal) &&
			!JSON.stringify(flow.source).includes("GENERATION_INTERNAL_SENTINEL"),
		`conversation source is not structured correctly: ${JSON.stringify(flow.source)}`,
	);
	assert(
		state.hiddenMessages.at(-1).includes("用户 · 2026-01-01T00:00:00.000Z") &&
			state.hiddenMessages.at(-1).includes(literal) &&
			!state.hiddenMessages.at(-1).includes("Coverage：") &&
			!state.hiddenMessages.at(-1).includes("[entry:"),
		"generation prompt was not derived from the structured transcript",
	);
	const { formatTranscript } = await importModule("shared/context-evidence.js");
	const { renderFlowHtml, writeFlowErrorHtml } =
		await importModule("flow/html.js");
	const dir = join(cwd, ".flow", "F1");
	const report = renderFlowHtml(dir, flow);
	writeFlowErrorHtml(dir, {
		title: flow.title,
		errors: ["invalid draft"],
		requestText: formatTranscript(flow.source.transcript, flow.language),
		language: flow.language,
	});
	const errorReport = readFileSync(join(dir, "flow.html"), "utf8");
	assert(
		report.includes("data-report-transcript") &&
			report.includes('<time datetime="2026-01-01T00:00:00.000Z"') &&
			report.includes(literal),
		"flow report did not render the structured conversation source",
	);
	assert(
		errorReport.includes("用户 · 2026-01-01T00:00:00.000Z"),
		"validation error report lost its derived request text",
	);
	for (const html of [report, errorReport])
		assert(
			!html.includes("来源：原始 getBranch() 事件") &&
				!html.includes("Coverage：") &&
				!html.includes("[entry:"),
			"request report leaked Context Evidence metadata",
		);
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
	await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "补充结构化需求" },
		ctx,
	);
	const clarified = readFlow(dir);
	assert(
		clarified.source.transcript.length === 2 &&
			clarified.source.transcript[1].kind === "visible_supplement" &&
			clarified.source.transcript[1].text === "补充结构化需求" &&
			state.hiddenMessages.at(-1).includes("用户补充 ·") &&
			state.hiddenMessages.at(-1).includes("补充结构化需求"),
		"conversation clarification was not appended as a structured turn",
	);
}

async function flowConversationContextEvidenceModelFailureScenario() {
	writeFlowTestConfig({ generation: { align: "no" } });
	const cwd = tempDir("flow-conversation-context-model-failure");
	const sessionFile = join(cwd, "planning.jsonl");
	const state = newState(cwd);
	state.missingModels.add("test/current");
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("", ctx);
	assert(!existsSync(join(cwd, ".flow", "F1")), "unbudgeted Flow was created");
	assert(
		state.notifications.at(-1).includes("无法解析模型窗口"),
		state.notifications.join("\n"),
	);
}

async function generationAlignConfigScenario() {
	const { readGenerationConfig } = await importModule("shared/config.js");
	writeFlowTestConfig({ generation: { align: "no" } });
	assert(readGenerationConfig().align === "no", "generation.align no not read");
	for (const depth of ["coarse", "standard", "deep"]) {
		writeFlowTestConfig({ generation: { align: depth } });
		assert(
			readGenerationConfig().align === depth,
			`generation.align ${depth} not read`,
		);
	}
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
			advisor: { model: "missing/provider", thinking: "medium" },
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
			flow.schemaVersion === 17 &&
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
		state.notifications.some((message) => message.includes("顾问模型不可用")) &&
			!state.notifications.some((message) => message.includes("Flow 已创建")),
		`planner switch failure notice mismatch: ${state.notifications.join(" | ")}`,
	);
	writeFlowTestConfig();
}

async function flowGoalStartCardCopyScenario() {
	writeFlowTestConfig({
		modelRoles: {
			executor: { model: "provider/model-a", thinking: "high" },
		},
	});
	try {
		const { sendFlowGoalStartCard } = await importModule(
			"flow/execution/start.js",
		);
		const cwd = tempDir("flow-goal-start-card-copy");
		const dir = createFlow(cwd, "F1");
		const flow = readFlow(dir);
		const state = newState(cwd);
		await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		sendFlowGoalStartCard(
			state.extensionApis.at(-1),
			ctx,
			flow,
			flow.goals[0],
			"One step objective",
		);
		const card = findFlowCard(
			state,
			"Flow Goal 1 已启动",
			"single-step Flow start card missing",
		);
		const lines = card.message.details.lines.join("\n");
		assert(
			lines.includes("编号：F1") &&
				lines.includes("目标：One step objective") &&
				lines.includes("模型：provider/model-a/high") &&
				!lines.includes("进度：1/1") &&
				!lines.includes("后续：无") &&
				!card.message.details.title.includes("第 1 步"),
			lines,
		);
	} finally {
		writeFlowTestConfig();
	}
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
			flow.schemaVersion === 17 &&
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
		requestText: "other flow",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "generating",
		sessionFile: join(cwd, "old.jsonl"),
		autoStart: false,
		requestText: "explicit target flow",
		alignmentTurns: [
			{ question: "原始问题一", answer: "原始回答一" },
			{ question: "原始问题二", answer: "原始回答二" },
		],
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
			target.meta?.alignment?.kind === "recorded" &&
			JSON.stringify(target.meta.alignment.turns) ===
				JSON.stringify([
					{ question: "原始问题一", answer: "原始回答一" },
					{ question: "原始问题二", answer: "原始回答二" },
				]) &&
			!existsSync(join(cwd, ".flow", "F2", "alignment.json")) &&
			other.status === "generating" &&
			existsSync(join(cwd, ".flow", "F1", "alignment.json")),
		"explicit pre-draft go did not archive alignment before removing its checkpoint",
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
		requestText: "first prompted recovery",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "generating",
		sessionFile,
		autoStart: false,
		requestText: "second prompted recovery",
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
		requestText: "other flow must stay unchanged",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "generating",
		sessionFile: join(cwd, "old.jsonl"),
		autoStart: false,
		requestText: "explicit repair target",
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
		requestText: "cross session prompt target",
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
		requestText: "rebound live target",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "generating",
		sessionFile: join(cwd, "other.jsonl"),
		requestText: "old session continue target",
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
		requestText: "rebound live target",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "awaiting_blocking_input",
		sessionFile: sessionA,
		requestText: "old session reply target",
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
			flow.source.text.includes("补充 F2 细节") &&
			state.hiddenMessages.at(-1).includes("old session reply target"),
		"rebound live prompt blocked old session direct reply",
	);
	await emit(handlers, "agent_end", { messages: [] }, ctxA);
	flow = readFlow(join(cwd, ".flow", "F2"));
	assert(
		flow.source.text.includes("补充 F2 细节") && flow.errors.length === 0,
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
		requestText: "other flow must survive completed stale prompt",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "generating",
		stage: "generating",
		sessionFile: sessionA,
		autoStart: false,
		requestText: "target completed after rebind",
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
		schemaVersion: 17,
		language: "zh",
		id: "F1",
		title: "Flow F1",
		status: "aligning",
		source: { type: "prompt", text: "跨会话确认" },
		createdAt: Date.now(),
		updatedAt: Date.now(),
		startedAt: null,
		completedAt: null,
		currentGoal: 0,
		meta: null,
		attention: null,
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
				depth: "standard",
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
		requestText: "other flow must not handle aligning reply",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "aligning",
		stage: "aligning",
		sessionFile: join(cwd, "old.jsonl"),
		requestText: "target aligning recovery",
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
						flow.source.text.includes("补充 F2 生成信息") &&
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
			requestText: "other flow must not handle reply",
		});
		writePreDraftFlow(cwd, "F2", {
			status: item.status,
			stage: item.stage,
			sessionFile: join(cwd, "old.jsonl"),
			requestText: `target ${item.name}`,
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
		requestText: "other flow must not handle repeated replies",
	});
	writePreDraftFlow(cwd, "F2", {
		status: "aligning",
		stage: "awaiting_alignment_input",
		sessionFile: join(cwd, "old.jsonl"),
		requestText: "target repeated alignment",
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
		requestText: "auto-start after input ctx",
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
	state.select = "标准对齐：约 20-30 问，高杠杆 + 关键实现决策";
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
			advisor: { model: "missing/provider", thinking: "medium" },
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
				schemaVersion: 17,
				language: "zh",
				id: "F1",
				title: "Flow F1",
				status: item.status,
				source: { type: "prompt", text: "跨会话切模型" },
				createdAt: Date.now(),
				updatedAt: Date.now(),
				startedAt: null,
				completedAt: null,
				currentGoal: 0,
				meta: null,
				attention: null,
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
						depth: "standard",
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
							notice.includes("顾问模型不可用") &&
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
							notice.includes("顾问模型不可用") &&
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
	state.select = "标准对齐：约 20-30 问，高杠杆 + 关键实现决策";
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
		`repair alignment write failure left half-updated generation state: ${JSON.stringify({ beforeFlow, afterFlow, beforeAlignment, afterAlignment, hiddenBefore, hiddenAfter: state.hiddenMessages.length, notices: state.notifications.slice(-2), tmpExists: existsSync(join(dir, "alignment.json.tmp")) })}`,
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
			notice.includes(
				"回复对齐需求（Q1 / ~30）；「按推荐」委托剩余决策；「/flow go」直接生成计划",
			) &&
			notice.includes("下一步: 「/flow go F1」") &&
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
	await emit(handlers, "session_start", {}, ctx);
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
	writeFlowTestConfig({ generation: { align: "standard" } });
	const standardCwd = tempDir("generation-align-standard-command");
	const standardState = newState(standardCwd);
	const standardExtension = await loadExtension(standardState);
	const standardCtx = commandContext(
		standardState,
		standardCwd,
		join(standardCwd, "planning.jsonl"),
	);
	await standardExtension.commands
		.get("flow")
		.handler("align from config", standardCtx);
	assert(
		standardState.selects.length === 0,
		"generation.align standard showed selector",
	);
	const standardAlignmentPrompt = standardState.hiddenMessages.at(-1);
	assert(
		standardAlignmentPrompt.includes("# 拷问我") &&
			standardState.sentMessages.length === 0,
		"generation.align standard did not start hidden alignment",
	);
	assert(
		standardAlignmentPrompt.includes(
			"先全面审视当前会话、已有需求、代码库线索和文档",
		) &&
			standardAlignmentPrompt.includes("直到达成全面共同理解") &&
			standardAlignmentPrompt.includes("一次只问一个问题") &&
			standardAlignmentPrompt.includes("2-4 个具体选项") &&
			standardAlignmentPrompt.includes("基于项目具体情况，需求以及最佳实践") &&
			standardAlignmentPrompt.includes(
				"提出问题前，先探索相关代码库、文档、测试、调用链或现有 .flow 文件",
			) &&
			standardAlignmentPrompt.includes("能从事实源确认的内容不要询问用户") &&
			standardAlignmentPrompt.includes("高杠杆问题优先") &&
			standardAlignmentPrompt.includes("假设默认制") &&
			standardAlignmentPrompt.includes("问题预算：约 20-30 问") &&
			standardAlignmentPrompt.includes("用户回复「按推荐」时") &&
			standardAlignmentPrompt.includes(
				"ready marker <!-- pi-flow:ready-to-draft -->",
			) &&
			!standardAlignmentPrompt.includes("{{questionBudget}}") &&
			!standardAlignmentPrompt.includes("<aligned-request>") &&
			!standardAlignmentPrompt.includes("阻塞哪个未确认决策") &&
			!standardAlignmentPrompt.includes("每轮先列出未确认决策树"),
		"standard alignment prompt missing standard budget grilling contract",
	);
	const standardAlignment = JSON.parse(
		readFileSync(join(standardCwd, ".flow", "F1", "alignment.json"), "utf8"),
	);
	assert(
		standardAlignment.depth === "standard",
		"standard config did not persist standard depth",
	);

	writeFlowTestConfig({ generation: { align: "coarse" } });
	const coarseCwd = tempDir("generation-align-coarse-command");
	const coarseState = newState(coarseCwd);
	const coarseExtension = await loadExtension(coarseState);
	const coarseCtx = commandContext(
		coarseState,
		coarseCwd,
		join(coarseCwd, "planning.jsonl"),
	);
	await coarseExtension.commands
		.get("flow")
		.handler("coarse from config", coarseCtx);
	assert(
		coarseState.selects.length === 0 &&
			coarseState.hiddenMessages.at(-1).includes("问题预算：约 10 问以内") &&
			JSON.parse(
				readFileSync(join(coarseCwd, ".flow", "F1", "alignment.json"), "utf8"),
			).depth === "coarse",
		"generation.align coarse did not inject coarse budget and persist depth",
	);
	const flowCardIndex = standardState.customMessages.findIndex(
		(item) =>
			item.message.customType === "pi-flow-result-card" &&
			item.message.details?.title === "开始对齐 Flow" &&
			String(item.message.content).includes("编号：F1") &&
			String(item.message.content).includes("先确认范围和拆分方式，再生成计划"),
	);
	const flowHiddenPromptIndex = standardState.customMessages.findIndex(
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
	await flushScheduledGoalStart();
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
	state.select = "标准对齐：约 20-30 问，高杠杆 + 关键实现决策";
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("activity copy", ctx);
	const initialActivity = latestWidgetText(state);
	assert(
		initialActivity.includes("🌊 Flow · Q1") &&
			initialActivity.includes("准备问题中") &&
			hasGoalFlame(initialActivity),
		"initial alignment activity should prepare Q1 with a flame",
	);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", content: "问题 1：范围？" }] },
		ctx,
	);
	const waitingReplyActivity = latestWidgetText(state);
	assert(
		waitingReplyActivity.includes("🌊 Flow · Q1 / ~30") &&
			waitingReplyActivity.includes(
				"回复对齐需求 ｜「按推荐」委托剩余决策 ｜「/flow go」直接生成计划",
			) &&
			!waitingReplyActivity.includes("🌊 Flow · 等待回复 Q1") &&
			!waitingReplyActivity.includes("开始生成") &&
			!hasGoalFlame(waitingReplyActivity),
		"alignment question should wait for Q1 reply without a flame",
	);
	const answerResult = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "范围 A" },
		ctx,
	);
	const nextQuestionActivity = latestWidgetText(state);
	assert(
		answerResult?.action === "handled" &&
			nextQuestionActivity.includes("🌊 Flow · Q2") &&
			nextQuestionActivity.includes("准备问题中") &&
			hasGoalFlame(nextQuestionActivity),
		"alignment answer should prepare Q2 with a flame",
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
	const alignedActivity = latestWidgetText(state);
	assert(
		alignedActivity.includes("🌊 Flow · 已对齐") &&
			alignedActivity.includes("「/flow go」生成计划 ｜继续回复则补充信息") &&
			!hasGoalFlame(alignedActivity),
		"ready marker should wait for confirmation without a flame",
	);
	await commands.get("flow").handler("go F1", ctx);
	const draftingActivity = latestWidgetText(state);
	assert(
		draftingActivity.includes("🌊 Flow · 生成中") &&
			draftingActivity.includes("基于 1 轮问答生成全面计划") &&
			!draftingActivity.includes("Q1") &&
			!draftingActivity.includes("Q2") &&
			hasGoalFlame(draftingActivity),
		"drafting activity should be compact and keep its flame",
	);
	assert(
		state.hiddenMessages.at(-1).includes("activity copy") &&
			!state.hiddenMessages.at(-1).includes("Q1:") &&
			!state.hiddenMessages.at(-1).includes("A1:") &&
			!state.hiddenMessages.at(-1).includes("恢复的对齐问答"),
		"same-session generation prompt should not inject alignment Q&A",
	);
}

async function flowAlignmentQuestionGoDraftsScenario() {
	const cwd = tempDir("flow-alignment-question-go-drafts");
	const state = newState(cwd);
	state.select = "标准对齐：约 20-30 问，高杠杆 + 关键实现决策";
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("question go drafts", ctx);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", content: "问题 1：范围？" }] },
		ctx,
	);
	await commands.get("flow").handler("go F1", ctx);
	const alignment = JSON.parse(
		readFileSync(join(cwd, ".flow", "F1", "alignment.json"), "utf8"),
	);
	assert(
		alignment.stage === "generating" &&
			latestWidgetText(state).includes("🌊 Flow · 生成中") &&
			latestWidgetText(state).includes("洞察全部上下文，生成全面计划") &&
			state.hiddenMessages.at(-1).includes("question go drafts") &&
			!state.hiddenMessages.at(-1).includes("继续 Flow 生成前对齐"),
		"/flow go from a pending alignment question should draft immediately",
	);
}

async function flowPromptMarkerHiddenScenario() {
	const cwd = tempDir("flow-prompt-marker-hidden");
	const state = newState(cwd);
	state.select = "标准对齐：约 20-30 问，高杠杆 + 关键实现决策";
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("old target", ctx);
	await commands.get("flow").handler("stop F1", ctx);
	await commands.get("flow").handler("new target", ctx);
	const token = state.hiddenMessages
		.at(-1)
		?.match(/<!--\s*pi-flow:prompt:([^\s]+)\s*-->/u)?.[1];
	assert(token, "hidden prompt token missing");
	const messageEnd = await emitLast(
		handlers,
		"message_end",
		{
			message: {
				role: "assistant",
				content: `问题 1：范围？\n<!-- pi-flow:prompt:${token} -->`,
			},
		},
		ctx,
	);
	assert(
		messageEnd?.message.content === "问题 1：范围？" &&
			!messageEnd.message.content.includes("pi-flow:prompt"),
		"prompt marker should be stripped before display",
	);
	await emit(handlers, "agent_end", { messages: [messageEnd.message] }, ctx);
	const alignment = JSON.parse(
		readFileSync(join(cwd, ".flow", "F2", "alignment.json"), "utf8"),
	);
	assert(
		alignment.stage === "awaiting_alignment_input" &&
			alignment.lastAlignmentQuestion === "问题 1：范围？",
		"stripped prompt marker should still route the result to the live Flow",
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
	assertNoticeFormat(
		state.notifications.at(-1),
		"⏳",
		"运行 「/flow go F1」 继续",
	);
}

async function flowReadyWithoutAlignedRequestScenario() {
	const cwd = tempDir("flow-ready-missing-summary");
	const state = newState(cwd);
	state.select = "标准对齐：约 20-30 问，高杠杆 + 关键实现决策";
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
		latestWidgetText(state).includes("🌊 Flow · 已对齐") &&
			latestWidgetText(state).includes(
				"「/flow go」生成计划 ｜继续回复则补充信息",
			) &&
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
		latestWidgetText(state).includes("🌊 Flow · Q2") &&
			latestWidgetText(state).includes("准备问题中") &&
			!latestWidgetText(state).includes("已收到"),
		"flow alignment input should keep a question-preparation activity box",
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
		latestWidgetText(state).includes("🌊 Flow · 生成中") &&
			latestWidgetText(state).includes("基于 1 轮问答生成全面计划") &&
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
		schemaVersion: 17,
		language: "zh",
		id: "F99",
		title: "Flow F99",
		status: "aligning",
		source: {
			type: "prompt",
			text: "恢复后生成计划",
		},
		createdAt: Date.now(),
		updatedAt: Date.now(),
		startedAt: null,
		completedAt: null,
		currentGoal: 0,
		meta: null,
		attention: null,
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
				depth: "standard",
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
	state.select = "标准对齐：约 20-30 问，高杠杆 + 关键实现决策";
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

async function flowAlignmentDeepDepthPersistenceScenario() {
	const cwd = tempDir("flow-alignment-deep-depth");
	const state = newState(cwd);
	state.select = "深度对齐：不设硬上限，高杠杆问题优先";
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("deep depth persistence", ctx);
	const dir = join(cwd, ".flow", "F1");
	assert(
		JSON.parse(readFileSync(join(dir, "alignment.json"), "utf8")).depth ===
			"deep" && state.hiddenMessages.at(-1).includes("问题预算：不设硬上限"),
		"deep select did not persist depth or inject deep budget",
	);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", content: "问题 1：范围？" }] },
		ctx,
	);
	assert(
		latestWidgetText(state).includes("🌊 Flow · Q1") &&
			!latestWidgetText(state).includes("Q1 / ~"),
		"deep waiting activity should hide the budget denominator",
	);
	await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "全部范围" },
		ctx,
	);
	const followUp = state.hiddenMessages.at(-1);
	assert(
		followUp.includes("问题预算：不设硬上限") &&
			!followUp.includes("约 20-30 问"),
		"follow-up prompt did not carry the persisted deep budget",
	);
}

function assertLightweightAlignmentPrompt(prompt) {
	assert(
		prompt.includes("继续 Flow 生成前对齐") &&
			prompt.includes("问题预算：") &&
			prompt.includes("遵循首次拷问协议") &&
			prompt.includes("先查事实") &&
			prompt.includes("高杠杆问题优先") &&
			prompt.includes("满足收敛条件后") &&
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
			prompt.includes("Question budget:") &&
			prompt.includes("Follow the initial questioning protocol") &&
			prompt.includes("inspect facts first") &&
			prompt.includes("prioritize high-leverage questions") &&
			prompt.includes("After convergence") &&
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
	let unsubscribeAttention = () => {};
	process.env.PI_FLOW_LANGUAGE = "en";
	language.resetRuntimeLanguageForTests();
	try {
		const cwd = tempDir("flow-english-alignment-start-generation");
		const state = newState(cwd);
		state.select =
			"Standard alignment: ~20-30 questions, high-leverage + key implementation decisions";
		const { commands, handlers } = await loadExtension(state);
		const { piActivitySignal, piAttentionSignal } = await importCachedModule(
			"shared/activity-signal.js",
		);
		const attentionSources = [];
		unsubscribeAttention = piAttentionSignal().subscribe((request) =>
			attentionSources.push(request.source),
		);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		await commands.get("flow").handler("Ship English flow", ctx);
		assert(
			piActivitySignal().state.sources.includes("pi-flow:frame"),
			"alignment preparation did not publish working activity",
		);
		assert(
			latestWidgetText(state).includes("🌊 Flow · Aligning") &&
				latestWidgetText(state).includes("Preparing Q1") &&
				!latestWidgetText(state).includes("等待"),
			"English flow aligning widget leaked Chinese or missed Q1 preparation",
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
					"Before asking a question, inspect the relevant codebase, documentation, tests, call chains, or existing .flow files",
				) &&
				englishAlignmentPrompt.includes(
					"Do not ask the user about anything the sources of truth can confirm",
				) &&
				englishAlignmentPrompt.includes("High-leverage questions first") &&
				englishAlignmentPrompt.includes("continue asking beyond the budget") &&
				englishAlignmentPrompt.includes(
					"Question budget: about 20-30 questions",
				) &&
				englishAlignmentPrompt.includes('replies "use recommendations"') &&
				englishAlignmentPrompt.includes(
					"ready marker <!-- pi-flow:ready-to-draft -->",
				) &&
				!englishAlignmentPrompt.includes("{{questionBudget}}") &&
				!englishAlignmentPrompt.includes("<aligned-request>") &&
				!englishAlignmentPrompt.includes(
					"which unconfirmed decision it blocks",
				) &&
				!englishAlignmentPrompt.includes("list the unconfirmed decision tree"),
			"English alignment prompt missing high-leverage grilling contract",
		);
		await emit(
			handlers,
			"agent_end",
			{ messages: [{ role: "assistant", content: "Question 1: Need tests?" }] },
			ctx,
		);
		assert(
			attentionSources.join("|") === "flow-draft:F1",
			`alignment question did not request user attention: ${JSON.stringify({ activity: piActivitySignal().state, attentionSources })}`,
		);
		assert(
			latestWidgetText(state).includes("🌊 Flow · Waiting for reply") &&
				latestWidgetText(state).includes(
					'Answer Q1 of ~30 · "use recommendations" delegates the rest',
				) &&
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
				piActivitySignal().state.sources.includes("pi-flow:frame") &&
				latestWidgetText(state).includes("Preparing Q2") &&
				!latestWidgetText(state).includes("Preparing Q1"),
			"English alignment answer should prepare Q2",
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
			attentionSources.join("|") === "flow-draft:F1|flow-draft:F1",
			`final alignment confirmation did not request attention: ${JSON.stringify({ activity: piActivitySignal().state, attentionSources })}`,
		);
		assert(
			latestWidgetText(state).includes("🌊 Flow · Ready to draft") &&
				latestWidgetText(state).includes(
					"Run 「/flow go F1」 to generate the plan",
				) &&
				!latestWidgetText(state).includes("回复「开始生成」"),
			"English flow final-confirmation widget leaked Chinese",
		);
		await commands.get("flow").handler("go F1", ctx);
		assert(
			piActivitySignal().state.sources.includes("pi-flow:frame") &&
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
		unsubscribeAttention();
		if (originalLanguage === undefined) delete process.env.PI_FLOW_LANGUAGE;
		else process.env.PI_FLOW_LANGUAGE = originalLanguage;
		language.resetRuntimeLanguageForTests();
	}
}

async function flowReportPortConflictIsolationScenario() {
	const occupied = createHttpServer((_request, response) =>
		response.end("occupied"),
	);
	await new Promise((resolve, reject) => {
		occupied.once("error", reject);
		occupied.listen(49327, "127.0.0.1", resolve);
	});
	try {
		writeFlowTestConfig();
		const cwd = tempDir("flow-report-port-conflict");
		const state = newState(cwd);
		const { commands, handlers } = await loadExtension(state);
		const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		await commands.get("flow").handler("修登录", ctx);
		writeFlowSemanticDraft(cwd, "F1", { title: "Port conflict" });
		const reportFailure = waitForNotification(state, (notification) =>
			notification.includes("网页报告不可用"),
		);
		await emit(handlers, "agent_end", { messages: [] }, ctx);
		await reportFailure;
		const reportClient = await importCachedModule("shared/report-client.js");
		await reportClient.waitForReportClientIdle();
		const diagnostics = reportClient.reportClientResourceSnapshot();
		assert(
			diagnostics.failureCount > 0 &&
				!diagnostics.connected &&
				diagnostics.registeredReports === 0 &&
				diagnostics.registerChains === 0,
			`failed report connection diagnostics mismatch: ${JSON.stringify(diagnostics)}`,
		);
		await flushScheduledGoalStart();
		const flow = readFlow(join(cwd, ".flow", "F1"));
		assert(
			flow.status === "running" && state.newSessions.length === 1,
			`report conflict blocked generation closeout: ${JSON.stringify({ status: flow.status, sessions: state.newSessions.length })}`,
		);
		assert(
			state.notifications.filter((item) => item.includes("网页报告不可用"))
				.length === 1 &&
				state.notifications.some((item) => item.includes("unknown service")),
			`report conflict notice missing or duplicated: ${state.notifications.join(" | ")}`,
		);
		await commands.get("flow").handler("status F1", ctx);
		assert(
			state.notifications.some(
				(item) =>
					item.includes("Flow: F1") &&
					item.includes("网页报告不可用") &&
					item.includes("unknown service"),
			),
			`explicit status hid report failure: ${state.notifications.join(" | ")}`,
		);
	} finally {
		await new Promise((resolve, reject) =>
			occupied.close((error) => (error ? reject(error) : resolve())),
		);
		writeFlowTestConfig();
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
		JSON.stringify(readFlow(directFlowDir).source) ===
			JSON.stringify({ type: "prompt", text: "修登录" }),
		"prompt source did not persist only its canonical text",
	);
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
		latestWidgetText(state).includes("🌊 Flow · 生成中") &&
			latestWidgetText(state).includes("洞察全部上下文，生成全面计划") &&
			!latestWidgetText(state).includes("Q1"),
		"direct generation activity should be compact without Q&A turns",
	);
	writeFlowSemanticDraft(cwd, "F1", { title: "Login Flow" });
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	await waitForExec(state, (item) =>
		item.args.some((arg) => String(arg).startsWith("http://127.0.0.1:")),
	);
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
		JSON.stringify(readFlow(join(cwd, ".flow", "F2")).source) ===
			JSON.stringify({ type: "file", path: file, text: "raw md plan" }),
		"file source did not persist path and text",
	);
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
				message.includes("完成后能在 `Verification` / `Handoff` 给出证据") &&
				!message.includes("3–12 个小步骤"),
		),
		"repair prompt missing milestone step rules",
	);
}

async function generatedSummaryBareIdScenario() {
	const { startGeneration } = await importCachedModule("flow/generation.js");
	const cwd = tempDir("generate-short-id-summary");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("status F999", ctx);

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
	assertNoticeFormat(notice, "✅", "下一步：「/flow go F1」");
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
	assert(
		state.newSessions.length === 0,
		"flow auto-start replaced the session before agent_end dispatch completed",
	);
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
		requestText: "recovered without command context",
	});
	writeFlowSemanticDraft(cwd, "F1", { title: "No Command Context" });
	const state = newState(cwd);
	const { handlers } = await loadExtension(state);
	const eventCtx = commandContext(state, cwd, sessionFile);
	eventCtx.newSession = undefined;
	await emit(handlers, "session_start", {}, eventCtx);
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
	const { flowGenerationResourceCounts } =
		await importCachedModule("flow/generation.js");
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
	await flushScheduledGoalStart();
	assert(readFlow(dir).status === "running", "semantic flow did not start");
	assert(
		Object.values(flowGenerationResourceCounts()).every((count) => count === 0),
		`successful generation retained temporary state: ${JSON.stringify(flowGenerationResourceCounts())}`,
	);
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

async function invalidWriteScopeTriggersRepairScenario() {
	const cwd = tempDir("flow-invalid-write-scope");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("reject ambiguous write scope", ctx);
	const dir = writeFlowSemanticDraft(cwd, "F1", {
		title: "Ambiguous write scope",
	});
	const semanticPath = join(dir, "flow.semantic.json");
	const semantic = JSON.parse(readFileSync(semanticPath, "utf8"));
	semantic.goals[0].writeScope = ["src/api/*/generated"];
	writeFileSync(semanticPath, `${JSON.stringify(semantic, null, 2)}\n`);

	await emit(handlers, "agent_end", { messages: [] }, ctx);

	const flow = readFlow(dir);
	assert(
		flow.status === "generating" &&
			flow.goals.length === 0 &&
			flow.repairAttempts === 1,
		"invalid writeScope did not stay in the repair path",
	);
	assert(
		state.hiddenMessages
			.at(-1)
			.includes(
				"goals[0].writeScope[0] 必须是 ** 或以 /** 结尾的相对目录 glob",
			),
		"invalid writeScope error was not sent to the real repair prompt",
	);
	assert(
		state.newSessions.length === 0,
		"invalid writeScope started an executable Flow",
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
			text: "model source",
		},
	});
	writeFlowSemantic(dir, "Semantic Wins", {
		source: {
			type: "file",
			path: "/semantic/source",
			text: "semantic source",
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
		flow.source.text === "ship semantic" &&
			flow.source.type === "prompt" &&
			!("path" in flow.source) &&
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
	const { piActivitySignal, piAttentionSignal } = await importCachedModule(
		"shared/activity-signal.js",
	);
	const attentionSources = [];
	const unsubscribeAttention = piAttentionSignal().subscribe((request) =>
		attentionSources.push(request.source),
	);
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
	const blockedActivity = latestWidgetText(state);
	assert(
		attentionSources.join("|") === "flow-draft:F1",
		`blocking input did not request user attention: ${JSON.stringify({ activity: piActivitySignal().state, attentionSources })}`,
	);
	assert(
		blockedActivity.includes("🌊 Flow · 等待补充") &&
			blockedActivity.includes("回答当前问题后继续生成") &&
			!hasGoalFlame(blockedActivity),
		"blocking input should wait without a flame",
	);
	const inputResult = await emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "拆成两个文档 Goal" },
		ctx,
	);
	assert(
		inputResult?.action === "handled" &&
			piActivitySignal().state.sources.includes("pi-flow:frame"),
		"flow clarification should resume working after visible input",
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
	unsubscribeAttention();
}

async function flowSerialStartHtmlFailureScenario() {
	const cwd = tempDir("serial-start-html-failure");
	const dir = createFlow(cwd, "F1");
	breakFlowHtml(dir);
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go F1", ctx);
	await flushScheduledGoalStart();
	const flow = readFlow(dir);
	assert(
		flow.status === "running" &&
			flow.goals[0].status === "running" &&
			state.newSessions.length === 1 &&
			state.hiddenMessages.length === 1,
		`HTML failure stopped serial prompt delivery: ${JSON.stringify({ flow, sessions: state.newSessions.length, prompts: state.hiddenMessages.length })}`,
	);
	assertReportRefreshFailure(state);
	assertNoPlanRepair(state);
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
			Number.isFinite(flow.goals[0].startedAt) &&
			flow.goals[0].completedAt === null &&
			state.newSessions.length === 1,
		"/flow go F1 did not start and stamp a draft Flow",
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
	assertNoticeFormat(
		state.notifications.at(-1),
		"⚠️",
		"运行 「/flow go F1」 继续",
	);
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
	assert(
		state.statuses.at(-1) === undefined,
		"session shutdown retained the old report UI context",
	);
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
	await waitForStatus(state, (item) =>
		String(item).startsWith("🌐 网页报告: http://127.0.0.1:"),
	);
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
			flow.source.text.includes("拆成两个阶段") &&
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
		flow.goals[0].sessionFile === null && flow.goals[0].goalId === null,
		"failed Flow goal start kept runtime identity",
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

async function flowGenerationCallbackWaitsForLockScenario() {
	const { acquireFlowLock } = await importModule("flow/lock.js");
	const cwd = tempDir("flow-generation-callback-lock");
	const sessionFile = join(cwd, "planning.jsonl");
	const dir = writePreDraftFlow(cwd, "F1", { sessionFile });
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("go F1", ctx);
	writeFlowSemanticDraft(cwd, "F1", { title: "Locked callback" });
	const lock = acquireFlowLock(dir, "generation callback barrier");
	assert(lock.ok, "generation callback barrier lock was not acquired");
	const completion = emit(handlers, "agent_end", { messages: [] }, ctx);
	const completedWhileLocked = await Promise.race([
		completion.then(() => true),
		new Promise((resolve) => setImmediate(() => resolve(false))),
	]);
	const statusWhileLocked = readFlow(dir).status;
	lock.release();
	await completion;
	assert(
		!completedWhileLocked &&
			statusWhileLocked === "generating" &&
			readFlow(dir).status === "draft",
		`generation callback bypassed Flow lock: ${JSON.stringify({ completedWhileLocked, statusWhileLocked, finalStatus: readFlow(dir).status })}`,
	);
}

async function flowGenerationStopWinsQueuedCallbackScenario() {
	const { acquireFlowLock } = await importModule("flow/lock.js");
	const { stopFlow } = await importModule("flow/execution/stop.js");
	const cwd = tempDir("flow-generation-stop-wins-queued-callback");
	const sessionFile = join(cwd, "planning.jsonl");
	const dir = writePreDraftFlow(cwd, "F1", { sessionFile });
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("go F1", ctx);
	writeFlowSemanticDraft(cwd, "F1", { title: "Late queued callback" });
	const barrier = acquireFlowLock(dir, "queue generation callback");
	assert(barrier.ok, "queued callback barrier lock was not acquired");
	const completion = emit(handlers, "agent_end", { messages: [] }, ctx);
	await new Promise((resolve) => setImmediate(resolve));
	barrier.release();
	const stopped = stopFlow(ctx, "F1");
	await Promise.all([completion, stopped]);
	const flow = readFlow(dir);
	assert(
		flow.status === "paused" && flow.goals.length === 0,
		`late generation callback overrode stop: ${JSON.stringify(flow)}`,
	);
}

async function flowGenerationPromptWaitsForLockScenario() {
	writeFlowTestConfig({
		modelRoles: { advisor: { model: "test/advisor", thinking: "off" } },
	});
	try {
		const { acquireFlowLock } = await importModule("flow/lock.js");
		const cwd = tempDir("flow-generation-prompt-lock");
		const sessionFile = join(cwd, "planning.jsonl");
		const dir = writePreDraftFlow(cwd, "F1", {
			status: "generating",
			stage: "awaiting_blocking_input",
			sessionFile,
		});
		const state = newState(cwd);
		state.allowModelSwitch = true;
		let releaseModelSwitch;
		state.modelSwitchBarrier = new Promise((resolve) => {
			releaseModelSwitch = resolve;
		});
		const modelSwitchEntered = new Promise((resolve) => {
			state.onModelSwitch = resolve;
		});
		const { commands, handlers } = await loadExtension(state);
		const ctx = commandContext(state, cwd, sessionFile);
		await commands.get("flow").handler("go F1", ctx);
		const hiddenBefore = state.hiddenMessages.length;
		const input = emitLast(
			handlers,
			"input",
			{ source: "interactive", text: "保持最小范围" },
			ctx,
		);
		await modelSwitchEntered;
		const lock = acquireFlowLock(dir, "prompt delivery barrier");
		assert(lock.ok, "prompt delivery barrier was not acquired");
		releaseModelSwitch();
		const completedWhileLocked = await Promise.race([
			input.then(() => true),
			new Promise((resolve) => setImmediate(() => resolve(false))),
		]);
		const hiddenWhileLocked = state.hiddenMessages.length;
		lock.release();
		await input;
		assert(
			!completedWhileLocked &&
				hiddenWhileLocked === hiddenBefore &&
				state.hiddenMessages.length === hiddenBefore + 1,
			`generation prompt bypassed final Flow-lock CAS: ${JSON.stringify({ completedWhileLocked, hiddenBefore, hiddenWhileLocked, hiddenAfter: state.hiddenMessages.length })}`,
		);
	} finally {
		writeFlowTestConfig();
	}
}

async function flowGenerationLockedAlignmentInputContinuesScenario() {
	const { acquireFlowLock } = await importModule("flow/lock.js");
	const cwd = tempDir("flow-generation-locked-alignment-input");
	const sessionFile = join(cwd, "planning.jsonl");
	const dir = writePreDraftFlow(cwd, "F1", {
		status: "aligning",
		stage: "awaiting_alignment_input",
		sessionFile,
		lastAlignmentQuestion: "问题 1：范围？",
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("status F1", ctx);
	const hiddenBefore = state.hiddenMessages.length;
	const lock = acquireFlowLock(dir, "alignment input barrier");
	assert(lock.ok, "alignment input barrier lock was not acquired");
	const input = emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "只改当前范围" },
		ctx,
	);
	const completedWhileLocked = await Promise.race([
		input.then(() => true),
		new Promise((resolve) => setImmediate(() => resolve(false))),
	]);
	assert(
		state.hiddenMessages.length === hiddenBefore,
		"locked alignment input sent a prompt before its state commit",
	);
	lock.release();
	const result = await input;
	const alignment = JSON.parse(
		readFileSync(join(dir, "alignment.json"), "utf8"),
	);
	const visibleAnswers = state.customMessages.filter(
		({ message }) =>
			message.display === true && message.content === "只改当前范围",
	);
	assert(
		!completedWhileLocked &&
			result?.action === "handled" &&
			alignment.alignmentTurns.at(-1)?.answer === "只改当前范围" &&
			visibleAnswers.length === 1 &&
			state.hiddenMessages.length === hiddenBefore + 1,
		`locked alignment input lost its continuation: ${JSON.stringify({ completedWhileLocked, result, alignment, visibleAnswers: visibleAnswers.length, hiddenBefore, hiddenAfter: state.hiddenMessages.length })}`,
	);
	assertLightweightAlignmentPrompt(state.hiddenMessages.at(-1));
}

async function flowGenerationLockedBlockingInputContinuesScenario() {
	const { acquireFlowLock } = await importModule("flow/lock.js");
	const cwd = tempDir("flow-generation-locked-blocking-input");
	const sessionFile = join(cwd, "planning.jsonl");
	const dir = writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "awaiting_blocking_input",
		sessionFile,
		requestText: "实现锁续投递",
	});
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("status F1", ctx);
	const hiddenBefore = state.hiddenMessages.length;
	const lock = acquireFlowLock(dir, "blocking input barrier");
	assert(lock.ok, "blocking input barrier lock was not acquired");
	const input = emitLast(
		handlers,
		"input",
		{ source: "interactive", text: "保留既有 API" },
		ctx,
	);
	const completedWhileLocked = await Promise.race([
		input.then(() => true),
		new Promise((resolve) => setImmediate(() => resolve(false))),
	]);
	assert(
		state.hiddenMessages.length === hiddenBefore,
		"locked blocking input sent a prompt before its state commit",
	);
	lock.release();
	const result = await input;
	const flow = readFlow(dir);
	const visibleAnswers = state.customMessages.filter(
		({ message }) =>
			message.display === true && message.content === "保留既有 API",
	);
	assert(
		!completedWhileLocked &&
			result?.action === "handled" &&
			flow.source.text.includes("保留既有 API") &&
			visibleAnswers.length === 1 &&
			state.hiddenMessages.length === hiddenBefore + 1 &&
			state.hiddenMessages.at(-1).includes("保留既有 API"),
		`locked blocking input lost its continuation: ${JSON.stringify({ completedWhileLocked, result, source: flow.source, visibleAnswers: visibleAnswers.length, hiddenBefore, hiddenAfter: state.hiddenMessages.length })}`,
	);
}

async function flowGenerationSameRevisionPromptDeliveryScenario() {
	const { acquireFlowLock } = await importModule("flow/lock.js");
	const generation = await importCachedModule("flow/generation.js");
	const cwd = tempDir("flow-generation-same-revision-prompt-delivery");
	const sessionFile = join(cwd, "planning.jsonl");
	const dir = writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "awaiting_blocking_input",
		sessionFile,
	});
	const alignmentPath = join(dir, "alignment.json");
	const futureAlignment = JSON.parse(readFileSync(alignmentPath, "utf8"));
	futureAlignment.updatedAt = Date.now() + 60_000;
	writeFileSync(alignmentPath, `${JSON.stringify(futureAlignment, null, 2)}\n`);
	const state = newState(cwd);
	await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	const action = generation.consumeFlowClarificationInput(
		"同 revision 只发送一次",
		ctx,
	);
	assert(
		action?.kind === "prompt",
		"same revision prompt action was not built",
	);
	const barrier = acquireFlowLock(dir, "same revision prompt barrier");
	assert(barrier.ok, "same revision prompt barrier was not acquired");
	const hiddenBefore = state.hiddenMessages.length;
	const api = state.extensionApis.at(-1);
	const first = generation.deliverFlowGenerationPrompt(
		api,
		ctx,
		action,
		"Flow 计划澄清提示发送失败",
	);
	const second = generation.deliverFlowGenerationPrompt(
		api,
		ctx,
		action,
		"Flow 计划澄清提示发送失败",
	);
	await new Promise((resolve) => setImmediate(resolve));
	barrier.release();
	await Promise.all([first, second]);
	const finalAlignment = JSON.parse(readFileSync(alignmentPath, "utf8"));
	assert(
		state.hiddenMessages.length === hiddenBefore + 1 &&
			finalAlignment.updatedAt === action.revision + 1,
		`same revision prompt had more than one winner: ${JSON.stringify({ hiddenBefore, hiddenAfter: state.hiddenMessages.length, actionRevision: action.revision, finalRevision: finalAlignment.updatedAt })}`,
	);
}

async function flowGenerationStopDuringPromptSwitchScenario() {
	writeFlowTestConfig({
		modelRoles: { advisor: { model: "test/advisor", thinking: "off" } },
	});
	try {
		const cwd = tempDir("flow-generation-stop-during-prompt-switch");
		const sessionFile = join(cwd, "planning.jsonl");
		const dir = writePreDraftFlow(cwd, "F1", {
			status: "generating",
			stage: "awaiting_blocking_input",
			sessionFile,
		});
		const state = newState(cwd);
		state.allowModelSwitch = true;
		let releaseModelSwitch;
		state.modelSwitchBarrier = new Promise((resolve) => {
			releaseModelSwitch = resolve;
		});
		const modelSwitchEntered = new Promise((resolve) => {
			state.onModelSwitch = resolve;
		});
		const { commands, handlers } = await loadExtension(state);
		const ctx = commandContext(state, cwd, sessionFile);
		await commands.get("flow").handler("go F1", ctx);
		const hiddenBefore = state.hiddenMessages.length;
		const input = emitLast(
			handlers,
			"input",
			{ source: "interactive", text: "停止前的旧回复" },
			ctx,
		);
		await modelSwitchEntered;
		await commands.get("flow").handler("stop F1", ctx);
		releaseModelSwitch();
		await input;
		const flow = readFlow(dir);
		assert(
			flow.status === "paused" &&
				flow.goals.length === 0 &&
				state.hiddenMessages.length === hiddenBefore,
			`real /flow stop lost to late generation prompt: ${JSON.stringify({ flow, hiddenBefore, hiddenAfter: state.hiddenMessages.length })}`,
		);
	} finally {
		writeFlowTestConfig();
	}
}

async function flowGenerationTakeoverDuringPromptSwitchScenario() {
	writeFlowTestConfig({
		modelRoles: { advisor: { model: "test/advisor", thinking: "off" } },
	});
	try {
		const cwd = tempDir("flow-generation-takeover-during-prompt-switch");
		const sessionA = join(cwd, "session-a.jsonl");
		const sessionB = join(cwd, "session-b.jsonl");
		const dir = writePreDraftFlow(cwd, "F1", {
			status: "generating",
			stage: "awaiting_blocking_input",
			sessionFile: sessionA,
		});
		const isolatedDist = join(out, "isolated-generation-prompt-dist");
		rmSync(isolatedDist, { recursive: true, force: true });
		cpSync(srcOut, isolatedDist, { recursive: true });
		const stateA = newState(cwd);
		const stateB = newState(cwd);
		stateA.allowModelSwitch = true;
		stateB.allowModelSwitch = true;
		let releaseModelSwitch;
		stateA.modelSwitchBarrier = new Promise((resolve) => {
			releaseModelSwitch = resolve;
		});
		const modelSwitchEntered = new Promise((resolve) => {
			stateA.onModelSwitch = resolve;
		});
		const extensionA = await loadExtension(stateA);
		const extensionB = await loadExtension(stateB, isolatedDist);
		const ctxA = commandContext(stateA, cwd, sessionA);
		const ctxB = commandContext(stateB, cwd, sessionB);
		await extensionA.commands.get("flow").handler("go F1", ctxA);
		const hiddenBefore = stateA.hiddenMessages.length;
		const input = emitLast(
			extensionA.handlers,
			"input",
			{ source: "interactive", text: "接管前的旧回复" },
			ctxA,
		);
		await modelSwitchEntered;
		await extensionB.commands.get("flow").handler("go F1", ctxB);
		releaseModelSwitch();
		await input;
		const alignment = JSON.parse(
			readFileSync(join(dir, "alignment.json"), "utf8"),
		);
		assert(
			alignment.sessionFile === sessionB &&
				stateA.hiddenMessages.length === hiddenBefore &&
				stateB.hiddenMessages.length === 1,
			`takeover lost to late generation prompt: ${JSON.stringify({ alignment, hiddenA: stateA.hiddenMessages.length, hiddenB: stateB.hiddenMessages.length })}`,
		);
	} finally {
		writeFlowTestConfig();
	}
}

async function alignmentRevisionStrictlyIncreasesScenario() {
	const { readAlignmentState, writeAlignmentState } = await importModule(
		"shared/generation-state.js",
	);
	const cwd = tempDir("flow-alignment-monotonic-revision");
	const dir = writePreDraftFlow(cwd, "F1");
	const alignment = readAlignmentState(dir);
	alignment.updatedAt = Date.now() + 60_000;
	const saved = writeAlignmentState(dir, alignment);
	assert(
		saved.updatedAt === alignment.updatedAt + 1,
		`alignment revision did not increase monotonically: ${alignment.updatedAt} -> ${saved.updatedAt}`,
	);
}

async function flowGenerationSameRevisionCallbacksScenario() {
	const { acquireFlowLock } = await importModule("flow/lock.js");
	const cwd = tempDir("flow-generation-same-revision-callbacks");
	const sessionFile = join(cwd, "planning.jsonl");
	const dir = writePreDraftFlow(cwd, "F1", {
		autoStart: false,
		sessionFile,
	});
	const isolatedDist = join(out, "isolated-generation-cas-dist");
	rmSync(isolatedDist, { recursive: true, force: true });
	cpSync(srcOut, isolatedDist, { recursive: true });
	const stateA = newState(cwd);
	const stateB = newState(cwd);
	const extensionA = await loadExtension(stateA);
	const extensionB = await loadExtension(stateB, isolatedDist);
	const ctxA = commandContext(stateA, cwd, sessionFile);
	const ctxB = commandContext(stateB, cwd, sessionFile);
	await extensionA.commands.get("flow").handler("go F1", ctxA);
	await extensionB.commands.get("flow").handler("go F1", ctxB);
	writeFlowSemanticDraft(cwd, "F1", { title: "Single CAS winner" });
	const barrier = acquireFlowLock(dir, "same revision callback barrier");
	assert(barrier.ok, "same revision callback barrier was not acquired");
	const completionA = emit(
		extensionA.handlers,
		"agent_end",
		{ messages: [] },
		ctxA,
	);
	const completionB = emit(
		extensionB.handlers,
		"agent_end",
		{ messages: [] },
		ctxB,
	);
	await new Promise((resolve) => setImmediate(resolve));
	barrier.release();
	await Promise.all([completionA, completionB]);
	const generatedNotices = [
		...stateA.notifications,
		...stateB.notifications,
	].filter((message) => message.includes("Flow 计划已生成"));
	assert(
		readFlow(dir).status === "draft" &&
			!existsSync(join(dir, "alignment.json")) &&
			generatedNotices.length === 1,
		`same revision callbacks did not have one CAS winner: ${JSON.stringify({ flow: readFlow(dir), generatedNotices })}`,
	);
}

async function flowGenerationTakeoverRejectsLateLoaderScenario() {
	const cwd = tempDir("flow-generation-takeover-late-loader");
	const sessionA = join(cwd, "session-a.jsonl");
	const sessionB = join(cwd, "session-b.jsonl");
	const dir = writePreDraftFlow(cwd, "F1", { sessionFile: sessionA });
	const isolatedDist = join(out, "isolated-generation-dist");
	rmSync(isolatedDist, { recursive: true, force: true });
	cpSync(srcOut, isolatedDist, { recursive: true });
	const stateA = newState(cwd);
	const stateB = newState(cwd);
	const extensionA = await loadExtension(stateA);
	const extensionB = await loadExtension(stateB, isolatedDist);
	const ctxA = commandContext(stateA, cwd, sessionA);
	const ctxB = commandContext(stateB, cwd, sessionB);
	await extensionA.commands.get("flow").handler("go F1", ctxA);
	await extensionB.commands.get("flow").handler("go F1", ctxB);
	const flowAfterTakeover = JSON.stringify(readFlow(dir));
	const alignmentAfterTakeover = readFileSync(
		join(dir, "alignment.json"),
		"utf8",
	);
	writeFlowSemanticDraft(cwd, "F1", { title: "Stale loader draft" });
	await emit(extensionA.handlers, "agent_end", { messages: [] }, ctxA);
	assert(
		JSON.stringify(readFlow(dir)) === flowAfterTakeover &&
			readFileSync(join(dir, "alignment.json"), "utf8") ===
				alignmentAfterTakeover,
		"old module loader changed a Flow after session takeover",
	);
}

async function flowGenerationReconcilesAlignmentFirstScenario() {
	const cwd = tempDir("flow-generation-alignment-first-reconcile");
	const previousSession = join(cwd, "previous.jsonl");
	const sessionFile = join(cwd, "planning.jsonl");
	const dir = writePreDraftFlow(cwd, "F1", {
		status: "generating",
		stage: "awaiting_alignment_input",
		sessionFile: previousSession,
		lastAlignmentQuestion: "问题 1：范围？",
	});
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, sessionFile);
	await commands.get("flow").handler("go F1", ctx);
	assert(
		readFlow(dir).status === "aligning",
		`generation recovery did not project the newer alignment stage to Flow: ${JSON.stringify({ flow: readFlow(dir), alignment: JSON.parse(readFileSync(join(dir, "alignment.json"), "utf8")), notices: state.notifications.slice(-3), hidden: state.hiddenMessages.length })}`,
	);
}

async function flowGenerationRecoversDraftWithoutMetaScenario() {
	const { buildFlowArtifact } = await importModule("flow/builder.js");
	for (const mode of [
		"valid",
		"invalid",
		"missing-semantic",
		"malformed-semantic",
	]) {
		const invalidMarkdown = mode === "invalid";
		const cwd = tempDir(`flow-generation-draft-without-meta-${mode}`);
		const sessionFile = join(cwd, "planning.jsonl");
		const dir = writePreDraftFlow(cwd, "F1", {
			autoStart: false,
			sessionFile,
			alignmentTurns: [{ question: "问题 1：范围？", answer: "保留最小范围" }],
		});
		writeFlowSemanticDraft(cwd, "F1", {
			invalidMarkdown,
			title: invalidMarkdown ? "Invalid interrupted draft" : "Recovered draft",
		});
		const semantic = JSON.parse(
			readFileSync(join(dir, "flow.semantic.json"), "utf8"),
		);
		const preDraft = readFlow(dir);
		const interrupted = buildFlowArtifact(
			dir,
			semantic,
			preDraft.language,
			preDraft.source,
		);
		assert(
			interrupted.status === "draft" &&
				interrupted.meta === null &&
				existsSync(join(dir, "alignment.json")),
			"draft/meta-null crash fixture was not created",
		);
		if (mode === "missing-semantic") rmSync(join(dir, "flow.semantic.json"));
		if (mode === "malformed-semantic")
			writeFileSync(join(dir, "flow.semantic.json"), "{");
		const state = newState(cwd);
		const { commands } = await loadExtension(state);
		const ctx = commandContext(state, cwd, sessionFile);
		await commands.get("flow").handler("go F1", ctx);
		if (mode !== "valid") {
			const recovered = readFlow(dir);
			assert(
				recovered.status === "generating" &&
					recovered.goals.length === 0 &&
					recovered.repairAttempts === 1 &&
					recovered.meta === null &&
					existsSync(join(dir, "alignment.json")) &&
					state.newSessions.length === 0 &&
					state.hiddenMessages.at(-1)?.includes("当前校验错误"),
				`invalid draft/meta-null crash did not return to repair: ${JSON.stringify({ recovered, sessions: state.newSessions.length, hidden: state.hiddenMessages.at(-1) })}`,
			);
			continue;
		}
		await flushScheduledGoalStart();
		const recovered = readFlow(dir);
		assert(
			recovered.status === "running" &&
				recovered.meta?.alignment?.turns[0]?.answer === "保留最小范围" &&
				!existsSync(join(dir, "alignment.json")) &&
				state.newSessions.length === 1,
			`valid draft/meta-null crash lost commit metadata: ${JSON.stringify({ recovered, sessions: state.newSessions.length })}`,
		);
	}
}

async function flowGenerationCleansFinalAlignmentResidueScenario() {
	const cwd = tempDir("flow-generation-final-alignment-residue");
	const dir = createFlow(cwd, "F1");
	const flow = readFlow(dir);
	writeFlow(dir, {
		...flow,
		meta: {
			plannedBy: null,
			alignment: {
				kind: "recorded",
				turns: [{ question: "问题 1：范围？", answer: "最小范围" }],
			},
		},
	});
	writeFileSync(
		join(dir, "alignment.json"),
		`${JSON.stringify(
			{
				version: 1,
				stage: "generating",
				sessionFile: join(cwd, "planning.jsonl"),
				autoStart: false,
				depth: "standard",
				alignmentTurns: [{ question: "问题 1：范围？", answer: "最小范围" }],
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
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go F1", ctx);
	await flushScheduledGoalStart();
	assert(
		!existsSync(join(dir, "alignment.json")) &&
			readFlow(dir).status === "running" &&
			state.newSessions.length === 1,
		"draft recovery did not idempotently remove residual alignment state",
	);
}

async function flowGenerationStopIgnoresLatePromptScenario() {
	const { flowGenerationResourceCounts } =
		await importCachedModule("flow/generation.js");
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
	assert(
		JSON.stringify(flowGenerationResourceCounts()) ===
			JSON.stringify({
				contexts: 0,
				promptTargets: 1,
				stalePromptTargets: 1,
				replyTargets: 0,
				resultTokens: 0,
			}),
		`generation stop retained more than one tombstone: ${JSON.stringify(flowGenerationResourceCounts())}`,
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
	assert(
		Object.values(flowGenerationResourceCounts()).every((count) => count === 0),
		`late generation tombstone was not consumed: ${JSON.stringify(flowGenerationResourceCounts())}`,
	);
}

async function flowGenerationSessionShutdownCleanupScenario() {
	const { flowGenerationResourceCounts } =
		await importCachedModule("flow/generation.js");
	const cwd = tempDir("flow-generation-session-shutdown");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("shutdown generation", ctx);
	assert(
		flowGenerationResourceCounts().contexts === 1,
		"active generation cache was not established",
	);
	await emit(handlers, "session_shutdown", {}, ctx);
	const released = flowGenerationResourceCounts();
	assert(
		released.contexts === 0 &&
			released.replyTargets === 0 &&
			released.resultTokens === 0 &&
			released.promptTargets === 1 &&
			released.stalePromptTargets === 1,
		`generation teardown kept live state: ${JSON.stringify(released)}`,
	);
	writeFlowSemanticDraft(cwd, "F1", { title: "Late Shutdown Draft" });
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		readFlow(join(cwd, ".flow", "F1")).status === "generating" &&
			Object.values(flowGenerationResourceCounts()).every(
				(count) => count === 0,
			),
		"late agent_end bypassed or retained the teardown tombstone",
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
	const { getGoalState } = await importCachedModule("goal.js");
	const { completionFact, rememberedFlowContext } =
		await importCachedModule("flow/runtime.js");
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
	assert(
		rememberedFlowContext(sessionFile) === undefined &&
			completionFact(sessionFile) === undefined,
		"stable sequential stop retained context or completion",
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
	assert(
		flow.goals[0].goalId === getGoalState(goalCtx)?.id,
		"resumed runtime Goal ID was not canonical before its prompt",
	);
	await emit(handlers, "agent_end", { messages: [] }, goalCtx);
	flow = readFlow(dir);
	assert(
		flow.currentGoal === 0 && flow.goals[0].status === "running",
		"old completion fact was consumed after stop/go resume",
	);
	assert(
		completionFact(sessionFile) === undefined,
		"rejected late completion remained cached",
	);
}

async function flowBlockedGoScenario() {
	const cwd = tempDir("flow-blocked-go");
	const runner = installFlowReviewRunner(cwd, {
		output: "FAIL\n仍需人工验证\n",
	});
	writeFlowTestConfig({
		state: true,
		background: { command: runner.command },
	});
	try {
		const dir = createFlow(cwd, "F1");
		const state = newState(cwd);
		const { commands, handlers } = await loadExtension(state);
		const planningCtx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		await commands.get("flow").handler("go F1", planningCtx);
		await flushScheduledGoalStart();
		const goalCtx = state.activeCtx;
		const sessionFile = goalCtx.sessionManager.getSessionFile();
		await emit(
			handlers,
			"agent_end",
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			goalCtx,
		);
		assert(
			readFlow(dir).goals[0].completionCursor === "acceptance_repair",
			"acceptance failure did not enter repair before BLOCKED",
		);

		await emit(
			handlers,
			"agent_end",
			{
				messages: [
					{
						role: "assistant",
						stopReason: "stop",
						content: [
							{
								type: "text",
								text: "BLOCKED: 完成真机窗口焦点验证",
							},
						],
					},
				],
			},
			goalCtx,
		);
		let flow = readFlow(dir);
		assert(
			flow.status === "paused" &&
				flow.attention?.kind === "user_action_required" &&
				flow.goals[0].completionCursor === "acceptance_repair" &&
				latestGoalState(state, sessionFile)?.status === "paused",
			`BLOCKED did not pause before go: ${JSON.stringify(flow)}`,
		);
		const promptsBeforeResume = state.hiddenMessages.length;
		await commands.get("flow").handler("go F1", goalCtx);
		flow = readFlow(dir);
		assert(
			flow.status === "running" &&
				flow.attention === null &&
				flow.goals[0].completionCursor === "acceptance_repair" &&
				latestGoalState(state, sessionFile)?.status === "active",
			`/flow go did not resume BLOCKED Flow: ${JSON.stringify(flow)}`,
		);
		assert(
			state.hiddenMessages.length === promptsBeforeResume + 1 &&
				state.hiddenMessages.at(-1) === "继续",
			`BLOCKED repair resume prompt: ${state.hiddenMessages.at(-1)}`,
		);
		assert(
			!state.hiddenMessages.at(-1).includes("<目标>") &&
				!state.hiddenMessages.at(-1).includes("第一个未完成项") &&
				!state.hiddenMessages.at(-1).includes("用户恢复此步骤后已离场"),
			`BLOCKED repair resume leaked full resume context: ${state.hiddenMessages.at(-1)}`,
		);
	} finally {
		writeFlowTestConfig();
	}
}

async function flowStopDuringRunningQualityScenario() {
	const cwd = tempDir("flow-stop-running-quality");
	const runner = installFlowReviewRunner(cwd, {
		output: "PASS\nlate pass\n证据：文件=src/app.ts；命令=npm test\n",
		wait: true,
	});
	writeFlowTestConfig({
		quality: true,
		background: { command: runner.command },
		checks: { timeoutMinutes: TEST_CHECK_TIMEOUT_MINUTES },
	});
	try {
		const dir = createFlow(cwd, "F1");
		const state = newState(cwd);
		const { commands, handlers } = await loadExtension(state);
		const planningCtx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		await commands.get("flow").handler("go F1", planningCtx);
		await flushScheduledGoalStart();
		const goalCtx = state.activeCtx;
		const sessionFile = goalCtx.sessionManager.getSessionFile();
		const completing = emit(
			handlers,
			"agent_end",
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			goalCtx,
		);
		await waitForFile(runner.startedPath);
		state.idle = false;
		await commands.get("flow").handler("stop F1", goalCtx);
		await completing;
		const flow = readFlow(dir);
		const { isReviewLoopActive } = await importCachedModule("review.js");
		assert(flow.status === "paused", "quality stop did not pause Flow");
		assert(
			latestGoalState(state, sessionFile)?.status === "paused",
			"quality stop did not pause Goal runtime",
		);
		assert(!isReviewLoopActive(), "quality stop left review loop active");
		assert(
			customEntryCount(state, sessionFile, "pi-flow-goal-completed") === 0,
			"late quality result completed stopped Flow",
		);
		assert(
			!cardTitles(state).some((title) => /质检通过|Flow .*已完成/u.test(title)),
			cardTitles(state).join(" | "),
		);
		assert(
			state.notifications.filter((item) => item.includes("Flow 已暂停"))
				.length === 1 &&
				!state.notifications.some((item) => item.includes("质检已取消")),
			state.notifications.join("\n"),
		);
	} finally {
		writeFlowTestConfig();
	}
}

async function flowStopWhileQualityAwaitsRepairScenario() {
	const cwd = tempDir("flow-stop-awaiting-quality-repair");
	const runner = installFlowReviewRunner(cwd, {
		output: "FAIL\n质量不达标\n",
	});
	writeFlowTestConfig({
		quality: true,
		background: { command: runner.command },
		checks: { timeoutMinutes: TEST_CHECK_TIMEOUT_MINUTES },
	});
	try {
		const dir = createFlow(cwd, "F1");
		const state = newState(cwd);
		const { commands, handlers } = await loadExtension(state);
		const planningCtx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
		await commands.get("flow").handler("go F1", planningCtx);
		await flushScheduledGoalStart();
		const goalCtx = state.activeCtx;
		const sessionFile = goalCtx.sessionManager.getSessionFile();
		await emit(
			handlers,
			"agent_end",
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			goalCtx,
		);
		const { isReviewLoopActive } = await importCachedModule("review.js");
		assert(isReviewLoopActive(), "quality loop did not await repair");
		state.idle = false;
		await commands.get("flow").handler("stop F1", planningCtx);
		assert(!isReviewLoopActive(), "awaiting quality loop survived /flow stop");
		assert(
			latestGoalState(state, sessionFile)?.status === "paused",
			"cross-session stop did not pause Goal runtime",
		);
		assert(state.aborts === 1, "cross-session stop did not abort repair turn");
		assert(
			state.notifications.filter((item) => item.includes("Flow 已暂停"))
				.length === 1 &&
				!state.notifications.some((item) => item.includes("质检已取消")),
			state.notifications.join("\n"),
		);

		state.idle = true;
		await commands.get("flow").handler("go F1", planningCtx);
		const resumedCtx = state.activeCtx;
		await emit(
			handlers,
			"agent_end",
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			resumedCtx,
		);
		const resumed = readFlow(dir);
		assert(resumed.status === "running", "resumed Flow was paused by old loop");
		assert(
			latestGoalState(state, sessionFile)?.status === "active",
			"resumed Goal was paused by old loop",
		);
		assert(
			resumed.goals[0].checks.quality.rounds.length === 2,
			`first resumed agent_end was consumed by old loop: ${JSON.stringify(resumed.goals[0].checks.quality)}`,
		);
		await commands.get("flow").handler("stop F1", planningCtx);
	} finally {
		writeFlowTestConfig();
	}
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
	writeFlow(dir, flow);
	const ctx = commandContext(state, cwd, sessionFile);
	await emit(handlers, "session_start", {}, ctx);
	entriesFor(state, sessionFile).push(completionEntry(sessionFile));
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	assert(
		state.newSessions.length === 0,
		"completion auto-advance replaced the session before agent_end dispatch completed",
	);
	await flushScheduledGoalStart();
	assert(
		!state.notifications.some((message) => message.includes("已完成")),
		state.notifications.join("\n"),
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
			(item) => item.message.details?.title === "Flow 第 2 步 · Goal 2 已就绪",
		),
		"continue-required card shown despite event command context",
	);
}

async function completionWithoutRememberedContextScenario() {
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
	writeFlow(dir, flow);
	const ctx = commandContext(state, cwd, sessionFile);
	ctx.newSession = undefined;
	await emit(handlers, "session_start", {}, ctx);
	const { piAttentionSignal } = await importCachedModule(
		"shared/activity-signal.js",
	);
	const attentionSources = [];
	const unsubscribeAttention = piAttentionSignal().subscribe((request) =>
		attentionSources.push(request.source),
	);
	entriesFor(state, sessionFile).push(completionEntry(sessionFile));
	await emit(handlers, "agent_end", { messages: [] }, ctx);
	unsubscribeAttention();
	assert(
		attentionSources.join("|") === "pi-flow:flow:F1",
		`continue-required attention mismatch: ${attentionSources.join(" | ")}`,
	);
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
		!state.notifications.some((item) => item.includes("Flow 已更新")),
		state.notifications.join("\n"),
	);
	const continueCard = state.customMessages.find(
		(item) => item.message.details?.title === "Flow 第 2 步 · Goal 2 已就绪",
	);
	assert(
		continueCard?.message.content.includes("/flow go F1"),
		"missing continue-required card with bare id",
	);
}

async function stuckRefactorBContinueScenario() {
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
		!state.notifications.some((message) => message.includes("已完成")),
		state.notifications.join("\n"),
	);
}

async function completionEventUsesRememberedCommandContextScenario() {
	const { rememberedFlowContext } = await importCachedModule("flow/runtime.js");
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
	assert(
		rememberedFlowContext(sessionFile) === undefined &&
			rememberedFlowContext(saved.goals[1].sessionFile) === state.activeCtx,
		"completion retained the old context or released the next context",
	);
}

async function completionEmitUsesEmittedContextScenario() {
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

async function completionLockConflictRetainsFactScenario() {
	const { handleGoalCompletionEnd } = await importCachedModule(
		"flow/execution/advance.js",
	);
	const { withFlowLock } = await importCachedModule("flow/lock.js");
	const {
		completionFact,
		rememberCompletionFact,
		rememberFlowContext,
		rememberedFlowContext,
	} = await importCachedModule("flow/runtime.js");
	const cwd = tempDir("completion-lock-retains-fact");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	await loadExtension(state);
	const pi = state.extensionApis.at(-1);
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
				sessionFile,
				snapshot,
			},
		],
	});
	const ctx = commandContext(state, cwd, sessionFile);
	const fact = completionEntry(sessionFile).data;
	rememberFlowContext(ctx);
	rememberCompletionFact(fact);
	let releaseLock;
	const held = withFlowLock(
		dir,
		"hold completion",
		() =>
			new Promise((resolve) => {
				releaseLock = resolve;
			}),
	);
	await Promise.resolve();
	await handleGoalCompletionEnd(pi, ctx, fact);
	assert(
		completionFact(sessionFile) === fact &&
			rememberedFlowContext(sessionFile) === ctx &&
			readFlow(dir).status === "running",
		"lock conflict consumed completion or context",
	);
	releaseLock();
	await held;
	await handleGoalCompletionEnd(pi, ctx);
	assert(
		readFlow(dir).status === "complete" &&
			completionFact(sessionFile) === undefined &&
			rememberedFlowContext(sessionFile) === undefined,
		"retried completion did not commit and release",
	);
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
			"Flow Goal 1 started",
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
		await flushScheduledGoalStart();
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
		const readyFlow = readFlow(readyDir);
		readyFlow.status = "running";
		readyFlow.startedAt = Date.now();
		readyFlow.goals[0].status = "running";
		readyFlow.goals[0].sessionFile = sessionFile;
		readyFlow.goals[0].snapshot = readFileSync(
			join(readyDir, readyFlow.goals[0].file),
			"utf8",
		);
		writeFlow(readyDir, readyFlow);
		const readyCtx = commandContext(readyState, readyCwd, sessionFile);
		readyCtx.newSession = undefined;
		await emit(readyHandlers, "session_start", {}, readyCtx);
		entriesFor(readyState, sessionFile).push(completionEntry(sessionFile));
		await emit(readyHandlers, "agent_end", { messages: [] }, readyCtx);
		await flushScheduledGoalStart();
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
			"Flow Goal 1 已启动",
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
	const startCard = state.customMessages.find(
		(item) => item.message.details?.title === "Flow Goal 1 已启动",
	);
	assert(startCard, "Flow Goal start card missing");
	assert(
		startCard.message.details.lines.includes("编号：F1") &&
			!startCard.message.details.lines.join("\n").includes("进度：1/1") &&
			!startCard.message.details.lines.join("\n").includes("后续：无"),
		startCard.message.details.lines.join(" | "),
	);
	assert(
		state.sessionNames.at(-1).startsWith("F1"),
		"replacement session was not named",
	);
}

async function flowResumeMissingSessionScenario() {
	const cwd = tempDir("flow-resume-missing-session");
	const dir = createFlow(cwd, "F1");
	const flow = readFlow(dir);
	const snapshot = readFileSync(join(dir, flow.goals[0].file), "utf8");
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	flow.goals[0].sessionFile = join(cwd, "missing-goal-session.jsonl");
	flow.goals[0].snapshot = snapshot;
	writeFlow(dir, flow);
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go F1", ctx);
	await flushScheduledGoalStart();
	const resumed = readFlow(dir);
	assert(
		state.newSessions.length === 1 &&
			resumed.goals[0].status === "running" &&
			resumed.goals[0].sessionFile !== flow.goals[0].sessionFile &&
			existsSync(resumed.goals[0].sessionFile),
		"running Flow with a missing session was not restarted",
	);
}

async function flowStartedGoalMissingSessionStopsScenario() {
	const cwd = tempDir("flow-started-goal-missing-session");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	let goalIdAtPrompt;
	state.onHiddenMessage = (message) => {
		if (message.customType === "pi-flow-goal-prompt")
			goalIdAtPrompt = readFlow(dir).goals[0].goalId;
	};
	const { commands } = await loadExtension(state);
	const planningSession = join(cwd, "planning.jsonl");
	await commands
		.get("flow")
		.handler("go F1", commandContext(state, cwd, planningSession));
	await flushScheduledGoalStart();
	const started = readFlow(dir);
	assert(
		typeof goalIdAtPrompt === "string" &&
			goalIdAtPrompt === started.goals[0].goalId,
		"runtime Goal ID was not canonical before the execution prompt",
	);
	const startedGoal = JSON.stringify(started.goals[0]);
	const startedSession = started.goals[0].sessionFile;
	assert(startedSession, "started Goal session was not recorded");
	rmSync(startedSession, { force: true });
	const sessionCount = state.newSessions.length;
	const promptCount = state.hiddenMessages.length;
	state.onHiddenMessage = undefined;
	await commands
		.get("flow")
		.handler("go F1", commandContext(state, cwd, planningSession));
	const stopped = readFlow(dir);
	assert(
		stopped.status === "paused" &&
			stopped.attention?.kind === "interrupted" &&
			JSON.stringify(stopped.goals[0]) === startedGoal &&
			state.newSessions.length === sessionCount &&
			state.hiddenMessages.length === promptCount,
		"started Goal with a lost session was restarted",
	);
}

async function flowResumeMissingSessionEvidenceScenario() {
	const fixtures = [
		{
			name: "goal-id",
			mutate(goal) {
				goal.goalId = "existing-goal";
			},
		},
		{
			name: "active-check",
			mutate(goal) {
				goal.completionCursor = "acceptance_retry";
				goal.checks.acceptance.active = activeCheck("reviewer");
			},
		},
	];
	for (const fixture of fixtures) {
		const cwd = tempDir(`flow-resume-missing-session-${fixture.name}`);
		const dir = createFlow(cwd, "F1");
		const sessionFile = join(cwd, "missing-goal-session.jsonl");
		const flow = await runningGoalFlow(dir, sessionFile);
		fixture.mutate(flow.goals[0]);
		writeFlow(dir, flow);
		await assertLostGoalResumeStops(cwd, dir, false, fixture.name);
	}
}

async function flowResumeMissingRuntimeGoalScenario() {
	const fixtures = [
		{ name: "running", mutate() {} },
		{
			name: "result",
			mutate(goal) {
				goal.result.summary = "execution changed the workspace";
			},
		},
		{
			name: "check-round",
			mutate(goal) {
				goal.checks.acceptance.rounds = [
					{ round: 1, result: "failed", summary: "acceptance failed" },
				];
			},
		},
		{
			name: "cursor",
			mutate(goal) {
				goal.completionCursor = "quality_repair";
			},
		},
	];
	for (const fixture of fixtures) {
		const cwd = tempDir(`flow-resume-missing-runtime-${fixture.name}`);
		const dir = createFlow(cwd, "F1");
		const sessionFile = join(cwd, "goal-session.jsonl");
		writeFileSync(sessionFile, "");
		const flow = await runningGoalFlow(dir, sessionFile);
		fixture.mutate(flow.goals[0]);
		writeFlow(dir, flow);
		await assertLostGoalResumeStops(cwd, dir, true, fixture.name);
	}
}

async function runningGoalFlow(dir, sessionFile) {
	const flow = readFlow(dir);
	const snapshot = readFileSync(join(dir, flow.goals[0].file), "utf8");
	const startedAt = Date.now();
	flow.status = "running";
	flow.startedAt = startedAt;
	flow.goals[0] = {
		...flow.goals[0],
		status: "running",
		startedAt,
		sessionFile,
		snapshot,
	};
	return flow;
}

async function assertLostGoalResumeStops(cwd, dir, sessionExists, label) {
	const before = readFlow(dir);
	const expectedGoal = JSON.stringify(before.goals[0]);
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go F1", ctx);
	const stopped = readFlow(dir);
	assert(
		state.newSessions.length === 0,
		`${label}: lost Goal opened a new session`,
	);
	assert(
		state.hiddenMessages.length === 0,
		`${label}: lost Goal sent a hidden execution prompt`,
	);
	assert(
		state.switches.length === (sessionExists ? 1 : 0),
		`${label}: unexpected session switch count ${state.switches.length}`,
	);
	assert(
		stopped.status === "paused" &&
			stopped.attention?.kind === "interrupted" &&
			JSON.stringify(stopped.goals[0]) === expectedGoal,
		`${label}: lost Goal did not pause atomically with evidence intact`,
	);
	const notice = state.notifications.at(-1) ?? "";
	assert(
		notice.includes("恢复原会话记录") &&
			notice.includes("/flow go F1") &&
			notice.includes("新 Flow"),
		`${label}: recovery notice lacks explicit next actions: ${notice}`,
	);
	const originalNow = Date.now;
	Date.now = () => stopped.updatedAt + 10_000;
	try {
		await commands.get("flow").handler("go F1", ctx);
	} finally {
		Date.now = originalNow;
	}
	const repeated = readFlow(dir);
	assert(
		repeated.status === "paused" &&
			repeated.updatedAt === stopped.updatedAt &&
			repeated.attention?.at === stopped.attention.at &&
			JSON.stringify(repeated.goals[0]) === expectedGoal,
		`${label}: repeated go rewrote the interruption fact`,
	);
	assert(
		state.newSessions.length === 0 && state.hiddenMessages.length === 0,
		`${label}: repeated go restarted lost work`,
	);
}

async function flowResumePendingRuntimeGoalHiddenPromptScenario() {
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
		state.newSessions.length === 0 && state.switches.length === 1,
		"pending Goal did not start in its existing session",
	);
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
			(item) => item.message.details?.title === "Flow Goal 1 已启动",
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
	assert(flow.goals[0].snapshot, "snapshot missing");
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
	const secondDir = createFlow(cwd, "F2");
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
	const secondFlow = readFlow(secondDir);
	secondFlow.status = "running";
	secondFlow.startedAt = Date.now();
	secondFlow.goals[0] = {
		...secondFlow.goals[0],
		status: "running",
		sessionFile,
		sessionName: "old",
	};
	writeFlow(secondDir, secondFlow);
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
	const syncFailuresBefore = state.notifications.filter((item) =>
		item.includes("会话名同步失败"),
	).length;
	breakFlowHtml(dir);
	await emit(handlers, "session_info_changed", { name: "Renamed" }, ctx);
	flow = readFlow(dir);
	assert(
		flow.goals[0].sessionName === "Renamed" &&
			readFlow(secondDir).goals[0].sessionName === "Renamed",
		"HTML failure stopped current or subsequent Flow sessionName sync",
	);
	assertReportRefreshFailure(state);
	assert(
		state.notifications.filter((item) => item.includes("会话名同步失败"))
			.length === syncFailuresBefore,
		`HTML failure was misreported as session name sync failure: ${state.notifications.join(" | ")}`,
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
	// 修订合法性由检查仲裁裁决：中途修改受保护区不再断流。
	writeFileSync(
		planFile,
		readFileSync(planFile, "utf8").replace(
			"Only this Goal.",
			"Changed protected scope.",
		),
	);
	await commands.get("flow").handler("go", ctx);
	assert(
		state.switches.at(-1) === flow.goals[0].sessionFile,
		"mid-run plan revision blocked /flow go",
	);
	flow = readFlow(dir);
	assert(flow.errors.length === 0, "plan revision wrote a flow error");
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		planCtx,
	);
	await flushScheduledGoalStart();
	flow = readFlow(dir);
	assert(flow.currentGoal === 1, "flow did not advance after plan revision");
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
		"flow did not complete after plan revision",
	);
}

async function snapshotRecoveryPrecheckScenario() {
	const { planSnapshotError } = await importModule("flow/snapshot.js");
	const cwd = tempDir("snapshot-precheck");
	const dir = createFlow(cwd, "F1");
	const flow = readFlow(dir);
	const goal = flow.goals[0];
	const planFile = join(dir, goal.file);
	goal.snapshot = readFileSync(planFile, "utf8");
	// 内容变更不再致错：修订交给检查仲裁。
	writeFileSync(planFile, `${goal.snapshot}\nrevised\n`);
	assert(
		planSnapshotError(dir, goal, "zh") === undefined,
		"plan content change treated as unrecoverable",
	);
	assert(
		(planSnapshotError(dir, { ...goal, snapshot: null }, "zh") ?? "").includes(
			"缺少计划快照",
		),
		"missing snapshot not reported",
	);
	rmSync(planFile);
	assert(
		(planSnapshotError(dir, goal, "zh") ?? "").includes("步骤文件不存在"),
		"missing step file not reported",
	);
}

async function planFileWatcherSharingScenario() {
	const { createPlanFileWatcher } = await importModule(
		"shared/plan-file-watcher.js",
	);
	const dir = tempDir("plan-file-watcher-sharing");
	const firstPath = join(dir, "first.md");
	const secondPath = join(dir, "second.json");
	const watchHarness = installDirectoryWatchHarness(dir);
	const watcher = createPlanFileWatcher();
	let firstSignals = 0;
	let replacementSignals = 0;
	let secondSignals = 0;
	try {
		watcher.watchFile(firstPath, () => {
			firstSignals += 1;
		});
		watcher.watchFile(
			firstPath,
			() => {
				replacementSignals += 1;
			},
			{ skipIfSame: true },
		);
		watcher.watchFile(
			secondPath,
			() => {
				secondSignals += 1;
			},
			{ keepExisting: true },
		);
		assert(
			watcher.stats().osWatchers === 1 &&
				watcher.stats().watchedFiles === 2 &&
				watchHarness.watchCalls() === 1,
			`same-directory files did not share one watcher: ${JSON.stringify(watcher.stats())}`,
		);
		for (let iteration = 0; iteration < 100; iteration += 1) {
			watchHarness.emit("first.md");
			watchHarness.emit("second.json");
		}
		watchHarness.emit("unrelated.tmp");
		assert(
			firstSignals === 100 && secondSignals === 100 && replacementSignals === 0,
			"basename dispatch notified the wrong callback",
		);
		watchHarness.emit(null);
		assert(
			firstSignals === 101 && secondSignals === 101 && replacementSignals === 0,
			"shared watcher did not dispatch deterministic null events",
		);
		watcher.closeFile(firstPath);
		watcher.closeFile(firstPath);
		watchHarness.emit("first.md");
		assert(
			firstSignals === 101 &&
				watcher.stats().osWatchers === 1 &&
				watcher.stats().watchedFiles === 1,
			"closeFile retained a callback or closed the shared watcher too early",
		);
		watcher.closeFile(secondPath);
		watcher.closeFile(secondPath);
		watcher.close();
		assert(
			watcher.stats().osWatchers === 0 &&
				watcher.stats().watchedFiles === 0 &&
				watchHarness.closeCalls() === 1,
			"shared watcher close was not idempotent",
		);
	} finally {
		watcher.close();
		watchHarness.restore();
	}
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
	watchCurrentFlowGoal(dir, flow);
	await new Promise((resolve) => setImmediate(resolve));
	const goalFile = join(dir, flow.goals[0].file);
	const checkedGoal = readFileSync(goalFile, "utf8").replace(
		"- [x] Do work.",
		"- [x] Do work checked.",
	);
	await changeSourceUntilHtmlMatches(
		htmlPath,
		() => writeFileSync(goalFile, checkedGoal),
		(content) => content.includes("Do work checked."),
	);
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

	await new Promise((resolve) => setTimeout(resolve, 20));
	const goalFile = join(dir, flow.goals[1].file);
	const checkedGoal = readFileSync(goalFile, "utf8").replace(
		"- [x] Do work.",
		"- [x] Main goal watcher checked.",
	);
	await changeSourceUntilHtmlMatches(
		htmlPath,
		() => writeFileSync(goalFile, checkedGoal),
		(content) => content.includes("Main goal watcher checked."),
	);
	const html = readFileSync(htmlPath, "utf8");
	assert(
		html.includes("Main goal watcher checked.") &&
			!html.includes("当前</span>") &&
			!html.includes(" · 当前"),
		"parallel watcher did not render three-goal main markdown changes",
	);
	closeFlowGoalWatcher();
}

async function flowParallelWatcherScenario() {
	const { writeFlowHtml } = await importModule("flow/html.js");
	const { closeFlowGoalWatcher, flowGoalWatcherStats, watchParallelBatch } =
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
	writeFileSync(
		join(dir, "G2-plan.md"),
		planMarkdown(2, false).replace("Do work.", "Worker live old."),
	);
	writeWorkerGoalArtifact(dir, flow, 1, emptyChecks());
	writeFlowHtml(dir, flow);
	const htmlPath = join(dir, "flow.html");
	watchParallelBatch(dir, flow, [1, 2, 3]);
	assert(
		flowGoalWatcherStats(dir)?.osWatchers === 1 &&
			flowGoalWatcherStats(dir)?.watchedFiles === 9,
		`parallel Flow did not share one directory watcher: ${JSON.stringify(flowGoalWatcherStats(dir))}`,
	);
	await waitForCondition(
		() => readFileSync(htmlPath, "utf8").includes("Worker live old."),
		"parallel watcher did not perform its initial refresh",
	);

	const planPath = join(dir, "G2-plan.md");
	const uncheckedPlan = planMarkdown(2, false).replace(
		"- [x] Do work.",
		"- [ ] Worker live new.",
	);
	await changeSourceUntilHtmlMatches(
		htmlPath,
		() => writeFileSync(planPath, uncheckedPlan),
		(content) => content.includes("Worker live new."),
	);
	assert(
		readFileSync(htmlPath, "utf8").includes("Worker live new."),
		"parallel watcher did not render worker plan.md changes",
	);

	const checkedPlan = planMarkdown(2, false).replace(
		"- [x] Do work.",
		"- [x] Worker live new.",
	);
	await changeSourceUntilHtmlMatches(htmlPath, () =>
		writeFileSync(planPath, checkedPlan),
	);
	const attributionAt = new Date(2026, 0, 2, 3, 4, 5).getTime();
	const attributedArtifact = workerGoalArtifact(flow, 1, emptyChecks());
	attributedArtifact.checkAttribution = {
		"Steps\u0000Worker live new.\u00001": {
			model: "test/worker-model",
			thinking: "high",
			at: attributionAt,
		},
	};
	const artifactPath = join(dir, "G2-worker.json");
	const attributedArtifactText = `${JSON.stringify(attributedArtifact, null, 2)}\n`;
	await changeSourceUntilHtmlMatches(
		htmlPath,
		() => writeFileSync(artifactPath, attributedArtifactText),
		(content) =>
			content.includes("worker-model") && content.includes("01-02 03:04:05"),
	);
	const attributedHtml = readFileSync(htmlPath, "utf8");
	assert(
		attributedHtml.includes("worker-model") &&
			attributedHtml.includes("01-02 03:04:05"),
		"parallel watcher did not render worker checkbox attribution",
	);

	const passed = emptyChecks();
	passed.acceptance.rounds = [
		{ round: 1, result: "passed", summary: "worker acceptance passed" },
	];
	await changeSourceUntilHtmlMatches(
		htmlPath,
		() => writeWorkerGoalArtifact(dir, flow, 1, passed),
		(content) => content.includes("worker acceptance passed"),
	);
	assert(
		readFileSync(htmlPath, "utf8").includes("worker acceptance passed"),
		"parallel watcher did not render worker artifact changes",
	);
	rmSync(artifactPath);
	await waitForCondition(
		() => !readFileSync(htmlPath, "utf8").includes("worker acceptance passed"),
		"parallel watcher did not refresh after worker artifact deletion",
	);
	closeFlowGoalWatcher();
	assert(
		flowGoalWatcherStats(dir) === undefined,
		"closed parallel watcher retained its Flow entry",
	);
}

async function flowWatcherEventStormScenario() {
	const { writeFlowHtml } = await importModule("flow/html.js");
	const {
		closeFlowGoalWatcher,
		flowGoalWatcherCount,
		flowGoalWatcherStats,
		watchCurrentFlowGoal,
		watchParallelBatch,
	} = await importModule("flow/watcher.js");
	const cwd = tempDir("flow-watcher-storm");
	const dir = createFlow(cwd, "F1");
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.goals[0].status = "running";
	writeFlow(dir, flow);
	writeFlowHtml(dir, flow);
	watchCurrentFlowGoal(dir, flow);
	await new Promise((resolve) => setImmediate(resolve));
	const goalPath = join(dir, flow.goals[0].file);
	const base = readFileSync(goalPath, "utf8");
	for (let index = 0; index < 100; index += 1) {
		atomicReplace(
			goalPath,
			base.replace("Do work.", `Burst canonical ${index}.`),
		);
	}
	await waitForCondition(
		() =>
			readFileSync(join(dir, "flow.html"), "utf8").includes(
				"Burst canonical 99.",
			),
		"serial report did not converge to the burst tail",
	);
	assert(
		(flowGoalWatcherStats(dir)?.refreshes ?? 0) <= 2,
		"100 serial updates caused more than two full report refreshes",
	);

	const sustainedStart = flowGoalWatcherStats(dir)?.refreshes ?? 0;
	const sustainedSignalStart = flowGoalWatcherStats(dir)?.signals ?? 0;
	const sustainedStartedAt = performance.now();
	for (let index = 0; index < 20; index += 1) {
		atomicReplace(
			goalPath,
			base.replace("Do work.", `Sustained canonical ${index}.`),
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	const sustainedElapsedMs = performance.now() - sustainedStartedAt;
	await waitForReportFrames(2);
	const sustainedRefreshes =
		(flowGoalWatcherStats(dir)?.refreshes ?? 0) - sustainedStart;
	assert(
		(flowGoalWatcherStats(dir)?.signals ?? 0) > sustainedSignalStart &&
			sustainedRefreshes <= Math.ceil(sustainedElapsedMs / 25) + 1 &&
			readFileSync(join(dir, "flow.html"), "utf8").includes(
				"Sustained canonical 19.",
			),
		"sustained report signals exceeded one refresh per frame or lost the tail",
	);

	const otherDir = createFlow(cwd, "F2");
	const otherFlow = readFlow(otherDir);
	otherFlow.status = "running";
	otherFlow.startedAt = Date.now();
	otherFlow.goals[0].status = "running";
	writeFlow(otherDir, otherFlow);
	writeFlowHtml(otherDir, otherFlow);
	watchCurrentFlowGoal(otherDir, otherFlow);
	await new Promise((resolve) => setImmediate(resolve));
	assert(
		flowGoalWatcherCount() === 2 &&
			flowGoalWatcherStats(dir)?.osWatchers === 1 &&
			flowGoalWatcherStats(otherDir)?.osWatchers === 1,
		"independent Flows did not retain one isolated watcher each",
	);
	atomicReplace(
		join(otherDir, otherFlow.goals[0].file),
		readFileSync(join(otherDir, otherFlow.goals[0].file), "utf8").replace(
			"Do work.",
			"Independent Flow updated.",
		),
	);
	atomicReplace(goalPath, base.replace("Do work.", "Must not render late."));
	// 这里验证 close 取消 pending frame，不重复赌事件风暴后的单次 OS 事件；
	// 同目标重注册按运行契约同步安排首帧，前半段已覆盖真实 burst/tail 收敛。
	watchCurrentFlowGoal(dir, flow);
	assert(
		flowGoalWatcherStats(dir)?.pending === true,
		"first Flow refresh was not scheduled",
	);
	closeFlowGoalWatcher(dir);
	flow.status = "paused";
	flow.goals[0].status = "paused";
	writeFlow(dir, flow);
	writeFlowHtml(dir, flow);
	const terminalHtml = readFileSync(join(dir, "flow.html"), "utf8");
	await waitForCondition(
		() =>
			readFileSync(join(otherDir, "flow.html"), "utf8").includes(
				"Independent Flow updated.",
			),
		"closing one Flow suppressed another Flow refresh",
	);
	await waitForReportFrames(2);
	assert(
		readFileSync(join(dir, "flow.html"), "utf8") === terminalHtml,
		"closed watcher overwrote the terminal report",
	);

	const parallelDir = createThreeParallelFlow(cwd, "F3");
	const parallelFlow = readFlow(parallelDir);
	parallelFlow.status = "running";
	parallelFlow.startedAt = Date.now();
	parallelFlow.currentGoal = 1;
	parallelFlow.parallelRun = parallelRun([1, 2, 3]);
	for (const goalIndex of [1, 2, 3])
		parallelFlow.goals[goalIndex].status = "running";
	writeFlow(parallelDir, parallelFlow);
	const staleChecks = emptyChecks();
	staleChecks.acceptance.rounds = [
		{ round: 1, result: "failed", summary: "stale worker generation" },
	];
	const staleArtifact = workerGoalArtifact(parallelFlow, 1, staleChecks);
	staleArtifact.parallelRunId = "old-run";
	writeFileSync(
		join(parallelDir, "G2-worker.json"),
		`${JSON.stringify(staleArtifact, null, 2)}\n`,
	);
	writeFlowHtml(parallelDir, parallelFlow);
	watchParallelBatch(parallelDir, parallelFlow, [1, 2, 3]);
	await waitForCondition(() => {
		const stats = flowGoalWatcherStats(parallelDir);
		return Boolean(stats && stats.refreshes > 0 && !stats.pending);
	}, "parallel watcher did not finish registration refresh");
	const initialParallelSignals =
		flowGoalWatcherStats(parallelDir)?.signals ?? 0;
	const staleArtifactPath = join(parallelDir, "G2-worker.json");
	atomicReplace(
		staleArtifactPath,
		`${JSON.stringify(staleArtifact, null, 2)}\n`,
	);
	await waitForCondition(
		() =>
			(flowGoalWatcherStats(parallelDir)?.signals ?? 0) >
			initialParallelSignals,
		"parallel atomic replacement did not emit a real file event",
	);
	assert(
		!readFileSync(join(parallelDir, "flow.html"), "utf8").includes(
			"stale worker generation",
		),
		"parallel report consumed an artifact from an old run",
	);
	const parallelPlanPath = join(parallelDir, parallelFlow.goals[1].file);
	const parallelPlan = readFileSync(parallelPlanPath, "utf8");
	for (let index = 0; index < 5; index += 1) {
		const checks = emptyChecks();
		checks.acceptance.rounds = [
			{ round: 1, result: "failed", summary: `Atomic worker ${index}` },
		];
		atomicReplace(
			staleArtifactPath,
			`${JSON.stringify(workerGoalArtifact(parallelFlow, 1, checks), null, 2)}\n`,
		);
		atomicReplace(
			parallelPlanPath,
			parallelPlan.replace("Do work.", `Atomic parallel plan ${index}.`),
		);
		atomicReplace(
			join(parallelDir, "G2-worker-events.json"),
			`${JSON.stringify([{ index }])}\n`,
		);
	}
	await waitForCondition(() => {
		const html = readFileSync(join(parallelDir, "flow.html"), "utf8");
		return (
			html.includes("Atomic worker 4") &&
			html.includes("Atomic parallel plan 4.")
		);
	}, "parallel atomic replacements did not converge to the latest artifact and plan");
	atomicReplace(
		join(parallelDir, "G2-worker-events.json"),
		`${JSON.stringify([{ index: "run-id-race" }])}\n`,
	);
	await waitForCondition(
		() => flowGoalWatcherStats(parallelDir)?.pending === true,
		"parallel run-id race did not schedule a frame",
	);
	parallelFlow.parallelRun = {
		...parallelFlow.parallelRun,
		id: "replacement-run",
	};
	writeFlow(parallelDir, parallelFlow);
	writeFlowHtml(parallelDir, parallelFlow);
	const replacementHtml = readFileSync(join(parallelDir, "flow.html"), "utf8");
	await waitForReportFrames(2);
	assert(
		readFileSync(join(parallelDir, "flow.html"), "utf8") === replacementHtml,
		"old parallel run frame overwrote its replacement",
	);
	closeFlowGoalWatcher();
	assert(
		flowGoalWatcherCount() === 0,
		"closing report watchers retained Flow entries",
	);
}

function waitForReportFrames(count) {
	return new Promise((resolve) => setTimeout(resolve, count * 25 + 10));
}

function atomicReplace(path, content) {
	const temporaryPath = `${path}.flow-smoke.tmp`;
	writeFileSync(temporaryPath, content);
	renameSync(temporaryPath, path);
}

function changeSourceUntilHtmlMatches(path, changeSource, matches) {
	const before = readFileSync(path, "utf8");
	const accepts = matches ?? ((content) => content !== before);
	return new Promise((resolve, reject) => {
		let retry;
		const target = basename(path);
		const finish = () => {
			clearTimeout(timeout);
			clearTimeout(retry);
			watcher.close();
			resolve();
		};
		const check = () => {
			if (!existsSync(path)) return false;
			const content = readFileSync(path, "utf8");
			if (!accepts(content)) return false;
			finish();
			return true;
		};
		const replay = () => {
			if (check()) return;
			changeSource();
			retry = setTimeout(replay, 500);
		};
		const timeout = setTimeout(() => {
			clearTimeout(retry);
			watcher.close();
			const current = existsSync(path) ? readFileSync(path, "utf8") : "";
			reject(
				new Error(
					`file did not converge: ${path}; contentChanged=${current !== before}; beforeLength=${before.length}; currentLength=${current.length}`,
				),
			);
		}, 10_000);
		const watcher = watch(dirname(path), (_event, filename) => {
			if (filename !== null && String(filename) !== target) return;
			check();
		});
		replay();
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
			30_000,
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
	await handler({ messages: [{ role: "assistant", stopReason: "stop"${options.blockedReason ? `, content: [{ type: "text", text: ${JSON.stringify(`BLOCKED: ${options.blockedReason}`)} }]` : ""} }] }, ctx);
}
record("private-worker-agent-end", "done");`;
	writeFileSync(
		script,
		`import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nconst srcOut = process.env.FLOW_SMOKE_SRC_OUT;\nconst cwd = process.env.FLOW_SMOKE_CWD;\nconst sessionFile = process.env.FLOW_SMOKE_SESSION;\nif (!srcOut || !cwd || !sessionFile) throw new Error("missing child env");\nconst { default: flowExtension } = await import("file://" + join(srcOut, "index.js"));\nconst handlers = new Map();\nconst entries = [];\nconst record = (name, value = "") => writeFileSync(join(cwd, name), String(value));\nflowExtension({\n\tregisterCommand() {},\n\tregisterShortcut() {},\n\tregisterTool() {},\n\tregisterMessageRenderer() {},\n\tregisterFlag() {},\n\tgetFlag() {},\n\tgetThinkingLevel() { return "off"; },\n\tgetActiveTools() { return []; },\n\tsetActiveTools() {},\n\tgetAllTools() { return []; },\n\tgetCommands() { return []; },\n\tappendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },\n\tsendUserMessage() {},\n\tsendMessage(message) {\n${options.failGoalPromptSend ? '\t\tif (message.customType === "pi-flow-goal-prompt" && String(message.content).includes("pi-goal-continuation")) throw new Error("injected goal prompt send failure");\n' : ""}\t\tif (message.display === false) record("private-worker-started", message.content);\n\t\telse record("private-worker-message", message.content);\n\t},\n\ton(name, handler) {\n\t\tif (!handlers.has(name)) handlers.set(name, []);\n\t\thandlers.get(name).push(handler);\n\t},\n\tsetSessionName() {},\n\tgetSessionName() {},\n\texec() { return Promise.resolve({ code: 0, stdout: "", stderr: "" }); },\n});\nconst ui = {\n\tasync confirm() { return true; },\n\tasync select(_title, options) { return options[0]; },\n\tnotify() {},\n\tsetStatus() {},\n\tsetWorkingVisible() {},\n\tsetWidget() {},\n};\nconst ctx = {\n\tcwd,\n\tmode: "json",\n\thasUI: true,\n\tmodel: { provider: "test", id: "current", contextWindow: 200000 },\n\tmodelRegistry: { find(provider, modelId) { return { provider, id: modelId, contextWindow: 200000 }; } },\n\tui,\n\tisIdle() { return true; },\n\thasPendingMessages() { return false; },\n\tsessionManager: {\n\t\tgetSessionFile() { return sessionFile; },\n\t\tgetSessionDir() { return cwd; },\n\t\tgetBranch() { return entries; },\n\t\tgetEntries() { return entries; },\n\t\tappendSessionInfo() {},\n\t\tappendCustomEntry(customType, data) { entries.push({ type: "custom", customType, data }); },\n\t},\n\tasync waitForIdle() {},\n\tasync newSession() { throw new Error("unexpected newSession"); },\n\tasync switchSession() { throw new Error("unexpected switchSession"); },\n};\nfor (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);\n${afterSessionStart}\n`,
	);
	return script;
}

function waitForChildExit(child, timeoutMs = 30_000) {
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

async function waitForFile(path) {
	mkdirSync(dirname(path), { recursive: true });
	await waitForCondition(
		() => existsSync(path),
		`file did not appear: ${path}`,
		30_000,
	);
}

async function assertFakeWorkerParentsGone(
	cwd,
	goalIndexes,
	allowUnstarted = false,
) {
	for (const goalIndex of goalIndexes) {
		const pidPath = join(cwd, `worker-${goalIndex}.pid`);
		if (allowUnstarted && !existsSync(pidPath)) continue;
		await waitForDeadPid(pidPath, `worker ${goalIndex} still alive`);
	}
}

async function assertFakeWorkersGone(cwd, goalIndexes) {
	await assertFakeWorkerParentsGone(cwd, goalIndexes);
	for (const goalIndex of goalIndexes) {
		await waitForDeadPid(
			join(cwd, `worker-${goalIndex}.child-pid`),
			`worker ${goalIndex} child still alive`,
		);
	}
}

async function waitForDeadPid(path, message) {
	await waitForFile(path);
	const pid = Number(readFileSync(path, "utf8"));
	assert(Number.isInteger(pid) && pid > 0, `invalid pid file: ${path}`);
	const startedAt = performance.now();
	while (performance.now() - startedAt < 5000) {
		if (!processExists(pid)) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`${message}: ${pid}`);
}

function processExists(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForParallelRunPrepared(dir, goalIndexes) {
	await waitForCondition(
		() => {
			const flow = readFlow(dir);
			return (
				JSON.stringify(flow.parallelRun?.goalIndexes) ===
					JSON.stringify(goalIndexes) &&
				goalIndexes.every(
					(index) =>
						flow.goals[index]?.status === "running" &&
						flow.goals[index]?.sessionFile,
				)
			);
		},
		`parallel run was not prepared: ${goalIndexes.join(",")}`,
		30_000,
	);
}

async function waitForCondition(predicate, message, timeoutMs = 1000) {
	const startedAt = performance.now();
	while (performance.now() - startedAt < timeoutMs) {
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
	const { handlers } = await loadExtension(state);
	const { goalRuntimeState } = await importCachedModule("goal/runtime.js");
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
	await emit(handlers, "session_start", {}, ctxA);
	await emit(handlers, "session_start", {}, ctxB);

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

	assert(await pauseGoalFromFlow(ctxA), "session A pause failed");
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
		state.hiddenMessages
			.at(-1)
			?.includes(`pi-goal-continuation:${goalB.id}:`) &&
			!state.hiddenMessages
				.at(-1)
				?.includes(`pi-goal-continuation:${goalA.id}:`),
		"session B continue prompt used the wrong goal",
	);
	assert(await pauseGoalFromFlow(ctxB), "session B pause failed");
	assert(getGoalState(ctxB)?.status === "paused", "session B did not pause");
	assert(getGoalState(ctxA)?.status === "active", "session A was paused by B");
	assert(
		goalRuntimeState.sessions.size === 2,
		"Goal sessions were not tracked",
	);
	await emit(handlers, "session_shutdown", {}, ctxA);
	assert(
		goalRuntimeState.sessions.size === 1 &&
			getGoalState(ctxB)?.status === "paused",
		"shutting down session A removed or changed session B",
	);
	await emit(handlers, "session_shutdown", {}, ctxB);
	assert(
		goalRuntimeState.sessions.size === 0,
		"Goal session state survived teardown",
	);
}

async function sessionContextIsolationScenario() {
	const {
		flowRuntimeResourceCounts,
		releaseFlowContext,
		rememberFlowContext,
		rememberedFlowContext,
	} = await importModule("flow/runtime.js");
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
	assert(
		!releaseFlowContext(ctxA.sessionManager.getSessionFile(), ctxB) &&
			rememberedFlowContext(ctxA.sessionManager.getSessionFile()) === ctxA,
		"mismatched context released another session",
	);
	assert(
		releaseFlowContext(ctxA.sessionManager.getSessionFile(), ctxA) &&
			rememberedFlowContext(ctxB.sessionManager.getSessionFile()) === ctxB,
		"exact session release removed the wrong context",
	);
	releaseFlowContext(ctxB.sessionManager.getSessionFile(), ctxB);
	assert(
		flowRuntimeResourceCounts().contexts === 0,
		"released contexts remained in runtime",
	);
}

async function soakRetainedContextGateScenario() {
	const {
		evaluateSoakResult,
		generationCancellationLifecycle,
		parallelExecutionLifecycle,
		serialExecutionLifecycle,
	} = await import(
		`${pathToFileURL(join(root, "scripts/benchmark-performance.mjs")).href}?test=${Date.now()}`
	);
	const { readAlignmentState } = await importModule(
		"shared/generation-state.js",
	);
	const resources = {
		flow: { contexts: 0, completionFacts: 0 },
		generation: {
			contexts: 0,
			promptTargets: 0,
			stalePromptTargets: 0,
			replyTargets: 0,
			resultTokens: 0,
		},
		goalSessions: 0,
		flowWatchers: 0,
		flowWatcherResources: {
			flows: 0,
			osWatchers: 0,
			watchedFiles: 0,
			registrations: 0,
			pendingFrames: 0,
		},
		parallelBoards: 0,
		laneWidgets: { active: 0, mounts: 1, clears: 1 },
		report: {
			backgroundTasks: 0,
			connecting: false,
			connected: true,
			registeredReports: 1,
			registerChains: 0,
			statusContext: false,
			failureCount: 0,
			requestDestroyed: false,
			responseDestroyed: false,
			lastClosedConnection: null,
		},
		active: {},
	};
	const closedResources = {
		...resources,
		report: {
			...resources.report,
			connected: false,
			registeredReports: 0,
			registerChains: 0,
			requestDestroyed: null,
			responseDestroyed: null,
			lastClosedConnection: {
				requestDestroyed: true,
				responseDestroyed: true,
			},
		},
	};
	const contexts = { weakRefs: 0, aliveAfterGc: 0 };
	const samples = Array.from({ length: 100 }, (_item, index) => ({
		cycle: index + 1,
		heapUsed: 10_000_000,
		rss: 20_000_000,
		lifecycle: {
			generation: "cancelled",
			serial: index % 2 === 0 ? "completed" : "stopped",
			parallel: index % 2 === 0 ? "completed" : "stopped",
			parallelWorkers: 2,
		},
		resources,
	}));
	assert(
		evaluateSoakResult(samples, 10, contexts, closedResources).ok === true,
		"soak rejected a stable lifecycle",
	);
	const preDraftFlow = {
		status: "paused",
		goals: [],
		currentGoal: 0,
		parallelRun: null,
	};
	const alignment = { version: 1 };
	assert(
		generationCancellationLifecycle(preDraftFlow, alignment) === "cancelled",
		"soak rejected a verified generation cancellation",
	);
	assert(
		serialExecutionLifecycle(
			{ status: "paused", currentGoal: 1, goals: [{}, { status: "running" }] },
			true,
			{ completionBoundary: true, runtimeGoalStatus: "paused" },
		) === "stopped",
		"soak rejected a verified serial stop",
	);
	assert(
		serialExecutionLifecycle(
			{ status: "complete", goals: [{ status: "complete" }] },
			false,
		) === "completed",
		"soak rejected a verified serial completion",
	);
	assert(
		parallelExecutionLifecycle(
			{
				status: "paused",
				parallelRun: { goalIndexes: [1, 2] },
				goals: [
					{ status: "complete" },
					{ status: "paused" },
					{ status: "paused" },
				],
			},
			true,
			[1, 2],
		) === "stopped",
		"soak rejected a verified parallel stop",
	);
	assert(
		parallelExecutionLifecycle(
			{
				status: "complete",
				parallelRun: null,
				goals: [{ status: "complete" }, { status: "complete" }],
			},
			false,
			[0, 1],
		) === "completed",
		"soak rejected a verified parallel completion",
	);
	const invalidAlignmentDir = tempDir("soak-invalid-alignment");
	writeFileSync(join(invalidAlignmentDir, "alignment.json"), "{}\n");
	let invalidAlignmentRejected = false;
	try {
		readAlignmentState(invalidAlignmentDir);
	} catch {
		invalidAlignmentRejected = true;
	}
	assert(
		invalidAlignmentRejected,
		"malformed alignment checkpoint was accepted",
	);
	for (const [message, validate] of [
		[
			"soak accepted generation cancellation without paused canonical state",
			() =>
				generationCancellationLifecycle(
					{ ...preDraftFlow, status: "generating" },
					alignment,
				),
		],
		[
			"soak accepted generation cancellation without alignment checkpoint",
			() => generationCancellationLifecycle(preDraftFlow, undefined),
		],
		[
			"soak accepted generation cancellation with a Goal",
			() =>
				generationCancellationLifecycle(
					{ ...preDraftFlow, goals: [{ status: "running" }] },
					alignment,
				),
		],
		[
			"soak accepted generation cancellation with a current Goal",
			() =>
				generationCancellationLifecycle(
					{ ...preDraftFlow, currentGoal: 1 },
					alignment,
				),
		],
		[
			"soak accepted generation cancellation with a parallel run",
			() =>
				generationCancellationLifecycle(
					{ ...preDraftFlow, parallelRun: { goalIndexes: [] } },
					alignment,
				),
		],
		[
			"soak accepted serial stop without a paused Goal runtime",
			() =>
				serialExecutionLifecycle(
					{ status: "paused", currentGoal: 0, goals: [{ status: "running" }] },
					true,
					{ completionBoundary: true, runtimeGoalStatus: "active" },
				),
		],
		[
			"soak accepted serial stop without a completion boundary",
			() =>
				serialExecutionLifecycle(
					{ status: "paused", currentGoal: 0, goals: [{ status: "running" }] },
					true,
					{ completionBoundary: false, runtimeGoalStatus: "paused" },
				),
		],
		[
			"soak accepted serial completion with an incomplete Goal",
			() =>
				serialExecutionLifecycle(
					{
						status: "complete",
						goals: [{ status: "complete" }, { status: "running" }],
					},
					false,
				),
		],
		[
			"soak accepted parallel completion with an incomplete Goal",
			() =>
				parallelExecutionLifecycle(
					{
						status: "complete",
						parallelRun: null,
						goals: [{ status: "complete" }, { status: "running" }],
					},
					false,
					[0, 1],
				),
		],
		[
			"soak accepted parallel completion with a retained run",
			() =>
				parallelExecutionLifecycle(
					{
						status: "complete",
						parallelRun: { goalIndexes: [0, 1] },
						goals: [{ status: "complete" }, { status: "complete" }],
					},
					false,
					[0, 1],
				),
		],
		[
			"soak accepted parallel stop with a running Goal",
			() =>
				parallelExecutionLifecycle(
					{
						status: "paused",
						parallelRun: { goalIndexes: [1] },
						goals: [{ status: "complete" }, { status: "running" }],
					},
					true,
					[1],
				),
		],
		[
			"soak accepted parallel stop without a retained run",
			() =>
				parallelExecutionLifecycle(
					{
						status: "paused",
						parallelRun: null,
						goals: [{ status: "complete" }, { status: "paused" }],
					},
					true,
					[1],
				),
		],
	]) {
		let rejected = false;
		try {
			validate();
		} catch {
			rejected = true;
		}
		assert(rejected, message);
	}
	const retainedContext = evaluateSoakResult(
		samples,
		10,
		{ weakRefs: 1, aliveAfterGc: 1 },
		closedResources,
	);
	assert(
		retainedContext.ok === false &&
			retainedContext.resourceFailures.some((failure) =>
				failure.includes("Session context"),
			),
		"soak accepted a retained full Session context",
	);
	const empty = evaluateSoakResult([], 10, contexts, closedResources);
	assert(
		empty.ok === false &&
			empty.resourceFailures.some((failure) => failure.includes("no samples")),
		"soak accepted an empty run",
	);
	const retainedBoardSamples = samples.map((sample, index) => ({
		...sample,
		resources:
			index === samples.length - 1
				? { ...sample.resources, parallelBoards: 1 }
				: sample.resources,
	}));
	const retainedBoard = evaluateSoakResult(
		retainedBoardSamples,
		10,
		contexts,
		closedResources,
	);
	assert(
		retainedBoard.ok === false &&
			retainedBoard.resourceFailures.some((failure) =>
				failure.includes("parallel board"),
			),
		"soak accepted a retained parallel lane board",
	);
	const retainedWatcher = evaluateSoakResult(
		samples.map((sample, index) => ({
			...sample,
			resources:
				index === samples.length - 1
					? {
							...sample.resources,
							flowWatcherResources: {
								...sample.resources.flowWatcherResources,
								osWatchers: 1,
								pendingFrames: 1,
							},
						}
					: sample.resources,
		})),
		10,
		contexts,
		closedResources,
	);
	assert(
		retainedWatcher.ok === false &&
			retainedWatcher.resourceFailures.some((failure) =>
				failure.includes("Flow watcher osWatchers"),
			),
		"soak accepted retained Flow watcher resources",
	);
	const retainedLaneWidget = evaluateSoakResult(
		samples.map((sample, index) => ({
			...sample,
			resources:
				index === samples.length - 1
					? {
							...sample.resources,
							laneWidgets: { ...sample.resources.laneWidgets, active: 1 },
						}
					: sample.resources,
		})),
		10,
		contexts,
		closedResources,
	);
	assert(
		retainedLaneWidget.ok === false &&
			retainedLaneWidget.resourceFailures.some((failure) =>
				failure.includes("lane widgets"),
			),
		"soak accepted a retained lane widget",
	);
	for (const resourceName of [
		"FSWatcher",
		"Timeout",
		"ProcessWrap",
		"PipeConnectWrap",
		"TCPConnectWrap",
		"ShutdownWrap",
		"TCPSocketWrap",
		"FutureResourceWrap",
	]) {
		const activeResources = {
			...resources,
			active: { [resourceName]: 1 },
		};
		const closedActiveResources = {
			...closedResources,
			active: { [resourceName]: 1 },
		};
		const retainedResourceSamples = samples.map((sample, index) => ({
			...sample,
			resources:
				index === samples.length - 1 ? activeResources : sample.resources,
		}));
		const retainedDuringCycle = evaluateSoakResult(
			retainedResourceSamples,
			10,
			contexts,
			closedResources,
		);
		const retainedAfterClose = evaluateSoakResult(
			samples,
			10,
			contexts,
			closedActiveResources,
		);
		assert(
			retainedDuringCycle.ok === false &&
				retainedAfterClose.ok === false &&
				retainedDuringCycle.resourceFailures.some((failure) =>
					failure.includes(resourceName),
				) &&
				retainedAfterClose.resourceFailures.some((failure) =>
					failure.includes(resourceName),
				),
			`soak accepted a retained ${resourceName}`,
		);
	}
	const inheritedPipeResources = {
		...resources,
		active: { PipeWrap: 2 },
	};
	const inheritedPipeSamples = samples.map((sample) => ({
		...sample,
		resources: inheritedPipeResources,
	}));
	const inheritedClosedPipeResources = {
		...closedResources,
		active: { PipeWrap: 2 },
	};
	assert(
		evaluateSoakResult(
			inheritedPipeSamples,
			10,
			contexts,
			inheritedClosedPipeResources,
			{ PipeWrap: 2 },
		).ok === true,
		"soak rejected inherited stdout/stderr PipeWrap resources",
	);
	const retainedPipe = evaluateSoakResult(
		inheritedPipeSamples,
		10,
		contexts,
		inheritedClosedPipeResources,
		{ PipeWrap: 1 },
	);
	assert(
		retainedPipe.ok === false &&
			retainedPipe.resourceFailures.some((failure) =>
				failure.includes("PipeWrap"),
			),
		"soak accepted a retained Unix client socket above baseline",
	);
	const failedReportSamples = samples.map((sample, index) => ({
		...sample,
		resources:
			index === samples.length - 1
				? {
						...resources,
						report: {
							...resources.report,
							connected: false,
							registeredReports: 0,
							failureCount: 1,
							requestDestroyed: null,
							responseDestroyed: null,
						},
					}
				: sample.resources,
	}));
	const failedReport = evaluateSoakResult(
		failedReportSamples,
		10,
		contexts,
		closedResources,
	);
	assert(
		failedReport.ok === false &&
			failedReport.resourceFailures.some((failure) =>
				failure.includes("report client failed"),
			),
		"soak accepted a failed report connection",
	);
	const retainedControl = evaluateSoakResult(samples, 10, contexts, {
		...closedResources,
		report: {
			...closedResources.report,
			connected: true,
			registeredReports: 1,
			requestDestroyed: false,
			responseDestroyed: false,
			lastClosedConnection: null,
		},
	});
	assert(
		retainedControl.ok === false &&
			retainedControl.resourceFailures.some((failure) =>
				failure.includes("still connected"),
			),
		"soak accepted a retained unref report control socket",
	);
	const undestroyedControl = evaluateSoakResult(samples, 10, contexts, {
		...closedResources,
		report: {
			...closedResources.report,
			lastClosedConnection: {
				requestDestroyed: false,
				responseDestroyed: false,
			},
		},
	});
	assert(
		undestroyedControl.ok === false &&
			undestroyedControl.resourceFailures.some((failure) =>
				failure.includes("was not destroyed"),
			),
		"soak accepted an undestroyed report control connection",
	);
	const onlyCompleted = evaluateSoakResult(
		samples.map((sample) => ({
			...sample,
			lifecycle: { ...sample.lifecycle, parallel: "completed" },
		})),
		10,
		contexts,
		closedResources,
	);
	assert(
		onlyCompleted.ok === false &&
			onlyCompleted.resourceFailures.some((failure) =>
				failure.includes("completed and stopped"),
			),
		"soak accepted parallel coverage without a stopped lifecycle",
	);
	const missingParallel = evaluateSoakResult(
		samples.map((sample) => ({ ...sample, lifecycle: undefined })),
		10,
		contexts,
		closedResources,
	);
	assert(
		missingParallel.ok === false &&
			missingParallel.resourceFailures.some((failure) =>
				failure.includes("parallel lifecycle coverage"),
			),
		"soak accepted samples without real parallel lifecycles",
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
	const sessionFile = join(cwd, "final.jsonl");
	const flow = readFlow(dir);
	const finalGoal = flow.goals[2];
	const finalSnapshot = readFileSync(join(dir, finalGoal.file), "utf8");
	writeFlow(dir, {
		...flow,
		status: "running",
		startedAt: Date.now(),
		completedAt: null,
		currentGoal: 2,
		goals: [
			{ ...flow.goals[0], status: "complete", handoff: "done" },
			{ ...flow.goals[1], status: "complete", handoff: "done" },
			{
				...finalGoal,
				status: "running",
				sessionFile,
				snapshot: finalSnapshot,
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
		!(globalThis.__PI_ACTIVITY_SIGNAL__?.state.sources ?? []).includes(
			"pi-flow:frame",
		),
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
	await flushScheduledGoalStart();
	const flow = readFlow(dir);
	assert(flow.status === "complete", "single-step flow did not complete");
	assert(
		Number.isFinite(flow.goals[0].startedAt) &&
			Number.isFinite(flow.goals[0].completedAt) &&
			Number.isFinite(flow.completedAt) &&
			flow.goals[0].completedAt >= flow.goals[0].startedAt &&
			flow.completedAt >= flow.goals[0].completedAt,
		"serial completion timestamps were not committed by the parent",
	);
	assert(
		cardTitleCount(state, "Flow Goal 1 已完成") === 1,
		"single-step final card was not sent exactly once",
	);
	assert(
		cardTitleCount(state, "Flow 已完成") === 0,
		"single-step kept generic Flow complete card",
	);
	assert(
		cardTitleCount(state, "Flow 第 1 步 · Goal 1 已完成") === 0,
		"single-step Goal complete card kept step label",
	);
	assert(
		!state.notifications.some((message) => message.includes("已完成")),
		state.notifications.join("\n"),
	);
	const flowCompleteCard = findFlowCard(
		state,
		"Flow Goal 1 已完成",
		"single-step complete card missing",
	);
	const flowCompleteLines = flowCompleteCard.message.details.lines.join("\n");
	assert(
		flowCompleteCard.options.triggerTurn === true &&
			flowCompleteCard.message.details.lines.includes("编号：F1") &&
			flowCompleteCard.message.details.lines.includes("目标：Do Goal 1.") &&
			flowCompleteCard.message.details.lines.includes("验收：未启用") &&
			flowCompleteCard.message.details.lines.includes("质检：未启用") &&
			flowCompleteLines.includes("⏱ 总用时：") &&
			!flowCompleteLines.includes("状态：已完成") &&
			!flowCompleteLines.includes("1/1 步"),
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
	await flushScheduledGoalStart();
	const enFlowCompleteCard = findFlowCard(
		enState,
		"Flow Goal 1 complete",
		"English single-step complete card missing",
	);
	const enCompleteLines = enFlowCompleteCard.message.details.lines.join("\n");
	assert(
		enFlowCompleteCard.message.details.lines.includes("ID: F1") &&
			enFlowCompleteCard.message.details.lines.includes("Goal: Do Goal 1.") &&
			enFlowCompleteCard.message.details.lines.includes(
				"Acceptance: disabled",
			) &&
			enFlowCompleteCard.message.details.lines.includes(
				"Quality check: disabled",
			) &&
			enCompleteLines.includes("⏱ Total elapsed:") &&
			!enCompleteLines.includes("Status:"),
		enCompleteLines,
	);
}

async function flowFinalCompletionHtmlFailureScenario() {
	const { completionFact } = await importCachedModule("flow/runtime.js");
	const cwd = tempDir("completion-html-failure");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands, handlers } = await loadExtension(state);
	const ctx = commandContext(state, cwd, join(cwd, "planning.jsonl"));
	await commands.get("flow").handler("go F1", ctx);
	await flushScheduledGoalStart();
	const goalCtx = state.activeCtx;
	const sessionFile = goalCtx.sessionManager.getSessionFile();
	breakFlowHtml(dir);
	await emit(
		handlers,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		goalCtx,
	);
	await flushScheduledGoalStart();
	const flow = readFlow(dir);
	assert(
		flow.status === "complete",
		"HTML failure rolled back final completion",
	);
	assert(
		completionFact(sessionFile) === undefined,
		"HTML failure left completion fact unconsumed",
	);
	assert(
		cardTitleCount(state, "Flow Goal 1 已完成") === 1,
		`HTML failure suppressed completion card: ${cardTitles(state).join(" | ")}`,
	);
	assertReportRefreshFailure(state);
	assertNoPlanRepair(state);
}

async function finalizeRetryCursorContinueScenario() {
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

async function finalizeRetryRefreshesResumeBoundaryScenario() {
	const { recordFlowGoalCompletionBoundary } =
		await importCachedModule("flow/completion.js");
	const { pauseGoalFromFlow, startGoalFromFlow } =
		await importCachedModule("goal.js");
	const cwd = tempDir("completion-finalize-boundary");
	const dir = createFlow(cwd, "F1");
	const state = newState(cwd);
	const { commands } = await loadExtension(state);
	const sessionFile = join(cwd, "goal-session.jsonl");
	writeFileSync(sessionFile, "");
	const ctx = commandContext(state, cwd, sessionFile);
	assert(
		await startGoalFromFlow("Goal 1", ctx, { sendPrompt: false }),
		"flow goal did not start",
	);
	assert(await pauseGoalFromFlow(ctx), "flow goal did not pause");
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
			},
		],
	});
	recordFlowGoalCompletionBoundary(ctx, {
		reason: "resume",
		expectedGoalId: "stale-goal-id",
	});
	await commands.get("flow").handler("go F1", ctx);
	const saved = readFlow(dir);
	assert(saved.status === "complete", "finalize_retry stale boundary looped");
	assert(
		saved.goals[0].completionCursor === null,
		`finalize_retry kept cursor: ${saved.goals[0].completionCursor}`,
	);
	assert(
		!state.notifications.some((message) =>
			message.includes("完成事实写入失败"),
		),
		state.notifications.join("\n"),
	);
}

async function completionScenario() {
	const { rememberedFlowContext } = await importCachedModule("flow/runtime.js");
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
	await flushScheduledGoalStart();
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
		flowCompleteCard.message.content.includes("请基于上面的验收和质检"),
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
	await emit(handlers, "agent_end", { messages: [] }, planCtx);
	assert(
		cardTitleCount(state, "Flow 已完成") === 1 &&
			readFlow(join(cwd, ".flow", "F1")).status === "complete",
		"late completion repeated final settlement",
	);
	assert(
		rememberedFlowContext(planCtx.sessionManager.getSessionFile()) ===
			undefined,
		"completed Flow retained its final Session context",
	);
}

function parallelRun(goalIndexes) {
	return {
		id: "P1",
		goalIndexes,
		startedAt: 0,
		consoleSessionFile: "console.jsonl",
		consoleSessionName: `F1-${goalIndexes.map((index) => `G${index + 1}`).join("+")} 并行控制台`,
	};
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
		schemaVersion: 17,
		language: options.language ?? "zh",
		id,
		title: "Test Flow",
		status: "draft",
		source: { type: "prompt", text: "original" },
		createdAt: Date.now(),
		updatedAt: Date.now(),
		startedAt: null,
		completedAt: null,
		currentGoal: 0,
		meta: null,
		attention: null,
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

function createParallelToParallelFlow(cwd, id) {
	const dir = createFlow(cwd, id, { planCount: 6 });
	const flow = readFlow(dir);
	flow.goals[0].status = "complete";
	for (const goalIndex of [1, 2]) {
		flow.goals[goalIndex].dependsOn = [0];
		flow.goals[goalIndex].writeScope = [`src/${goalIndex}/**`];
	}
	for (const goalIndex of [3, 4]) {
		flow.goals[goalIndex].dependsOn = [1, 2];
		flow.goals[goalIndex].writeScope = [`src/${goalIndex}/**`];
	}
	flow.goals[5].dependsOn = [3, 4];
	writeFlow(dir, flow);
	return dir;
}

async function createCrashedParallelFlow(cwd, id) {
	const dir = createParallelFlow(cwd, id);
	const flow = readFlow(dir);
	flow.status = "running";
	flow.startedAt = Date.now();
	flow.currentGoal = 1;
	flow.parallelRun = {
		id: "P-crashed",
		goalIndexes: [1, 2],
		startedAt: Date.now(),
		consoleSessionFile: join(cwd, "console.jsonl"),
		consoleSessionName: "F1-G2+G3 并行控制台",
	};
	for (const goalIndex of [1, 2]) {
		const goal = flow.goals[goalIndex];
		const snapshot = readFileSync(join(dir, goal.file), "utf8");
		goal.status = "running";
		goal.sessionFile = join(
			cwd,
			`F1-G${goalIndex + 1} Goal ${goalIndex + 1}.jsonl`,
		);
		goal.sessionName = `worker ${goalIndex}`;
		goal.snapshot = snapshot;
	}
	writeFlow(dir, flow);
	return dir;
}

function writeWorkerHandoff(dir, flow, goalIndex, parallelRunId, message) {
	const artifact = workerGoalArtifact(flow, goalIndex, emptyChecks());
	writeFileSync(
		join(dir, `G${goalIndex + 1}-worker.json`),
		`${JSON.stringify(
			{
				...artifact,
				parallelRunId,
				status: "paused",
				handoff: {
					kind: "user_action_required",
					message,
					at: Date.now(),
				},
			},
			null,
			2,
		)}\n`,
	);
}

function writeWorkerResult(dir, goalIndex, parallelRunId, summary) {
	const artifactPath = join(dir, `G${goalIndex + 1}-worker.json`);
	const sessionFile = join(
		dirname(dir),
		`F1-G${goalIndex + 1} Goal ${goalIndex + 1}.jsonl`,
	);
	writeFileSync(
		artifactPath,
		`${JSON.stringify(
			{
				schemaVersion: 3,
				flowId: basename(dir),
				goalIndex,
				goalTitle: `Goal ${goalIndex + 1}`,
				goalFile: `G${goalIndex + 1}-plan.md`,
				parallelRunId,
				status: "complete",
				completionCursor: null,
				runtimeGoalId: `worker-${goalIndex}`,
				sessionFile,
				sessionName: `worker ${goalIndex}`,
				result: { summary, outcome: "passed" },
				checks: emptyChecks(),
				handoff: null,
				completion: {
					goalId: `worker-${goalIndex}`,
					summary,
					acceptance: "passed",
					sessionFile,
					parallelRunId,
				},
				updatedAt: Date.now(),
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

function installFlowReviewRunner(cwd, options) {
	const command = join(
		cwd,
		`review-runner-${Math.random().toString(16).slice(2)}.mjs`,
	);
	const startedPath = `${command}.started`;
	const output = `${JSON.stringify({
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text: options.output }],
		},
	})}\n`;
	const body = options.wait
		? `
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(startedPath)}, "");
const finish = () => process.exit(0);
process.on("SIGINT", finish);
process.on("SIGTERM", finish);
setTimeout(() => process.stdout.write(${JSON.stringify(output)}), 30_000);
`
		: `process.stdout.write(${JSON.stringify(output)});`;
	writeFileSync(command, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
	return { command, startedPath };
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
const releasePath = join(process.cwd(), "release-worker-spawn");
let releaseWatcher;
const release = new Promise((resolve) => {
	const finish = () => {
		releaseWatcher?.close();
		resolve();
	};
	releaseWatcher = watch(process.cwd(), (_event, name) => {
		if (name !== null && String(name) !== "release-worker-spawn") return;
		if (!existsSync(releasePath)) return;
		finish();
	});
	if (existsSync(releasePath)) finish();
});
writeFileSync(
	join(process.cwd(), "worker-spawn-args.json"),
	JSON.stringify({ args, command: process.argv[1], env }, null, 2),
);
await release;
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
		`import { spawn } from "node:child_process";\nimport { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from "node:fs";\nimport { connect } from "node:net";\nimport { join } from "node:path";\nconst args = process.argv.slice(2);\nconst session = args[args.indexOf("--session") + 1];\nconst flowId = process.env.PI_FLOW_WORKER_FLOW_ID ?? "";\nconst flowDir = process.env.PI_FLOW_WORKER_FLOW_DIR;\nconst goalIndex = process.env.PI_FLOW_WORKER_GOAL_INDEX ?? "0";\nconst socketPath = process.env.PI_FLOW_WORKER_SOCKET_PATH;\nconst token = process.env.PI_FLOW_WORKER_TOKEN;\nconst parallelRunId = () => process.env.PI_FLOW_WORKER_PARALLEL_RUN_ID;\nappendFileSync(join(process.cwd(), "worker-runs.log"), goalIndex + "\\n");\nconst marker = (suffix) => join(process.cwd(), \`worker-\${goalIndex}.\${suffix}\`);\nwriteFileSync(marker("pid"), String(process.pid));\nconst promptIndex = args.indexOf("-p");\nif (promptIndex >= 0) writeFileSync(marker("prompt"), args[promptIndex + 1] ?? "");\nlet onControlClose = () => process.exit(1);\nlet controlSocket;\nif (socketPath && token) {\n\tcontrolSocket = connect(socketPath, () => controlSocket.write(JSON.stringify({ type: "hello", token }) + "\\n"));\n\tcontrolSocket.on("error", () => undefined);\n\tcontrolSocket.on("close", () => onControlClose());\n}\nconst releaseControl = () => {\n\tonControlClose = () => undefined;\n\tcontrolSocket?.destroy();\n};\nconst waitForRelease = () => new Promise((resolve) => {\n\tconst releasePath = join(process.cwd(), "release-workers");\n\tlet watcher;\n\tconst finish = () => {\n\t\twatcher?.close();\n\t\tresolve();\n\t};\n\twatcher = watch(process.cwd(), (_event, name) => {\n\t\tif (name !== null && String(name) !== "release-workers") return;\n\t\tif (!existsSync(releasePath)) return;\n\t\tfinish();\n\t});\n\tif (existsSync(releasePath)) finish();\n});\nconsole.log(JSON.stringify({ type: "agent_start", goalIndex: Number(goalIndex) }));\nif (process.env.PI_FLOW_FAKE_BLOCK_INDEX === goalIndex) {\n\tif (!flowDir) throw new Error("missing flow dir");\n\tconst artifactPath = join(flowDir, \`G\${Number(goalIndex) + 1}-worker.json\`);\n\tlet artifact = {};\n\ttry { artifact = JSON.parse(readFileSync(artifactPath, "utf8")); } catch {}\n\tconst handoff = { kind: "user_action_required", message: process.env.PI_FLOW_FAKE_BLOCK_REASON ?? "user action required", at: Date.now() };\n\tconst tmpPath = artifactPath + ".tmp";\n\twriteFileSync(tmpPath, JSON.stringify({ ...artifact, status: "paused", handoff }, null, 2));\n\trenameSync(tmpPath, artifactPath);\n\treleaseControl();\n} else if (process.env.PI_FLOW_FAKE_HANG === "1") {\n\twriteFileSync(marker("started"), "");\n\tspawn(process.execPath, ["-e", "const fs=require('fs');fs.writeFileSync(process.argv[2],String(process.pid));fs.writeFileSync(process.argv[1]+'.started','');process.on('SIGTERM',()=>{fs.writeFileSync(process.argv[1],'');process.exit(0)});process.on('SIGINT',()=>{fs.writeFileSync(process.argv[1],'');process.exit(0)});setInterval(()=>{},1000)", marker("child-killed"), marker("child-pid")], { stdio: "ignore" });\n\tconst exit = () => {\n\t\twriteFileSync(marker("killed"), "");\n\t\tprocess.exit(0);\n\t};\n\tonControlClose = exit;\n\tprocess.on("SIGTERM", exit);\n\tprocess.on("SIGINT", exit);\n\tsetInterval(() => undefined, 1000);\n} else if (process.env.PI_FLOW_FAKE_FAIL_INDEX === goalIndex) {\n\tconsole.error("fake worker failed " + goalIndex);\n\tprocess.exit(1);\n} else if (process.env.PI_FLOW_FAKE_MISSING_COMPLETION_INDEX === goalIndex) {\n\treleaseControl();\n\tprocess.exit(0);\n} else {\n\tconsole.log(JSON.stringify({ type: "tool_execution_start", toolCallId: "tool-" + goalIndex, toolName: "bash", args: { command: "echo worker" } }));\n\tconsole.log(JSON.stringify({ type: "tool_execution_end", toolCallId: "tool-" + goalIndex, toolName: "bash", result: "ok", isError: false }));\n\twriteFileSync(marker("started"), "");\n\tawait new Promise((resolve) => setTimeout(resolve, 100));\n\tif (process.env.PI_FLOW_FAKE_WAIT_FOR_RELEASE === "1") {\n\t\tawait waitForRelease();\n\t}\n\tif (!flowDir) throw new Error("missing flow dir");\n\tconst artifactPath = join(flowDir, \`G\${Number(goalIndex) + 1}-worker.json\`);\n\tlet artifact = {};\n\ttry { artifact = JSON.parse(readFileSync(artifactPath, "utf8")); } catch {}\n\tconst completion = { goalId: \`worker-\${goalIndex}\`, summary: \`done \${goalIndex}\`, acceptance: "passed", sessionFile: session, parallelRunId: parallelRunId() };\n\tconst tmpPath = artifactPath + ".tmp";\n\twriteFileSync(tmpPath, JSON.stringify({ ...artifact, status: "complete", sessionFile: session, completion }, null, 2));\n\trenameSync(tmpPath, artifactPath);\n\tawait new Promise((resolve) => setTimeout(resolve, 20));\n\tconsole.log(JSON.stringify({ type: "agent_end", messages: [] }));\n\treleaseControl();\n}\n`,
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
		checks: emptyChecks(),
		pendingAdvisor: null,
	};
}

function emptyChecks() {
	return {
		acceptance: { enabled: true, rounds: [], active: null },
		quality: { enabled: true, rounds: [], active: null },
	};
}

function writeWorkerGoalArtifact(dir, flow, goalIndex, checks, cursor = null) {
	writeFileSync(
		join(dir, `G${goalIndex + 1}-worker.json`),
		`${JSON.stringify(
			workerGoalArtifact(flow, goalIndex, checks, cursor),
			null,
			2,
		)}\n`,
	);
}

function workerGoalArtifact(flow, goalIndex, checks, cursor = null) {
	const goal = flow.goals[goalIndex];
	return {
		schemaVersion: 3,
		flowId: flow.id,
		goalIndex,
		goalTitle: goal?.title ?? `Goal ${goalIndex + 1}`,
		goalFile: goal?.file ?? `G${goalIndex + 1}-plan.md`,
		parallelRunId: flow.parallelRun?.id ?? "P1",
		status: "running",
		completionCursor: cursor,
		runtimeGoalId: `worker-${goalIndex}`,
		sessionFile: null,
		sessionName: null,
		result: { summary: null, outcome: null },
		checks,
		handoff: null,
		completion: null,
		updatedAt: Date.now(),
	};
}

function activeCheck(label) {
	return {
		round: 1,
		generation: "test-generation",
		runId: "test-run",
		inputHash: "test-input",
		models: [{ key: label, label, outcome: null }],
	};
}

function runningChecks() {
	return {
		...emptyChecks(),
		acceptance: {
			enabled: true,
			rounds: [],
			active: activeCheck("model"),
		},
	};
}

function passedChecks() {
	return {
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result: "passed", summary: "验收通过" }],
			active: null,
		},
		quality: {
			enabled: true,
			rounds: [{ round: 1, result: "passed", summary: "质检通过" }],
			active: null,
		},
	};
}

function failedChecks() {
	return {
		...emptyChecks(),
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result: "failed", summary: "验收失败" }],
			active: null,
		},
	};
}

function qualityFailedChecks() {
	return {
		acceptance: {
			enabled: true,
			rounds: [{ round: 1, result: "passed", summary: "验收通过" }],
			active: null,
		},
		quality: {
			enabled: true,
			rounds: [{ round: 1, result: "failed", summary: "质检失败" }],
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
- [x] Do work.

## Success Criteria
- Done.

## Verification
- [x] \`npm test\`

## Notes

## Handoff
`;
}

async function loadExtension(state, moduleDir = srcOut) {
	const { default: flowExtension } = await import(
		`file://${join(moduleDir, "index.js")}?t=${Date.now()}-${Math.random()}`
	);
	const commands = new Map();
	const shortcuts = new Map();
	const tools = new Map();
	const handlers = new Map();
	let activeTools = [];
	const api = {
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerShortcut(shortcut, options) {
			shortcuts.set(shortcut, options);
		},
		registerTool(tool) {
			tools.set(tool.name, tool);
		},
		registerMessageRenderer() {},
		registerFlag() {},
		getFlag() {},
		getThinkingLevel() {
			return "off";
		},
		async setModel(model) {
			if (!state.allowModelSwitch) return false;
			state.selectedModels.push(model);
			state.onModelSwitch?.(model);
			if (state.modelSwitchBarrier) await state.modelSwitchBarrier;
			return true;
		},
		setThinkingLevel(level) {
			state.thinkingLevels.push(level);
		},
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
			if (message.display === false) {
				state.hiddenMessages.push(String(message.content));
				state.onHiddenMessage?.(message);
			}
		},
		on(name, handler) {
			if (state.failRuntimeEventOnce === name) {
				state.failRuntimeEventOnce = undefined;
				throw new Error(`injected registration failure: ${name}`);
			}
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
			const execution = { command, args };
			state.execs.push(execution);
			for (const listener of state.execListeners) listener(execution);
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	};
	state.extensionApis.push(api);
	flowExtension(api);
	return { commands, shortcuts, tools, handlers };
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
			return state.select ?? options[0];
		},
		notify(message, level) {
			const notification = `${message}:${level ?? "info"}`;
			state.notifications.push(notification);
			for (const listener of state.notificationListeners)
				listener(notification);
		},
		setStatus(_key, value) {
			state.statuses.push(value);
			for (const listener of state.statusListeners) listener(value);
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
		model: { provider: "test", id: "current", contextWindow: 200_000 },
		modelRegistry: {
			find(provider, modelId) {
				if (state.missingModels.has(`${provider}/${modelId}`)) return undefined;
				return { provider, id: modelId, contextWindow: 200_000 };
			},
		},
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
			if (message.display === false) {
				state.hiddenMessages.push(String(message.content));
				state.onHiddenMessage?.(message);
			}
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

function waitForStatus(state, matches) {
	const existing = state.statuses.find(matches);
	if (existing) return Promise.resolve(existing);
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			state.statusListeners.delete(listener);
			reject(new Error("status timeout"));
		}, 5_000);
		const listener = (status) => {
			if (!matches(status)) return;
			clearTimeout(timeout);
			state.statusListeners.delete(listener);
			resolve(status);
		};
		state.statusListeners.add(listener);
	});
}

function waitForExec(state, matches) {
	const existing = state.execs.find(matches);
	if (existing) return Promise.resolve(existing);
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			state.execListeners.delete(listener);
			reject(new Error("exec timeout"));
		}, 5_000);
		const listener = (execution) => {
			if (!matches(execution)) return;
			clearTimeout(timeout);
			state.execListeners.delete(listener);
			resolve(execution);
		};
		state.execListeners.add(listener);
	});
}

function waitForNotification(state, matches) {
	const existing = state.notifications.find(matches);
	if (existing) return Promise.resolve(existing);
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			state.notificationListeners.delete(listener);
			reject(new Error("notification timeout"));
		}, 5_000);
		const listener = (notification) => {
			if (!matches(notification)) return;
			clearTimeout(timeout);
			state.notificationListeners.delete(listener);
			resolve(notification);
		};
		state.notificationListeners.add(listener);
	});
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
		notificationListeners: new Set(),
		statuses: [],
		statusListeners: new Set(),
		execListeners: new Set(),
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
		missingModels: new Set(),
		allowModelSwitch: false,
		selectedModels: [],
		thinkingLevels: [],
		modelSwitchBarrier: undefined,
		onModelSwitch: undefined,
		throwReplacedSessionFile: false,
		failRuntimeEventOnce: undefined,
		onHiddenMessage: undefined,
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
				: {
						round: 1,
						generation: "stuck-refactor-b",
						runId: "stuck-refactor-b-run",
						inputHash: "stuck-refactor-b-input",
						models: ["gpt-5.5", "gpt-5.4-mini", "grok-composer-2.5-fast"].map(
							(label) => ({
								key: label,
								label,
								outcome: {
									result: "passed",
									summary: "check/test passed",
									details: "check/test passed",
								},
							}),
						),
					},
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
	const { waitForSessionTransitions } = await import(
		`file://${join(srcOut, "flow/session-transition.js")}`
	);
	await waitForSessionTransitions();
}

/** prewalk 工作区指纹守卫需要真实 git 仓库；`.flow/` 运行态已被指纹排除。 */
function initGitWorkspace(cwd) {
	writeFileSync(join(cwd, "tracked.txt"), "base\n");
	// harness 把会话文件/worker 产物写在 cwd 根；真实 Pi 会话位于默认 session dir，
	// 不在工作区内。ignore 掉这些 harness 产物以模拟真实布局。
	writeFileSync(
		join(cwd, ".gitignore"),
		["*.jsonl", "bin/", "worker-*", "release-workers", "*.log", ""].join("\n"),
	);
	const git = (...args) =>
		execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
	git("init", "-q");
	git("add", "-A");
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
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

function readWorkerArtifact(path) {
	return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

function writeFlow(dir, flow) {
	writeFileSync(join(dir, "flow.json"), `${JSON.stringify(flow, null, 2)}\n`);
}

function breakFlowHtml(dir) {
	const htmlPath = join(dir, "flow.html");
	rmSync(htmlPath, { recursive: true, force: true });
	mkdirSync(htmlPath);
}

function assertReportRefreshFailure(state) {
	assert(
		state.notifications.some((message) =>
			message.includes("Flow 报告刷新失败"),
		),
		`HTML projection failure was silent: ${state.notifications.join(" | ")}`,
	);
}

function assertNoPlanRepair(state) {
	assert(
		!state.hiddenMessages.some((message) =>
			message.includes("你正在修正已有 Pi Flow 计划草稿"),
		) &&
			!state.notifications.some((message) => message.includes("Flow 计划修复")),
		`HTML projection failure triggered plan repair: ${state.notifications.join(" | ")}`,
	);
}

function writePreDraftFlow(cwd, id, options = {}) {
	const dir = join(cwd, ".flow", id);
	mkdirSync(dir, { recursive: true });
	const status = options.status ?? "generating";
	writeFlow(dir, {
		schemaVersion: 17,
		language: options.language ?? "zh",
		id,
		title: options.title ?? `Flow ${id}`,
		status,
		source: {
			type: "prompt",
			text: options.requestText ?? `request ${id}`,
		},
		createdAt: Date.now(),
		updatedAt: Date.now(),
		startedAt: null,
		completedAt: null,
		currentGoal: 0,
		meta: null,
		attention: null,
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
					depth: options.depth ?? "standard",
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

function installDirectoryWatchHarness(directory) {
	const mutableFs = createRequire(import.meta.url)("node:fs");
	const originalWatch = mutableFs.watch;
	let listener;
	let watches = 0;
	let closes = 0;
	mutableFs.watch = (path, ...args) => {
		if (resolve(String(path)) !== resolve(directory))
			return originalWatch(path, ...args);
		watches += 1;
		listener = args.findLast((value) => typeof value === "function");
		let closed = false;
		return {
			close() {
				if (closed) return;
				closed = true;
				closes += 1;
			},
		};
	};
	syncBuiltinESMExports();
	return {
		watchCalls: () => watches,
		closeCalls: () => closes,
		emit(name) {
			assert(listener, "directory watch listener was not registered");
			listener("change", name);
		},
		restore() {
			mutableFs.watch = originalWatch;
			syncBuiltinESMExports();
		},
	};
}

function installDirectoryWatchProbe(directory) {
	const mutableFs = createRequire(import.meta.url)("node:fs");
	const originalWatch = mutableFs.watch;
	let active = 0;
	let maximum = 0;
	mutableFs.watch = (path, ...args) => {
		const watcher = originalWatch(path, ...args);
		if (resolve(String(path)) !== resolve(directory)) return watcher;
		active += 1;
		maximum = Math.max(maximum, active);
		const originalClose = watcher.close.bind(watcher);
		let closed = false;
		watcher.close = () => {
			if (!closed) {
				closed = true;
				active -= 1;
			}
			return originalClose();
		};
		return watcher;
	};
	syncBuiltinESMExports();
	return {
		active: () => active,
		maximum: () => maximum,
		restore() {
			mutableFs.watch = originalWatch;
			syncBuiltinESMExports();
		},
	};
}

function latestWidgetText(state) {
	return renderWidgetContent(state.widgets.at(-1)?.content);
}

function latestWidgetTextForKey(state, key) {
	return renderWidgetContent(
		state.widgets.filter((item) => item.key === key).at(-1)?.content,
	);
}

function renderWidgetContent(content, width = 100, terminalRows) {
	const widget =
		typeof content === "function"
			? content(
					{
						requestRender() {},
						...(terminalRows ? { terminal: { rows: terminalRows } } : {}),
					},
					{ fg: (_color, value) => value, bold: (value) => value },
				)
			: content;
	return widget?.render ? widget.render(width).join("\n") : "";
}

function hasGoalFlame(text) {
	return text.includes("\u001b[38;2;255;");
}

function assertRunningLaneFirstActivity(text, goalLabel, activity) {
	const lines = text.split("\n");
	const header = lines.findIndex(
		(line) => line.includes(goalLabel) && line.includes("执行中"),
	);
	assert(header >= 0, `running lane header missing:\n${text}`);
	assert(
		lines[header + 1]?.includes(activity),
		`running lane first activity row missing ${activity}:\n${text}`,
	);
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
