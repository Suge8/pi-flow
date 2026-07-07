import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { writeFlowHtml } from "../flow/html.js";
import { flowLockBusyMessage, withFlowLockSync } from "../flow/lock.js";
import { listFlows, readFlow, writeFlow } from "../flow/store.js";
import { formatError } from "./guards.js";
import { runtimeLanguage } from "./language.js";
import { currentSessionFile } from "./session.js";
import { formatUserNotice, notifyUser } from "./ui-language.js";

export function registerSessionNameSync(pi: ExtensionAPI) {
	pi.on("session_info_changed", (event, ctx) => {
		try {
			syncSessionName(ctx, sessionNameOrNull(event.name));
		} catch (error) {
			const language = runtimeLanguage();
			notifyUser(
				ctx,
				sessionNameSyncFailedNotice(formatError(error), language),
				"info",
				language,
			);
		}
	});
}

function sessionNameSyncFailedNotice(error: string, language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("⚠️", "Session name sync failed", [error])
		: formatUserNotice("⚠️", "会话名同步失败", [error]);
}

function syncSessionName(ctx: ExtensionContext, sessionName: string | null) {
	const sessionFile = currentSessionFile(ctx);
	if (!sessionFile) return;
	syncFlowSessionName(ctx.cwd, sessionFile, sessionName);
}

function syncFlowSessionName(
	cwd: string,
	sessionFile: string,
	sessionName: string | null,
) {
	for (const location of listFlows(cwd)) {
		if (!location.flow.goals.some((goal) => goal.sessionFile === sessionFile))
			continue;
		const synced = withFlowLockSync(
			location.dir,
			`sync session name ${location.flow.id}`,
			() => syncFlowSessionNameWithLock(location.dir, sessionFile, sessionName),
		);
		if (!synced.ok)
			throw new Error(
				flowLockBusyMessage(synced.owner, location.flow.language),
			);
	}
}

function syncFlowSessionNameWithLock(
	dir: string,
	sessionFile: string,
	sessionName: string | null,
) {
	const flow = readFlow(dir);
	let changed = false;
	const goals = flow.goals.map((goal) => {
		if (goal.sessionFile !== sessionFile || goal.sessionName === sessionName)
			return goal;
		changed = true;
		return { ...goal, sessionName };
	});
	if (!changed) return;
	const saved = writeFlow(dir, { ...flow, goals });
	writeFlowHtml(dir, saved);
}

function sessionNameOrNull(name: unknown) {
	return typeof name === "string" && name ? name : null;
}
