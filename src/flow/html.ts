import { writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { planSection, stepsText, verificationText } from "../plan/markdown.js";
import { parseSteps } from "../plan/view.js";
import { copy } from "../shared/copy.js";
import { clipText, renderMarkdownBlock } from "../shared/html-markdown.js";
import { flowStepLabel } from "../shared/progress-labels.js";
import {
	brandHeader,
	card,
	debugList,
	detailsCard,
	errorCard,
	errorPage,
	escapeHtml,
	hero,
	pageShell,
	seal,
	subSection,
	TONE_TEXT,
	type Tone,
} from "../shared/report-blocks.js";
import { readReportText } from "../shared/report-html.js";
import { reportIcon } from "../shared/report-icons.js";
import { checkPhases, pendingChecks } from "../shared/report-review.js";
import { notifyReportChanged } from "../shared/report-server.js";
import { stepList } from "../shared/report-steps.js";
import type { FlowGoal, FlowState } from "./types.js";
import { flowCommandId } from "./util.js";

export function writeFlowHtml(dir: string, flow: FlowState) {
	const htmlPath = join(dir, "flow.html");
	writeFileSync(htmlPath, renderFlowHtml(dir, flow));
	notifyReportChanged(htmlPath);
	return htmlPath;
}

export function writeFlowErrorHtml(
	dir: string,
	input: {
		title: string;
		errors: string[];
		originalRequest?: string;
		language?: FlowState["language"];
	},
) {
	const htmlPath = join(dir, "flow.html");
	writeFileSync(
		htmlPath,
		errorPage({
			pageTitle: `Flow — ${input.title}`,
			kindLabel:
				input.language === "en" ? "Flow validation errors" : "Flow 校验错误",
			...input,
		}),
	);
	notifyReportChanged(htmlPath);
	return htmlPath;
}

function flowTone(status: FlowState["status"]): Tone {
	if (status === "running") return "blue";
	if (status === "complete") return "green";
	if (status === "cancelled") return "red";
	return "gray";
}

function goalStatus(
	language: FlowState["language"],
): Record<string, { label: string; tone: Tone }> {
	const t = copy(language);
	return {
		pending: { label: t.pending, tone: "gray" },
		running: { label: t.running, tone: "blue" },
		complete: { label: t.completed, tone: "green" },
	};
}

export function renderFlowHtml(dir: string, flow: FlowState) {
	const t = copy(flow.language);
	const complete = flow.goals.filter(
		(goal) => goal.status === "complete",
	).length;
	const total = flow.goals.length;
	const statusTone = flowTone(flow.status);
	return pageShell(
		`Flow — ${flow.title}`,
		[
			brandHeader(),
			hero({
				title: flow.title,
				subtitle: heroSubtitle(flow, total),
				percent: total === 0 ? 0 : Math.round((complete / total) * 100),
				tone: statusTone,
				caption: t.stepsDoneCaption(complete, total),
				commands: nextCommands(flow),
			}),
			flow.errors.length ? errorCard(flow.errors, flow.language) : "",
			flow.status === "complete" ? completionCard(flow) : "",
			stepperCard(flow),
			flow.goals.map((goal) => goalCard(dir, goal, flow)).join("\n"),
			contextDetails(dir, flow),
		]
			.filter(Boolean)
			.join("\n"),
		{ language: flow.language, width: "max-w-7xl" },
	);
}

function heroSubtitle(flow: FlowState, total: number) {
	const t = copy(flow.language);
	if (flow.status === "complete") return t.allStepsDone(total);
	if (flow.status === "cancelled") return t.cancelled;
	const current = flow.goals[flow.currentGoal];
	if (flow.status === "running" && current)
		return t.flowRunningStep(
			flowStepLabel(current.index, current.title, flow.language),
		);
	return t.flowWaitingStart(total);
}

function stepperCard(flow: FlowState) {
	const currentIndexes = currentFlowGoalIndexes(flow);
	const parts: string[] = [];
	flow.goals.forEach((goal, index) => {
		if (index > 0) {
			parts.push(
				`<span data-rough-line data-tone="${stepperLineTone(flow, index, currentIndexes)}" class="mt-[18px] h-1 min-w-5 flex-1"></span>`,
			);
		}
		parts.push(stepNode(goal, flow, currentIndexes));
	});
	return card(
		`<div class="flex items-start overflow-x-auto pb-1">${parts.join("")}</div>`,
	);
}

function stepperLineTone(
	flow: FlowState,
	index: number,
	currentIndexes: Set<number>,
): Tone {
	if (hasParallelRun(flow) && isCurrentGoal(flow.goals[index], currentIndexes))
		return "blue";
	return flow.goals[index - 1].status === "complete" ? "green" : "gray";
}

function stepNode(
	goal: FlowGoal,
	flow: FlowState,
	currentIndexes: Set<number>,
) {
	const tone = goalTone(goal, flow.language);
	const isCurrent = isCurrentGoal(goal, currentIndexes);
	const deviation = goal.result.criteriaChanged
		? '<span class="absolute -right-1.5 -top-1.5 text-[10px] font-bold text-amber-700">▲</span>'
		: "";
	return `<a href="#goal-${goal.index}" class="flex w-20 shrink-0 flex-col items-center gap-1.5">
<span class="relative">${goalNode(goal, tone)}${deviation}</span>
<span class="line-clamp-2 text-center text-[11px] leading-tight ${isCurrent ? "font-semibold text-stone-800" : "text-stone-500"}">${escapeHtml(clipText(goal.title, 24))}</span>
</a>`;
}

function goalNode(goal: FlowGoal, tone: Tone) {
	const fill = goal.status === "complete" ? ' data-fill="solid"' : "";
	const glyph = goalGlyph(goal);
	return `<span data-rough-node data-tone="${tone}"${fill} class="grid h-9 w-9 place-items-center text-xs font-bold ${TONE_TEXT[tone]}">${glyph}</span>`;
}

function goalGlyph(goal: FlowGoal) {
	if (goal.status === "complete") return reportIcon("check", "h-5 w-5");
	if (goal.role === "final_acceptance") return reportIcon("flag", "h-5 w-5");
	return String(goal.index + 1);
}

function goalTone(goal: FlowGoal, language: FlowState["language"]): Tone {
	return goalStatus(language)[goal.status]?.tone ?? "gray";
}

function currentFlowGoalIndexes(flow: FlowState) {
	return new Set(
		hasParallelRun(flow) ? flow.parallelRun.goalIndexes : [flow.currentGoal],
	);
}

function hasParallelRun(
	flow: FlowState,
): flow is FlowState & { parallelRun: NonNullable<FlowState["parallelRun"]> } {
	return (flow.parallelRun?.goalIndexes.length ?? 0) > 0;
}

function isCurrentGoal(goal: FlowGoal, currentIndexes: Set<number>) {
	return currentIndexes.has(goal.index) && goal.status !== "complete";
}

function goalCard(dir: string, goal: FlowGoal, flow: FlowState) {
	const isCurrent = isCurrentGoal(goal, currentFlowGoalIndexes(flow));
	const status = goalStatus(flow.language)[goal.status] ?? {
		label: goal.status,
		tone: "gray" as Tone,
	};
	const kind =
		goal.role === "final_acceptance"
			? flow.language === "en"
				? "Final acceptance"
				: "最终验收"
			: flowStepLabel(goal.index, goal.title, flow.language);
	const markdown = readReportText(join(dir, goal.file));
	return `<article id="goal-${goal.index}" data-rough-card${isCurrent ? ' data-tone="blue"' : ""} class="bg-white p-5">
<div class="flex items-start justify-between gap-3">
<div class="flex min-w-0 items-center gap-3">
${goalNode(goal, status.tone)}
<div class="min-w-0">
<p class="text-[11px] text-stone-400">${kind}${isCurrent ? ` · ${flow.language === "en" ? "Current" : "当前"}` : ""}</p>
<h2 class="truncate text-base font-semibold text-stone-900">${escapeHtml(goal.title)}</h2>
</div>
</div>
${goal.status === "complete" ? "" : seal(status.label, status.tone)}
</div>
<div class="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
<div class="min-w-0">
${goalStepList(markdown, goal, isCurrent, flow.language)}
${handoffBlock(goal, flow.language)}
${goalDetails(goal, markdown, flow.language)}
</div>
<aside class="space-y-4 xl:sticky xl:top-6">
${goalReviewBlock(goal, flow.language, hasFinalAcceptance(flow))}
</aside>
</div>
</article>`;
}

function goalStepList(
	markdown: string,
	goal: FlowGoal,
	isCurrent: boolean,
	language: FlowState["language"],
) {
	const steps = parseSteps(stepsText(markdown));
	return stepList(steps, {
		keyPrefix: `g${goal.index}-step`,
		expandCurrent: isCurrent,
		language,
	});
}

function goalReviewBlock(
	goal: FlowGoal,
	language: FlowState["language"],
	finalAcceptance: boolean,
) {
	const checks =
		goal.checks ?? (goal.status === "complete" ? null : pendingChecks());
	const chips = deviationChips(goal, language, finalAcceptance);
	if (!checks)
		return `<div data-rough-card data-tone="green" class="bg-emerald-50/50 p-4"><div class="flex flex-wrap items-center gap-2"><span${goal.result.summary ? ` title="${escapeHtml(clipText(goal.result.summary, 200))}"` : ""} class="inline-flex items-center gap-1 text-xs font-medium text-emerald-800">${reportIcon("check-circle", "h-4 w-4")} ${language === "en" ? "Checks passed" : "检查通过"}</span>${chips}</div></div>`;
	return `<div class="space-y-3">${checkPhases(checks, `g${goal.index + 1}`, language)}${chips ? `<div class="flex flex-wrap items-center gap-3">${chips}</div>` : ""}</div>`;
}

function deviationChips(
	goal: FlowGoal,
	language: FlowState["language"],
	finalAcceptance: boolean,
) {
	if (goal.status !== "complete") return "";
	const chips: string[] = [];
	if (goal.result.criteriaChanged)
		chips.push(
			`<span class="text-xs font-medium text-amber-800">▲ ${criteriaDeviationText(language, finalAcceptance)}</span>`,
		);
	if (goal.result.handoffGenerated)
		chips.push(
			`<span class="text-xs text-stone-400">${language === "en" ? "Handoff was generated automatically" : "交接为自动生成"}</span>`,
		);
	return chips.join("");
}

function handoffBlock(goal: FlowGoal, language: FlowState["language"]) {
	if (goal.status !== "complete" || !goal.result.handoff) return "";
	const label = language === "en" ? "Handoff to next step" : "交接给下一步";
	return `<details data-key="g${goal.index}-handoff" class="mt-3">${labeledSummary(label, "arrow-right")}${renderMarkdownBlock(clipText(goal.result.handoff, 1200), "mt-2 space-y-2 text-sm leading-6 text-stone-600")}</details>`;
}

function labeledSummary(
	label: string,
	icon: Parameters<typeof reportIcon>[0],
	className = "text-stone-500",
) {
	return `<summary class="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium ${className} shadow-[0_0_0_1px_rgba(41,37,36,0.08),0_6px_14px_rgba(41,37,36,0.05)] transition-[color,background-color,box-shadow,transform] duration-150 hover:bg-stone-50 hover:text-stone-900 hover:shadow-[0_0_0_1px_rgba(41,37,36,0.12),0_8px_18px_rgba(41,37,36,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 active:scale-[0.96]">${reportIcon(icon, "h-3.5 w-3.5")}<span>${escapeHtml(label)}</span></summary>`;
}

function goalDetails(
	goal: FlowGoal,
	markdown: string,
	language: FlowState["language"],
) {
	const scope = planSection(markdown, "Scope");
	const criteria = planSection(markdown, "Success Criteria");
	const verification = verificationText(markdown).trim();
	const t = copy(language);
	const file = `<p class="text-xs"><a class="font-mono text-sky-700 underline" href="${escapeHtml(relative(".", goal.file))}">${escapeHtml(goal.file)}</a></p>`;
	const session = goal.sessionFile
		? goal.sessionName || (language === "en" ? "Started" : "已启动")
		: language === "en"
			? "Not started"
			: "尚未启动";
	const body = [
		scope ? subSection(t.scope, clipText(scope, 1200)) : "",
		criteria ? subSection(t.successCriteria, clipText(criteria, 1200)) : "",
		verification
			? subSection(t.verification, clipText(verification, 1500))
			: "",
		file,
		debugList([[language === "en" ? "Session" : "运行记录", session]]),
	]
		.filter(Boolean)
		.join("");
	return `<details data-key="g${goal.index}-detail" class="mt-3">${labeledSummary(t.fullDetails, "list-checks")}<div class="mt-3 space-y-4">${body}</div></details>`;
}

function completionCard(flow: FlowState) {
	const finalGoal = flow.goals.at(-1);
	const deviation = flow.goals.some((goal) => goal.result.criteriaChanged);
	const finalAcceptance = hasFinalAcceptance(flow);
	const handoff = finalGoal?.result.handoff
		? `<details data-key="final-handoff" class="mt-3">${labeledSummary(flow.language === "en" ? "Final handoff" : "最终交接", "arrow-right", "text-emerald-800")}${renderMarkdownBlock(clipText(finalGoal.result.handoff, 1500), "mt-2 space-y-2 text-sm leading-6 text-emerald-900")}</details>`
		: "";
	return card(
		`<p class="inline-flex items-center gap-2 text-base font-semibold text-emerald-900">${reportIcon("seal-check", "h-5 w-5")} ${flow.language === "en" ? "All complete" : "全部完成"}</p>
<p class="mt-1 text-xs text-emerald-800">${deviation ? completionDeviationText(flow.language, finalAcceptance) : flow.language === "en" ? "All steps passed checks with no acceptance deviation" : "全部步骤通过检查，无验收偏差"}</p>
${handoff}`,
		{ tone: "green", bg: "bg-emerald-50/60" },
	);
}

function hasFinalAcceptance(flow: FlowState) {
	return flow.goals.some((goal) => goal.role === "final_acceptance");
}

function criteriaDeviationText(
	language: FlowState["language"],
	finalAcceptance: boolean,
) {
	if (finalAcceptance)
		return language === "en"
			? "Acceptance criteria changed; final acceptance will review"
			: "验收口径有调整，最终验收会复核";
	return language === "en"
		? "Acceptance criteria changed; recorded in this step's checks"
		: "验收口径有调整，已在本步骤检查中记录";
}

function completionDeviationText(
	language: FlowState["language"],
	finalAcceptance: boolean,
) {
	if (finalAcceptance)
		return language === "en"
			? "Acceptance criteria changed during execution and final acceptance reviewed it"
			: "执行中有验收口径调整，最终验收已复核";
	return language === "en"
		? "Acceptance criteria changed during execution and was recorded in step checks"
		: "执行中有验收口径调整，已在步骤检查中记录";
}

function contextDetails(dir: string, flow: FlowState) {
	const t = copy(flow.language);
	const source = sourceLabel(dir, flow);
	return detailsCard(
		flow.language === "en" ? "Original request and debug" : "原始需求与调试",
		`<p class="whitespace-pre-wrap text-sm leading-6 text-stone-700">${escapeHtml(clipText(flow.source.originalRequest || (flow.language === "en" ? "None" : "无"), 2000))}</p>
${debugList([
	[t.source, source],
	[t.updatedAt, new Date(flow.updatedAt).toLocaleString(t.htmlLang)],
	[t.planId, flow.id],
])}`,
	);
}

function sourceLabel(dir: string, flow: FlowState) {
	const label = sourceTypeLabel(flow.source.type, flow.language);
	if (!flow.source.path) return label;
	return `${label} · ${safeDisplayPath(dir, flow.source.path)}`;
}

function safeDisplayPath(dir: string, path: string) {
	if (!isAbsolute(path)) return path;
	const projectRoot = join(dir, "..", "..");
	const withinProject = relative(projectRoot, path);
	if (
		withinProject &&
		!withinProject.startsWith("..") &&
		!isAbsolute(withinProject)
	)
		return withinProject;
	return basename(path);
}

function sourceTypeLabel(type: string, language: FlowState["language"]) {
	if (language === "en") {
		if (type === "prompt") return "Prompt";
		if (type === "file") return "File";
		if (type === "conversation") return "Conversation";
		return type;
	}
	if (type === "prompt") return "提示词";
	if (type === "file") return "文件";
	if (type === "conversation") return "会话";
	return type;
}

function nextCommands(flow: FlowState) {
	const id = flowCommandId(flow.id);
	if (flow.status === "draft")
		return [`/flow start ${id}`, `/flow status ${id}`];
	if (flow.status === "running")
		return [`/flow continue ${id}`, `/flow cancel ${id}`];
	return [`/flow status ${id}`];
}
