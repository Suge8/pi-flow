import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FLOW_CHILD_EXTENSION = join(EXTENSION_DIR, "src", "child.ts");

export function childExtensionArgs(extensions: string[] = []) {
	const externalExtensions = extensions.filter(
		(extension) => extension !== FLOW_CHILD_EXTENSION,
	);
	return [
		"--no-extensions",
		...extensionArgs([...externalExtensions, FLOW_CHILD_EXTENSION]),
	];
}

export function flowChildExtensionPath() {
	return FLOW_CHILD_EXTENSION;
}

function extensionArgs(extensions: string[]) {
	return [...new Set(extensions)].flatMap((extension) => ["-e", extension]);
}
