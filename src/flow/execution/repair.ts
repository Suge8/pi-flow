import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	type ConversationTurn,
	formatTranscript,
} from "../../shared/context-evidence.js";
import { isRecord } from "../../shared/guards.js";
import { sendOrchestrationPrompt } from "../../shared/internal-prompt.js";
import { runtimeLanguage } from "../../shared/language.js";
import {
	confirmUser,
	formatUserNotice,
	notifyUser,
} from "../../shared/ui-language.js";
import { refreshFlowErrorHtmlProjection } from "../html.js";
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
	refreshFlowErrorHtmlProjection(ctx, location.dir, {
		title: safeFlowTitle(flow, location.id),
		errors,
		requestText: safeRequestText(flow),
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
	sendOrchestrationPrompt(
		pi,
		ctx,
		repairPrompt({
			errors,
			requestText: safeRequestText(flow),
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

function safeRequestText(flow: unknown) {
	if (!isRecord(flow) || !isRecord(flow.source)) return "";
	const source = flow.source;
	if (
		(source.type === "prompt" || source.type === "file") &&
		typeof source.text === "string"
	)
		return source.text;
	if (
		source.type !== "conversation" ||
		!Array.isArray(source.transcript) ||
		!source.transcript.every(isConversationTurn)
	)
		return "";
	const language = flow.language === "en" ? "en" : "zh";
	return formatTranscript(source.transcript, language);
}

function isConversationTurn(value: unknown): value is ConversationTurn {
	return (
		isRecord(value) &&
		(value.kind === "user" ||
			value.kind === "visible_supplement" ||
			value.kind === "assistant_final") &&
		typeof value.at === "string" &&
		typeof value.text === "string"
	);
}
