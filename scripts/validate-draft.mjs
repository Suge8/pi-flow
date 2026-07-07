#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { localizeErrors } from "../src/shared/error-language.ts";
import {
	escapeRegExp,
	formatError,
	isRecord,
	nonEmpty,
} from "../src/shared/guards.ts";

const FLOW_ID_PATTERN = /^F[1-9]\d*$/u;
const MODEL_STATUSES = new Set(["running", "passed", "failed", "error"]);
const CHECK_RESULTS = new Set(["passed", "failed", "error"]);
const COMPLETION_CURSORS = new Set([
	"acceptance_retry",
	"acceptance_repair",
	"quality_retry",
	"quality_repair",
	"finalize_retry",
]);
const LANGUAGES = new Set(["zh", "en"]);
const CONTRACT_SECTIONS = ["Objective", "Scope", "Success Criteria"];
const TASK_LIST_ITEM = /^\s*[-*+]\s*\[[ xX~!]\]/mu;
const MAX_EXECUTION_GOALS = 10;

const dir = process.argv[2];
if (!dir) fail(["用法：node scripts/validate-draft.mjs <.flow/F1>"]);

const root = resolve(dir);
const errors = existsSync(join(root, "flow.json"))
	? validateFlow(root)
	: ["缺少 flow.json"];

if (errors.length) fail(errors, draftLanguage(root));
console.log(`OK ${root}`);

function validateFlow(root) {
	const errors = [];
	const flow = readArtifact(join(root, "flow.json"), "flow.json", errors);
	if (!flow) return errors;
	if (flow.schemaVersion !== 8) errors.push("schemaVersion 必须为 8");
	validateLanguage(flow.language, errors);
	if (!FLOW_ID_PATTERN.test(String(flow.id ?? "")))
		errors.push("id 必须匹配 F1");
	validateArtifactDirName(
		root,
		flow.id,
		FLOW_ID_PATTERN,
		"flow 目录名必须等于 id",
		errors,
	);
	if (!nonEmpty(flow.title)) errors.push("title 必须是非空字符串");
	if (!["draft", "running", "complete", "cancelled"].includes(flow.status))
		errors.push(`status 非法：${flow.status}`);
	for (const key of ["createdAt", "updatedAt"])
		if (!Number.isFinite(flow[key])) errors.push(`${key} 必须是时间戳`);
	validateFlowStartedAt(flow, errors);
	if (!Number.isInteger(flow.currentGoal))
		errors.push("currentGoal 必须是整数");
	if (!Number.isInteger(flow.repairAttempts))
		errors.push("repairAttempts 必须是整数");
	validateSource(flow.source, errors);
	validateStringArray(flow.errors, "errors", errors);
	validateParallelRun(
		flow.parallelRun,
		Array.isArray(flow.goals) ? flow.goals.length : undefined,
		errors,
	);
	if (!Array.isArray(flow.goals)) return [...errors, "goals 必须是数组"];
	const executionGoals = executionGoalCount(flow.goals);
	if (executionGoals < 1) errors.push("至少需要 1 个执行步骤");
	if (executionGoals > MAX_EXECUTION_GOALS)
		errors.push(
			"执行步骤数量超过 10；final acceptance 不占执行步骤名额，必须拆成多个 flow",
		);
	validateFinalAcceptancePlacement(flow.goals, executionGoals, errors);
	if (flow.currentGoal < 0 || flow.currentGoal >= flow.goals.length)
		errors.push("currentGoal 必须指向 goals 下标");
	for (const [index, goal] of flow.goals.entries())
		validateFlowGoalShape(goal, index, errors);
	if (errors.length === 0)
		for (const goal of flow.goals) validateFlowGoalFile(root, goal, errors);
	return errors;
}

function executionGoalCount(goals) {
	return goals.filter((goal) => flowGoalRole(goal) === "normal").length;
}

function validateFinalAcceptancePlacement(goals, executionGoals, errors) {
	const finalIndexes = goals.flatMap((goal, index) =>
		flowGoalRole(goal) === "final_acceptance" ? [index] : [],
	);
	if (executionGoals === 1) {
		if (finalIndexes.length > 0) errors.push("单步 Flow 不使用最终验收步骤");
		return;
	}
	if (finalIndexes.length !== 1)
		errors.push("多步 Flow 必须有 1 个最终验收步骤（role: final_acceptance）");
	if (flowGoalRole(goals.at(-1)) !== "final_acceptance")
		errors.push("最后一个步骤必须是最终验收（role: final_acceptance）");
	for (const index of finalIndexes) {
		if (index !== goals.length - 1)
			errors.push(`goals[${index}] 非最终步骤必须是 normal`);
	}
}

function flowGoalRole(goal) {
	return isRecord(goal) ? goal.role : undefined;
}

function validateFlowStartedAt(flow, errors) {
	if (flow.status === "draft") {
		if (flow.startedAt !== null) errors.push("startedAt 草稿必须为 null");
		return;
	}
	if (!Number.isFinite(flow.startedAt))
		errors.push("startedAt 运行态必须是时间戳");
}

function validateFlowGoalShape(goal, index, errors) {
	if (!isRecord(goal)) return errors.push(`goals[${index}] 必须是对象`);
	if (goal.index !== index)
		errors.push(`goals 顺序不连续：第 ${index + 1} 项 index 应为 ${index}`);
	if (!nonEmpty(goal.title)) errors.push(`goals[${index}] 缺少 title`);
	if (!["normal", "final_acceptance"].includes(goal.role))
		errors.push(`goals[${index}] role 非法：${goal.role}`);
	if (!nonEmpty(goal.file)) errors.push(`goals[${index}] 缺少 file`);
	validateDependsOn(goal.dependsOn, index, errors);
	validateWriteScope(goal.writeScope, `goals[${index}].writeScope`, errors);
	if (!["pending", "running", "complete"].includes(goal.status))
		errors.push(`goals[${index}] status 非法：${goal.status}`);
	validateCompletionCursor(
		goal.completionCursor,
		`goals[${index}].completionCursor`,
		errors,
	);
	for (const key of [
		"sessionFile",
		"sessionName",
		"snapshot",
		"snapshotHash",
		"goalId",
	])
		validateStringOrNull(goal[key], `goals[${index}].${key}`, errors);
	validateResult(
		goal.result,
		["summary", "handoff"],
		`goals[${index}].result`,
		errors,
	);
	if (isRecord(goal.result)) {
		if (typeof goal.result.handoffGenerated !== "boolean")
			errors.push(`goals[${index}].result.handoffGenerated 必须是布尔值`);
		if (typeof goal.result.criteriaChanged !== "boolean")
			errors.push(`goals[${index}].result.criteriaChanged 必须是布尔值`);
	}
	validateChecks(goal.checks, errors, `goals[${index}].checks`);
}

function validateParallelRun(value, goalCount, errors) {
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
}

function validateDependsOn(value, goalIndex, errors) {
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
	values,
	path,
	maxExclusive,
	errors,
	outOfRangeMessage = "必须指向 goals 下标",
) {
	for (const [index, value] of values.entries()) {
		const itemPath = `${path}[${index}]`;
		if (!Number.isInteger(value)) {
			errors.push(`${itemPath} 必须是整数`);
			continue;
		}
		if (value < 0 || (maxExclusive !== undefined && value >= maxExclusive))
			errors.push(`${itemPath} ${outOfRangeMessage}`);
	}
}

function validateWriteScope(value, path, errors) {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		errors.push(`${path} 必须是数组`);
		return;
	}
	if (!value.every((item) => typeof item === "string"))
		errors.push(`${path} 必须是字符串数组`);
}

function validateFlowGoalFile(root, goal, errors) {
	const file = safePath(root, goal.file);
	if (!file) {
		errors.push(
			`goals[${goal.index}] 文件路径不能逃出 flow 目录：${goal.file}`,
		);
		return;
	}
	const fileError = validateFlowGoalFilePath(root, file, goal.file);
	if (fileError) {
		errors.push(fileError);
		return;
	}
	let markdown = "";
	try {
		markdown = readFileSync(file, "utf8");
	} catch (error) {
		errors.push(`步骤文件读取失败：${goal.file}: ${formatError(error)}`);
		return;
	}
	for (const error of validateMarkdown(markdown, [
		"Objective",
		"Scope",
		"Steps",
		"Success Criteria",
		"Verification",
		"Notes",
		"Handoff",
	]))
		errors.push(`goals[${goal.index}] ${error}`);
}

function validateFlowGoalFilePath(root, path, file) {
	if (!existsSync(path)) return `步骤文件不存在：${file}`;
	try {
		if (!lstatSync(path).isFile()) return `步骤文件必须是普通文件：${file}`;
	} catch (error) {
		return `步骤文件检查失败：${file}: ${formatError(error)}`;
	}
	try {
		if (!isInside(realpathSync(root), realpathSync(path)))
			return `步骤文件路径不能逃出 flow 目录：${file}`;
	} catch (error) {
		return `步骤文件检查失败：${file}: ${formatError(error)}`;
	}
	return undefined;
}

function validateArtifactDirName(root, idValue, pattern, message, errors) {
	const id = String(idValue ?? "");
	if (pattern.test(id) && basename(root) !== id)
		errors.push(`${message}：${id}`);
}

function validateMarkdown(markdown, sections) {
	const errors = [];
	for (const section of sections)
		if (!hasSection(markdown, section)) errors.push(`缺少章节：${section}`);
	if (!sectionBody(markdown, "Objective").trim())
		errors.push("Objective 不能为空");
	for (const section of CONTRACT_SECTIONS) {
		if (TASK_LIST_ITEM.test(sectionBody(markdown, section)))
			errors.push(
				`${section} 禁止使用 checkbox；该区是验收合同，完成证据请写入 Verification/Outcome/Handoff`,
			);
	}
	if (!/^\s*-\s*\[[ xX~!]\]/mu.test(sectionBody(markdown, "Steps")))
		errors.push("Steps 至少需要 1 项 checkbox");
	if (!/^\s*-\s*\[[ xX~!]\]/mu.test(sectionBody(markdown, "Verification")))
		errors.push("Verification 至少需要 1 项 checkbox");
	return errors;
}

function hasSection(markdown, title) {
	const pattern = new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`, "iu");
	return markdown.split(/\r?\n/).some((line) => pattern.test(line.trim()));
}
function sectionBody(markdown, title) {
	const lines = markdown.split(/\r?\n/);
	const start = lines.findIndex((line) =>
		new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`, "iu").test(line.trim()),
	);
	if (start === -1) return "";
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i += 1)
		if (/^##\s+\S/.test(lines[i])) {
			end = i;
			break;
		}
	return lines.slice(start + 1, end).join("\n");
}

function validateChecks(checks, errors, path = "checks") {
	if (!isRecord(checks)) {
		errors.push(`${path} 必须是对象`);
		return;
	}
	validateCheckPhase(checks.acceptance, `${path}.acceptance`, errors);
	validateCheckPhase(checks.quality, `${path}.quality`, errors);
}

function validateCheckPhase(phase, path, errors) {
	if (!isRecord(phase)) {
		errors.push(`${path} 必须是对象`);
		return;
	}
	if (typeof phase.enabled !== "boolean")
		errors.push(`${path}.enabled 必须是布尔值`);
	if (!Array.isArray(phase.rounds)) errors.push(`${path}.rounds 必须是数组`);
	else
		for (const [index, round] of phase.rounds.entries()) {
			if (!isRecord(round)) {
				errors.push(`${path}.rounds[${index}] 必须是对象`);
				continue;
			}
			if (!Number.isInteger(round.round))
				errors.push(`${path}.rounds[${index}].round 必须是整数`);
			if (!CHECK_RESULTS.has(String(round.result)))
				errors.push(
					`${path}.rounds[${index}].result 必须是 passed、failed 或 error`,
				);
			if (typeof round.summary !== "string")
				errors.push(`${path}.rounds[${index}].summary 必须是字符串`);
			if (round.details !== undefined && typeof round.details !== "string")
				errors.push(`${path}.rounds[${index}].details 必须是字符串`);
		}
	if (phase.active === null) return;
	if (!Array.isArray(phase.active)) {
		errors.push(`${path}.active 必须是数组或 null`);
		return;
	}
	for (const [index, model] of phase.active.entries()) {
		if (!isRecord(model)) {
			errors.push(`${path}.active[${index}] 必须是对象`);
			continue;
		}
		if (!nonEmpty(model.label))
			errors.push(`${path}.active[${index}].label 必须是非空字符串`);
		if (!MODEL_STATUSES.has(String(model.status)))
			errors.push(`${path}.active[${index}].status 非法`);
		if (model.summary !== undefined && typeof model.summary !== "string")
			errors.push(`${path}.active[${index}].summary 必须是字符串`);
	}
}

function validateResult(result, fields, path, errors) {
	if (!isRecord(result)) {
		errors.push(`${path} 必须是对象`);
		return;
	}
	for (const field of fields)
		validateStringOrNull(result[field], `${path}.${field}`, errors);
}

function validateCompletionCursor(value, path, errors) {
	if (value === null) return;
	if (!COMPLETION_CURSORS.has(String(value)))
		errors.push(`${path} 必须是 null 或合法恢复位置`);
}

function validateSource(source, errors) {
	if (!isRecord(source)) return errors.push("source 必须是对象");
	if (!["conversation", "prompt", "file"].includes(String(source.type)))
		errors.push("source.type 必须是 conversation、prompt 或 file");
	if (typeof source.originalRequest !== "string")
		errors.push("source.originalRequest 必须是字符串");
	if (source.path !== null && typeof source.path !== "string")
		errors.push("source.path 必须是字符串或 null");
}
function validateStringArray(value, key, errors) {
	if (!Array.isArray(value)) errors.push(`${key} 必须是数组`);
	else if (!value.every((item) => typeof item === "string"))
		errors.push(`${key} 必须是字符串数组`);
}
function validateLanguage(value, errors) {
	if (!LANGUAGES.has(value)) errors.push("language 必须是 zh 或 en");
}
function validateStringOrNull(value, key, errors) {
	if (value !== null && typeof value !== "string")
		errors.push(`${key} 必须是字符串或 null`);
}
function readArtifact(path, name, errors) {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed)) throw new Error(`${name} 必须是对象`);
		return parsed;
	} catch (error) {
		errors.push(`${name} 读取失败：${formatError(error)}`);
		return undefined;
	}
}
function safePath(root, file) {
	if (!nonEmpty(file) || isAbsolute(file)) return undefined;
	const target = resolve(root, file);
	return isInside(resolve(root), target) ? target : undefined;
}
function isInside(root, target) {
	const pathFromRoot = relative(root, target);
	return !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot);
}
function draftLanguage(root) {
	try {
		const language = JSON.parse(
			readFileSync(join(root, "flow.json"), "utf8"),
		).language;
		if (language === "zh" || language === "en") return language;
	} catch {}
	return undefined;
}

function fail(errors, language) {
	console.error(localizeErrors(errors, language).join("\n"));
	process.exit(1);
}
