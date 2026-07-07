import {
	generationAlignmentSummary,
	startGenerationLabel,
} from "../../shared/generation-alignment.js";
import type { AlignmentState } from "../../shared/generation-state.js";
import { flowStepLabel } from "../../shared/progress-labels.js";
import type { FlowState } from "../types.js";
import { clip, flowCommandId } from "../util.js";
import { flowStatusLabel, goalStatusLabel } from "./shared.js";

export function statusText(flow: FlowState, alignment?: AlignmentState) {
	const label = statusLabels(flow.language);
	const status = flowStatusLabel(flow.status, flow.language);
	const lines = [
		`Flow: ${flow.id}`,
		`${label.title}: ${flow.title}`,
		`${label.state}: ${status}`,
		`${label.current}: ${currentStatus(flow, alignment, label.none)}`,
		`${label.next}: ${nextHint(flow, alignment)}`,
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
	if (flow.status === "cancelled")
		return flow.language === "en" ? "none" : "无";
	if (!alignment)
		return flow.language === "en" ? "generation state missing" : "缺少生成状态";
	return generationAlignmentSummary(
		alignment.stage,
		flow.language,
		alignment.alignmentTurns.length + 1,
	);
}

function currentQuestion(
	flow: FlowState,
	alignment: AlignmentState | undefined,
) {
	if (!isPreDraftFlow(flow) || flow.status === "cancelled") return undefined;
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

function nextHint(flow: FlowState, alignment?: AlignmentState) {
	const id = flowCommandId(flow.id);
	if (flow.status === "draft") return `/flow start ${id}`;
	if (flow.status === "running") return `/flow continue ${id}`;
	if (flow.status === "aligning" || flow.status === "generating")
		return preDraftNextHint(flow, alignment, id);
	return `/flow status ${id}`;
}

function preDraftNextHint(
	flow: FlowState,
	alignment: AlignmentState | undefined,
	id: string,
) {
	if (alignment?.stage === "awaiting_alignment_input")
		return flow.language === "en"
			? `reply or /flow continue ${id}`
			: `直接回复或 /flow continue ${id}`;
	if (alignment?.stage === "awaiting_final_confirm") {
		const start = startGenerationLabel(flow.language);
		return flow.language === "en"
			? `reply “${start}” or /flow continue ${id}`
			: `回复「${start}」或 /flow continue ${id}`;
	}
	if (alignment?.stage === "awaiting_blocking_input")
		return flow.language === "en"
			? `reply with input or /flow continue ${id}`
			: `直接回复补充信息或 /flow continue ${id}`;
	return `/flow continue ${id}`;
}

function isPreDraftFlow(flow: FlowState) {
	return (
		flow.goals.length === 0 &&
		(flow.status === "aligning" ||
			flow.status === "generating" ||
			flow.status === "cancelled")
	);
}
