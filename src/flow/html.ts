import { writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { planSection, stepsText, verificationText } from "../plan/markdown.js";
import { parseSteps } from "../plan/view.js";
import { copy } from "../shared/copy.js";
import { clipText, renderMarkdownBlock } from "../shared/html-markdown.js";
import { flowStepLabel } from "../shared/progress-labels.js";
import {
	card,
	debugList,
	detailsCard,
	errorCard,
	errorPage,
	escapeHtml,
	hero,
	pageShell,
	seal,
	sectionTitle,
	subSection,
	TONE_TEXT,
	type Tone,
} from "../shared/report-blocks.js";
import { readReportText } from "../shared/report-html.js";
import { checkPhases, pendingChecks } from "../shared/report-review.js";
import { notifyReportChanged } from "../shared/report-server.js";
import { stepList } from "../shared/report-steps.js";
import type { FlowGoal, FlowState } from "./types.js";

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

function flowStatus(
	language: FlowState["language"],
): Record<string, { label: string; tone: Tone }> {
	const t = copy(language);
	return {
		draft: { label: t.draftFlow, tone: "gray" },
		running: { label: t.running, tone: "blue" },
		complete: { label: t.completed, tone: "green" },
		cancelled: { label: t.cancelled, tone: "red" },
	};
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
	const status = flowStatus(flow.language)[flow.status] ?? {
		label: flow.status,
		tone: "gray" as Tone,
	};
	return pageShell(
		`Flow — ${flow.title}`,
		[
			hero({
				kindLabel: "Flow",
				statusSeal: seal(status.label, status.tone),
				title: flow.title,
				subtitle: heroSubtitle(flow, total),
				percent: total === 0 ? 0 : Math.round((complete / total) * 100),
				tone: status.tone,
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
		{ language: flow.language },
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
	const parts: string[] = [];
	flow.goals.forEach((goal, index) => {
		if (index > 0) {
			const done = flow.goals[index - 1].status === "complete";
			parts.push(
				`<span data-rough-line data-tone="${done ? "green" : "gray"}" class="mt-[18px] h-1 min-w-5 flex-1"></span>`,
			);
		}
		parts.push(stepNode(goal, flow));
	});
	return card(
		`${sectionTitle(copy(flow.language).stepProgress)}<div class="mt-4 flex items-start overflow-x-auto pb-1">${parts.join("")}</div>`,
	);
}

function stepNode(goal: FlowGoal, flow: FlowState) {
	const tone = goalTone(goal, flow.language);
	const isCurrent =
		goal.index === flow.currentGoal && goal.status !== "complete";
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
	const glyph =
		goal.role === "final_acceptance" || goal.status === "complete"
			? "✓"
			: String(goal.index + 1);
	return `<span data-rough-node data-tone="${tone}"${fill} class="grid h-9 w-9 place-items-center text-xs font-bold ${TONE_TEXT[tone]}">${glyph}</span>`;
}

function goalTone(goal: FlowGoal, language: FlowState["language"]): Tone {
	return goalStatus(language)[goal.status]?.tone ?? "gray";
}

function goalCard(dir: string, goal: FlowGoal, flow: FlowState) {
	const isCurrent =
		goal.index === flow.currentGoal && goal.status !== "complete";
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
${seal(status.label, status.tone)}
</div>
${goalStepList(markdown, goal, isCurrent, flow.language)}
${goalReviewBlock(goal, flow.language)}
${handoffBlock(goal, flow.language)}
${goalDetails(goal, markdown, flow.language)}
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

function goalReviewBlock(goal: FlowGoal, language: FlowState["language"]) {
	const checks =
		goal.checks ?? (goal.status === "complete" ? null : pendingChecks());
	const chips = deviationChips(goal, language);
	if (!checks)
		return `<div class="mt-4 flex flex-wrap items-center gap-3"><span${goal.result.summary ? ` title="${escapeHtml(clipText(goal.result.summary, 200))}"` : ""} class="text-xs font-medium text-emerald-800">✓ ${language === "en" ? "Checks passed" : "检查通过"}</span>${chips}</div>`;
	return `<div class="mt-4 grid gap-5 border-t border-dashed border-stone-200 pt-4 sm:grid-cols-2">${checkPhases(checks, `g${goal.index + 1}`, language)}</div>${chips ? `<div class="mt-3 flex flex-wrap items-center gap-3">${chips}</div>` : ""}`;
}

function deviationChips(goal: FlowGoal, language: FlowState["language"]) {
	if (goal.status !== "complete") return "";
	const chips: string[] = [];
	if (goal.result.criteriaChanged)
		chips.push(
			`<span class="text-xs font-medium text-amber-800">▲ ${language === "en" ? "Acceptance criteria changed; final acceptance will review" : "验收口径有调整，最终验收会复核"}</span>`,
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
	return `<details data-key="g${goal.index}-handoff" class="mt-3"><summary class="text-xs font-medium text-stone-500">${label}</summary>${renderMarkdownBlock(clipText(goal.result.handoff, 1200), "mt-2 space-y-2 text-sm leading-6 text-stone-600")}</details>`;
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
	return `<details data-key="g${goal.index}-detail" class="mt-3"><summary class="text-xs font-medium text-stone-500">${t.details}</summary><div class="mt-3 space-y-4">${body}</div></details>`;
}

function completionCard(flow: FlowState) {
	const finalGoal = flow.goals.at(-1);
	const deviation = flow.goals.some((goal) => goal.result.criteriaChanged);
	const handoff = finalGoal?.result.handoff
		? `<details data-key="final-handoff" class="mt-3"><summary class="text-xs font-medium text-emerald-800">${flow.language === "en" ? "Final handoff" : "最终交接"}</summary>${renderMarkdownBlock(clipText(finalGoal.result.handoff, 1500), "mt-2 space-y-2 text-sm leading-6 text-emerald-900")}</details>`
		: "";
	return card(
		`<p class="text-base font-semibold text-emerald-900">✓ ${flow.language === "en" ? "All complete" : "全部完成"}</p>
<p class="mt-1 text-xs text-emerald-800">${deviation ? (flow.language === "en" ? "Acceptance criteria changed during execution and final acceptance reviewed it" : "执行中有验收口径调整，最终验收已复核") : flow.language === "en" ? "All steps passed checks with no acceptance deviation" : "全部步骤通过检查，无验收偏差"}</p>
${handoff}`,
		{ tone: "green", bg: "bg-emerald-50/60" },
	);
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
	const projectRoot = join(dir, "..", "..", "..");
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
	if (flow.status === "draft")
		return [`/flow start ${flow.id}`, `/flow status ${flow.id}`];
	if (flow.status === "running") return ["/flow continue", "/flow cancel"];
	return [`/flow status ${flow.id}`];
}
