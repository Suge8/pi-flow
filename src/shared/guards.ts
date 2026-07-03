export function formatError(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}
