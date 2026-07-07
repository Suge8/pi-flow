import type { Language } from "../shared/config.js";
import { tryReadAlignmentState } from "../shared/generation-state.js";
import { formatError } from "../shared/guards.js";
import { currentSessionFile } from "../shared/session.js";
import { activeFlows, findFlow, flowCurrentSessionFile } from "./store.js";
import type { FlowLocation } from "./types.js";
import { flowCommandId } from "./util.js";

export type FlowTargetSource = "explicit" | "session" | "active";

export type FlowTargetResult =
	| { ok: true; location: FlowLocation; source: FlowTargetSource }
	| { ok: false; reason: "not_found"; id: string }
	| { ok: false; reason: "none" }
	| { ok: false; reason: "ambiguous_active"; flows: FlowLocation[] };

export function resolveFlowTarget(
	ctx: { cwd: string; sessionManager?: unknown },
	id?: string,
): FlowTargetResult {
	if (id) return explicitFlowTarget(ctx.cwd, id);
	const active = activeFlows(ctx.cwd);
	const owned = flowsOwningSession(active, currentSessionFile(ctx));
	if (owned.length === 1)
		return { ok: true, location: owned[0], source: "session" };
	if (owned.length > 1)
		return { ok: false, reason: "ambiguous_active", flows: owned };
	if (active.length === 1)
		return { ok: true, location: active[0], source: "active" };
	if (active.length > 1)
		return { ok: false, reason: "ambiguous_active", flows: active };
	return { ok: false, reason: "none" };
}

export function flowTargetMessage(
	result: Exclude<FlowTargetResult, { ok: true }>,
	language: Language,
	command: string,
) {
	if (result.reason === "not_found")
		return flowNotFoundMessage(result.id, language);
	if (result.reason === "ambiguous_active")
		return ambiguousActiveFlowsMessage(result.flows, command, language);
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
		? "No active Flow in the current directory; specify a Flow id."
		: "当前目录没有进行中的 Flow；请指定 Flow id。";
}

export function flowNotRunningMessage(flowId: string, language: Language) {
	return language === "en"
		? `Flow is not running: ${flowId}`
		: `Flow 未在运行：${flowId}`;
}

function flowsOwningSession(
	flows: FlowLocation[],
	sessionFile: string | undefined,
) {
	if (!sessionFile) return [];
	return flows.filter((location) =>
		flowBelongsToSession(location, sessionFile),
	);
}

function flowBelongsToSession(location: FlowLocation, sessionFile: string) {
	const { flow } = location;
	if (flow.status === "running")
		return flowCurrentSessionFile(flow) === sessionFile;
	if (flow.status !== "aligning" && flow.status !== "generating") return false;
	return tryReadAlignmentState(location.dir)?.sessionFile === sessionFile;
}

function ambiguousActiveFlowsMessage(
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
		? `Multiple active Flows found. Specify one:\n${choices}`
		: `当前目录有多个进行中的 Flow，请指定目标：\n${choices}`;
}

function copyableFlowId(flow: FlowLocation, flows: FlowLocation[]) {
	void flows;
	return flowCommandId(flow.id);
}

function explicitFlowTarget(cwd: string, id: string): FlowTargetResult {
	const location = findFlow(cwd, id);
	return location
		? { ok: true, location, source: "explicit" }
		: { ok: false, reason: "not_found", id };
}
