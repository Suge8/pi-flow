import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CheckRoundAdvisor } from "../goal/types.js";
import type { Language } from "./config.js";
import { isRecord } from "./guards.js";
import {
	composeResultCardLines,
	deliveredResultCardDetails,
	sendResultCard,
} from "./result-card.js";

interface AdvisorCardInput {
	advice: CheckRoundAdvisor;
	language: Language;
	content?: string;
	next?: string;
	deliveryId?: string;
	triggerTurn?: boolean;
	deliverAs?: "followUp";
}

export function sendAdvisorCard(
	pi: ExtensionAPI | undefined,
	ctx: Pick<ExtensionContext, "ui"> & {
		sendMessage?: ExtensionAPI["sendMessage"];
	},
	input: AdvisorCardInput,
) {
	const title = input.language === "en" ? "Advisor advice" : "顾问建议";
	const lines = composeResultCardLines([
		[input.advice.advice],
		...(input.next ? [[input.next]] : []),
	]);
	const content =
		input.content ??
		[`[${title}]`, input.advice.advice, input.next]
			.filter((line): line is string => Boolean(line))
			.join("\n");
	return sendResultCard(
		pi,
		ctx,
		content,
		{
			tone: "neutral",
			result: "完成",
			title,
			icon: "🧭",
			lines,
			language: input.language,
			context: "check-result",
			advisor: input.advice,
			...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
		},
		{ triggerTurn: input.triggerTurn, deliverAs: input.deliverAs },
	);
}

export function advisorCardAdvice(
	ctx: Pick<ExtensionContext, "sessionManager">,
	deliveryId: string,
): CheckRoundAdvisor | undefined {
	const advisor = deliveredResultCardDetails(ctx, deliveryId)?.advisor;
	if (
		!isRecord(advisor) ||
		typeof advisor.model !== "string" ||
		typeof advisor.thinking !== "string" ||
		typeof advisor.advice !== "string"
	)
		return undefined;
	return {
		model: advisor.model,
		thinking: advisor.thinking,
		advice: advisor.advice,
	};
}
