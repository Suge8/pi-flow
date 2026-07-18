import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-monitor-overlay-test-${runId}`);
process.env.PI_FLOW_LANGUAGE = "zh";
const srcOut = join(out, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
prepareTestDist(root, srcOut);

try {
	const progressModule = await import(
		`file://${join(srcOut, "shared/agent-progress.js")}?t=${Date.now()}`
	);
	const toolLine = await import(
		`file://${join(srcOut, "shared/tool-line.js")}?t=${Date.now()}`
	);
	const monitor = await import(
		`file://${join(srcOut, "shared/monitor-overlay.js")}?t=${Date.now()}`
	);
	assertToolVocabulary(toolLine);
	await assertMonitorRendering(progressModule, monitor);
	assertHeightBudget(progressModule, monitor);
	assertRefreshDisposal(progressModule, monitor);
	await assertOverlayLifecycle(progressModule, monitor);
	assertLazyBootstrap();
	console.log("monitor overlay smoke: ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function assertToolVocabulary(toolLine) {
	const {
		clipToolParts,
		commandToolParts,
		formatToolDuration,
		formatToolTokens,
		layoutToolLine,
		pathToolParts,
		toolDisplayLabel,
	} = toolLine;
	const pathParts = pathToolParts(
		"/work/pi-flow/src/shared/monitor-overlay.ts:12-40",
		"/work/pi-flow",
		"/Users/test",
	);
	assertParts(pathParts, [
		["./src/shared/", "muted"],
		["monitor-overlay.ts", "accent"],
		[":12-40", "muted"],
	]);
	assertParts(
		pathToolParts("/Users/test/project/file.ts", "/work", "/Users/test"),
		[
			["~/project/", "muted"],
			["file.ts", "accent"],
		],
	);
	const commandParts = commandToolParts(
		"MODE=test npm run check\nprintf done | tee out > result.txt",
		"/Users/test",
	);
	const commandText = commandParts.map((part) => part.text).join("");
	assert(
		commandText.includes(
			"$ MODE=test npm run check ↵ printf done | tee out > result.txt",
		),
		commandText,
	);
	assert(
		partColor(commandParts, "$ ") === "muted",
		"command prompt should be muted",
	);
	assert(
		partColor(commandParts, "MODE=test") === "muted",
		"env assignment should be muted",
	);
	assert(
		partColor(commandParts, "npm") === "accent",
		"first command should be accented",
	);
	assert(
		partColor(commandParts, "↵") === "muted",
		"newline marker should be muted",
	);
	assert(
		partColor(commandParts, "printf") === "accent",
		"command after newline should be accented",
	);
	assert(partColor(commandParts, "|") === "muted", "pipe should be muted");
	assert(
		partColor(commandParts, "tee") === "accent",
		"command after pipe should be accented",
	);
	assert(partColor(commandParts, ">") === "muted", "redirect should be muted");
	assert(
		formatToolDuration(999) === "" &&
			formatToolDuration(1_250) === "1.2s" &&
			formatToolDuration(9_950) === "9.9s" &&
			formatToolDuration(10_000) === "0:10" &&
			formatToolDuration(65_000) === "1:05",
		"duration formatting is incorrect",
	);
	assert(
		formatToolTokens(9_500) === "9.5k" && formatToolTokens(0) === "0.0k",
		"token formatting is incorrect",
	);
	assert(
		toolDisplayLabel("read", "zh") === "读取" &&
			toolDisplayLabel("bash", "zh") === "操作" &&
			toolDisplayLabel("edit", "zh") === "修改" &&
			toolDisplayLabel("write", "zh") === "写入" &&
			toolDisplayLabel("grep", "zh") === "grep" &&
			toolDisplayLabel("read", "en") === "read",
		"tool labels are incomplete",
	);
	const clippedPath = clipToolParts(pathParts, 18, "start")
		.map((part) => part.text)
		.join("");
	const clippedCommand = clipToolParts(commandParts, 18, "end")
		.map((part) => part.text)
		.join("");
	assert(
		clippedPath.startsWith("…") && clippedPath.endsWith(":12-40"),
		`path should preserve its tail: ${clippedPath}`,
	);
	assert(
		clippedCommand.startsWith("$ MODE=test") && clippedCommand.endsWith("…"),
		`command should preserve its head: ${clippedCommand}`,
	);
	const layout = layoutToolLine(
		[{ text: "▏ ● 读取 ", color: "muted" }],
		pathParts,
		[
			{ text: "1.2s", color: "dim" },
			{ text: "9.5k", color: "dim" },
		],
		29,
		"start",
	);
	assert(
		layout.metrics.length === 1 && layout.metrics[0]?.text === "1.2s",
		`metrics should drop one by one when space is tight: ${JSON.stringify(layout)}`,
	);
}

async function assertMonitorRendering(progressModule, monitor) {
	const originalNow = Date.now;
	let now = 1_000;
	Date.now = () => now;
	const scope = progressModule.openProgressScope(
		"parallel",
		"F19-G2+G3 并行控制台",
	);
	scope.register("G2", "监控悬浮窗");
	scope.register("G3", "检查子进程");
	now = 2_000;
	scope.feed("G2", {
		type: "tool_execution_start",
		toolCallId: "read-1",
		toolName: "read",
		args: { path: "/work/pi-flow/src/shared/monitor-overlay.ts:12-40" },
	});
	now = 3_500;
	scope.feed("G2", {
		type: "tool_execution_end",
		toolCallId: "read-1",
		toolName: "read",
		isError: false,
	});
	now = 4_000;
	scope.feed("G2", {
		type: "tool_execution_start",
		toolCallId: "bash-1",
		toolName: "bash",
		args: { command: "npm run check" },
	});
	now = 4_500;
	scope.feed("G2", {
		type: "message_end",
		message: { usage: { totalTokens: 9_500, cost: { total: 0.01 } } },
	});
	now = 5_000;
	scope.feed("G3", {
		type: "tool_execution_start",
		toolCallId: "edit-1",
		toolName: "edit",
		args: { path: "/work/pi-flow/src/bootstrap.ts" },
	});
	now = 6_500;
	scope.feed("G3", {
		type: "tool_execution_end",
		toolCallId: "edit-1",
		toolName: "edit",
		isError: true,
	});
	scope.finish("G3", true);
	now = 70_000;
	let closed;
	const wide = new monitor.MonitorOverlayComponent(
		fakeTui(120, 40),
		fakeTheme(),
		fakeKeybindings(),
		scope.id,
		"zh",
		"/work/pi-flow",
		"/Users/test",
		(reason) => {
			closed = reason;
		},
	);
	const wideLines = wide.render(96);
	const wideText = stripAnsi(wideLines.join("\n"));
	assert(wideText.includes("F19-G2+G3 并行控制台"), wideText);
	assert(wideText.includes("⏱ 1:09"), wideText);
	assert(wideText.includes("G2 监控悬浮窗"), wideText);
	assert(wideText.includes("2 calls · 9.5k tok"), wideText);
	assert(wideText.includes("操作 $ npm run check"), wideText);
	assert(
		wideText.includes("读取 ./src/shared/monitor-overlay.ts:12-40"),
		wideText,
	);
	assert(wideText.includes("✗ G3 检查子进程"), wideText);
	assert(
		wideLines.some(
			(line) => line.includes("\u001b[31m") && line.includes("修改"),
		),
		"failed tool history should use the error theme color",
	);
	assert(
		wideLines.every((line) => visibleWidth(line) <= 96),
		wideText,
	);
	wide.handleInput("\u001b");
	assert(closed === "escape", "Esc should close only the overlay");
	wide.dispose();

	const compact = new monitor.MonitorOverlayComponent(
		fakeTui(60, 12),
		fakeTheme(),
		fakeKeybindings(),
		scope.id,
		"zh",
		"/work/pi-flow",
		"/Users/test",
		() => undefined,
	);
	const compactText = stripAnsi(compact.render(48).join("\n"));
	assert(compactText.includes("G2 监控悬浮窗"), compactText);
	assert(compactText.includes("2 calls · 9.5k tok"), compactText);
	assert(compactText.includes("操作 $ npm run check"), compactText);
	assert(!compactText.includes("monitor-overlay.ts:12-40"), compactText);
	assert(!compactText.includes("修改 ./src/bootstrap.ts"), compactText);
	compact.dispose();
	scope.close();
	Date.now = originalNow;
}

function assertHeightBudget(progressModule, monitor) {
	for (const { agentCount, terminalRows } of [
		{ agentCount: 4, terminalRows: 12 },
		{ agentCount: 8, terminalRows: 24 },
		{ agentCount: 10, terminalRows: 12 },
	]) {
		const scope = progressModule.openProgressScope(
			"parallel",
			`height ${agentCount}`,
		);
		for (let index = 1; index <= agentCount; index += 1) {
			const agentKey = `G${index}`;
			scope.register(agentKey, `Agent ${index}`);
			scope.feed(agentKey, {
				type: "tool_execution_start",
				toolCallId: `bash-${index}`,
				toolName: "bash",
				args: { command: `npm test -- lane-${index}` },
			});
		}
		const component = new monitor.MonitorOverlayComponent(
			fakeTui(120, terminalRows),
			fakeTheme(),
			fakeKeybindings(),
			scope.id,
			"zh",
			"/work/pi-flow",
			"/Users/test",
			() => undefined,
		);
		const lines = component.render(96);
		const text = stripAnsi(lines.join("\n"));
		const maxHeight = Math.floor(terminalRows * 0.7);
		assert(
			lines.length <= maxHeight,
			`${agentCount} agents exceeded host maxHeight ${maxHeight}: ${lines.length}`,
		);
		for (let index = 1; index <= agentCount; index += 1)
			assert(
				text.includes(`G${index} `),
				`height fallback hid G${index}:\n${text}`,
			);
		assert(
			text.includes("esc 关闭"),
			`height fallback lost close hint:\n${text}`,
		);
		component.dispose();
		scope.close();
	}
}

function assertRefreshDisposal(progressModule, monitor) {
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	const timerState = { interval: 0, unref: false, cleared: false, renders: 0 };
	globalThis.setInterval = (_callback, milliseconds) => {
		timerState.interval = milliseconds;
		return {
			unref() {
				timerState.unref = true;
			},
		};
	};
	globalThis.clearInterval = () => {
		timerState.cleared = true;
	};
	try {
		const scope = progressModule.openProgressScope("parallel", "refresh test");
		scope.register("G1", "Refresh");
		const component = new monitor.MonitorOverlayComponent(
			fakeTui(120, 40, timerState),
			fakeTheme(),
			fakeKeybindings(),
			scope.id,
			"zh",
			"/work/pi-flow",
			"/Users/test",
			() => undefined,
		);
		const rendersBeforeFeed = timerState.renders;
		scope.feed("G1", {
			type: "tool_execution_start",
			toolCallId: "read-refresh",
			toolName: "read",
			args: { path: "README.md" },
		});
		assert(
			timerState.renders > rendersBeforeFeed,
			"progress changes should request an overlay render",
		);
		component.dispose();
		const rendersAfterDispose = timerState.renders;
		scope.feed("G1", {
			type: "tool_execution_end",
			toolCallId: "read-refresh",
			toolName: "read",
			isError: false,
		});
		assert(
			timerState.renders === rendersAfterDispose,
			"disposed overlay remained subscribed to progress",
		);
		assert(
			timerState.interval === 1000 && timerState.unref && timerState.cleared,
			"overlay refresh timer lifecycle is incomplete",
		);
		scope.close();
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
}

async function assertOverlayLifecycle(progressModule, monitor) {
	const scope = progressModule.openProgressScope("parallel", "F19 parallel");
	scope.register("G1", "First");
	const state = { components: [], notifications: [], options: [] };
	const ctx = {
		mode: "tui",
		cwd: "/work/pi-flow",
		ui: {
			custom(factory, options) {
				state.options.push(options);
				return new Promise((resolve) => {
					state.components.push(
						factory(fakeTui(120, 40), fakeTheme(), fakeKeybindings(), resolve),
					);
				});
			},
			notify(message, type) {
				state.notifications.push({ message, type });
			},
		},
	};
	monitor.autoOpenMonitorOverlay(ctx, scope.id, "zh");
	await nextTurn();
	monitor.autoOpenMonitorOverlay(ctx, scope.id, "zh");
	await nextTurn();
	assert(state.components.length === 1, "one scope opened duplicate overlays");
	assert(
		state.options[0]?.overlay === true &&
			state.options[0]?.overlayOptions?.width === "80%" &&
			state.options[0]?.overlayOptions?.maxHeight === "70%",
		"overlay sizing contract is incorrect",
	);
	state.components[0].handleInput("\u001b");
	const reopened = monitor.openActiveMonitorOverlay(ctx);
	await nextTurn();
	assert(
		state.components.length === 2,
		"Alt+S did not reopen an overlay closed in the previous input event",
	);
	state.components[1].handleInput("\u001b");
	await nextTurn();
	monitor.autoOpenMonitorOverlay(ctx, scope.id, "zh");
	await nextTurn();
	assert(state.components.length === 2, "Esc-silenced scope auto-opened again");
	scope.close();
	assert(
		(await reopened) === true,
		"manual monitor open should report success",
	);
	await nextTurn();
	assert(
		monitor.activeMonitorScopeId() === undefined,
		"scope close should close its overlay",
	);
	assert(
		(await monitor.openActiveMonitorOverlay(ctx)) === false &&
			state.notifications.at(-1)?.message === "当前没有运行中的子代理",
		"empty Alt+S path should notify without opening",
	);
	for (const component of state.components) component.dispose();
}

function assertLazyBootstrap() {
	for (const file of ["src/index.ts", "src/bootstrap.ts"]) {
		const source = readFileSync(join(root, file), "utf8");
		assert(
			!/^import .*monitor-overlay/mu.test(source) &&
				!/from ["'].*monitor-overlay/mu.test(source),
			`${file} statically imports monitor-overlay`,
		);
	}
}

function fakeKeybindings() {
	return {
		matches(data, action) {
			return data === "\u001b" && action === "app.interrupt";
		},
	};
}

function fakeTui(columns, rows, state) {
	return {
		terminal: { columns, rows },
		requestRender() {
			if (state) state.renders += 1;
		},
	};
}

function fakeTheme() {
	const codes = {
		accent: 36,
		border: 34,
		dim: 2,
		error: 31,
		muted: 90,
		success: 32,
		text: 37,
		toolTitle: 35,
		toolOutput: 37,
		warning: 33,
	};
	return {
		fg(color, text) {
			return `\u001b[${codes[color] ?? 37}m${text}\u001b[39m`;
		},
		bold(text) {
			return `\u001b[1m${text}\u001b[22m`;
		},
	};
}

function visibleWidth(text) {
	return [...stripAnsi(text)].reduce(
		(width, character) =>
			width + (/\p{Extended_Pictographic}/u.test(character) ? 2 : 1),
		0,
	);
}

function stripAnsi(text) {
	const ansiEscape = String.fromCharCode(27);
	return text.replace(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "g"), "");
}

function partColor(parts, token) {
	return parts.find((part) => part.text.includes(token))?.color;
}

function assertParts(parts, expected) {
	assert(
		JSON.stringify(parts.map((part) => [part.text, part.color])) ===
			JSON.stringify(expected),
		`parts mismatch: ${JSON.stringify(parts)}`,
	);
}

function nextTurn() {
	return new Promise((resolve) => setImmediate(resolve));
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
