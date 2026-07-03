import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { localizeErrorText } from "./error-language.js";
import { formatError, isRecord } from "./guards.js";
import type { ServiceTier } from "./service-tier.js";
import type { TranscriptConfig } from "./session.js";

export type QualityMode = "manual" | "autoFix";
export type GenerationAlign = "ask" | "yes" | "no";
export type Language = "zh" | "en";
export type LanguageConfig = Language | "auto";
export type { ServiceTier } from "./service-tier.js";
export interface RunnerConfig {
	command: string;
	tools: string[];
	excludeTools: string[];
	timeoutMs: number;
	serviceTier?: ServiceTier;
	extensions: string[];
}
export interface ModelConfig extends RunnerConfig {
	model: string;
	thinking: string;
}
export type ReviewerConfig = ModelConfig;
export type { TranscriptConfig } from "./session.js";
export interface AcceptanceConfig {
	enabled: boolean;
}
export interface QualityConfig {
	enabled: boolean;
	mode: QualityMode;
	runAfterCompletion: boolean;
}
export interface GenerationConfig {
	align: GenerationAlign;
	warning?: string;
}
export interface FlowConfig {
	runner: RunnerConfig;
	models: ModelConfig[];
	acceptance: AcceptanceConfig;
	quality: QualityConfig;
	transcript: TranscriptConfig;
}

const EXTENSION_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CONFIG_PATH = join(EXTENSION_DIR, "config.json");
const DEFAULT_RUNNER = {
	command: "pi",
	tools: ["read", "grep", "find", "ls", "bash"],
	excludeTools: ["write", "edit"],
	timeoutMs: 10 * 60 * 1000,
	serviceTier: "default",
	extensions: [],
} satisfies RunnerConfig;
const DEFAULT_MODELS = [
	{ model: "openai-codex/gpt-5.4", thinking: "medium" },
	{ model: "openai-codex/gpt-5.4-mini", thinking: "medium" },
	{ model: "deepseek/deepseek-v4-flash", thinking: "high" },
];
const MAX_MODELS = 5;
const SERVICE_TIERS = new Set(["default", "priority"]);
const LANGUAGES = new Set(["zh", "en"]);
const LANGUAGE_CONFIGS = new Set(["auto", "zh", "en"]);
const THINKING_LEVELS = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);
const TOOL_NAMES = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"bash",
	"write",
	"edit",
]);
const GENERATION_ALIGNS = new Set(["ask", "yes", "no"]);
const DEFAULT_TRANSCRIPT: TranscriptConfig = {
	maxUser: 8000,
	maxAssistant: 4000,
	maxTranscript: 75000,
};
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const MIN_TRANSCRIPT_LIMIT = 100;
const MAX_TRANSCRIPT_LIMIT = 200_000;

/** 完成验收与质量检查启用开关（配置读取失败时默认全开，与运行时行为一致）。 */
export function reviewToggles() {
	try {
		const config = readFlowConfig();
		return {
			acceptance: config.acceptance.enabled,
			quality: config.quality.runAfterCompletion && config.quality.enabled,
		};
	} catch {
		return { acceptance: true, quality: true };
	}
}

export function readFlowConfig(): FlowConfig {
	const parsed = readConfigFile();
	validateNoLegacyConfig(parsed);
	languageConfig(parsed.language);
	const runner = runnerConfig(recordValue(parsed, "runner"), DEFAULT_RUNNER);
	return {
		runner,
		models: modelList(parsed.models, "models", runner),
		acceptance: acceptanceConfig(recordValue(parsed, "acceptance")),
		quality: qualityConfig(recordValue(parsed, "quality")),
		transcript: transcriptConfig(recordValue(parsed, "transcript")),
	};
}

export function readGenerationConfig(): GenerationConfig {
	let parsed: Record<string, unknown>;
	try {
		parsed = readConfigFile();
	} catch (error) {
		return fallbackGenerationConfig(formatError(error));
	}
	languageConfig(parsed.language);
	const value = parsed.generation;
	if (value === undefined) return { align: "ask" };
	if (!isRecord(value))
		return fallbackGenerationConfig("config.json 字段 generation 必须是对象");
	if (value.align === undefined) return { align: "ask" };
	if (typeof value.align === "string" && GENERATION_ALIGNS.has(value.align))
		return { align: value.align as GenerationAlign };
	return fallbackGenerationConfig(
		"config.json 字段 generation.align 必须是 ask、yes 或 no",
	);
}

export function readConfiguredLanguage(): LanguageConfig {
	return languageConfig(readConfigFile().language);
}

function fallbackGenerationConfig(warning: string): GenerationConfig {
	return { align: "ask", warning: localizeErrorText(warning) };
}

function configError(message: string) {
	return new Error(localizeErrorText(message));
}

function readConfigFile(): Record<string, unknown> {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		if (isRecord(parsed)) return parsed;
	} catch (error) {
		throw configError(`config.json 不是合法 JSON: ${formatError(error)}`);
	}
	throw configError("config.json 必须是对象");
}

function validateNoLegacyConfig(config: Record<string, unknown>) {
	for (const key of ["goal", "review"]) {
		if (config[key] !== undefined)
			throw configError(`config.json 字段 ${key} 已废弃，请改用顶层 models`);
	}
	for (const key of ["acceptance", "quality"]) {
		const value = config[key];
		if (isRecord(value) && value.models !== undefined)
			throw configError(
				`config.json 字段 ${key}.models 已废弃，请改用顶层 models`,
			);
	}
}

function acceptanceConfig(value: Record<string, unknown>): AcceptanceConfig {
	return {
		enabled: optionalBoolean(value.enabled, "acceptance.enabled", true),
	};
}

function qualityConfig(value: Record<string, unknown>): QualityConfig {
	return {
		enabled: optionalBoolean(value.enabled, "quality.enabled", true),
		mode: optionalQualityMode(value.mode),
		runAfterCompletion: optionalBoolean(
			value.runAfterCompletion,
			"quality.runAfterCompletion",
			true,
		),
	};
}

function runnerConfig(
	value: Record<string, unknown>,
	fallback: RunnerConfig,
): RunnerConfig {
	return {
		command: optionalString(value.command, "runner.command", fallback.command),
		...validatedTools(value.tools, value.excludeTools, fallback, "runner"),
		timeoutMs: optionalTimeout(
			value.timeoutMs,
			"runner.timeoutMs",
			fallback.timeoutMs,
		),
		serviceTier: optionalServiceTier(value.serviceTier, fallback.serviceTier),
		extensions: optionalStringArray(
			value.extensions,
			"runner.extensions",
			fallback.extensions,
		),
	};
}

function modelConfig(
	value: Record<string, unknown>,
	key: string,
	runner: RunnerConfig,
): ModelConfig {
	const base = runnerConfig(value, runner);
	return {
		...base,
		model: optionalString(value.model, `${key}.model`, DEFAULT_MODELS[0].model),
		thinking: optionalThinking(
			value.thinking,
			`${key}.thinking`,
			DEFAULT_MODELS[0].thinking,
		),
	};
}

function modelList(
	value: unknown,
	key: string,
	runner: RunnerConfig,
): ModelConfig[] {
	if (value === undefined)
		return DEFAULT_MODELS.map((model) => ({ ...runner, ...model }));
	if (!Array.isArray(value) || value.length === 0)
		throw configError(`config.json 字段 ${key} 必须是非空数组`);
	if (value.length > MAX_MODELS)
		throw configError(`config.json 字段 ${key} 最多 ${MAX_MODELS} 个模型`);
	return value.map((item, index) => {
		if (!isRecord(item))
			throw configError(`config.json 字段 ${key}[${index}] 必须是对象`);
		return modelConfig(item, `${key}[${index}]`, runner);
	});
}

function transcriptConfig(value: Record<string, unknown>): TranscriptConfig {
	return {
		maxUser: optionalTranscriptLimit(
			value.maxUser,
			"transcript.maxUser",
			DEFAULT_TRANSCRIPT.maxUser,
		),
		maxAssistant: optionalTranscriptLimit(
			value.maxAssistant,
			"transcript.maxAssistant",
			DEFAULT_TRANSCRIPT.maxAssistant,
		),
		maxTranscript: optionalTranscriptLimit(
			value.maxTranscript,
			"transcript.maxTranscript",
			DEFAULT_TRANSCRIPT.maxTranscript,
		),
	};
}

function recordValue(source: Record<string, unknown>, key: string) {
	const value = source[key];
	if (value === undefined) return {};
	if (isRecord(value)) return value;
	throw configError(`config.json 字段 ${key} 必须是对象`);
}

function optionalBoolean(value: unknown, key: string, fallback: boolean) {
	if (value === undefined) return fallback;
	if (typeof value === "boolean") return value;
	throw configError(`config.json 字段 ${key} 必须是布尔值`);
}

function optionalString(value: unknown, key: string, fallback: string) {
	if (value === undefined) return fallback;
	if (typeof value === "string" && value.trim()) return value.trim();
	throw configError(`config.json 字段 ${key} 必须是非空字符串`);
}

function optionalStringArray(value: unknown, key: string, fallback: string[]) {
	if (value === undefined) return fallback;
	if (
		!Array.isArray(value) ||
		!value.every((item) => typeof item === "string" && item.trim())
	) {
		throw configError(`config.json 字段 ${key} 必须是非空字符串数组`);
	}
	return [...new Set(value.map((item) => item.trim()))];
}

function optionalThinking(value: unknown, key: string, fallback: string) {
	const thinking = optionalString(value, key, fallback);
	if (THINKING_LEVELS.has(thinking)) return thinking;
	throw configError(
		`config.json 字段 ${key} 必须是 off、minimal、low、medium、high 或 xhigh`,
	);
}

function languageConfig(value: unknown): LanguageConfig {
	if (value === undefined) return "auto";
	if (typeof value === "string" && LANGUAGE_CONFIGS.has(value))
		return value as LanguageConfig;
	throw configError("config.json 字段 language 必须是 auto、zh 或 en");
}

export function isLanguage(value: unknown): value is Language {
	return typeof value === "string" && LANGUAGES.has(value);
}

function optionalServiceTier(
	value: unknown,
	fallback: ServiceTier | undefined,
): ServiceTier | undefined {
	if (value === undefined) return fallback;
	if (typeof value === "string" && SERVICE_TIERS.has(value))
		return value as ServiceTier;
	throw configError("config.json 字段 serviceTier 必须是 default 或 priority");
}

function optionalQualityMode(value: unknown): QualityMode {
	if (value === undefined) return "autoFix";
	if (value === "manual" || value === "autoFix") return value;
	throw configError("config.json 字段 quality.mode 必须是 manual 或 autoFix");
}

function validatedTools(
	toolsValue: unknown,
	excludeToolsValue: unknown,
	fallback: RunnerConfig,
	key: string,
) {
	const tools = optionalStringArray(toolsValue, `${key}.tools`, fallback.tools);
	const excludeTools = optionalStringArray(
		excludeToolsValue,
		`${key}.excludeTools`,
		fallback.excludeTools,
	);
	for (const tool of [...tools, ...excludeTools]) {
		if (!TOOL_NAMES.has(tool))
			throw configError(`config.json 工具名无效: ${tool}`);
	}
	const excluded = new Set(excludeTools);
	const conflict = tools.find((tool) => excluded.has(tool));
	if (conflict)
		throw configError(`config.json tools 与 excludeTools 冲突: ${conflict}`);
	return { tools, excludeTools };
}

function optionalTimeout(value: unknown, key: string, fallback: number) {
	if (value === undefined) return fallback;
	if (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= MIN_TIMEOUT_MS &&
		value <= MAX_TIMEOUT_MS
	)
		return value;
	throw configError(
		`config.json 字段 ${key} 必须在 ${MIN_TIMEOUT_MS} 到 ${MAX_TIMEOUT_MS} 之间`,
	);
}

function optionalTranscriptLimit(
	value: unknown,
	key: string,
	fallback: number,
) {
	if (value === undefined) return fallback;
	if (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= MIN_TRANSCRIPT_LIMIT &&
		value <= MAX_TRANSCRIPT_LIMIT
	)
		return value;
	throw configError(
		`config.json 字段 ${key} 必须在 ${MIN_TRANSCRIPT_LIMIT} 到 ${MAX_TRANSCRIPT_LIMIT} 之间`,
	);
}
