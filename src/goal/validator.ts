import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { outcomeText, planSection } from "../plan/markdown.js";
import {
	STANDALONE_GOAL_SECTIONS,
	validatePlanMarkdown,
} from "../plan/validator.js";
import type { Language } from "../shared/config.js";
import { localizeErrors } from "../shared/error-language.js";
import { formatError, nonEmpty } from "../shared/guards.js";
import {
	readRequiredArtifact,
	validateChecks,
	validateCompletionCursor,
	validateErrorsArray,
	validateLanguage,
	validateResultObject,
	validateSource,
	validateStringOrNullFields,
} from "../shared/shape-validation.js";
import { goalJsonPath, goalPlanPath, readGoalArtifact } from "./store.js";
import type { GoalArtifactState, GoalArtifactStatus } from "./types.js";

export { validateChecks };

const GOAL_ID_PATTERN = /^G[1-9]\d*-[a-z0-9-]+$/u;
const GOAL_STATUSES = new Set<GoalArtifactStatus>([
	"draft",
	"running",
	"paused",
	"budget_limited",
	"complete",
	"cancelled",
]);
const STRING_OR_NULL_FIELDS = [
	"sessionFile",
	"sessionName",
	"snapshot",
	"snapshotHash",
	"runtimeGoalId",
] as const;

export function validateGoalDir(dir: string, language?: Language) {
	const artifact = readRequiredArtifact(
		goalJsonPath(dir),
		"缺少 goal.json",
		() => readGoalArtifact(dir),
		"goal.json",
	);
	if (!artifact.ok)
		return {
			ok: false,
			errors: localizeErrors(artifact.errors, language ?? "zh"),
		};

	const errors: string[] = [];
	const goal = artifact.artifact;
	const errorLanguage =
		goal.language === "en" || goal.language === "zh" ? goal.language : language;
	validateGoalShape(goal, errors);
	validateGoalDirName(dir, goal, errors);
	if (errors.length === 0) validatePlanFile(dir, errors);
	return {
		ok: errors.length === 0,
		errors: localizeErrors(errors, errorLanguage ?? "zh"),
		goal,
	};
}

export function validateGoalShape(goal: GoalArtifactState, errors: string[]) {
	if (goal.schemaVersion !== 5) errors.push("schemaVersion 必须为 5");
	validateLanguage(goal.language, errors);
	if (!GOAL_ID_PATTERN.test(String(goal.id ?? "")))
		errors.push("id 必须匹配 G1-xxx");
	if (!nonEmpty(goal.title)) errors.push("title 必须是非空字符串");
	if (!GOAL_STATUSES.has(goal.status))
		errors.push(`status 非法：${goal.status}`);
	if (!Number.isFinite(goal.createdAt)) errors.push("createdAt 必须是时间戳");
	if (!Number.isFinite(goal.updatedAt)) errors.push("updatedAt 必须是时间戳");
	if (!Number.isInteger(goal.repairAttempts))
		errors.push("repairAttempts 必须是整数");
	validateCompletionCursor(goal.completionCursor, errors);
	validateSource(goal.source, errors);
	validateErrorsArray(goal.errors, errors);
	validateStringOrNullFields(goal, STRING_OR_NULL_FIELDS, errors);
	validateResultObject(goal.result, ["summary", "outcome"], errors);
	validateChecks(goal.checks, errors);
}

function validateGoalDirName(
	dir: string,
	goal: GoalArtifactState,
	errors: string[],
) {
	const id = String(goal.id ?? "");
	if (GOAL_ID_PATTERN.test(id) && basename(dir) !== id)
		errors.push(`目标目录名必须等于 id：${id}`);
}

export function objectiveFromPlan(markdown: string) {
	return planSection(markdown, "Objective").trim();
}

export function outcomeFromPlan(markdown: string) {
	return outcomeText(markdown).trim();
}

function validatePlanFile(dir: string, errors: string[]) {
	const path = goalPlanPath(dir);
	if (!existsSync(path)) {
		errors.push("缺少 plan.md");
		return;
	}
	let markdown: string;
	try {
		markdown = readFileSync(path, "utf8");
	} catch (error) {
		errors.push(`plan.md 读取失败：${formatError(error)}`);
		return;
	}
	for (const error of validatePlanMarkdown(markdown, STANDALONE_GOAL_SECTIONS))
		errors.push(`plan.md ${error}`);
}
