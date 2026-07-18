import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { acquireReportPortTestLock } from "./report-port-lock.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(tmpdir(), `pi-flow-package-test-${process.pid}-${Date.now()}`);
const unpacked = join(out, "package");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const releaseReportPortLock = await acquireReportPortTestLock();

try {
	if (process.env.npm_lifecycle_event !== "test")
		execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
	const pack = JSON.parse(
		execFileSync(
			"npm",
			["pack", "--ignore-scripts", "--json", "--pack-destination", out],
			{ cwd: root, encoding: "utf8" },
		),
	)[0];
	execFileSync("tar", ["-xzf", join(out, pack.filename), "-C", out]);
	const manifest = JSON.parse(readFileSync(join(unpacked, "package.json")));
	assert(
		JSON.stringify(manifest.pi.extensions) ===
			JSON.stringify(["./dist/index.js"]),
		"published extension entry is not dist/index.js",
	);
	const files = packageFiles(unpacked);
	for (const path of [
		"dist/index.js",
		"dist/bootstrap.js",
		"dist/flow.js",
		"dist/review.js",
		"dist/advisor.js",
		"dist/child.js",
		"dist/validate-draft.js",
		"dist/report-daemon.js",
		"dist/assets/report.css",
		"dist/assets/rough.js",
		"prompts/zh/flow-plan.md",
		"prompts/en/flow-plan.md",
		"assets/logo.png",
		"config.template.json",
		"README.md",
		"LICENSE",
	])
		assert(files.includes(path), `published package is missing ${path}`);
	for (const prefix of ["src/", "scripts/", "tests/", "docs/"])
		assert(
			!files.some((path) => path.startsWith(prefix)),
			`published package leaked ${prefix}`,
		);
	assert(
		!files.some((path) => path.endsWith(".ts")),
		"package leaked TypeScript",
	);
	const staticGraph = staticModuleGraph(join(unpacked, "dist", "index.js"));
	for (const path of [
		"goal/runtime.js",
		"review.js",
		"flow/generation.js",
		"flow/html.js",
		"shared/session-name-sync.js",
	])
		assert(
			!staticGraph.has(join(unpacked, "dist", path)),
			`idle entry statically reaches ${path}`,
		);
	for (const path of files.filter(
		(path) => path.startsWith("dist/") && path.endsWith(".js"),
	)) {
		if (path === "dist/index.js") continue;
		assert(
			!/\bfrom\s+["']@earendil-works\/(?:pi-coding-agent|pi-tui)["']/u.test(
				readFileSync(join(unpacked, path), "utf8"),
			),
			`lazy module imports a host package at runtime: ${path}`,
		);
	}

	const cacheBust = `?t=${Date.now()}`;
	const prompts = await import(
		`${pathToFileURL(join(unpacked, "dist/shared/prompts.js")).href}${cacheBust}`
	);
	assert(
		prompts.readPrompt("flow-plan", "zh").length > 100,
		"prompt path failed",
	);
	const report = await import(
		`${pathToFileURL(join(unpacked, "dist/shared/report-html.js")).href}${cacheBust}`
	);
	assert(
		report.flowLogoDataUri().startsWith("data:image/png;base64,"),
		"logo path failed",
	);
	const reportHead = report.reportHead();
	assert(
		reportHead.includes("tailwindcss v3.4.17") &&
			reportHead.includes("var rough=") &&
			!reportHead.includes("<script src="),
		"published report assets are not self-contained",
	);
	const daemonRuntime = join(out, "package-agent", "pi-flow-report");
	mkdirSync(daemonRuntime, { recursive: true, mode: 0o700 });
	writeFileSync(join(daemonRuntime, "access.key"), randomBytes(32), {
		mode: 0o600,
	});
	const daemonModule = await import(
		`${pathToFileURL(join(unpacked, "dist/report-daemon.js")).href}${cacheBust}`
	);
	const daemon = await daemonModule.startReportDaemon({
		config: { bind: "127.0.0.1", port: 49327, publicBaseUrl: null },
		runtimeDir: daemonRuntime,
		idleMs: 1_000,
	});
	assert(
		(
			await fetch("http://127.0.0.1:49327/health").then((response) =>
				response.json(),
			)
		).pid === process.pid,
		"published daemon entry did not start",
	);
	await daemon.close();
	const childExtensions = await import(
		`${pathToFileURL(join(unpacked, "dist/shared/child-extensions.js")).href}${cacheBust}`
	);
	assert(
		existsSync(childExtensions.flowChildExtensionPath()) &&
			existsSync(childExtensions.flowMainExtensionPath()),
		"compiled child extension paths failed",
	);
	const validateCommand = await import(
		`${pathToFileURL(join(unpacked, "dist/shared/validate-command.js")).href}${cacheBust}`
	);
	assert(
		validateCommand
			.validateDraftCommand()
			.includes(join(unpacked, "dist/validate-draft.js")),
		"compiled validator command path failed",
	);
	const config = await import(
		`${pathToFileURL(join(unpacked, "dist/shared/config.js")).href}${cacheBust}`
	);
	assert(
		config.readFlowConfig().modelRoles.reviewers.length > 0,
		"compiled config root failed",
	);

	const flowDir = writeValidFlow(join(out, "project"));
	const validation = execFileSync(
		"node",
		[join(unpacked, "dist/validate-draft.js"), flowDir],
		{ encoding: "utf8" },
	);
	assert(
		validation.startsWith("OK "),
		`published validator failed: ${validation}`,
	);

	const loader = await import(
		pathToFileURL(
			join(
				root,
				"node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js",
			),
		).href
	);
	const loaded = await loader.loadExtensions(
		[join(unpacked, "dist/index.js")],
		join(out, "project"),
	);
	assert(
		loaded.errors.length === 0 && loaded.extensions.length === 1,
		`published extension failed to load: ${JSON.stringify(loaded.errors)}`,
	);
	const tuiRuntime = await import(
		`${pathToFileURL(join(unpacked, "dist/shared/tui.js")).href}${cacheBust}`
	);
	assert(
		tuiRuntime.matchesKey("\u001bs", "alt+s"),
		"published entry did not seed the monitor shortcut runtime",
	);
	const activityFrame = await import(
		`${pathToFileURL(join(unpacked, "dist/shared/activity-frame.js")).href}${cacheBust}`
	);
	assert(
		typeof activityFrame.installFlowActivityFrame === "function",
		"published activity frame failed to resolve host runtime",
	);
	for (const command of ["flow", "review", "advisor"])
		assert(
			loaded.extensions[0].commands.has(command),
			`published extension did not register /${command}`,
		);
	console.log("package smoke ok");
} finally {
	rmSync(out, { recursive: true, force: true });
	await releaseReportPortLock();
}

function staticModuleGraph(entry) {
	const visited = new Set();
	const visit = (path) => {
		if (visited.has(path)) return;
		visited.add(path);
		const source = readFileSync(path, "utf8");
		for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/gu)) {
			const dependency = join(dirname(path), match[1]);
			if (existsSync(dependency)) visit(dependency);
		}
	};
	visit(entry);
	return visited;
}

function packageFiles(dir) {
	const files = [];
	const visit = (current, prefix = "") => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) visit(join(current, entry.name), relative);
			else files.push(relative);
		}
	};
	visit(dir);
	return files.sort();
}

function writeValidFlow(project) {
	const dir = join(project, ".flow", "F1");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "G1-plan.md"),
		`# Goal 1: Package smoke\n\n## Objective\nValidate package.\n\n## Scope\n- Package only.\n\n## Success Criteria\n- Validator passes.\n\n## Steps\n- [ ] Validate package.\n\n## Verification\n- [ ] Run validator.\n\n## Notes\n- None.\n\n## Handoff\n- Pending.\n`,
	);
	const now = Date.now();
	writeFileSync(
		join(dir, "flow.json"),
		`${JSON.stringify(
			{
				schemaVersion: 17,
				language: "zh",
				id: "F1",
				title: "Package smoke",
				status: "draft",
				source: { type: "prompt", text: "test" },
				createdAt: now,
				updatedAt: now,
				startedAt: null,
				completedAt: null,
				currentGoal: 0,
				meta: null,
				attention: null,
				parallelRun: null,
				repairAttempts: 0,
				errors: [],
				goals: [
					{
						index: 0,
						title: "Package smoke",
						role: "normal",
						file: "G1-plan.md",
						status: "pending",
						startedAt: null,
						completedAt: null,
						completionCursor: null,
						sessionFile: null,
						sessionName: null,
						snapshot: null,
						goalId: null,
						result: {
							summary: null,
							handoff: null,
							handoffGenerated: false,
							criteriaChanged: false,
						},
						checks: {
							acceptance: { enabled: true, rounds: [], active: null },
							quality: { enabled: true, rounds: [], active: null },
						},
						pendingAdvisor: null,
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	return dir;
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
