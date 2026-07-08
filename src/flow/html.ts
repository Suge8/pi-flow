import { writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { planSection, stepsText, verificationText } from "../plan/markdown.js";
import { parseSteps } from "../plan/view.js";
import { copy } from "../shared/copy.js";
import { tryReadAlignmentState } from "../shared/generation-state.js";
import { clipText, renderMarkdownBlock } from "../shared/html-markdown.js";
import {
	card,
	errorCard,
	errorPage,
	escapeHtml,
	hovercardTrigger,
	modal,
	modalTrigger,
	pageShell,
	progressRing,
	statusText,
	TONE_TEXT,
	type Tone,
} from "../shared/report-blocks.js";
import { flowLogoDataUri, readReportText } from "../shared/report-html.js";
import { type ReportIconName, reportIcon } from "../shared/report-icons.js";
import {
	checkDots,
	checkPhases,
	pendingChecks,
} from "../shared/report-review.js";
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

export function renderFlowHtml(dir: string, flow: FlowState) {
	return pageShell(
		`Flow — ${flow.title}`,
		[
			brandHeader(),
			headerCard(flow),
			flow.errors.length ? errorCard(flow.errors, flow.language) : "",
			flow.goals.length > 1 ? stepperCard(flow) : "",
			activeSection(dir, flow),
			footerRow(dir, flow),
		]
			.filter(Boolean)
			.join("\n"),
		{ language: flow.language, width: "max-w-[1480px]" },
	);
}

// ---------------------------------------------------------------- header

function headerCard(flow: FlowState) {
	const total = flow.goals.length;
	const complete = flow.goals.filter(
		(goal) => goal.status === "complete",
	).length;
	const percent = total === 0 ? 0 : Math.round((complete / total) * 100);
	const tone: Tone =
		flow.status === "complete"
			? "green"
			: ["running", "aligning", "generating"].includes(flow.status)
				? "blue"
				: flow.status === "paused"
					? "amber"
					: "gray";
	return `<header data-rough-card class="bg-white px-6 py-5">
<div class="flex items-center gap-5">
<div class="min-w-0 flex-1">
<h1 class="truncate font-serif text-3xl leading-snug text-stone-900">${escapeHtml(flow.title)}</h1>
</div>
${progressRing(percent, tone)}
</div>
</header>`;
}

function brandHeader() {
	const logo = flowLogoDataUri();
	const mark = logo
		? `<img src="${logo}" alt="Flow" class="h-full w-full rounded-xl object-cover" />`
		: reportIcon("sparkle", "h-6 w-6 text-stone-900");
	return `<div class="flex items-center gap-3 px-1 pb-1" aria-label="Flow">
<span class="grid h-11 w-11 place-items-center rounded-2xl bg-white p-1 shadow-[0_0_0_1px_rgba(41,37,36,0.14),0_10px_24px_rgba(41,37,36,0.08)]">${mark}</span>
<span class="font-serif text-3xl font-semibold tracking-[-0.055em] text-stone-950">Flow</span>
</div>`;
}

function commandButtons(flow: FlowState) {
	if (flow.status === "complete") return "";
	const id = flowCommandId(flow.id);
	const buttons = [commandButton(`/flow go ${id}`, "play")];
	if (["running", "aligning", "generating"].includes(flow.status))
		buttons.push(commandButton(`/flow stop ${id}`, "pause"));
	return `<div class="flex items-center justify-center gap-2">${buttons.join('<span class="h-4 border-l border-dashed border-stone-300"></span>')}</div>`;
}

function commandButton(command: string, icon: ReportIconName) {
	return `<span class="inline-flex h-6 items-center gap-1 rounded-full bg-white/60 px-1.5">
<span class="text-stone-500">${reportIcon(icon, "h-3 w-3")}</span>
<code class="font-mono text-[10px] leading-none text-stone-700">${escapeHtml(command)}</code>
</span>`;
}

// ---------------------------------------------------------------- stepper

function stepperCard(flow: FlowState) {
	if (hasParallelRun(flow)) return parallelStepperCard(flow);
	const currentIndexes = currentFlowGoalIndexes(flow);
	const parts: string[] = [];
	flow.goals.forEach((goal, index) => {
		if (index > 0) {
			parts.push(
				`<span data-rough-line data-tone="${stepperLineTone(flow, index, currentIndexes)}" class="mt-[22px] h-1 min-w-5 flex-1"></span>`,
			);
		}
		parts.push(stepNode(goal, flow, currentIndexes));
	});
	return card(
		`<div class="flex items-start overflow-x-auto pb-1">${parts.join("")}</div>`,
	);
}

function parallelStepperCard(
	flow: FlowState & { parallelRun: NonNullable<FlowState["parallelRun"]> },
) {
	const currentIndexes = currentFlowGoalIndexes(flow);
	const indexes = flow.parallelRun.goalIndexes;
	const first = Math.min(...indexes);
	const last = Math.max(...indexes);
	const before = flow.goals.slice(0, first);
	const branches = indexes
		.map((index) => flow.goals[index])
		.filter((goal): goal is FlowGoal => Boolean(goal));
	const after = flow.goals.slice(last + 1);
	const group = indexes.join(",");
	const groupTone = parallelGroupTone(branches, currentIndexes);
	const branchRows = branches
		.map(
			(goal) =>
				`<div data-parallel-branch class="flex justify-center">${stepNode(goal, flow, currentIndexes, group, true)}</div>`,
		)
		.join("\n");
	const tone: Tone = flow.status === "running" ? "blue" : "gray";
	return card(
		`<div class="overflow-x-auto pb-1"><div data-parallel-stepper data-tone="${tone}" class="relative min-w-[860px] py-3">
<div class="grid items-center gap-x-8" style="grid-template-columns:minmax(180px,1fr) minmax(240px,280px) minmax(180px,1fr)">
<div data-parallel-before style="grid-column:1" class="flex justify-end">${parallelSideChain(before, flow, currentIndexes)}</div>
<div data-parallel-group data-tone="${groupTone}" style="grid-column:2" class="grid w-max justify-items-center gap-6 px-5 py-5">
${branchRows}
</div>
<div data-parallel-after style="grid-column:3" class="flex justify-start">${parallelSideChain(after, flow, currentIndexes)}</div>
</div></div></div>`,
	);
}

function parallelGroupTone(
	goals: FlowGoal[],
	currentIndexes: Set<number>,
): Tone {
	if (goals.some((goal) => isCurrentGoal(goal, currentIndexes))) return "blue";
	if (goals.length > 0 && goals.every((goal) => goal.status === "complete"))
		return "green";
	return "gray";
}

function parallelSideChain(
	goals: FlowGoal[],
	flow: FlowState,
	currentIndexes: Set<number>,
) {
	if (goals.length === 0) return `<span class="h-1 w-10"></span>`;
	return `<div class="flex items-start">${goals
		.map((goal, index) => {
			const line =
				index === 0
					? ""
					: `<span data-rough-line data-tone="${goal.status === "complete" ? "green" : "gray"}" class="mt-[22px] h-1 w-8"></span>`;
			return `${line}${stepNode(goal, flow, currentIndexes)}`;
		})
		.join("")}</div>`;
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
	selectGroup?: string,
	parallelNode = false,
) {
	const tone = goalTone(goal, flow.language);
	const isCurrent = isCurrentGoal(goal, currentIndexes);
	const selected =
		isCurrent ||
		(flow.status === "complete" &&
			goal.index === (flow.goals.at(-1)?.index ?? -1));
	const dots = checkDots(goal.checks ?? null, {
		goalComplete: goal.status === "complete",
		language: flow.language,
		live: isCurrent && flow.status === "running",
		criteriaChanged: goal.result.criteriaChanged,
	});
	const parallelAttr = parallelNode ? ' data-parallel-node="true"' : "";
	const width = parallelNode ? "w-36" : "w-36";
	return `<button type="button" data-step-node data-goal-select="${escapeHtml(selectGroup ?? String(goal.index))}" data-goal-tone="${tone}" data-selected="${selected}"${parallelAttr} class="group flex ${width} shrink-0 flex-col items-center gap-2 px-2 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200">
<span class="relative transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5">${goalNode(goal, tone, isCurrent)}</span>
<span data-goal-title class="line-clamp-2 text-center text-[11px] leading-tight ${selected ? "font-semibold text-stone-800" : "text-stone-500"}">${escapeHtml(clipText(goal.title, 24))}</span>
<span class="mt-0.5 flex items-center justify-center gap-2 whitespace-nowrap">${dots}</span>
</button>`;
}

function goalNode(goal: FlowGoal, tone: Tone, active: boolean) {
	const fill = goal.status === "complete" ? ' data-fill="solid"' : "";
	return `<span data-rough-node data-tone="${tone}"${fill} class="grid h-11 w-11 place-items-center text-base font-bold ${TONE_TEXT[tone]}">${goalGlyph(goal, active)}</span>`;
}

function goalGlyph(goal: FlowGoal, active: boolean) {
	if (goal.status === "complete") return reportIcon("check", "h-6 w-6");
	if (active) return reportIcon("bot", "h-6 w-6 bot-soft");
	if (goal.role === "final_acceptance") return reportIcon("flag", "h-6 w-6");
	return String(goal.index + 1);
}

// ---------------------------------------------------------------- status helpers

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

function goalTone(goal: FlowGoal, language: FlowState["language"]): Tone {
	return goalStatus(language)[goal.status]?.tone ?? "gray";
}

function goalDisplayStatus(
	goal: FlowGoal,
	flow: FlowState,
	isCurrent: boolean,
) {
	const t = copy(flow.language);
	if (isCurrent && goal.status !== "complete" && flow.errors.length > 0)
		return { label: t.error, tone: "red" as Tone };
	if (isCurrent && flow.status === "paused")
		return { label: t.paused, tone: "amber" as Tone };
	if (isCurrent && flow.status === "running")
		return {
			label: flow.language === "en" ? "Current" : "当前",
			tone: "blue" as Tone,
		};
	return (
		goalStatus(flow.language)[goal.status] ?? {
			label: goal.status,
			tone: "gray" as Tone,
		}
	);
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

// ---------------------------------------------------------------- active section

function activeSection(dir: string, flow: FlowState) {
	if (flow.goals.length === 0) return preDraftCard(flow);
	const currentIndexes = currentFlowGoalIndexes(flow);
	const active = flow.goals.filter((goal) =>
		isCurrentGoal(goal, currentIndexes),
	);
	const initialIndexes = new Set(
		flow.status === "complete"
			? [flow.goals.at(-1)?.index ?? 0]
			: active.length > 0
				? active.map((goal) => goal.index)
				: [flow.goals[0].index],
	);
	const deck = goalPanelDeck(dir, flow, initialIndexes);
	return flow.status === "complete" ? `${completionCard(flow)}\n${deck}` : deck;
}

function goalPanelDeck(
	dir: string,
	flow: FlowState,
	initialIndexes: Set<number>,
) {
	const parallelFlow = hasParallelRun(flow);
	const parallelInitial = initialIndexes.size > 1;
	const dividerAfter =
		parallelFlow && flow.parallelRun.goalIndexes.length === 2
			? flow.parallelRun.goalIndexes[0]
			: undefined;
	const panels = flow.goals
		.flatMap((goal) => {
			const visible = initialIndexes.has(goal.index);
			const panel = `<div data-goal-panel="${goal.index}"${visible ? "" : " hidden"}>${goalPanel(dir, goal, flow)}</div>`;
			return goal.index === dividerAfter ? [panel, parallelDivider()] : [panel];
		})
		.join("\n");
	const columns = parallelFlow
		? "lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch"
		: "lg:grid-cols-1";
	return `<div data-goal-panels data-single="${!parallelInitial}" class="grid gap-4 ${columns}">${panels}</div>`;
}

function parallelDivider() {
	return `<div data-parallel-divider class="items-center justify-center px-1"><span class="text-sky-600">${reportIcon("git-branch", "h-5 w-5")}</span></div>`;
}

function preDraftCard(flow: FlowState) {
	const text =
		flow.status === "generating"
			? flow.language === "en"
				? "Generating plan…"
				: "计划生成中…"
			: flow.language === "en"
				? "Aligning before plan generation…"
				: "生成计划前对齐中…";
	return card(
		`<p class="text-sm leading-6 text-stone-500">${escapeHtml(text)}</p>`,
	);
}

function goalPanel(dir: string, goal: FlowGoal, flow: FlowState) {
	const isCurrent = isCurrentGoal(goal, currentFlowGoalIndexes(flow));
	const status = goalDisplayStatus(goal, flow, isCurrent);
	const markdown = readReportText(join(dir, goal.file));
	const node =
		flow.goals.length > 1
			? `<span data-rough-node data-tone="${status.tone}" class="grid h-10 w-10 shrink-0 place-items-center text-sm font-bold ${TONE_TEXT[status.tone]}">${goal.index + 1}</span>`
			: "";
	const steps = parseSteps(stepsText(markdown));
	const list = stepList(steps, {
		keyPrefix: `g${goal.index}-step`,
		expandCurrent: isCurrent,
		language: flow.language,
	});
	const checks = goalChecksBlock(goal, flow, `g${goal.index + 1}`);
	const body = `<div class="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start"><div class="min-w-0">${list}</div><aside class="space-y-3 xl:sticky xl:top-6">${checks}</aside></div>`;
	const more = moreTrigger(
		flow.language,
		goalMoreTooltip(markdown, goal, flow),
	);
	const statusPill = showGoalStatusPill(flow, isCurrent)
		? `<div class="flex shrink-0 items-center gap-2">${goalStatusMark(goal, status)}</div>`
		: "";
	const tone = goalPanelTone(goal, isCurrent, status.tone);
	const attrs = `data-rough-card${tone ? ` data-tone="${tone}"` : ""} class="h-full bg-white p-5"`;
	return `<article ${attrs}>
<div class="flex items-start justify-between gap-3">
<div class="flex min-w-0 items-center gap-3">
${node}
<h2 class="truncate text-base font-semibold text-stone-900">${escapeHtml(goal.title)}</h2>
</div>
${statusPill}
</div>
${body}
<div class="mt-4 flex justify-end">${more}</div>
</article>`;
}

function goalPanelTone(goal: FlowGoal, isCurrent: boolean, statusTone: Tone) {
	if (goal.status === "complete") return "green";
	return isCurrent ? statusTone : undefined;
}

function goalStatusMark(
	_goal: FlowGoal,
	status: ReturnType<typeof goalDisplayStatus>,
) {
	return statusText(status.label, status.tone);
}

function showGoalStatusPill(flow: FlowState, isCurrent: boolean) {
	return !(isCurrent && flow.status === "running" && flow.errors.length === 0);
}

function moreLabel(language: FlowState["language"]) {
	return language === "en" ? "More" : "更多";
}

function moreTrigger(language: FlowState["language"], tooltip: string) {
	return hovercardTrigger({
		label: moreLabel(language),
		tooltip,
		icon: "dots-three",
		side: "left",
	});
}

function goalMoreTooltip(markdown: string, goal: FlowGoal, flow: FlowState) {
	const t = copy(flow.language);
	const session = goal.sessionFile
		? goal.sessionName || (flow.language === "en" ? "Started" : "已启动")
		: flow.language === "en"
			? "Not started"
			: "尚未启动";
	return [
		[t.scope, planSection(markdown, "Scope")],
		[t.successCriteria, planSection(markdown, "Success Criteria")],
		[t.verification, verificationText(markdown).trim()],
		[flow.language === "en" ? "Plan file" : "计划文件", goal.file],
		[flow.language === "en" ? "Session" : "运行记录", session],
	]
		.filter(([, value]) => value.trim())
		.map(
			([label, value]) => `${label}\n${clipText(tooltipPlainText(value), 900)}`,
		)
		.join("\n\n");
}

function tooltipPlainText(value: string) {
	return value
		.split(/\r?\n/u)
		.map((line) =>
			line
				.trim()
				.replace(/^-\s+\[[ xX~!]\]\s+/u, "")
				.replace(/^[-*]\s+/u, ""),
		)
		.filter(Boolean)
		.join("\n");
}

function goalChecksBlock(goal: FlowGoal, flow: FlowState, keyPrefix: string) {
	const checks =
		goal.checks ?? (goal.status === "complete" ? null : pendingChecks());
	if (!checks)
		return goal.status === "complete"
			? ""
			: checksPassedChip(goal, flow.language);
	return checkPhases(checks, {
		keyPrefix,
		language: flow.language,
		hidePassedStatus: goal.status === "complete",
		hideWaitingStatus: goal.status === "pending",
		live:
			flow.status === "running" &&
			isCurrentGoal(goal, currentFlowGoalIndexes(flow)),
	});
}

function checksPassedChip(goal: FlowGoal, language: FlowState["language"]) {
	return `<div data-rough-card data-tone="green" class="bg-emerald-50/50 p-4"><span${goal.result.summary ? ` title="${escapeHtml(clipText(goal.result.summary, 200))}"` : ""} class="inline-flex items-center gap-1 text-xs font-medium text-emerald-800">${reportIcon("check-circle", "h-4 w-4")} ${language === "en" ? "Checks passed" : "检查通过"}</span></div>`;
}

// ---------------------------------------------------------------- completion

function completionCard(flow: FlowState) {
	const en = flow.language === "en";
	const t = copy(flow.language);
	const finalGoal = flow.goals.at(-1);
	const deviation = flow.goals.some((goal) => goal.result.criteriaChanged);
	const finalAcceptance = hasFinalAcceptance(flow);
	const summary = finalGoal?.result.summary
		? renderMarkdownBlock(
				clipText(finalGoal.result.summary, 600),
				"mt-3 space-y-2 text-sm leading-6 text-emerald-900",
			)
		: "";
	const actions: string[] = [];
	if (finalGoal?.result.handoff) {
		actions.push(
			modalTrigger({
				id: "dlg-final-handoff",
				label: en ? "Final handoff" : "最终交接",
				icon: "arrow-right",
				className: "text-emerald-800",
			}),
		);
	}
	const handoffModal = finalGoal?.result.handoff
		? modal({
				id: "dlg-final-handoff",
				title: en ? "Final handoff" : "最终交接",
				icon: "arrow-right",
				tone: "green",
				body: renderMarkdownBlock(
					clipText(finalGoal.result.handoff, 4000),
					"space-y-2 text-sm leading-6 text-stone-700",
				),
				language: flow.language,
			})
		: "";
	return card(
		`<p class="inline-flex items-center gap-2 text-base font-semibold text-emerald-900">${reportIcon("seal-check", "h-5 w-5")} ${en ? "All complete" : "全部完成"}</p>
<p class="mt-1 text-xs text-emerald-800">${t.allStepsDone(flow.goals.length)} · ${deviation ? completionDeviationText(flow.language, finalAcceptance) : en ? "All steps passed checks with no acceptance deviation" : "全部步骤通过检查，无验收偏差"}</p>
${summary}
${actions.length ? `<div class="mt-3 flex flex-wrap items-center gap-2">${actions.join("")}</div>` : ""}
${handoffModal}`,
		{ tone: "green", bg: "bg-emerald-50/60" },
	);
}

function hasFinalAcceptance(flow: FlowState) {
	return flow.goals.some((goal) => goal.role === "final_acceptance");
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
		? "Acceptance criteria changed during execution and was recorded in this step's checks"
		: "执行中有验收口径调整，已在步骤检查中记录";
}

// ---------------------------------------------------------------- footer / context

function footerRow(dir: string, flow: FlowState) {
	const t = copy(flow.language);
	const updated = new Date(flow.updatedAt).toLocaleString(t.htmlLang);
	const record = requestRecord(dir, flow);
	const trigger = record
		? requestRecordTrigger(
				flow.language,
				requestRecordTooltip(dir, flow, record),
			)
		: "";
	return `<div class="grid items-center gap-3 px-1 sm:grid-cols-3">
<div class="justify-self-start">${trigger}</div>
<div class="justify-self-center">${commandButtons(flow)}</div>
<p class="justify-self-end text-[11px] tabular-nums text-stone-400">${escapeHtml(t.updatedAt)} ${escapeHtml(updated)}</p>
</div>`;
}

function requestRecordTrigger(
	language: FlowState["language"],
	tooltip: string,
) {
	return hovercardTrigger({
		label: requestRecordLabel(language),
		tooltip,
		icon: "notebook",
		side: "right",
	});
}

function requestRecordTooltip(
	dir: string,
	flow: FlowState,
	record: NonNullable<ReturnType<typeof requestRecord>>,
) {
	const lines: string[] = [];
	if (record.request)
		lines.push(
			`${flow.language === "en" ? "Original request" : "原始需求"}\n${record.request}`,
		);
	if (record.turns.length > 0)
		lines.push(qaPlainText(record.turns, flow.language));
	lines.push(
		`${flow.language === "en" ? "Source" : "来源"} · ${sourceLabel(dir, flow)}`,
	);
	return clipText(lines.join("\n\n"), 6000);
}

function requestRecord(dir: string, flow: FlowState) {
	const request = flow.source.originalRequest.trim();
	const turns = (tryReadAlignmentState(dir)?.alignmentTurns ?? []).filter(
		(turn) => turn.question.trim() || turn.answer.trim(),
	);
	if (!request && turns.length === 0) return null;
	return { request, turns };
}

function requestRecordLabel(language: FlowState["language"]) {
	return language === "en" ? "Request log" : "需求记录";
}

function qaPlainText(
	turns: { question: string; answer: string }[],
	language: FlowState["language"],
) {
	const label = language === "en" ? "Q&A record" : "QA 记录";
	const rows = turns
		.map((turn, index) => {
			const question = turn.question.trim();
			const answer = turn.answer.trim();
			return [
				question ? `Q${index + 1}\n${question}` : "",
				answer ? `A${index + 1}\n${answer}` : "",
			]
				.filter(Boolean)
				.join("\n");
		})
		.filter(Boolean)
		.join("\n\n");
	return `${label}\n${rows}`;
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
