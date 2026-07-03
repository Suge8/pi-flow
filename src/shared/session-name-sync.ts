import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { writeFlowHtml } from "../flow/html.js";
import { listFlows, writeFlow } from "../flow/store.js";
import { writeGoalHtml } from "../goal/html.js";
import { listGoalArtifacts, writeGoalArtifact } from "../goal/store.js";
import { formatError } from "./guards.js";
import { currentSessionFile } from "./session.js";

export function registerSessionNameSync(pi: ExtensionAPI) {
	pi.on("session_info_changed", (event, ctx) => {
		try {
			syncSessionName(ctx, sessionNameOrNull(event.name));
		} catch (error) {
			ctx.ui.notify(`会话名同步失败：${formatError(error)}`, "warning");
		}
	});
}

function syncSessionName(ctx: ExtensionContext, sessionName: string | null) {
	const sessionFile = currentSessionFile(ctx);
	if (!sessionFile) return;
	syncFlowSessionName(ctx.cwd, sessionFile, sessionName);
	syncGoalSessionName(ctx.cwd, sessionFile, sessionName);
}

function syncFlowSessionName(
	cwd: string,
	sessionFile: string,
	sessionName: string | null,
) {
	for (const location of listFlows(cwd)) {
		let changed = false;
		const goals = location.flow.goals.map((goal) => {
			if (goal.sessionFile !== sessionFile || goal.sessionName === sessionName)
				return goal;
			changed = true;
			return { ...goal, sessionName };
		});
		if (!changed) continue;
		const flow = writeFlow(location.dir, { ...location.flow, goals });
		writeFlowHtml(location.dir, flow);
	}
}

function syncGoalSessionName(
	cwd: string,
	sessionFile: string,
	sessionName: string | null,
) {
	for (const location of listGoalArtifacts(cwd)) {
		if (
			location.goal.sessionFile !== sessionFile ||
			location.goal.sessionName === sessionName
		)
			continue;
		const goal = writeGoalArtifact(location.dir, {
			...location.goal,
			sessionName,
		});
		writeGoalHtml(location.dir, goal);
	}
}

function sessionNameOrNull(name: unknown) {
	return typeof name === "string" && name ? name : null;
}
