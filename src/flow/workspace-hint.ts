import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Language } from "../shared/config.js";
import { formatUserNotice } from "../shared/ui-language.js";

/**
 * Flow 根位置护栏：`.flow` 跟随启动目录，位置错了状态就会丢在别处。
 * - cwd 不在 git 仓库内：大概率从错误目录启动，警告确认。
 * - 在仓库内但 `.gitignore` 未忽略 `.flow`：运行态可能进仓库或被 git clean 删除。
 */
export function flowWorkspaceHint(
	cwd: string,
	language: Language,
): string | undefined {
	const repoRoot = gitRepoRoot(cwd);
	if (!repoRoot)
		return language === "en"
			? formatUserNotice("⚠️", "Flow state stays in this directory", [
					join(cwd, ".flow"),
					"This directory is not inside a git repository; make sure you started Pi in the right project",
				])
			: formatUserNotice("⚠️", "Flow 状态将写入当前目录", [
					join(cwd, ".flow"),
					"当前目录不在 git 仓库内，请确认在正确的项目目录运行",
				]);
	if (gitignoreCoversFlow(repoRoot, cwd)) return undefined;
	return language === "en"
		? formatUserNotice("⚠️", "Add .flow/ to .gitignore", [
				"Flow runtime state is local; ignoring it prevents commits and git clean from removing it",
			])
		: formatUserNotice("⚠️", "建议把 .flow/ 加入 .gitignore", [
				"Flow 运行态是本机产物，忽略后不会进仓库，也不会被 git clean 删除",
			]);
}

function gitRepoRoot(cwd: string) {
	let dir = cwd;
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

function gitignoreCoversFlow(repoRoot: string, cwd: string) {
	const candidates =
		repoRoot === cwd
			? [join(repoRoot, ".gitignore")]
			: [join(cwd, ".gitignore"), join(repoRoot, ".gitignore")];
	return candidates.some(gitignoreFileCoversFlow);
}

function gitignoreFileCoversFlow(path: string) {
	if (!existsSync(path)) return false;
	try {
		return readFileSync(path, "utf8")
			.split("\n")
			.some((line) => {
				const trimmed = line.trim();
				return !trimmed.startsWith("#") && trimmed.includes(".flow");
			});
	} catch {
		return false;
	}
}
