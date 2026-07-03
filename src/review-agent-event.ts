export function agentEndedWithHardStop(event: unknown) {
	const finalAssistant = finalAssistantForEvent(event);
	if (finalAssistant?.stopReason === "aborted") return true;
	return (
		finalAssistant?.stopReason === "error" &&
		!isRecoverableTransportError(finalAssistant) &&
		!isPiRetryableAgentError(finalAssistant)
	);
}

export function agentEndedWithRecoverableTransportStop(event: unknown) {
	const finalAssistant = finalAssistantForEvent(event);
	return (
		finalAssistant?.stopReason === "error" &&
		isRecoverableTransportError(finalAssistant)
	);
}

export function agentEndedWithPiRetryableStop(event: unknown) {
	const finalAssistant = finalAssistantForEvent(event);
	return Boolean(finalAssistant && isPiRetryableAgentError(finalAssistant));
}

export function isPiRetryableAgentError(assistant: {
	stopReason?: string;
	errorMessage?: string;
}) {
	if (assistant.stopReason !== "error" || !assistant.errorMessage) return false;
	if (isContextOverflowLikeError(assistant.errorMessage)) return false;
	return PI_RETRYABLE_ERROR_PATTERN.test(assistant.errorMessage);
}

const PI_RETRYABLE_ERROR_PATTERN =
	/overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/iu;

function isContextOverflowLikeError(message: string) {
	return /context.?length|context.?window|context.?overflow|maximum context|too many tokens|request too large|\b413\b/iu.test(
		message,
	);
}

function finalAssistantForEvent(event: unknown) {
	const messages = (event as { messages?: unknown[] }).messages ?? [];
	return findFinalAssistantMessage(messages);
}

function findFinalAssistantMessage(messages: unknown[]) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message || typeof message !== "object") continue;
		const candidate = message as {
			role?: unknown;
			stopReason?: unknown;
			errorMessage?: unknown;
			diagnostics?: unknown;
		};
		if (candidate.role !== "assistant") continue;
		return {
			stopReason: String(candidate.stopReason ?? ""),
			errorMessage:
				typeof candidate.errorMessage === "string"
					? candidate.errorMessage
					: "",
			diagnostics: candidate.diagnostics,
		};
	}
	return undefined;
}

function isRecoverableTransportError(assistant: {
	errorMessage: string;
	diagnostics: unknown;
}) {
	if (assistant.errorMessage.includes("Codex SSE response headers timed out"))
		return true;
	if (!assistant.errorMessage.includes("WebSocket closed 1006")) return false;
	return diagnosticRecords(assistant.diagnostics).some(
		(record) =>
			record.type === "provider_transport_failure" &&
			record.error?.code === 1006 &&
			record.details?.phase === "after_message_stream_start" &&
			record.details?.eventsEmitted === true,
	);
}

function diagnosticRecords(value: unknown) {
	return Array.isArray(value) ? value.filter(isDiagnosticRecord) : [];
}

function isDiagnosticRecord(value: unknown): value is {
	type?: string;
	error?: { code?: number };
	details?: { phase?: string; eventsEmitted?: boolean };
} {
	return typeof value === "object" && value !== null;
}
