import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { flowOwnerForSession } from "../flow/ownership.js";
import { tokenize } from "../flow/util.js";
import { generationStartOptions } from "../shared/generation-alignment.js";
import { formatError } from "../shared/guards.js";
import { startGoalFromFile, startGoalGeneration } from "./generation.js";
import type { StatusContext } from "./runtime.js";

export interface GoalCommand {
	kind: "draft" | "show" | "start" | "pause" | "continue" | "cancel";
	id?: string;
	path?: string;
	prompt?: string;
	tokenBudget?: number;
}

export interface GoalCommandActions {
	show: (ctx: StatusContext, id: string | undefined) => void | Promise<void>;
	pause: (ctx: StatusContext) => void;
	continue: (pi: ExtensionAPI, ctx: StatusContext) => Promise<void>;
	cancel: (ctx: StatusContext) => void;
	startFromDraft: (
		id: string | undefined,
		pi: ExtensionAPI,
		ctx: StatusContext,
	) => Promise<undefined | boolean>;
}

export async function handleGoalCommand(
	pi: ExtensionAPI,
	args: string,
	ctx: StatusContext,
	actions: GoalCommandActions,
): Promise<void> {
	const result = parseCommand(args);
	if (typeof result === "string") return ctx.ui.notify(result, "warning");
	const ownershipError = goalOwnershipError(result.kind, ctx);
	if (ownershipError) return ctx.ui.notify(ownershipError, "warning");
	if (result.kind === "draft") {
		const commandCtx = ctx as ExtensionCommandContext;
		const options = await generationStartOptions(commandCtx);
		if (!options) return;
		if (result.path && isFile(ctx.cwd, result.path))
			return startGoalFromFile(pi, commandCtx, [result.path], options);
		return startGoalGeneration(
			pi,
			commandCtx,
			result.prompt ?? "",
			result.prompt ? "prompt" : "conversation",
			undefined,
			options,
		);
	}
	if (result.kind === "show") return actions.show(ctx, result.id);
	if (result.kind === "pause") return actions.pause(ctx);
	if (result.kind === "continue") return actions.continue(pi, ctx);
	if (result.kind === "cancel") return actions.cancel(ctx);
	await actions.startFromDraft(result.id, pi, ctx);
}

export function parseCommand(args: string): GoalCommand | string {
	const tokens = tokenize(args.trim());
	const trimmed = args.trim();
	if (tokens.length === 0) return { kind: "draft" };
	const [first, ...rest] = tokens;
	if (first === "start")
		return rest.length <= 1
			? { kind: "start", id: rest[0] }
			: "用法：/goal start [id]";
	if (first === "pause")
		return rest.length === 0 ? { kind: "pause" } : "用法：/goal pause";
	if (first === "continue")
		return rest.length === 0 ? { kind: "continue" } : "用法：/goal continue";
	if (first === "cancel")
		return rest.length === 0 ? { kind: "cancel" } : "用法：/goal cancel";
	if (first === "status")
		return rest.length <= 1
			? { kind: "show", id: rest[0] }
			: "用法：/goal status [id]";
	return {
		kind: "draft",
		prompt: trimmed,
		path: tokens.length === 1 ? first : undefined,
	};
}

function goalOwnershipError(kind: GoalCommand["kind"], ctx: StatusContext) {
	if (kind === "show") return undefined;
	let owner: ReturnType<typeof flowOwnerForSession>;
	try {
		owner = flowOwnerForSession(ctx);
	} catch (error) {
		return `Flow 状态读取失败：${notifyError(error)}。为避免破坏 Flow 的会话，/goal ${kind} 已停止。`;
	}
	if (!owner) return undefined;
	return `当前会话属于 Flow ${owner.flow.id}；/goal ${kind} 被禁止。用 /flow continue 或 /flow cancel。/goal status 可用。`;
}

function isFile(cwd: string, path: string) {
	try {
		return lstatSync(resolve(cwd, path)).isFile();
	} catch {
		return false;
	}
}

function notifyError(error: unknown) {
	return truncateNotification(formatError(error));
}

function truncateNotification(value: string) {
	return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}
