import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { GoalChecks } from "../goal/types.js";
import { missingPlanSections } from "../plan/markdown.js";
import type { Language } from "../shared/config.js";
import { tryReadFlow, writeFlow } from "./store.js";
import type { FlowGoal, FlowGoalRole, FlowSource, FlowState } from "./types.js";
import { FLOW_SCHEMA_VERSION } from "./types.js";

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
	const previous = tryReadFlow(dir);
	const createdAt =
		previous && Number.isFinite(previous.createdAt) ? previous.createdAt : now;
	const repairAttempts =
		previous && Number.isInteger(previous.repairAttempts)
			? previous.repairAttempts
			: 0;
	const title = requiredTitle(input.title);
	for (const goal of input.goals) appendOptionalSections(dir, goal.file);
	return writeFlow(dir, {
		schemaVersion: FLOW_SCHEMA_VERSION,
		language,
		id: basename(dir),
		title,
		status: "draft",
		source,
		createdAt,
		updatedAt: now,
		startedAt: null,
		completedAt: null,
		currentGoal: 0,
		meta: previous?.meta ?? null,
		attention: null,
		parallelRun: null,
		repairAttempts,
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
		startedAt: null,
		completedAt: null,
		completionCursor: null,
		sessionFile: null,
		sessionName: null,
		snapshot: null,
		goalId: null,
		result: {
			summary: null,
			handoff: null,
			handoffGenerated: false,
			criteriaChanged: false,
		},
		checks: emptyChecks(),
		pendingAdvisor: null,
	};
}

function requiredTitle(value: unknown) {
	if (typeof value === "string" && value.trim()) return value.trim();
	throw new Error("flow.semantic.json.title 必须是非空字符串");
}

function appendOptionalSections(dir: string, file: string) {
	const path = safeGoalMarkdownPath(dir, file);
	if (!path) return;
	const markdown = readFileSync(path, "utf8");
	const missing = missingPlanSections(markdown).filter(
		(section) => section === "Notes" || section === "Handoff",
	);
	if (missing.length === 0) return;
	writeFileSync(
		path,
		`${markdown.trimEnd()}\n\n${missing.map((section) => `## ${section}`).join("\n\n")}\n`,
	);
}

function safeGoalMarkdownPath(dir: string, file: string) {
	if (typeof file !== "string" || isAbsolute(file)) return undefined;
	try {
		const root = realpathSync(dir);
		const path = resolve(root, file);
		const pathFromRoot = relative(root, path);
		if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot))
			return undefined;
		if (!lstatSync(path).isFile()) return undefined;
		const realPath = realpathSync(path);
		const realPathFromRoot = relative(root, realPath);
		return realPathFromRoot.startsWith("..") || isAbsolute(realPathFromRoot)
			? undefined
			: path;
	} catch {
		return undefined;
	}
}

function emptyChecks(): GoalChecks {
	return {
		acceptance: { enabled: true, rounds: [], active: null },
		quality: { enabled: true, rounds: [], active: null },
	};
}
