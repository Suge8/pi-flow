import { execFileSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

export function prepareTestDist(root, outDir, compileArgs) {
	const prebuilt = join(root, "dist");
	if (
		process.env.npm_lifecycle_event === "test" &&
		existsSync(join(prebuilt, "index.js"))
	) {
		cpSync(prebuilt, outDir, { recursive: true });
		return;
	}
	const args = compileArgs ?? [
		"--outDir",
		outDir,
		"--rootDir",
		"src",
		"--noEmit",
		"false",
	];
	execFileSync(join(root, "node_modules/.bin/tsc"), args, {
		cwd: root,
		stdio: "inherit",
	});
	execFileSync(
		process.execPath,
		[join(root, "scripts/build-report-assets.mjs"), join(outDir, "assets")],
		{ cwd: root, stdio: "inherit" },
	);
}
