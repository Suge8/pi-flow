import { flowStepLabel } from "../../shared/progress-labels.js";
import type { FlowState } from "../types.js";
import { clip, flowCommandId } from "../util.js";
import { flowStatusLabel, goalStatusLabel } from "./shared.js";

export function statusText(flow: FlowState) {
	const label = statusLabels(flow.language);
	const status = flowStatusLabel(flow.status, flow.language);
	const lines = [
		`Flow: ${flow.id}`,
		`${label.title}: ${flow.title}`,
		`${label.state}: ${status}`,
		`${label.current}: ${currentGoalTitle(flow, label.none)}`,
		`${label.next}: ${nextHint(flow)}`,
	];
	for (const goal of flow.goals) {
		lines.push(
			`${flowStepLabel(goal.index, goal.title, flow.language)} · ${goalStatusLabel(goal.status, flow.language)}\n  ${label.planFile}: ${goal.file}\n  ${label.session}: ${sessionLabel(goal, flow.language)}\n  ${label.handoff}: ${clip(goal.result.handoff ?? "-", 180)}`,
		);
	}
	if (flow.errors.length)
		lines.push(`${label.errors}:\n${flow.errors.join("\n")}`);
	return lines.join("\n");
}

function currentGoalTitle(flow: FlowState, fallback: string) {
	const indexes = flow.parallelRun?.goalIndexes ?? [flow.currentGoal];
	const titles = indexes.flatMap((index) => {
		const title = flow.goals[index]?.title;
		return title ? [title] : [];
	});
	return titles.length
		? titles.join(flow.language === "en" ? ", " : "、")
		: fallback;
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
				errors: "错误",
				none: "无",
			};
}

function nextHint(flow: FlowState) {
	const id = flowCommandId(flow.id);
	if (flow.status === "draft") return `/flow start ${id}`;
	if (flow.status === "running") return `/flow continue ${id}`;
	return `/flow status ${id}`;
}
