import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type Language,
	type RoleModelConfig,
	type RoleModelSelection,
	readFlowConfig,
} from "./config.js";
import { formatError } from "./guards.js";
import { notifyUser } from "./ui-language.js";

export type ModelRole = "planner" | "executor";

type RoleModelContext = Pick<ExtensionContext, "ui"> & {
	modelRegistry?: ExtensionContext["modelRegistry"];
};

const ROLE_COPY = {
	planner: {
		zh: { label: "计划模型", icon: "🧭" },
		en: { label: "Planner model", icon: "🧭" },
	},
	executor: {
		zh: { label: "执行模型", icon: "⚒️" },
		en: { label: "Executor model", icon: "⚒️" },
	},
} satisfies Record<
	ModelRole,
	Record<Language, { label: string; icon: string }>
>;

export async function switchToRoleModel(
	pi: Pick<ExtensionAPI, "setModel" | "setThinkingLevel">,
	ctx: RoleModelContext,
	role: ModelRole,
	language: Language,
) {
	let config: RoleModelConfig;
	try {
		config = readFlowConfig().modelRoles[role];
	} catch (error) {
		notifyUser(
			ctx,
			roleConfigError(role, formatError(error), language),
			"error",
			language,
		);
		return false;
	}
	if (config === "current") return true;
	return applyRoleModel(pi, ctx, role, config, language);
}

async function applyRoleModel(
	pi: Pick<ExtensionAPI, "setModel" | "setThinkingLevel">,
	ctx: RoleModelContext,
	role: ModelRole,
	config: RoleModelSelection,
	language: Language,
) {
	const modelRegistry = ctx.modelRegistry;
	if (!modelRegistry) {
		notifyUser(
			ctx,
			roleUnavailable(role, config.model, language),
			"error",
			language,
		);
		return false;
	}
	const model = modelRegistry.find(...modelReference(config.model));
	if (!model) {
		notifyUser(
			ctx,
			roleUnavailable(role, config.model, language),
			"error",
			language,
		);
		return false;
	}
	if (
		typeof pi.setModel !== "function" ||
		typeof pi.setThinkingLevel !== "function"
	) {
		notifyUser(
			ctx,
			roleUnavailable(role, config.model, language),
			"error",
			language,
		);
		return false;
	}
	if (!(await pi.setModel(model))) {
		notifyUser(
			ctx,
			roleUnavailable(role, config.model, language),
			"error",
			language,
		);
		return false;
	}
	pi.setThinkingLevel(config.thinking);
	notifyUser(ctx, roleStarted(role, config, language), "info", language);
	return true;
}

function modelReference(reference: string): [string, string] {
	const slashIndex = reference.indexOf("/");
	return [reference.slice(0, slashIndex), reference.slice(slashIndex + 1)];
}

function roleStarted(
	role: ModelRole,
	config: RoleModelSelection,
	language: Language,
) {
	const copy = ROLE_COPY[role][language];
	const suffix = `${config.model}/${config.thinking}`;
	return language === "en"
		? `${copy.icon} ${copy.label} started: ${suffix}`
		: `${copy.icon} ${copy.label}开工：${suffix}`;
}

function roleUnavailable(role: ModelRole, model: string, language: Language) {
	const label = ROLE_COPY[role][language].label;
	return language === "en"
		? `${label} is unavailable: ${model}`
		: `${label}不可用：${model}`;
}

function roleConfigError(role: ModelRole, error: string, language: Language) {
	const label = ROLE_COPY[role][language].label;
	return language === "en"
		? `${label} config error: ${error}`
		: `${label}配置错误：${error}`;
}
