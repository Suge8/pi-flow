import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const out = join(root, `.tmp-status-test-${runId}`);
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
		"src/shared/status.ts",
	],
	{ cwd: root, stdio: "inherit" },
);

try {
	const { clearStatus, startElapsedStatus } = await import(
		`file://${join(srcOut, "shared/status.js")}?t=${Date.now()}`
	);

	let writes = 0;
	const staleCtx = {
		ui: {
			setStatus() {
				writes += 1;
				if (writes > 1) {
					throw new Error(
						"This extension ctx is stale after session replacement or reload.",
					);
				}
			},
		},
	};
	const status = startElapsedStatus(staleCtx, "review", () => "running");
	status.refresh();
	status.refresh();
	assert(writes === 2, `stale status kept writing: ${writes}`);

	clearStatus(
		{
			ui: {
				setStatus() {
					throw new Error(
						"This extension ctx is stale after session replacement or reload.",
					);
				},
			},
		},
		"review",
	);

	assertThrows(
		() =>
			startElapsedStatus(
				{
					ui: {
						setStatus() {
							throw new Error("unexpected status failure");
						},
					},
				},
				"review",
				() => "running",
			),
		"unexpected status failure",
	);

	console.log("status smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function assertThrows(fn, expected) {
	try {
		fn();
	} catch (error) {
		assert(String(error).includes(expected), String(error));
		return;
	}
	throw new Error("expected throw");
}
