import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-activity-frame-test-${runId}`);
const srcOut = join(out, "src");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
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
		"src/shared/activity-frame.ts",
	],
	{ cwd: root, stdio: "inherit" },
);

try {
	const {
		ActivityBox,
		activityRows,
		clearFlowActivities,
		setFlowActivity,
		setGoalActivityBox,
	} = await import(
		`file://${join(srcOut, "shared/activity-frame.js")}?t=${Date.now()}`
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

	const multiLineBox = new ActivityBox({
		activity: "review",
		title: "🔍 第 1 轮质量检查中",
		rows: ["1·gpt ✅", "2·mini …"],
	});
	const multiLines = multiLineBox.render(40).map(stripAnsi);
	assert(multiLines[0] === "─".repeat(40), multiLines.join("\n"));
	assert(multiLines.at(-1) === "─".repeat(40), multiLines.join("\n"));
	const titleIndex = multiLines.findIndex((line) =>
		line.includes("第 1 轮质量检查中"),
	);
	assert(titleIndex >= 0, multiLines.join("\n"));
	assert(multiLines[titleIndex + 1].trim() === "", multiLines.join("\n"));
	assert(
		multiLines.some((line) => line.includes("1·gpt ✅")),
		multiLines.join("\n"),
	);
	assert(
		multiLines.some((line) => line.includes("2·mini …")),
		multiLines.join("\n"),
	);
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
		globalThis.__PI_FLOW_ACTIVITY__?.active === true,
		"flow activity global was not enabled",
	);
	setFlowActivity("goal", true, "draft");
	setFlowActivity("goal", false, "draft");
	assert(
		globalThis.__PI_FLOW_ACTIVITY__?.active === true,
		"clearing one flow activity reason cleared another",
	);
	clearFlowActivities();
	assert(
		globalThis.__PI_FLOW_ACTIVITY__?.active === false,
		"flow activity global was not cleared",
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
