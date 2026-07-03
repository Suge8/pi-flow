import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerServiceTier } from "./shared/service-tier.js";

export default function flowChildExtension(pi: ExtensionAPI) {
	registerServiceTier(pi);
}
