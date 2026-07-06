import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FlowSourceType } from "../flow/types.js";
import { setFlowActivity, setGoalActivityBox } from "./activity-frame.js";
import type { Language } from "./config.js";
import {
	type AlignmentTurn,
	extractAlignmentQuestion,
	type GenerationStage,
} from "./generation-alignment.js";
import { currentSessionFile } from "./session.js";

export interface PendingGenerationBase {
	key: string;
	cwd: string;
	originalRequest: string;
	sourceType: FlowSourceType;
	sourcePath?: string;
	language: Language;
	beforeIds: string[];
	attempts: number;
	stage: GenerationStage;
	awaitingClarification: boolean;
	lastClarification?: string;
	alignmentTurns?: AlignmentTurn[];
	lastAlignmentQuestion?: string;
	autoStart?: boolean;
}

export function generationKey(ctx: { cwd: string; sessionManager?: unknown }) {
	return currentSessionFile(ctx) ?? `${ctx.cwd}:no-session`;
}

export function hasPendingGenerationInCwd<T extends { cwd: string }>(
	pendingGenerations: Map<string, T>,
	cwd: string,
) {
	return [...pendingGenerations.values()].some(
		(pending) => pending.cwd === cwd,
	);
}

export function appendGenerationClarification(
	originalRequest: string,
	clarification: string,
	language: Language = "zh",
) {
	const base =
		originalRequest.trim() ||
		(language === "en"
			? "(user did not provide an initial request)"
			: "（用户未给出初始需求）");
	if (base.includes(clarification.trim())) return base;
	const label = language === "en" ? "User addition" : "用户补充";
	const separator = language === "en" ? ":" : "：";
	return `${base}\n\n${label}${separator}\n${clarification}`;
}

export function rememberAlignmentQuestion(
	pending: PendingGenerationBase,
	assistantText: string,
) {
	const question = extractAlignmentQuestion(assistantText);
	if (question) pending.lastAlignmentQuestion = question;
}

export function appendAlignmentAnswer(
	pending: PendingGenerationBase,
	answer: string,
) {
	const question =
		pending.lastAlignmentQuestion ??
		(pending.language === "en" ? "User addition" : "用户补充");
	pending.alignmentTurns = [
		...(pending.alignmentTurns ?? []),
		{ question, answer },
	];
	pending.lastAlignmentQuestion = undefined;
}

export function generationDraftBox(
	title: string,
	rows: string | string[] = [],
) {
	const normalizedRows = Array.isArray(rows) ? rows : [rows];
	return {
		title,
		rows: separateRows(normalizedRows),
		compact: true,
	};
}

function separateRows(rows: string[]) {
	return rows.flatMap((row, index) => (index === 0 ? [row] : ["", row]));
}

export function finishPendingGeneration<T extends { key: string }>(input: {
	pendingGenerations: Map<string, T>;
	pending: T | undefined;
	activityId: string;
	ctx?: Pick<ExtensionContext, "ui">;
	clearActivityBox?: boolean;
}) {
	if (input.pending) input.pendingGenerations.delete(input.pending.key);
	if (input.pendingGenerations.size === 0) {
		setFlowActivity("goal", false, input.activityId);
		if (input.ctx && input.clearActivityBox !== false)
			setGoalActivityBox(input.ctx, undefined);
	}
}
