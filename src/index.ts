import {
	CustomEditor,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { registerBootstrap } from "./bootstrap.js";
import { runtimeLanguage } from "./shared/language.js";

const runtimeKey = Symbol.for("pi-flow.tui-runtime");
Object.assign(globalThis, {
	[runtimeKey]: { CustomEditor, matchesKey, truncateToWidth, visibleWidth },
});

export default function flowExtension(pi: ExtensionAPI) {
	runtimeLanguage();
	registerBootstrap(pi);
}
