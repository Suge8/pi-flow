import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./guards.js";

export function currentSessionFile(ctx: { sessionManager?: unknown }) {
	const sessionManager = ctx.sessionManager as
		| { getSessionFile?: () => string | undefined }
		| undefined;
	return sessionManager?.getSessionFile?.();
}

export function sessionEntries(ctx: {
	sessionManager?: unknown;
}): SessionEntry[] {
	if (!isRecord(ctx.sessionManager)) return [];
	const getBranch = ctx.sessionManager.getBranch;
	if (typeof getBranch !== "function") return [];
	const entries = getBranch.call(ctx.sessionManager);
	return Array.isArray(entries) ? (entries as SessionEntry[]) : [];
}

/** 当前会话 leaf entry id；空会话或不支持时 undefined。 */
export function sessionLeafId(ctx: { sessionManager?: unknown }) {
	const sessionManager = ctx.sessionManager as
		| { getLeafId?: () => string | null }
		| undefined;
	return sessionManager?.getLeafId?.() ?? undefined;
}

/** 锚点之后的会话 entries；无锚点或锚点不在当前分支时返回全量。
 * 用于 fork 会话：验收/质检/顾问证据只取执行段，不吃计划期前缀。 */
export function sessionEntriesSince(
	ctx: { sessionManager?: unknown },
	anchorId: string | undefined,
): SessionEntry[] {
	const entries = sessionEntries(ctx);
	if (!anchorId) return entries;
	const anchorIndex = entries.findIndex((entry) => entry.id === anchorId);
	return anchorIndex >= 0 ? entries.slice(anchorIndex + 1) : entries;
}

/** 提取消息 content 的纯文本（string 或 text part 数组）。 */
export function assistantMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) =>
			typeof item === "object" && item && "text" in item
				? String((item as { text: unknown }).text)
				: "",
		)
		.join("\n");
}

/** 取事件消息中最后一条 assistant 回复的文本；无则空串。 */
export function finalAssistantText(messages: unknown[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message || typeof message !== "object") continue;
		const candidate = message as { role?: unknown; content?: unknown };
		if (candidate.role === "assistant")
			return assistantMessageText(candidate.content);
	}
	return "";
}
