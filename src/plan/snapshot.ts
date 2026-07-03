import { sha256 } from "../flow/util.js";
import { planSection } from "./markdown.js";

const IMMUTABLE_SECTIONS = ["Objective", "Scope", "Success Criteria"] as const;

export function planSnapshotHash(markdown: string) {
	return sha256(immutableSnapshot(markdown));
}

export function immutableSnapshot(markdown: string) {
	return IMMUTABLE_SECTIONS.map(
		(section) => `## ${section}\n${planSection(markdown, section)}`,
	).join("\n\n");
}
