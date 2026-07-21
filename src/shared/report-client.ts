import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	watch,
	writeFileSync,
} from "node:fs";
import { type ClientRequest, type IncomingMessage, request } from "node:http";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Language, type ReportConfig, readFlowConfig } from "./config.js";
import { formatError } from "./guards.js";
import {
	parseReportEndpoint,
	parseReportHealth,
	parseReportRegistration,
	REPORT_PROTOCOL,
	REPORT_SERVICE,
	type ReportEndpoint,
	type ReportHealth,
	type ReportLifecycle,
	type ReportRegistration,
	reportBaseUrl,
} from "./report-protocol.js";
import { type StatusSink, setStatusSafe } from "./status.js";
import { formatUserNotice } from "./ui-language.js";

const STATUS_KEY = "pi-flow-html-live";
const STARTUP_DEADLINE_MS = 5_000;
const ACCESS_KEY_BYTES = 32;
const MINIMUM_NODE_VERSION = [22, 19, 0] as const;

interface ReportContext extends StatusSink {
	cwd: string;
	ui: StatusSink["ui"] & {
		notify?: (message: string, level?: "info" | "warning" | "error") => void;
	};
}

interface ReportConnection {
	config: ReportConfig;
	endpoint: ReportEndpoint;
	key: Buffer;
	request: ClientRequest;
	response: IncomingMessage;
}

interface RegisteredReport {
	cwd: string;
	path: string;
	state: ReportLifecycle["state"];
	generation: number;
	registration: ReportRegistration;
}

interface ClosedReportConnection {
	requestDestroyed: boolean;
	responseDestroyed: boolean;
}

const backgroundTasks = new Set<Promise<void>>();
const statusContextEpochs = new WeakMap<StatusSink, number>();
const registerChains = new Map<string, Promise<unknown>>();

const state: {
	connection?: ReportConnection;
	connecting?: Promise<ReportConnection>;
	reports: Map<string, RegisteredReport>;
	opened: Set<string>;
	statusCtx?: StatusSink;
	statusLanguage?: Language;
	statusUrl?: string;
	automaticReconnectAvailable: boolean;
	closing: boolean;
	warnedRemoteBind: boolean;
	reportedFailure?: string;
	failureCount: number;
	lastClosedConnection?: ClosedReportConnection;
} = {
	reports: new Map(),
	opened: new Set(),
	automaticReconnectAvailable: true,
	closing: false,
	warnedRemoteBind: false,
	failureCount: 0,
};

export function openLiveHtmlInBackgroundOnce(
	pi: Pick<ExtensionAPI, "exec">,
	ctx: ReportContext,
	htmlPath: string,
	language: Language | undefined,
	lifecycle: ReportLifecycle,
) {
	const epoch = beginStatusContextBinding(ctx);
	runReportSideEffect(ctx, language, epoch, async () => {
		const path = resolve(htmlPath);
		const openKey = `${path}#${lifecycle.generation}`;
		const url = await liveReportUrlForBinding(
			ctx,
			path,
			language,
			lifecycle,
			epoch,
		);
		if (!statusContextBindingIsCurrent(ctx, epoch) || state.opened.has(openKey))
			return;
		state.opened.add(openKey);
		await openUrl(pi, url).catch(() => undefined);
	});
}

export function bindLiveReport(
	ctx: ReportContext,
	htmlPath: string,
	language: Language | undefined,
	lifecycle: ReportLifecycle,
) {
	const epoch = beginStatusContextBinding(ctx);
	runReportSideEffect(ctx, language, epoch, async () => {
		await liveReportUrlForBinding(ctx, htmlPath, language, lifecycle, epoch);
	});
}

export async function liveReportUrl(
	ctx: ReportContext,
	htmlPath: string,
	language: Language | undefined,
	lifecycle: ReportLifecycle,
) {
	const epoch = beginStatusContextBinding(ctx);
	return liveReportUrlForBinding(ctx, htmlPath, language, lifecycle, epoch);
}

async function liveReportUrlForBinding(
	ctx: ReportContext,
	htmlPath: string,
	language: Language | undefined,
	lifecycle: ReportLifecycle,
	epoch: number,
) {
	if (state.closing) {
		state.failureCount = 0;
		state.lastClosedConnection = undefined;
	}
	state.closing = false;
	state.automaticReconnectAvailable = true;
	const path = resolve(htmlPath);
	const connection = await ensureConnection();
	if (statusContextBindingIsCurrent(ctx, epoch))
		warnForRemoteBind(ctx, connection.config.bind, language);
	const cwd = resolve(ctx.cwd);
	const registration = await registerReportSerialized(
		connection,
		cwd,
		path,
		lifecycle,
	);
	if (statusContextBindingIsCurrent(ctx, epoch)) {
		state.statusCtx = ctx;
		state.statusLanguage = language;
		state.statusUrl = registration.publicUrl;
		writeStatus();
	}
	return registration.publicUrl;
}

function runReportSideEffect(
	ctx: ReportContext,
	language: Language | undefined,
	epoch: number,
	run: () => Promise<void>,
) {
	const task = run()
		.then(() => {
			if (statusContextBindingIsCurrent(ctx, epoch))
				state.reportedFailure = undefined;
		})
		.catch((error) => {
			state.failureCount += 1;
			if (statusContextBindingIsCurrent(ctx, epoch))
				notifyReportFailureOnce(ctx, error, language);
		});
	backgroundTasks.add(task);
	void task.then(() => backgroundTasks.delete(task));
}

function notifyReportFailureOnce(
	ctx: ReportContext,
	error: unknown,
	language: Language | undefined,
) {
	if (state.closing) return;
	const message = formatError(error);
	if (state.reportedFailure === message) return;
	state.reportedFailure = message;
	try {
		ctx.ui.notify?.(
			language === "en"
				? formatUserNotice("⚠️", "Flow web report unavailable", [
						message,
						"The task continues and Flow state is unaffected",
					])
				: formatUserNotice("⚠️", "Flow 网页报告不可用", [
						message,
						"任务继续运行，Flow 状态不受影响",
					]),
			"info",
		);
	} catch {}
}

export async function notifyReportChanged(filePath: string) {
	const report = state.reports.get(resolve(filePath));
	const connection = state.connection;
	if (!report || !connection) return;
	try {
		await postChanged(connection, report.registration.cap);
	} catch {}
}

function beginStatusContextBinding(ctx: StatusSink) {
	const epoch = (statusContextEpochs.get(ctx) ?? 0) + 1;
	statusContextEpochs.set(ctx, epoch);
	return epoch;
}

function statusContextBindingIsCurrent(ctx: StatusSink, epoch: number) {
	return statusContextEpochs.get(ctx) === epoch;
}

export function releaseReportStatusContext(ctx: StatusSink) {
	beginStatusContextBinding(ctx);
	if (state.statusCtx !== ctx) return false;
	setStatusSafe(ctx, STATUS_KEY, undefined);
	state.statusCtx = undefined;
	return true;
}

export function reportClientResourceSnapshot() {
	const connection = state.connection;
	return {
		backgroundTasks: backgroundTasks.size,
		connecting: state.connecting !== undefined,
		connected:
			connection !== undefined &&
			!connection.request.destroyed &&
			!connection.response.destroyed,
		registeredReports: state.reports.size,
		registerChains: registerChains.size,
		statusContext: state.statusCtx !== undefined,
		failureCount: state.failureCount,
		requestDestroyed: connection?.request.destroyed ?? null,
		responseDestroyed: connection?.response.destroyed ?? null,
		lastClosedConnection: state.lastClosedConnection ?? null,
	};
}

export async function waitForReportClientIdle(): Promise<void> {
	const tasks: Promise<unknown>[] = [...backgroundTasks];
	if (state.connecting) tasks.push(state.connecting.catch(() => undefined));
	if (tasks.length === 0) return;
	await Promise.all(tasks);
	return waitForReportClientIdle();
}

export async function closeReportClient() {
	state.closing = true;
	await waitForReportClientIdle();
	const connection = state.connection;
	state.connection = undefined;
	state.connecting = undefined;
	connection?.response.destroy();
	connection?.request.destroy();
	state.lastClosedConnection = connection
		? {
				requestDestroyed: connection.request.destroyed,
				responseDestroyed: connection.response.destroyed,
			}
		: undefined;
	if (state.statusCtx) setStatusSafe(state.statusCtx, STATUS_KEY, undefined);
	state.statusCtx = undefined;
	state.statusUrl = undefined;
	state.reports.clear();
	state.opened.clear();
	registerChains.clear();
	state.reportedFailure = undefined;
}

async function ensureConnection() {
	if (state.connection && !state.connection.response.destroyed)
		return state.connection;
	if (state.connecting) return state.connecting;
	const pending = connectAndRestore();
	state.connecting = pending;
	try {
		return await pending;
	} finally {
		if (state.connecting === pending) state.connecting = undefined;
	}
}

async function connectAndRestore() {
	const config = readFlowConfig().report;
	const runtimeDir = reportRuntimeDir();
	const key = accessKey(runtimeDir);
	const endpoint = await ensureDaemon(config, runtimeDir, key);
	const connection = await connectControl(config, endpoint, key);
	state.connection = connection;
	watchConnection(connection);
	try {
		for (const report of state.reports.values())
			report.registration = await registerReportSerialized(
				connection,
				report.cwd,
				report.path,
				{
					state: report.state,
					generation: report.generation,
				},
			);
		return connection;
	} catch (error) {
		connection.response.destroy();
		connection.request.destroy();
		if (state.connection === connection) state.connection = undefined;
		throw error;
	}
}

function watchConnection(connection: ReportConnection) {
	let settled = false;
	const disconnected = () => {
		if (settled) return;
		settled = true;
		if (state.connection !== connection) return;
		state.connection = undefined;
		if (
			state.closing ||
			state.reports.size === 0 ||
			!state.automaticReconnectAvailable
		)
			return;
		state.automaticReconnectAvailable = false;
		void ensureConnection().catch(() => undefined);
	};
	connection.response.once("close", disconnected);
	connection.response.once("error", disconnected);
	connection.request.once("error", disconnected);
}

async function ensureDaemon(
	config: ReportConfig,
	runtimeDir: string,
	key: Buffer,
): Promise<ReportEndpoint> {
	const deadline = Date.now() + STARTUP_DEADLINE_MS;
	return discoverOrStart(config, runtimeDir, key, deadline);
}

async function discoverOrStart(
	config: ReportConfig,
	runtimeDir: string,
	key: Buffer,
	deadline: number,
): Promise<ReportEndpoint> {
	const discovered = await discoverEndpoint(config, runtimeDir, deadline);
	if (discovered) return discovered;
	if ((await configuredPortState(config, deadline)) === "daemon") {
		const starting = await discoverStartingEndpoint(
			config,
			runtimeDir,
			deadline,
		);
		if (starting) return starting;
		throw new Error(
			"A pi-flow report daemon is listening without valid endpoint discovery; close it before retrying",
		);
	}
	const lock = acquireStartupLock(runtimeDir);
	if (!lock.owned) {
		await waitForStartupChange(runtimeDir, deadline);
		return discoverOrStart(config, runtimeDir, key, deadline);
	}
	try {
		const afterLock = await discoverEndpoint(config, runtimeDir, deadline);
		if (afterLock) return afterLock;
		if ((await configuredPortState(config, deadline)) === "daemon")
			throw new Error(
				"A pi-flow report daemon is listening without valid endpoint discovery; close it before retrying",
			);
		return await spawnDaemon(config, runtimeDir, deadline);
	} finally {
		lock.release();
	}
}

async function discoverEndpoint(
	config: ReportConfig,
	runtimeDir: string,
	deadline: number,
) {
	const path = join(runtimeDir, "endpoint.json");
	let endpoint: ReportEndpoint | undefined;
	try {
		endpoint = parseReportEndpoint(JSON.parse(readFileSync(path, "utf8")));
	} catch {}
	if (!endpoint) {
		if (existsSync(path)) rmSync(path, { force: true });
		return undefined;
	}
	if (!pidAlive(endpoint.pid)) {
		rmSync(path, { force: true });
		return undefined;
	}
	if (endpoint.bind !== config.bind || endpoint.port !== config.port)
		throw new Error(
			`Report daemon is already running at ${endpoint.bind}:${endpoint.port}; close existing report connections before changing report.bind or report.port`,
		);
	const probe = await probeHealth(endpoint.bind, endpoint.port, deadline);
	if (probe.kind === "ok" && probe.health.pid === endpoint.pid) return endpoint;
	if (probe.kind === "protocol") throw protocolError(probe.protocol);
	rmSync(path, { force: true });
	return undefined;
}

async function discoverStartingEndpoint(
	config: ReportConfig,
	runtimeDir: string,
	deadline: number,
) {
	const discovered = await discoverEndpoint(config, runtimeDir, deadline);
	if (discovered) return discovered;
	const owner = readLockOwner(join(runtimeDir, "startup.lock"));
	if (owner && pidAlive(owner.pid))
		await waitForStartupChange(runtimeDir, deadline);
	return discoverEndpoint(config, runtimeDir, deadline);
}

async function configuredPortState(config: ReportConfig, deadline: number) {
	const probe = await probeHealth(config.bind, config.port, deadline);
	if (probe.kind === "absent") return "free" as const;
	if (probe.kind === "protocol") throw protocolError(probe.protocol);
	if (probe.kind === "ok") return "daemon" as const;
	throw new Error(
		`Report port ${config.port} is occupied by an unknown service; pi-flow will not choose a fallback port`,
	);
}

function acquireStartupLock(runtimeDir: string) {
	const path = join(runtimeDir, "startup.lock");
	const owner = { pid: process.pid, startedAt: Date.now() };
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			writeFileSync(path, `${JSON.stringify(owner)}\n`, {
				flag: "wx",
				mode: 0o600,
			});
			return {
				owned: true as const,
				release: () => removeOwnLock(path, owner),
			};
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
			const current = readLockOwner(path);
			if (current && pidAlive(current.pid))
				return { owned: false as const, release: () => {} };
			rmSync(path, { force: true });
		}
	}
	return { owned: false as const, release: () => {} };
}

function waitForStartupChange(runtimeDir: string, deadline: number) {
	return new Promise<void>((resolveWait, rejectWait) => {
		const lockPath = join(runtimeDir, "startup.lock");
		let finished = false;
		const watcher = watch(runtimeDir, (_event, filename) => {
			if (
				filename !== null &&
				filename !== "startup.lock" &&
				filename !== "endpoint.json"
			)
				return;
			check();
		});
		const timeout = setTimeout(
			() => finish(new Error("Timed out starting the report daemon")),
			remaining(deadline),
		);
		const check = () => {
			if (
				existsSync(lockPath) &&
				!existsSync(join(runtimeDir, "endpoint.json"))
			)
				return;
			finish();
		};
		const finish = (error?: Error) => {
			if (finished) return;
			finished = true;
			clearTimeout(timeout);
			watcher.close();
			if (error) rejectWait(error);
			else resolveWait();
		};
		check();
	});
}

async function spawnDaemon(
	config: ReportConfig,
	runtimeDir: string,
	deadline: number,
) {
	// 编译版 Pi 的 process.execPath 是应用本身，不是能执行 .js 的 runtime。
	// 旧 Node 不是合格候选；其余仅命令不存在时 fallback，真实启动错误原样暴露。
	for (const runtime of reportRuntimeCandidates()) {
		if (
			runtime.kind === "node" &&
			!(await nodeRuntimeSupported(runtime.command, deadline))
		)
			continue;
		try {
			return await spawnDaemonWithRuntime(
				runtime.command,
				config,
				runtimeDir,
				deadline,
			);
		} catch (error) {
			if (errorCode(error) !== "ENOENT") throw error;
		}
	}
	throw new Error("Pi Flow Web Report requires Node.js >=22.19 or Bun in PATH");
}

function reportRuntimeCandidates(): Array<{
	command: string;
	kind: "node" | "bun";
}> {
	const executable = basename(process.execPath).toLowerCase();
	if (["bun", "bun.exe"].includes(executable))
		return [{ command: process.execPath, kind: "bun" }];
	if (["node", "node.exe", "nodejs"].includes(executable))
		return [
			{ command: process.execPath, kind: "node" },
			{ command: "bun", kind: "bun" },
		];
	return [
		{ command: "node", kind: "node" },
		{ command: "bun", kind: "bun" },
	];
}

function nodeRuntimeSupported(command: string, deadline: number) {
	if (command === process.execPath && !process.versions.bun)
		return Promise.resolve(nodeVersionSupported(process.versions.node));
	return new Promise<boolean>((resolveVersion, rejectVersion) => {
		const child = spawn(command, ["--version"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let finished = false;
		const timeout = setTimeout(
			() => finish(new Error("Timed out checking the Node.js version")),
			remaining(deadline),
		);
		const finish = (error?: Error, supported?: boolean) => {
			if (finished) return;
			finished = true;
			clearTimeout(timeout);
			child.removeAllListeners();
			if (error) {
				try {
					child.kill("SIGKILL");
				} catch {}
				rejectVersion(error);
			} else resolveVersion(supported ?? false);
		};
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", (error) => {
			if (errorCode(error) === "ENOENT") finish(undefined, false);
			else finish(error);
		});
		child.once("close", (code, signal) => {
			if (code !== 0)
				return finish(
					new Error(
						`Node.js version check failed (${code ?? signal ?? "unknown"}): ${stderr.trim()}`,
					),
				);
			const supported = nodeVersionSupported(stdout);
			if (supported === undefined)
				return finish(
					new Error(`Node.js returned an invalid version: ${stdout.trim()}`),
				);
			finish(undefined, supported);
		});
	});
}

function nodeVersionSupported(version: string | undefined) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version?.trim() ?? "");
	if (!match) return undefined;
	const actual = match.slice(1).map(Number);
	for (const [index, minimum] of MINIMUM_NODE_VERSION.entries()) {
		if (actual[index] !== minimum) return (actual[index] ?? 0) > minimum;
	}
	return true;
}

function spawnDaemonWithRuntime(
	runtime: string,
	config: ReportConfig,
	runtimeDir: string,
	deadline: number,
) {
	return new Promise<ReportEndpoint>((resolveSpawn, rejectSpawn) => {
		// realpath：经 extensions 符号链接加载时避免 symlink argv；否则 daemon 主模块判断失败会静默 exit 0。
		const daemonEntry = realpathSync(
			fileURLToPath(new URL("../report-daemon.js", import.meta.url)),
		);
		const child = spawn(runtime, [daemonEntry], {
			detached: true,
			stdio: ["ignore", "ignore", "ignore", "ipc"],
		});
		let finished = false;
		const timeout = setTimeout(
			() => finish(new Error("Timed out starting the report daemon")),
			remaining(deadline),
		);
		const finish = (error?: Error, endpoint?: ReportEndpoint) => {
			if (finished) return;
			finished = true;
			clearTimeout(timeout);
			child.removeAllListeners();
			if (endpoint) {
				// 成功：父进程独占断开 IPC，daemon 靠 listen + idle timer 保活。
				if (child.connected) {
					try {
						child.disconnect();
					} catch {
						/* TOCTOU: channel closed between check and disconnect */
					}
				}
			} else {
				// 超时/错误：杀掉未 ready 的子进程，避免占端口或留下半开 daemon。
				try {
					child.kill("SIGKILL");
				} catch {}
			}
			child.unref();
			if (endpoint) resolveSpawn(endpoint);
			else
				rejectSpawn(
					error ?? new Error("Report daemon startup finished without result"),
				);
		};
		child.once("error", (error) => finish(error));
		child.once("exit", (code, signal) =>
			finish(
				new Error(
					`Report daemon exited before ready (${code ?? signal ?? "unknown"})`,
				),
			),
		);
		child.on("message", (message) => {
			if (isReadyMessage(message)) {
				const endpoint = readEndpoint(runtimeDir);
				if (!endpoint || endpoint.pid !== message.health.pid)
					return finish(new Error("Report daemon ready endpoint is invalid"));
				return finish(undefined, endpoint);
			}
			if (isErrorMessage(message))
				finish(
					message.protocol === REPORT_PROTOCOL
						? new Error(message.message)
						: protocolError(message.protocol),
				);
		});
		child.once("spawn", () => {
			child.send({
				type: "start",
				protocol: REPORT_PROTOCOL,
				config,
				runtimeDir,
			});
		});
	});
}

function connectControl(
	config: ReportConfig,
	endpoint: ReportEndpoint,
	key: Buffer,
) {
	return new Promise<ReportConnection>((resolveConnect, rejectConnect) => {
		const target = new URL(
			"/control/connect",
			reportBaseUrl(config.bind, config.port),
		);
		const control = request(
			target,
			{
				method: "GET",
				agent: false,
				headers: { Authorization: `Bearer ${key.toString("base64url")}` },
			},
			(response) => {
				if (response.statusCode !== 200) {
					response.resume();
					return rejectConnect(
						new Error(`Report daemon control failed (${response.statusCode})`),
					);
				}
				response.socket.unref();
				resolveConnect({ config, endpoint, key, request: control, response });
			},
		);
		control.once("error", rejectConnect);
		control.end();
	});
}

function registerReportSerialized(
	connection: ReportConnection,
	cwd: string,
	path: string,
	lifecycle: ReportLifecycle,
) {
	const previous = registerChains.get(path) ?? Promise.resolve();
	const next = previous.then(
		() => registerReport(connection, cwd, path, lifecycle),
		() => registerReport(connection, cwd, path, lifecycle),
	);
	// settle 后仅当仍是队尾时退订，避免永久按 path 堆积 Promise。
	const settled = next.then(
		() => undefined,
		() => undefined,
	);
	registerChains.set(path, settled);
	void settled.then(() => {
		if (registerChains.get(path) === settled) registerChains.delete(path);
	});
	return next;
}

async function registerReport(
	connection: ReportConnection,
	cwd: string,
	path: string,
	lifecycle: ReportLifecycle,
) {
	const existing = state.reports.get(path);
	if (
		existing &&
		existing.cwd === cwd &&
		existing.state === lifecycle.state &&
		existing.generation === lifecycle.generation &&
		state.connection === connection
	)
		return existing.registration;
	const response = await postJson(
		connection,
		"/control/reports",
		JSON.stringify({
			cwd,
			path,
			state: lifecycle.state,
			generation: lifecycle.generation,
		}),
	);
	if (response.status === 409)
		throw new Error(
			`Report registration conflict (${lifecycle.state}#${lifecycle.generation})`,
		);
	if (response.status !== 200)
		throw new Error(`Report registration failed (${String(response.status)})`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(response.body);
	} catch {
		throw new Error("Report daemon returned invalid registration JSON");
	}
	const registration = parseReportRegistration(parsed);
	if (!registration)
		throw new Error("Report daemon returned an invalid registration");
	const expectedPublic = reportUrl(
		connection.config.publicBaseUrl ??
			reportBaseUrl(connection.config.bind, connection.config.port),
		registration.cap,
	);
	if (registration.publicUrl !== expectedPublic)
		throw new Error(
			"Report daemon publicBaseUrl differs from the current config; close existing report connections before retrying",
		);
	state.reports.set(path, {
		cwd,
		path,
		state: lifecycle.state,
		generation: lifecycle.generation,
		registration,
	});
	return registration;
}

async function postChanged(connection: ReportConnection, cap: string) {
	const response = await postJson(
		connection,
		`/control/reports/${cap}/changed`,
		undefined,
	);
	if (response.status !== 204)
		throw new Error(
			`Report change notification failed (${String(response.status)})`,
		);
}

function postJson(
	connection: ReportConnection,
	path: string,
	body: string | undefined,
) {
	return new Promise<{ status: number; body: string }>(
		(resolvePost, rejectPost) => {
			const headers: Record<string, string | number> = {
				Authorization: `Bearer ${connection.key.toString("base64url")}`,
			};
			if (body !== undefined) {
				headers["Content-Type"] = "application/json";
				headers["Content-Length"] = Buffer.byteLength(body);
			}
			const target = new URL(
				path,
				reportBaseUrl(connection.config.bind, connection.config.port),
			);
			const post = request(target, { method: "POST", headers }, (response) => {
				let content = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => {
					content += chunk;
				});
				response.on("end", () =>
					resolvePost({ status: response.statusCode ?? 0, body: content }),
				);
			});
			post.once("error", rejectPost);
			post.end(body);
		},
	);
}

async function probeHealth(bind: string, port: number, deadline: number) {
	try {
		const response = await getJson(
			new URL("/health", reportBaseUrl(bind, port)),
			deadline,
		);
		if (response.status !== 200) return { kind: "unknown" as const };
		const health = parseReportHealth(response.value);
		if (health) return { kind: "ok" as const, health };
		if (isRecord(response.value) && response.value.service === REPORT_SERVICE)
			return {
				kind: "protocol" as const,
				protocol: response.value.protocol,
			};
		return { kind: "unknown" as const };
	} catch (error) {
		if (
			["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].includes(
				errorCode(error) ?? "",
			)
		)
			return { kind: "absent" as const };
		if (error instanceof SyntaxError) return { kind: "unknown" as const };
		throw error;
	}
}

function getJson(url: URL, deadline: number) {
	return new Promise<{ status: number; value: unknown }>(
		(resolveGet, rejectGet) => {
			const health = request(
				url,
				{ method: "GET", agent: false },
				(response) => {
					let body = "";
					response.setEncoding("utf8");
					response.on("data", (chunk) => {
						body += chunk;
					});
					response.on("end", () => {
						try {
							resolveGet({
								status: response.statusCode ?? 0,
								value: JSON.parse(body) as unknown,
							});
						} catch (error) {
							rejectGet(error);
						}
					});
				},
			);
			health.setTimeout(remaining(deadline), () =>
				health.destroy(new Error("Report daemon health check timed out")),
			);
			health.once("error", rejectGet);
			health.end();
		},
	);
}

function accessKey(runtimeDir: string) {
	mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
	chmodSync(runtimeDir, 0o700);
	const path = join(runtimeDir, "access.key");
	try {
		writeFileSync(path, randomBytes(ACCESS_KEY_BYTES), {
			flag: "wx",
			mode: 0o600,
		});
	} catch (error) {
		if (errorCode(error) !== "EEXIST") throw error;
	}
	chmodSync(path, 0o600);
	const key = readFileSync(path);
	if (key.length !== ACCESS_KEY_BYTES)
		throw new Error("Report access key is invalid");
	return key;
}

function reportRuntimeDir() {
	const agentDir =
		process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	return join(agentDir, "pi-flow-report");
}

function writeStatus() {
	if (!state.statusCtx || !state.statusUrl) return;
	setStatusSafe(
		state.statusCtx,
		STATUS_KEY,
		state.statusLanguage === "en"
			? `🌐 Web report: ${state.statusUrl}`
			: `🌐 网页报告: ${state.statusUrl}`,
		state.statusLanguage,
	);
}

function warnForRemoteBind(
	ctx: ReportContext,
	bind: string,
	language: Language | undefined,
) {
	if (state.warnedRemoteBind || isLoopback(bind)) return;
	state.warnedRemoteBind = true;
	ctx.ui.notify?.(
		language === "en"
			? `Report service is listening on ${bind}; protect the capability URL with Tailscale ACLs and host firewall rules.`
			: `报告服务正在监听 ${bind}；请用 Tailscale ACL 与主机防火墙保护 capability URL。`,
		"warning",
	);
}

function isLoopback(bind: string) {
	return bind === "localhost" || bind === "::1" || bind.startsWith("127.");
}

function readEndpoint(runtimeDir: string) {
	try {
		return parseReportEndpoint(
			JSON.parse(readFileSync(join(runtimeDir, "endpoint.json"), "utf8")),
		);
	} catch {
		return undefined;
	}
}

function readLockOwner(path: string) {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isRecord(value)) return undefined;
		if (
			typeof value.pid !== "number" ||
			!Number.isInteger(value.pid) ||
			value.pid <= 0 ||
			typeof value.startedAt !== "number" ||
			!Number.isFinite(value.startedAt)
		)
			return undefined;
		return { pid: value.pid, startedAt: value.startedAt };
	} catch {
		return undefined;
	}
}

function removeOwnLock(
	path: string,
	owner: { pid: number; startedAt: number },
) {
	const current = readLockOwner(path);
	if (current?.pid === owner.pid && current.startedAt === owner.startedAt)
		rmSync(path, { force: true });
}

function pidAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return errorCode(error) !== "ESRCH";
	}
}

function remaining(deadline: number) {
	const value = deadline - Date.now();
	if (value <= 0) throw new Error("Timed out starting the report daemon");
	return value;
}

function protocolError(protocol: unknown) {
	return new Error(
		`Incompatible pi-flow report protocol ${String(protocol)}; expected ${REPORT_PROTOCOL}`,
	);
}

function isReadyMessage(value: unknown): value is {
	type: "ready";
	protocol: typeof REPORT_PROTOCOL;
	health: ReportHealth;
} {
	return (
		isRecord(value) &&
		value.type === "ready" &&
		value.protocol === REPORT_PROTOCOL &&
		parseReportHealth(value.health) !== undefined
	);
}

function isErrorMessage(
	value: unknown,
): value is { protocol: number; message: string } {
	return (
		isRecord(value) &&
		value.type === "error" &&
		typeof value.protocol === "number" &&
		Number.isSafeInteger(value.protocol) &&
		typeof value.message === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown) {
	return isRecord(error) && typeof error.code === "string"
		? error.code
		: undefined;
}

function reportUrl(base: string, cap: string) {
	return new URL(`r/${cap}/`, `${base}/`).href;
}

function openUrl(pi: Pick<ExtensionAPI, "exec">, url: string) {
	const command = openCommand(url);
	return pi.exec(command.command, command.args);
}

function openCommand(url: string) {
	if (process.platform === "darwin") return { command: "open", args: [url] };
	if (process.platform === "win32")
		return { command: "cmd", args: ["/c", "start", "", url] };
	return { command: "xdg-open", args: [url] };
}
