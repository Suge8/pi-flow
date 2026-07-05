import { basename } from "node:path";
import type { GoalChecks } from "../goal/types.js";
import type { Language } from "../shared/config.js";
import { writeFlow } from "./store.js";
import type { FlowGoal, FlowGoalRole, FlowSource, FlowState } from "./types.js";

export interface FlowSemanticInput {
	title: string;
	goals: Array<{
		title: string;
		role: FlowGoalRole;
		file: string;
		dependsOn?: number[];
		writeScope?: string[];
	}>;
}

export function buildFlowArtifact(
	dir: string,
	input: FlowSemanticInput,
	language: Language,
	source: FlowSource,
): FlowState {
	const now = Date.now();
	return writeFlow(dir, {
		schemaVersion: 6,
		language,
		id: basename(dir),
		title: requiredTitle(input.title),
		status: "draft",
		source,
		createdAt: now,
		updatedAt: now,
		startedAt: null,
		currentGoal: 0,
		parallelBatch: null,
		repairAttempts: 0,
		errors: [],
		goals: input.goals.map(flowGoal),
	});
}

function flowGoal(
	goal: FlowSemanticInput["goals"][number],
	index: number,
): FlowGoal {
	return {
		index,
		title: goal.title,
		role: goal.role,
		file: goal.file,
		...(goal.dependsOn === undefined ? {} : { dependsOn: goal.dependsOn }),
		...(goal.writeScope === undefined ? {} : { writeScope: goal.writeScope }),
		status: "pending",
		completionCursor: null,
		sessionFile: null,
		sessionName: null,
		snapshot: null,
		snapshotHash: null,
		goalId: null,
		result: {
			summary: null,
			handoff: null,
			handoffGenerated: false,
			criteriaChanged: false,
		},
		checks: emptyChecks(),
	};
}

function requiredTitle(value: unknown) {
	if (typeof value === "string" && value.trim()) return value.trim();
	throw new Error("flow.semantic.json.title 必须是非空字符串");
}

function emptyChecks(): GoalChecks {
	return {
		acceptance: { enabled: true, rounds: [], active: null },
		quality: { enabled: true, rounds: [], active: null },
	};
}
