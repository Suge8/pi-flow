#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const bump = process.argv[2];
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageName = packageJson.name;
const currentVersion = packageJson.version;
const nextVersion = resolveVersion(currentVersion, bump);
const tag = `v${nextVersion}`;

if (!bump) usage();
ensureClean();
ensureMain();
run("npm", ["whoami"]);
run("git", ["fetch", "--tags", "origin"]);
ensureNotBehind();
if (bump === "current") ensureNpmVersionFree(nextVersion);
else ensureVersionFree(nextVersion, tag);
run("npm", ["run", "check"]);
run("npm", ["test"]);

if (bump !== "current") {
	run("npm", ["version", nextVersion, "--no-git-tag-version"]);
	run("npm", ["pack", "--dry-run"]);
	run("git", ["add", "package.json", "package-lock.json"]);
	run("git", ["commit", "-m", `chore(release): ${tag}`]);
	run("git", ["tag", "-a", tag, "-m", tag]);
} else {
	run("npm", ["pack", "--dry-run"]);
	ensureHeadTagged(tag);
}

run("npm", ["publish", "--access", "public"]);
run("git", ["push", "origin", "main", "--follow-tags"]);
console.log(`Published ${packageName}@${nextVersion}`);

function usage() {
	console.error("Usage: npm run release -- patch|minor|major|current|x.y.z");
	process.exit(1);
}

function resolveVersion(version, next) {
	if (next === "current") return version;
	if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(next)) return next;
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/u);
	if (!match) fail(`Unsupported current version: ${version}`);
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	if (next === "patch") return `${major}.${minor}.${patch + 1}`;
	if (next === "minor") return `${major}.${minor + 1}.0`;
	if (next === "major") return `${major + 1}.0.0`;
	usage();
}

function ensureClean() {
	const status = output("git", ["status", "--porcelain"]);
	if (status) fail(`Working tree is not clean:\n${status}`);
}

function ensureMain() {
	const branch = output("git", ["branch", "--show-current"]);
	if (branch !== "main")
		fail(`Release from main only. Current branch: ${branch}`);
}

function ensureNotBehind() {
	const [behind] = output("git", [
		"rev-list",
		"--left-right",
		"--count",
		"origin/main...HEAD",
	]).split(/\s+/u);
	if (Number(behind) > 0) fail("Local main is behind origin/main");
}

function ensureVersionFree(version, tagName) {
	ensureNpmVersionFree(version);
	if (tagExists(tagName)) fail(`Tag already exists: ${tagName}`);
	if (remoteTagExists(tagName)) fail(`Remote tag already exists: ${tagName}`);
}

function ensureNpmVersionFree(version) {
	if (npmVersionExists(version))
		fail(`${packageName}@${version} already exists on npm`);
}

function ensureHeadTagged(tagName) {
	const head = output("git", ["rev-parse", "HEAD"]);
	const tagged = output("git", ["rev-list", "-n", "1", tagName]);
	if (head !== tagged) fail(`HEAD is not tagged ${tagName}`);
}

function npmVersionExists(version) {
	const result = spawnSync(
		"npm",
		["view", `${packageName}@${version}`, "version"],
		{
			encoding: "utf8",
		},
	);
	if (result.status === 0) return true;
	if (`${result.stderr}${result.stdout}`.includes("E404")) return false;
	fail(result.stderr || result.stdout || "npm view failed");
}

function tagExists(tagName) {
	return (
		spawnSync("git", ["rev-parse", "--verify", `refs/tags/${tagName}`], {
			stdio: "ignore",
		}).status === 0
	);
}

function remoteTagExists(tagName) {
	return (
		spawnSync(
			"git",
			["ls-remote", "--exit-code", "--tags", "origin", tagName],
			{
				stdio: "ignore",
			},
		).status === 0
	);
}

function output(command, args) {
	return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function run(command, args) {
	execFileSync(command, args, { stdio: "inherit" });
}

function fail(message) {
	console.error(message);
	process.exit(1);
}
