import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const registrations = new WeakMap<ExtensionAPI, Set<string>>();

export function registerRuntimePart(
	pi: ExtensionAPI,
	key: string,
	register: () => void,
) {
	let registered = registrations.get(pi);
	if (!registered) {
		registered = new Set();
		registrations.set(pi, registered);
	}
	if (registered.has(key)) return;
	register();
	registered.add(key);
}
