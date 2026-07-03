import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// footer.ts 是仓库外的用户扩展（~/.pi/agent/extensions/footer.ts），
// 其 bare import 由 pi 运行时提供；此处重写为本仓库 node_modules 的绝对路径后独立加载。
const footerPath = join(import.meta.dirname, "../../footer.ts");
const require = createRequire(import.meta.url);
const tuiUrl = pathToFileURL(require.resolve("@earendil-works/pi-tui")).href;

const tmp = mkdtempSync(join(tmpdir(), "footer-smoke-"));
try {
	const source = readFileSync(footerPath, "utf8").replace(
		'"@earendil-works/pi-tui"',
		JSON.stringify(tuiUrl),
	);
	const modulePath = join(tmp, "footer.ts");
	writeFileSync(modulePath, source);
	const { threePartLine } = await import(pathToFileURL(modulePath).href);
	const { visibleWidth } = await import(tuiUrl);

	const longLeft = "📍 ~/.pi/agent/extensions/pi-flow (main*)";
	const longMiddle = "G1 全仓审计并去重共享非常长的中文标题继续延长再延长";
	const right = "📦 31.2%/272K";

	// 窄屏 + 长 left：不许抛 Invalid count value（回归：长路径崩溃）
	for (const width of [20, 30, 40, 50, 60, 80]) {
		const out = threePartLine(longLeft, longMiddle, right, width);
		assert(
			visibleWidth(out) <= width,
			`width ${width} overflow: ${visibleWidth(out)}`,
		);
	}

	// 宽度足够时 right 永不丢弃
	for (const width of [44, 60, 100]) {
		const out = threePartLine(longLeft, longMiddle, right, width);
		assert(out.includes("📦"), `right dropped at width ${width}: ${out}`);
	}

	// 常规布局：三段齐全、填满整行
	const normal = threePartLine("⏵ pi", "短标题", right, 60);
	assert(visibleWidth(normal) === 60, `normal width: ${visibleWidth(normal)}`);
	assert(normal.includes("短标题") && normal.includes("📦"), normal);

	// 无 right：只截不崩
	const noRight = threePartLine(longLeft, longMiddle, "", 30);
	assert(visibleWidth(noRight) <= 30, noRight);

	console.log("footer smoke ok");
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
