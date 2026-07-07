import { readFile, stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Language } from "./config.js";
import { type StatusSink, setStatusSafe } from "./status.js";

interface ReportServerContext extends StatusSink {
	cwd: string;
}

interface ReportServerState {
	server: Server;
	port: number;
	roots: Set<string>;
	opened: Set<string>;
	clients: Set<ServerResponse>;
	statusCtx?: StatusSink;
	statusLanguage?: Language;
	statusUrl?: string;
}

const STATUS_KEY = "pi-flow-html-live";
const reportServerGlobal = globalThis as typeof globalThis & {
	__PI_FLOW_REPORT_SERVER__?: ReportServerState;
	__PI_FLOW_REPORT_SERVER_PENDING__?: Promise<ReportServerState>;
};

export async function openLiveHtmlOnce(
	pi: Pick<ExtensionAPI, "exec">,
	ctx: ReportServerContext,
	htmlPath: string,
	language?: Language,
) {
	const url = await liveReportUrl(ctx, htmlPath, language);
	const server = reportServerGlobal.__PI_FLOW_REPORT_SERVER__;
	const openedKey = `${resolve(ctx.cwd)}\0${resolve(htmlPath)}`;
	if (!url || !server || server.opened.has(openedKey)) return url;
	server.opened.add(openedKey);
	await openUrl(pi, url).catch(() => undefined);
	return url;
}

export async function liveReportUrl(
	ctx: ReportServerContext,
	htmlPath: string,
	language?: Language,
) {
	const server = await ensureReportServer(ctx);
	if (!server) return undefined;
	const url = reportUrl(server, ctx.cwd, htmlPath);
	server.statusUrl = url;
	server.statusLanguage = language;
	writeStatus(server);
	return url;
}

export async function ensureReportServer(ctx: ReportServerContext) {
	return startReportServer(resolve(ctx.cwd), ctx);
}

export function ensureReportServerForFile(filePath: string) {
	const root = reportRootForFile(filePath);
	return root ? startReportServer(root) : undefined;
}

export function notifyReportChanged(filePath: string) {
	const state = reportServerGlobal.__PI_FLOW_REPORT_SERVER__;
	if (!state || state.clients.size === 0) return;
	const routePath = routePathForAnyRoot(state, filePath);
	const payload = JSON.stringify({ path: routePath });
	for (const client of state.clients)
		client.write(`event: reload\ndata: ${payload}\n\n`);
}

export function closeReportServer() {
	const state = reportServerGlobal.__PI_FLOW_REPORT_SERVER__;
	if (!state) return;
	for (const client of state.clients) client.end();
	state.clients.clear();
	state.server.close();
	if (state.statusCtx) setStatusSafe(state.statusCtx, STATUS_KEY, undefined);
	reportServerGlobal.__PI_FLOW_REPORT_SERVER__ = undefined;
	reportServerGlobal.__PI_FLOW_REPORT_SERVER_PENDING__ = undefined;
}

async function startReportServer(root: string, statusCtx?: StatusSink) {
	let state = reportServerGlobal.__PI_FLOW_REPORT_SERVER__;
	if (!state) {
		const pending =
			reportServerGlobal.__PI_FLOW_REPORT_SERVER_PENDING__ ??
			createReportServer(root);
		reportServerGlobal.__PI_FLOW_REPORT_SERVER_PENDING__ = pending;
		state = await pending;
		reportServerGlobal.__PI_FLOW_REPORT_SERVER__ = state;
		reportServerGlobal.__PI_FLOW_REPORT_SERVER_PENDING__ = undefined;
	}
	const resolvedRoot = resolve(root);
	state.roots.delete(resolvedRoot);
	state.roots.add(resolvedRoot);
	if (statusCtx) state.statusCtx = statusCtx;
	writeStatus(state);
	return state;
}

function createReportServer(root: string) {
	return new Promise<ReportServerState>((resolveState) => {
		const state: ReportServerState = {
			server: createServer((request, response) => {
				void handleRequest(state, request.url ?? "/", response);
			}),
			port: 0,
			roots: new Set([root]),
			opened: new Set(),
			clients: new Set(),
		};
		state.server.listen(0, "127.0.0.1", () => {
			const address = state.server.address();
			state.port = typeof address === "object" && address ? address.port : 0;
			resolveState(state);
		});
		state.server.unref();
	});
}

async function handleRequest(
	state: ReportServerState,
	url: string,
	response: ServerResponse,
) {
	const parsed = new URL(url, reportBaseUrl(state));
	if (parsed.pathname === "/events") return handleEvents(state, response);
	if (parsed.pathname === "/") return redirectToLatestReport(state, response);
	const filePath = await fileForRoute(state, parsed.pathname);
	if (!filePath) return notFound(response);
	try {
		response.writeHead(200, {
			"Content-Type": mimeType(filePath),
			"Cache-Control": "no-cache",
		});
		response.end(await readFile(filePath));
	} catch {
		notFound(response);
	}
}

function handleEvents(state: ReportServerState, response: ServerResponse) {
	response.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	response.write("event: ready\ndata: {}\n\n");
	state.clients.add(response);
	response.on("close", () => state.clients.delete(response));
}

function reportUrl(state: ReportServerState, root: string, filePath: string) {
	return `${reportBaseUrl(state)}${routePathForRoot(root, filePath)}`;
}

function reportBaseUrl(state: ReportServerState) {
	return `http://127.0.0.1:${state.port}`;
}

function redirectToLatestReport(
	state: ReportServerState,
	response: ServerResponse,
) {
	if (!state.statusUrl) {
		response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("暂无报告");
		return;
	}
	const latest = new URL(state.statusUrl);
	response.writeHead(302, {
		Location: `${latest.pathname}${latest.search}${latest.hash}`,
	});
	response.end();
}

function reportRootForFile(filePath: string) {
	const parts = resolve(filePath).split(sep);
	const flowIndex = parts.lastIndexOf(".flow");
	if (flowIndex <= 0) return undefined;
	return parts.slice(0, flowIndex).join(sep) || sep;
}

function routePathForAnyRoot(state: ReportServerState, filePath: string) {
	for (const root of state.roots) {
		if (isInside(root, filePath)) return routePathForRoot(root, filePath);
	}
	return undefined;
}

function routePathForRoot(root: string, filePath: string) {
	const parts = relative(resolve(root), resolve(filePath))
		.split(sep)
		.filter(Boolean)
		.map(encodeURIComponent);
	return `/${parts.join("/")}`;
}

async function fileForRoute(state: ReportServerState, pathname: string) {
	const routeParts = pathname
		.split("/")
		.filter(Boolean)
		.map(decodeURIComponent);
	for (const root of [...state.roots].reverse()) {
		const candidate = resolve(root, ...routeParts);
		if (!isInside(root, candidate)) continue;
		try {
			const info = await stat(candidate);
			if (info.isFile()) return candidate;
		} catch {}
	}
	return undefined;
}

function isInside(root: string, filePath: string) {
	const resolvedRoot = resolve(root);
	const resolvedFile = resolve(filePath);
	const path = relative(resolvedRoot, resolvedFile);
	return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function mimeType(filePath: string) {
	const extension = extname(filePath);
	if (extension === ".html") return "text/html; charset=utf-8";
	if (extension === ".json") return "application/json; charset=utf-8";
	if (extension === ".md") return "text/markdown; charset=utf-8";
	if (extension === ".css") return "text/css; charset=utf-8";
	if (extension === ".js") return "text/javascript; charset=utf-8";
	return "text/plain; charset=utf-8";
}

function notFound(response: ServerResponse) {
	response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
	response.end("not found");
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

function writeStatus(state: ReportServerState) {
	if (!state.statusCtx) return;
	setStatusSafe(
		state.statusCtx,
		STATUS_KEY,
		state.statusLanguage === "en"
			? `🌐 Web report: ${reportBaseUrl(state)}`
			: `🌐 网页报告: ${reportBaseUrl(state)}`,
		state.statusLanguage,
	);
}
