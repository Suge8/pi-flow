import { type FSWatcher, watch } from "node:fs";

type WatchOptions = {
	skipIfSame?: boolean;
};

export function createPlanFileWatcher() {
	let activeWatcher: FSWatcher | undefined;
	let activeFile: string | undefined;

	function watchFile(
		file: string,
		refresh: () => void,
		options: WatchOptions = {},
	) {
		if (options.skipIfSame && activeFile === file) return;
		close();
		activeFile = file;
		try {
			activeWatcher = watch(file, { persistent: false }, () => {
				if (activeFile !== file) return;
				refreshSafely(refresh);
			});
		} catch {
			activeFile = undefined;
		}
	}

	function refresh(refresh: () => void) {
		refreshSafely(refresh);
	}

	function close() {
		activeWatcher?.close();
		activeWatcher = undefined;
		activeFile = undefined;
	}

	return { watchFile, refresh, close };
}

function refreshSafely(refresh: () => void) {
	try {
		refresh();
	} catch {
		// Best-effort derived UI refresh; command paths surface real errors.
	}
}
