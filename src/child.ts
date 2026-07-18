import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerOpenAIFast } from "./shared/openai-fast.js";

export default function flowChildExtension(pi: ExtensionAPI) {
	registerOpenAIFast(pi);
}
