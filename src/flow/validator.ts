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

const FLOW_ID_PATTERN = /^F[1-9]\d*-[a-z0-9-]+$/u;
const FLOW_STATUSES = new Set<FlowStatus>([
	"draft",
	"running",
	"complete",
	"cancelled",
]);
const GOAL_STATUSES = new Set<FlowGoalStatus>([
	"pending",
	"running",
	"complete",
]);
const GOAL_ROLES = new Set<FlowGoalRole>(["normal", "final_acceptance"]);
const STRING_OR_NULL_GOAL_FIELDS = [
	"sessionFile",
	"sessionName",
	"snapshot",
	"snapshotHash",
	"goalId",
] as const;
const MAX_EXECUTION_GOALS = 10;

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
			errors: localizeErrors(artifact.errors, language ?? "zh"),
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

export function validateFlowShape(flow: FlowState, errors: string[]) {
	if (flow.schemaVersion !== 6) errors.push("schemaVersion 必须为 6");
	validateLanguage(flow.language, errors);
	if (!FLOW_ID_PATTERN.test(String(flow.id ?? "")))
		errors.push("id 必须匹配 F1-xxx");
	if (!nonEmpty(flow.title)) errors.push("title 必须是非空字符串");
	if (!FLOW_STATUSES.has(flow.status))
		errors.push(`status 非法：${flow.status}`);
	if (!Number.isFinite(flow.createdAt)) errors.push("createdAt 必须是时间戳");
	if (!Number.isFinite(flow.updatedAt)) errors.push("updatedAt 必须是时间戳");
	validateStartedAt(flow, errors);
	if (!Number.isInteger(flow.currentGoal))
		errors.push("currentGoal 必须是整数");
	if (!Number.isInteger(flow.repairAttempts))
		errors.push("repairAttempts 必须是整数");
	validateSource(flow.source, errors);
	validateErrorsArray(flow.errors, errors);
	validateParallelBatch(
		flow.parallelBatch,
		Array.isArray(flow.goals) ? flow.goals.length : undefined,
		errors,
	);
	if (!Array.isArray(flow.goals)) {
		errors.push("goals 必须是数组");
		return;
	}
	const executionGoals = executionGoalCount(flow.goals);
	if (executionGoals < 1) errors.push("至少需要 1 个执行步骤");
	if (executionGoals > MAX_EXECUTION_GOALS)
		errors.push(
			"执行步骤数量超过 10；final acceptance 不占执行步骤名额，必须拆成多个 flow",
		);
	validateFinalAcceptancePlacement(flow.goals, executionGoals, errors);
	if (flow.currentGoal < 0 || flow.currentGoal >= flow.goals.length)
		errors.push("currentGoal 必须指向 goals 下标");
	for (const [offset, goal] of flow.goals.entries())
		validateGoalShape(goal, offset, errors);
}

function validateFlowDirName(dir: string, flow: FlowState, errors: string[]) {
	const id = String(flow.id ?? "");
	if (FLOW_ID_PATTERN.test(id) && basename(dir) !== id)
		errors.push(`flow 目录名必须等于 id：${id}`);
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

function validateFinalAcceptancePlacement(
	goals: unknown[],
	executionGoals: number,
	errors: string[],
) {
	const finalIndexes = goals.flatMap((goal, index) =>
		isFinalAcceptance(goal) ? [index] : [],
	);
	if (executionGoals === 1) {
		if (finalIndexes.length > 0) errors.push("单步 Flow 不使用最终验收步骤");
		return;
	}
	if (finalIndexes.length !== 1)
		errors.push("多步 Flow 必须有 1 个最终验收步骤（role: final_acceptance）");
	if (!isFinalAcceptance(goals.at(-1)))
		errors.push("最后一个步骤必须是最终验收（role: final_acceptance）");
	for (const index of finalIndexes) {
		if (index !== goals.length - 1)
			errors.push(`goals[${index}] 非最终步骤必须是 normal`);
	}
}

function validateStartedAt(flow: FlowState, errors: string[]) {
	if (flow.status === "draft") {
		if (flow.startedAt !== null) errors.push("startedAt 计划必须为 null");
		return;
	}
	if (!Number.isFinite(flow.startedAt))
		errors.push("startedAt 运行态必须是时间戳");
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
}

function validateParallelBatch(
	value: unknown,
	goalCount: number | undefined,
	errors: string[],
) {
	if (value === undefined || value === null) return;
	if (!Array.isArray(value)) {
		errors.push("parallelBatch 必须是数组或 null");
		return;
	}
	validateGoalIndexArray(value, "parallelBatch", goalCount, errors);
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
	if (!value.every((item) => typeof item === "string"))
		errors.push(`${path} 必须是字符串数组`);
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
