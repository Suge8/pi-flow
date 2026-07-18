import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { visibleWidth } from "@earendil-works/pi-tui";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(tmpdir(), `pi-flow-result-card-test-${runId}`);
const srcOut = join(out, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");
prepareTestDist(root, srcOut);

try {
	const {
		composeResultCardLines,
		registerResultCardRenderer,
		resultCardElapsedLine,
	} = await import(
		`file://${join(srcOut, "shared/result-card.js")}?t=${Date.now()}`
	);
	const { summarizeReviewText } = await import(
		`file://${join(srcOut, "shared/review-format.js")}?t=${Date.now()}`
	);

	let render;
	registerResultCardRenderer({
		registerMessageRenderer(_type, renderer) {
			render = renderer;
		},
	});

	const card = render(
		{
			details: {
				tone: "quality-review",
				result: "未通过",
				title: "第 1 轮质检未通过",
				lines: [
					"## 审查未通过",
					"- 问题: `验收` 的系统失败/超时/启动失败被压成普通“未通过”，会继续走 triggerTurn:true 的原目标推进",
				],
			},
		},
		{},
		{ fg: (_color, text) => text },
	);

	const fullLines = card.render(124).map(stripAnsi);
	assert(!fullLines.join("\n").includes("##"), fullLines.join("\n"));
	assert(fullLines.join("\n").includes("• 问题:"), fullLines.join("\n"));
	assert(
		fullLines.every((line) => visibleWidth(line) === 124),
		`card lines must cover stale terminal pixels:\n${fullLines.join("\n")}`,
	);

	const wrapped = card.render(40).map(stripAnsi).join("\n");
	assert(wrapped.replace(/\s+/gu, "").includes("原目标推进"), wrapped);
	assert(!wrapped.includes("…"), wrapped);
	assert(
		wrapped
			.replace(/\s+/gu, "")
			.includes(
				"问题:验收的系统失败/超时/启动失败被压成普通“未通过”，会继续走triggerTurn:true的原目标推进",
			),
		`wrap dropped characters:\n${wrapped}`,
	);

	const layoutLines = composeResultCardLines(
		[["内容"], ["检查摘要"]],
		[resultCardElapsedLine("1s", "zh")],
	);
	assert(
		JSON.stringify(layoutLines) ===
			JSON.stringify([
				"内容",
				"",
				"---",
				"",
				"检查摘要",
				"",
				"---",
				"",
				"⏱ 用时：1s",
			]),
		`shared card layout changed: ${JSON.stringify(layoutLines)}`,
	);

	const multilineCard = render(
		{
			details: {
				tone: "neutral",
				result: "启动",
				title: "Flow 第 1 步 · 启动",
				lines: ["目标：第一行\n第二行", "进度：1/2"],
			},
		},
		{},
		{ fg: (_color, text) => text },
	);
	const multilineLines = multilineCard.render(40).map(stripAnsi);
	assert(
		multilineLines.every((line) => !line.includes("\n")),
		`card renderer leaked embedded newline:\n${multilineLines.join("\\n")}`,
	);
	assert(
		multilineLines.join("\n").includes("目标：第一行") &&
			multilineLines.join("\n").includes("第二行") &&
			multilineLines.join("\n").includes("进度：1/2"),
		`multiline card dropped content:\n${multilineLines.join("\n")}`,
	);

	assert(
		summarizeReviewText("FAIL\n", "") === "",
		"status-only failures should be representable as empty summaries",
	);

	// 回归：⚠️（⚠ + U+FE0F）等 emoji 变体序列整体宽 2，逐 code point 测宽只有 1，
	// 曾导致渲染行超出终端宽度使 pi 崩溃。
	const emojiCard = render(
		{
			details: {
				tone: "quality-review",
				result: "未通过",
				title: "质检",
				lines: [
					'npm test 全量偶发失败经核实为并行 agent 在 src/flow/execution/advance.ts / src/shared/ui-language.ts 上的未完成中间态（"⚠️ Flow 已更新...推进Next" 断裂字符串），与本任务改动文件无关',
				],
			},
		},
		{},
		{ fg: (_color, text) => text },
	);
	for (const width of [40, 112, 124]) {
		for (const line of emojiCard.render(width).map(stripAnsi)) {
			assert(
				visibleWidth(line) <= width,
				`emoji line exceeds width ${width}: ${visibleWidth(line)} > ${width}: ${line}`,
			);
		}
	}

	for (const width of [1, 2, 10, 40, 124]) {
		const lines = card.render(width).map(stripAnsi);
		for (const line of lines) {
			assert(
				visibleWidth(line) <= width,
				`line exceeds width ${width}: ${visibleWidth(line)} > ${width}: ${line}`,
			);
		}
		assert(
			lines.every(
				(line) =>
					!line.includes("│") && !line.includes("╭") && !line.includes("╮"),
			),
			`vertical/corner border leaked at width ${width}: ${lines.join("\\n")}`,
		);
	}

	console.log("result card smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function stripAnsi(text) {
	const ansiEscape = String.fromCharCode(27);
	return text.replace(new RegExp(`${ansiEscape}\\[[0-9;]*m`, "g"), "");
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
