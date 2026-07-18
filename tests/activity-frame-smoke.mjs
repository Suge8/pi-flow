import { createHash } from "node:crypto";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-activity-frame-test-${runId}`);
// 断言是中文文案；固定运行时语言避免机器 locale 引入环境相关失败。
process.env.PI_FLOW_LANGUAGE = "zh";
const srcOut = join(out, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
prepareTestDist(root, srcOut, [
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
	"src/shared/activity-frame.ts",
	"src/shared/activity-signal.ts",
	"src/shared/reviewer-pool.ts",
]);

try {
	const {
		ACTIVITY_SPINNER_FRAMES,
		ActivityBox,
		activityRows,
		activitySpinnerLine,
		clearFlowActivities,
		handleFlowActivityInput,
		installFlowActivityFrame,
		setFlowActivity,
		setFlowCancelHandler,
		setFlowEditorInputHidden,
		setGoalActivityBox,
	} = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}?t=${Date.now()}`
	);
	const { reviewerProgressLines, runReviewerPool } = await import(
		`file://${join(srcOut, "shared/reviewer-pool.js")}?t=${Date.now()}`
	);
	const { emptyAgentProgress, openProgressScope, updateAgentProgress } =
		await import(
			`file://${join(srcOut, "shared/agent-progress.js")}?t=${Date.now()}`
		);
	const {
		FLAME_FRAME_COUNT,
		flameFrameCacheSize,
		flameFrameLines,
		flameFrameWidth,
	} = await import(
		`file://${join(srcOut, "shared/flame-frames.js")}?t=${Date.now()}`
	);
	const {
		piActivitySignal,
		piAttentionSignal,
		requestPiAttention,
		setPiActivity,
	} = await import(
		`file://${join(srcOut, "shared/activity-signal.js")}?t=${Date.now()}`
	);

	const box = new ActivityBox({
		activity: "review",
		message: "上下文检查中 ...",
	});
	const lines = box.render(40).map(stripAnsi);
	assert(lines.length === 5, `unexpected activity box height: ${lines.length}`);
	assert(lines[0] === "─".repeat(40), lines[0]);
	assert(lines.at(-1) === "─".repeat(40), lines.at(-1));
	assertCentered(lines[2], "上下文检查中 ...", 40);

	const clippedBox = new ActivityBox({
		activity: "goal",
		message: "一二三四五六七八九十",
		compact: true,
	});
	assert(
		clippedBox.render(8).map(stripAnsi).join("\n").includes("…"),
		"long activity rows should show an ellipsis",
	);

	const multiLineBox = new ActivityBox({
		activity: "review",
		title: "🔍 第 1 轮质检中",
		rows: ["✅ gpt", activitySpinnerLine("mini")],
	});
	const multiLines = multiLineBox.render(40).map(stripAnsi);
	assert(multiLines[0] === "─".repeat(40), multiLines.join("\n"));
	assert(multiLines.at(-1) === "─".repeat(40), multiLines.join("\n"));
	const titleIndex = multiLines.findIndex((line) =>
		line.includes("第 1 轮质检中"),
	);
	assert(titleIndex >= 0, multiLines.join("\n"));
	assert(multiLines[titleIndex + 1].trim() === "", multiLines.join("\n"));
	assert(
		multiLines.some((line) => line.includes("✅ gpt")),
		multiLines.join("\n"),
	);
	assert(
		ACTIVITY_SPINNER_FRAMES.some((frame) =>
			multiLines.some((line) => line.includes(`${frame} mini`)),
		),
		multiLines.join("\n"),
	);
	const liveReviewerLine = reviewerProgressLines(
		[
			{
				index: 0,
				label: "gpt-5.6",
				status: "running",
				activity: {
					currentTool: "read",
					currentToolArgs: "/work/pi-flow/src/app.ts",
					currentToolStartMs: 1000,
					recentTools: [],
					toolCallCount: 2,
					tokens: 1200,
					cost: 0,
					lastEventAt: 1000,
					status: "tool",
					activeTools: [],
				},
			},
		],
		"zh",
		"/work/pi-flow",
	)[0];
	assert(
		liveReviewerLine.includes("gpt-5.6 · 读取 ./src/app.ts · 2 calls"),
		liveReviewerLine,
	);
	const reviewerWithoutProgress = reviewerProgressLines([
		{ index: 0, label: "gpt-5.6", status: "running" },
	])[0];
	assert(
		reviewerWithoutProgress === "gpt-5.6",
		`reviewer without structured progress retained a static spinner: ${reviewerWithoutProgress}`,
	);
	let poolActivity = emptyAgentProgress(1_000);
	const poolUpdates = [];
	await runReviewerPool({
		reviewers: [{ model: "test/reviewer", thinking: "off" }],
		run: async (_reviewer, _index, refresh) => {
			poolActivity = updateAgentProgress(poolActivity, {
				at: 1_100,
				event: { type: "agent_start" },
			});
			refresh();
			return true;
		},
		statusOf: () => "passed",
		onUpdate: (progress) => poolUpdates.push(progress),
		activityOf: () => poolActivity,
	});
	assert(
		poolUpdates[0]?.[0]?.activity === undefined,
		"reviewer pool exposed empty progress before its first event",
	);
	assert(
		poolUpdates.some(
			(progress) =>
				progress[0]?.status === "running" &&
				progress[0]?.activity !== undefined,
		),
		"reviewer pool did not expose progress after its first event",
	);
	const renderedReviewerLine = new ActivityBox({
		activity: "review",
		title: "质检中",
		rows: [liveReviewerLine],
	})
		.render(80)
		.map(stripAnsi)
		.join("\n");
	assert(
		ACTIVITY_SPINNER_FRAMES.some((frame) =>
			renderedReviewerLine.includes(frame),
		),
		renderedReviewerLine,
	);
	let renderRequests = 0;
	const spinnerBox = new ActivityBox({
		activity: "review",
		rows: [activitySpinnerLine("mini")],
		requestRender: () => {
			renderRequests += 1;
		},
	});
	spinnerBox.invalidate();
	spinnerBox.dispose();
	assert(renderRequests === 1, "spinner should schedule gentle renders");
	const flameLines = flameFrameLines(6, 0);
	const flameWidth = visibleWidth(flameLines[0]);
	assert(FLAME_FRAME_COUNT > 1, "flame should expose multiple frames");
	assert(flameLines.length === 6, "flame should scale to requested height");
	assert(flameWidth > 0, "flame rows should not be empty");
	assert(
		flameLines.every((line) => visibleWidth(line) === flameWidth),
		"flame rows should have equal visible width",
	);
	assert(stripAnsi(flameLines.join("")).trim(), "flame rows should draw cells");
	const flameHashes = new Map([
		[1, "39dd19c614f6fad33ec297fadb3154f9c05b8cebf299be3fa1bdad5850b6d479"],
		[2, "e93f7b120224d8fd6b56824d18de57b9b34f28a702ca6d3d9a7caf3c564aa270"],
		[6, "b7b75ba29e0921aad81b6da56924774a313f129867673ca5e883569d7ab482ca"],
		[10, "44fb71dfd74c3624d47963d3e88380a854f4ce5e8b8dbb4861c6c813bfeaf589"],
		[17, "9ecab0cf9d81b960501b1c448c73310054f1694897a0f95a3faf8023c728b600"],
		[40, "91a213d4811b0ec5bc2f4c9f4717549a57dd59115f04c9b58275b5e1930568e0"],
	]);
	for (const height of [1, 17, 2, 40, 6, 10, 1]) {
		const width = flameFrameWidth(height);
		const serialized = `${JSON.stringify(
			Array.from({ length: 32 }, (_item, index) =>
				flameFrameLines(height, index),
			),
		)}|${width}`;
		const hash = createHash("sha256").update(serialized).digest("hex");
		assert(
			hash === flameHashes.get(height),
			`flame output changed at ${height}`,
		);
		assert(flameFrameCacheSize() === 1, "flame cache grew across heights");
	}
	const flameBox = new ActivityBox({
		activity: "goal",
		title: "🌊 Flow · 执行中",
		rows: ["进度：1/2"],
		flame: true,
	});
	const flameWideLines = flameBox.render(80);
	assert(
		flameWideLines.some((line) => line.includes("\u001b[38;2;255;")),
		"wide flame box should render flame ANSI cells",
	);
	assert(
		flameWideLines.every((line) => visibleWidth(line) <= 80),
		`wide flame box overflowed:\n${flameWideLines.join("\n")}`,
	);
	const flameStripped = flameWideLines.map(stripAnsi);
	const flameTitleLine = flameStripped.find((line) => line.includes("执行中"));
	const flameRowLine = flameStripped.find((line) => line.includes("进度：1/2"));
	assert(flameTitleLine && flameRowLine, "flame box lost content rows");
	const titleLeft = visibleWidth(
		flameTitleLine.slice(0, flameTitleLine.indexOf("🌊")),
	);
	const rowLeft = visibleWidth(
		flameRowLine.slice(0, flameRowLine.indexOf("进度")),
	);
	assert(
		titleLeft >= 6 && titleLeft === rowLeft,
		`flame content rows should share one left edge (title=${titleLeft} row=${rowLeft}):\n${flameStripped.join("\n")}`,
	);
	assert(
		/执行中 {8,}\S/u.test(flameTitleLine),
		`flame should keep at least an 8-column gap after content:\n${flameStripped.join("\n")}`,
	);
	const flameRightEdge = Math.max(
		...flameStripped.slice(1, -1).map((line) => visibleWidth(line.trimEnd())),
	);
	const rightMargin = 80 - flameRightEdge;
	assert(
		rightMargin >= 6 && Math.abs(titleLeft - rightMargin) <= 1,
		`flame group should be centered with symmetric margins (left=${titleLeft} right=${rightMargin}):\n${flameStripped.join("\n")}`,
	);
	const originalDateNow = Date.now;
	try {
		const titleLeftAt = (time) => {
			Date.now = () => time;
			const line = flameBox
				.render(80)
				.map(stripAnsi)
				.find((item) => item.includes("执行中"));
			return line.indexOf("🌊");
		};
		const frameEdges = new Set(
			[0, 100, 200, 300, 400].map((time) => titleLeftAt(time)),
		);
		assert(
			frameEdges.size === 1,
			`flame layout should not shift between frames: ${[...frameEdges].join(",")}`,
		);
	} finally {
		Date.now = originalDateNow;
	}
	const flameNarrowLines = flameBox.render(59).map(stripAnsi);
	const noFlameNarrowLines = new ActivityBox({
		activity: "goal",
		title: "🌊 Flow · 执行中",
		rows: ["进度：1/2"],
	})
		.render(59)
		.map(stripAnsi);
	assert(
		flameNarrowLines.join("\n") === noFlameNarrowLines.join("\n"),
		"narrow flame box should fall back to plain layout",
	);
	const originalSetInterval = globalThis.setInterval;
	const originalClearInterval = globalThis.clearInterval;
	let flameInterval;
	let flameTimerCleared = false;
	globalThis.setInterval = (_callback, milliseconds) => {
		flameInterval = milliseconds;
		return { unref() {} };
	};
	globalThis.clearInterval = () => {
		flameTimerCleared = true;
	};
	try {
		const flameTimerBox = new ActivityBox({
			activity: "goal",
			message: "执行中",
			flame: true,
			requestRender() {},
		});
		flameTimerBox.dispose();
		assert(flameInterval === 100, "flame should reuse activity timer cadence");
		assert(flameTimerCleared, "flame timer should be disposed");
	} finally {
		globalThis.setInterval = originalSetInterval;
		globalThis.clearInterval = originalClearInterval;
	}
	const multilineRowBox = new ActivityBox({
		activity: "goal",
		title: "🌊 Flow · 执行中",
		rows: ["目标：第一行\n第二行", "进度：1/2"],
	});
	const multilineRowLines = multilineRowBox.render(40).map(stripAnsi);
	assert(
		multilineRowLines.every((line) => !line.includes("\n")),
		`activity row leaked embedded newline:\n${multilineRowLines.join("\\n")}`,
	);
	assert(
		multilineRowLines.join("\n").includes("目标：第一行") &&
			multilineRowLines.join("\n").includes("第二行") &&
			multilineRowLines.join("\n").includes("进度：1/2"),
		`activity row dropped multiline content:\n${multilineRowLines.join("\n")}`,
	);
	const compactBox = new ActivityBox({
		activity: "goal",
		title: "🎯 目标 · 等待确认",
		rows: ["对齐已就绪", "", "运行 /flow go F1 生成计划"],
		compact: true,
	});
	const compactLines = compactBox.render(60).map(stripAnsi);
	assert(compactLines.length === 7, compactLines.join("\n"));
	assert(compactLines[0] === "─".repeat(60), compactLines.join("\n"));
	assert(compactLines.at(-1) === "─".repeat(60), compactLines.join("\n"));
	assert(compactLines[2].trim() === "", compactLines.join("\n"));
	assert(compactLines[4].trim() === "", compactLines.join("\n"));
	assert(
		compactLines.some((line) => line.includes("对齐已就绪")) &&
			compactLines.some((line) => line.includes("/flow go F1")),
		compactLines.join("\n"),
	);
	assert(
		activityRows("第 1 步", "目标文本", ["进度：1/5"]).join("\n") ===
			"第 1 步\n\n目标文本\n\n进度：1/5",
		"activity rows should separate semantic sections",
	);

	const state = { widgets: [], workingVisible: [] };
	const ctx = {
		ui: {
			setWorkingVisible(value) {
				state.workingVisible.push(value);
			},
			setWidget(key, content) {
				state.widgets.push({ key, content });
			},
		},
	};

	setGoalActivityBox(ctx, "目标进行中：修 UI");
	assert(
		state.workingVisible.at(-1) === false,
		"goal did not hide working row",
	);
	assert(
		state.widgets.at(-1)?.key === "goal-progress",
		"goal widget key mismatch",
	);
	const widget = state.widgets
		.at(-1)
		.content({}, { fg: (_color, text) => text });
	assert(
		stripAnsi(widget.render(60).join("\n")).includes("目标进行中：修 UI"),
		"goal widget did not render objective",
	);
	setGoalActivityBox(ctx, { rows: [activitySpinnerLine("mini")] });
	const renderArgs = [];
	const spinnerWidget = state.widgets.at(-1).content(
		{
			requestRender(force) {
				renderArgs.push(force);
			},
		},
		{ fg: (_color, text) => text },
	);
	spinnerWidget.invalidate();
	spinnerWidget.dispose();
	assert(
		renderArgs.length === 1 && renderArgs[0] === undefined,
		`spinner should use non-force render: ${JSON.stringify(renderArgs)}`,
	);

	setGoalActivityBox(ctx, undefined);
	assert(
		state.workingVisible.at(-1) === true,
		"goal did not restore working row",
	);
	assert(
		state.widgets.at(-1)?.content === undefined,
		"goal widget not cleared",
	);

	setFlowActivity("goal", true);
	assert(
		piActivitySignal().state.active === true,
		"flow activity signal was not enabled",
	);
	assert(
		piActivitySignal().state.sources.includes("pi-flow:frame"),
		`flow activity source missing: ${piActivitySignal().state.sources}`,
	);
	setFlowActivity("goal", true, "draft");
	setFlowActivity("goal", false, "draft");
	assert(
		piActivitySignal().state.active === true,
		"clearing one flow activity reason cleared another",
	);
	clearFlowActivities();
	assert(
		piActivitySignal().state.active === false,
		"flow activity signal was not cleared",
	);

	const cancelKeybindings = {
		matches(data, action) {
			return data === "escape" && action === "app.clear";
		},
	};
	let visibleInputCancels = 0;
	setFlowCancelHandler(
		() => {
			visibleInputCancels += 1;
		},
		{ captureWhenInputVisible: true },
	);
	assert(
		handleFlowActivityInput("escape", cancelKeybindings) === true &&
			visibleInputCancels === 1,
		"visible-input cancel was not captured",
	);
	setFlowCancelHandler(() => {
		visibleInputCancels += 1;
	});
	assert(
		handleFlowActivityInput("escape", cancelKeybindings) === false &&
			visibleInputCancels === 1,
		"default cancel handler captured visible input",
	);
	setFlowEditorInputHidden(true);
	assert(
		handleFlowActivityInput("escape", cancelKeybindings) === true &&
			visibleInputCancels === 2,
		"hidden-input cancel behavior regressed",
	);
	setFlowEditorInputHidden(false);
	setFlowCancelHandler(undefined);

	let editorFactory;
	let monitorOpenCalls = 0;
	const monitorScope = openProgressScope("quality", "Quality check");
	monitorScope.register("M1", "Reviewer");
	installFlowActivityFrame({
		hasUI: true,
		mode: "tui",
		cwd: "/work/pi-flow",
		ui: {
			setEditorComponent(factory) {
				editorFactory = factory;
			},
			custom() {
				monitorOpenCalls += 1;
				return Promise.resolve("scope-closed");
			},
			notify() {},
		},
	});
	assert(editorFactory, "activity editor was not installed");
	const activityEditor = editorFactory(
		{ requestRender() {} },
		{ borderColor: (text) => text, selectList: {} },
		{ matches: () => false, getKeys: () => [] },
	);
	activityEditor.handleInput("\u001bs");
	await new Promise((resolve) => setImmediate(resolve));
	assert(
		monitorOpenCalls === 1,
		"activity editor swallowed the monitor extension shortcut",
	);
	monitorScope.close();
	clearFlowActivities();

	const signal = piActivitySignal();
	const seen = [];
	const unsubscribe = signal.subscribe((state) =>
		seen.push(state.current ?? "idle"),
	);
	setPiActivity("activity-frame-smoke:a", true);
	setPiActivity("activity-frame-smoke:b", true);
	setPiActivity("activity-frame-smoke:a", false);
	assert(signal.state.active === true, "activity signal cleared too early");
	assert(
		signal.state.current === "activity-frame-smoke:b",
		`activity signal current mismatch: ${signal.state.current}`,
	);
	unsubscribe();
	setPiActivity("activity-frame-smoke:b", false);
	assert(signal.state.active === false, "activity signal was not cleared");
	assert(
		seen.join("|") ===
			"idle|activity-frame-smoke:a|activity-frame-smoke:b|activity-frame-smoke:b",
		`activity signal notifications mismatch: ${seen.join("|")}`,
	);

	const attentionRequests = [];
	const unsubscribeAttention = piAttentionSignal().subscribe((request) =>
		attentionRequests.push(request.source),
	);
	requestPiAttention("activity-frame-smoke:attention");
	unsubscribeAttention();
	requestPiAttention("activity-frame-smoke:ignored");
	assert(
		attentionRequests.join("|") === "activity-frame-smoke:attention",
		`attention signal notifications mismatch: ${attentionRequests.join("|")}`,
	);

	console.log("activity frame smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function assertCentered(line, text, width) {
	const index = line.indexOf(text);
	assert(index >= 0, `missing centered text: ${line}`);
	const left = visibleWidth(line.slice(0, index));
	const right = width - left - visibleWidth(text);
	assert(
		Math.abs(left - right) <= 1,
		`not centered: left=${left} right=${right}`,
	);
}

function stripAnsi(text) {
	const ansiEscape = String.fromCharCode(27);
	return text.replace(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "g"), "");
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
