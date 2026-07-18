import { fileURLToPath } from "node:url";

export function validateDraftCommand() {
	return `node ${JSON.stringify(fileURLToPath(new URL("../validate-draft.js", import.meta.url)))}`;
}
