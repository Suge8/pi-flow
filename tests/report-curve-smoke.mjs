import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import rough from "roughjs";
import { prepareTestDist } from "./prepare-dist.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(tmpdir(), `pi-flow-report-curve-${process.pid}-${Date.now()}`);
prepareTestDist(root, out);

try {
	const {
		STEP_FLOW_MIN_CLEARANCE,
		STEP_FLOW_ROUGH_OPTIONS,
		reportHead,
		stepFlowConnectorPath,
		stepFlowNeedsColumns,
		stepFlowTargetHeight,
	} = await import(`${pathToFileURL(join(out, "shared/report-html.js")).href}`);
	const head = reportHead();
	assert(
		head.includes(
			"[data-criteria-list] li>span:last-child{min-width:0;overflow-wrap:anywhere}",
		),
		"criteria text must wrap inside the standards card",
	);
	assert(
		!head.includes("details[open]>summary [data-step-disclosure]") &&
			!head.includes('querySelectorAll("details")'),
		"static step details must not keep disclosure behavior",
	);
	assert.equal(stepFlowNeedsColumns([60, 60, 60, 60, 60], 325.17), false);
	assert.equal(stepFlowNeedsColumns([70, 70, 70, 70, 98], 325.17), true);
	assert.equal(stepFlowTargetHeight([60, 60, 60, 60], 289), undefined);
	assert.equal(
		stepFlowTargetHeight([60, 60, 60, 60, 60, 60, 60, 60], 289),
		289,
	);
	assert.equal(stepFlowTargetHeight([60, 60, 100, 60, 60], 180), 220);
	for (const fixture of curveFixtures(STEP_FLOW_MIN_CLEARANCE)) {
		const route = stepFlowConnectorPath(fixture.geometry);
		assert(route, `${fixture.name}: connector route missing`);
		const drawings = Array.from({ length: 20 }, () =>
			rough.generator().path(route.path, {
				...STEP_FLOW_ROUGH_OPTIONS,
				stroke: "#000",
			}),
		);
		assert.equal(
			new Set(drawings.map((drawing) => JSON.stringify(drawing.sets))).size,
			1,
			`${fixture.name}: fixed seed did not make redraws deterministic`,
		);
		for (const drawing of drawings)
			assertRoughPathAvoids(drawing, fixture.obstacles, fixture.name);
	}
	console.log("report curve smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function curveFixtures(minimumClearance) {
	const base = {
		target: { x: 524, y: 18 },
		gutterLeft: 476,
		gutterRight: 524,
		sourceCopyLeft: 52,
		minimumClearance,
	};
	return [
		{
			name: "compact rows",
			geometry: {
				...base,
				source: { x: 36, y: 198 },
				contentBottom: 216,
				channelY: 248,
			},
			obstacles: [
				textRect(0, 36),
				textRect(60, 96),
				textRect(120, 156),
				textRect(180, 216),
				rightTextRect(0, 36),
			],
		},
		{
			name: "middle detail visible",
			geometry: {
				...base,
				source: { x: 36, y: 302 },
				contentBottom: 320,
				channelY: 352,
			},
			obstacles: [
				textRect(0, 36),
				textRect(60, 96),
				textRect(100, 204, 400),
				textRect(224, 260),
				textRect(284, 320),
				rightTextRect(0, 36),
			],
		},
		{
			name: "source detail visible",
			geometry: {
				...base,
				source: { x: 36, y: 198 },
				contentBottom: 301,
				channelY: 333,
			},
			obstacles: [
				textRect(0, 36),
				textRect(60, 96),
				textRect(120, 156),
				textRect(180, 216),
				textRect(220, 301, 400),
				rightTextRect(0, 36),
			],
		},
	];
}

function textRect(top, bottom, right = 476) {
	return { left: 52, right, top, bottom };
}

function rightTextRect(top, bottom) {
	return { left: 576, right: 1000, top, bottom };
}

function assertRoughPathAvoids(drawing, obstacles, name) {
	for (const set of drawing.sets) {
		let current;
		for (const operation of set.ops) {
			if (operation.op === "move") {
				current = { x: operation.data[0], y: operation.data[1] };
				assertPointAvoids(current, obstacles, name);
				continue;
			}
			if (!current) continue;
			if (operation.op === "lineTo") {
				const end = { x: operation.data[0], y: operation.data[1] };
				for (let step = 1; step <= 1000; step += 1)
					assertPointAvoids(
						{
							x: current.x + ((end.x - current.x) * step) / 1000,
							y: current.y + ((end.y - current.y) * step) / 1000,
						},
						obstacles,
						name,
					);
				current = end;
				continue;
			}
			if (operation.op !== "bcurveTo") continue;
			const [x1, y1, x2, y2, x, y] = operation.data;
			for (let step = 1; step <= 1000; step += 1) {
				const t = step / 1000;
				assertPointAvoids(
					{
						x: cubic(current.x, x1, x2, x, t),
						y: cubic(current.y, y1, y2, y, t),
					},
					obstacles,
					name,
				);
			}
			current = { x, y };
		}
	}
}

function cubic(start, first, second, end, t) {
	return (
		(1 - t) ** 3 * start +
		3 * (1 - t) ** 2 * t * first +
		3 * (1 - t) * t ** 2 * second +
		t ** 3 * end
	);
}

function assertPointAvoids(point, obstacles, name) {
	for (const obstacle of obstacles)
		assert(
			point.x < obstacle.left - 2 ||
				point.x > obstacle.right + 2 ||
				point.y < obstacle.top - 2 ||
				point.y > obstacle.bottom + 2,
			`${name}: rough stroke entered text bounds at ${point.x},${point.y}`,
		);
}
