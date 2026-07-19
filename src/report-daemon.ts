import {
	chmodSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { ReportConfig } from "./shared/config.js";
import {
	bearerMatches,
	isCapability,
	parseReportDaemonStart,
	parseReportRegistrationRequest,
	REPORT_PROTOCOL,
	REPORT_SERVICE,
	type ReportEndpoint,
	type ReportHealth,
	type ReportRegistration,
	reportBaseUrl,
	reportCapability,
} from "./shared/report-protocol.js";

const IDLE_MS = 15 * 60_000;
const MAX_BODY_BYTES = 16 * 1024;
const FLOW_ID = /^F[1-9]\d*$/u;
const REVIEW_FILE = /^[^/\\]+\.html$/u;

interface RegisteredReport {
	path: string;
	realPath: string;
}

interface ReportDaemonState {
	config: ReportConfig;
	runtimeDir: string;
	key: Buffer;
	server: Server;
	health: ReportHealth;
	reports: Map<string, RegisteredReport>;
	controlClients: Set<ServerResponse>;
	browserClients: Map<string, Set<ServerResponse>>;
	sockets: Set<Socket>;
	idleMs: number;
	idleTimer?: NodeJS.Timeout;
	closing: boolean;
	closePromise?: Promise<void>;
}

export interface ReportDaemonInput {
	config: ReportConfig;
	runtimeDir: string;
	idleMs: number;
}

export interface RunningReportDaemon {
	health: ReportHealth;
	close: () => Promise<void>;
}

export async function startReportDaemon(
	input: ReportDaemonInput,
): Promise<RunningReportDaemon> {
	mkdirSync(input.runtimeDir, { recursive: true, mode: 0o700 });
	chmodSync(input.runtimeDir, 0o700);
	const key = readFileSync(`${input.runtimeDir}/access.key`);
	if (key.length !== 32) throw new Error("Report access key is invalid");
	const state = {} as ReportDaemonState;
	const server = createServer((request, response) => {
		void handleRequest(state, request, response).catch(() => {
			if (!response.headersSent) writeText(response, 500, "internal error");
			else response.destroy();
		});
	});
	server.on("connection", (socket) => {
		state.sockets.add(socket);
		socket.once("close", () => state.sockets.delete(socket));
	});
	const health: ReportHealth = {
		service: REPORT_SERVICE,
		protocol: REPORT_PROTOCOL,
		pid: process.pid,
		bind: input.config.bind,
		port: input.config.port,
	};
	Object.assign(state, {
		config: input.config,
		runtimeDir: input.runtimeDir,
		key,
		server,
		health,
		reports: new Map(),
		controlClients: new Set(),
		browserClients: new Map(),
		sockets: new Set(),
		idleMs: input.idleMs,
		closing: false,
	});
	await listen(server, input.config.bind, input.config.port);
	try {
		writeEndpoint(input.runtimeDir, {
			protocol: REPORT_PROTOCOL,
			pid: process.pid,
			bind: input.config.bind,
			port: input.config.port,
			startedAt: Date.now(),
		});
		const close = () => closeDaemon(state);
		const stop = () => void close();
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
		server.once("error", stop);
		server.unref();
		syncIdleTimer(state);
		return { health, close };
	} catch (error) {
		await closeDaemon(state);
		throw error;
	}
}

async function handleRequest(
	state: ReportDaemonState,
	request: IncomingMessage,
	response: ServerResponse,
) {
	secureHeaders(response);
	const url = requestUrl(request);
	if (!url) return writeText(response, 400, "bad request");
	if (
		(request.method !== "POST" || url.pathname !== "/control/reports") &&
		requestHasBody(request)
	)
		return writeText(response, 400, "body not allowed");
	if (url.pathname === "/health") {
		if (request.method !== "GET") return methodNotAllowed(response);
		return writeJson(response, 200, state.health);
	}
	if (url.pathname === "/control/connect")
		return handleControlConnection(state, request, response);
	if (url.pathname === "/control/reports")
		return handleRegistration(state, request, response);
	const changed = /^\/control\/reports\/([^/]+)\/changed$/u.exec(url.pathname);
	if (changed) return handleChanged(state, request, response, changed[1] ?? "");
	const report = /^\/r\/([^/]+)\/$/u.exec(url.pathname);
	if (report) return serveReport(state, request, response, report[1] ?? "");
	const events = /^\/r\/([^/]+)\/events$/u.exec(url.pathname);
	if (events)
		return handleBrowserEvents(state, request, response, events[1] ?? "");
	return notFound(response);
}

function handleControlConnection(
	state: ReportDaemonState,
	request: IncomingMessage,
	response: ServerResponse,
) {
	if (request.method !== "GET") return methodNotAllowed(response);
	if (!authorized(state, request)) return unauthorized(response);
	response.writeHead(200, {
		"Content-Type": "application/octet-stream",
		"Cache-Control": "no-store",
		Connection: "keep-alive",
	});
	response.write("\n");
	state.controlClients.add(response);
	syncIdleTimer(state);
	response.once("close", () => {
		state.controlClients.delete(response);
		syncIdleTimer(state);
	});
}

async function handleRegistration(
	state: ReportDaemonState,
	request: IncomingMessage,
	response: ServerResponse,
) {
	if (request.method !== "POST") return methodNotAllowed(response);
	if (!authorized(state, request)) return unauthorized(response);
	const body = await readJsonBody(request);
	if (!body.ok) return writeText(response, body.status, body.message);
	const registration = parseReportRegistrationRequest(body.value);
	if (!registration) return writeText(response, 400, "invalid report");
	const report = await validateReport(registration.cwd, registration.path);
	if (!report) return notFound(response);
	const cap = reportCapability(state.key, report.realPath);
	state.reports.set(cap, report);
	const localUrl = reportUrl(
		reportBaseUrl(state.config.bind, state.config.port),
		cap,
	);
	const result: ReportRegistration = {
		cap,
		localUrl,
		publicUrl: reportUrl(
			state.config.publicBaseUrl ??
				reportBaseUrl(state.config.bind, state.config.port),
			cap,
		),
	};
	return writeJson(response, 200, result);
}

async function handleChanged(
	state: ReportDaemonState,
	request: IncomingMessage,
	response: ServerResponse,
	cap: string,
) {
	if (request.method !== "POST") return methodNotAllowed(response);
	if (!authorized(state, request)) return unauthorized(response);
	if (!isCapability(cap) || !state.reports.has(cap)) return notFound(response);
	for (const client of state.browserClients.get(cap) ?? [])
		client.write("event: reload\ndata: {}\n\n");
	response.writeHead(204);
	response.end();
}

async function serveReport(
	state: ReportDaemonState,
	request: IncomingMessage,
	response: ServerResponse,
	cap: string,
) {
	if (request.method !== "GET") return methodNotAllowed(response);
	const report = state.reports.get(cap);
	if (!isCapability(cap) || !report || !(await reportStillSafe(report)))
		return notFound(response);
	try {
		const html = await readFile(report.realPath);
		response.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-cache",
		});
		response.end(html);
	} catch {
		notFound(response);
	}
}

function handleBrowserEvents(
	state: ReportDaemonState,
	request: IncomingMessage,
	response: ServerResponse,
	cap: string,
) {
	if (request.method !== "GET") return methodNotAllowed(response);
	if (!isCapability(cap) || !state.reports.has(cap)) return notFound(response);
	response.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	response.write("event: ready\ndata: {}\n\n");
	const clients = state.browserClients.get(cap) ?? new Set<ServerResponse>();
	clients.add(response);
	state.browserClients.set(cap, clients);
	syncIdleTimer(state);
	response.once("close", () => {
		clients.delete(response);
		if (clients.size === 0) state.browserClients.delete(cap);
		syncIdleTimer(state);
	});
}

async function validateReport(
	cwd: string,
	path: string,
): Promise<RegisteredReport | undefined> {
	if (!isAbsolute(cwd) || !isAbsolute(path)) return undefined;
	try {
		const [cwdPath, reportPath, inputInfo, reportInfo] = await Promise.all([
			realpath(cwd),
			realpath(path),
			lstat(path),
			stat(path),
		]);
		if (inputInfo.isSymbolicLink() || !reportInfo.isFile()) return undefined;
		if (!validReportShape(cwdPath, reportPath)) return undefined;
		return { path: resolve(path), realPath: reportPath };
	} catch {
		return undefined;
	}
}

function validReportShape(cwd: string, path: string) {
	const parts = relative(cwd, path).split(sep);
	if (parts.length === 3 && parts[0] === ".flow") {
		if (FLOW_ID.test(parts[1] ?? "") && parts[2] === "flow.html") return true;
		if (parts[1] === "reviews" && REVIEW_FILE.test(parts[2] ?? "")) return true;
	}
	return false;
}

async function reportStillSafe(report: RegisteredReport) {
	try {
		const [inputInfo, reportPath, reportInfo] = await Promise.all([
			lstat(report.path),
			realpath(report.path),
			stat(report.path),
		]);
		return (
			!inputInfo.isSymbolicLink() &&
			reportInfo.isFile() &&
			reportPath === report.realPath
		);
	} catch {
		return false;
	}
}

function syncIdleTimer(state: ReportDaemonState) {
	if (state.closing) return;
	const active =
		state.controlClients.size > 0 ||
		[...state.browserClients.values()].some((clients) => clients.size > 0);
	if (active) {
		if (state.idleTimer) clearTimeout(state.idleTimer);
		state.idleTimer = undefined;
		return;
	}
	if (state.idleTimer) return;
	state.idleTimer = setTimeout(() => void closeDaemon(state), state.idleMs);
}

function closeDaemon(state: ReportDaemonState) {
	if (state.closePromise) return state.closePromise;
	state.closing = true;
	if (state.idleTimer) clearTimeout(state.idleTimer);
	for (const client of state.controlClients) client.end();
	for (const clients of state.browserClients.values())
		for (const client of clients) client.end();
	state.closePromise = new Promise<void>((resolveClose) => {
		state.server.close(() => {
			removeOwnEndpoint(state.runtimeDir);
			resolveClose();
		});
		for (const socket of state.sockets) socket.destroy();
	});
	return state.closePromise;
}

function listen(server: Server, bind: string, port: number) {
	return new Promise<void>((resolveListen, rejectListen) => {
		const onError = (error: Error) => rejectListen(error);
		server.once("error", onError);
		server.listen(port, bind, () => {
			server.off("error", onError);
			resolveListen();
		});
	});
}

function requestUrl(request: IncomingMessage) {
	try {
		return new URL(request.url ?? "", "http://report.invalid");
	} catch {
		return undefined;
	}
}

function requestHasBody(request: IncomingMessage) {
	return (
		request.headers["transfer-encoding"] !== undefined ||
		(request.headers["content-length"] !== undefined &&
			request.headers["content-length"] !== "0")
	);
}

function authorized(state: ReportDaemonState, request: IncomingMessage) {
	const header = request.headers.authorization;
	return bearerMatches(Array.isArray(header) ? undefined : header, state.key);
}

async function readJsonBody(request: IncomingMessage) {
	if (
		!String(request.headers["content-type"] ?? "").startsWith(
			"application/json",
		)
	)
		return { ok: false as const, status: 415, message: "json required" };
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_BODY_BYTES)
			return { ok: false as const, status: 413, message: "body too large" };
		chunks.push(buffer);
	}
	try {
		return {
			ok: true as const,
			value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
		};
	} catch {
		return { ok: false as const, status: 400, message: "invalid json" };
	}
}

function reportUrl(base: string, cap: string) {
	return new URL(`r/${cap}/`, `${base}/`).href;
}

function secureHeaders(response: ServerResponse) {
	response.setHeader("X-Frame-Options", "DENY");
	response.setHeader("X-Content-Type-Options", "nosniff");
	response.setHeader("Referrer-Policy", "no-referrer");
}

function writeJson(response: ServerResponse, status: number, value: unknown) {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	response.end(`${JSON.stringify(value)}\n`);
}

function writeText(response: ServerResponse, status: number, text: string) {
	response.writeHead(status, {
		"Content-Type": "text/plain; charset=utf-8",
		"Cache-Control": "no-store",
	});
	response.end(text);
}

function methodNotAllowed(response: ServerResponse) {
	writeText(response, 405, "method not allowed");
}

function unauthorized(response: ServerResponse) {
	writeText(response, 401, "unauthorized");
}

function notFound(response: ServerResponse) {
	writeText(response, 404, "not found");
}

function writeEndpoint(runtimeDir: string, endpoint: ReportEndpoint) {
	const path = `${runtimeDir}/endpoint.json`;
	const temporary = `${path}.${process.pid}.tmp`;
	rmSync(temporary, { force: true });
	try {
		writeFileSync(temporary, `${JSON.stringify(endpoint)}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		renameSync(temporary, path);
		chmodSync(path, 0o600);
	} catch (error) {
		rmSync(temporary, { force: true });
		throw error;
	}
}

function removeOwnEndpoint(runtimeDir: string) {
	const path = `${runtimeDir}/endpoint.json`;
	try {
		const endpoint = JSON.parse(readFileSync(path, "utf8")) as {
			pid?: unknown;
		};
		if (endpoint.pid === process.pid) rmSync(path, { force: true });
	} catch {}
}

async function startFromIpc() {
	const message = await new Promise<unknown>((resolveMessage) => {
		process.once("message", resolveMessage);
	});
	const start = parseReportDaemonStart(message);
	if (!start) throw new Error("Invalid report daemon start message");
	const daemon = await startReportDaemon({
		config: start.config,
		runtimeDir: start.runtimeDir,
		idleMs: IDLE_MS,
	});
	// ready 后不在这里 disconnect：握手收尾由父进程单一负责，避免双端竞态。
	// 父进程 finish/崩溃关闭 IPC 后，本进程仍由 server + idle timer 保活。
	process.send?.({
		type: "ready",
		protocol: REPORT_PROTOCOL,
		health: daemon.health,
	});
}

// 经 symlink 路径启动时 argv 与 import.meta.url（realpath）不一致；对齐后再判断主模块。
const entry = process.argv[1] ? mainModuleUrl(process.argv[1]) : "";
if (entry && import.meta.url === entry)
	void startFromIpc().catch((error) => {
		const payload = {
			type: "error" as const,
			protocol: REPORT_PROTOCOL,
			message: error instanceof Error ? error.message : String(error),
		};
		// 失败路径由子进程收尾 IPC 并退出；父进程 finish 只在 connected 时 disconnect。
		if (typeof process.send === "function")
			process.send(payload, () => {
				process.disconnect?.();
				process.exit(1);
			});
		else process.exit(1);
	});

function mainModuleUrl(argvPath: string) {
	try {
		return pathToFileURL(realpathSync(argvPath)).href;
	} catch {
		return pathToFileURL(resolve(argvPath)).href;
	}
}
