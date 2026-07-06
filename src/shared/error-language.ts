export type ErrorLanguage = "zh" | "en";

const LANGUAGES = new Set(["zh", "en"]);

const EXACT_EN = new Map<string, string>([
	[
		"用法：node scripts/validate-draft.mjs <.flow/F1-id>",
		"Usage: node scripts/validate-draft.mjs <.flow/F1-id>",
	],
	["缺少 flow.json", "Missing flow.json"],
	["schemaVersion 必须为 7", "schemaVersion must be 7"],
	["language 必须是 zh 或 en", "language must be zh or en"],
	["id 必须匹配 F1-xxx", "id must match F1-xxx"],
	["title 必须是非空字符串", "title must be a non-empty string"],
	["createdAt 必须是时间戳", "createdAt must be a timestamp"],
	["updatedAt 必须是时间戳", "updatedAt must be a timestamp"],
	["repairAttempts 必须是整数", "repairAttempts must be an integer"],
	["currentGoal 必须是整数", "currentGoal must be an integer"],
	[
		"currentGoal 必须指向 goals 下标",
		"currentGoal must point to a goals index",
	],
	["startedAt 计划必须为 null", "startedAt must be null for a draft"],
	["startedAt 草稿必须为 null", "startedAt must be null for a draft"],
	[
		"startedAt 运行态必须是时间戳",
		"startedAt must be a timestamp when running",
	],
	["source 必须是对象", "source must be an object"],
	[
		"source.type 必须是 conversation、prompt 或 file",
		"source.type must be conversation, prompt, or file",
	],
	[
		"source.originalRequest 必须是字符串",
		"source.originalRequest must be a string",
	],
	["source.path 必须是字符串或 null", "source.path must be a string or null"],
	["errors 必须是数组", "errors must be an array"],
	["errors 必须是字符串数组", "errors must be a string array"],
	["goals 必须是数组", "goals must be an array"],
	["至少需要 1 个执行步骤", "At least 1 execution step is required"],
	[
		"执行步骤数量超过 10；final acceptance 不占执行步骤名额，必须拆成多个 flow",
		"Execution step count exceeds 10; final acceptance does not count toward the execution-step limit; split it into multiple flows",
	],
	[
		"单步 Flow 不使用最终验收步骤",
		"Single-step Flow must not use a final acceptance step",
	],
	[
		"多步 Flow 必须有 1 个最终验收步骤（role: final_acceptance）",
		"Multi-step Flow must have exactly 1 final acceptance step (role: final_acceptance)",
	],
	[
		"最后一个步骤必须是最终验收（role: final_acceptance）",
		"The last step must be final acceptance (role: final_acceptance)",
	],
	["Objective 不能为空", "Objective cannot be empty"],
	["Steps 至少需要 1 项 checkbox", "Steps needs at least 1 checkbox item"],
	[
		"Verification 至少需要 1 项 checkbox",
		"Verification needs at least 1 checkbox item",
	],
	[
		"Success Criteria 禁止使用 checkbox；该区是验收合同，完成证据请写入 Verification/Outcome/Handoff",
		"Success Criteria cannot use checkboxes; this section is the acceptance contract; write completion evidence in Verification/Outcome/Handoff",
	],
	["config.json 必须是对象", "config.json must be an object"],
	[
		"config.json 字段 language 必须是 auto、zh 或 en",
		"config.json field language must be auto, zh, or en",
	],
	[
		"config.json 字段 serviceTier 必须是 default 或 priority",
		"config.json field serviceTier must be default or priority",
	],
	[
		"config.json 字段 quality.mode 必须是 manual 或 autoFix",
		"config.json field quality.mode must be manual or autoFix",
	],
	[
		"config.json 字段 generation 必须是对象",
		"config.json field generation must be an object",
	],
	[
		"config.json 字段 generation.align 必须是 ask、yes 或 no",
		"config.json field generation.align must be ask, yes, or no",
	],
]);

export function fallbackErrorLanguage(): ErrorLanguage {
	const envLanguage = languageFromValue(process.env.PI_FLOW_LANGUAGE);
	if (envLanguage) return envLanguage;
	return languageFromLocale(machineLocale()) ?? "zh";
}

export function localizeErrors(
	errors: string[],
	language: ErrorLanguage | undefined = fallbackErrorLanguage(),
) {
	return errors.map((error) => localizeErrorText(error, language));
}

export function localizeErrorText(
	text: string,
	language: ErrorLanguage | undefined = fallbackErrorLanguage(),
) {
	if (language !== "en") return text;
	return text.split("\n").map(localizeErrorLine).join("\n");
}

function localizeErrorLine(text: string) {
	const exact = EXACT_EN.get(text);
	if (exact) return exact;
	return (
		configErrorLine(text) ??
		validationErrorLine(text) ??
		englishPunctuation(text)
	);
}

function englishPunctuation(text: string) {
	return text
		.replace(/：/gu, ": ")
		.replace(/；/gu, "; ")
		.replace(/，/gu, ", ")
		.replace(/。/gu, ".");
}

function configErrorLine(text: string) {
	let match = /^config\.json 不是合法 JSON: (.+)$/u.exec(text);
	if (match) return `config.json is not valid JSON: ${match[1]}`;
	match = /^config\.json 字段 (.+) 已废弃，请改用顶层 models$/u.exec(text);
	if (match)
		return `config.json field ${match[1]} is deprecated; use top-level models instead`;
	match = /^config\.json 字段 (.+)\.models 已废弃，请改用顶层 models$/u.exec(
		text,
	);
	if (match)
		return `config.json field ${match[1]}.models is deprecated; use top-level models instead`;
	match = /^config\.json 字段 (.+) 必须是(.+)$/u.exec(text);
	if (match)
		return `config.json field ${match[1]} must be ${configTypeText(match[2].trim())}`;
	match = /^config\.json 字段 (.+) 必须匹配 (.+)$/u.exec(text);
	if (match) return `config.json field ${match[1]} must match ${match[2]}`;
	match = /^config\.json 字段 (.+) 与 (.+) 不能同时配置$/u.exec(text);
	if (match)
		return `config.json fields ${match[1]} and ${match[2]} cannot both be set`;
	match = /^config\.json 字段 (.+) 不能包含 (.+)，只支持 (.+)$/u.exec(text);
	if (match)
		return `config.json field ${match[1]} cannot include ${match[2]}; only ${configListText(match[3])} are supported`;
	match = /^config\.json 字段 (.+) 最多 (\d+) 个模型$/u.exec(text);
	if (match)
		return `config.json field ${match[1]} can include at most ${match[2]} models`;
	match = /^config\.json 工具名无效: (.+)$/u.exec(text);
	if (match) return `config.json tool name is invalid: ${match[1]}`;
	match = /^config\.json tools 与 excludeTools 冲突: (.+)$/u.exec(text);
	if (match)
		return `config.json tools conflicts with excludeTools: ${match[1]}`;
	return undefined;
}

function validationErrorLine(text: string) {
	let match = /^目标目录名必须等于 id：(.+)$/u.exec(text);
	if (match) return `Goal directory name must equal id: ${match[1]}`;
	match = /^flow 目录名必须等于 id：(.+)$/u.exec(text);
	if (match) return `Flow directory name must equal id: ${match[1]}`;
	match = /^goals 顺序不连续：第 (\d+) 项 index 应为 (\d+)$/u.exec(text);
	if (match)
		return `goals order is not continuous: item ${match[1]} index should be ${match[2]}`;
	match = /^(goals\[\d+\]) 非最终步骤必须是 normal$/u.exec(text);
	if (match) return `${match[1]} non-final step must be normal`;
	match = /^(goals\[\d+\]) 缺少 (.+)$/u.exec(text);
	if (match) return `${match[1]} is missing ${match[2]}`;
	match = /^(goals\[\d+\]) 文件路径不能逃出 flow 目录：(.+)$/u.exec(text);
	if (match)
		return `${match[1]} file path cannot escape the flow directory: ${match[2]}`;
	match = /^步骤文件读取失败：(.+)$/u.exec(text);
	if (match) return `Step file read failed: ${match[1]}`;
	match = /^步骤文件不存在：(.+)$/u.exec(text);
	if (match) return `Step file does not exist: ${match[1]}`;
	match = /^步骤文件必须是普通文件：(.+)$/u.exec(text);
	if (match) return `Step file must be a regular file: ${match[1]}`;
	match = /^步骤文件检查失败：(.+)$/u.exec(text);
	if (match) return `Step file check failed: ${match[1]}`;
	match = /^(.+) 读取失败：(.+)$/u.exec(text);
	if (match) return `${match[1]} read failed: ${match[2]}`;
	match = /^(.+) 文件不存在$/u.exec(text);
	if (match) return `${match[1]} file does not exist`;
	match = /^(.+) 必须匹配 (.+)$/u.exec(text);
	if (match) return `${match[1]} must match ${match[2]}`;
	match = /^(.+) 必须在 (\d+) 到 (\d+) 之间$/u.exec(text);
	if (match) return `${match[1]} must be between ${match[2]} and ${match[3]}`;
	match = /^(.+) 必须指向先序 goals 下标$/u.exec(text);
	if (match) return `${match[1]} must point to an earlier goals index`;
	match = /^(.+) 必须指向 goals 下标$/u.exec(text);
	if (match) return `${match[1]} must point to a goals index`;
	match = /^(.+) 必须是\s*(.+)$/u.exec(text);
	if (match) return `${match[1]} must be ${validationTypeText(match[2])}`;
	match = /^(.+) 必须为 (.+)$/u.exec(text);
	if (match) return `${match[1]} must be ${validationTypeText(match[2])}`;
	match = /^(.+) 非法：(.+)$/u.exec(text);
	if (match) return `${match[1]} is invalid: ${match[2]}`;
	match = /^(.+) 非法$/u.exec(text);
	if (match) return `${match[1]} is invalid`;
	match = /^缺少章节：(.+)$/u.exec(text);
	if (match) return `Missing section: ${match[1]}`;
	match = /^(.+) 缺少章节：(.+)$/u.exec(text);
	if (match) return `${match[1]} missing section: ${match[2]}`;
	match = /^缺少 (.+)$/u.exec(text);
	if (match) return `Missing ${match[1]}`;
	match = /^(.+) 不能为空$/u.exec(text);
	if (match) return `${match[1]} cannot be empty`;
	match = /^(.+) 至少需要 1 项 checkbox$/u.exec(text);
	if (match) return `${match[1]} needs at least 1 checkbox item`;
	match =
		/^(.+) 禁止使用 checkbox；该区是验收合同，完成证据请写入 Verification\/Outcome\/Handoff$/u.exec(
			text,
		);
	if (match)
		return `${match[1]} cannot use checkboxes; this section is the acceptance contract; write completion evidence in Verification/Outcome/Handoff`;
	return undefined;
}

function validationTypeText(text: string) {
	return typeText(text)
		.replace("conversation、prompt 或 file", "conversation, prompt, or file")
		.replace("passed、failed 或 error", "passed, failed, or error")
		.replace("auto、zh 或 en", "auto, zh, or en")
		.replace("zh 或 en", "zh or en");
}

function configTypeText(text: string) {
	return typeText(
		text.replace(
			"current 或包含 model、thinking 的对象",
			"current or an object with model and thinking",
		),
	)
		.replace("ask、yes 或 no", "ask, yes, or no")
		.replace(
			"off、minimal、low、medium、high 或 xhigh",
			"off, minimal, low, medium, high, or xhigh",
		)
		.replace("manual 或 autoFix", "manual or autoFix")
		.replace("default 或 priority", "default or priority")
		.replace("auto、zh 或 en", "auto, zh, or en");
}

function configListText(text: string) {
	return text.replace(" 和 ", " and ").replace(/、/gu, ", ");
}

function typeText(text: string) {
	return text
		.replace("非空字符串数组", "a non-empty string array")
		.replace("字符串数组", "a string array")
		.replace("非空字符串", "a non-empty string")
		.replace("字符串或 null", "a string or null")
		.replace("对象或 null", "an object or null")
		.replace("数组或 null", "an array or null")
		.replace("非空数组", "a non-empty array")
		.replace("布尔值", "a boolean")
		.replace("时间戳", "a timestamp")
		.replace("字符串", "a string")
		.replace("对象", "an object")
		.replace("数组", "an array")
		.replace("整数", "an integer");
}

function languageFromValue(value: unknown): ErrorLanguage | undefined {
	return typeof value === "string" && LANGUAGES.has(value)
		? (value as ErrorLanguage)
		: undefined;
}

function languageFromLocale(
	locale: string | undefined,
): ErrorLanguage | undefined {
	const normalized = locale?.trim().toLowerCase().replace("_", "-");
	if (!normalized) return undefined;
	if (normalized.startsWith("zh")) return "zh";
	if (
		normalized === "c" ||
		normalized.startsWith("c.") ||
		normalized === "posix"
	)
		return undefined;
	return "en";
}

function machineLocale() {
	return (
		firstLocale(process.env.LC_ALL) ??
		firstLocale(process.env.LC_MESSAGES) ??
		firstLocale(process.env.LANGUAGE) ??
		firstLocale(process.env.LANG) ??
		intlLocale()
	);
}

function firstLocale(value: string | undefined) {
	return value
		?.split(/[:;]/u)
		.map((item) => item.trim())
		.find(Boolean);
}

function intlLocale() {
	try {
		return Intl.DateTimeFormat().resolvedOptions().locale;
	} catch {
		return undefined;
	}
}
