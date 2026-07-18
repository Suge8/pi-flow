import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./guards.js";

const OPENAI_FAST_FLAG = "pi-flow-openai-fast";
// OpenAI Priority 价格表的当前文本模型；Codex 集合再与 Pi 内置 Codex 模型取交集。
// https://developers.openai.com/api/docs/pricing#priority
const OPENAI_PRIORITY_MODELS = new Set([
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-5.5",
	"gpt-5.4",
	"gpt-5.4-mini",
	"gpt-5.2",
	"gpt-5.1",
	"gpt-5",
	"gpt-5-mini",
	"gpt-4.1",
	"gpt-4.1-mini",
	"gpt-4.1-nano",
	"gpt-4o",
	"gpt-4o-2024-05-13",
	"gpt-4o-mini",
	"o3",
	"o4-mini",
]);
const CODEX_PRIORITY_MODELS = new Set([
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-5.5",
	"gpt-5.4",
	"gpt-5.4-mini",
]);

export interface OpenAIFastModel {
	id: string;
	provider: string;
	api: string;
}

export function registerOpenAIFast(pi: ExtensionAPI) {
	pi.registerFlag(OPENAI_FAST_FLAG, {
		type: "boolean",
		description: "Use paid OpenAI priority processing when supported",
	});
	pi.on("before_provider_request", (event, ctx) => {
		if (pi.getFlag(OPENAI_FAST_FLAG) !== true) return undefined;
		return applyOpenAIFast(event.payload, ctx.model);
	});
}

export function openaiFastArgs(openaiFast: boolean) {
	return openaiFast ? [`--${OPENAI_FAST_FLAG}`] : [];
}

/** openaiFast 是用户意图；仅为已确认支持 Priority 的真实 OpenAI Responses 请求注入 provider 参数。 */
export function applyOpenAIFast(
	payload: unknown,
	model: OpenAIFastModel | undefined,
) {
	if (!model || !isResponsesPayload(payload, model) || !supportsPriority(model))
		return undefined;
	return { ...payload, service_tier: "priority" };
}

function isResponsesPayload(
	payload: unknown,
	model: OpenAIFastModel,
): payload is Record<string, unknown> {
	return (
		isRecord(payload) &&
		payload.model === model.id &&
		Array.isArray(payload.input)
	);
}

function supportsPriority(model: OpenAIFastModel) {
	if (model.provider === "openai" && model.api === "openai-responses")
		return supportsPriorityReference(model.provider, model.id);
	if (
		model.provider === "openai-codex" &&
		model.api === "openai-codex-responses"
	)
		return supportsPriorityReference(model.provider, model.id);
	return false;
}

function supportsPriorityReference(provider: string, id: string) {
	if (provider === "openai") return OPENAI_PRIORITY_MODELS.has(id);
	if (provider === "openai-codex") return CODEX_PRIORITY_MODELS.has(id);
	return false;
}
