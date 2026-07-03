import { basename } from "node:path";
import type { FlowSource } from "../flow/types.js";
import type { Language } from "../shared/config.js";
import { writeGoalArtifact } from "./store.js";
import type { GoalArtifactState, GoalChecks } from "./types.js";

export interface GoalSemanticInput {
	title: unknown;
	source?: Partial<FlowSource>;
}

export function buildGoalArtifact(
	dir: string,
	input: GoalSemanticInput,
	language: Language,
	cwd: string,
): GoalArtifactState {
	void cwd;
	const now = Date.now();
	return writeGoalArtifact(dir, {
		schemaVersion: 5,
		language,
		id: basename(dir),
		title: requiredTitle(input.title),
		status: "draft",
		completionCursor: null,
		source: sourceFromInput(input.source),
		createdAt: now,
		updatedAt: now,
		repairAttempts: 0,
		errors: [],
		sessionFile: null,
		sessionName: null,
		snapshot: null,
		snapshotHash: null,
		runtimeGoalId: null,
		result: { summary: null, outcome: null },
		checks: emptyChecks(),
	});
}

function requiredTitle(value: unknown) {
	if (typeof value === "string" && value.trim()) return value.trim();
	throw new Error("目标语义草稿标题必须是非空字符串");
}

function sourceFromInput(input: unknown): FlowSource {
	const source: Partial<FlowSource> =
		input && typeof input === "object" ? (input as Partial<FlowSource>) : {};
	const path = source.path;
	const originalRequest = source.originalRequest;
	return {
		type: sourceType(source.type),
		path: path === null || typeof path === "string" ? path : null,
		originalRequest: typeof originalRequest === "string" ? originalRequest : "",
	};
}

function sourceType(value: unknown): FlowSource["type"] {
	return value === "conversation" || value === "prompt" || value === "file"
		? value
		: "prompt";
}

function emptyChecks(): GoalChecks {
	return {
		acceptance: { enabled: true, rounds: [], active: null },
		quality: { enabled: true, rounds: [], active: null },
	};
}
