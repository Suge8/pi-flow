import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Language } from "./config.js";
import { formatError } from "./guards.js";
import { formatUserNotice, notifyUser } from "./ui-language.js";

const VISIBLE_USER_INPUT_TYPE = "Pi Flow 用户补充";
const HIDDEN_PROMPT_TYPE = "pi-flow-internal-prompt";

type PromptContext = Pick<ExtensionContext, "ui"> &
	Partial<Pick<ExtensionAPI, "sendMessage">>;

interface OrchestrationPromptInput {
	followUp?: boolean;
	errorPrefix: string;
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
		// Best-effort transcript echo; prompt delivery below is the source of truth.
	}
}

export async function sendOrchestrationPrompt(
	pi: ExtensionAPI,
	ctx: PromptContext,
	prompt: string,
	input: OrchestrationPromptInput,
) {
	try {
		const sendMessage = ctx.sendMessage ?? pi.sendMessage.bind(pi);
		await sendMessage(
			{
				customType: input.customType ?? HIDDEN_PROMPT_TYPE,
				content: prompt,
				display: false,
			},
			{
				triggerTurn: true,
				deliverAs: input.followUp ? "followUp" : undefined,
			},
		);
		return true;
	} catch (error) {
		notifyUser(
			ctx,
			formatUserNotice("❌", input.errorPrefix, [formatError(error)]),
			"info",
			input.language,
		);
		return false;
	}
}
