import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Language } from "./config.js";
import { formatError } from "./guards.js";
import { formatUserNotice, notifyUser } from "./ui-language.js";

const VISIBLE_USER_INPUT_TYPE = "Pi Flow 用户补充";
const HIDDEN_PROMPT_TYPE = "pi-flow-internal-prompt";
/** 仅送执行模型、必须从后续验收/质检上下文证据排除的顾问方向提示。 */
export const ADVISOR_DIRECTION_PROMPT_TYPE = "pi-flow-advisor-direction";

type PromptContext = Pick<ExtensionContext, "ui"> & {
	sendMessage?: (
		...args: Parameters<ExtensionAPI["sendMessage"]>
	) => void | Promise<void>;
};

interface OrchestrationPromptInput {
	followUp?: boolean;
	errorPrefix: string;
	errorDetails?: readonly string[];
	customType?: string;
	language?: Language;
}

export function appendVisibleUserInput(
	pi: ExtensionAPI,
	text: string,
	input: { streamingBehavior?: "steer" | "followUp" } = {},
) {
	const content = text.trim();
	if (!content) return;
	// During streaming, sendMessage queues custom messages into the model.
	if (input.streamingBehavior) return;
	try {
		pi.sendMessage({
			customType: VISIBLE_USER_INPUT_TYPE,
			content,
			display: true,
		});
	} catch {
		// Best-effort visible history echo; prompt delivery below is the source of truth.
	}
}

export function sendOrchestrationPrompt(
	pi: ExtensionAPI,
	ctx: PromptContext,
	prompt: string,
	input: OrchestrationPromptInput,
) {
	try {
		const message = {
			customType: input.customType ?? HIDDEN_PROMPT_TYPE,
			content: prompt,
			display: false,
		};
		const options = {
			triggerTurn: true,
			deliverAs: input.followUp ? ("followUp" as const) : undefined,
		};
		const turn = ctx.sendMessage
			? ctx.sendMessage(message, options)
			: pi.sendMessage(message, options);
		// Replacement contexts resolve after the full turn; domain events own completion.
		if (turn) void turn.catch((error) => notifyTurnFailure(ctx, input, error));
		return true;
	} catch (error) {
		notifyPromptFailure(ctx, input, error);
		return false;
	}
}

function notifyTurnFailure(
	ctx: PromptContext,
	input: OrchestrationPromptInput,
	error: unknown,
) {
	notifyUser(
		ctx,
		formatUserNotice(
			"❌",
			input.language === "en" ? "Agent turn failed" : "执行回合失败",
			[...(input.errorDetails ?? []), formatError(error)],
		),
		"info",
		input.language,
	);
}

function notifyPromptFailure(
	ctx: PromptContext,
	input: OrchestrationPromptInput,
	error: unknown,
) {
	notifyUser(
		ctx,
		formatUserNotice("❌", input.errorPrefix, [
			...(input.errorDetails ?? []),
			formatError(error),
		]),
		"info",
		input.language,
	);
}
