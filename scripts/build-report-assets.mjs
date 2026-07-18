import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = process.argv[2]
	? resolve(process.argv[2])
	: join(root, "dist", "assets");
mkdirSync(assets, { recursive: true });
execFileSync(
	join(root, "node_modules", ".bin", "tailwindcss"),
	[
		"-c",
		join(root, "scripts", "report-tailwind.config.cjs"),
		"-i",
		join(root, "scripts", "report-tailwind.css"),
		"-o",
		join(assets, "report.css"),
		"--minify",
	],
	{ cwd: root, stdio: "inherit" },
);
copyFileSync(
	join(root, "node_modules", "roughjs", "bundled", "rough.js"),
	join(assets, "rough.js"),
);
