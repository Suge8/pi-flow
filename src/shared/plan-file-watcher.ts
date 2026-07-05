import { existsSync, type FSWatcher, watch } from "node:fs";
import { basename, dirname } from "node:path";

type WatchOptions = {
	keepExisting?: boolean;
	skipIfSame?: boolean;
};

export function createPlanFileWatcher() {
	const activeWatchers = new Map<string, FSWatcher>();

	function watchFile(
		file: string,
		refresh: () => void,
		options: WatchOptions = {},
	) {
		if (isSameWatch(file, options)) return;
		if (options.keepExisting) closeFile(file);
		else close();
		try {
			activeWatchers.set(file, createWatcher(file, refresh));
		} catch {
			activeWatchers.delete(file);
		}
	}

	function refresh(refresh: () => void) {
		refreshSafely(refresh);
	}

	function close() {
		for (const watcher of activeWatchers.values()) watcher.close();
		activeWatchers.clear();
	}

	function closeFile(file: string) {
		activeWatchers.get(file)?.close();
		activeWatchers.delete(file);
	}

	function isSameWatch(file: string, options: WatchOptions) {
		if (!options.skipIfSame || !activeWatchers.has(file)) return false;
		return options.keepExisting || activeWatchers.size === 1;
	}

	function createWatcher(file: string, refresh: () => void) {
		return existsSync(file)
			? watchExistingFile(file, refresh)
			: watchParentForFile(file, refresh);
	}

	function watchExistingFile(file: string, refresh: () => void) {
		let watcher: FSWatcher;
		watcher = watch(file, { persistent: false }, () => {
			if (activeWatchers.get(file) !== watcher) return;
			refreshSafely(refresh);
		});
		return watcher;
	}

	function watchParentForFile(file: string, refresh: () => void) {
		let watcher: FSWatcher;
		watcher = watch(dirname(file), { persistent: false }, (_event, name) => {
			if (activeWatchers.get(file) !== watcher) return;
			if (name !== null && String(name) !== basename(file)) return;
			if (!existsSync(file)) return;
			refreshSafely(refresh);
			try {
				watcher.close();
				activeWatchers.set(file, watchExistingFile(file, refresh));
			} catch {
				activeWatchers.delete(file);
			}
		});
		return watcher;
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
