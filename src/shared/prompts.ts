import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Language } from "./config.js";

const EXTENSION_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export function readPrompt(
	name:
		| "goal-audit"
		| "review"
		| "advisor"
		| "grilling"
		| "flow-plan"
		| "flow-repair"
		| "flow-draft-contract",
	language: Language = "zh",
) {
	const dir = language === "en" ? "en" : "zh";
	const path = join(EXTENSION_DIR, "prompts", dir, `${name}.md`);
	const fallback = join(EXTENSION_DIR, "prompts", "zh", `${name}.md`);
	return readFileSync(existsSync(path) ? path : fallback, "utf8").trim();
}
