import { randomBytes } from "node:crypto";
import {
	existsSync,
	type FSWatcher,
	linkSync,
	readFileSync,
	rmSync,
	unlinkSync,
	watch,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Language } from "../shared/config.js";
import { isRecord } from "../shared/guards.js";
import { formatUserNotice } from "../shared/ui-language.js";

export interface FlowLockOwner {
	action: string;
	pid: number;
	startedAt: number;
}

export type FlowLockResult =
	| { ok: true; owner: FlowLockOwner; release: () => void }
	| { ok: false; owner: FlowLockOwner | undefined };

const LOCK_NAME = ".flow.lock";
type FlowLockReleaseListener = () => void;
const lockGlobal = globalThis as typeof globalThis & {
	__piFlowLockReleaseListeners?: Map<string, Set<FlowLockReleaseListener>>;
};
const flowLockReleaseListeners =
	lockGlobal.__piFlowLockReleaseListeners ??
	new Map<string, Set<FlowLockReleaseListener>>();
lockGlobal.__piFlowLockReleaseListeners = flowLockReleaseListeners;

export function acquireFlowLock(dir: string, action: string): FlowLockResult {
	const owner = { action, pid: process.pid, startedAt: Date.now() };
	const lockPath = flowLockPath(dir);
	const tempPath = temporaryLockPath(dir, owner);
	writeFileSync(tempPath, `${JSON.stringify(owner)}\n`, { flag: "wx" });
	let linked = false;
	try {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				linkSync(tempPath, lockPath);
				linked = true;
				unlinkIfExists(tempPath);
				return {
					ok: true,
					owner,
					release: () => {
						unlinkIfExists(lockPath);
						emitFlowLockRelease(dir);
					},
				};
			} catch (error) {
				if (!isAlreadyExists(error)) throw error;
				const current = readFlowLockOwner(lockPath);
				if (current && ownerIsAlive(current))
					return { ok: false, owner: current };
				rmSync(lockPath, { force: true, recursive: true });
			}
		}
		return { ok: false, owner: readFlowLockOwner(lockPath) };
	} finally {
		if (!linked) unlinkIfExists(tempPath);
	}
}

export function withFlowLockSync<T>(
	dir: string,
	action: string,
	run: () => T,
): { ok: true; value: T } | { ok: false; owner: FlowLockOwner | undefined } {
	const lock = acquireFlowLock(dir, action);
	if (!lock.ok) return lock;
	try {
		return { ok: true, value: run() };
	} finally {
		lock.release();
	}
}

export async function withFlowLock<T>(
	dir: string,
	action: string,
	run: () => T | Promise<T>,
): Promise<
	{ ok: true; value: T } | { ok: false; owner: FlowLockOwner | undefined }
> {
	const lock = acquireFlowLock(dir, action);
	if (!lock.ok) return lock;
	try {
		return { ok: true, value: await run() };
	} finally {
		lock.release();
	}
}

/** 一次性订阅锁文件消失；先监听再检查，避免释放发生在注册窗口。 */
export function watchFlowLockRelease(dir: string, onRelease: () => void) {
	const path = flowLockPath(dir);
	let watcher: FSWatcher | undefined;
	let unsubscribe = () => {};
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		unsubscribe();
		watcher?.close();
	};
	const emitIfReleased = () => {
		if (closed || existsSync(path)) return;
		close();
		queueMicrotask(onRelease);
	};
	unsubscribe = subscribeFlowLockRelease(dir, emitIfReleased);
	try {
		watcher = watch(dir, (_event, name) => {
			if (name !== null && String(name) !== LOCK_NAME) return;
			emitIfReleased();
		});
	} catch (error) {
		close();
		throw error;
	}
	emitIfReleased();
	return close;
}

function subscribeFlowLockRelease(
	dir: string,
	listener: FlowLockReleaseListener,
) {
	const listeners = flowLockReleaseListeners.get(dir) ?? new Set();
	listeners.add(listener);
	flowLockReleaseListeners.set(dir, listeners);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) flowLockReleaseListeners.delete(dir);
	};
}

function emitFlowLockRelease(dir: string) {
	for (const listener of [...(flowLockReleaseListeners.get(dir) ?? [])])
		listener();
}

export function flowLockBusyMessage(
	owner: FlowLockOwner | undefined,
	language: Language,
) {
	if (!owner)
		return language === "en"
			? formatUserNotice("⏳", "Flow is already processing", [
					"Try again after it finishes",
				])
			: formatUserNotice("⏳", "Flow 正在处理", ["请稍后再试"]);
	const started = new Date(owner.startedAt).toISOString();
	return language === "en"
		? formatUserNotice("⏳", "Flow is already processing", [
				`Action: ${owner.action}`,
				`PID: ${owner.pid}`,
				`Started: ${started}`,
				"Try again after it finishes",
			])
		: formatUserNotice("⏳", "Flow 正在处理", [
				`动作：${owner.action}`,
				`PID：${owner.pid}`,
				`开始：${started}`,
				"请稍后再试",
			]);
}

function flowLockPath(dir: string) {
	return join(dir, LOCK_NAME);
}

function temporaryLockPath(dir: string, owner: FlowLockOwner) {
	const suffix = randomBytes(6).toString("hex");
	return join(
		dir,
		`${LOCK_NAME}.${owner.pid}.${owner.startedAt}.${suffix}.tmp`,
	);
}

function readFlowLockOwner(path: string): FlowLockOwner | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (!isRecord(parsed)) return undefined;
		const { action, pid, startedAt } = parsed;
		if (typeof action !== "string") return undefined;
		if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)
			return undefined;
		if (typeof startedAt !== "number" || !Number.isFinite(startedAt))
			return undefined;
		return { action, pid, startedAt };
	} catch {
		return undefined;
	}
}

function ownerIsAlive(owner: FlowLockOwner) {
	try {
		process.kill(owner.pid, 0);
		return true;
	} catch (error) {
		return errorCode(error) !== "ESRCH";
	}
}

function unlinkIfExists(path: string) {
	try {
		unlinkSync(path);
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
	}
}

function isAlreadyExists(error: unknown) {
	return errorCode(error) === "EEXIST";
}

function errorCode(error: unknown) {
	return isRecord(error) && typeof error.code === "string"
		? error.code
		: undefined;
}
