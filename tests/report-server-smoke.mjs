import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-report-server-test-${runId}`);
const srcOut = join(out, "src");

rmSync(out, { recursive: true, force: true });
mkdirSync(srcOut, { recursive: true });
execFileSync(
	join(root, "node_modules/.bin/tsc"),
	[
		"--ignoreConfig",
		"--outDir",
		srcOut,
		"--rootDir",
		"src",
		"--noEmit",
		"false",
		"--target",
		"ES2022",
		"--module",
		"NodeNext",
		"--moduleResolution",
		"NodeNext",
		"--types",
		"node",
		"--strict",
		"--skipLibCheck",
		"src/shared/report-server.ts",
	],
	{ cwd: root, stdio: "inherit" },
);

try {
	const {
		closeReportServer,
		ensureReportServerForFile,
		notifyReportChanged,
		openLiveHtmlOnce,
	} = await import(
		`file://${join(srcOut, "shared/report-server.js")}?t=${Date.now()}`
	);
	const cwd = join(out, "workspace");
	const dir = join(cwd, ".flow", "F1");
	mkdirSync(dir, { recursive: true });
	const htmlPath = join(dir, "flow.html");
	writeFileSync(htmlPath, "<!doctype html><p>live</p>");
	const state = { execs: [], statuses: [] };
	const pi = {
		exec(command, args) {
			state.execs.push({ command, args });
			return Promise.resolve({ code: 0, stdout: "", stderr: "" });
		},
	};
	const ctx = {
		cwd,
		ui: {
			setStatus(key, value) {
				state.statuses.push({ key, value });
			},
		},
	};

	await openLiveHtmlOnce(pi, ctx, htmlPath);
	await openLiveHtmlOnce(pi, ctx, htmlPath);
	assert(state.execs.length === 1, "live html did not open once");
	const url = state.execs[0].args[0];
	assert(url.startsWith("http://127.0.0.1:"), url);
	assert(
		state.statuses.at(-1).value.startsWith("🌐 网页报告: http://127.0.0.1:"),
		"status missing short live URL",
	);
	assert(
		!state.statuses.at(-1).value.includes("/.flow/F1/flow.html"),
		"status should not include report path",
	);
	await openLiveHtmlOnce(pi, ctx, htmlPath, "en");
	assert(
		state.statuses.at(-1).value.startsWith("🌐 Web report: http://127.0.0.1:"),
		state.statuses.at(-1).value,
	);
	const body = await fetch(url).then((response) => response.text());
	assert(body.includes("live"), "server did not serve html");
	const rootBody = await fetch(new URL("/", url)).then((response) =>
		response.text(),
	);
	assert(rootBody.includes("live"), "root did not redirect to latest report");

	const otherCwd = join(out, "workspace-other");
	const otherDir = join(otherCwd, ".flow", "F2");
	mkdirSync(otherDir, { recursive: true });
	const otherHtmlPath = join(otherDir, "flow.html");
	writeFileSync(otherHtmlPath, "<!doctype html><p>other-root</p>");
	const otherCtx = { ...ctx, cwd: otherCwd };
	await openLiveHtmlOnce(pi, otherCtx, otherHtmlPath);
	const otherUrl = state.execs.at(-1).args[0];
	assert(
		(await fetch(otherUrl).then((response) => response.text())).includes(
			"other-root",
		),
		"server did not serve report from later root",
	);

	const reload = listenForReload(new URL("/events", url).href);
	await reload.ready;
	notifyReportChanged(htmlPath);
	const event = await reload.event;
	assert(event.includes("event: reload"), event);
	assert(event.includes("/.flow/F1/flow.html"), event);

	closeReportServer();
	assert(state.statuses.at(-1).value === undefined, "status not cleared");

	const watcherHtmlPath = join(dir, "flow.html");
	writeFileSync(watcherHtmlPath, "<!doctype html><p>watcher</p>");
	await ensureReportServerForFile(watcherHtmlPath);
	await openLiveHtmlOnce(pi, ctx, watcherHtmlPath);
	const watcherUrl = state.execs.at(-1).args[0];
	assert(watcherUrl.includes("/.flow/F1/flow.html"), watcherUrl);
	const watcherReload = listenForReload(new URL("/events", watcherUrl).href);
	await watcherReload.ready;
	notifyReportChanged(watcherHtmlPath);
	const watcherEvent = await watcherReload.event;
	assert(watcherEvent.includes("/.flow/F1/flow.html"), watcherEvent);
	closeReportServer();

	console.log("report server smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function listenForReload(url) {
	let buffer = "";
	let resolveReady;
	let rejectReady;
	let ready = false;
	const readyPromise = new Promise((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const event = new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			const error = new Error("reload event timeout");
			if (!ready) rejectReady(error);
			reject(error);
		}, 1000);
		timeout.unref();
		const request = get(url, (response) => {
			response.on("data", (chunk) => {
				buffer += chunk.toString("utf8");
				if (!ready && buffer.includes("event: ready")) {
					ready = true;
					resolveReady();
				}
				if (buffer.includes("event: reload")) {
					clearTimeout(timeout);
					request.destroy();
					resolve(buffer);
				}
			});
		});
		request.on("error", (error) => {
			if (!ready) rejectReady(error);
			if (!buffer.includes("event: reload")) reject(error);
		});
	});
	return { ready: readyPromise, event };
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
