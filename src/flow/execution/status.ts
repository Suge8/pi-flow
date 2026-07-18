import { generationAlignmentSummary } from "../../shared/generation-alignment.js";
import type { AlignmentState } from "../../shared/generation-state.js";
import { flowStepLabel } from "../../shared/progress-labels.js";
import { quoteCommand } from "../parallel/console.js";
import type { FlowState } from "../types.js";
import { clip, flowCommandId } from "../util.js";
import { flowStatusLabel, goalStatusLabel } from "./shared.js";

export function statusText(flow: FlowState, alignment?: AlignmentState) {
	const label = statusLabels(flow.language);
	const status = displayStatus(flow, alignment);
	const lines = [
		`Flow: ${flow.id}`,
		`${label.title}: ${flow.title}`,
		`${label.state}: ${status}`,
		`${label.current}: ${currentStatus(flow, alignment, label.none)}`,
		`${label.next}: ${nextHint(flow)}`,
	];
	const question = currentQuestion(flow, alignment);
	if (question) lines.push(`${label.question}: ${clip(question, 180)}`);
	for (const goal of flow.goals) {
		lines.push(
			`${flowStepLabel(goal.index, goal.title, flow.language)} · ${goalStatusLabel(goal.status, flow.language)}\n  ${label.planFile}: ${goal.file}\n  ${label.session}: ${sessionLabel(goal, flow.language)}\n  ${label.handoff}: ${clip(goal.result.handoff ?? "-", 180)}`,
		);
	}
	if (flow.errors.length)
		lines.push(`${label.errors}:\n${flow.errors.join("\n")}`);
	return lines.join("\n");
}

function displayStatus(flow: FlowState, alignment: AlignmentState | undefined) {
	if (isPreDraftFlow(flow) && flow.status !== "paused" && alignment)
		return preDraftStatusLabel(alignment.stage, flow.language);
	return flowStatusLabel(flow.status, flow.language);
}

function preDraftStatusLabel(
	stage: AlignmentState["stage"],
	language: FlowState["language"],
) {
	if (stage === "awaiting_alignment_input")
		return language === "en" ? "Waiting for reply" : "等待回复";
	if (stage === "awaiting_final_confirm")
		return language === "en" ? "Ready to draft" : "等待确认";
	if (stage === "awaiting_blocking_input")
		return language === "en" ? "Waiting for input" : "等待补充";
	if (stage === "aligning") return language === "en" ? "Aligning" : "对齐中";
	return language === "en" ? "Generating" : "生成中";
}

function currentStatus(
	flow: FlowState,
	alignment: AlignmentState | undefined,
	fallback: string,
) {
	if (isPreDraftFlow(flow)) return preDraftCurrentStatus(flow, alignment);
	const indexes = flow.parallelRun?.goalIndexes ?? [flow.currentGoal];
	const titles = indexes.flatMap((index) => {
		const title = flow.goals[index]?.title;
		return title ? [title] : [];
	});
	return titles.length
		? titles.join(flow.language === "en" ? ", " : "、")
		: fallback;
}

function preDraftCurrentStatus(
	flow: FlowState,
	alignment: AlignmentState | undefined,
) {
	if (!alignment)
		return flow.language === "en" ? "generation state missing" : "缺少生成状态";
	return generationAlignmentSummary(
		alignment.stage,
		flow.language,
		alignment.alignmentTurns.length + 1,
		quoteCommand(`/flow go ${flowCommandId(flow.id)}`),
		alignment.depth,
	);
}

function currentQuestion(
	flow: FlowState,
	alignment: AlignmentState | undefined,
) {
	if (!isPreDraftFlow(flow)) return undefined;
	return alignment?.lastAlignmentQuestion ?? undefined;
}

function sessionLabel(
	goal: FlowState["goals"][number],
	language: FlowState["language"],
) {
	if (!goal.sessionFile) return language === "en" ? "not started" : "尚未启动";
	return goal.sessionName || (language === "en" ? "started" : "已启动");
}

function statusLabels(language: FlowState["language"]) {
	return language === "en"
		? {
				title: "Title",
				state: "Status",
				current: "Current",
				next: "Next",
				planFile: "Plan file",
				session: "Session",
				handoff: "Handoff",
				question: "Question",
				errors: "Errors",
				none: "none",
			}
		: {
				title: "标题",
				state: "状态",
				current: "当前",
				next: "下一步",
				planFile: "计划文件",
				session: "会话",
				handoff: "交接",
				question: "问题",
				errors: "错误",
				none: "无",
			};
}

function nextHint(flow: FlowState) {
	const id = flowCommandId(flow.id);
	if (flow.status === "draft") return quoteCommand(`/flow go ${id}`);
	if (flow.status === "paused") return quoteCommand(`/flow go ${id}`);
	if (flow.status === "running") return quoteCommand(`/flow go ${id}`);
	if (flow.status === "aligning" || flow.status === "generating")
		return preDraftNextHint(id);
	return quoteCommand(`/flow go ${id}`);
}

function preDraftNextHint(id: string) {
	return quoteCommand(`/flow go ${id}`);
}

function isPreDraftFlow(flow: FlowState) {
	return (
		flow.goals.length === 0 &&
		(flow.status === "aligning" ||
			flow.status === "generating" ||
			flow.status === "paused")
	);
}
