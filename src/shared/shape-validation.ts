import { existsSync } from "node:fs";
import { isLanguage } from "./config.js";
import { formatError, isRecord, nonEmpty } from "./guards.js";

const SOURCE_TYPES = new Set(["conversation", "prompt", "file"]);
const MODEL_STATUSES = new Set(["running", "passed", "failed", "error"]);
const CHECK_RESULTS = new Set(["passed", "failed", "error"]);
const COMPLETION_CURSORS = new Set([
	"acceptance_retry",
	"acceptance_repair",
	"quality_retry",
	"quality_repair",
	"finalize_retry",
]);

type RequiredArtifactResult<Artifact> =
	| { ok: true; artifact: Artifact }
	| { ok: false; errors: string[] };

export function readRequiredArtifact<Artifact>(
	path: string,
	missingMessage: string,
	read: () => Artifact,
	readFailurePrefix: string,
): RequiredArtifactResult<Artifact> {
	if (!existsSync(path)) return { ok: false, errors: [missingMessage] };
	try {
		return { ok: true, artifact: read() };
	} catch (error) {
		return {
			ok: false,
			errors: [`${readFailurePrefix} 读取失败：${formatError(error)}`],
		};
	}
}

export function validateSource(source: unknown, errors: string[]) {
	if (!source || typeof source !== "object" || Array.isArray(source)) {
		errors.push("source 必须是对象");
		return;
	}
	const value = source as Record<string, unknown>;
	if (!SOURCE_TYPES.has(String(value.type)))
		errors.push("source.type 必须是 conversation、prompt 或 file");
	if (typeof value.originalRequest !== "string")
		errors.push("source.originalRequest 必须是字符串");
	if (value.path !== null && typeof value.path !== "string")
		errors.push("source.path 必须是字符串或 null");
}

export function validateErrorsArray(value: unknown, errors: string[]) {
	if (!Array.isArray(value)) errors.push("errors 必须是数组");
	else if (!value.every((error) => typeof error === "string"))
		errors.push("errors 必须是字符串数组");
}

export function validateLanguage(value: unknown, errors: string[]) {
	if (!isLanguage(value)) errors.push("language 必须是 zh 或 en");
}

export function validateStringOrNullFields<RecordValue extends object>(
	record: RecordValue,
	fields: readonly (keyof RecordValue & string)[],
	errors: string[],
	prefix = "",
) {
	for (const key of fields) {
		const value = record[key];
		if (value !== null && typeof value !== "string")
			errors.push(`${prefix}${key} 必须是字符串或 null`);
	}
}

export function validateChecks(
	checks: unknown,
	errors: string[],
	path = "checks",
) {
	if (!isRecord(checks)) {
		errors.push(`${path} 必须是对象`);
		return;
	}
	validateCheckPhase(checks.acceptance, `${path}.acceptance`, errors);
	validateCheckPhase(checks.quality, `${path}.quality`, errors);
}

export function validateResultObject(
	result: unknown,
	fields: readonly string[],
	errors: string[],
	path = "result",
) {
	if (!isRecord(result)) {
		errors.push(`${path} 必须是对象`);
		return;
	}
	for (const field of fields) {
		const value = result[field];
		if (value !== null && typeof value !== "string")
			errors.push(`${path}.${field} 必须是字符串或 null`);
	}
}

export function validateCompletionCursor(
	value: unknown,
	errors: string[],
	path = "completionCursor",
) {
	if (value === null) return;
	if (!COMPLETION_CURSORS.has(String(value)))
		errors.push(`${path} 必须是 null 或合法恢复位置`);
}

function validateCheckPhase(phase: unknown, path: string, errors: string[]) {
	if (!isRecord(phase)) {
		errors.push(`${path} 必须是对象`);
		return;
	}
	if (typeof phase.enabled !== "boolean")
		errors.push(`${path}.enabled 必须是布尔值`);
	if (!Array.isArray(phase.rounds)) errors.push(`${path}.rounds 必须是数组`);
	else
		for (const [index, round] of phase.rounds.entries())
			validateCheckRound(round, `${path}.rounds[${index}]`, errors);
	if (phase.active === null) return;
	if (!Array.isArray(phase.active)) {
		errors.push(`${path}.active 必须是数组或 null`);
		return;
	}
	for (const [index, model] of phase.active.entries())
		validateModel(model, `${path}.active[${index}]`, errors);
}

function validateCheckRound(round: unknown, path: string, errors: string[]) {
	if (!isRecord(round)) {
		errors.push(`${path} 必须是对象`);
		return;
	}
	if (!Number.isInteger(round.round)) errors.push(`${path}.round 必须是整数`);
	if (!CHECK_RESULTS.has(String(round.result)))
		errors.push(`${path}.result 必须是 passed、failed 或 error`);
	if (typeof round.summary !== "string")
		errors.push(`${path}.summary 必须是字符串`);
	if (round.details !== undefined && typeof round.details !== "string")
		errors.push(`${path}.details 必须是字符串`);
	if (round.models !== undefined) {
		if (!Array.isArray(round.models)) errors.push(`${path}.models 必须是数组`);
		else
			for (const [index, model] of round.models.entries())
				validateModel(model, `${path}.models[${index}]`, errors);
	}
}

function validateModel(model: unknown, path: string, errors: string[]) {
	if (!isRecord(model)) {
		errors.push(`${path} 必须是对象`);
		return;
	}
	if (!nonEmpty(model.label)) errors.push(`${path}.label 必须是非空字符串`);
	if (!MODEL_STATUSES.has(String(model.status)))
		errors.push(`${path}.status 非法`);
	if (model.summary !== undefined && typeof model.summary !== "string")
		errors.push(`${path}.summary 必须是字符串`);
}
