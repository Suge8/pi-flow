import type { Language } from "./config.js";

export interface UiCopy {
	htmlLang: string;
	goal: string;
	flow: string;
	draftGoal: string;
	running: string;
	completed: string;
	paused: string;
	budgetLimited: string;
	pending: string;
	blocked: string;
	active: string;
	todo: string;
	done: string;
	details: string;
	detail: string;
	scope: string;
	checklist: string;
	outcome: string;
	fullDetails: string;
	completionStandards: string;
	successCriteria: string;
	verification: string;
	notes: string;
	debug: string;
	planId: string;
	source: string;
	updatedAt: string;
	originalRequest: string;
	validationErrors: string;
	completionAcceptance: string;
	completionAcceptanceHint: string;
	qualityCheck: string;
	qualityCheckHint: string;
	disabled: string;
	checking: string;
	waiting: string;
	passed: string;
	failed: string;
	error: string;
	model: string;
	allStepsDone: (total: number) => string;
	flowWaitingStart: (total: number) => string;
	flowRunningStep: (label: string) => string;
	goalProgressCaption: (
		done: number,
		total: number,
		passed: number,
		checks: number,
	) => string;
	stepsDoneCaption: (done: number, total: number) => string;
}

const ZH: UiCopy = {
	htmlLang: "zh-CN",
	goal: "目标",
	flow: "Flow",
	draftGoal: "单任务计划",
	running: "执行中",
	completed: "已完成",
	paused: "已暂停",
	budgetLimited: "预算受限",
	pending: "待执行",
	blocked: "阻塞",
	active: "进行中",
	todo: "待做",
	done: "完成",
	details: "详情",
	detail: "细节",
	scope: "范围",
	checklist: "任务清单",
	outcome: "成果",
	fullDetails: "完整说明",
	completionStandards: "完成标准与验证",
	successCriteria: "怎么算完成",
	verification: "怎么验证",
	notes: "备注",
	debug: "调试",
	planId: "计划 ID",
	source: "来源",
	updatedAt: "更新时间",
	originalRequest: "原始需求",
	validationErrors: "校验错误",
	completionAcceptance: "完成验收",
	completionAcceptanceHint: "确保目标完整完成",
	qualityCheck: "质量检查",
	qualityCheckHint: "把关实现质量",
	disabled: "未启用",
	checking: "检查中",
	waiting: "等待",
	passed: "已通过",
	failed: "未通过",
	error: "错误",
	model: "模型",
	allStepsDone: (total) => `全部 ${total} 步已完成`,
	flowWaitingStart: (total) => `共 ${total} 步，等待启动`,
	flowRunningStep: (label) => `正在执行${label}`,
	goalProgressCaption: (done, total, passed, checks) =>
		`任务 ${done}/${total} · 检查 ${passed}/${checks}`,
	stepsDoneCaption: (done, total) => `${done}/${total} 步完成`,
};

const EN: UiCopy = {
	htmlLang: "en",
	goal: "Goal",
	flow: "Flow",
	draftGoal: "Single-goal plan",
	running: "Running",
	completed: "Complete",
	paused: "Paused",
	budgetLimited: "Budget limited",
	pending: "Pending",
	blocked: "Blocked",
	active: "In progress",
	todo: "Todo",
	done: "Done",
	details: "Details",
	detail: "Detail",
	scope: "Scope",
	checklist: "Checklist",
	outcome: "Outcome",
	fullDetails: "Full details",
	completionStandards: "Completion standards and verification",
	successCriteria: "Success criteria",
	verification: "Verification",
	notes: "Notes",
	debug: "Debug",
	planId: "Plan ID",
	source: "Source",
	updatedAt: "Updated at",
	originalRequest: "Original request",
	validationErrors: "Validation errors",
	completionAcceptance: "Completion acceptance",
	completionAcceptanceHint: "Verify the goal is complete",
	qualityCheck: "Quality check",
	qualityCheckHint: "Review implementation quality",
	disabled: "Disabled",
	checking: "Checking",
	waiting: "Waiting",
	passed: "Passed",
	failed: "Failed",
	error: "Error",
	model: "Model",
	allStepsDone: (total) => `All ${total} steps complete`,
	flowWaitingStart: (total) => `${total} steps, waiting to start`,
	flowRunningStep: (label) => `Running ${label}`,
	goalProgressCaption: (done, total, passed, checks) =>
		`Tasks ${done}/${total} · checks ${passed}/${checks}`,
	stepsDoneCaption: (done, total) => `${done}/${total} steps complete`,
};

export function copy(language: Language): UiCopy {
	return language === "en" ? EN : ZH;
}
