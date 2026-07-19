import { fork, spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import {
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
			health.service === "pi-flow-report" && health.protocol === 1,
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
		assert(
			(await fetch("http://127.0.0.1:49327/")).status === 404,
			"root exposed a report index",
		);
		assert(
			(await fetch("http://127.0.0.1:49327/events")).status === 404,
			"root SSE route still exists",
		);

		const accessKey = readFileSync(join(runtimeDir, "access.key"));
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
					{ cwd: workspaceA, path: flowA },
					"bad-key",
				)
			).status === 401,
			"bad control auth was accepted",
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
		])
			assert(
				(await fetch(`http://127.0.0.1:49327${path}`)).status === 404,
				`unsafe route was served: ${path}`,
			);

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
		const url = await client.liveReportUrl(ctx, path, "zh");
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
					protocol: 1,
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
			protocol: 1,
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
			protocol: 1,
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

async function registerReport(key, cwd, path) {
	return postJson(
		"http://127.0.0.1:49327/control/reports",
		{ cwd, path },
		key.toString("base64url"),
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
