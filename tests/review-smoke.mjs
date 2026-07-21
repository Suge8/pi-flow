import {
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
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";
import { acquireReportPortTestLock } from "./report-port-lock.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-review-test-${runId}`);
process.env.PI_CODING_AGENT_DIR = join(out, "agent-state");
// 默认断言是中文文案；en 场景通过 scope.language 显式指定；固定运行时语言避免机器 locale 引入环境相关失败。
process.env.PI_FLOW_LANGUAGE = "zh";
const srcOut = join(out, "dist");
const bin = join(out, "bin");
const diagnosticRouters = new Map();
const applyInstruction =
	"将质检反馈视为待核实假设，而非事实；先基于当前文件、测试/检查输出和会话约束核实。反馈属实时，逐条修复全部属实发现，修根因而非表象，同一根因的其他出现点一并修复，修完端到端验证问题已彻底解决再结束，避免无关重构、抽象、依赖或风格改动；反馈不成立时，不应用该反馈，并说明依据（文件、命令输出或约束）。";
let scenarioEvents;
let scenarioContext;

rmSync(out, { recursive: true, force: true });
mkdirSync(bin, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
cpSync(join(root, "prompts"), join(out, "prompts"), { recursive: true });
prepareTestDist(root, srcOut);
const releaseReportPortLock = await acquireReportPortTestLock();

try {
	await runScenario(promptContractScenario);
	await runScenario(passEvidenceAnchorContractScenario);
	await runScenario(readPromptMissingPrimaryIgnoresCwdScenario);
	await runScenario(cancelledRestartedArmedReviewDoesNotRunScenario);
	await runScenario(standaloneReviewReportScenario);
	await runScenario(standaloneReviewStartsBeforeReportProjectionScenario);
	await runScenario(terminalReviewReportRestoresStatusAfterRestartScenario);
	await runScenario(standaloneReportServerFailureContinuesScenario);
	await runScenario(passScenario);
	await runScenario(liveReviewerProgressScenario);
	await runScenario(reviewRequestArmsAndRunsScenario);
	await runScenario(reviewRequestSyncSendFailureDisarmsScenario);
	await runScenario(busyReviewRequestWaitsForQueuedTurnScenario);
	await runScenario(busyReviewRequestIgnoresPreArmAgentEndScenario);
	await runScenario(busyReviewArmingSurvivesRestartScenario);
	await runScenario(cancelledArmedReviewDoesNotRunScenario);
	await runScenario(disabledReviewDoesNotArmScenario);
	await runScenario(reviewArmSaveFailureDoesNotExecuteScenario);
	await runScenario(goalScopePromptScenario);
	await runScenario(currentTaskReviewPromptScenario);
	await runScenario(englishCurrentTaskReviewPromptScenario);
	await runScenario(configReadFailureNoticeScenario);
	await runScenario(contextModelFailureStopsScenario);
	await runScenario(checkpointFailureDoesNotPublishStartScenario);
	await runScenario(autoFailureScenario);
	await runScenario(standaloneReviewStallDisciplineScenario);
	await runScenario(standaloneAdvisorReceiptRecoveryScenario);
	await runScenario(standaloneAdvisorEscScenario);
	await runScenario(standaloneReviewBlockedOnUserScenario);
	await runScenario(standaloneReviewHardStopKeepsStatusReportScenario);
	await runScenario(cancelledReviewDoesNotTriggerAiScenario);
	await runScenario(cancelledReviewCheckpointFailureRemainsRecoverableScenario);
	await runScenario(cancelledReviewCheckpointConflictPreservesNewOwnerScenario);
	await runScenario(recoverableTransportErrorKeepsAutoLoopScenario);
	await runScenario(piRetryableErrorKeepsAutoLoopScenario);
	await runScenario(piRetryableErrorStopsAfterGuardScenario);
	await runScenario(multiReviewerFailureScenario);
	await runScenario(reviewCheckpointRejectsStaleGenerationScenario);
	await runScenario(reviewReportRunLifecycleScenario);
	await runScenario(interruptedReviewerPoolResumesMissingModelScenario);
	await runScenario(userInputInvalidatesReviewerCheckpointScenario);
	await runScenario(standaloneReviewRepairResumesAfterRestartScenario);
	await runScenario(standaloneReviewDeliveryFailureRetriesAfterRestartScenario);
	await runScenario(
		standaloneReviewPassDeliveryFailureRetriesAfterRestartScenario,
	);
	await runScenario(standaloneReviewPassCheckpointWriteFailureDefersScenario);
	await runScenario(standaloneReviewPostDeliveryCrashConvergesScenario);
	await runScenario(manualReviewDeliveryFailureRetriesAfterRestartScenario);
	await runScenario(consecutiveManualReviewsUseDistinctReceiptsScenario);
	await runScenario(standaloneReviewCheckResumeWaitsForIdleScenario);
	await runScenario(standaloneReviewMidLoopConfigErrorStopsScenario);
	await runScenario(awaitingAgentRestartWithInvalidConfigRecoversScenario);
	await runScenario(awaitingAgentRestartWithDisabledConfigDiscardsScenario);
	await runScenario(awaitingAgentRestartWithManualModeDiscardsScenario);
	await runScenario(reviewCancelSourcePriorityScenario);
	await runScenario(mixedReviewerFailureAndErrorScenario);
	await runScenario(passAndFormatInvalidReviewerPassesScenario);
	await runScenario(passAndErrorReviewerStopsScenario);
	await runScenario(cancelNotificationCopyScenario);
	await runScenario(processFailureRetriesScenario);
	await runScenario(spawnRunnerStreamsLinesScenario);
	await runScenario(spawnRunnerKillsProcessTreeScenario);
	await runScenario(emptyReviewOutputRetriesScenario);
	await runScenario(emptyReviewOutputFailsOnceScenario);
	await runScenario(reviewRoundTimeUsesCurrentStepScenario);
	await runScenario(failedReviewOmitsTotalTimeScenario);
	await runScenario(markdownBoldPassScenario);
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
	await runScenario(
		() =>
			// 护栏预算给足：高负载下 shell 启动可能超 1s，避免信号场景被超时路径误杀返回 null
			processScenario("signal", script("kill -TERM $$"), 10_000, (result) => {
				assert(
					result === "Review terminated by signal SIGTERM.",
					`signal was not reported: ${result}`,
				);
			}),
		"processScenario signal",
	);
	console.log("review smoke ok");
} finally {
	await shutdownReportDaemon();
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
	const agentDir = process.env.PI_CODING_AGENT_DIR;
	if (!agentDir) return;
	const endpointPath = join(agentDir, "pi-flow-report", "endpoint.json");
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
	if (!existsSync(endpointPath)) return;
	await new Promise((resolve, reject) => {
		const watcher = watch(dirname(endpointPath), () => {
			if (existsSync(endpointPath)) return;
			clearTimeout(timeout);
			watcher.close();
			resolve();
		});
		const timeout = setTimeout(() => {
			watcher.close();
			reject(new Error(`report daemon ${pid} did not stop`));
		}, 3_000);
		if (!existsSync(endpointPath)) {
			clearTimeout(timeout);
			watcher.close();
			resolve();
		}
	});
}

async function runScenario(fn, name = fn.name) {
	scenarioEvents = undefined;
	scenarioContext = undefined;
	try {
		await fn();
	} catch (error) {
		console.error(`review smoke failed in ${name}`);
		throw error;
	} finally {
		if (scenarioEvents && scenarioContext)
			await emitAll(scenarioEvents, "session_shutdown", {}, scenarioContext);
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

async function promptContractScenario() {
	const { parseCheckVerdictLine } = await import(
		`file://${join(srcOut, "shared/review-verdict.js")}?strict-${Date.now()}`
	);
	const prompt = readFileSync(join(root, "prompts", "zh", "review.md"), "utf8");
	assert(prompt.includes("# 质检"), prompt);
	assert(!prompt.includes("任务：会话质检"), prompt);
	assert(!prompt.includes("工具安全"), prompt);
	assert(prompt.includes("第一行只能是：PASS 或 FAIL"), prompt);
	assert(prompt.includes("输出契约"), prompt);
	assert(prompt.includes("先写一句极简质检摘要"), prompt);
	assert(prompt.includes("证据锚点"), prompt);
	assert(!prompt.includes("验收"), prompt);
	assert(parseCheckVerdictLine("PASS") === "PASS", "PASS was rejected");
	assert(parseCheckVerdictLine("FAIL") === "FAIL", "FAIL was rejected");
	assert(
		parseCheckVerdictLine("PASS 质量 OK") === undefined,
		"non-exact PASS line was accepted",
	);
}

async function passEvidenceAnchorContractScenario() {
	const { parseReviewOutcome } = await import(
		`file://${join(srcOut, "review-outcome.js")}?evidence-${Date.now()}`
	);
	const missing = parseReviewOutcome("PASS\n质量 OK", "zh");
	assert(
		missing.kind === "system_error" &&
			missing.notification.startsWith(
				"review 输出格式无效：PASS 缺少证据锚点行",
			),
		JSON.stringify(missing),
	);
	const anchored = parseReviewOutcome(
		"PASS\n质量 OK\n证据：文件=src/a.ts；命令=npm test",
		"zh",
	);
	assert(
		anchored.kind === "pass" && anchored.summary.includes("证据："),
		JSON.stringify(anchored),
	);
	const missingSummary = parseReviewOutcome(
		"PASS\n证据：文件=src/a.ts；命令=npm test",
		"zh",
	);
	assert(
		missingSummary.kind === "system_error" &&
			missingSummary.notification.includes("缺少摘要行"),
		JSON.stringify(missingSummary),
	);
	const commandOnly = parseReviewOutcome(
		"PASS\n质量 OK\n证据：命令=npm test",
		"zh",
	);
	assert(
		commandOnly.kind === "system_error" &&
			commandOnly.notification.includes("缺少文件段"),
		JSON.stringify(commandOnly),
	);
	const freeText = parseReviewOutcome(
		"PASS\n质量 OK\n证据：已全面检查实现逻辑",
		"zh",
	);
	assert(
		freeText.kind === "system_error" &&
			freeText.notification.includes("缺少文件段"),
		JSON.stringify(freeText),
	);
	const fileOnly = parseReviewOutcome(
		"PASS\n质量 OK\n证据：文件=src/a.ts",
		"zh",
	);
	assert(
		fileOnly.kind === "system_error" &&
			fileOnly.notification.includes("缺少命令段"),
		JSON.stringify(fileOnly),
	);
	// 契约口径：摘要必须在证据行前，但不限制摘要行数（行位死板只产生假阴性）。
	const multiSummary = parseReviewOutcome(
		"PASS\n摘要一。\n摘要二。\n证据：文件=src/a.ts；命令=npm test",
		"zh",
	);
	assert(multiSummary.kind === "pass", JSON.stringify(multiSummary));
	// 拆行拼装：首个证据行是唯一判定行，文件段/命令段分散在两行必须拒绝。
	const splitEvidenceZh = parseReviewOutcome(
		"PASS\n质量 OK\n证据：文件=src/a.ts\n证据：命令=npm test",
		"zh",
	);
	assert(
		splitEvidenceZh.kind === "system_error" &&
			splitEvidenceZh.notification.includes("缺少命令段"),
		JSON.stringify(splitEvidenceZh),
	);
	const splitEvidenceEn = parseReviewOutcome(
		"PASS\nQuality OK\nEvidence: commands=npm test\nEvidence: files=src/a.ts",
		"en",
	);
	assert(
		splitEvidenceEn.kind === "system_error" &&
			splitEvidenceEn.notification.includes("no files segment"),
		JSON.stringify(splitEvidenceEn),
	);
	const missingEn = parseReviewOutcome("PASS\nQuality OK", "en");
	assert(
		missingEn.kind === "system_error" &&
			missingEn.notification.startsWith(
				"review output format invalid: PASS is missing",
			),
		JSON.stringify(missingEn),
	);
	const anchoredEn = parseReviewOutcome(
		"PASS\nQuality OK\nEvidence: files=src/a.ts; commands=npm test",
		"en",
	);
	assert(anchoredEn.kind === "pass", JSON.stringify(anchoredEn));
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

async function standaloneReviewReportScenario() {
	const command = captureReviewCommand(
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("autoFix", command);
	const workspace = join(out, "standalone-report-workspace");
	const state = createState();
	state.cwd = workspace;
	state.sessionFile = join(out, "sessions", "review-report-session.jsonl");
	state.customEntries.push(
		{
			type: "message",
			id: "request-entry",
			parentId: null,
			timestamp: "2026-07-13T08:00:00.000Z",
			message: { role: "user", content: "请检查独立报告是否完整" },
		},
		{
			type: "message",
			id: "operation-entry",
			parentId: "request-entry",
			timestamp: "2026-07-13T08:01:00.000Z",
			message: {
				role: "bashExecution",
				command: "npm test",
				output: "all tests passed",
				exitCode: 0,
			},
		},
	);
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);

	const reportPath = join(
		workspace,
		".flow",
		"reviews",
		"review-report-session.html",
	);
	await waitFor(
		() =>
			existsSync(reportPath) &&
			readFileSync(reportPath, "utf8").includes("质量 OK"),
		"standalone review report was not written",
	);
	const html = readFileSync(reportPath, "utf8");
	assert(html.includes("data-review-report"), html);
	assert(html.includes('data-modal-open="dlg-review-evidence"'), html);
	assert(html.includes('<dialog id="dlg-review-evidence"'), html);
	assert(html.includes("以下内容已作为证据提供给质检模型"), html);
	assert(html.includes("Coverage："), html);
	assert(html.includes("对话证据："), html);
	assert(html.includes("操作证据："), html);
	assert(html.includes("请检查独立报告是否完整"), html);
	assert(
		html.includes("第 1 轮") &&
			html.includes("&lt;0.1m") &&
			!html.includes(' data-elapsed-since="'),
		html,
	);
	assert((html.match(/质量 OK/gu) ?? []).length === 1, html);
	assert(!html.includes("会话质检状态的只读投影"), html);
	const capturedArgs = readFileSync(`${command}.args`, "utf8");
	const evidenceMarker = "\n\n上下文证据：\n";
	const evidenceStart =
		capturedArgs.indexOf(evidenceMarker) + evidenceMarker.length;
	const fedEvidence = capturedArgs
		.slice(evidenceStart)
		.split("\n---ARG---\n")[0];
	const displayedEvidence =
		/<pre data-context-evidence[^>]*>([\s\S]*?)<\/pre>/u.exec(html)?.[1];
	assert(displayedEvidence, "standalone report evidence block missing");
	assert(
		decodeHtmlLiteral(displayedEvidence) === fedEvidence,
		"standalone report evidence diverged from the reviewer prompt",
	);
	assertNoStandaloneReportLines(state);
	const reportUrl = await waitFor(
		() => standaloneReportStatusUrl(state),
		`${state.statuses.join(" | ")}\n${state.notifications.join("\n")}`,
	);
	assert(
		(await fetch(reportUrl).then((response) => response.text())).includes(
			"请检查独立报告是否完整",
		),
		"standalone review report status URL was not reachable",
	);

	rmSync(dirname(reportPath), { recursive: true, force: true });
	writeReviewConfig(
		"autoFix",
		reviewCommand([
			"PASS\n重建 OK\n证据：文件=src/rebuilt.ts；命令=npm test\n",
		]),
	);
	await commands.get("review").handler("", ctx);
	await waitFor(
		() =>
			existsSync(reportPath) &&
			readFileSync(reportPath, "utf8").includes("重建 OK"),
		"deleted review projection was not rebuilt",
	);
}

async function standaloneReviewStartsBeforeReportProjectionScenario() {
	const command = captureReviewCommand(
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("autoFix", command);
	const state = createState();
	state.sessionFile = join(out, "sessions", "review-projection-order.jsonl");
	const reportPath = join(
		state.cwd,
		".flow",
		"reviews",
		"review-projection-order.html",
	);
	const { runConfiguredReview } = await import(
		`file://${join(srcOut, "review.js")}?projection-order=${Date.now()}`
	);
	let reportExistedAtStart;
	const result = await runConfiguredReview(mockPi(state), mockContext(state), {
		scope: { kind: "review" },
		onStart: () => {
			reportExistedAtStart = existsSync(reportPath);
		},
	});
	assert(result.kind === "passed", JSON.stringify(result));
	assert(
		reportExistedAtStart === false,
		"standalone report projection ran before the quality-check start event",
	);
	await waitFor(
		() => existsSync(reportPath),
		"standalone report projection was not written",
	);
}

async function terminalReviewReportRestoresStatusAfterRestartScenario() {
	const state = createState();
	state.sessionFile = join(out, "sessions", "terminal-report-restart.jsonl");
	state.customEntries.push({
		type: "custom",
		id: "terminal-review-checkpoint",
		parentId: null,
		timestamp: "2026-07-14T10:00:00.000Z",
		customType: "review-checkpoint",
		data: {
			version: 3,
			active: null,
			round: 1,
			phase: null,
			reportRun: 1,
			history: [
				{ round: 1, result: "passed", summary: "terminal report passed" },
			],
		},
	});
	const reportPath = join(
		state.cwd,
		".flow",
		"reviews",
		"terminal-report-restart.html",
	);
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, "<!doctype html><p>terminal report restart</p>");
	const { events } = await loadBootstrapExtension();
	const ctx = mockContext(state);
	await emitAll(events, "session_start", {}, ctx);
	const reportUrl = await waitFor(
		() => standaloneReportStatusUrl(state),
		`terminal report status missing: ${state.statuses.join(" | ")}`,
	);
	assert(
		(await fetch(reportUrl).then((response) => response.text())).includes(
			"terminal report restart",
		),
		"restored terminal report URL was not reachable",
	);
	// 重启恢复复用 reportRun=1，目录仍为 complete/Recent
	const restored = latestReviewCheckpoint(state);
	assert(restored?.reportRun === 1, JSON.stringify(restored));
	await waitForReviewDirectoryRecord(
		reportPath,
		(item) => item?.state === "complete" && item.generation === 1,
		"restart did not republish terminal review as Recent with same reportRun",
	);
}

async function standaloneReportServerFailureContinuesScenario() {
	const command = captureReviewCommand(
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("autoFix", command);
	await shutdownReportDaemon();
	let resolveHealthRequest;
	const healthRequested = new Promise((resolve) => {
		resolveHealthRequest = resolve;
	});
	const sockets = new Set();
	const occupied = createServer((request) => {
		if (request.url === "/health") resolveHealthRequest();
	});
	occupied.on("connection", (socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
	});
	await new Promise((resolve, reject) => {
		occupied.once("error", reject);
		occupied.listen(49327, "127.0.0.1", resolve);
	});
	const state = createState();
	let review;
	try {
		const { commands, events } = await loadExtension(state);
		const ctx = mockContext(state);
		await emitAll(events, "session_start", {}, ctx);
		review = commands.get("review").handler("", ctx);
		await healthRequested;
		await waitFor(
			() => existsSync(`${command}.args`),
			"reviewer did not start while the report service was unavailable",
			2_000,
		);
	} finally {
		for (const socket of sockets) socket.destroy();
		await new Promise((resolve, reject) =>
			occupied.close((error) => (error ? reject(error) : resolve())),
		);
		await review;
	}
	assert(
		state.messages.at(-1)?.message.details?.title === "质检通过",
		state.messages.map((entry) => entry.message.details?.title).join(" | "),
	);
	assert(
		latestReviewCheckpoint(state)?.phase === null &&
			latestReviewCheckpoint(state)?.history?.at(-1)?.result === "passed",
		JSON.stringify(latestReviewCheckpoint(state)),
	);
	await waitFor(
		() =>
			state.notifications.some((item) => item.includes("Flow 网页报告不可用")),
		"report service failure was not reported",
	);
	const reportPath = join(
		state.cwd,
		".flow",
		"reviews",
		`${basename(state.sessionFile, ".jsonl")}.html`,
	);
	const report = readFileSync(reportPath, "utf8");
	assert(report.includes("以下内容已作为证据提供给质检模型"), report);
	assert(report.includes("操作证据：\n（无）"), report);
	assert(!report.includes("当前 session"), report);
}

async function passScenario() {
	writeReviewConfig(
		"autoFix",
		reviewCommand(["PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n"]),
	);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	const attention = await attentionProbe();
	await commands.get("review").handler("", ctx);
	attention.unsubscribe();
	assert(
		attention.sources.length === 0,
		`${attention.sources.join(" | ")}\n${state.messages
			.map(
				(entry) => `${entry.message.details?.title}: ${entry.message.content}`,
			)
			.join("\n")}`,
	);
	const card = state.messages.at(-1);
	assert(card.message.details.title === "质检通过", card.message.details.title);
	// 真实 /review 终态 → 目录 Recent（轮询账本，避免跨模块 client 实例）
	const checkpoint = latestReviewCheckpoint(state);
	const reportPath = join(
		state.cwd,
		".flow",
		"reviews",
		`${basename(state.sessionFile, ".jsonl")}.html`,
	);
	const record = await waitForReviewDirectoryRecord(
		reportPath,
		(item) =>
			item?.state === "complete" && item.generation === checkpoint?.reportRun,
		"review pass left directory not complete",
	);
	assert(
		checkpoint?.phase === null && checkpoint?.active === null && record,
		JSON.stringify({ checkpoint, record }),
	);
	const firstRun = checkpoint.reportRun;
	// 第二轮真实 /review：更高 reportRun 重进 Live，再收口 complete
	await commands.get("review").handler("", ctx);
	const secondLive = latestReviewCheckpoint(state);
	// 若瞬间已通过，至少 generation 必须递增；进行中则目录 Live
	assert(
		secondLive?.reportRun > firstRun,
		`second review reportRun not incremented: ${JSON.stringify(secondLive)}`,
	);
	await waitForReviewDirectoryRecord(
		reportPath,
		(item) =>
			item?.generation === secondLive.reportRun &&
			(item.state === "live" || item.state === "complete"),
		"second review did not republish directory",
	);
	// 等待第二轮终态
	await waitFor(
		() => {
			const cp = latestReviewCheckpoint(state);
			return cp?.phase === null && cp?.active === null ? cp : undefined;
		},
		"second review did not reach terminal checkpoint",
		10_000,
	);
	const secondDone = latestReviewCheckpoint(state);
	await waitForReviewDirectoryRecord(
		reportPath,
		(item) =>
			item?.state === "complete" &&
			item.generation === secondDone.reportRun &&
			item.generation > firstRun,
		"second review terminal was not Recent with new generation",
	);
	assert(card.options.triggerTurn === true, JSON.stringify(card.options));
	assert(card.message.content.includes("质量 OK"), card.message.content);
	assert(card.message.content.includes("简洁最终回复"), card.message.content);
	assert(!card.message.content.includes("/ 总"), card.message.content);
	assert(
		state.statuses.includes("💯 quality/质检 · 0s"),
		state.statuses.join(" | "),
	);
	assert(
		!state.statuses.some(
			(item) => item?.includes("质检") && item.includes("/ 总"),
		),
		state.statuses.join(" | "),
	);
	assert(
		state.sentMessages.length === 0,
		"review used user prompt instead of card",
	);
}

async function liveReviewerProgressScenario() {
	const state = createState();
	const command = jsonEventCommand(
		assistantProgressEvents(
			"PASS\n质量 OK\n证据：文件=src/live.ts；命令=npm test\n",
			"src/live.ts",
		),
	);
	writeReviewConfig("autoFix", command);
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	const { activeProgressSnapshot } = await import(
		`file://${join(srcOut, "shared/agent-progress.js")}`
	);
	enableMonitorProbe(ctx, state, activeProgressSnapshot);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const widgets = renderWidgets(state, "review-progress");
	assert(
		widgets.some((text) => text.includes("x · 读取 src/live.ts · 1 calls")),
		widgets.join("\n---\n"),
	);
	assert(
		widgets.some((text) => text.includes("Alt+S 详情")),
		widgets.join("\n---\n"),
	);
	assert(
		state.monitorScopes?.includes("quality"),
		JSON.stringify(state.monitorScopes),
	);
}

async function reviewRequestArmsAndRunsScenario() {
	const command = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await emitAll(events, "session_start", {}, ctx);
	await commands.get("review").handler("修复登录超时", ctx);

	assert(
		state.sentMessages.length === 1 &&
			state.sentMessages[0].message === "修复登录超时" &&
			Object.keys(state.sentMessages[0].options).length === 0,
		`review request was not sent as a user message: ${JSON.stringify(state.sentMessages)}`,
	);
	const armed = latestReviewCheckpoint(state);
	assert(
		armed?.active === null &&
			armed.round === 0 &&
			armed.phase === "awaiting_agent" &&
			armed.history.length === 0,
		`review request was not armed at round 0: ${JSON.stringify(armed)}`,
	);
	assert(
		state.messages.at(-1)?.message.details?.title === "已开启自动质检" &&
			!state.messages
				.at(-1)
				.message.details.lines.some((line) => line.includes("网页报告")),
		state.messages.map((entry) => entry.message.details?.title).join(" | "),
	);
	const activity = renderWidgets(state, "review-progress").at(-1);
	assert(
		activity?.includes("执行中") && activity.includes("完成后自动质检"),
		`armed activity missing: ${activity}`,
	);
	assert(
		state.statuses.includes("💯 quality/执行中 · 完成后自动质检 · 0s"),
		state.statuses.join(" | "),
	);
	assert(reviewRunCount(command) === 0, "review ran before agent_end");
	const armedReportPath = join(
		state.cwd,
		".flow",
		"reviews",
		`${basename(state.sessionFile, ".jsonl")}.html`,
	);
	await waitFor(
		() => existsSync(armedReportPath),
		"armed review report was not written",
	);
	const armedReport = readFileSync(armedReportPath, "utf8");
	assert(
		armedReport.includes("执行中 · 完成后自动质检") &&
			armedReport.includes("等待第 1 轮") &&
			!armedReport.includes("第 0 轮"),
		armedReport,
	);

	await emitAll(
		events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		reviewRunCount(command) === 1,
		"armed review did not run after agent_end",
	);
	assert(
		state.messages.at(-1)?.message.details?.title === "质检通过",
		state.messages.map((entry) => entry.message.details?.title).join(" | "),
	);
	assert(
		latestReviewCheckpoint(state)?.history?.[0]?.round === 1,
		JSON.stringify(latestReviewCheckpoint(state)),
	);
}

async function reviewRequestSyncSendFailureDisarmsScenario() {
	const command = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command);
	const state = createState();
	state.failUserMessage = "injected user message failure";
	const loaded = await loadExtension(state);
	const ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("修复登录超时", ctx);

	const checkpoint = latestReviewCheckpoint(state);
	assert(
		checkpoint?.active === null &&
			checkpoint.round === 0 &&
			checkpoint.phase === null &&
			checkpoint.history.length === 0,
		`sync send failure left review armed: ${JSON.stringify(checkpoint)}`,
	);
	assert(state.sentMessages.length === 0, JSON.stringify(state.sentMessages));
	assert(reviewRunCount(command) === 0, "failed request started reviewer");
	const notices = state.notifications.filter((item) =>
		item.includes("质检需求发送失败"),
	);
	assert(
		notices.length === 1 &&
			notices[0].includes("injected user message failure") &&
			notices[0].includes("已取消自动质检") &&
			!notices[0].includes("网页报告"),
		state.notifications.join("\n"),
	);
	await waitFor(
		() => standaloneReportStatusUrl(state),
		state.statuses.join(" | "),
	);
	await emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(reviewRunCount(command) === 0, "failed request revived review");
}

async function busyReviewRequestWaitsForQueuedTurnScenario() {
	const command = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	const loaded = await loadExtension(state);
	const ctx = mockContext(state);
	ctx.isIdle = () => false;
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("补充修复登录超时", ctx);
	assert(
		state.sentMessages.length === 1 &&
			state.sentMessages[0].options.deliverAs === "followUp",
		JSON.stringify(state.sentMessages),
	);

	await emitRawAgentEnd(
		loaded,
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await emitAll(
		loaded.events,
		"message_start",
		{ message: { role: "user" } },
		ctx,
	);
	await loaded.waitForScheduledReviewAgentEnd();
	assert(
		reviewRunCount(command) === 0 &&
			latestReviewCheckpoint(state)?.phase === "awaiting_agent",
		"old turn agent_end started review before the queued request",
	);
	await emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		reviewRunCount(command) === 1,
		"queued request completion did not start review",
	);
}

async function busyReviewRequestIgnoresPreArmAgentEndScenario() {
	const command = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	const loaded = await loadExtension(state);
	const ctx = mockContext(state);
	ctx.isIdle = () => false;
	await emitAll(loaded.events, "session_start", {}, ctx);
	await emitRawAgentEnd(
		loaded,
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await loaded.commands.get("review").handler("补充修复登录超时", ctx);
	await emitAll(
		loaded.events,
		"message_start",
		{ message: { role: "user" } },
		ctx,
	);
	await loaded.waitForScheduledReviewAgentEnd();
	assert(
		reviewRunCount(command) === 0 &&
			latestReviewCheckpoint(state)?.phase === "awaiting_agent",
		"pre-arm agent_end was applied to the new armed review",
	);
	await emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		reviewRunCount(command) === 1,
		"queued request completion did not start review after stale event",
	);
}

async function busyReviewArmingSurvivesRestartScenario() {
	const command = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	ctx.isIdle = () => false;
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	assert(state.sentMessages.length === 0, JSON.stringify(state.sentMessages));
	assert(
		latestReviewCheckpoint(state)?.round === 0 &&
			latestReviewCheckpoint(state)?.phase === "awaiting_agent",
		JSON.stringify(latestReviewCheckpoint(state)),
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	loaded = await loadExtension(state);
	ctx = mockContext(state);
	ctx.isIdle = () => false;
	await emitAll(loaded.events, "session_start", {}, ctx);
	assert(reviewRunCount(command) === 0, "armed review ran during restart");
	const interrupted = renderWidgets(state, "review-progress").at(-1);
	assert(
		interrupted?.includes("已中断") && interrupted.includes("回复后自动质检"),
		`armed restart activity missing: ${interrupted}`,
	);
	await emitAll(loaded.events, "agent_start", {}, ctx);
	const resumed = renderWidgets(state, "review-progress").at(-1);
	assert(
		resumed?.includes("执行中") && resumed.includes("完成后自动质检"),
		`resumed armed activity missing: ${resumed}`,
	);
	await emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(reviewRunCount(command) === 1, "restarted armed review did not run");
}

async function cancelledRestartedArmedReviewDoesNotRunScenario() {
	const command = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	ctx.isIdle = () => false;
	await emitAll(loaded.events, "session_start", {}, ctx);
	assert(
		state.editorComponents.length === 1,
		`first session editor installs: ${state.editorComponents.length}`,
	);
	await loaded.commands.get("review").handler("", ctx);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	loaded = await loadExtension(state);
	ctx = mockContext(state);
	ctx.isIdle = () => false;
	await emitAll(loaded.events, "session_start", {}, ctx);
	assert(
		state.editorComponents.length === 2,
		`second session editor installs: ${state.editorComponents.length - 1}`,
	);
	const { isFlowEditorInputHidden } = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}`
	);
	assert(
		!isFlowEditorInputHidden(),
		"restarted armed review should keep reply input visible",
	);
	const editor = state.editorComponents.at(-1)(
		{ requestRender() {} },
		{ borderColor: "" },
		{
			matches(data, action) {
				return data === "\u001b" && action === "app.interrupt";
			},
			getKeys(action) {
				return action === "app.interrupt" ? ["escape"] : ["ctrl+c"];
			},
		},
	);
	const cancelled = waitForNotification(state, (message) =>
		message.includes("质检已取消"),
	);
	editor.handleInput("\u001b");
	await cancelled;
	assert(
		latestReviewCheckpoint(state)?.phase === null,
		`restart cancel left armed checkpoint: ${JSON.stringify(latestReviewCheckpoint(state))}`,
	);
	await emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(reviewRunCount(command) === 0, "restart-cancelled review still ran");
	const notices = state.notifications.filter((item) =>
		item.includes("质检已取消"),
	);
	assert(notices.length === 1, state.notifications.join("\n"));
}

async function cancelledArmedReviewDoesNotRunScenario() {
	const command = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	ctx.isIdle = () => false;
	await emitAll(events, "session_start", {}, ctx);
	await commands.get("review").handler("", ctx);
	const { cancelActiveFlowActivity, isFlowEditorInputHidden } = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}`
	);
	assert(isFlowEditorInputHidden(), "armed review did not enable Esc handling");
	const cancelled = waitForNotification(state, (message) =>
		message.includes("质检已取消"),
	);
	cancelActiveFlowActivity();
	await cancelled;
	await waitFor(
		() => latestReviewCheckpoint(state)?.phase === null,
		"Esc did not clear armed review checkpoint",
	);
	assert(!isFlowEditorInputHidden(), "Esc did not restore editor input");
	await emitAll(
		events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(reviewRunCount(command) === 0, "cancelled armed review still ran");
	const notices = state.notifications.filter((item) =>
		item.includes("质检已取消"),
	);
	assert(notices.length === 1, state.notifications.join("\n"));
}

async function disabledReviewDoesNotArmScenario() {
	const command = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command, undefined, false);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await emitAll(events, "session_start", {}, ctx);
	await commands.get("review").handler("", ctx);
	await commands.get("review").handler("修复登录超时", ctx);
	ctx.isIdle = () => false;
	await commands.get("review").handler("", ctx);
	assert(
		state.notifications.filter((item) => item.includes("质检已禁用")).length ===
			3,
		state.notifications.join("\n"),
	);
	assert(state.sentMessages.length === 0, JSON.stringify(state.sentMessages));
	assert(
		latestReviewCheckpoint(state) === undefined,
		"disabled review was armed",
	);
}

async function reviewArmSaveFailureDoesNotExecuteScenario() {
	const command = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command);
	const state = createState();
	state.failReviewCheckpointArm = true;
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await emitAll(events, "session_start", {}, ctx);
	await commands.get("review").handler("修复登录超时", ctx);
	assert(state.sentMessages.length === 0, JSON.stringify(state.sentMessages));
	assert(
		state.notifications.some(
			(item) =>
				item.includes("自动质检开启失败") && item.includes("未安排自动质检"),
		),
		state.notifications.join("\n"),
	);
	assert(
		latestReviewCheckpoint(state) === undefined,
		"failed arm was persisted",
	);
	assert(reviewRunCount(command) === 0, "request ran without a durable arm");
}

async function goalScopePromptScenario() {
	const command = captureReviewCommand(
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("autoFix", command);
	const state = createState();
	state.cwd = join(out, "goal-scope-report-workspace");
	state.sessionFile = join(out, "sessions", "goal-scope-session.jsonl");
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
	assert(args.includes("范围完整性已由前置验收把关"), args);
	assert(args.includes("验收结论也不是你的证据"), args);
	assert(args.includes("重心放在实现质量"), args);
	assert(
		!existsSync(join(state.cwd, ".flow", "reviews")),
		"goal-scoped review created a standalone report",
	);
}

async function currentTaskReviewPromptScenario() {
	const command = captureReviewCommand(
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const args = readFileSync(`${command}.args`, "utf8");
	assert(args.includes("当前会话当前任务的交付质量"), args);
	assert(args.includes("上下文证据："), args);
	assert(args.includes("来源：原始 getBranch() 事件"), args);
	assert(args.includes("Coverage："), args);
	assert(!args.includes("\n\nTranscript:\n"), args);
	assert(!args.includes("修改文件:"), args);
	assert(args.includes("首条用户消息是原始需求锚点"), args);
	assert(args.includes("后续用户消息可能覆盖、缩小或修正原始需求"), args);
	assert(args.includes("最近 assistant 最终回复是交付声明"), args);
	assert(
		!args.includes("最近一次 assistant 最终回复，以及它对最近用户请求"),
		args,
	);
}

async function englishCurrentTaskReviewPromptScenario() {
	const command = captureReviewCommand(
		"PASS\nQuality OK\nEvidence: files=src/app.ts; commands=npm test\n",
	);
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
	assert(args.includes("Context Evidence:"), args);
	assert(args.includes("Source: raw getBranch() events"), args);
	assert(args.includes("Coverage:"), args);
	assert(args.includes("Conversation evidence:"), args);
	assert(!args.includes("会话记录"), args);
	assert(!args.includes("相关文件线索"), args);
	assert(!args.includes("Modified files:"), args);
	const report = readFileSync(
		join(
			state.cwd,
			".flow",
			"reviews",
			`${basename(state.sessionFile, ".jsonl")}.html`,
		),
		"utf8",
	);
	assert(
		report.includes(
			"The following content was provided to the review models as evidence.",
		) && report.includes("Operation evidence:"),
		report,
	);
}

async function configReadFailureNoticeScenario() {
	writeFileSync(join(out, "config.json"), "{");
	const state = createState();
	const { commands } = await loadExtension(state);
	await commands.get("review").handler("", mockContext(state));
	const notice = state.notifications.find((item) =>
		item.includes("质检配置读取失败"),
	);
	assertNoticeFormat(notice, "❌", "config.json 不是合法 JSON");
	assert(
		!state.messages.some((item) => item.message.details?.title === "质检中"),
		"invalid config emitted a false quality start card",
	);
	writeReviewConfig(
		"manual",
		reviewCommand(["PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n"]),
	);
}

async function contextModelFailureStopsScenario() {
	const command = captureReviewCommand(
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("autoFix", command);
	const state = createState();
	state.missingModels.add("test/x");
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.findLast(
		(item) => item.message.details?.title === "质检未完成",
	);
	assert(
		card?.message.content.includes("无法解析模型窗口"),
		JSON.stringify(card),
	);
	assert(!existsSync(`${command}.args`), "unbudgeted reviewer process started");
	assertNoStandaloneReportLines(state);
	const reportUrl = await waitFor(
		() => standaloneReportStatusUrl(state),
		`first-failure report status missing: ${state.statuses}`,
	);
	const report = await fetch(reportUrl).then((response) => response.text());
	assert(report.includes("data-context-evidence-error"), report);
	assert(report.includes("无法解析模型窗口"), report);
}

async function checkpointFailureDoesNotPublishStartScenario() {
	const command = captureReviewCommand(
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { runConfiguredReview } = await import(
		`file://${join(srcOut, "review.js")}?checkpoint-start-${Date.now()}`
	);
	let starts = 0;
	const result = await runConfiguredReview(mockPi(state), mockContext(state), {
		scope: {
			kind: "goal",
			goalId: "goal-checkpoint-start",
			language: "zh",
			goalText: "先提交 checkpoint 再显示启动状态",
		},
		onCheckRun: () => "deferred",
		onStart: () => {
			starts += 1;
		},
	});
	assert(result.kind === "checkpoint_deferred", JSON.stringify(result));
	assert(starts === 0, `checkpoint failure published ${starts} start events`);
	assert(
		!existsSync(`${command}.args`),
		"checkpoint failure started reviewer processes",
	);
	assert(
		!state.widgets.some(
			(item) => item.key === "review-progress" && item.content !== undefined,
		),
		"checkpoint failure displayed a review activity widget",
	);
}

async function autoFailureScenario() {
	writeReviewConfig(
		"autoFix",
		reviewCommand([
			"FAIL\n\n## 质检未通过\n\n## 发现 1\n- 问题: x\n\n## 发现 2\n- 问题: y\n",
		]),
	);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	const attention = await attentionProbe();
	await commands.get("review").handler("", ctx);
	attention.unsubscribe();
	const { piActivitySignal } = await import(
		`file://${join(srcOut, "shared/activity-signal.js")}`
	);
	assert(
		piActivitySignal().state.active === true,
		"auto-fix review activity ended before the repair turn",
	);
	assert(attention.sources.length === 0, attention.sources.join(" | "));
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质检未通过",
		card.message.details.title,
	);
	assert(card.message.content.startsWith("[质检未通过]"), card.message.content);
	assert(!card.message.content.includes("⏱ 用时"), card.message.content);
	assert(card.options.triggerTurn === true, JSON.stringify(card.options));
	assert(card.message.content.includes("## 质检未通过"), card.message.content);
	assert(card.message.content.includes("下一步："), card.message.content);
	const displayLines = card.message.details.lines.join("\n");
	assert(!displayLines.includes("需要修改"), displayLines);
	assert(!displayLines.includes("FAIL"), displayLines);
	assert(displayLines.includes("发现 1"), displayLines);
	assert(displayLines.includes("发现 1\n• 问题: x\n\n发现 2"), displayLines);
	assert(displayLines.includes("⏱ 用时："), displayLines);
	assertFooterLayout(card.message.details.lines, "⏱ 用时：");
	assert(
		state.statuses.some((item) => item?.startsWith("💯 quality/优化中 · ")),
		state.statuses.join(" | "),
	);
	assert(
		state.statuses.some(
			(item) => item?.includes("优化中") && item.includes("/ 总"),
		),
		state.statuses.join(" | "),
	);
	assert(
		!card.message.details.lines.join("\n").includes("下一步"),
		"next step leaked",
	);
}

/** 独立 /review 停滞自愈：2/4/6/8 轮咨询顾问、10 轮硬停交还用户。 */
async function standaloneReviewStallDisciplineScenario() {
	const reviewer = failForeverCommand(
		"FAIL\n\n## 质检未通过\n\n## 发现 1\n- 问题: x\n",
	);
	const advisor = failForeverCommand(
		"根因结论：原路径持续无效\n建议方向：停止微调，换事件驱动方案",
		"src/advisor.ts",
	);
	const reviewers = [{ model: "test/x", thinking: "off", command: reviewer }];
	writeFileSync(
		join(out, "config.json"),
		JSON.stringify({
			language: "zh",
			background: {
				command: routedDiagnosticCommand(advisor, reviewers),
				extensions: [],
			},
			checks: {
				tools: ["read", "grep", "find", "ls", "bash"],
				timeoutMinutes: 1 / 6,
				openaiFast: false,
			},
			modelRoles: {
				reviewers: reviewers.map(({ model, thinking }) => ({
					model,
					thinking,
				})),
			},
			quality: { enabled: true, mode: "autoFix", runAfterCompletion: true },
		}),
	);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	const { activeProgressSnapshot } = await import(
		`file://${join(srcOut, "shared/agent-progress.js")}`
	);
	enableMonitorProbe(ctx, state, activeProgressSnapshot);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	for (let round = 2; round <= 10; round += 1) {
		await emitAll(
			events,
			"agent_end",
			{ messages: [{ role: "assistant", stopReason: "stop" }] },
			ctx,
		);
	}
	assert(
		runCount(advisor) === 4,
		`standalone advisor consults: ${runCount(advisor)}`,
	);
	const advisorWidgets = renderWidgets(state, "review-progress");
	assert(
		state.monitorScopes?.includes("advisor") &&
			advisorWidgets.some((text) =>
				text.includes("x · 读取 src/advisor.ts · 1 calls"),
			) &&
			advisorWidgets.some((text) => text.includes("Alt+S 详情")),
		`${JSON.stringify(state.monitorScopes)}\n${advisorWidgets.join("\n---\n")}`,
	);
	const roundTwo = state.messages.find((item) =>
		item.message.details?.title.includes("第 2 轮质检未通过"),
	);
	const adviceCards = state.messages.filter(
		(item) =>
			item.message.details?.title === "顾问建议" &&
			item.message.details?.deliveryId?.endsWith(":repair"),
	);
	assert(
		roundTwo &&
			!roundTwo.message.content.includes("顾问建议") &&
			roundTwo.message.details.lines.some((line) =>
				line.includes("连续 2 轮未通过 · 正在咨询顾问"),
			) &&
			adviceCards.length === 4 &&
			adviceCards[0].message.details.advisor?.advice.includes(
				"建议方向：停止微调",
			) &&
			state.messages.indexOf(roundTwo) < state.messages.indexOf(adviceCards[0]),
		roundTwo?.message.content ?? "round 2 card missing",
	);
	const stopped = state.notifications.find((item) =>
		item.includes("已连续 10 轮检查未通过"),
	);
	assert(
		stopped,
		`notifications: ${state.notifications.join(" | ")}\n---titles---\n${state.messages.map((item) => item.message.details?.title).join(" | ")}`,
	);
	// 硬停后自动循环必须终止：再来一次 agent_end 不得再跑 reviewer。
	const runsAfterStop = runCount(reviewer);
	await emitAll(
		events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		runCount(reviewer) === runsAfterStop,
		"review loop kept running after the hard cap",
	);
	const reportPath = join(
		state.cwd,
		".flow",
		"reviews",
		`${basename(state.sessionFile, ".jsonl")}.html`,
	);
	const report = readFileSync(reportPath, "utf8");
	assert(report.includes("第 1 轮") && report.includes("第 10 轮"), report);
	assert(
		report.includes("顾问建议 ·") &&
			report.includes('data-tooltip-size="lg"') &&
			!report.includes("…全文"),
		report,
	);
	assert(report.includes("停止微调"), report);
}

/** 独立 /review 的 BLOCKED 接管：修复回合声明阻塞于用户操作即停循环交还用户。 */
async function standaloneAdvisorReceiptRecoveryScenario() {
	const reviewer = failForeverCommand(
		"FAIL\n\n## 质检未通过\n- 问题: receipt\n",
	);
	const advice = "根因结论：复用建议卡 receipt\n建议方向：恢复结构化建议";
	const advisor = failForeverCommand(advice);
	const reviewers = [{ model: "test/x", thinking: "off", command: reviewer }];
	writeFileSync(
		join(out, "config.json"),
		JSON.stringify({
			language: "zh",
			background: {
				command: routedDiagnosticCommand(advisor, reviewers),
				extensions: [],
			},
			checks: {
				tools: ["read", "grep", "find", "ls", "bash"],
				timeoutMinutes: 1,
				openaiFast: false,
			},
			modelRoles: {
				reviewers: [{ model: "test/x", thinking: "off" }],
			},
			quality: { enabled: true, mode: "autoFix", runAfterCompletion: true },
		}),
	);
	const state = createState();
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	state.failAfterResultCardTitle = "顾问建议";
	await emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		latestReviewCheckpoint(state)?.phase === "checking" &&
			latestReviewCheckpoint(state)?.active?.round === 2 &&
			runCount(advisor) === 1,
		`repair receipt crash state: ${JSON.stringify(latestReviewCheckpoint(state))}`,
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	state.failAfterResultCardTitle = undefined;
	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await waitFor(
		() => latestReviewCheckpoint(state)?.phase === "awaiting_agent",
		"standalone repair receipt did not settle history",
	);
	const checkpoint = latestReviewCheckpoint(state);
	const adviceCards = state.messages.filter(
		(item) =>
			item.message.details?.title === "顾问建议" &&
			item.message.details?.deliveryId?.endsWith(":repair"),
	);
	assert(
		runCount(advisor) === 1 &&
			adviceCards.length === 1 &&
			checkpoint.history[1]?.advisor?.advice === advice,
		`standalone repair receipt recovery: ${JSON.stringify({ calls: runCount(advisor), cards: adviceCards.length, advisor: checkpoint.history[1]?.advisor })}`,
	);
}

async function standaloneAdvisorEscScenario() {
	const reviewer = failForeverCommand("FAIL\n\n## 质检未通过\n- 问题: esc\n");
	const advisor = script("sleep 30");
	const reviewers = [{ model: "test/x", thinking: "off", command: reviewer }];
	writeFileSync(
		join(out, "config.json"),
		JSON.stringify({
			language: "zh",
			background: {
				command: routedDiagnosticCommand(advisor, reviewers),
				extensions: [],
			},
			checks: {
				tools: ["read", "grep", "find", "ls", "bash"],
				timeoutMinutes: 1,
				openaiFast: false,
			},
			modelRoles: {
				reviewers: [{ model: "test/x", thinking: "off" }],
			},
			quality: { enabled: true, mode: "autoFix", runAfterCompletion: true },
		}),
	);
	const state = createState();
	const loaded = await loadExtension(state);
	const ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	const pending = emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await waitFor(
		() =>
			renderWidgets(state, "review-progress").some((text) =>
				text.includes("顾问介入中"),
			),
		"standalone advisor consultation did not start",
	);
	const advisorActivity = renderWidgets(state, "review-progress")
		.filter((text) => text.includes("顾问介入中"))
		.at(-1);
	assert(
		advisorActivity && !advisorActivity.includes("思考中 · 0 calls"),
		`standalone advisor rendered a spinner before its first event:\n${advisorActivity}`,
	);
	const roundTwo = state.messages.find((item) =>
		item.message.details?.title.includes("第 2 轮质检未通过"),
	);
	assert(
		roundTwo?.message.details.lines.some((line) =>
			line.includes("正在咨询顾问"),
		),
		"standalone failure card was blocked by consultation",
	);
	const { cancelActiveFlowActivity } = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}`
	);
	cancelActiveFlowActivity();
	await pending;
	const checkpoint = latestReviewCheckpoint(state);
	assert(
		checkpoint?.phase === "awaiting_agent" &&
			checkpoint.history[1]?.advisor === undefined &&
			!state.messages.some(
				(item) => item.message.details?.title === "顾问建议",
			) &&
			state.customEntries.some(
				(entry) =>
					entry.type === "custom_message" &&
					entry.display === false &&
					entry.content.includes(applyInstruction),
			),
		`standalone Esc recovery: ${JSON.stringify({ phase: checkpoint?.phase, advisor: checkpoint?.history[1]?.advisor, titles: state.messages.map((item) => item.message.details?.title) })}`,
	);
}

async function standaloneReviewBlockedOnUserScenario() {
	writeReviewConfig(
		"autoFix",
		reviewCommand(["FAIL\n\n## 质检未通过\n\n## 发现 1\n- 问题: x\n"]),
	);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	await emitAll(
		events,
		"agent_end",
		{
			messages: [
				{
					role: "assistant",
					stopReason: "stop",
					content: [
						{
							type: "text",
							text: "分析完成。\nBLOCKED: 请在系统设置开启权限后重跑",
						},
					],
				},
			],
		},
		ctx,
	);
	const notice = state.notifications.find((item) =>
		item.includes("需要你操作"),
	);
	assert(
		notice?.includes("请在系统设置开启权限后重跑") &&
			notice.includes("完成后重新运行 /review") &&
			!notice.includes("网页报告"),
		state.notifications.join("\n"),
	);
	await waitFor(
		() => standaloneReportStatusUrl(state),
		state.statuses.join(" | "),
	);
}

async function standaloneReviewHardStopKeepsStatusReportScenario() {
	const command = captureReviewCommand(
		"FAIL\n\n## 质检未通过\n- 问题: hard stop\n",
	);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const loaded = await loadExtension(state);
	const ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	assert(
		latestReviewCheckpoint(state)?.phase === "awaiting_agent",
		JSON.stringify(latestReviewCheckpoint(state)),
	);
	state.customEntries.push({
		type: "message",
		id: "unreviewed-repair-turn",
		parentId: state.customEntries.at(-1)?.id ?? null,
		timestamp: "2026-07-14T09:00:00.000Z",
		message: { role: "user", content: "这条修复回合内容没有再次送检" },
	});
	await emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "aborted" }] },
		ctx,
	);

	const notice = state.notifications.find((item) =>
		item.includes("质检自动循环已停止"),
	);
	assertNoticeFormat(notice, "⚠️", "AI 中断或失败");
	assert(!notice.includes("网页报告"), notice);
	await waitFor(
		() => standaloneReportStatusUrl(state),
		state.statuses.join(" | "),
	);
	assert(latestReviewCheckpoint(state)?.phase === null);
	const report = readFileSync(
		join(
			state.cwd,
			".flow",
			"reviews",
			`${basename(state.sessionFile, ".jsonl")}.html`,
		),
		"utf8",
	);
	assert(!report.includes("这条修复回合内容没有再次送检"), report);
	const capturedArgs = readFileSync(`${command}.args`, "utf8");
	const evidenceMarker = "\n\n上下文证据：\n";
	const fedEvidence = capturedArgs
		.slice(capturedArgs.indexOf(evidenceMarker) + evidenceMarker.length)
		.split("\n---ARG---\n")[0];
	const displayedEvidence =
		/<pre data-context-evidence[^>]*>([\s\S]*?)<\/pre>/u.exec(report)?.[1];
	assert(
		displayedEvidence && decodeHtmlLiteral(displayedEvidence) === fedEvidence,
		"terminal report evidence diverged after an unreviewed repair turn",
	);
}

function failForeverCommand(output, toolPath) {
	const path = join(bin, `loop-${Math.random().toString(16).slice(2)}`);
	const events = toolPath
		? assistantProgressEvents(output, toolPath)
		: [JSON.parse(assistantJson(output))];
	writeFileSync(
		path,
		`#!/bin/sh\ncount_file='${path}.count'\ncount=$(cat "$count_file" 2>/dev/null || echo 0)\ncount=$((count + 1))\necho "$count" > "$count_file"\nprintf '%s' ${shellQuote(jsonEvents(events))}\n`,
		{ mode: 0o755 },
	);
	return path;
}

function runCount(command) {
	try {
		return Number(readFileSync(`${command}.count`, "utf8").trim());
	} catch {
		return 0;
	}
}

async function cancelledReviewDoesNotTriggerAiScenario() {
	writeReviewConfig("autoFix", script("sleep 30"));
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	const { piActivitySignal } = await import(
		`file://${join(srcOut, "shared/activity-signal.js")}`
	);
	const activitySignal = piActivitySignal();
	const active = waitForSignal(activitySignal, (value) => value.active);
	const running = commands.get("review").handler("", ctx);
	await active;
	assert(
		!renderWidgets(state, "review-progress").some((text) =>
			text.includes("思考中 · 0 calls"),
		),
		"standalone quality rendered a reviewer spinner before its first event",
	);
	assert(
		activitySignal.state.active === true,
		"review activity signal was not enabled",
	);
	const { cancelActiveFlowActivity } = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}`
	);
	cancelActiveFlowActivity();
	await running;
	assert(
		activitySignal.state.active === false,
		"review activity signal was not cleared",
	);
	const errorCards = state.messages.filter((entry) =>
		/质检错误|质检未完成/u.test(entry.message.details.title),
	);
	assert(
		errorCards.length === 0,
		`cancel sent error card: ${errorCards.length}`,
	);
	const cancelNotices = state.notifications.filter((item) =>
		item.includes("质检已取消"),
	);
	assert(
		cancelNotices.length === 1 && !cancelNotices[0].includes("网页报告"),
		state.notifications.join("\n"),
	);
	await waitFor(
		() => standaloneReportStatusUrl(state),
		state.statuses.join(" | "),
	);
	assert(state.sentMessages.length === 0, state.sentMessages.join("\n"));
}

async function cancelledReviewCheckpointFailureRemainsRecoverableScenario() {
	const command = interruptOnceReviewCommand(
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("manual", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	state.failReviewCheckpointClear = true;
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	const running = loaded.commands.get("review").handler("", ctx);
	await waitFor(
		() =>
			latestReviewCheckpoint(state)?.phase === "checking" &&
			reviewRunCount(command) === 1,
		"review never started after persisting its active checkpoint",
	);
	const { cancelActiveFlowActivity } = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}`
	);
	cancelActiveFlowActivity();
	await running;
	assert(
		latestReviewCheckpoint(state)?.phase === "checking",
		`failed cancellation discarded recovery state: ${JSON.stringify(latestReviewCheckpoint(state))}`,
	);
	assert(
		state.notifications.some((item) => item.includes("质检取消状态保存失败")),
		state.notifications.join("\n"),
	);
	assert(
		!state.notifications.some((item) => item.includes("质检已取消")),
		state.notifications.join("\n"),
	);

	state.failReviewCheckpointClear = false;
	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await waitFor(
		() => latestReviewCheckpoint(state)?.phase === null,
		"restart did not recover the uncleared review checkpoint",
	);
	assert(reviewRunCount(command) === 2, "cancelled reviewer was not recovered");
}

async function cancelledReviewCheckpointConflictPreservesNewOwnerScenario() {
	const command = interruptOnceReviewCommand(
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("manual", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	const loaded = await loadExtension(state);
	const ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	const running = loaded.commands.get("review").handler("", ctx);
	const checkpoint = await waitFor(
		() =>
			latestReviewCheckpoint(state)?.phase === "checking"
				? latestReviewCheckpoint(state)
				: undefined,
		"review never persisted its active checkpoint",
	);
	ctx.sessionManager.appendCustomEntry("review-checkpoint", {
		...checkpoint,
		active: { ...checkpoint.active, generation: "replacement-owner" },
	});
	const { cancelActiveFlowActivity } = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}`
	);
	cancelActiveFlowActivity();
	await running;
	assert(
		latestReviewCheckpoint(state)?.active?.generation === "replacement-owner",
		`cancellation overwrote the newer checkpoint: ${JSON.stringify(latestReviewCheckpoint(state))}`,
	);
	assert(
		state.notifications.some((item) => item.includes("质检取消状态已变化")),
		state.notifications.join("\n"),
	);
	assert(
		!state.notifications.some((item) =>
			/质检已取消|质检取消状态保存失败/u.test(item),
		),
		state.notifications.join("\n"),
	);
}

async function recoverableTransportErrorKeepsAutoLoopScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: transient\n",
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const runsBeforeTransportEnd = reviewRunCount(command);
	await emitAll(events, "agent_end", recoverableWebSocketEndEvent(), ctx);
	const runsAfterTransportEnd = reviewRunCount(command);
	assert(
		runsBeforeTransportEnd === 1 && runsAfterTransportEnd === 1,
		`transient websocket reran review: ${runsBeforeTransportEnd} -> ${runsAfterTransportEnd}`,
	);
	const retryNotice = state.notifications.find((item) =>
		item.includes("质检自动循环仍在等待"),
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
		state.messages.at(-1).message.details.title === "第 2 轮质检通过",
		state.messages.at(-1).message.details.title,
	);
}

async function piRetryableErrorKeepsAutoLoopScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: retryable\n",
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const runsBeforeRetryableEnd = reviewRunCount(command);
	await emitAll(events, "agent_end", piRetryableRateLimitEndEvent(), ctx);
	const runsAfterRetryableEnd = reviewRunCount(command);
	assert(
		runsBeforeRetryableEnd === 1 && runsAfterRetryableEnd === 1,
		`Pi retryable error reran review: ${runsBeforeRetryableEnd} -> ${runsAfterRetryableEnd}`,
	);
	const retryNotice = state.notifications.find((item) =>
		item.includes("质检自动循环仍在等待"),
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
		state.messages.at(-1).message.details.title === "第 2 轮质检通过",
		state.messages.at(-1).message.details.title,
	);
}

async function piRetryableErrorStopsAfterGuardScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: retry exhausted\n",
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
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
	const stoppedNotice = await waitFor(
		() =>
			state.notifications.find((item) => item.includes("质检自动循环已停止")),
		"retry exhaustion terminal notice missing",
	);
	assertNoticeFormat(stoppedNotice, "⚠️", "Pi 自动重试耗尽");
	assert(!stoppedNotice.includes("网页报告"), stoppedNotice);
	await waitFor(
		() => standaloneReportStatusUrl(state),
		state.statuses.join(" | "),
	);
	await emitAll(
		events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(reviewRunCount(command) === 1, "stopped review resumed after guard");
}

async function emptyReviewOutputRetriesScenario() {
	const command = reviewCommand([
		"",
		"",
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(card.message.details.title === "质检通过", card.message.details.title);
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
	const errorCard = state.messages.at(-1);
	assert(
		errorCard.message.content.includes(
			"review 输出为空：stdout 为空。无审查结论。",
		) && errorCard.message.content.includes("已尝试 3 次"),
		errorCard.message.content,
	);
	assert(
		!state.notifications.some((item) => item.includes("review 输出为空")),
		state.notifications.join("\n"),
	);
	assert(
		reviewRunCount(command) === 3,
		`unexpected retry count: ${reviewRunCount(command)}`,
	);
}

async function reviewRoundTimeUsesCurrentStepScenario() {
	writeReviewConfig(
		"autoFix",
		reviewCommand([
			"FAIL\n\n## 质检未通过\n- 问题: x\n",
			"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
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
			pass.message.details.title === "第 2 轮质检通过",
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
				item?.startsWith("💯 quality/第 2 轮质检 · 0s / 总 2m"),
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
			"FAIL\n\n## 质检未通过\n- 问题: first\n",
			"FAIL\n\n## 质检未通过\n- 问题: second\n",
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
		const failure = state.messages.find(
			(item) => item.message.details?.title === "第 2 轮质检未通过",
		);
		assert(failure, "round 2 failure card missing");
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
	writeReviewConfig(
		"autoFix",
		reviewCommand([
			"**PASS**\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
		]),
	);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(card.message.details.title === "质检通过", card.message.details.title);
}

async function unrejectedPassScenario() {
	writeReviewConfig(
		"autoFix",
		reviewCommand(["FAIL\n\n## 质检未通过\n- 问题: x\n"]),
	);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	await commands.get("review").handler("", ctx);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质检未通过",
		card.message.details.title,
	);
}

async function invalidReviewOutputStopsScenario() {
	writeReviewConfig("autoFix", reviewCommand(["未完成\n"]));
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	const attention = await attentionProbe();
	await commands.get("review").handler("", ctx);
	attention.unsubscribe();
	assert(
		attention.sources.join("|") === "pi-flow:review",
		`review error attention mismatch: ${attention.sources.join("|")}`,
	);
	assert(
		reviewErrorCard(state),
		"invalid review output did not send error card",
	);
	const card = state.messages.at(-1);
	assert(
		card.message.content.includes("review 输出格式无效") &&
			card.message.content.includes("未完成"),
		card.message.content,
	);
	assert(
		!card.message.details.lines.some((line) => line.includes("网页报告")),
		card.message.details.lines.join("\n"),
	);
	await waitFor(
		() => standaloneReportStatusUrl(state),
		state.statuses.join(" | "),
	);
	assert(
		!state.notifications.some((item) => item.includes("review 输出格式无效")),
		state.notifications.join("\n"),
	);
}

async function semiFailureScenario() {
	writeReviewConfig(
		"manual",
		reviewCommand(["FAIL\n\n## 质检未通过\n- 问题: x\n"]),
	);
	const state = createState();
	const { commands, events } = await loadExtension(state);
	const ctx = mockContext(state);
	await events.get("session_start")?.at(-1)?.({}, ctx);
	const attention = await attentionProbe();
	await commands.get("review").handler("", ctx);
	attention.unsubscribe();
	const { piActivitySignal } = await import(
		`file://${join(srcOut, "shared/activity-signal.js")}`
	);
	assert(
		piActivitySignal().state.active === false,
		"manual review stayed active",
	);
	assert(
		attention.sources.join("|") === "pi-flow:review",
		`manual review attention mismatch: ${attention.sources.join("|")}`,
	);
	assert(state.editorText.includes(applyInstruction), state.editorText);
	const card = state.messages.at(-1);
	assert(
		card.message.details.title === "质检未通过",
		card.message.details.title,
	);
	assert(card.message.content.startsWith("[质检未通过]"), card.message.content);
	assert(!card.message.content.includes("⏱ 用时"), card.message.content);
	assert(
		!card.message.details.lines.some((line) => line.includes("网页报告")),
		card.message.details.lines.join("\n"),
	);
	await waitFor(
		() => standaloneReportStatusUrl(state),
		state.statuses.join(" | "),
	);
	assert(!card.options.triggerTurn, JSON.stringify(card.options));
}

async function spawnRunnerStreamsLinesScenario() {
	const { runSpawnProcess } = await import(
		`file://${join(srcOut, "shared/spawn-runner.js")}?lines=${Date.now()}`
	);
	const command = script("printf 'one\\ntwo\\nthree'");
	const lines = [];
	const streamed = await runSpawnProcess({
		command,
		args: [],
		cwd: root,
		// 正常 shell 成功路径的护栏；并发全套下进程启动可能超过 1s。
		timeoutMs: 10_000,
		onLine: (line) => lines.push(line),
	});
	assert(streamed.kind === "close", JSON.stringify(streamed));
	assert(
		streamed.stdout === "",
		`streamed stdout accumulated: ${streamed.stdout}`,
	);
	assert(lines.join("|") === "one|two|three", lines.join("|"));
	const buffered = await runSpawnProcess({
		command,
		args: [],
		cwd: root,
		timeoutMs: 10_000,
	});
	assert(
		buffered.kind === "close" && buffered.stdout === "one\ntwo\nthree",
		JSON.stringify(buffered),
	);
}

async function spawnRunnerKillsProcessTreeScenario() {
	const { runSpawnProcess } = await import(
		`file://${join(srcOut, "shared/spawn-runner.js")}?tree=${Date.now()}`
	);
	for (const source of ["timeout", "abort"]) {
		const pidFile = join(out, `spawn-tree-${source}.pid`);
		const command = script(
			`sleep 10 & child=$!; printf '%s' "$child" > ${shellQuote(pidFile)}; wait "$child"`,
		);
		const controller = new AbortController();
		const startedAt = Date.now();
		const pending = runSpawnProcess({
			command,
			args: [],
			cwd: root,
			timeoutMs: source === "timeout" ? 3000 : 10_000,
			signal: controller.signal,
		});
		await waitFor(() => existsSync(pidFile), `${source} child pid missing`);
		if (source === "abort") controller.abort();
		const result = await pending;
		const childPid = Number(readFileSync(pidFile, "utf8"));
		try {
			await waitFor(
				() => !processExists(childPid),
				`${source} left descendant ${childPid} running`,
				2000,
			);
		} finally {
			if (processExists(childPid)) process.kill(childPid, "SIGKILL");
		}
		const expectedKind = source === "abort" ? "aborted" : "timeout";
		assert(result.kind === expectedKind, `${source} result: ${result.kind}`);
		assert(
			Date.now() - startedAt < 6000,
			`${source} process tree cleanup was too slow`,
		);
	}
}

function processExists(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function processScenario(name, command, timeoutMs, verify) {
	const { runReviewProcess } = await import(
		`file://${join(srcOut, "review.js")}?process=${name}-${Date.now()}`
	);
	const result = await runReviewProcess(
		{
			enabled: true,
			command,
			model: "test/x",
			thinking: "off",
			tools: [],
			excludeTools: ["write", "edit"],
			timeoutMs,
			openaiFast: false,
			extensions: [],
			mode: "autoFix",
		},
		"prompt",
		root,
	);
	verify(result);
}

async function multiReviewerFailureScenario() {
	const first = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	const second = reviewCommand(["FAIL\n\n## 质检未通过\n- 问题: second\n"]);
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
		card.message.details.title === "质检未通过",
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
				text.includes("💯 质检中") &&
				!text.includes("会话 ·") &&
				!text.includes("对象：当前任务交付") &&
				!text.includes("证据：首条用户需求 + 最近上下文 + 文件线索"),
		),
		renderedWidgets.join("\n---\n"),
	);
	assert(
		renderedWidgets.some((text) => text.includes("❌ second：second")),
		renderedWidgets.join("\n---\n"),
	);
	const displayLines = card.message.details.lines.join("\n");
	assert(displayLines.includes("⏱ 用时："), displayLines);
}

async function reviewCheckpointRejectsStaleGenerationScenario() {
	const { writeReviewCheckpoint } = await import(
		`file://${join(srcOut, "review/checkpoint.js")}?t=${Date.now()}`
	);
	const state = createState();
	const ctx = mockContext(state);
	const checkpoint = (generation) => ({
		active: {
			round: 1,
			generation,
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
		round: 1,
		phase: "checking",
		history: [],
		reportRun: 1,
	});
	// v3 严格 schema：额外字段 / 畸形 phase 不得被读成终态
	const { parseReviewCheckpointData } = await import(
		`file://${join(srcOut, "review/checkpoint.js")}?strict=${Date.now()}`
	);
	assert(
		parseReviewCheckpointData({
			version: 2,
			active: null,
			round: 1,
			phase: null,
			history: [],
			reportRun: 1,
		}) === undefined,
		"v2 checkpoint accepted",
	);
	assert(
		parseReviewCheckpointData({
			version: 3,
			active: "bad",
			round: -2.5,
			phase: "nope",
			history: [null],
			reportRun: 1,
			extra: true,
		}) === undefined,
		"malformed v3 checkpoint accepted",
	);
	assert(
		parseReviewCheckpointData({
			version: 3,
			active: null,
			round: 1,
			phase: "checking",
			history: [],
			reportRun: 1,
		}) === undefined,
		"checking without active accepted",
	);
	const activeRun = {
		round: 1,
		generation: "g1",
		runId: "run-1",
		inputHash: "input",
		models: [{ key: "reviewer", label: "reviewer", outcome: null }],
	};
	assert(
		parseReviewCheckpointData({
			version: 3,
			active: activeRun,
			round: 1,
			phase: "awaiting_agent",
			history: [],
			reportRun: 1,
		}) === undefined,
		"awaiting_agent with active accepted",
	);
	assert(
		parseReviewCheckpointData({
			version: 3,
			active: { ...activeRun, round: 2 },
			round: 1,
			phase: "checking",
			history: [],
			reportRun: 1,
		}) === undefined,
		"checking round mismatch accepted",
	);
	assert(
		parseReviewCheckpointData({
			version: 3,
			active: { ...activeRun, round: 0 },
			round: 0,
			phase: "checking",
			history: [],
			reportRun: 1,
		}) === undefined,
		"checking round zero accepted",
	);
	// 合法：round:0 武装态 / checking 对齐 round
	assert(
		parseReviewCheckpointData({
			version: 3,
			active: null,
			round: 0,
			phase: "awaiting_agent",
			history: [],
			reportRun: 1,
		})?.phase === "awaiting_agent",
		"armed awaiting_agent rejected",
	);
	assert(
		parseReviewCheckpointData({
			version: 3,
			active: activeRun,
			round: 1,
			phase: "checking",
			history: [],
			reportRun: 1,
		})?.phase === "checking",
		"valid checking rejected",
	);
	writeReviewCheckpoint(mockPi(state), ctx, checkpoint("first"), null);
	writeReviewCheckpoint(mockPi(state), ctx, checkpoint("second"), "first");
	let rejected = false;
	try {
		writeReviewCheckpoint(mockPi(state), ctx, checkpoint("stale"), "first");
	} catch {
		rejected = true;
	}
	assert(rejected, "stale review checkpoint generation was accepted");
}

async function reviewReportRunLifecycleScenario() {
	const {
		nextReviewReportRun,
		readReviewCheckpoint,
		reviewReportPublication,
		writeReviewCheckpoint,
	} = await import(
		`file://${join(srcOut, "review/checkpoint.js")}?t=${Date.now()}`
	);
	const state = createState();
	const ctx = mockContext(state);
	const firstRun = nextReviewReportRun(undefined);
	writeReviewCheckpoint(
		mockPi(state),
		ctx,
		{
			active: null,
			round: 0,
			phase: "awaiting_agent",
			history: [],
			reportRun: firstRun,
		},
		null,
	);
	const armed = readReviewCheckpoint(ctx);
	assert(armed?.reportRun === firstRun, JSON.stringify(armed));
	assert(
		reviewReportPublication(armed).state === "live",
		JSON.stringify(reviewReportPublication(armed)),
	);
	// 中断恢复复用同一 reportRun
	writeReviewCheckpoint(
		mockPi(state),
		ctx,
		{
			active: {
				round: 1,
				generation: "g1",
				runId: "run",
				inputHash: "h",
				models: [{ key: "r", label: "r", outcome: null }],
			},
			round: 1,
			phase: "checking",
			history: [],
			reportRun: firstRun,
		},
		null,
	);
	assert(readReviewCheckpoint(ctx)?.reportRun === firstRun);
	// 终态 complete
	writeReviewCheckpoint(
		mockPi(state),
		ctx,
		{
			active: null,
			round: 1,
			phase: null,
			history: [{ round: 1, result: "passed", summary: "ok" }],
			reportRun: firstRun,
		},
		"g1",
	);
	const terminal = readReviewCheckpoint(ctx);
	assert(
		reviewReportPublication(terminal).state === "complete",
		JSON.stringify(terminal),
	);
	// 第二轮必须递增
	const secondRun = nextReviewReportRun(terminal.reportRun);
	assert(secondRun > firstRun, `${secondRun} <= ${firstRun}`);
	writeReviewCheckpoint(
		mockPi(state),
		ctx,
		{
			active: null,
			round: 0,
			phase: "awaiting_agent",
			history: [],
			reportRun: secondRun,
		},
		null,
	);
	assert(readReviewCheckpoint(ctx)?.reportRun === secondRun);

	// 真实 client→daemon 账本：第一轮 live → complete，第二轮更高 generation 重进 Live
	const client = await import(
		`file://${join(srcOut, "shared/report-client.js")}?review-dir=${Date.now()}`
	);
	await client.closeReportClient().catch(() => undefined);
	const reportPath = join(
		state.cwd,
		".flow",
		"reviews",
		"review-lifecycle.html",
	);
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, "<!doctype html><p>review-lifecycle</p>");
	const reportCtx = {
		cwd: state.cwd,
		ui: { setStatus() {}, notify() {} },
	};
	await client.liveReportUrl(
		reportCtx,
		reportPath,
		"zh",
		reviewReportPublication({
			active: { round: 1 },
			phase: "checking",
			reportRun: firstRun,
		}),
	);
	await client.waitForReportClientIdle();
	assert(
		reviewDirectoryRecord(reportPath)?.state === "live" &&
			reviewDirectoryRecord(reportPath)?.generation === firstRun,
		JSON.stringify(reviewDirectoryRecord(reportPath)),
	);
	await client.liveReportUrl(
		reportCtx,
		reportPath,
		"zh",
		reviewReportPublication({
			active: null,
			phase: null,
			reportRun: firstRun,
		}),
	);
	await client.waitForReportClientIdle();
	assert(
		reviewDirectoryRecord(reportPath)?.state === "complete",
		JSON.stringify(reviewDirectoryRecord(reportPath)),
	);
	await client.liveReportUrl(
		reportCtx,
		reportPath,
		"zh",
		reviewReportPublication({
			active: null,
			phase: "awaiting_agent",
			reportRun: secondRun,
		}),
	);
	await client.waitForReportClientIdle();
	assert(
		reviewDirectoryRecord(reportPath)?.state === "live" &&
			reviewDirectoryRecord(reportPath)?.generation === secondRun,
		JSON.stringify(reviewDirectoryRecord(reportPath)),
	);
	let staleRejected = false;
	try {
		await client.liveReportUrl(reportCtx, reportPath, "zh", {
			state: "live",
			generation: firstRun,
		});
	} catch (error) {
		staleRejected = /conflict|409/iu.test(String(error?.message ?? error));
	}
	assert(staleRejected, "review stale generation did not conflict");
	// 多路径注册 settle 后 registerChains 不得残留
	const extraPath = join(
		state.cwd,
		".flow",
		"reviews",
		"review-lifecycle-extra.html",
	);
	writeFileSync(extraPath, "<!doctype html><p>extra</p>");
	await client.liveReportUrl(reportCtx, extraPath, "zh", {
		state: "live",
		generation: secondRun + 1,
	});
	await client.waitForReportClientIdle();
	assert(
		client.reportClientResourceSnapshot().registerChains === 0,
		`registerChains leaked after idle: ${JSON.stringify(client.reportClientResourceSnapshot())}`,
	);
	await client.closeReportClient().catch(() => undefined);
	assert(
		client.reportClientResourceSnapshot().registerChains === 0 &&
			client.reportClientResourceSnapshot().registeredReports === 0,
		`registerChains leaked after close: ${JSON.stringify(client.reportClientResourceSnapshot())}`,
	);
}

async function waitForReviewDirectoryRecord(
	htmlPath,
	match,
	message,
	timeoutMs = 5_000,
) {
	const deadline = Date.now() + timeoutMs;
	let last;
	while (Date.now() < deadline) {
		last = reviewDirectoryRecord(htmlPath);
		if (match(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`${message}: ${JSON.stringify(last)}`);
}

function reviewDirectoryRecord(htmlPath) {
	const ledgerPath = join(
		process.env.PI_CODING_AGENT_DIR,
		"pi-flow-report",
		"directory.json",
	);
	const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
	const absolute = resolve(htmlPath);
	return ledger.records.find(
		(record) => record.path === absolute || record.realPath === absolute,
	);
}

async function interruptedReviewerPoolResumesMissingModelScenario() {
	const passed = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	const interrupted = interruptOnceReviewCommand(
		"PASS\n恢复 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("autoFix", passed, [
		{ model: "test/passed", thinking: "off", command: passed },
		{ model: "test/interrupted", thinking: "off", command: interrupted },
	]);
	const state = createState();
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	const firstRun = loaded.commands.get("review").handler("", ctx);
	await waitFor(
		() =>
			state.customEntries.some(
				(entry) =>
					entry.customType === "review-checkpoint" &&
					entry.data?.active?.models?.[0]?.outcome &&
					entry.data.active.models[1]?.outcome === null,
			) && reviewRunCount(interrupted) === 1,
		"completed reviewer was not checkpointed before interruption",
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);
	await firstRun;
	assert(reviewRunCount(passed) === 1, "passed reviewer did not run once");

	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	assert(
		reviewRunCount(passed) === 1,
		`completed reviewer reran: ${reviewRunCount(passed)}`,
	);
	assert(
		reviewRunCount(interrupted) === 2,
		`unfinished reviewer count: ${reviewRunCount(interrupted)}`,
	);
	assert(
		state.customEntries.filter(
			(entry) =>
				entry.type === "custom_message" &&
				entry.customType === "pi-flow-result-card" &&
				entry.details?.title === "质检中",
		).length === 2,
		"resume did not record both quality start cards",
	);
	assert(
		state.messages.at(-1).message.details.title === "质检通过",
		state.messages.at(-1).message.details.title,
	);
}

async function userInputInvalidatesReviewerCheckpointScenario() {
	const passed = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
		"PASS\n新需求 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	const interrupted = interruptOnceReviewCommand(
		"PASS\n恢复 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("autoFix", passed, [
		{ model: "test/passed", thinking: "off", command: passed },
		{ model: "test/interrupted", thinking: "off", command: interrupted },
	]);
	const state = createState();
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	const firstRun = loaded.commands.get("review").handler("", ctx);
	await waitFor(
		() =>
			state.customEntries.some(
				(entry) =>
					entry.customType === "review-checkpoint" &&
					entry.data?.active?.models?.[0]?.outcome &&
					entry.data.active.models[1]?.outcome === null,
			) && reviewRunCount(interrupted) === 1,
		"completed reviewer was not checkpointed before user input",
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);
	await firstRun;
	state.customEntries.push({
		type: "message",
		id: "new-user-input",
		parentId: state.customEntries.at(-1)?.id ?? null,
		timestamp: new Date().toISOString(),
		message: {
			role: "user",
			content: [{ type: "text", text: "请同时覆盖新增需求" }],
			timestamp: Date.now(),
		},
	});

	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	assert(
		reviewRunCount(passed) === 2,
		`user input did not invalidate completed reviewer: ${reviewRunCount(passed)}`,
	);
	assert(
		reviewRunCount(interrupted) === 2,
		`unfinished reviewer count after user input: ${reviewRunCount(interrupted)}`,
	);
}

async function standaloneReviewRepairResumesAfterRestartScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: first\n",
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	assert(
		state.messages.at(-1).message.details.title === "质检未通过",
		state.messages.at(-1).message.details.title,
	);
	const checkpoints = state.customEntries.filter(
		(entry) => entry.customType === "review-checkpoint",
	);
	assert(
		checkpoints.at(-1)?.data?.phase === "awaiting_agent",
		`failed round did not settle into awaiting_agent atomically: ${JSON.stringify(checkpoints.at(-1)?.data)}`,
	);
	assert(
		!checkpoints.some(
			(entry) => entry.data?.active === null && entry.data?.phase === null,
		),
		"fail→awaiting transition leaked a terminal-looking checkpoint",
	);
	const interruptedRun = checkpoints.at(-1)?.data?.reportRun;
	assert(
		typeof interruptedRun === "number" && interruptedRun > 0,
		`missing reportRun before restart: ${JSON.stringify(checkpoints.at(-1)?.data)}`,
	);
	const repairReportPath = join(
		state.cwd,
		".flow",
		"reviews",
		`${basename(state.sessionFile, ".jsonl")}.html`,
	);
	await waitForReviewDirectoryRecord(
		repairReportPath,
		(item) => item?.state === "live" && item.generation === interruptedRun,
		"awaiting_agent review was not Live before restart",
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	const restoredRun = latestReviewCheckpoint(state)?.reportRun;
	assert(
		restoredRun === interruptedRun,
		`restart changed reportRun: ${restoredRun} vs ${interruptedRun}`,
	);
	await waitForReviewDirectoryRecord(
		repairReportPath,
		(item) => item?.state === "live" && item.generation === interruptedRun,
		"restart did not keep Live with same reportRun",
	);
	const interruptedBox = renderWidgets(state, "review-progress")
		.filter((text) => text.includes("已中断"))
		.at(-1);
	assert(
		interruptedBox?.includes("第 1 轮修复待继续"),
		`interrupted review box missing: ${interruptedBox}`,
	);
	await emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		reviewRunCount(command) === 2,
		`repair resume did not run the next round: ${reviewRunCount(command)}`,
	);
	assert(
		state.messages.at(-1).message.details.title.includes("质检通过"),
		state.messages.at(-1).message.details.title,
	);
	// 重启恢复不丢历史：最终 durable 历史同时含首轮 FAIL 与恢复后的 PASS。
	const finalHistory = latestReviewCheckpoint(state)?.history ?? [];
	assert(
		finalHistory.length === 2 &&
			finalHistory[0]?.result === "failed" &&
			finalHistory[1]?.result === "passed",
		`restart lost review history: ${JSON.stringify(finalHistory)}`,
	);
}

async function standaloneReviewDeliveryFailureRetriesAfterRestartScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: delivery retry\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	state.failResultCardTitle = "质检未通过";
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	let checkpoint = state.customEntries
		.filter((entry) => entry.customType === "review-checkpoint")
		.at(-1)?.data;
	assert(
		checkpoint?.phase === "checking" &&
			checkpoint.active?.models?.[0]?.outcome?.result === "failed",
		`delivery failure discarded the completed check: ${JSON.stringify(checkpoint)}`,
	);
	assert(
		reviewRunCount(command) === 1,
		`unexpected reviewer runs before delivery retry: ${reviewRunCount(command)}`,
	);
	assert(
		!state.messages.some(
			(entry) => entry.message.details?.title === "质检未通过",
		),
		"failed delivery was recorded as sent",
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	state.failResultCardTitle = undefined;
	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await waitFor(
		() =>
			state.messages.some(
				(entry) => entry.message.details?.title === "质检未通过",
			),
		"restart did not redeliver the quality feedback",
	);
	checkpoint = state.customEntries
		.filter((entry) => entry.customType === "review-checkpoint")
		.at(-1)?.data;
	assert(
		checkpoint?.phase === "awaiting_agent" && checkpoint.active === null,
		`redelivery did not commit awaiting_agent: ${JSON.stringify(checkpoint)}`,
	);
	assert(
		reviewRunCount(command) === 1,
		`completed reviewer reran during delivery retry: ${reviewRunCount(command)}`,
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);
}

async function standaloneReviewPassDeliveryFailureRetriesAfterRestartScenario() {
	const command = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	state.failResultCardTitle = "质检通过";
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	let checkpoint = state.customEntries
		.filter((entry) => entry.customType === "review-checkpoint")
		.at(-1)?.data;
	assert(
		checkpoint?.phase === "checking" &&
			checkpoint.active?.models?.[0]?.outcome?.result === "passed",
		`pass delivery failure discarded the completed check: ${JSON.stringify(checkpoint)}`,
	);
	assert(
		reviewRunCount(command) === 1,
		`unexpected reviewer runs before pass delivery retry: ${reviewRunCount(command)}`,
	);
	assert(
		!state.messages.some(
			(entry) => entry.message.details?.title === "质检通过",
		),
		"failed pass delivery was recorded as sent",
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	state.failResultCardTitle = undefined;
	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await waitFor(
		() =>
			state.messages.some(
				(entry) => entry.message.details?.title === "质检通过",
			),
		"restart did not redeliver the quality pass card",
	);
	checkpoint = state.customEntries
		.filter((entry) => entry.customType === "review-checkpoint")
		.at(-1)?.data;
	assert(
		checkpoint?.phase === null && checkpoint.active === null,
		`pass redelivery did not clear the checkpoint: ${JSON.stringify(checkpoint)}`,
	);
	assert(
		reviewRunCount(command) === 1,
		`completed reviewer reran during pass delivery retry: ${reviewRunCount(command)}`,
	);
	assert(
		state.messages.filter(
			(entry) => entry.message.details?.title === "质检通过",
		).length === 1,
		"pass card delivered more than once",
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);
}

async function standaloneReviewPassCheckpointWriteFailureDefersScenario() {
	const command = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	// 注入：PASS 卡投递成功后，终态 checkpoint 写入（active/phase 清空）失败。
	state.failReviewCheckpointClear = true;
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	assert(
		state.messages.filter(
			(entry) => entry.message.details?.title === "质检通过",
		).length === 1,
		"pass card was not delivered before checkpoint failure",
	);
	assert(
		!state.messages.some((entry) =>
			(entry.message.details?.title ?? "").includes("质检未完成"),
		),
		"checkpoint write failure emitted a system error card",
	);
	assert(
		state.notifications.some((item) => item.includes("质检状态保存失败")),
		state.notifications.join("\n"),
	);
	const checkpoint = latestReviewCheckpoint(state);
	assert(
		checkpoint?.phase === "checking" &&
			checkpoint.active?.models?.[0]?.outcome?.result === "passed",
		`checkpoint failure discarded recovery state: ${JSON.stringify(checkpoint)}`,
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	state.failReviewCheckpointClear = false;
	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await waitFor(
		() => latestReviewCheckpoint(state)?.phase === null,
		"restart did not converge the deferred pass checkpoint",
	);
	assert(
		reviewRunCount(command) === 1,
		`completed reviewer reran after checkpoint failure: ${reviewRunCount(command)}`,
	);
	assert(
		state.messages.filter(
			(entry) => entry.message.details?.title === "质检通过",
		).length === 1,
		"pass card was redelivered after recovery",
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);
}

async function standaloneReviewPostDeliveryCrashConvergesScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: post delivery crash\n",
	]);
	const original = proxyCommand(command);
	const added = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: added reviewer\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/original", thinking: "off", command: original },
	]);
	const state = createState();
	state.failAfterResultCardTitle = "质检未通过";
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	let checkpoint = latestReviewCheckpoint(state);
	assert(
		checkpoint?.phase === "checking" && checkpoint.active,
		`post-delivery crash lost active checkpoint: ${JSON.stringify(checkpoint)}`,
	);
	assert(
		reviewFailureCardCount(state) === 1,
		"feedback was not delivered once",
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	state.failAfterResultCardTitle = undefined;
	writeReviewConfig("autoFix", command, [
		{ model: "test/original", thinking: "off", command: original },
		{ model: "test/added", thinking: "off", command: added },
	]);
	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await waitFor(
		() => latestReviewCheckpoint(state)?.phase === "awaiting_agent",
		"restart did not commit the durable delivery receipt",
	);
	checkpoint = latestReviewCheckpoint(state);
	assert(checkpoint.active === null, JSON.stringify(checkpoint));
	assert(
		reviewRunCount(command) === 1 && reviewRunCount(added) === 1,
		"reviewer-set recovery did not reuse only unchanged outcomes",
	);
	const cards = state.messages.filter(
		(entry) => entry.message.details?.title === "质检未通过",
	);
	assert(
		cards.length === 2,
		`updated feedback was suppressed: ${cards.length}`,
	);
	assert(
		cards[0].message.details.deliveryId !==
			cards[1].message.details.deliveryId &&
			cards[1].message.content.includes("added reviewer"),
		"updated reviewer feedback reused the stale receipt",
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);
}

async function manualReviewDeliveryFailureRetriesAfterRestartScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: manual delivery\n",
	]);
	writeReviewConfig("manual", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	state.failResultCardTitle = "质检未通过";
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	assert(
		latestReviewCheckpoint(state)?.phase === "checking",
		`manual delivery failure cleared checkpoint: ${JSON.stringify(latestReviewCheckpoint(state))}`,
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	state.failResultCardTitle = undefined;
	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await waitFor(() => {
		const checkpoint = latestReviewCheckpoint(state);
		return checkpoint?.phase === null && checkpoint.active === null;
	}, "manual restart did not redeliver feedback");
	assert(reviewRunCount(command) === 1, "manual recovery reran reviewer");
	assert(reviewFailureCardCount(state) === 1, "manual feedback duplicated");
	assert(state.editorText.includes(applyInstruction), state.editorText);
}

async function consecutiveManualReviewsUseDistinctReceiptsScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: same input\n",
		"FAIL\n\n## 质检未通过\n- 问题: same input\n",
	]);
	writeReviewConfig("manual", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	const loaded = await loadExtension(state);
	const ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	await loaded.commands.get("review").handler("", ctx);
	const cards = state.messages.filter(
		(entry) => entry.message.details?.title === "质检未通过",
	);
	assert(cards.length === 2, `manual receipt collision: ${cards.length}`);
	assert(
		cards[0].message.details.deliveryId !== cards[1].message.details.deliveryId,
		`manual reviews reused receipt: ${cards[0].message.details.deliveryId}`,
	);
	assert(reviewRunCount(command) === 2, "second manual review was skipped");
}

function standaloneReportStatusUrl(state) {
	const status = [...state.statuses]
		.reverse()
		.find((item) => item?.startsWith("🌐 网页报告: http://127.0.0.1:"));
	return status?.slice(status.indexOf("http"));
}

function assertNoStandaloneReportLines(state) {
	const cardLines = state.messages.flatMap(
		(entry) => entry.message.details?.lines ?? [],
	);
	assert(
		![...cardLines, ...state.notifications].some((line) =>
			line.includes("网页报告"),
		),
		[...cardLines, ...state.notifications].join("\n"),
	);
}

function decodeHtmlLiteral(value) {
	return value
		.replaceAll("&quot;", '"')
		.replaceAll("&gt;", ">")
		.replaceAll("&lt;", "<")
		.replaceAll("&amp;", "&");
}

function latestReviewCheckpoint(state) {
	return state.customEntries
		.filter((entry) => entry.customType === "review-checkpoint")
		.at(-1)?.data;
}

function reviewFailureCardCount(state) {
	return state.messages.filter(
		(entry) => entry.message.details?.title === "质检未通过",
	).length;
}

async function standaloneReviewMidLoopConfigErrorStopsScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: mid-loop config\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	const loaded = await loadExtension(state);
	const ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	assert(
		state.messages.at(-1).message.details.title === "质检未通过",
		state.messages.at(-1).message.details.title,
	);
	// 修复回合期间直接写入非法配置（不重启、不取消）。
	writeFileSync(join(out, "config.json"), "{");
	await emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	const notice = state.notifications.find((item) =>
		item.includes("质检配置读取失败"),
	);
	assert(
		notice && !notice.includes("网页报告"),
		state.notifications.join("\n"),
	);
	await waitFor(
		() => standaloneReportStatusUrl(state),
		state.statuses.join(" | "),
	);
	assert(
		reviewRunCount(command) === 1,
		`stale reviewer ran after config became invalid: ${reviewRunCount(command)}`,
	);
	assert(
		state.messages.filter((entry) => entry.message.details?.title === "质检中")
			.length === 1,
		"invalid mid-loop config emitted a second quality start card",
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);
	writeReviewConfig(
		"manual",
		reviewCommand(["PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n"]),
	);
}

async function awaitingAgentRestartWithInvalidConfigRecoversScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: restart config\n",
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	// 重启时配置已损坏：显式报错，保留 checkpoint，不静默丢弃。
	writeFileSync(join(out, "config.json"), "{");
	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	assert(
		state.notifications.some((item) => item.includes("质检配置读取失败")),
		state.notifications.join("\n"),
	);
	assert(
		latestReviewCheckpoint(state)?.phase === "awaiting_agent",
		`invalid config discarded the checkpoint: ${JSON.stringify(latestReviewCheckpoint(state))}`,
	);
	// 配置修复后，下一次 agent_end 幂等重建循环并直接续跑下一轮。
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	await emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	assert(
		reviewRunCount(command) === 2,
		`recovered loop did not run the next round: ${reviewRunCount(command)}`,
	);
	assert(
		state.messages.at(-1).message.details.title.includes("质检通过"),
		state.messages.at(-1).message.details.title,
	);
	const history = latestReviewCheckpoint(state)?.history ?? [];
	assert(
		history.length === 2 &&
			history[0]?.result === "failed" &&
			history[1]?.result === "passed",
		`recovery lost review history: ${JSON.stringify(history)}`,
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);
}

async function awaitingAgentRestartWithDisabledConfigDiscardsScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: restart disabled\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	writeFileSync(
		join(out, "config.json"),
		JSON.stringify({
			language: "zh",
			background: { command, extensions: [] },
			checks: {
				tools: [],
				timeoutMinutes: 1 / 6,
				openaiFast: false,
			},
			modelRoles: {
				reviewers: [{ model: "test/x", thinking: "off" }],
			},
			quality: { enabled: false, mode: "autoFix", runAfterCompletion: true },
		}),
	);
	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	assert(
		state.notifications.some((item) => item.includes("质检已在配置中停用")),
		state.notifications.join("\n"),
	);
	const checkpoint = latestReviewCheckpoint(state);
	assert(
		checkpoint?.phase === null && checkpoint.active === null,
		`disabled config left a live checkpoint: ${JSON.stringify(checkpoint)}`,
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);
	writeReviewConfig(
		"manual",
		reviewCommand(["PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n"]),
	);
}

async function awaitingAgentRestartWithManualModeDiscardsScenario() {
	const command = reviewCommand([
		"FAIL\n\n## 质检未通过\n- 问题: restart mode\n",
	]);
	writeReviewConfig("autoFix", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	const state = createState();
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	await loaded.commands.get("review").handler("", ctx);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);

	writeReviewConfig("manual", command, [
		{ model: "test/only", thinking: "off", command },
	]);
	loaded = await loadExtension(state);
	ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	assert(
		state.notifications.some((item) => item.includes("质检模式已在配置中切换")),
		state.notifications.join("\n"),
	);
	const checkpoint = latestReviewCheckpoint(state);
	assert(
		checkpoint?.phase === null && checkpoint.active === null,
		`mode switch left a live checkpoint: ${JSON.stringify(checkpoint)}`,
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);
}

async function standaloneReviewCheckResumeWaitsForIdleScenario() {
	const passed = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
	const interrupted = interruptOnceReviewCommand(
		"PASS\n恢复 OK\n证据：文件=src/app.ts；命令=npm test\n",
	);
	writeReviewConfig("autoFix", passed, [
		{ model: "test/passed", thinking: "off", command: passed },
		{ model: "test/interrupted", thinking: "off", command: interrupted },
	]);
	const state = createState();
	let loaded = await loadExtension(state);
	let ctx = mockContext(state);
	await emitAll(loaded.events, "session_start", {}, ctx);
	const firstRun = loaded.commands.get("review").handler("", ctx);
	await waitFor(
		() =>
			state.customEntries.some(
				(entry) =>
					entry.customType === "review-checkpoint" &&
					entry.data?.active?.models?.[0]?.outcome &&
					entry.data.active.models[1]?.outcome === null,
			) && reviewRunCount(interrupted) === 1,
		"completed reviewer was not checkpointed before busy restart",
	);
	await emitAll(loaded.events, "session_shutdown", {}, ctx);
	await firstRun;

	loaded = await loadExtension(state);
	ctx = mockContext(state);
	let idle = false;
	ctx.isIdle = () => idle;
	await emitAll(loaded.events, "session_start", {}, ctx);
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
	assert(
		reviewRunCount(interrupted) === 1,
		`busy restart still resumed the check: ${reviewRunCount(interrupted)}`,
	);
	assert(
		renderWidgets(state, "review-progress").some((text) =>
			text.includes("已中断"),
		),
		"busy restart did not show the interrupted check box",
	);
	idle = true;
	await emitAll(
		loaded.events,
		"agent_end",
		{ messages: [{ role: "assistant", stopReason: "stop" }] },
		ctx,
	);
	await waitFor(
		() =>
			reviewRunCount(interrupted) === 2 &&
			(state.messages.at(-1)?.message.details?.title ?? "").includes(
				"质检通过",
			),
		`idle agent_end did not resume the interrupted check: ${reviewRunCount(interrupted)}`,
	);
	assert(
		reviewRunCount(passed) === 1,
		`completed reviewer reran after idle resume: ${reviewRunCount(passed)}`,
	);
}

async function reviewCancelSourcePriorityScenario() {
	const { cancelReview } = await import(
		`file://${join(srcOut, "review/view.js")}?t=${Date.now()}`
	);
	const userFirst = {
		cancellationSource: undefined,
		controller: new AbortController(),
		options: {},
	};
	cancelReview(userFirst);
	cancelReview(userFirst, "shutdown");
	assert(
		userFirst.cancellationSource === "user",
		`user cancel was overwritten by shutdown: ${userFirst.cancellationSource}`,
	);
	const passiveFirst = {
		cancellationSource: undefined,
		controller: new AbortController(),
		options: {},
	};
	cancelReview(passiveFirst, "shutdown");
	assert(
		passiveFirst.cancellationSource === "shutdown",
		`passive cancel source lost: ${passiveFirst.cancellationSource}`,
	);
}

async function mixedReviewerFailureAndErrorScenario() {
	const failed = reviewCommand(["FAIL\n\n## 质检未通过\n- 问题: mixed\n"]);
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
		card.message.details.title === "质检未通过",
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
		state.messages.at(-1).message.content.includes("已尝试 3 次"),
		state.messages.at(-1).message.content,
	);
	assert(
		!state.notifications.some((item) => item.includes("已尝试 3 次")),
		state.notifications.join("\n"),
	);
}

async function passAndFormatInvalidReviewerPassesScenario() {
	const passed = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
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
	assert(card.message.details.title === "质检通过", card.message.details.title);
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

async function cancelNotificationCopyScenario() {
	const { cancelNotification } = await import(
		`file://${join(srcOut, "review", "view.js")}?cancel=${Date.now()}`
	);
	const reviewMessage = cancelNotification({ options: {} });
	assertNoticeMessageFormat(reviewMessage, "⏸", "已按你的操作停止");
	const englishMessage = cancelNotification({
		options: { scope: { kind: "review", language: "en" } },
	});
	assertNoticeMessageFormat(englishMessage, "⏸", "Stopped by user");
}

async function passAndErrorReviewerStopsScenario() {
	const passed = reviewCommand([
		"PASS\n质量 OK\n证据：文件=src/app.ts；命令=npm test\n",
	]);
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
	const card = state.messages.at(-1);
	assert(
		card.message.content.includes("模型 2 · missing"),
		card.message.content,
	);
	// bash exec-ENOENT: macOS bash 3.x → 126, Ubuntu bash 5.x → 127; both print "No such file or directory"
	assert(
		/Review failed with exit 12[67]/.test(card.message.content) &&
			card.message.content.includes("No such file or directory"),
		card.message.content,
	);
	assert(state.notifications.length === 0, state.notifications.join("\n"));
}

function writeReviewConfig(mode, command, models = undefined, enabled = true) {
	const reviewers = models ?? [{ model: "test/x", thinking: "off" }];
	writeFileSync(
		join(out, "config.json"),
		JSON.stringify({
			language: "zh",
			background: {
				command: routedDiagnosticCommand(command, reviewers),
				extensions: [],
			},
			checks: {
				tools: ["read", "grep", "find", "ls", "bash"],
				timeoutMinutes: 1 / 6,
				openaiFast: false,
			},
			modelRoles: {
				reviewers: reviewers.map(({ model, thinking }) => ({
					model,
					thinking,
				})),
			},
			quality: {
				enabled,
				mode: qualityMode(mode),
				runAfterCompletion: true,
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

function qualityMode(mode) {
	return mode;
}

function proxyCommand(command) {
	return script(`exec '${command.replaceAll("'", "'\\''")}' "$@"`);
}

function reviewCommand(outputs) {
	const path = join(bin, `review-${Math.random().toString(16).slice(2)}`);
	const files = outputs.map((output, index) => {
		const outputFile = `${path}.${index}.out`;
		writeFileSync(outputFile, assistantJson(output));
		return outputFile;
	});
	writeFileSync(
		path,
		`#!/bin/sh\ncount_file='${path}.count'\ncount=$(cat "$count_file" 2>/dev/null || echo 0)\ncount=$((count + 1))\necho "$count" > "$count_file"\ncase "$count" in\n${files.map((file, index) => `${index + 1}) cat '${file}' ;;`).join("\n")}\n*) exit 9 ;;\nesac\n`,
		{ mode: 0o755 },
	);
	return path;
}

function interruptOnceReviewCommand(output) {
	const path = join(
		bin,
		`interrupt-review-${Math.random().toString(16).slice(2)}`,
	);
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

function captureReviewCommand(output) {
	const path = join(
		bin,
		`capture-review-${Math.random().toString(16).slice(2)}`,
	);
	writeFileSync(
		path,
		`#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n  printf '%s\n---ARG---\n' "$1"\n  shift\ndone > '${path}.args'\nprintf '%s' ${shellQuote(assistantJson(output))}\n`,
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

function script(body) {
	const path = join(bin, `script-${Math.random().toString(16).slice(2)}`);
	writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
	return path;
}

function reviewRunCount(command) {
	return existsSync(`${command}.count`)
		? Number(readFileSync(`${command}.count`, "utf8").trim())
		: 0;
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

async function loadBootstrapExtension() {
	const module = await import(
		`file://${join(srcOut, "index.js")}?bootstrap=${Date.now()}-${Math.random()}`
	);
	const commands = new Map();
	const events = new Map();
	module.default({
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerShortcut() {},
		registerMessageRenderer() {},
		on(name, handler) {
			if (!events.has(name)) events.set(name, []);
			events.get(name).push(handler);
		},
	});
	scenarioEvents = events;
	return { commands, events };
}

async function loadExtension(state) {
	const module = await import(
		`file://${join(srcOut, "review.js")}?t=${Date.now()}-${Math.random()}`
	);
	const reviewExtension = module.default;
	const commands = new Map();
	const events = new Map();
	const rawAgentEndHandlers = [];
	reviewExtension({
		registerCommand(name, command) {
			commands.set(name, command);
		},
		registerMessageRenderer() {},
		sendMessage(message, options = {}) {
			if (
				state.failResultCardTitle &&
				message.details?.title === state.failResultCardTitle
			)
				throw new Error("injected result card delivery failure");
			state.messages.push({ message, options });
			state.customEntries.push({
				type: "custom_message",
				id: `message-${state.customEntries.length + 1}`,
				parentId: state.customEntries.at(-1)?.id ?? null,
				timestamp: new Date().toISOString(),
				customType: message.customType,
				content: message.content,
				display: message.display,
				details: message.details,
			});
			if (
				state.failAfterResultCardTitle &&
				message.details?.title === state.failAfterResultCardTitle
			)
				throw new Error("injected post-delivery failure");
		},
		sendUserMessage(message, options = {}) {
			if (state.failUserMessage) throw new Error(state.failUserMessage);
			state.sentMessages.push({ message, options });
		},
		on(name, handler) {
			if (!events.has(name)) events.set(name, []);
			if (name !== "agent_end") return events.get(name).push(handler);
			rawAgentEndHandlers.push(handler);
			events.get(name).push(async (...args) => {
				await handler(...args);
				await module.waitForScheduledReviewAgentEnd();
			});
		},
	});
	scenarioEvents = events;
	return {
		commands,
		events,
		rawAgentEndHandlers,
		waitForScheduledReviewAgentEnd: module.waitForScheduledReviewAgentEnd,
	};
}

async function emitRawAgentEnd(loaded, event, ctx) {
	for (const handler of loaded.rawAgentEndHandlers) await handler(event, ctx);
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

function waitForSignal(signal, matches) {
	if (matches(signal.state)) return Promise.resolve(signal.state);
	return new Promise((resolve, reject) => {
		let unsubscribe = () => {};
		const timeout = setTimeout(() => {
			unsubscribe();
			reject(new Error("signal timeout"));
		}, 5_000);
		unsubscribe = signal.subscribe((value) => {
			if (!matches(value)) return;
			clearTimeout(timeout);
			unsubscribe();
			resolve(value);
		});
	});
}

function waitForNotification(state, matches) {
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

function createState() {
	const id = Math.random().toString(16).slice(2);
	return {
		cwd: join(out, "workspaces", id),
		sessionFile: join(out, "sessions", `${id}.jsonl`),
		messages: [],
		sentMessages: [],
		notifications: [],
		notificationListeners: new Set(),
		statuses: [],
		editorText: "",
		widgets: [],
		editorComponents: [],
		customEntries: [],
		missingModels: new Set(),
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
	mkdirSync(state.cwd ?? root, { recursive: true });
	const context = {
		cwd: state.cwd ?? root,
		hasUI: true,
		modelRegistry: {
			find(provider, modelId) {
				if (state.missingModels.has(`${provider}/${modelId}`)) return undefined;
				return { provider, id: modelId, contextWindow: 200_000 };
			},
		},
		ui: {
			setEditorComponent(factory) {
				state.editorComponents.push(factory);
			},
			notify(message, level) {
				const notification = `${message}:${level ?? "info"}`;
				state.notifications.push(notification);
				for (const listener of state.notificationListeners)
					listener(notification);
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
			getSessionFile() {
				return state.sessionFile;
			},
			getBranch() {
				return state.customEntries;
			},
			appendCustomEntry(customType, data) {
				if (
					state.failReviewCheckpointArm &&
					customType === "review-checkpoint" &&
					data?.round === 0 &&
					data.phase === "awaiting_agent"
				)
					throw new Error("injected review checkpoint arm failure");
				if (
					state.failReviewCheckpointClear &&
					customType === "review-checkpoint" &&
					data?.phase === null
				)
					throw new Error("injected review checkpoint clear failure");
				state.customEntries.push({
					type: "custom",
					id: `custom-${state.customEntries.length + 1}`,
					parentId: state.customEntries.at(-1)?.id ?? null,
					timestamp: new Date().toISOString(),
					customType,
					data,
				});
			},
		},
	};
	scenarioContext = context;
	return context;
}

async function waitFor(read, message, timeoutMs = 12000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = read();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(message);
}

function enableMonitorProbe(ctx, state, activeProgressSnapshot) {
	ctx.mode = "tui";
	ctx.ui.custom = () => {
		state.monitorScopes ??= [];
		state.monitorScopes.push(activeProgressSnapshot().scopes.at(-1)?.kind);
		return Promise.resolve("scope-closed");
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
		titles.includes("质检中") &&
		titles.includes("质检未完成") &&
		!titles.includes("质检未通过")
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
