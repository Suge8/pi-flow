import { monitorDetailsHint } from "../../shared/ui-language.js";
import type { FlowState } from "../types.js";
import { flowCommandId } from "../util.js";

export function parallelConsoleSessionName(
	flow: Pick<FlowState, "id" | "language">,
	goalIndexes: readonly number[],
) {
	const suffix = flow.language === "en" ? "parallel console" : "并行控制台";
	return `${flowCommandId(flow.id)}-${parallelGoalLabel(goalIndexes)} ${suffix}`;
}

export function parallelConsoleCommandHint(
	flow: Pick<FlowState, "id" | "language">,
) {
	const id = flowCommandId(flow.id);
	return flow.language === "en"
		? `${quoteCommand(`/flow stop ${id}`)} pause · ${quoteCommand(`/flow go ${id}`)} continue · ${monitorDetailsHint(flow.language)}`
		: `${quoteCommand(`/flow stop ${id}`)}暂停 · ${quoteCommand(`/flow go ${id}`)}继续 · ${monitorDetailsHint(flow.language)}`;
}

export function parallelConsoleInputNotice(
	flow: Pick<FlowState, "id" | "language">,
) {
	const id = flowCommandId(flow.id);
	return flow.language === "en"
		? `Console only accepts ${quoteCommand(`/flow go ${id}`)} or ${quoteCommand(`/flow stop ${id}`)}`
		: `控制台只允许${quoteCommand(`/flow go ${id}`)}或${quoteCommand(`/flow stop ${id}`)}`;
}

export function isAllowedParallelConsoleInput(
	text: string,
	flow: Pick<FlowState, "id">,
) {
	const normalized = text.trim().replace(/\s+/gu, " ");
	const id = flowCommandId(flow.id);
	return normalized === `/flow go ${id}` || normalized === `/flow stop ${id}`;
}

export function quoteCommand(command: string) {
	return `「${command}」`;
}

function parallelGoalLabel(goalIndexes: readonly number[]) {
	const labels = goalIndexes.map((index) => `G${index + 1}`);
	const visible = labels.length > 4 ? [...labels.slice(0, 3), "…"] : labels;
	return visible.join("+");
}
