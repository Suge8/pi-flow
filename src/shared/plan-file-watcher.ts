import { type FSWatcher, watch } from "node:fs";
import { basename, dirname } from "node:path";

type WatchOptions = {
	keepExisting?: boolean;
	skipIfSame?: boolean;
};

type FileRegistration = {
	directory: string;
	close: () => void;
};

type DirectoryWatcher = {
	watcher: FSWatcher;
	callbacks: Map<string, Set<() => void>>;
};

const directoryWatchers = new Map<string, DirectoryWatcher>();

export function createPlanFileWatcher() {
	const files = new Map<string, FileRegistration>();

	function watchFile(
		file: string,
		refresh: () => void,
		options: WatchOptions = {},
	) {
		if (isSameWatch(file, options)) return;
		if (options.keepExisting) closeFile(file);
		else close();
		try {
			files.set(file, {
				directory: dirname(file),
				close: subscribePlanFile(file, refresh),
			});
		} catch {
			files.delete(file);
		}
	}

	function close() {
		for (const registration of files.values()) registration.close();
		files.clear();
	}

	function closeFile(file: string) {
		const registration = files.get(file);
		if (!registration) return;
		files.delete(file);
		registration.close();
	}

	function isSameWatch(file: string, options: WatchOptions) {
		if (!options.skipIfSame || !files.has(file)) return false;
		return options.keepExisting || files.size === 1;
	}

	function stats() {
		return {
			watchedFiles: files.size,
			osWatchers: new Set(
				[...files.values()].map((registration) => registration.directory),
			).size,
		};
	}

	return { watchFile, closeFile, close, stats };
}

export function subscribePlanFile(file: string, refresh: () => void) {
	const directory = dirname(file);
	const name = basename(file);
	const entry = watcherForDirectory(directory);
	const callback = () => refresh();
	const callbacks = entry.callbacks.get(name) ?? new Set();
	callbacks.add(callback);
	entry.callbacks.set(name, callbacks);
	let closed = false;
	return () => {
		if (closed) return;
		closed = true;
		if (directoryWatchers.get(directory) !== entry) return;
		callbacks.delete(callback);
		if (callbacks.size === 0) entry.callbacks.delete(name);
		if (entry.callbacks.size > 0) return;
		entry.watcher.close();
		directoryWatchers.delete(directory);
	};
}

export function planFileWatcherResourceSnapshot() {
	let watchedFiles = 0;
	let registrations = 0;
	for (const entry of directoryWatchers.values()) {
		watchedFiles += entry.callbacks.size;
		for (const callbacks of entry.callbacks.values())
			registrations += callbacks.size;
	}
	return {
		osWatchers: directoryWatchers.size,
		watchedFiles,
		registrations,
	};
}

function watcherForDirectory(directory: string) {
	const existing = directoryWatchers.get(directory);
	if (existing) return existing;
	const callbacks = new Map<string, Set<() => void>>();
	let entry: DirectoryWatcher;
	const watcher = watch(directory, { persistent: false }, (_event, name) =>
		refreshDirectory(directory, entry, name),
	);
	entry = { watcher, callbacks };
	directoryWatchers.set(directory, entry);
	return entry;
}

function refreshDirectory(
	directory: string,
	entry: DirectoryWatcher,
	name: string | null,
) {
	if (directoryWatchers.get(directory) !== entry) return;
	const callbackSets =
		name === null
			? [...entry.callbacks.values()]
			: [entry.callbacks.get(String(name))];
	for (const callbacks of callbackSets)
		for (const refresh of [...(callbacks ?? [])]) refreshSafely(refresh);
}

function refreshSafely(refresh: () => void) {
	try {
		refresh();
	} catch {
		// Best-effort derived UI refresh; command paths surface real errors.
	}
}
