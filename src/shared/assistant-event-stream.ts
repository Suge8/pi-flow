export function collectAssistantEvents(onEvent?: (event: unknown) => void) {
	let messageEndText = "";
	let agentEndText = "";
	return {
		onLine(line: string) {
			const event = parseEvent(line);
			if (!event) return;
			onEvent?.(event);
			const messageText = assistantMessageEndText(event);
			if (messageText !== undefined) messageEndText = messageText;
			const fallbackText = agentEndAssistantText(event);
			if (fallbackText !== undefined) agentEndText = fallbackText;
		},
		text() {
			return messageEndText.trim() ? messageEndText : agentEndText;
		},
	};
}

function parseEvent(line: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(line);
		return recordValue(value);
	} catch {
		return undefined;
	}
}

function assistantMessageEndText(event: Record<string, unknown>) {
	if (event.type !== "message_end") return undefined;
	const message = recordValue(event.message);
	return message?.role === "assistant" ? messageText(message) : undefined;
}

function agentEndAssistantText(event: Record<string, unknown>) {
	if (event.type !== "agent_end" || !Array.isArray(event.messages))
		return undefined;
	for (let index = event.messages.length - 1; index >= 0; index -= 1) {
		const message = recordValue(event.messages[index]);
		if (message?.role === "assistant") return messageText(message);
	}
	return undefined;
}

function messageText(message: Record<string, unknown>) {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.flatMap((part) => {
			const content = recordValue(part);
			return content?.type === "text" && typeof content.text === "string"
				? [content.text]
				: [];
		})
		.join("\n");
}

function recordValue(value: unknown) {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
