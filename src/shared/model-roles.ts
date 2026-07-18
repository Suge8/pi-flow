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
import { formatUserNotice, notifyUser } from "./ui-language.js";

export type ModelRole = "advisor" | "executor";

/** 当前会话实际模型与思考强度（provider/id 形式）；无模型时 undefined。 */
export function currentSessionModel(
	pi: Pick<ExtensionAPI, "getThinkingLevel">,
	ctx: Pick<ExtensionContext, "model">,
): RoleModelSelection | undefined {
	const model = ctx.model;
	if (!model) return undefined;
	return {
		model: `${model.provider}/${model.id}`,
		thinking: pi.getThinkingLevel() as RoleModelSelection["thinking"],
	};
}

type RoleModelContext = Pick<ExtensionContext, "ui"> & {
	modelRegistry?: ExtensionContext["modelRegistry"];
};

const ROLE_COPY = {
	advisor: {
		zh: { label: "顾问模型" },
		en: { label: "Advisor model" },
	},
	executor: {
		zh: { label: "执行模型" },
		en: { label: "Executor model" },
	},
} satisfies Record<ModelRole, Record<Language, { label: string }>>;

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
			"info",
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
			"info",
			language,
		);
		return false;
	}
	const model = modelRegistry.find(...modelReference(config.model));
	if (!model) {
		notifyUser(
			ctx,
			roleUnavailable(role, config.model, language),
			"info",
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
			"info",
			language,
		);
		return false;
	}
	if (!(await pi.setModel(model))) {
		notifyUser(
			ctx,
			roleUnavailable(role, config.model, language),
			"info",
			language,
		);
		return false;
	}
	pi.setThinkingLevel(config.thinking);
	return true;
}

function modelReference(reference: string): [string, string] {
	const slashIndex = reference.indexOf("/");
	return [reference.slice(0, slashIndex), reference.slice(slashIndex + 1)];
}

function roleUnavailable(role: ModelRole, model: string, language: Language) {
	const label = ROLE_COPY[role][language].label;
	return language === "en"
		? formatUserNotice("⚠️", `${label} is unavailable`, [model])
		: formatUserNotice("⚠️", `${label}不可用`, [model]);
}

function roleConfigError(role: ModelRole, error: string, language: Language) {
	const label = ROLE_COPY[role][language].label;
	return language === "en"
		? formatUserNotice("❌", `${label} config error`, [error])
		: formatUserNotice("❌", `${label}配置错误`, [error]);
}
