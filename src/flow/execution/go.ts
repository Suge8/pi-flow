import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { formatError } from "../../shared/guards.js";
import { runtimeLanguage } from "../../shared/language.js";
import { liveReportUrl } from "../../shared/report-client.js";
import { formatUserNotice, notifyUser } from "../../shared/ui-language.js";
import { flowReportPublication, writeFlowHtml } from "../html.js";
import { withFlowLockSync } from "../lock.js";
import { readFlow, writeFlow } from "../store.js";
import {
	flowTargetLookupFailedMessage,
	flowTargetMessage,
	resolveFlowTarget,
} from "../target.js";
import type { FlowLocation } from "../types.js";
import { flowCommandId } from "../util.js";
import { validateFlowDir } from "../validator.js";
import { advanceFlowExecution } from "./advance.js";
import { askRepair } from "./repair.js";

export async function goFlow(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	id?: string,
) {
	const location = await goTargetOrNotify(pi, ctx, id);
	if (!location) return;
	if (location.flow.status === "complete")
		return notifyCompleteFlow(ctx, location);
	if (location.flow.goals.length === 0) {
		notifyUser(
			ctx,
			missingGenerationStateNotice(location.flow.language),
			"info",
			location.flow.language,
		);
		return;
	}
	if (location.flow.status === "running") await openFlowReport(ctx, location);
	const target = shouldClassifyBeforeClearingAttention(location)
		? location
		: clearFlowAttention(location);
	return advanceFlowExecution(pi, ctx, target);
}

function shouldClassifyBeforeClearingAttention(location: FlowLocation) {
	return (
		location.flow.status === "paused" &&
		location.flow.startedAt !== null &&
		location.flow.parallelRun === null &&
		location.flow.goals[location.flow.currentGoal]?.status === "running"
	);
}

/** 「go」是唯一接管入口：可安全推进前清空 attention，后续异常会重新写入。 */
function clearFlowAttention(location: FlowLocation): FlowLocation {
	if (!location.flow.attention) return location;
	const cleared = withFlowLockSync(
		location.dir,
		`clear attention ${location.flow.id}`,
		() =>
			writeFlow(location.dir, { ...readFlow(location.dir), attention: null }),
	);
	return cleared.ok ? { ...location, flow: cleared.value } : location;
}

async function goTargetOrNotify(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	id: string | undefined,
) {
	let target: ReturnType<typeof resolveFlowTarget>;
	try {
		target = resolveFlowTarget(ctx, id);
	} catch (error) {
		const language = runtimeLanguage();
		notifyUser(
			ctx,
			flowTargetLookupFailedMessage(error, language),
			"info",
			language,
		);
		return undefined;
	}
	if (!target.ok) {
		const language = runtimeLanguage();
		notifyUser(
			ctx,
			flowTargetMessage(target, language, "go"),
			"info",
			language,
		);
		return undefined;
	}
	const validation = validateFlowDir(
		target.location.dir,
		target.location.flow.language,
	);
	if (!validation.ok || !validation.flow) {
		await askRepair(pi, ctx, target.location, validation.errors);
		return undefined;
	}
	return { ...target.location, flow: validation.flow };
}

async function notifyCompleteFlow(
	ctx: ExtensionCommandContext,
	location: FlowLocation,
) {
	const report = await openFlowReport(ctx, location);
	const id = flowCommandId(location.flow.id);
	notifyUser(
		ctx,
		completeFlowNotice(location, id, report),
		"info",
		location.flow.language,
	);
}

function completeFlowNotice(
	location: FlowLocation,
	id: string,
	report: string | undefined,
) {
	const language = location.flow.language;
	if (language === "en")
		return formatUserNotice("✅", `Flow ${id} is already complete`, [
			report ? `🌐 Web report: ${report}` : "No action needed",
		]);
	return formatUserNotice("✅", `Flow ${id} 已完成`, [
		report ? `🌐 网页报告: ${report}` : "无需推进",
	]);
}

function missingGenerationStateNotice(
	language: FlowLocation["flow"]["language"],
) {
	return language === "en"
		? formatUserNotice("⚠️", "Flow cannot advance", [
				"Generation state is missing",
			])
		: formatUserNotice("⚠️", "Flow 无法推进", ["生成状态缺失"]);
}

async function openFlowReport(
	ctx: ExtensionCommandContext,
	location: FlowLocation,
) {
	try {
		return await liveReportUrl(
			ctx,
			writeFlowHtml(location.dir, location.flow),
			location.flow.language,
			flowReportPublication(location.flow),
		);
	} catch (error) {
		notifyUser(
			ctx,
			location.flow.language === "en"
				? formatUserNotice("⚠️", "Flow report could not open", [
						formatError(error),
					])
				: formatUserNotice("⚠️", "Flow 报告打开失败", [formatError(error)]),
			"info",
			location.flow.language,
		);
		return undefined;
	}
}
