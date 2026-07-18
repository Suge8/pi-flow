import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	openSync,
	readFileSync,
	readSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
	ExtensionCommandContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { GOAL_STATE_ENTRY_TYPE } from "../goal/session-entry.js";
import { REVIEW_CHECKPOINT_ENTRY_TYPE } from "../review/checkpoint.js";
import { readFlowConfig } from "../shared/config.js";
import {
	currentSessionFile,
	sessionEntries,
	sessionLeafId,
} from "../shared/session.js";
import type { FlowState } from "./types.js";

/** 生成会话上下文占用达到该比例时放弃 fork，回退冷启动（保护执行与检查预算）。 */
const MAX_CONTEXT_PERCENT = 50;
/** 前缀里存在这些运行态 entry 时禁止 fork：物理拷贝会污染新会话的恢复探测。 */
const RUNTIME_ENTRY_TYPES = new Set([
	GOAL_STATE_ENTRY_TYPE,
	REVIEW_CHECKPOINT_ENTRY_TYPE,
]);

interface GenerationSessionFact {
	sessionFile: string;
	/** 计划完成点：生成成功时的会话 leaf entry；fork/分支只锚定这里。 */
	leafId: string;
	/** 生成完成时的上下文占用；null 表示未知（保守不 fork）。 */
	contextPercent: number | null;
	/** 计划完成时的工作区指纹；null 表示不可得（非 git 仓库等，保守不 fork）。 */
	workspaceFingerprint: string | null;
}

/**
 * Flow dir → 生成会话事实。进程内存态：重启后丢失即回退冷启动。
 * 生命周期由启动路径管理：首次启动（fork 或冷启动）即释放；
 * 不随 session_shutdown 清除——并行分支基于磁盘文件，不需要生成会话仍在前台。
 */
const generationSessions = new Map<string, GenerationSessionFact>();

export function rememberGenerationSession(
	dir: string,
	ctx: {
		cwd: string;
		sessionManager?: unknown;
		getContextUsage?: () => { percent: number | null } | undefined;
	},
) {
	const sessionFile = currentSessionFile(ctx);
	const leafId = sessionLeafId(ctx);
	if (!sessionFile || !leafId) return;
	const usage =
		typeof ctx.getContextUsage === "function"
			? ctx.getContextUsage()
			: undefined;
	generationSessions.set(dir, {
		sessionFile,
		leafId,
		contextPercent: usage?.percent ?? null,
		workspaceFingerprint: workspaceFingerprint(ctx.cwd),
	});
}

export function releaseGenerationSession(dir: string) {
	generationSessions.delete(dir);
}

export function resetPrewalkRuntime() {
	generationSessions.clear();
}

/**
 * 串行计划轨迹 fork 点：满足全部资格时返回计划完成点 entry id，否则 undefined（冷启动）。
 * 资格 = prewalk 开启 + 宿主支持 fork + Flow 无执行痕迹（代码未被步骤修改，轨迹仍新鲜）
 * + 当前会话就是该 Flow 的生成会话 + 计划完成点后无新对话轮（leaf 未漂移）
 * + 上下文占用有余量 + 会话无运行态残留。
 */
export function planTrajectoryForkPoint(
	ctx: ExtensionCommandContext,
	dir: string,
	flow: FlowState,
): string | undefined {
	if (flow.startedAt !== null) return undefined;
	if (typeof ctx.fork !== "function") return undefined;
	const fact = generationSessions.get(dir);
	if (!fact || fact.sessionFile !== currentSessionFile(ctx)) return undefined;
	if (!headroomOk(fact.contextPercent)) return undefined;
	if (!prewalkEnabled()) return undefined;
	if (!workspaceUnchanged(ctx.cwd, fact)) return undefined;
	if (!branchEligible(sessionEntries(ctx), fact.leafId)) return undefined;
	return fact.leafId;
}

/**
 * 并行首批：为每个 lane 从生成会话物理分支出独立 worker 会话文件
 * （root→计划完成点的自包含拷贝）。资格不满足或分支失败时返回空 Map，
 * 调用方回退冷启动——prewalk 是优化路径，冷启动是完全正确的执行路径。
 */
export function prepareWorkerTrajectorySessions(
	cwd: string,
	dir: string,
	flow: FlowState,
	batchIndices: number[],
): Map<number, string> {
	const none = new Map<number, string>();
	if (flow.startedAt !== null) return none;
	const fact = generationSessions.get(dir);
	if (!fact || !headroomOk(fact.contextPercent)) return none;
	if (!prewalkEnabled()) return none;
	if (!workspaceUnchanged(cwd, fact)) return none;
	const source = readSessionFile(fact.sessionFile);
	if (!source || !branchEligible(source.entries, fact.leafId)) return none;
	const sessions = new Map<number, string>();
	try {
		for (const index of batchIndices) {
			const branched = writeBranchedSession(
				fact.sessionFile,
				source,
				fact.leafId,
			);
			if (!branched) {
				removeSessionFiles(sessions);
				return none;
			}
			sessions.set(index, branched);
		}
		return sessions;
	} catch (error) {
		try {
			removeSessionFiles(sessions);
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Prewalk branch creation and cleanup both failed",
			);
		}
		throw error;
	}
}

function removeSessionFiles(sessions: Map<number, string>) {
	for (const path of sessions.values()) rmSync(path, { force: true });
}

interface SessionFileContent {
	header: Record<string, unknown>;
	entries: SessionEntry[];
}

/** 读取宿主会话 JSONL：首行 session header + 后续 entries。 */
function readSessionFile(path: string): SessionFileContent | null {
	const lines = readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim());
	if (lines.length === 0) return null;
	const header = parseSessionHeader(lines[0]);
	if (!header) return null;
	const entries = lines
		.slice(1)
		.map((line) => JSON.parse(line) as SessionEntry);
	return { header, entries };
}

function readSessionHeader(path: string) {
	const descriptor = openSync(path, "r");
	const chunks: Buffer[] = [];
	const buffer = Buffer.allocUnsafe(4096);
	try {
		for (;;) {
			const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
			if (bytesRead === 0) break;
			const bytes = buffer.subarray(0, bytesRead);
			const newline = bytes.indexOf(10);
			chunks.push(
				Buffer.from(bytes.subarray(0, newline < 0 ? bytes.length : newline)),
			);
			if (newline >= 0) break;
		}
	} finally {
		closeSync(descriptor);
	}
	return parseSessionHeader(Buffer.concat(chunks).toString("utf8"));
}

function parseSessionHeader(line: string) {
	if (!line.trim()) return null;
	const header = JSON.parse(line) as Record<string, unknown>;
	return header.type === "session" ? header : null;
}

/**
 * 把 root→计划完成点的路径物理拷贝成独立会话文件（与宿主 createBranchedSession
 * 语义等价的子集：过滤 label 并重链 parentId，header 记 parentSession 血缘）。
 * 纯 fs 实现：宿主包的运行时动态 import 在 `-e` 扩展加载形态下无法解析（只有静态
 * import 经宿主 loader 注入），而惰性模块又禁止静态 `from` 宿主包。
 */
function writeBranchedSession(
	sourceFile: string,
	source: SessionFileContent,
	leafId: string,
): string | null {
	const byId = new Map<string, SessionEntry>();
	for (const entry of source.entries) byId.set(entry.id, entry);
	const path: SessionEntry[] = [];
	for (
		let current = byId.get(leafId);
		current;
		current = current.parentId ? byId.get(current.parentId) : undefined
	)
		path.unshift(current);
	if (path.length === 0 || path[0]?.parentId) return null;
	let parentId: string | null = null;
	const rechained = [];
	for (const entry of path) {
		if (entry.type === "label") continue;
		rechained.push({ ...entry, parentId });
		parentId = entry.id;
	}
	const id = randomUUID();
	const timestamp = new Date().toISOString();
	const target = join(
		dirname(sourceFile),
		`${timestamp.replace(/[:.]/gu, "-")}_${id}.jsonl`,
	);
	const header = {
		...source.header,
		id,
		timestamp,
		parentSession: sourceFile,
	};
	writeFileSync(
		target,
		`${[header, ...rechained].map((item) => JSON.stringify(item)).join("\n")}\n`,
	);
	return target;
}

/** 该 worker 会话是否继承计划轨迹；持久化 header 是唯一事实源。 */
export function isForkedWorkerSession(sessionFile: string | undefined) {
	if (sessionFile === undefined) return false;
	try {
		return typeof readSessionHeader(sessionFile)?.parentSession === "string";
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ENOENT"
		)
			return false;
		throw error;
	}
}

function prewalkEnabled() {
	return readFlowConfig().prewalk.enabled;
}

function headroomOk(contextPercent: number | null) {
	return contextPercent !== null && contextPercent < MAX_CONTEXT_PERCENT;
}

/**
 * 工作区漂移守卫：计划完成到启动之间代码被外部修改（并行 Agent、用户改码、git 操作）
 * 时轨迹已过期，保守冷启动。指纹 = HEAD + tracked 内容 diff + porcelain 状态
 * + 全部非忽略 untracked 文件的路径与内容（均排除 `.flow/` 运行态）。
 * 不可得（非 git 仓库、文件读取失败）视为不达标，与 contextPercent 未知的处理同构。
 */
function workspaceUnchanged(cwd: string, fact: GenerationSessionFact) {
	if (fact.workspaceFingerprint === null) return false;
	return workspaceFingerprint(cwd) === fact.workspaceFingerprint;
}

function workspaceFingerprint(cwd: string): string | null {
	try {
		const run = (...args: string[]) =>
			execFileSync("git", ["-C", cwd, ...args], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				maxBuffer: 64 * 1024 * 1024,
			});
		const hash = createHash("sha256")
			.update(run("rev-parse", "HEAD"))
			.update(run("diff", "HEAD", "--", ".", ":(exclude).flow"))
			.update(run("status", "--porcelain", "--", ".", ":(exclude).flow"));
		// untracked 文件不进 diff，内容变化也不改变 porcelain；逐文件哈希路径+内容封住盲区。
		const untracked = run(
			"ls-files",
			"--others",
			"--exclude-standard",
			"-z",
			"--",
			".",
			":(exclude).flow",
		)
			.split("\0")
			.filter(Boolean)
			.sort();
		for (const file of untracked)
			hash
				.update(file)
				.update("\0")
				.update(readFileSync(join(cwd, file)));
		return hash.digest("hex");
	} catch {
		return null;
	}
}

/**
 * 分支资格：计划完成点仍在当前支上、其后没有新对话轮（message/custom_message；
 * 纯 custom 卡片/状态 entry 不算漂移），且全支无运行态 entry。
 */
function branchEligible(entries: SessionEntry[], planLeafId: string) {
	const leafIndex = entries.findIndex((entry) => entry.id === planLeafId);
	if (leafIndex < 0) return false;
	if (hasRuntimeEntries(entries)) return false;
	return entries
		.slice(leafIndex + 1)
		.every(
			(entry) => entry.type !== "message" && entry.type !== "custom_message",
		);
}

function hasRuntimeEntries(entries: SessionEntry[]) {
	return entries.some(
		(entry) =>
			entry.type === "custom" && RUNTIME_ENTRY_TYPES.has(entry.customType),
	);
}
