import { fork, spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer, get, request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";
import { acquireReportPortTestLock } from "./report-port-lock.mjs";

const mode = process.env.PI_FLOW_REPORT_SMOKE_MODE;
if (mode === "client") await runClientChild();
else if (mode === "daemon") await runDaemonChild();
else await runSmoke();

async function runSmoke() {
	const root = dirname(dirname(fileURLToPath(import.meta.url)));
	const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const out = join(tmpdir(), `pi-flow-report-daemon-test-${runId}`);
	const dist = join(out, "dist");
	const agentDir = join(out, "agent");
	const runtimeDir = join(agentDir, "pi-flow-report");
	const endpointPath = join(runtimeDir, "endpoint.json");
	const children = new Set();
	const daemonPids = new Set();
	const releaseReportPortLock = await acquireReportPortTestLock();

	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
	prepareTestDist(root, dist);
	writeFileSync(
		join(out, "config.json"),
		`${JSON.stringify({
			report: { bind: "127.0.0.1", port: 49327, publicBaseUrl: null },
		})}\n`,
	);

	const workspaceA = join(out, "workspace-a");
	const workspaceB = join(out, "workspace-b");
	const flowA = reportFile(workspaceA, "F1", "flow-a");
	const flowB = reportFile(workspaceB, "F2", "flow-b");
	const review = join(workspaceB, ".flow", "reviews", "session.html");
	mkdirSync(dirname(review), { recursive: true });
	writeFileSync(review, "<!doctype html><p>review</p>");
	const unregistered = reportFile(workspaceA, "F3", "unregistered");
	const json = join(workspaceA, ".flow", "F1", "flow.json");
	const markdown = join(workspaceA, ".flow", "F1", "G1-plan.md");
	const arbitrary = join(workspaceA, "private.html");
	writeFileSync(json, '{"secret":true}\n');
	writeFileSync(markdown, "# private\n");
	writeFileSync(arbitrary, "<!doctype html><p>private</p>");
	const symlink = join(workspaceA, ".flow", "F4", "flow.html");
	mkdirSync(dirname(symlink), { recursive: true });
	symlinkSync(flowA, symlink);

	try {
		mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
		writeFileSync(join(runtimeDir, "access.key"), randomBytes(32), {
			mode: 0o600,
		});
		mkdirSync(endpointPath);
		const failedDaemon = spawnRawDaemon(children, { out, runtimeDir });
		const startupFailure = await childMessage(failedDaemon, "error");
		assert(/EISDIR/u.test(startupFailure.message), startupFailure.message);
		await childExit(failedDaemon, 1_000);
		children.delete(failedDaemon);
		assert(
			failedDaemon.exitCode === 1,
			`failed daemon exited with ${String(failedDaemon.exitCode)}`,
		);
		assert(
			!readdirSync(runtimeDir).some(
				(name) => name.startsWith("endpoint.json.") && name.endsWith(".tmp"),
			),
			"failed daemon left an endpoint temp file",
		);
		const reusablePort = createServer();
		await listen(reusablePort, 49327);
		await closeServer(reusablePort);
		rmSync(endpointPath, { recursive: true, force: true });

		// symlink argv 不得预先 realpath：覆盖 daemon 主模块判断（extensions 符号链接安装形态）。
		const symlinkDaemonEntry = join(out, "report-daemon.link.js");
		symlinkSync(join(out, "dist", "report-daemon.js"), symlinkDaemonEntry);
		const linkedDaemon = spawnRawDaemon(children, {
			out,
			runtimeDir,
			entry: symlinkDaemonEntry,
		});
		const linkedReady = await childMessage(linkedDaemon, "ready");
		daemonPids.add(linkedReady.health.pid);
		assert(
			linkedReady.health.bind === "127.0.0.1" &&
				linkedReady.health.port === 49327,
			JSON.stringify(linkedReady.health),
		);
		await killPid(linkedReady.health.pid);
		await childExit(linkedDaemon, 2_000);
		children.delete(linkedDaemon);
		await waitForMissing(endpointPath);

		const compiledAgentDir = join(out, "compiled-agent");
		await assertCompiledBunHostStartsDaemon({
			out,
			agentDir: compiledAgentDir,
			workspace: workspaceA,
			reportPath: flowA,
			endpointPath: join(compiledAgentDir, "pi-flow-report", "endpoint.json"),
			daemonPids,
		});

		const closingDaemon = spawnDaemon(children, {
			out,
			agentDir,
			idleMs: 500,
		});
		const closingReady = await childMessage(closingDaemon, "ready");
		daemonPids.add(closingReady.health.pid);
		const incompleteRequest = await openIncompleteRequest();
		try {
			await childExit(closingDaemon, 2_000);
			children.delete(closingDaemon);
			await waitForMissing(endpointPath);
		} finally {
			incompleteRequest.destroy();
			if (children.has(closingDaemon)) {
				closingDaemon.kill("SIGKILL");
				await childExit(closingDaemon);
				children.delete(closingDaemon);
			}
		}

		const startupRaceKey = randomBytes(32);
		writeFileSync(join(runtimeDir, "access.key"), startupRaceKey, {
			mode: 0o600,
		});
		const startupLockPath = join(runtimeDir, "startup.lock");
		writeFileSync(
			startupLockPath,
			`${JSON.stringify({ pid: process.pid, startedAt: Date.now() })}\n`,
			{ mode: 0o600 },
		);
		const startupPeer = createStartupRacePeer(startupRaceKey);
		await listen(startupPeer.server, 49327);
		let racedClient;
		try {
			racedClient = spawnClient(children, {
				out,
				agentDir,
				cwd: workspaceA,
				path: flowA,
			});
			const racedOutcome = childMessage(racedClient, "ready").then(
				(value) => ({ value }),
				(error) => ({ error }),
			);
			const firstEvent = await Promise.race([
				startupPeer.healthServed.then(() => ({ healthServed: true })),
				racedOutcome,
			]);
			if (firstEvent.error) throw firstEvent.error;
			assert(
				firstEvent.healthServed,
				"client connected before startup discovery was published",
			);
			writeEndpointFixture(endpointPath, process.pid);
			rmSync(startupLockPath, { force: true });
			const raced = await racedOutcome;
			if (raced.error) throw raced.error;
			assert(
				raced.value.health.pid === process.pid,
				"client did not recover stale startup discovery",
			);
			racedClient.send({ type: "close" });
			await childExit(racedClient);
			children.delete(racedClient);
			racedClient = undefined;
		} finally {
			rmSync(startupLockPath, { force: true });
			rmSync(endpointPath, { force: true });
			if (racedClient) {
				racedClient.kill("SIGKILL");
				await childExit(racedClient);
				children.delete(racedClient);
			}
			await closeServer(startupPeer.server);
		}

		const emptyDaemon = spawnDaemon(children, {
			out,
			agentDir,
			idleMs: 60_000,
		});
		const emptyReady = await childMessage(emptyDaemon, "ready");
		daemonPids.add(emptyReady.health.pid);
		const emptyHtml = await fetch("http://127.0.0.1:49327/").then((response) =>
			response.text(),
		);
		assert(
			emptyHtml.includes("报告目录") &&
				emptyHtml.includes("Live") &&
				emptyHtml.includes("Recent") &&
				emptyHtml.includes("暂无进行中的报告"),
			"empty directory page incomplete",
		);
		assert(
			(await fetch("http://127.0.0.1:49327/", { method: "POST" })).status ===
				405,
			"root POST should be rejected",
		);
		assert(
			(await chunkedRequest("http://127.0.0.1:49327/", "GET")).status === 400,
			"root GET with body should be rejected",
		);
		await killPid(emptyReady.health.pid);
		await childExit(emptyDaemon);
		children.delete(emptyDaemon);
		await waitForMissing(endpointPath);

		const first = spawnClient(children, {
			out,
			agentDir,
			cwd: workspaceA,
			path: flowA,
		});
		const second = spawnClient(children, {
			out,
			agentDir,
			cwd: workspaceB,
			path: flowB,
		});
		const [firstReady, secondReady] = await Promise.all([
			childMessage(first, "ready"),
			childMessage(second, "ready"),
		]);
		assert(firstReady.health.port === 49327, JSON.stringify(firstReady.health));
		assert(
			firstReady.health.pid === secondReady.health.pid,
			"cold start created two daemons",
		);
		assert(
			firstReady.url !== secondReady.url,
			"different reports shared one capability",
		);
		daemonPids.add(firstReady.health.pid);
		assert(modeBits(runtimeDir) === 0o700, "runtime dir is not 0700");
		assert(
			modeBits(join(runtimeDir, "access.key")) === 0o600,
			"access key is not 0600",
		);
		assert(modeBits(endpointPath) === 0o600, "endpoint is not 0600");
		assert(
			firstReady.statuses.at(-1)?.value === `🌐 网页报告: ${firstReady.url}` &&
				!firstReady.statuses.at(-1)?.value.includes(workspaceA),
			JSON.stringify(firstReady.statuses),
		);

		const health = await fetch("http://127.0.0.1:49327/health").then(
			(response) => response.json(),
		);
		assert(
			JSON.stringify(Object.keys(health).sort()) ===
				JSON.stringify(["bind", "pid", "port", "protocol", "service"]),
			`health leaked fields: ${JSON.stringify(health)}`,
		);
		assert(
			health.service === "pi-flow-report" && health.protocol === 2,
			"bad health protocol",
		);
		const firstResponse = await fetch(firstReady.url);
		assert(
			firstResponse.headers.get("x-frame-options") === "DENY" &&
				firstResponse.headers.get("x-content-type-options") === "nosniff" &&
				firstResponse.headers.get("referrer-policy") === "no-referrer",
			"report security headers missing",
		);
		assert(
			(await firstResponse.text()).includes("flow-a"),
			"flow report unreadable",
		);
		assert(
			(
				await fetch(secondReady.url).then((response) => response.text())
			).includes("flow-b"),
			"second report unreadable",
		);
		const accessKey = readFileSync(join(runtimeDir, "access.key"));
		const populatedDirectory = await fetch("http://127.0.0.1:49327/").then(
			(response) => response.text(),
		);
		assert(
			populatedDirectory.includes("报告目录") &&
				populatedDirectory.includes(workspaceA) &&
				populatedDirectory.includes(workspaceB) &&
				populatedDirectory.includes("F1") &&
				populatedDirectory.includes("F2"),
			"populated directory page incomplete",
		);

		const firstCap = new URL(firstReady.url).pathname.split("/")[2];
		const [changedWithBody, reportWithBody] = await Promise.all([
			chunkedRequest(
				`http://127.0.0.1:49327/control/reports/${firstCap}/changed`,
				"POST",
				accessKey,
			),
			chunkedRequest(firstReady.url, "GET"),
		]);
		assert(
			changedWithBody.status === 400 && reportWithBody.status === 400,
			`bodyless routes accepted chunked bodies: changed=${changedWithBody.status}, report=${reportWithBody.status}`,
		);
		const registeredReview = await registerReport(
			accessKey,
			workspaceB,
			review,
			"live",
			2_000,
		);
		assert(
			registeredReview.status === 200,
			`review registration failed: ${registeredReview.text}`,
		);
		assert(
			(
				await fetch(registeredReview.body.localUrl).then((response) =>
					response.text(),
				)
			).includes("review"),
			"review report unreadable",
		);
		for (const path of [json, markdown, arbitrary, symlink, dirname(flowA)]) {
			const result = await registerReport(accessKey, workspaceA, path);
			assert(
				result.status === 404,
				`unsafe report registered: ${path} (${result.status})`,
			);
		}
		assert(
			(
				await postJson(
					"http://127.0.0.1:49327/control/reports",
					{
						cwd: workspaceA,
						path: flowA,
						state: "live",
						generation: 1,
					},
					"bad-key",
				)
			).status === 401,
			"bad control auth was accepted",
		);
		assert(
			(
				await postJson(
					"http://127.0.0.1:49327/control/reports",
					{ cwd: workspaceA, path: flowA },
					accessKey.toString("base64url"),
				)
			).status === 400,
			"protocol 1 registration body was accepted",
		);
		writeFileSync(
			join(out, "config.json"),
			`${JSON.stringify({ report: { bind: "127.0.0.1", port: 49328, publicBaseUrl: null } })}\n`,
		);
		const mismatched = spawnClient(children, {
			out,
			agentDir,
			cwd: workspaceA,
			path: flowA,
		});
		const mismatchError = await childMessage(mismatched, "error");
		assert(
			/already running/iu.test(mismatchError.message),
			mismatchError.message,
		);
		await childExit(mismatched);
		children.delete(mismatched);
		writeFileSync(
			join(out, "config.json"),
			`${JSON.stringify({ report: { bind: "127.0.0.1", port: 49327, publicBaseUrl: "https://host.tailnet.ts.net" } })}\n`,
		);
		const publicMismatch = spawnClient(children, {
			out,
			agentDir,
			cwd: workspaceA,
			path: flowA,
		});
		const publicMismatchError = await childMessage(publicMismatch, "error");
		assert(
			/publicBaseUrl/u.test(publicMismatchError.message),
			publicMismatchError.message,
		);
		publicMismatch.kill("SIGKILL");
		await childExit(publicMismatch);
		children.delete(publicMismatch);
		writeFileSync(
			join(out, "config.json"),
			`${JSON.stringify({ report: { bind: "127.0.0.1", port: 49327, publicBaseUrl: null } })}\n`,
		);
		const unknownCap = capability(accessKey, realpathSync(unregistered));
		for (const path of [
			`/r/${unknownCap}/`,
			`/r/${new URL(firstReady.url).pathname.split("/")[2]}/../`,
			`/r/%2e%2e/`,
			`/r/%252e%252e/`,
		]) {
			// fetch() 会先归一化 URL；探测必须走 raw path，才能覆盖 daemon 侧防护。
			const response = await rawGet(path);
			assert(
				response.status === 404 && !response.text.includes("报告目录"),
				`unsafe route was served: ${path} (${response.status})`,
			);
		}

		await assertDirectoryBehavior({
			accessKey,
			runtimeDir,
			workspaceA,
			workspaceB,
			flowA,
			flowB,
			review,
			firstReady,
			secondReady,
			registeredReview,
		});

		const firstReload = sseReload(new URL("events", firstReady.url).href);
		const secondReload = sseReload(new URL("events", secondReady.url).href);
		await Promise.all([firstReload.ready, secondReload.ready]);
		second.send({ type: "notify", path: flowB });
		await childMessage(second, "notified");
		assert(
			(await secondReload.event).includes("event: reload"),
			"second report did not reload",
		);
		first.send({ type: "notify", path: flowA });
		await childMessage(first, "notified");
		assert(
			(await firstReload.event).includes("event: reload"),
			"first report did not reload",
		);

		first.send({ type: "close" });
		await childExit(first);
		children.delete(first);
		assert(
			(await fetch(secondReady.url)).status === 200,
			"starter exit killed shared daemon",
		);
		const heldSse = sseReload(new URL("events", secondReady.url).href, false);
		await heldSse.ready;
		second.send({ type: "close" });
		await childExit(second);
		children.delete(second);
		assert(
			(await fetch(secondReady.url)).status === 200,
			"browser SSE did not keep daemon alive",
		);
		heldSse.close();
		await killPid(firstReady.health.pid);
		await waitForMissing(endpointPath);

		const oneShot = await runOneShotClient(children, {
			out,
			agentDir,
			cwd: workspaceA,
			path: flowA,
		});
		const oneShotHealth = await fetch(new URL("/health", oneShot.url)).then(
			(response) => response.json(),
		);
		daemonPids.add(oneShotHealth.pid);
		assert(
			(await fetch(oneShot.url).then((response) => response.text())).includes(
				"flow-a",
			),
			"one-shot starter exit killed the report daemon",
		);
		const reusedClient = spawnClient(children, {
			out,
			agentDir,
			cwd: workspaceB,
			path: flowB,
		});
		const reusedReady = await childMessage(reusedClient, "ready");
		assert(
			reusedReady.health.pid === oneShotHealth.pid,
			"next client did not reuse the one-shot daemon",
		);
		reusedClient.send({ type: "close" });
		await childExit(reusedClient);
		children.delete(reusedClient);
		await killPid(oneShotHealth.pid);
		await waitForMissing(endpointPath);

		const idleDaemon = spawnDaemon(children, { out, agentDir, idleMs: 100 });
		const idleReady = await childMessage(idleDaemon, "ready");
		daemonPids.add(idleReady.health.pid);
		const control = await openControl(
			readFileSync(join(runtimeDir, "access.key")),
		);
		await delay(180);
		assert(
			(await fetch("http://127.0.0.1:49327/health")).status === 200,
			"live control did not cancel idle exit",
		);
		control.destroy();
		await childExit(idleDaemon, 2_000);
		children.delete(idleDaemon);
		await waitForMissing(endpointPath);

		const recovering = spawnClient(children, {
			out,
			agentDir,
			cwd: workspaceA,
			path: flowA,
		});
		const recoveringReady = await childMessage(recovering, "ready");
		daemonPids.add(recoveringReady.health.pid);
		process.kill(recoveringReady.health.pid, "SIGKILL");
		const recoveredEndpoint = await waitForEndpointPid(
			endpointPath,
			recoveringReady.health.pid,
		);
		daemonPids.add(recoveredEndpoint.pid);
		await delay(100);
		assert(
			(await fetch(recoveringReady.url)).status === 200,
			"client did not re-register after daemon crash",
		);
		process.kill(recoveredEndpoint.pid, "SIGKILL");
		await delay(250);
		assert(
			safeEndpoint(endpointPath)?.pid === recoveredEndpoint.pid,
			"client entered an automatic reconnect loop",
		);
		recovering.send({ type: "register", path: flowA });
		const retried = await childMessage(recovering, "registered");
		assert(
			retried.url === recoveringReady.url,
			"stable report capability changed after restart",
		);
		const retriedHealth = await fetch("http://127.0.0.1:49327/health").then(
			(response) => response.json(),
		);
		daemonPids.add(retriedHealth.pid);
		recovering.send({ type: "close" });
		await childExit(recovering);
		children.delete(recovering);
		await killPid(retriedHealth.pid);
		await waitForMissing(endpointPath);

		// 前面 directory 测试已写 ledger；此处验证冷启动精确重载与 unavailable。
		await assertDirectoryColdStart({
			accessKey: readFileSync(join(runtimeDir, "access.key")),
			runtimeDir,
			out,
			agentDir,
			children,
			daemonPids,
			workspaceB,
			flowA,
			flowB,
		});

		const unknown = createServer((_request, response) =>
			response.end("not pi-flow"),
		);
		await listen(unknown, 49327);
		const unknownClient = spawnClient(children, {
			out,
			agentDir,
			cwd: workspaceA,
			path: flowA,
		});
		const unknownError = await childMessage(unknownClient, "error");
		assert(
			/unknown service|未知服务/iu.test(unknownError.message),
			unknownError.message,
		);
		await childExit(unknownClient);
		children.delete(unknownClient);
		await closeServer(unknown);

		const incompatible = createServer((request, response) => {
			if (request.url !== "/health") return response.writeHead(404).end();
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({
					service: "pi-flow-report",
					protocol: 99,
					pid: process.pid,
					bind: "127.0.0.1",
					port: 49327,
				}),
			);
		});
		await listen(incompatible, 49327);
		const incompatibleClient = spawnClient(children, {
			out,
			agentDir,
			cwd: workspaceA,
			path: flowA,
		});
		const incompatibleError = await childMessage(incompatibleClient, "error");
		assert(
			/protocol|协议/iu.test(incompatibleError.message),
			incompatibleError.message,
		);
		await childExit(incompatibleClient);
		children.delete(incompatibleClient);
		await closeServer(incompatible);

		assert(!lstatSync(symlink).isFile(), "symlink fixture was not a symlink");
		console.log("report server smoke ok");
	} finally {
		for (const child of children) child.kill("SIGKILL");
		const endpoint = safeEndpoint(endpointPath);
		if (endpoint?.pid) daemonPids.add(endpoint.pid);
		for (const pid of daemonPids) await killPid(pid);
		rmSync(out, { recursive: true, force: true });
		await releaseReportPortLock();
	}
}

async function assertCompiledBunHostStartsDaemon(input) {
	const bun = spawnSync("bun", ["--version"], { encoding: "utf8" });
	if (bun.error?.code === "ENOENT") {
		console.log("compiled Bun report host smoke skipped: bun is unavailable");
		return;
	}
	assert(
		bun.status === 0,
		`bun --version failed: ${bun.stderr || bun.error?.message || bun.status}`,
	);
	const sourcePath = join(input.out, "compiled-report-host.mjs");
	const executablePath = join(input.out, "compiled-report-host");
	const selfLaunchMarker = join(input.out, "compiled-report-host-relaunched");
	const oldNodeLaunchMarker = join(input.out, "old-node-launched-daemon");
	const bunOnlyBin = join(input.out, "bun-only-bin");
	const bunExecutable = spawnSync(
		"bun",
		["-e", "process.stdout.write(process.execPath)"],
		{ encoding: "utf8" },
	).stdout;
	mkdirSync(bunOnlyBin);
	symlinkSync(bunExecutable, join(bunOnlyBin, "bun"));
	const oldNode = join(bunOnlyBin, "node");
	writeFileSync(
		oldNode,
		`#!/bin/sh
if [ "$1" = "--version" ]; then
	echo v20.18.0
	exit 0
fi
printf launched > "${oldNodeLaunchMarker}"
exit 72
`,
	);
	chmodSync(oldNode, 0o755);
	writeFileSync(
		sourcePath,
		`import { writeFileSync } from "node:fs";
if (process.argv.some((argument) => argument.endsWith("report-daemon.js"))) {
	writeFileSync(process.env.PI_FLOW_SELF_LAUNCH_MARKER, process.argv.join("\\n"));
	process.exit(71);
}
const client = await import(process.env.PI_FLOW_REPORT_CLIENT_URL);
const statuses = [];
const url = await client.liveReportUrl(
	{ cwd: process.env.PI_FLOW_REPORT_WORKSPACE, ui: { setStatus: (key, value) => statuses.push({ key, value }) } },
	process.env.PI_FLOW_REPORT_PATH,
	"zh",
	{ state: "live", generation: 1 },
);
await client.closeReportClient();
process.stdout.write(JSON.stringify({ execPath: process.execPath, statuses, url }));
`,
	);
	const built = spawnSync(
		"bun",
		["build", sourcePath, "--compile", "--outfile", executablePath],
		{ encoding: "utf8" },
	);
	assert(
		built.status === 0,
		`compiled Bun host build failed: ${built.stderr || built.error?.message || built.status}`,
	);
	let endpoint;
	try {
		const run = spawnSync(executablePath, [], {
			cwd: input.out,
			encoding: "utf8",
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: input.agentDir,
				PI_FLOW_REPORT_CLIENT_URL: `${pathToFileURL(join(input.out, "dist", "shared", "report-client.js")).href}?compiled-host`,
				PATH: bunOnlyBin,
				PI_FLOW_REPORT_PATH: input.reportPath,
				PI_FLOW_REPORT_WORKSPACE: input.workspace,
				PI_FLOW_SELF_LAUNCH_MARKER: selfLaunchMarker,
			},
			timeout: 10_000,
		});
		assert(
			run.status === 0,
			`compiled Bun host failed (${run.status ?? run.signal}): ${run.stderr}`,
		);
		assert(
			!existsSync(selfLaunchMarker),
			"report client relaunched the compiled Pi-style host as a JS runtime",
		);
		assert(
			!existsSync(oldNodeLaunchMarker),
			"report client launched the daemon with an unsupported Node.js runtime",
		);
		const result = JSON.parse(run.stdout);
		assert(
			result.execPath === realpathSync(executablePath),
			JSON.stringify(result),
		);
		assert(
			result.statuses.some(
				(status) =>
					status.key === "pi-flow-html-live" &&
					status.value?.includes(result.url),
			),
			JSON.stringify(result),
		);
		assert(
			(await fetch(new URL("/health", result.url))).status === 200,
			"compiled Bun host report daemon was unreachable",
		);
	} finally {
		endpoint = safeEndpoint(input.endpointPath);
		if (endpoint?.pid) {
			input.daemonPids.add(endpoint.pid);
			await killPid(endpoint.pid);
			await waitForMissing(input.endpointPath);
		}
	}
	const unavailable = spawnSync(executablePath, [], {
		cwd: input.out,
		encoding: "utf8",
		env: {
			...process.env,
			PATH: "",
			PI_CODING_AGENT_DIR: join(input.out, "compiled-no-runtime-agent"),
			PI_FLOW_REPORT_CLIENT_URL: `${pathToFileURL(join(input.out, "dist", "shared", "report-client.js")).href}?compiled-no-runtime`,
			PI_FLOW_REPORT_PATH: input.reportPath,
			PI_FLOW_REPORT_WORKSPACE: input.workspace,
			PI_FLOW_SELF_LAUNCH_MARKER: selfLaunchMarker,
		},
		timeout: 10_000,
	});
	assert(
		unavailable.status !== 0 &&
			unavailable.stderr.includes(
				"Pi Flow Web Report requires Node.js >=22.19 or Bun in PATH",
			),
		`missing report runtime was not explicit: ${unavailable.stderr}`,
	);
}

async function runClientChild() {
	try {
		const dist = join(process.env.PI_FLOW_REPORT_SMOKE_OUT, "dist");
		const client = await import(
			`${pathToFileURL(join(dist, "shared/report-client.js")).href}?child=${process.pid}`
		);
		const cwd = process.env.PI_FLOW_REPORT_SMOKE_CWD;
		const path = process.env.PI_FLOW_REPORT_SMOKE_PATH;
		const statuses = [];
		const ctx = {
			cwd,
			ui: {
				setStatus(key, value) {
					statuses.push({ key, value });
				},
			},
		};
		const lifecycleFor = (message = {}) => ({
			state: message.state ?? "live",
			generation:
				message.generation ??
				Number(process.env.PI_FLOW_REPORT_SMOKE_GENERATION ?? Date.now()),
		});
		const url = await client.liveReportUrl(ctx, path, "zh", lifecycleFor());
		const health = await fetch(new URL("/health", url)).then((response) =>
			response.json(),
		);
		process.send?.({ type: "ready", url, health, statuses });
		process.on("message", async (message) => {
			try {
				if (message.type === "notify") {
					await client.notifyReportChanged(message.path);
					process.send?.({ type: "notified" });
				} else if (message.type === "register") {
					const registered = await client.liveReportUrl(
						ctx,
						message.path,
						"zh",
						lifecycleFor(message),
					);
					process.send?.({ type: "registered", url: registered });
				} else if (message.type === "close") {
					await client.closeReportClient();
					process.exit(0);
				}
			} catch (error) {
				process.send?.({
					type: "error",
					message: String(error?.message ?? error),
				});
			}
		});
	} catch (error) {
		process.send?.({ type: "error", message: String(error?.message ?? error) });
		process.exitCode = 1;
	}
}

async function runDaemonChild() {
	try {
		const dist = join(process.env.PI_FLOW_REPORT_SMOKE_OUT, "dist");
		const daemon = await import(
			`${pathToFileURL(join(dist, "report-daemon.js")).href}?child=${process.pid}`
		);
		const running = await daemon.startReportDaemon({
			config: { bind: "127.0.0.1", port: 49327, publicBaseUrl: null },
			runtimeDir: join(process.env.PI_CODING_AGENT_DIR, "pi-flow-report"),
			idleMs: Number(process.env.PI_FLOW_REPORT_SMOKE_IDLE_MS),
		});
		process.send?.({ type: "ready", health: running.health });
	} catch (error) {
		process.send?.({ type: "error", message: String(error?.message ?? error) });
		process.exitCode = 1;
	}
}

function createStartupRacePeer(key) {
	let resolveHealth;
	let healthReported = false;
	const healthServed = new Promise((resolve) => {
		resolveHealth = resolve;
	});
	const server = createServer((req, response) => {
		if (req.method === "GET" && req.url === "/health") {
			response.setHeader("content-type", "application/json");
			response.once("finish", () => {
				if (healthReported) return;
				healthReported = true;
				resolveHealth();
			});
			return response.end(
				JSON.stringify({
					service: "pi-flow-report",
					protocol: 2,
					pid: process.pid,
					bind: "127.0.0.1",
					port: 49327,
				}),
			);
		}
		if (req.headers.authorization !== `Bearer ${key.toString("base64url")}`)
			return response.writeHead(401).end();
		if (req.method === "GET" && req.url === "/control/connect") {
			response.writeHead(200, { connection: "keep-alive" });
			return response.write("\n");
		}
		if (req.method === "POST" && req.url === "/control/reports") {
			let body = "";
			req.setEncoding("utf8");
			req.on("data", (chunk) => {
				body += chunk;
			});
			return req.on("end", () => {
				const path = JSON.parse(body).path;
				const cap = capability(key, realpathSync(path));
				const url = `http://127.0.0.1:49327/r/${cap}/`;
				response.setHeader("content-type", "application/json");
				response.end(JSON.stringify({ cap, localUrl: url, publicUrl: url }));
			});
		}
		response.writeHead(404).end();
	});
	return { server, healthServed };
}

function writeEndpointFixture(path, pid) {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(
		temporary,
		`${JSON.stringify({
			protocol: 2,
			pid,
			bind: "127.0.0.1",
			port: 49327,
			startedAt: Date.now(),
		})}\n`,
		{ mode: 0o600 },
	);
	renameSync(temporary, path);
}

function runOneShotClient(children, input) {
	const source = `
const client = await import(process.env.PI_FLOW_REPORT_SMOKE_CLIENT_URL);
const url = await client.liveReportUrl(
  { cwd: process.env.PI_FLOW_REPORT_SMOKE_CWD, ui: { setStatus() {} } },
  process.env.PI_FLOW_REPORT_SMOKE_PATH,
  "zh",
  { state: "live", generation: Number(process.env.PI_FLOW_REPORT_SMOKE_GENERATION ?? Date.now()) },
);
process.stdout.write(JSON.stringify({ url }));
`;
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			["--input-type=module", "--eval", source],
			{
				cwd: input.out,
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: input.agentDir,
					PI_FLOW_REPORT_SMOKE_CLIENT_URL: pathToFileURL(
						join(input.out, "dist", "shared", "report-client.js"),
					).href,
					PI_FLOW_REPORT_SMOKE_CWD: input.cwd,
					PI_FLOW_REPORT_SMOKE_PATH: input.path,
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		children.add(child);
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`one-shot client did not exit: ${stderr}`));
		}, 3_000);
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("exit", (code, signal) => {
			clearTimeout(timeout);
			children.delete(child);
			if (code !== 0)
				return reject(
					new Error(`one-shot client failed (${code ?? signal}): ${stderr}`),
				);
			try {
				resolve(JSON.parse(stdout));
			} catch {
				reject(new Error(`one-shot client returned invalid JSON: ${stdout}`));
			}
		});
	});
}

function spawnRawDaemon(children, input) {
	const entry =
		input.entry ?? realpathSync(join(input.out, "dist", "report-daemon.js"));
	const child = spawn(process.execPath, [entry], {
		stdio: ["ignore", "ignore", "pipe", "ipc"],
	});
	children.add(child);
	child.once("spawn", () =>
		child.send({
			type: "start",
			protocol: 2,
			config: { bind: "127.0.0.1", port: 49327, publicBaseUrl: null },
			runtimeDir: input.runtimeDir,
		}),
	);
	return child;
}

function spawnClient(children, input) {
	return spawnChild(children, {
		...input,
		PI_FLOW_REPORT_SMOKE_MODE: "client",
		PI_FLOW_REPORT_SMOKE_CWD: input.cwd,
		PI_FLOW_REPORT_SMOKE_PATH: input.path,
	});
}

function spawnDaemon(children, input) {
	return spawnChild(children, {
		...input,
		PI_FLOW_REPORT_SMOKE_MODE: "daemon",
		PI_FLOW_REPORT_SMOKE_IDLE_MS: String(input.idleMs),
	});
}

function spawnChild(children, input) {
	const child = fork(fileURLToPath(import.meta.url), [], {
		env: {
			...process.env,
			PI_CODING_AGENT_DIR: input.agentDir,
			PI_FLOW_REPORT_SMOKE_MODE: input.PI_FLOW_REPORT_SMOKE_MODE,
			PI_FLOW_REPORT_SMOKE_OUT: input.out,
			PI_FLOW_REPORT_SMOKE_CWD: input.PI_FLOW_REPORT_SMOKE_CWD,
			PI_FLOW_REPORT_SMOKE_PATH: input.PI_FLOW_REPORT_SMOKE_PATH,
			PI_FLOW_REPORT_SMOKE_IDLE_MS: input.PI_FLOW_REPORT_SMOKE_IDLE_MS,
		},
		stdio: ["ignore", "ignore", "pipe", "ipc"],
	});
	children.add(child);
	return child;
}

function childMessage(child, type, timeoutMs = 5_000) {
	return new Promise((resolve, reject) => {
		let stderr = "";
		const timeout = setTimeout(
			() => finish(new Error(`child ${type} timeout: ${stderr}`)),
			timeoutMs,
		);
		const onData = (chunk) => {
			stderr += chunk.toString("utf8");
		};
		const onMessage = (message) => {
			if (message?.type === "error" && type !== "error")
				return finish(new Error(message.message));
			if (message?.type === type) finish(undefined, message);
		};
		const onExit = (code, signal) =>
			finish(
				new Error(`child exited before ${type}: ${code ?? signal}\n${stderr}`),
			);
		const finish = (error, value) => {
			clearTimeout(timeout);
			child.stderr?.off("data", onData);
			child.off("message", onMessage);
			child.off("exit", onExit);
			if (error) reject(error);
			else resolve(value);
		};
		child.stderr?.on("data", onData);
		child.on("message", onMessage);
		child.on("exit", onExit);
	});
}

function childExit(child, timeoutMs = 5_000) {
	if (child.exitCode !== null || child.signalCode !== null)
		return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error("child exit timeout")),
			timeoutMs,
		);
		child.once("exit", () => {
			clearTimeout(timeout);
			resolve();
		});
	});
}

function reportFile(cwd, id, text) {
	const path = join(cwd, ".flow", id, "flow.html");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `<!doctype html><p>${text}</p>`);
	return path;
}

function modeBits(path) {
	return statSync(path).mode & 0o777;
}

function capability(key, path) {
	return createHmac("sha256", key).update(path).digest("base64url");
}

async function registerReport(key, cwd, path, state = "live", generation = 1) {
	return postJson(
		"http://127.0.0.1:49327/control/reports",
		{ cwd, path, state, generation },
		key.toString("base64url"),
	);
}

async function assertDirectoryBehavior(input) {
	const directoryPath = join(input.runtimeDir, "directory.json");
	const currentGeneration = (path) => {
		try {
			const ledger = JSON.parse(readFileSync(directoryPath, "utf8"));
			return (
				ledger.records.find((record) => record.path === path)?.generation ?? 0
			);
		} catch {
			return 0;
		}
	};
	const genA = currentGeneration(input.flowA);
	const completeGen = genA + 1;
	const liveComplete = await registerReport(
		input.accessKey,
		input.workspaceA,
		input.flowA,
		"complete",
		completeGen,
	);
	assert(liveComplete.status === 200, liveComplete.text);
	const staleLive = await registerReport(
		input.accessKey,
		input.workspaceA,
		input.flowA,
		"live",
		completeGen,
	);
	assert(
		staleLive.status === 409,
		`complete downgraded to live: ${staleLive.status} ${staleLive.text}`,
	);
	const olderGeneration = await registerReport(
		input.accessKey,
		input.workspaceA,
		input.flowA,
		"live",
		0,
	);
	assert(
		olderGeneration.status === 400,
		`non-positive generation accepted: ${olderGeneration.status}`,
	);
	const staleGeneration = await registerReport(
		input.accessKey,
		input.workspaceA,
		input.flowA,
		"live",
		completeGen,
	);
	assert(
		staleGeneration.status === 409,
		`stale generation accepted: ${staleGeneration.status}`,
	);
	const reopenGen = completeGen + 1;
	const reopen = await registerReport(
		input.accessKey,
		input.workspaceA,
		input.flowA,
		"live",
		reopenGen,
	);
	assert(reopen.status === 200, reopen.text);
	const genB = currentGeneration(input.flowB);
	const completeB = await registerReport(
		input.accessKey,
		input.workspaceB,
		input.flowB,
		"complete",
		genB + 1,
	);
	assert(completeB.status === 200, completeB.text);

	const directoryHtml = await fetch("http://127.0.0.1:49327/").then(
		(response) => response.text(),
	);
	assert(
		directoryHtml.includes(input.workspaceA) &&
			directoryHtml.includes(input.workspaceB) &&
			directoryHtml.includes("F1") &&
			directoryHtml.includes("F2") &&
			directoryHtml.includes("session") &&
			directoryHtml.includes(
				`/r/${new URL(input.firstReady.url).pathname.split("/")[2]}/`,
			),
		"directory page missing registered reports",
	);
	assert(
		!directoryHtml.includes("unregistered") &&
			!directoryHtml.includes("private.html"),
		"directory listed unregistered paths",
	);

	const ledger = JSON.parse(readFileSync(directoryPath, "utf8"));
	assert(ledger.version === 1, JSON.stringify(ledger));
	assert(modeBits(directoryPath) === 0o600, "directory.json is not 0600");
	assert(
		ledger.records.every(
			(record) =>
				record.available === true &&
				(record.state === "live" || record.state === "complete"),
		),
		JSON.stringify(ledger.records),
	);

	// recent 上限 50：再塞 51 条 complete，只保留最新 50。
	const floodRoot = join(input.workspaceA, ".flow");
	for (let index = 10; index <= 60; index += 1) {
		const id = `F${index}`;
		const path = join(floodRoot, id, "flow.html");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `<!doctype html><p>${id}</p>`);
		const result = await registerReport(
			input.accessKey,
			input.workspaceA,
			path,
			"complete",
			index,
		);
		assert(result.status === 200, `${id}: ${result.text}`);
	}
	const flooded = JSON.parse(readFileSync(directoryPath, "utf8"));
	const recent = flooded.records.filter(
		(record) => record.state === "complete",
	);
	const live = flooded.records.filter((record) => record.state === "live");
	assert(recent.length === 50, `recent kept ${recent.length}`);
	assert(live.length >= 1, "live records were dropped");
	assert(
		!recent.some((record) => record.label === "F10"),
		"oldest recent was not trimmed",
	);
	assert(
		recent.some((record) => record.label === "F60"),
		"newest recent missing",
	);

	const directoryReload = sseReload("http://127.0.0.1:49327/events");
	await directoryReload.ready;
	const sseBump = await registerReport(
		input.accessKey,
		input.workspaceB,
		input.review,
		"complete",
		9_000,
	);
	assert(sseBump.status === 200, sseBump.text);
	assert(
		(await directoryReload.event).includes("event: reload"),
		"directory SSE did not reload",
	);
}

async function assertDirectoryColdStart(input) {
	const directoryPath = join(input.runtimeDir, "directory.json");
	const bootstrap = spawnDaemon(input.children, {
		out: input.out,
		agentDir: input.agentDir,
		idleMs: 60_000,
	});
	const bootReady = await childMessage(bootstrap, "ready");
	input.daemonPids.add(bootReady.health.pid);
	writeFileSync(input.flowB, "<!doctype html><p>flow-b</p>");
	let previous = 0;
	try {
		previous =
			JSON.parse(readFileSync(directoryPath, "utf8")).records.find(
				(record) => record.path === input.flowB,
			)?.generation ?? 0;
	} catch {}
	const ensured = await registerReport(
		input.accessKey,
		input.workspaceB,
		input.flowB,
		"complete",
		previous + 1,
	);
	assert(ensured.status === 200, ensured.text);
	const missingCap = capability(input.accessKey, realpathSync(input.flowB));
	rmSync(input.flowB, { force: true });
	await killPid(bootReady.health.pid);
	await childExit(bootstrap);
	input.children.delete(bootstrap);
	await waitForMissing(join(input.runtimeDir, "endpoint.json"));
	const cold = spawnDaemon(input.children, {
		out: input.out,
		agentDir: input.agentDir,
		idleMs: 60_000,
	});
	const ready = await childMessage(cold, "ready");
	input.daemonPids.add(ready.health.pid);
	const html = await fetch("http://127.0.0.1:49327/").then((response) =>
		response.text(),
	);
	assert(html.includes(input.workspaceB), "cold start dropped recent record");
	assert(html.includes("不可用"), html);
	assert(
		!html.includes(`href="/r/${missingCap}/"`),
		"unavailable record still linked",
	);
	const liveCap = capability(input.accessKey, realpathSync(input.flowA));
	assert(
		(await fetch(`http://127.0.0.1:49327/r/${liveCap}/`)).status === 200,
		"cold start did not restore safe report capability",
	);
	const ledger = JSON.parse(readFileSync(directoryPath, "utf8"));
	const missing = ledger.records.find((record) => record.cap === missingCap);
	assert(missing && missing.available === false, JSON.stringify(missing));

	// 伪造 capability：文件仍在，但 cap 与 HMAC 不一致 → unavailable 且详情 404
	const forgedPath = input.flowA;
	const realCap = capability(input.accessKey, realpathSync(forgedPath));
	const forgedCap = capability(Buffer.alloc(32, 7), realpathSync(forgedPath));
	assert(forgedCap !== realCap, "forged cap collided");
	const goodRecord = ledger.records.find(
		(record) => record.path === forgedPath,
	);
	assert(goodRecord, "missing live record for forge test");
	const forgedLedger = {
		version: 1,
		records: [
			{
				...goodRecord,
				cap: forgedCap,
				available: true,
			},
		],
	};
	await killPid(ready.health.pid);
	await childExit(cold);
	input.children.delete(cold);
	await waitForMissing(join(input.runtimeDir, "endpoint.json"));
	writeFileSync(directoryPath, `${JSON.stringify(forgedLedger)}\n`, {
		mode: 0o600,
	});
	const forgedDaemon = spawnDaemon(input.children, {
		out: input.out,
		agentDir: input.agentDir,
		idleMs: 60_000,
	});
	const forgedReady = await childMessage(forgedDaemon, "ready");
	input.daemonPids.add(forgedReady.health.pid);
	const forgedHtml = await fetch("http://127.0.0.1:49327/").then((response) =>
		response.text(),
	);
	assert(forgedHtml.includes("不可用"), forgedHtml);
	assert(
		!forgedHtml.includes(`href="/r/${forgedCap}/"`),
		"forged capability rendered as live link",
	);
	assert(
		(await fetch(`http://127.0.0.1:49327/r/${forgedCap}/`)).status === 404,
		"forged capability detail was served",
	);
	await killPid(forgedReady.health.pid);
	await childExit(forgedDaemon);
	input.children.delete(forgedDaemon);
	await waitForMissing(join(input.runtimeDir, "endpoint.json"));

	// 严格 schema：非法 cap / 相对路径 / 身份错配 / 重复记录 整账本拒绝加载
	const { parseDirectoryLedger } = await import(
		pathToFileURL(join(input.out, "dist", "shared", "report-directory.js")).href
	);
	const base = {
		cap: realCap,
		cwd: input.workspaceA,
		path: input.flowA,
		realPath: realpathSync(input.flowA),
		state: "live",
		generation: 1,
		updatedAt: Date.now(),
		kind: "flow",
		label: "F1",
		available: true,
	};
	assert(
		parseDirectoryLedger({
			version: 1,
			records: [{ ...base, cap: "x" }],
		}) === undefined,
		"malformed capability accepted",
	);
	assert(
		parseDirectoryLedger({
			version: 1,
			records: [{ ...base, path: "relative/flow.html" }],
		}) === undefined,
		"relative path accepted",
	);
	assert(
		parseDirectoryLedger({
			version: 1,
			records: [{ ...base, label: "F9" }],
		}) === undefined,
		"identity mismatch accepted",
	);
	assert(
		parseDirectoryLedger({
			version: 1,
			records: [{ ...base, updatedAt: Number.NaN }],
		}) === undefined,
		"NaN updatedAt accepted",
	);
	assert(
		parseDirectoryLedger({
			version: 1,
			records: [base, { ...base, generation: 2 }],
		}) === undefined,
		"duplicate realPath accepted",
	);
}

function postJson(url, body, key) {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify(body);
		const target = new URL(url);
		const req = request(
			{
				hostname: target.hostname,
				port: target.port,
				path: target.pathname,
				method: "POST",
				headers: {
					authorization: `Bearer ${key}`,
					"content-type": "application/json",
					"content-length": Buffer.byteLength(payload),
				},
			},
			(response) => {
				let text = "";
				response.on("data", (chunk) => {
					text += chunk;
				});
				response.on("end", () => {
					let body;
					try {
						body = JSON.parse(text);
					} catch {}
					resolve({ status: response.statusCode, text, body });
				});
			},
		);
		req.on("error", reject);
		req.end(payload);
	});
}

function rawGet(path) {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				hostname: "127.0.0.1",
				port: 49327,
				path,
				method: "GET",
			},
			(response) => {
				let text = "";
				response.on("data", (chunk) => {
					text += chunk;
				});
				response.on("end", () =>
					resolve({ status: response.statusCode, text }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

function chunkedRequest(url, method, key) {
	return new Promise((resolve, reject) => {
		const target = new URL(url);
		const req = request(
			{
				hostname: target.hostname,
				port: target.port,
				path: target.pathname,
				method,
				headers: {
					"transfer-encoding": "chunked",
					...(key
						? { authorization: `Bearer ${key.toString("base64url")}` }
						: {}),
				},
			},
			(response) => {
				let text = "";
				response.on("data", (chunk) => {
					text += chunk;
				});
				response.on("end", () =>
					resolve({ status: response.statusCode, text }),
				);
			},
		);
		req.on("error", reject);
		req.end("unexpected body");
	});
}

function openControl(key) {
	return new Promise((resolve, reject) => {
		const req = get(
			"http://127.0.0.1:49327/control/connect",
			{
				headers: { authorization: `Bearer ${key.toString("base64url")}` },
			},
			(response) => resolve(response),
		);
		req.on("error", reject);
	});
}

function sseReload(url, waitForReload = true) {
	let buffer = "";
	let resolveReady;
	let rejectReady;
	let resolveEvent;
	let rejectEvent;
	const ready = new Promise((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const event = new Promise((resolve, reject) => {
		resolveEvent = resolve;
		rejectEvent = reject;
	});
	const timeout = setTimeout(() => {
		const error = new Error(`SSE timeout: ${buffer}`);
		rejectReady(error);
		if (waitForReload) rejectEvent(error);
	}, 3_000);
	const req = get(url, (response) => {
		response.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			if (buffer.includes("event: ready")) resolveReady();
			if (buffer.includes("event: reload")) {
				clearTimeout(timeout);
				req.destroy();
				resolveEvent(buffer);
			}
		});
	});
	req.on("error", (error) => {
		if (!buffer.includes("event: ready")) rejectReady(error);
		if (waitForReload && !buffer.includes("event: reload")) rejectEvent(error);
	});
	return {
		ready,
		event,
		close: () => {
			clearTimeout(timeout);
			req.destroy();
		},
	};
}

function openIncompleteRequest() {
	return new Promise((resolve, reject) => {
		const socket = connect(49327, "127.0.0.1");
		let response = "";
		const timeout = setTimeout(
			() => finish(new Error(`incomplete request timeout: ${response}`)),
			1_000,
		);
		const finish = (error) => {
			clearTimeout(timeout);
			if (error) {
				socket.destroy();
				reject(error);
			} else resolve(socket);
		};
		socket.once("error", finish);
		socket.once("connect", () => {
			socket.write(
				"POST /control/reports HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n4\r\ntest\r\n",
			);
		});
		socket.on("data", (chunk) => {
			response += chunk.toString("utf8");
			if (response.includes(" 401 ")) finish();
		});
	});
}

function listen(server, port) {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", resolve);
	});
}

function closeServer(server) {
	return new Promise((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
}

async function killPid(pid) {
	try {
		process.kill(pid, "SIGTERM");
	} catch (error) {
		if (error?.code !== "ESRCH") throw error;
		return;
	}
	await waitUntilDead(pid);
}

function waitUntilDead(pid, timeoutMs = 3_000) {
	return new Promise((resolve, reject) => {
		const deadline = setTimeout(
			() => reject(new Error(`pid ${pid} did not exit`)),
			timeoutMs,
		);
		const check = () => {
			try {
				process.kill(pid, 0);
			} catch (error) {
				if (error?.code === "ESRCH") {
					clearTimeout(deadline);
					resolve();
					return;
				}
			}
			setTimeout(check, 20);
		};
		check();
	});
}

function waitForMissing(path, timeoutMs = 3_000) {
	return waitForCondition(
		() => {
			try {
				statSync(path);
				return undefined;
			} catch (error) {
				return error?.code === "ENOENT" ? true : undefined;
			}
		},
		timeoutMs,
		`path remained: ${path}`,
	);
}

function waitForEndpointPid(path, previousPid, timeoutMs = 5_000) {
	return waitForCondition(
		() => {
			const endpoint = safeEndpoint(path);
			return endpoint?.pid && endpoint.pid !== previousPid
				? endpoint
				: undefined;
		},
		timeoutMs,
		"replacement daemon did not appear",
	);
}

function waitForCondition(read, timeoutMs, message) {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		const check = () => {
			const value = read();
			if (value) return resolve(value);
			if (Date.now() >= deadline) return reject(new Error(message));
			setTimeout(check, 20);
		};
		check();
	});
}

function safeEndpoint(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
