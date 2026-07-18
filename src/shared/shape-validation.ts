import { existsSync } from "node:fs";
import { isLanguage } from "./config.js";
import { formatError, isRecord, nonEmpty } from "./guards.js";

const SOURCE_TYPES = new Set(["conversation", "prompt", "file"]);
const CONVERSATION_TURN_KINDS = new Set([
	"user",
	"visible_supplement",
	"assistant_final",
]);
const SOURCE_FIELDS = {
	conversation: new Set(["type", "transcript"]),
	prompt: new Set(["type", "text"]),
	file: new Set(["type", "path", "text"]),
};
const CONVERSATION_TURN_FIELDS = new Set(["kind", "at", "text"]);
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
	if (!isRecord(source)) {
		errors.push("source 必须是对象");
		return;
	}
	if (!SOURCE_TYPES.has(String(source.type))) {
		errors.push("source.type 必须是 conversation、prompt 或 file");
		return;
	}
	const type = source.type as keyof typeof SOURCE_FIELDS;
	validateShapeFields(source, SOURCE_FIELDS[type], "source", errors);
	if (type === "conversation") {
		validateTranscript(source.transcript, errors);
		return;
	}
	if (typeof source.text !== "string") errors.push("source.text 必须是字符串");
	if (type === "file" && !nonEmpty(source.path))
		errors.push("source.path 必须是非空字符串");
}

function validateTranscript(value: unknown, errors: string[]) {
	if (!Array.isArray(value) || value.length === 0) {
		errors.push("source.transcript 必须是非空数组");
		return;
	}
	for (const [index, turn] of value.entries()) {
		const path = `source.transcript[${index}]`;
		if (!isRecord(turn)) {
			errors.push(`${path} 必须是对象`);
			continue;
		}
		validateShapeFields(turn, CONVERSATION_TURN_FIELDS, path, errors);
		if (!CONVERSATION_TURN_KINDS.has(String(turn.kind)))
			errors.push(
				`${path}.kind 必须是 user、visible_supplement 或 assistant_final`,
			);
		if (!nonEmpty(turn.at)) errors.push(`${path}.at 必须是非空字符串`);
		if (!nonEmpty(turn.text)) errors.push(`${path}.text 必须是非空字符串`);
	}
}

function validateShapeFields(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	path: string,
	errors: string[],
) {
	for (const field of Object.keys(value)) {
		if (!allowed.has(field)) errors.push(`${path}.${field} 不是合法 Flow 字段`);
	}
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
	validateActiveCheckRun(phase.active, `${path}.active`, errors);
}

function validateActiveCheckRun(
	active: unknown,
	path: string,
	errors: string[],
) {
	if (!isRecord(active)) {
		errors.push(`${path} 必须是对象或 null`);
		return;
	}
	if (!Number.isInteger(active.round)) errors.push(`${path}.round 必须是整数`);
	if (!nonEmpty(active.generation))
		errors.push(`${path}.generation 必须是非空字符串`);
	if (!nonEmpty(active.runId)) errors.push(`${path}.runId 必须是非空字符串`);
	if (active.startedAt !== undefined && !Number.isFinite(active.startedAt))
		errors.push(`${path}.startedAt 必须是时间戳`);
	if (!nonEmpty(active.inputHash))
		errors.push(`${path}.inputHash 必须是非空字符串`);
	if (!Array.isArray(active.models) || active.models.length === 0) {
		errors.push(`${path}.models 必须是非空数组`);
		return;
	}
	for (const [index, model] of active.models.entries())
		validateActiveModel(model, `${path}.models[${index}]`, errors);
}

function validateActiveModel(model: unknown, path: string, errors: string[]) {
	if (!isRecord(model)) {
		errors.push(`${path} 必须是对象`);
		return;
	}
	if (!nonEmpty(model.key)) errors.push(`${path}.key 必须是非空字符串`);
	if (!nonEmpty(model.label)) errors.push(`${path}.label 必须是非空字符串`);
	if (model.outcome === null) return;
	if (!isRecord(model.outcome)) {
		errors.push(`${path}.outcome 必须是对象或 null`);
		return;
	}
	if (!CHECK_RESULTS.has(String(model.outcome.result)))
		errors.push(`${path}.outcome.result 必须是 passed、failed 或 error`);
	if (typeof model.outcome.summary !== "string")
		errors.push(`${path}.outcome.summary 必须是字符串`);
	if (typeof model.outcome.details !== "string")
		errors.push(`${path}.outcome.details 必须是字符串`);
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
	if (
		round.elapsedMs !== undefined &&
		(!Number.isFinite(round.elapsedMs) || Number(round.elapsedMs) < 0)
	)
		errors.push(`${path}.elapsedMs 必须是非负毫秒数`);
	if (round.models !== undefined) {
		if (!Array.isArray(round.models)) errors.push(`${path}.models 必须是数组`);
		else
			for (const [index, model] of round.models.entries())
				validateModel(model, `${path}.models[${index}]`, errors);
	}
	if (round.advisor !== undefined)
		validateAdvisor(round.advisor, `${path}.advisor`, errors);
}

function validateAdvisor(value: unknown, path: string, errors: string[]) {
	if (!isRecord(value)) {
		errors.push(`${path} 必须是对象`);
		return;
	}
	if (!nonEmpty(value.model)) errors.push(`${path}.model 必须是非空字符串`);
	if (!nonEmpty(value.thinking))
		errors.push(`${path}.thinking 必须是非空字符串`);
	if (!nonEmpty(value.advice)) errors.push(`${path}.advice 必须是非空字符串`);
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
