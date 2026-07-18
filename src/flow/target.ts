import type { Language } from "../shared/config.js";
import { formatError } from "../shared/guards.js";
import { currentSessionFile } from "../shared/session.js";
import { formatUserNotice } from "../shared/ui-language.js";
import { quoteCommand } from "./parallel/console.js";
import {
	advanceableFlows,
	findFlow,
	flowLocationOwnsSession,
	latestFlow,
} from "./store.js";
import type { FlowLocation } from "./types.js";
import { flowCommandId } from "./util.js";

export type FlowTargetSource = "explicit" | "session" | "advanceable";

export type FlowTargetResult =
	| { ok: true; location: FlowLocation; source: FlowTargetSource }
	| { ok: false; reason: "not_found"; id: string }
	| { ok: false; reason: "none"; latestComplete?: FlowLocation }
	| { ok: false; reason: "ambiguous_active"; flows: FlowLocation[] };

export function resolveFlowTarget(
	ctx: { cwd: string; sessionManager?: unknown },
	id?: string,
): FlowTargetResult {
	if (id) return explicitFlowTarget(ctx.cwd, id);
	const advanceable = advanceableFlows(ctx.cwd);
	const owned = flowsOwningSession(advanceable, currentSessionFile(ctx));
	if (owned.length === 1)
		return { ok: true, location: owned[0], source: "session" };
	if (owned.length > 1)
		return { ok: false, reason: "ambiguous_active", flows: owned };
	if (advanceable.length === 1)
		return { ok: true, location: advanceable[0], source: "advanceable" };
	if (advanceable.length > 1)
		return { ok: false, reason: "ambiguous_active", flows: advanceable };
	return {
		ok: false,
		reason: "none",
		latestComplete: latestFlow(ctx.cwd, (flow) => flow.status === "complete"),
	};
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
	return flowTargetRequiredMessage(language, result.latestComplete);
}

export function flowTargetLookupFailedMessage(
	error: unknown,
	language: Language,
) {
	return language === "en"
		? formatUserNotice("❌", "flow.json read failed", [formatError(error)])
		: formatUserNotice("❌", "flow.json 读取失败", [formatError(error)]);
}

export function flowNotFoundMessage(flowId: string, language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Flow not found", [`ID: ${flowId}`])
		: formatUserNotice("⚠️", "未找到 Flow", [`编号：${flowId}`]);
}

export function flowTargetRequiredMessage(
	language: Language,
	latestComplete?: FlowLocation,
) {
	if (latestComplete) {
		const id = flowCommandId(latestComplete.id);
		const report = quoteCommand(`/flow go ${id}`);
		return language === "en"
			? formatUserNotice("⚠️", "No Flow can be advanced", [
					`${id} is complete · ${report} opens its report`,
				])
			: formatUserNotice("⚠️", "没有可推进的 Flow", [
					`${id} 已完成 · ${report} 查看报告`,
				]);
	}
	return language === "en"
		? formatUserNotice("⚠️", "No Flow can be advanced", ["Specify a Flow id"])
		: formatUserNotice("⚠️", "没有可推进的 Flow", ["请指定 Flow id"]);
}

export function flowNotRunningMessage(flowId: string, language: Language) {
	return language === "en"
		? formatUserNotice("⚠️", "Flow is not running", [`ID: ${flowId}`])
		: formatUserNotice("⚠️", "Flow 未在运行", [`编号：${flowId}`]);
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
	return flowLocationOwnsSession(location, sessionFile);
}

function ambiguousActiveFlowsMessage(
	flows: FlowLocation[],
	command: string,
	language: Language,
) {
	const choices = flows
		.map((flow) => {
			const id = copyableFlowId(flow, flows);
			return `- ${id} · ${quoteCommand(`/flow ${command} ${id}`)}`;
		})
		.join("\n");
	return language === "en"
		? formatUserNotice("⚠️", "Multiple Flows can be advanced", [
				"Specify one",
				choices,
			])
		: formatUserNotice("⚠️", "多个可推进的 Flow", ["请指定目标", choices]);
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
