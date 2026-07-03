import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import flowCommandExtension from "./flow.js";
import goalExtension from "./goal.js";
import reviewExtension from "./review.js";
import { runtimeLanguage } from "./shared/language.js";
import { registerServiceTier } from "./shared/service-tier.js";
import { registerSessionNameSync } from "./shared/session-name-sync.js";
import { installLocalizedUi } from "./shared/ui-language.js";

export default function flowExtension(pi: ExtensionAPI) {
	runtimeLanguage();
	pi.on("session_start", (_event, ctx) => installLocalizedUi(ctx));
	registerServiceTier(pi);
	registerSessionNameSync(pi);
	goalExtension(pi);
	reviewExtension(pi);
	flowCommandExtension(pi);
}
