import { fileURLToPath } from "node:url";

export function validateDraftCommand() {
	return `node ${JSON.stringify(fileURLToPath(new URL("../../scripts/validate-draft.mjs", import.meta.url)))}`;
}
