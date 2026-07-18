import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { localizeErrorText } from "./error-language.js";
import { formatError, isRecord } from "./guards.js";

export type QualityMode = "manual" | "autoFix";
export type AlignmentDepth = "coarse" | "standard" | "deep";
export type GenerationAlign = "ask" | "no" | AlignmentDepth;
export type ThinkingLevelConfig =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";
export type Language = "zh" | "en";
export type LanguageConfig = Language | "auto";

export interface BackgroundConfig {
	command: string;
	extensions: string[];
}

export interface ChecksConfig {
	tools: string[];
	timeoutMinutes: number;
	openaiFast: boolean;
}

export interface RoleModelSelection {
	model: string;
	thinking: ThinkingLevelConfig;
}

export interface DiagnosticModelConfig extends RoleModelSelection {
	command: string;
	tools: string[];
	excludeTools: string[];
	timeoutMs: number;
	openaiFast: boolean;
	extensions: string[];
}

export type RoleModelConfig = "current" | RoleModelSelection;
export type ReviewerConfig = DiagnosticModelConfig;

export interface ModelRolesConfig {
	advisor: RoleModelConfig;
	executor: RoleModelConfig;
	reviewers: ReviewerConfig[];
}

export interface AdvisorConfig {
	enabled: boolean;
}

/** 计划轨迹继承（prewalk）：首批执行会话从生成会话 fork，复用计划模型的探索上下文。 */
export interface PrewalkConfig {
	enabled: boolean;
}

export interface AcceptanceConfig {
	enabled: boolean;
}

export interface QualityConfig {
	enabled: boolean;
	mode: QualityMode;
	runAfterCompletion: boolean;
}

export interface ReportConfig {
	bind: string;
	port: number;
	publicBaseUrl: string | null;
}

export interface GenerationConfig {
	align: GenerationAlign;
	warning?: string;
}

export interface FlowConfig {
	background: BackgroundConfig;
	checks: ChecksConfig;
	modelRoles: ModelRolesConfig;
	advisor: AdvisorConfig;
	prewalk: PrewalkConfig;
	acceptance: AcceptanceConfig;
	quality: QualityConfig;
	report: ReportConfig;
}

const EXTENSION_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CONFIG_PATH = join(EXTENSION_DIR, "config.json");
const DEFAULT_BACKGROUND = {
	command: "pi",
	extensions: [],
} satisfies BackgroundConfig;
const DEFAULT_CHECKS = {
	tools: ["read", "grep", "find", "ls", "bash"],
	timeoutMinutes: 20,
	openaiFast: false,
} satisfies ChecksConfig;
const DEFAULT_REPORT = {
	bind: "127.0.0.1",
	port: 49327,
	publicBaseUrl: null,
} satisfies ReportConfig;
const DEFAULT_MODELS = [
	{ model: "openai-codex/gpt-5.4", thinking: "medium" },
	{ model: "openai-codex/gpt-5.4-mini", thinking: "medium" },
	{ model: "deepseek/deepseek-v4-flash", thinking: "high" },
] satisfies RoleModelSelection[];
const CHECK_EXCLUDED_TOOLS = ["write", "edit"];
const CHECK_TOOL_NAMES = new Set(["read", "grep", "find", "ls", "bash"]);
const MAX_MODELS = 5;
const LANGUAGES = new Set(["zh", "en"]);
const LANGUAGE_CONFIGS = new Set(["auto", "zh", "en"]);
const THINKING_LEVELS = new Set<ThinkingLevelConfig>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);
const ROLE_MODEL_KEYS = new Set(["model", "thinking"]);
const CONFIG_KEYS = new Set([
	"language",
	"generation",
	"background",
	"checks",
	"modelRoles",
	"advisor",
	"prewalk",
	"acceptance",
	"quality",
	"report",
]);
const GENERATION_KEYS = new Set(["align"]);
const BACKGROUND_KEYS = new Set(["command", "extensions"]);
const CHECKS_KEYS = new Set(["tools", "timeoutMinutes", "openaiFast"]);
const MODEL_ROLES_KEYS = new Set(["advisor", "executor", "reviewers"]);
const ADVISOR_KEYS = new Set(["enabled"]);
const PREWALK_KEYS = new Set(["enabled"]);
const ACCEPTANCE_KEYS = new Set(["enabled"]);
const QUALITY_KEYS = new Set(["enabled", "mode", "runAfterCompletion"]);
const REPORT_KEYS = new Set(["bind", "port", "publicBaseUrl"]);
const GENERATION_ALIGNS = new Set(["ask", "no", "coarse", "standard", "deep"]);
const MIN_TIMEOUT_MINUTES = 1 / 60;
const MAX_TIMEOUT_MINUTES = 60;

/** 验收与质检启用开关（配置读取失败时默认全开，与运行时行为一致）。 */
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
	languageConfig(parsed.language);
	const background = backgroundConfig(recordValue(parsed, "background"));
	const checks = checksConfig(recordValue(parsed, "checks"));
	return {
		background,
		checks,
		modelRoles: modelRolesConfig(
			recordValue(parsed, "modelRoles"),
			background,
			checks,
		),
		advisor: advisorConfig(recordValue(parsed, "advisor")),
		prewalk: prewalkConfig(recordValue(parsed, "prewalk")),
		acceptance: acceptanceConfig(recordValue(parsed, "acceptance")),
		quality: qualityConfig(recordValue(parsed, "quality")),
		report: reportConfig(recordValue(parsed, "report")),
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
	try {
		validateConfigFields(value, GENERATION_KEYS, "generation");
	} catch (error) {
		return fallbackGenerationConfig(formatError(error));
	}
	if (value.align === undefined) return { align: "ask" };
	if (typeof value.align === "string" && GENERATION_ALIGNS.has(value.align))
		return { align: value.align as GenerationAlign };
	return fallbackGenerationConfig(
		"config.json 字段 generation.align 必须是 ask、no、coarse、standard 或 deep",
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
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as unknown;
	} catch (error) {
		throw configError(`config.json 不是合法 JSON: ${formatError(error)}`);
	}
	if (!isRecord(parsed)) throw configError("config.json 必须是对象");
	validateConfigFields(parsed, CONFIG_KEYS, "");
	return parsed;
}

function backgroundConfig(value: Record<string, unknown>): BackgroundConfig {
	validateConfigFields(value, BACKGROUND_KEYS, "background");
	return {
		command: optionalString(
			value.command,
			"background.command",
			DEFAULT_BACKGROUND.command,
		),
		extensions: optionalStringArray(
			value.extensions,
			"background.extensions",
			DEFAULT_BACKGROUND.extensions,
		),
	};
}

function checksConfig(value: Record<string, unknown>): ChecksConfig {
	validateConfigFields(value, CHECKS_KEYS, "checks");
	return {
		tools: checkTools(value.tools),
		timeoutMinutes: optionalTimeoutMinutes(value.timeoutMinutes),
		openaiFast: optionalBoolean(
			value.openaiFast,
			"checks.openaiFast",
			DEFAULT_CHECKS.openaiFast,
		),
	};
}

function acceptanceConfig(value: Record<string, unknown>): AcceptanceConfig {
	validateConfigFields(value, ACCEPTANCE_KEYS, "acceptance");
	return {
		enabled: optionalBoolean(value.enabled, "acceptance.enabled", true),
	};
}

function prewalkConfig(value: Record<string, unknown>): PrewalkConfig {
	validateConfigFields(value, PREWALK_KEYS, "prewalk");
	return {
		// 未配置时回退 false；随包 config.template.json 默认开启。隔离 harness A/B（eval:prewalk，3 任务 × 9 对）显示成本中位 0.99× 持平、
		// 首步中位提速 1.4×、读工具调用 1 vs 54、质量 18/18；真实 Flow 初步 A/B（eval:prewalk:flow，
		// 3 对串行含验收/质检）确认 fork 在生产链路工作且全部收口，但成本上 fork 仅 1/3 对占优，
		// 并行 worker 路径未实测；样本不足以宣称收益，由用户按自己配置权衡 opt-in。
		enabled: optionalBoolean(value.enabled, "prewalk.enabled", false),
	};
}

function advisorConfig(value: Record<string, unknown>): AdvisorConfig {
	validateConfigFields(value, ADVISOR_KEYS, "advisor");
	return {
		enabled: optionalBoolean(value.enabled, "advisor.enabled", true),
	};
}

function qualityConfig(value: Record<string, unknown>): QualityConfig {
	validateConfigFields(value, QUALITY_KEYS, "quality");
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

function reportConfig(value: Record<string, unknown>): ReportConfig {
	validateConfigFields(value, REPORT_KEYS, "report");
	return {
		bind: reportBind(value.bind),
		port: reportPort(value.port),
		publicBaseUrl: reportPublicBaseUrl(value.publicBaseUrl),
	};
}

function reportBind(value: unknown) {
	if (value === undefined) return DEFAULT_REPORT.bind;
	const bind = requiredString(value, "report.bind");
	if (bind === "localhost" || isIP(bind)) return bind;
	throw configError("config.json 字段 report.bind 必须匹配 localhost/IP");
}

function reportPort(value: unknown) {
	if (value === undefined) return DEFAULT_REPORT.port;
	if (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= 65535
	)
		return value;
	throw configError(
		"config.json 字段 report.port 必须是整数\nreport.port 必须在 1 到 65535 之间",
	);
}

function reportPublicBaseUrl(value: unknown) {
	if (value === undefined || value === null)
		return DEFAULT_REPORT.publicBaseUrl;
	if (typeof value !== "string")
		throw configError(
			"config.json 字段 report.publicBaseUrl 必须是字符串或 null",
		);
	try {
		const url = new URL(value);
		if (
			(url.protocol === "http:" || url.protocol === "https:") &&
			!url.username &&
			!url.password &&
			url.pathname === "/" &&
			!url.search &&
			!url.hash
		)
			return url.origin;
	} catch {}
	throw configError(
		"config.json 字段 report.publicBaseUrl 必须匹配 http(s) origin",
	);
}

function modelRolesConfig(
	value: Record<string, unknown>,
	background: BackgroundConfig,
	checks: ChecksConfig,
): ModelRolesConfig {
	validateConfigFields(value, MODEL_ROLES_KEYS, "modelRoles");
	return {
		advisor: roleModelConfig(value.advisor, "modelRoles.advisor"),
		executor: roleModelConfig(value.executor, "modelRoles.executor"),
		reviewers: reviewerList(
			value.reviewers,
			"modelRoles.reviewers",
			background,
			checks,
		),
	};
}

function reviewerList(
	value: unknown,
	key: string,
	background: BackgroundConfig,
	checks: ChecksConfig,
): ReviewerConfig[] {
	const selections = (() => {
		if (value === undefined) return DEFAULT_MODELS;
		if (!Array.isArray(value) || value.length === 0)
			throw configError(`config.json 字段 ${key} 必须是非空数组`);
		if (value.length > MAX_MODELS)
			throw configError(`config.json 字段 ${key} 最多 ${MAX_MODELS} 个模型`);
		return value.map((item, index) => modelSelection(item, `${key}[${index}]`));
	})();
	return selections.map((selection) =>
		diagnosticModelConfig(selection, background, checks),
	);
}

/** 失败顾问与 Reviewer 共用同一检查能力；current 仅回落模型选择。 */
export function advisorConsultModel(config: FlowConfig): DiagnosticModelConfig {
	const role = config.modelRoles.advisor;
	const selection =
		role === "current"
			? {
					model: config.modelRoles.reviewers[0].model,
					thinking: config.modelRoles.reviewers[0].thinking,
				}
			: role;
	return diagnosticModelConfig(selection, config.background, config.checks);
}

function diagnosticModelConfig(
	selection: RoleModelSelection,
	background: BackgroundConfig,
	checks: ChecksConfig,
): DiagnosticModelConfig {
	return {
		...background,
		...selection,
		tools: [...checks.tools],
		excludeTools: [...CHECK_EXCLUDED_TOOLS],
		timeoutMs: Math.round(checks.timeoutMinutes * 60_000),
		openaiFast: checks.openaiFast,
	};
}

function roleModelConfig(value: unknown, key: string): RoleModelConfig {
	if (value === undefined || value === "current") return "current";
	return modelSelection(value, key);
}

function modelSelection(value: unknown, key: string): RoleModelSelection {
	if (!isRecord(value))
		throw configError(
			`config.json 字段 ${key} 必须是包含 model、thinking 的对象`,
		);
	validateConfigFields(value, ROLE_MODEL_KEYS, key);
	const model = requiredString(value.model, `${key}.model`);
	if (!isCanonicalModelReference(model))
		throw configError(
			`config.json 字段 ${key}.model 必须匹配 provider/model-id`,
		);
	return {
		model,
		thinking: requiredThinking(value.thinking, `${key}.thinking`),
	};
}

function validateConfigFields(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	path: string,
) {
	const field = Object.keys(value).find((key) => !allowed.has(key));
	if (!field) return;
	throw configError(
		`config.json 字段 ${path ? `${path}.` : ""}${field} 不受支持`,
	);
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
	return requiredString(value, key);
}

function requiredString(value: unknown, key: string) {
	if (typeof value === "string" && value.trim()) return value.trim();
	throw configError(`config.json 字段 ${key} 必须是非空字符串`);
}

function optionalStringArray(value: unknown, key: string, fallback: string[]) {
	if (value === undefined) return [...fallback];
	if (
		!Array.isArray(value) ||
		!value.every((item) => typeof item === "string" && item.trim())
	)
		throw configError(`config.json 字段 ${key} 必须是字符串数组`);
	return [...new Set(value.map((item) => item.trim()))];
}

function checkTools(value: unknown) {
	const tools = optionalStringArray(
		value,
		"checks.tools",
		DEFAULT_CHECKS.tools,
	);
	for (const tool of tools)
		if (!CHECK_TOOL_NAMES.has(tool))
			throw configError(`config.json 检查工具名无效: ${tool}`);
	return tools;
}

function optionalTimeoutMinutes(value: unknown) {
	if (value === undefined) return DEFAULT_CHECKS.timeoutMinutes;
	if (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= MIN_TIMEOUT_MINUTES &&
		value <= MAX_TIMEOUT_MINUTES
	)
		return value;
	throw configError(
		"config.json 字段 checks.timeoutMinutes 必须至少 1 秒且不超过 60 分钟",
	);
}

function requiredThinking(value: unknown, key: string): ThinkingLevelConfig {
	const thinking = requiredString(value, key);
	if (isThinkingLevelConfig(thinking)) return thinking;
	throw configError(
		`config.json 字段 ${key} 必须是 off、minimal、low、medium、high、xhigh 或 max`,
	);
}

function isThinkingLevelConfig(value: string): value is ThinkingLevelConfig {
	return THINKING_LEVELS.has(value as ThinkingLevelConfig);
}

function isCanonicalModelReference(value: string) {
	const slashIndex = value.indexOf("/");
	return slashIndex > 0 && slashIndex < value.length - 1;
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

function optionalQualityMode(value: unknown): QualityMode {
	if (value === undefined) return "autoFix";
	if (value === "manual" || value === "autoFix") return value;
	throw configError("config.json 字段 quality.mode 必须是 manual 或 autoFix");
}
