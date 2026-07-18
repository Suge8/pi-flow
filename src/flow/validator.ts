import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { FLOW_GOAL_SECTIONS, validatePlanMarkdown } from "../plan/validator.js";
import type { Language } from "../shared/config.js";
import { localizeErrors } from "../shared/error-language.js";
import { formatError, isRecord, nonEmpty } from "../shared/guards.js";
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
import { flowJsonPath, readFlow } from "./store.js";
import type {
	FlowGoalRole,
	FlowGoalStatus,
	FlowState,
	FlowStatus,
} from "./types.js";
import { FLOW_SCHEMA_VERSION } from "./types.js";

const FLOW_ID_PATTERN = /^F[1-9]\d*$/u;
const WRITE_SCOPE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;
const FLOW_STATUSES = new Set<FlowStatus>([
	"aligning",
	"generating",
	"draft",
	"paused",
	"running",
	"complete",
]);
const GOAL_STATUSES = new Set<FlowGoalStatus>([
	"pending",
	"running",
	"paused",
	"complete",
]);
const GOAL_ROLES = new Set<FlowGoalRole>(["normal", "final_acceptance"]);
const STRING_OR_NULL_GOAL_FIELDS = [
	"sessionFile",
	"sessionName",
	"snapshot",
	"goalId",
] as const;
const MAX_EXECUTION_GOALS = 10;
const FLOW_FIELDS = new Set([
	"schemaVersion",
	"language",
	"id",
	"title",
	"status",
	"source",
	"createdAt",
	"updatedAt",
	"startedAt",
	"completedAt",
	"currentGoal",
	"meta",
	"attention",
	"parallelRun",
	"repairAttempts",
	"errors",
	"goals",
]);
const META_FIELDS = new Set(["plannedBy", "alignment"]);
const PLANNED_BY_FIELDS = new Set(["model", "thinking"]);
const ALIGNMENT_FIELDS = new Set(["kind", "turns"]);
const ALIGNMENT_TURN_FIELDS = new Set(["question", "answer"]);

export function validateFlowDir(dir: string, language?: Language) {
	const artifact = readRequiredArtifact(
		flowJsonPath(dir),
		"缺少 flow.json",
		() => readFlow(dir),
		"flow.json",
	);
	if (!artifact.ok)
		return {
			ok: false,
			errors: localizeErrors(artifact.errors, language),
		};

	const errors: string[] = [];
	const flow = artifact.artifact;
	const errorLanguage =
		flow.language === "en" || flow.language === "zh" ? flow.language : language;
	validateFlowShape(flow, errors);
	validateFlowDirName(dir, flow, errors);
	if (errors.length === 0) validateGoalFiles(dir, flow, errors);
	return {
		ok: errors.length === 0,
		errors: localizeErrors(errors, errorLanguage ?? "zh"),
		flow,
	};
}

export function validateDraftDir(dir: string, language?: Language) {
	const result = validateFlowDir(dir, language);
	if (!result.ok || !result.flow || result.flow.goals.length > 0) return result;
	return {
		ok: false,
		errors: localizeErrors(["至少需要 1 个执行步骤"], result.flow.language),
		flow: result.flow,
	};
}

export function validateFlowShape(flow: FlowState, errors: string[]) {
	validateFields(flow, FLOW_FIELDS, "", errors);
	if (flow.schemaVersion !== FLOW_SCHEMA_VERSION)
		errors.push(`schemaVersion 必须为 ${FLOW_SCHEMA_VERSION}`);
	validateLanguage(flow.language, errors);
	if (!FLOW_ID_PATTERN.test(String(flow.id ?? "")))
		errors.push("id 必须匹配 F1");
	if (!nonEmpty(flow.title)) errors.push("title 必须是非空字符串");
	if (!FLOW_STATUSES.has(flow.status)) errors.push("Flow 状态不受支持");
	if (!Number.isFinite(flow.createdAt)) errors.push("createdAt 必须是时间戳");
	if (!Number.isFinite(flow.updatedAt)) errors.push("updatedAt 必须是时间戳");
	if (!Number.isInteger(flow.currentGoal))
		errors.push("currentGoal 必须是整数");
	if (!Number.isInteger(flow.repairAttempts))
		errors.push("repairAttempts 必须是整数");
	validateSource(flow.source, errors);
	validateMeta(flow.meta, errors);
	validateErrorsArray(flow.errors, errors);
	validateParallelRun(
		flow.parallelRun,
		Array.isArray(flow.goals) ? flow.goals.length : undefined,
		errors,
	);
	if (!Array.isArray(flow.goals)) {
		errors.push("goals 必须是数组");
		return;
	}
	validateFlowTimes(flow, flow.goals.length, errors);
	if (isPreDraftFlow(flow) || isPreDraftOnlyStatus(flow.status)) {
		validatePreDraftShape(flow, errors);
		return;
	}
	const executionGoals = executionGoalCount(flow.goals);
	if (executionGoals < 1) errors.push("至少需要 1 个执行步骤");
	if (executionGoals > MAX_EXECUTION_GOALS)
		errors.push(
			"执行步骤数量超过 10；final acceptance 不占执行步骤名额，必须拆成多个 flow",
		);
	validateFinalAcceptancePlacement(flow.goals, errors);
	if (flow.currentGoal < 0 || flow.currentGoal >= flow.goals.length)
		errors.push("currentGoal 必须指向 goals 下标");
	for (const [offset, goal] of flow.goals.entries())
		validateGoalShape(goal, offset, errors);
}

function validateMeta(value: unknown, errors: string[]) {
	if (value === null) return;
	if (!isRecord(value)) {
		errors.push("meta 必须是对象或 null");
		return;
	}
	validateFields(value, META_FIELDS, "meta", errors);
	validatePlannedBy(value.plannedBy, errors);
	validateAlignment(value.alignment, errors);
}

function validatePlannedBy(value: unknown, errors: string[]) {
	if (value === null) return;
	if (!isRecord(value)) {
		errors.push("meta.plannedBy 必须是对象或 null");
		return;
	}
	validateFields(value, PLANNED_BY_FIELDS, "meta.plannedBy", errors);
	if (!nonEmpty(value.model))
		errors.push("meta.plannedBy.model 必须是非空字符串");
	if (!nonEmpty(value.thinking))
		errors.push("meta.plannedBy.thinking 必须是非空字符串");
}

function validateAlignment(value: unknown, errors: string[]) {
	if (value === null) return;
	if (!isRecord(value)) {
		errors.push("meta.alignment 必须是对象或 null");
		return;
	}
	validateFields(value, ALIGNMENT_FIELDS, "meta.alignment", errors);
	if (value.kind !== "recorded") {
		errors.push("meta.alignment.kind 必须是 recorded");
		return;
	}
	validateAlignmentTurns(value.turns, errors);
}

function validateAlignmentTurns(value: unknown, errors: string[]) {
	if (!Array.isArray(value) || value.length === 0) {
		errors.push("meta.alignment.turns 必须是非空数组");
		return;
	}
	for (const [index, turn] of value.entries()) {
		if (!isRecord(turn)) {
			errors.push(`meta.alignment.turns[${index}] 必须是对象`);
			continue;
		}
		validateFields(
			turn,
			ALIGNMENT_TURN_FIELDS,
			`meta.alignment.turns[${index}]`,
			errors,
		);
		if (!nonEmpty(turn.question))
			errors.push(`meta.alignment.turns[${index}].question 必须是非空字符串`);
		if (!nonEmpty(turn.answer))
			errors.push(`meta.alignment.turns[${index}].answer 必须是非空字符串`);
	}
}

function validateFlowDirName(dir: string, flow: FlowState, errors: string[]) {
	const id = String(flow.id ?? "");
	if (FLOW_ID_PATTERN.test(id) && basename(dir) !== id)
		errors.push(`flow 目录名必须等于 id：${id}`);
}

function validateFields(
	value: object,
	allowed: ReadonlySet<string>,
	path: string,
	errors: string[],
) {
	for (const field of Object.keys(value)) {
		if (allowed.has(field)) continue;
		errors.push(`${path ? `${path}.` : ""}${field} 不是合法 Flow 字段`);
	}
}

export function isFinalAcceptance(goal: unknown) {
	return isRecord(goal) && goal.role === "final_acceptance";
}

function executionGoalCount(goals: unknown[]) {
	return goals.filter(isNormalGoal).length;
}

function isNormalGoal(goal: unknown) {
	return isRecord(goal) && goal.role === "normal";
}

function validateFinalAcceptancePlacement(goals: unknown[], errors: string[]) {
	const finalIndexes = goals.flatMap((goal, index) =>
		isFinalAcceptance(goal) ? [index] : [],
	);
	if (finalIndexes.length > 1)
		errors.push("最终验收步骤最多 1 个（role: final_acceptance）");
	for (const index of finalIndexes) {
		if (index !== goals.length - 1)
			errors.push(`goals[${index}] 非最终步骤必须是 normal`);
	}
}

function isPreDraftFlow(flow: FlowState) {
	return (
		flow.goals.length === 0 &&
		(isPreDraftOnlyStatus(flow.status) || flow.status === "paused")
	);
}

function isPreDraftOnlyStatus(status: FlowStatus) {
	return status === "aligning" || status === "generating";
}

function validatePreDraftShape(flow: FlowState, errors: string[]) {
	if (flow.goals.length !== 0) errors.push("pre-draft Flow goals 必须为 []");
	if (flow.currentGoal !== 0)
		errors.push("pre-draft Flow currentGoal 必须为 0");
	if (flow.parallelRun !== null)
		errors.push("pre-draft Flow parallelRun 必须为 null");
}

function validateFlowTimes(
	flow: FlowState,
	goalCount: number,
	errors: string[],
) {
	if (
		flow.status === "aligning" ||
		flow.status === "generating" ||
		flow.status === "draft" ||
		(flow.status === "paused" && goalCount === 0)
	) {
		if (flow.startedAt !== null) errors.push("startedAt 计划必须为 null");
	} else if (flow.status === "paused") {
		if (flow.startedAt !== null && !Number.isFinite(flow.startedAt))
			errors.push("startedAt 已暂停必须为 null 或时间戳");
	} else if (!Number.isFinite(flow.startedAt)) {
		errors.push("startedAt 运行态必须是时间戳");
	}
	if (flow.completedAt !== null && !Number.isFinite(flow.completedAt))
		errors.push("completedAt 必须是 null 或时间戳");
}

function validateGoalShape(
	goalValue: unknown,
	offset: number,
	errors: string[],
) {
	const expectedIndex = offset;
	if (!isRecord(goalValue)) {
		errors.push(`goals[${expectedIndex}] 必须是对象`);
		return;
	}
	const goal = goalValue as Record<string, unknown>;
	if (goal.index !== expectedIndex)
		errors.push(
			`goals 顺序不连续：第 ${offset + 1} 项 index 应为 ${expectedIndex}`,
		);
	if (!nonEmpty(goal.title)) errors.push(`goals[${expectedIndex}] 缺少 title`);
	if (
		typeof goal.role !== "string" ||
		!GOAL_ROLES.has(goal.role as FlowGoalRole)
	)
		errors.push(`goals[${expectedIndex}] role 非法：${String(goal.role)}`);
	if (!nonEmpty(goal.file)) errors.push(`goals[${expectedIndex}] 缺少 file`);
	validateDependsOn(goal.dependsOn, expectedIndex, errors);
	validateWriteScope(
		goal.writeScope,
		`goals[${expectedIndex}].writeScope`,
		errors,
	);
	if (
		typeof goal.status !== "string" ||
		!GOAL_STATUSES.has(goal.status as FlowGoalStatus)
	)
		errors.push(`goals[${expectedIndex}] status 非法：${String(goal.status)}`);
	else validateGoalTimes(goal, expectedIndex, errors);
	validateCompletionCursor(
		goal.completionCursor,
		errors,
		`goals[${expectedIndex}].completionCursor`,
	);
	validateStringOrNullFields(
		goal,
		STRING_OR_NULL_GOAL_FIELDS,
		errors,
		`goals[${expectedIndex}].`,
	);
	validateResultObject(
		goal.result,
		["summary", "handoff"],
		errors,
		`goals[${expectedIndex}].result`,
	);
	if (isRecord(goal.result)) {
		if (typeof goal.result.handoffGenerated !== "boolean")
			errors.push(
				`goals[${expectedIndex}].result.handoffGenerated 必须是布尔值`,
			);
		if (typeof goal.result.criteriaChanged !== "boolean")
			errors.push(
				`goals[${expectedIndex}].result.criteriaChanged 必须是布尔值`,
			);
	}
	validateChecks(goal.checks, errors, `goals[${expectedIndex}].checks`);
	validatePendingAdvisor(
		goal.pendingAdvisor,
		goal.checks,
		`goals[${expectedIndex}].pendingAdvisor`,
		errors,
	);
}

function validateGoalTimes(
	goal: Record<string, unknown>,
	index: number,
	errors: string[],
) {
	for (const field of ["startedAt", "completedAt"] as const) {
		const value = goal[field];
		if (value !== null && !Number.isFinite(value))
			errors.push(`goals[${index}].${field} 必须是 null 或时间戳`);
	}
}

function validatePendingAdvisor(
	value: unknown,
	checks: unknown,
	path: string,
	errors: string[],
) {
	if (value === null) return;
	if (!isRecord(value)) {
		errors.push(`${path} 必须是对象或 null`);
		return;
	}
	if (value.phase !== "acceptance" && value.phase !== "quality")
		errors.push(`${path}.phase 必须是 acceptance 或 quality`);
	if (!Number.isInteger(value.round)) errors.push(`${path}.round 必须是整数`);
	if (
		(value.phase !== "acceptance" && value.phase !== "quality") ||
		!Number.isInteger(value.round) ||
		!isRecord(checks)
	)
		return;
	const phase = checks[value.phase];
	const rounds =
		isRecord(phase) && Array.isArray(phase.rounds) ? phase.rounds : [];
	const round = rounds.find(
		(item) => isRecord(item) && item.round === value.round,
	);
	if (!isRecord(round) || round.result !== "failed" || !isRecord(round.advisor))
		errors.push(`${path} 必须指向含顾问建议的未通过检查轮`);
}

function validateParallelRun(
	value: unknown,
	goalCount: number | undefined,
	errors: string[],
) {
	if (value === null) return;
	if (!isRecord(value)) {
		errors.push("parallelRun 必须是对象或 null");
		return;
	}
	if (!nonEmpty(value.id)) errors.push("parallelRun.id 必须是非空字符串");
	if (!Array.isArray(value.goalIndexes) || value.goalIndexes.length === 0) {
		errors.push("parallelRun.goalIndexes 必须是非空数组");
	} else {
		validateGoalIndexArray(
			value.goalIndexes,
			"parallelRun.goalIndexes",
			goalCount,
			errors,
		);
	}
	if (!Number.isFinite(value.startedAt))
		errors.push("parallelRun.startedAt 必须是时间戳");
	if (!nonEmpty(value.consoleSessionFile))
		errors.push("parallelRun.consoleSessionFile 必须是非空字符串");
	if (!nonEmpty(value.consoleSessionName))
		errors.push("parallelRun.consoleSessionName 必须是非空字符串");
}

function validateDependsOn(
	value: unknown,
	goalIndex: number,
	errors: string[],
) {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		errors.push(`goals[${goalIndex}].dependsOn 必须是数组`);
		return;
	}
	validateGoalIndexArray(
		value,
		`goals[${goalIndex}].dependsOn`,
		goalIndex,
		errors,
		"必须指向先序 goals 下标",
	);
}

function validateGoalIndexArray(
	values: unknown[],
	path: string,
	maxExclusive: number | undefined,
	errors: string[],
	outOfRangeMessage = "必须指向 goals 下标",
) {
	for (const [index, value] of values.entries()) {
		const itemPath = `${path}[${index}]`;
		if (typeof value !== "number" || !Number.isInteger(value)) {
			errors.push(`${itemPath} 必须是整数`);
			continue;
		}
		if (value < 0 || (maxExclusive !== undefined && value >= maxExclusive))
			errors.push(`${itemPath} ${outOfRangeMessage}`);
	}
}

function validateWriteScope(value: unknown, path: string, errors: string[]) {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		errors.push(`${path} 必须是数组`);
		return;
	}
	for (const [index, scope] of value.entries()) {
		const itemPath = `${path}[${index}]`;
		if (typeof scope !== "string") {
			errors.push(`${itemPath} 必须是字符串`);
			continue;
		}
		if (!isCanonicalWriteScope(scope))
			errors.push(`${itemPath} 必须是 ** 或以 /** 结尾的相对目录 glob`);
	}
}

function isCanonicalWriteScope(scope: string) {
	if (scope === "**") return true;
	if (!scope.endsWith("/**")) return false;
	return scope
		.slice(0, -3)
		.split("/")
		.every(
			(segment) =>
				segment !== "." &&
				segment !== ".." &&
				WRITE_SCOPE_SEGMENT_PATTERN.test(segment),
		);
}

function validateGoalFiles(dir: string, flow: FlowState, errors: string[]) {
	for (const goal of flow.goals) {
		const safePath = safeGoalPath(dir, goal.file);
		if (!safePath) {
			errors.push(
				`goals[${goal.index}] 文件路径不能逃出 flow 目录：${goal.file}`,
			);
			continue;
		}
		const fileError = validateGoalFilePath(dir, safePath, goal.file);
		if (fileError) {
			errors.push(fileError);
			continue;
		}
		let markdown: string;
		try {
			markdown = readFileSync(safePath, "utf8");
		} catch (error) {
			errors.push(`步骤文件读取失败：${goal.file}: ${formatError(error)}`);
			continue;
		}
		for (const error of validatePlanMarkdown(markdown, FLOW_GOAL_SECTIONS))
			errors.push(`goals[${goal.index}] ${error}`);
	}
}

function safeGoalPath(dir: string, file: string) {
	if (isAbsolute(file)) return undefined;
	const root = resolve(dir);
	const target = resolve(root, file);
	return isInside(root, target) ? target : undefined;
}

function validateGoalFilePath(dir: string, path: string, file: string) {
	if (!existsSync(path)) return `步骤文件不存在：${file}`;
	try {
		if (!lstatSync(path).isFile()) return `步骤文件必须是普通文件：${file}`;
	} catch (error) {
		return `步骤文件检查失败：${file}: ${formatError(error)}`;
	}
	try {
		if (!isInside(realpathSync(dir), realpathSync(path))) {
			return `步骤文件路径不能逃出 flow 目录：${file}`;
		}
	} catch (error) {
		return `步骤文件检查失败：${file}: ${formatError(error)}`;
	}
	return undefined;
}

function isInside(root: string, target: string) {
	const pathFromRoot = relative(root, target);
	return !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot);
}
