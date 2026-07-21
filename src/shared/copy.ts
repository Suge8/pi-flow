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
	request: string;
	validationErrors: string;
	completionAcceptance: string;
	completionAcceptanceHint: string;
	qualityCheck: string;
	qualityCheckHint: string;
	disabled: string;
	accepting: string;
	checking: string;
	completing: string;
	optimizing: string;
	waiting: string;
	noDetailedOutput: string;
	themeToLight: string;
	themeToDark: string;
	draftStatus: string;
	aligningStatus: string;
	generatingStatus: string;
	passed: string;
	failed: string;
	error: string;
	model: string;
	deliveryDetails: string;
	reportDirectoryTitle: string;
	reportDirectoryHint: string;
	reportDirectoryLive: string;
	reportDirectoryRecent: string;
	completionTitle: (total: number) => string;
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
	successCriteria: "验收标准",
	verification: "怎么验证",
	notes: "备注",
	debug: "调试",
	planId: "计划 ID",
	source: "来源",
	updatedAt: "更新时间",
	request: "原始需求",
	validationErrors: "校验错误",
	completionAcceptance: "验收",
	completionAcceptanceHint: "确保目标完整完成",
	qualityCheck: "质检",
	qualityCheckHint: "把关实现质量",
	disabled: "未启用",
	accepting: "验收中",
	checking: "质检中",
	completing: "补完中",
	optimizing: "优化中",
	waiting: "等待",
	noDetailedOutput: "暂无详细输出",
	themeToLight: "切换到浅色",
	themeToDark: "切换到深色",
	draftStatus: "待启动",
	aligningStatus: "对齐中",
	generatingStatus: "生成中",
	passed: "已通过",
	failed: "未通过",
	error: "错误",
	model: "模型",
	deliveryDetails: "交付详情",
	reportDirectoryTitle: "报告目录",
	reportDirectoryHint: "进行中与最近由插件上报的报告；点选后进入详情",
	reportDirectoryLive: "Live",
	reportDirectoryRecent: "Recent",
	completionTitle: (total) => `全部完成 · ${total} 步`,
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
	request: "Original request",
	validationErrors: "Validation errors",
	completionAcceptance: "Acceptance",
	completionAcceptanceHint: "Verify the goal is complete",
	qualityCheck: "Quality check",
	qualityCheckHint: "Review implementation quality",
	disabled: "Disabled",
	accepting: "Accepting",
	checking: "Checking",
	completing: "Completing",
	optimizing: "Optimizing",
	waiting: "Waiting",
	noDetailedOutput: "No detailed output",
	themeToLight: "Switch to light",
	themeToDark: "Switch to dark",
	draftStatus: "Ready to start",
	aligningStatus: "Aligning",
	generatingStatus: "Generating",
	passed: "Passed",
	failed: "Failed",
	error: "Error",
	model: "Model",
	deliveryDetails: "Delivery details",
	reportDirectoryTitle: "Report directory",
	reportDirectoryHint:
		"Live and recent reports registered by the plugin; open one to view details",
	reportDirectoryLive: "Live",
	reportDirectoryRecent: "Recent",
	completionTitle: (total) =>
		`All complete · ${total} ${total === 1 ? "step" : "steps"}`,
	flowWaitingStart: (total) => `${total} steps, waiting to start`,
	flowRunningStep: (label) => `Running ${label}`,
	goalProgressCaption: (done, total, passed, checks) =>
		`Tasks ${done}/${total} · checks ${passed}/${checks}`,
	stepsDoneCaption: (done, total) => `${done}/${total} steps complete`,
};

export function copy(language: Language): UiCopy {
	return language === "en" ? EN : ZH;
}
