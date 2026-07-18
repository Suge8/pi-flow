interface TuiRuntime {
	CustomEditor: typeof import("@earendil-works/pi-coding-agent").CustomEditor;
	matchesKey: typeof import("@earendil-works/pi-tui").matchesKey;
	truncateToWidth: typeof import("@earendil-works/pi-tui").truncateToWidth;
	visibleWidth: typeof import("@earendil-works/pi-tui").visibleWidth;
}

const runtimeKey = Symbol.for("pi-flow.tui-runtime");
const runtimeScope = globalThis as typeof globalThis & {
	[runtimeKey]?: TuiRuntime;
};
const runtime = await loadTuiRuntime();

export const { CustomEditor, matchesKey, truncateToWidth, visibleWidth } =
	runtime;

async function loadTuiRuntime(): Promise<TuiRuntime> {
	const installed = runtimeScope[runtimeKey];
	if (installed) return installed;
	const [agent, tui] = await Promise.all([
		import("@earendil-works/pi-coding-agent"),
		import("@earendil-works/pi-tui"),
	]);
	return {
		CustomEditor: agent.CustomEditor,
		matchesKey: tui.matchesKey,
		truncateToWidth: tui.truncateToWidth,
		visibleWidth: tui.visibleWidth,
	};
}
