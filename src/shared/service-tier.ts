import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./guards.js";

export type ServiceTier = "default" | "priority";

const SERVICE_TIER_FLAG = "pi-flow-service-tier";
const PRIORITY_MODELS = new Set(["gpt-5.4", "gpt-5.4-mini", "gpt-5.5"]);

export function registerServiceTier(pi: ExtensionAPI) {
	pi.registerFlag(SERVICE_TIER_FLAG, {
		type: "string",
		description: "Pi Flow service tier: default|priority",
	});
	pi.on("before_provider_request", (event) => {
		const tier = pi.getFlag(SERVICE_TIER_FLAG);
		return tier === "priority"
			? applyPriorityServiceTier(event.payload)
			: undefined;
	});
}

export function serviceTierArgs(tier: ServiceTier | undefined) {
	return tier === "priority" ? [`--${SERVICE_TIER_FLAG}`, tier] : [];
}

export function applyPriorityServiceTier(payload: unknown) {
	if (!isRecord(payload)) return undefined;
	if (!isPriorityPayload(payload)) return undefined;
	return { ...payload, service_tier: "priority" };
}

function isPriorityPayload(payload: Record<string, unknown>) {
	return (
		PRIORITY_MODELS.has(String(payload.model)) &&
		isRecord(payload.text) &&
		payload.text.verbosity !== undefined
	);
}
