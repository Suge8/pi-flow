import type { Language } from "../shared/config.js";
import { formatError } from "../shared/guards.js";
import { currentSessionFile } from "../shared/session.js";
import { findFlow, runningFlows } from "./store.js";
import type { FlowLocation } from "./types.js";
import { flowCommandId } from "./util.js";

export type FlowTargetSource = "explicit" | "session" | "running";

export type FlowTargetResult =
	| { ok: true; location: FlowLocation; source: FlowTargetSource }
	| { ok: false; reason: "not_found"; id: string }
	| { ok: false; reason: "none" }
	| { ok: false; reason: "ambiguous_running"; flows: FlowLocation[] };

export function resolveFlowTarget(
	ctx: { cwd: string; sessionManager?: unknown },
	id?: string,
): FlowTargetResult {
	if (id) return explicitFlowTarget(ctx.cwd, id);
	const running = runningFlows(ctx.cwd);
	const owned = flowOwningSession(running, currentSessionFile(ctx));
	if (owned) return { ok: true, location: owned, source: "session" };
	if (running.length === 1)
		return { ok: true, location: running[0], source: "running" };
	if (running.length > 1)
		return { ok: false, reason: "ambiguous_running", flows: running };
	return { ok: false, reason: "none" };
}

export function flowTargetMessage(
	result: Exclude<FlowTargetResult, { ok: true }>,
	language: Language,
	command: string,
) {
	if (result.reason === "not_found")
		return flowNotFoundMessage(result.id, language);
	if (result.reason === "ambiguous_running")
		return ambiguousRunningFlowsMessage(result.flows, command, language);
	return flowTargetRequiredMessage(language);
}

export function flowTargetLookupFailedMessage(
	error: unknown,
	language: Language,
) {
	return language === "en"
		? `flow.json read failed: ${formatError(error)}`
		: `flow.json 读取失败：${formatError(error)}`;
}

export function flowNotFoundMessage(flowId: string, language: Language) {
	return language === "en"
		? `Flow not found: ${flowId}`
		: `未找到 Flow：${flowId}`;
}

export function flowTargetRequiredMessage(language: Language) {
	return language === "en"
		? "No running Flow in the current directory; specify a Flow id."
		: "当前目录没有运行中的 Flow；请指定 Flow id。";
}

export function flowNotRunningMessage(flowId: string, language: Language) {
	return language === "en"
		? `Flow is not running: ${flowId}`
		: `Flow 未在运行：${flowId}`;
}

function flowOwningSession(
	flows: FlowLocation[],
	sessionFile: string | undefined,
) {
	if (!sessionFile) return undefined;
	return flows.find(
		({ flow }) =>
			Array.isArray(flow.goals) &&
			flow.goals.some((goal) => goal.sessionFile === sessionFile),
	);
}

function ambiguousRunningFlowsMessage(
	flows: FlowLocation[],
	command: string,
	language: Language,
) {
	const choices = flows
		.map((flow) => {
			const id = copyableFlowId(flow, flows);
			return `- ${id} · /flow ${command} ${id}`;
		})
		.join("\n");
	return language === "en"
		? `Multiple running Flows found. Specify one:\n${choices}`
		: `当前目录有多个运行中的 Flow，请指定目标：\n${choices}`;
}

function copyableFlowId(flow: FlowLocation, flows: FlowLocation[]) {
	const shortId = flowCommandId(flow.id);
	const duplicateShortId = flows.some(
		(item) => item.id !== flow.id && flowCommandId(item.id) === shortId,
	);
	return duplicateShortId ? flow.id : shortId;
}

function explicitFlowTarget(cwd: string, id: string): FlowTargetResult {
	const location = findFlow(cwd, id);
	return location
		? { ok: true, location, source: "explicit" }
		: { ok: false, reason: "not_found", id };
}
