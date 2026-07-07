import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { isRecord } from "../../shared/guards.js";
import { sendOrchestrationPrompt } from "../../shared/internal-prompt.js";
import { runtimeLanguage } from "../../shared/language.js";
import {
	confirmUser,
	formatUserNotice,
	notifyUser,
} from "../../shared/ui-language.js";
import { writeFlowErrorHtml } from "../html.js";
import { repairPrompt } from "../prompt.js";
import { touchFlowErrors } from "../store.js";
import type { FlowLocation } from "../types.js";

export async function askRepair(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	location: FlowLocation,
	errors: string[],
) {
	const flow = touchFlowErrors(location.dir, location.flow, errors);
	const language = flow.language ?? runtimeLanguage();
	writeFlowErrorHtml(location.dir, {
		title: safeFlowTitle(flow, location.id),
		errors,
		originalRequest: safeOriginalRequest(flow),
		language,
	});
	const shouldRepair = await confirmUser(
		ctx,
		language === "en" ? "Flow validation failed" : "Flow 校验失败",
		language === "en"
			? `${errors.join("\n")}\n\nLet AI repair the .flow files?`
			: `${errors.join("\n")}\n\n是否让 AI 修复 .flow 文件？`,
		undefined,
		language,
	);
	if (!shouldRepair) return;
	notifyUser(ctx, flowRepairingNotice(language), "info", language);
	await sendOrchestrationPrompt(
		pi,
		ctx,
		repairPrompt({
			errors,
			originalRequest: safeOriginalRequest(flow),
			flowPath: location.dir,
			language,
		}),
		{
			followUp: true,
			errorPrefix:
				language === "en"
					? "Flow plan repair prompt send failed"
					: "Flow 计划修复提示发送失败",
			language,
		},
	);
}

function flowRepairingNotice(language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("🛠️", "Flow plan repair in progress", [
				"It will be validated automatically when done",
			])
		: formatUserNotice("🛠️", "Flow 计划修复中", ["完成后会自动校验"]);
}

function safeFlowTitle(flow: unknown, fallback: string) {
	return isRecord(flow) && typeof flow.title === "string" && flow.title.trim()
		? flow.title
		: fallback;
}

function safeOriginalRequest(flow: unknown) {
	if (!isRecord(flow) || !isRecord(flow.source)) return "";
	return typeof flow.source.originalRequest === "string"
		? flow.source.originalRequest
		: "";
}
