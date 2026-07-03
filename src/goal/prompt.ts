import type { FlowSourceType } from "../flow/types.js";
import type { Language } from "../shared/config.js";
import { localizeErrors } from "../shared/error-language.js";
import { appendAlignedRequest } from "../shared/generation-alignment.js";
import { readPrompt } from "../shared/prompts.js";
import { validateDraftCommand } from "../shared/validate-command.js";

export function generationPrompt(input: {
	originalRequest: string;
	sourceType: FlowSourceType;
	sourcePath?: string;
	alignedRequest?: string;
	language: Language;
}) {
	return appendAlignedRequest(
		readPrompt("goal-plan", input.language)
			.replace(
				"{{originalRequest}}",
				input.originalRequest || defaultOriginalRequest(input.language),
			)
			.replace("{{source}}", sourceLabel(input))
			.replaceAll("{{validateCommand}}", validateDraftCommand())
			.replaceAll("{{language}}", input.language),
		input.alignedRequest,
		input.language,
	);
}

export function repairPrompt(input: {
	errors: string[];
	originalRequest: string;
	goalPath: string;
	language: Language;
}) {
	return readPrompt("goal-repair", input.language)
		.replaceAll(
			"{{errors}}",
			localizeErrors(input.errors, input.language).join("\n") ||
				noValidGoal(input.language),
		)
		.replaceAll(
			"{{originalRequest}}",
			input.originalRequest || none(input.language),
		)
		.replaceAll("{{goalPath}}", input.goalPath)
		.replaceAll("{{validateCommand}}", validateDraftCommand())
		.replaceAll("{{language}}", input.language);
}

function defaultOriginalRequest(language: Language) {
	return language === "en"
		? "(no explicit argument; generate from the current conversation context)"
		: "（无显式参数；根据当前会话上下文生成）";
}

function noValidGoal(language: Language) {
	return language === "en" ? "(no valid Goal found)" : "（未找到合格目标）";
}

function none(language: Language) {
	return language === "en" ? "(none)" : "（无）";
}

function sourceLabel(input: {
	sourceType: FlowSourceType;
	sourcePath?: string;
}) {
	return input.sourcePath
		? `${input.sourceType}: ${input.sourcePath}`
		: input.sourceType;
}
