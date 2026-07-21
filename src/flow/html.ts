import { writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import {
	planSection,
	sectionCheckboxAttributions,
	stepsText,
	verificationText,
} from "../plan/markdown.js";
import { parseSteps } from "../plan/view.js";
import { advisorConsultModel, readFlowConfig } from "../shared/config.js";
import { copy } from "../shared/copy.js";
import { readAlignmentStateIfExists } from "../shared/generation-state.js";
import { clipText, renderMarkdownBlock } from "../shared/html-markdown.js";
import {
	card,
	errorCard,
	errorPage,
	escapeHtml,
	hovercardTrigger,
	modal,
	modalTrigger,
	modelHoverChip,
	modelWithThinking,
	pageShell,
	progressRing,
	sectionTitle,
	statusText,
	TONE,
	type Tone,
	TYPE,
	themeToggleButton,
} from "../shared/report-blocks.js";
import {
	bindLiveReport,
	notifyReportChanged,
} from "../shared/report-client.js";
import {
	elapsedTimeHtml,
	flowLogoDataUri,
	readReportText,
} from "../shared/report-html.js";
import { type ReportIconName, reportIcon } from "../shared/report-icons.js";
import type { ReportLifecycle } from "../shared/report-protocol.js";
import {
	checkDots,
	checkPhases,
	pendingChecks,
} from "../shared/report-review.js";
import { stepList } from "../shared/report-steps.js";
import { reportTranscript } from "../shared/report-transcript.js";
import { collectSuggestions } from "../shared/review-history.js";
import { shortModel } from "../shared/reviewer-pool.js";
import { formatUserNotice, notifyUser } from "../shared/ui-language.js";
import { quoteCommand } from "./parallel/console.js";
import type { FlowAlignment, FlowGoal, FlowState } from "./types.js";
import { flowCommandId } from "./util.js";

/** 目录账本唯一投影：generation=createdAt；仅 canonical complete 进入 Recent。 */
export function flowReportPublication(flow: FlowState): ReportLifecycle {
	return {
		generation: flow.createdAt,
		state: flow.status === "complete" ? "complete" : "live",
	};
}

export function writeFlowHtml(dir: string, flow: FlowState) {
	const htmlPath = join(dir, "flow.html");
	const html = renderFlowHtml(dir, flow);
	if (readReportText(htmlPath) === html) return htmlPath;
	writeFileSync(htmlPath, html);
	notifyReportChanged(htmlPath);
	return htmlPath;
}

export function tryWriteFlowHtml(dir: string, flow: FlowState) {
	return tryHtmlProjection(() => writeFlowHtml(dir, flow));
}

export function refreshFlowHtmlProjection(
	ctx: Parameters<typeof notifyUser>[0],
	dir: string,
	flow: FlowState,
	language = flow.language,
) {
	return refreshHtmlProjection(ctx, language, () => writeFlowHtml(dir, flow));
}

/**
 * canonical 提交后的统一报告副作用：刷新 HTML + 后台注册目录生命周期。
 * HTML 失败不阻断生命周期注册（账本跟 canonical，不跟渲染）。
 */
type FlowReportContext = Parameters<typeof bindLiveReport>[0];

export function publishFlowReportProjection(
	ctx: Parameters<typeof notifyUser>[0] & Partial<FlowReportContext>,
	dir: string,
	flow: FlowState,
	language = flow.language,
) {
	const htmlPath = refreshFlowHtmlProjection(ctx, dir, flow, language);
	publishFlowReportLifecycle(ctx, dir, flow, language);
	return htmlPath;
}

/** 仅注册目录生命周期（不写 HTML）；供已写盘或显式 open 路径复用。 */
export function publishFlowReportLifecycle(
	ctx: Partial<FlowReportContext> & { cwd?: string },
	dir: string,
	flow: FlowState,
	language = flow.language,
) {
	if (typeof ctx.cwd !== "string" || !ctx.cwd || !ctx.ui) return;
	bindLiveReport(
		ctx as FlowReportContext,
		join(dir, "flow.html"),
		language,
		flowReportPublication(flow),
	);
}

export function refreshFlowErrorHtmlProjection(
	ctx: Parameters<typeof notifyUser>[0],
	dir: string,
	input: Parameters<typeof writeFlowErrorHtml>[1],
) {
	return refreshHtmlProjection(ctx, input.language ?? "zh", () =>
		writeFlowErrorHtml(dir, input),
	);
}

function refreshHtmlProjection(
	ctx: Parameters<typeof notifyUser>[0],
	language: FlowState["language"],
	writeProjection: () => string,
) {
	const result = tryHtmlProjection(writeProjection);
	if (result.ok) return result.path;
	const message = projectionErrorMessage(result.error);
	notifyUser(
		ctx,
		formatUserNotice(
			"⚠️",
			language === "en" ? "Flow report refresh failed" : "Flow 报告刷新失败",
			[message],
		),
		"info",
		language,
	);
	return undefined;
}

function tryHtmlProjection(writeProjection: () => string) {
	try {
		return { ok: true as const, path: writeProjection() };
	} catch (error) {
		return { ok: false as const, error };
	}
}

function projectionErrorMessage(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return message.length > 160 ? `${message.slice(0, 157)}…` : message;
}

export function writeFlowErrorHtml(
	dir: string,
	input: {
		title: string;
		errors: string[];
		requestText?: string;
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
			brandHeader(flow.language),
			headerCard(flow),
			flow.errors.length ? errorCard(flow.errors, flow.language) : "",
			flow.goals.length > 1 ? stepperCard(flow) : "",
			activeSection(dir, flow),
			footerRow(dir, flow),
		]
			.filter(Boolean)
			.join("\n"),
		{
			language: flow.language,
			width: "max-w-[1480px]",
			themeToggle: false,
			// attention 态整页轻染色：扫一眼即可识别异常。
			...(flow.attention
				? {
						bodyClass:
							"bg-[linear-gradient(rgba(255,241,242,.5),rgba(255,241,242,.5))] dark:bg-[linear-gradient(rgba(150,45,60,.12),rgba(150,45,60,.12))]",
					}
				: {}),
		},
	);
}

// ---------------------------------------------------------------- header

/** 状态视觉层级单一收口：complete 绿 > attention 红 > paused 琥珀 > running 蓝 > 其他灰。 */
function headerTone(flow: FlowState): Tone {
	if (flow.status === "complete") return "green";
	if (flow.attention) return "red";
	if (flow.status === "paused") return "amber";
	return ["running", "aligning", "generating"].includes(flow.status)
		? "blue"
		: "gray";
}

function headerCard(flow: FlowState) {
	const total = flow.goals.length;
	const complete = flow.goals.filter(
		(goal) => goal.status === "complete",
	).length;
	const percent = total === 0 ? 0 : Math.round((complete / total) * 100);
	const tone = headerTone(flow);
	const attention = flow.attention ? attentionBlock(flow) : "";
	const paused =
		!flow.attention && flow.status === "paused" ? pausedBlock(flow) : "";
	const surface = attention
		? ' data-tone="red" class="bg-[var(--tone-red-surface)] px-6 py-5"'
		: ' class="bg-[var(--report-surface)] px-6 py-5"';
	return `<header data-rough-card${surface}>
<div class="flex items-center gap-5">
<div class="min-w-0 flex-1">
<h1 class="truncate font-serif text-3xl leading-snug text-stone-900 dark:text-stone-100">${escapeHtml(flow.title)}</h1>
${metaLine(flow)}
</div>
${progressRing(percent, tone)}
</div>
${attention}${paused}
</header>`;
}

/** 生成侧元信息与 Flow 起止时刻。 */
function metaLine(flow: FlowState) {
	const meta = flow.meta;
	const en = flow.language === "en";
	const items: string[] = [];
	const timing = flowTimingMeta(flow);
	if (timing) items.push(timing);
	if (meta?.plannedBy)
		items.push(
			`<span class="inline-flex items-center gap-1.5"><span class="text-indigo-600/80 dark:text-indigo-300/80">${reportIcon("bot", "h-3.5 w-3.5")}</span>${en ? "Plan" : "计划"} ${modelWithThinking(shortModel(meta.plannedBy.model), meta.plannedBy.thinking)}</span>`,
		);
	const alignment = alignmentMeta(meta?.alignment ?? null, flow.language);
	if (alignment) items.push(alignment);
	if (items.length === 0) return "";
	return `<div class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-stone-400">${items.join("")}</div>`;
}

function flowTimingMeta(flow: FlowState) {
	if (flow.startedAt === null) return "";
	const en = flow.language === "en";
	const start = reportTime(flow.startedAt, flow.language);
	const completed =
		flow.completedAt === null
			? ""
			: ` <span class="text-stone-300 dark:text-stone-600">·</span> ${en ? "Completed at" : "完成于"} ${reportTime(flow.completedAt, flow.language)}`;
	return `<span data-flow-timing class="inline-flex items-center gap-1 tabular-nums">${en ? "Started at" : "开始于"} ${start}${completed}</span>`;
}

function reportTime(timestamp: number, language: FlowState["language"]) {
	const date = new Date(timestamp);
	return `<time datetime="${date.toISOString()}">${escapeHtml(date.toLocaleString(copy(language).htmlLang))}</time>`;
}

function reportTimeText(timestamp: number, language: FlowState["language"]) {
	return new Date(timestamp).toLocaleString(copy(language).htmlLang);
}

function alignmentMeta(
	alignment: FlowAlignment | null,
	language: FlowState["language"],
) {
	if (!alignment) return "";
	const en = language === "en";
	return modelHoverChip({
		label: en
			? `Aligned ${alignment.turns.length} rounds`
			: `对齐 ${alignment.turns.length} 轮`,
		tooltip: alignmentTooltip(alignment.turns),
		iconHtml: reportIcon("chat", "h-3 w-3"),
		iconTone: "blue",
		side: "right",
		preserveTooltip: true,
	});
}

function alignmentTooltip(turns: FlowAlignment["turns"]) {
	return turns
		.map(
			(turn, index) =>
				`Q${index + 1}: ${turn.question}\nA${index + 1}: ${turn.answer}`,
		)
		.join("\n---\n");
}

const ATTENTION_TITLES: Record<
	NonNullable<FlowState["attention"]>["kind"],
	{ zh: string; en: string }
> = {
	check_hard_cap: {
		zh: "需要接管 · 已自动暂停",
		en: "Attention needed · auto-paused",
	},
	system_error: {
		zh: "需要接管 · 检查系统错误",
		en: "Attention needed · check system error",
	},
	interrupted: {
		zh: "需要接管 · 会话已中断",
		en: "Attention needed · session interrupted",
	},
	user_action_required: { zh: "需要你操作", en: "Your action needed" },
};

/** attention 态：header 内居中警示行 + 恢复命令；四类 kind 映射成人话。 */
function attentionBlock(flow: FlowState) {
	const attention = flow.attention;
	if (!attention) return "";
	const en = flow.language === "en";
	const title = ATTENTION_TITLES[attention.kind][en ? "en" : "zh"];
	const command = `/flow go ${flowCommandId(flow.id)}`;
	return `<div class="mt-5 border-t border-dashed border-rose-300/70 dark:border-rose-400/30 pt-4 text-center">
<p class="inline-flex items-center gap-2 text-lg font-bold text-rose-900 dark:text-rose-200"><span class="text-rose-600 dark:text-rose-300">${reportIcon("warning-circle", "h-5 w-5")}</span>${escapeHtml(title)}</p>
<p class="mt-1 text-[12.5px] leading-5 text-rose-800/85 dark:text-rose-200/75">${escapeHtml(clipText(attention.message, 300))}</p>
<p class="mt-2.5">${commandChip(command, "play", flow.language, true)}</p>
</div>`;
}

/** 用户主动暂停：琥珀平静态一行，不染页不变卡。 */
function pausedBlock(flow: FlowState) {
	const en = flow.language === "en";
	const command = `/flow go ${flowCommandId(flow.id)}`;
	return `<div class="mt-5 border-t border-dashed border-amber-300/70 dark:border-amber-400/30 pt-4 text-center">
<p class="inline-flex flex-wrap items-center justify-center gap-2 text-[13px] font-medium text-amber-800 dark:text-amber-300"><span>${reportIcon("pause", "h-4 w-4")}</span><span>${en ? "Paused" : "已暂停"}</span><span class="text-amber-700/60 dark:text-amber-400/60">·</span>${commandChip(command, "play", flow.language, true)}<span>${en ? "to continue" : "继续"}</span></p>
</div>`;
}

function brandHeader(language: FlowState["language"]) {
	const logo = flowLogoDataUri();
	const mark = logo
		? `<img src="${logo}" alt="Flow" class="h-full w-full rounded-xl object-cover" />`
		: reportIcon("sparkle", "h-6 w-6 text-stone-900 dark:text-stone-100");
	return `<div class="flex items-center justify-between gap-3 px-1 pb-1" aria-label="Flow">
<div class="flex min-w-0 items-center gap-3">
<span class="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--report-surface)] p-1 shadow-[0_0_0_1px_var(--ring-subtle),0_10px_24px_var(--shadow-chip)]">${mark}</span>
<span class="font-serif text-3xl font-semibold tracking-[-0.055em] text-stone-950 dark:text-stone-50">Flow</span>
</div>
${themeToggleButton(language)}
</div>`;
}

function commandButtons(flow: FlowState) {
	if (flow.status === "complete") return "";
	const id = flowCommandId(flow.id);
	const buttons = [commandChip(`/flow go ${id}`, "play", flow.language)];
	if (["running", "aligning", "generating"].includes(flow.status))
		buttons.push(commandChip(`/flow stop ${id}`, "pause", flow.language));
	return `<div class="flex items-center justify-center gap-2">${buttons.join('<span class="h-4 border-l border-dashed border-stone-300 dark:border-stone-600"></span>')}</div>`;
}

function commandChip(
	command: string,
	icon: ReportIconName,
	language: FlowState["language"],
	prominent = false,
) {
	const en = language === "en";
	const shadow = prominent ? " shadow-[0_0_0_1px_var(--ring-subtle)]" : "";
	return `<span class="inline-flex h-7 items-center gap-1 rounded-full bg-[var(--report-surface-soft)] pl-2.5 pr-0.5${shadow}">
<span class="text-stone-500 dark:text-stone-400">${reportIcon(icon, "h-3 w-3")}</span>
<code class="font-mono ${TYPE.micro} leading-none text-stone-700 dark:text-stone-300">${escapeHtml(quoteCommand(command))}</code>
<button type="button" data-copy-command="${escapeHtml(command)}" data-copy-success="${en ? "Copied" : "已复制"}" data-copy-failure="${en ? "Copy failed" : "复制失败"}" aria-label="${escapeHtml(en ? `Copy ${command}` : `复制 ${command}`)}" class="relative ml-0.5 inline-grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full text-stone-400 transition-[color,background-color,transform] duration-150 hover:bg-[var(--report-chip-hover)] hover:text-stone-700 dark:hover:text-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:focus-visible:ring-sky-700 active:scale-[0.94]"><span data-copy-icon>${reportIcon("copy", "h-3 w-3")}</span><span data-copy-check class="hidden text-emerald-700 dark:text-emerald-300">${reportIcon("check", "h-3 w-3")}</span><span data-copy-feedback role="status" class="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-stone-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-[0_6px_16px_var(--shadow-chip)] transition-[opacity,transform] duration-150"></span></button>
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
	const live = flowGoalIsLive(flow, goal, currentIndexes);
	const selected =
		isCurrent ||
		(flow.status === "complete" &&
			goal.index === (flow.goals.at(-1)?.index ?? -1));
	const dots = checkDots(goal.checks ?? null, {
		goalComplete: goal.status === "complete",
		language: flow.language,
		live,
		criteriaChanged: goal.result.criteriaChanged,
	});
	const parallelAttr = parallelNode ? ' data-parallel-node="true"' : "";
	const width = parallelNode ? "w-36" : "w-36";
	const elapsed = goalElapsed(flow, goal);
	return `<button type="button" data-step-node data-goal-select="${escapeHtml(selectGroup ?? String(goal.index))}" data-goal-tone="${tone}" data-selected="${selected}"${parallelAttr} class="group flex ${width} shrink-0 flex-col items-center gap-2 px-2 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200">
<span class="relative transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5">${goalNode(goal, tone, live)}</span>
<span data-goal-title class="line-clamp-2 text-center ${TYPE.meta} leading-tight ${selected ? "font-semibold text-stone-800 dark:text-stone-100" : "text-stone-500 dark:text-stone-400"}">${escapeHtml(clipText(goal.title, 24))}</span>
<span data-step-meta class="mt-0.5 flex flex-col items-center gap-1"><span class="flex items-center justify-center gap-2 whitespace-nowrap">${dots}</span>${elapsed ? `<span data-step-elapsed>${elapsed}</span>` : ""}</span>
</button>`;
}

function goalElapsed(flow: FlowState, goal: FlowGoal) {
	if (goal.startedAt === null) return "";
	const live = flowGoalIsLive(flow, goal);
	return elapsedTimeHtml(
		(goal.completedAt ?? Date.now()) - goal.startedAt,
		live ? goal.startedAt : undefined,
	);
}

function goalNode(goal: FlowGoal, tone: Tone, active: boolean) {
	const fill = goal.status === "complete" ? ' data-fill="solid"' : "";
	return `<span data-rough-node data-tone="${tone}"${fill} class="grid h-11 w-11 place-items-center text-base font-bold ${TONE[tone].text}">${goalGlyph(goal, active)}</span>`;
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
		paused: { label: t.paused, tone: "amber" },
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

function flowGoalIsLive(
	flow: FlowState,
	goal: FlowGoal,
	currentIndexes = currentFlowGoalIndexes(flow),
) {
	return (
		flow.status === "running" &&
		!flow.attention &&
		goal.status === "running" &&
		isCurrentGoal(goal, currentIndexes)
	);
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
	return `<div data-parallel-divider class="items-center justify-center px-1"><span class="text-sky-600 dark:text-sky-400">${reportIcon("git-branch", "h-5 w-5")}</span></div>`;
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
		`<p class="text-sm leading-6 text-stone-500 dark:text-stone-400">${escapeHtml(text)}</p>`,
	);
}

function goalPanel(dir: string, goal: FlowGoal, flow: FlowState) {
	const isCurrent = isCurrentGoal(goal, currentFlowGoalIndexes(flow));
	const status = goalDisplayStatus(goal, flow, isCurrent);
	const markdown = readReportText(join(dir, goal.file));
	const node =
		flow.goals.length > 1
			? `<span data-rough-node data-tone="${status.tone}" class="grid h-10 w-10 shrink-0 place-items-center text-sm font-bold ${TONE[status.tone].text}">${goal.index + 1}</span>`
			: "";
	const steps = parseSteps(stepsText(markdown));
	const list = stepList(steps, {
		language: flow.language,
		attributions: sectionCheckboxAttributions(
			markdown,
			"Steps",
			goal.checkAttribution,
		),
	});
	const criteria = successCriteriaCard(markdown, flow.language);
	const checks = goalChecksBlock(goal, flow, `g${goal.index + 1}`);
	const body = `<div data-goal-body class="mt-4 grid"><div class="min-w-0">${list}</div><aside data-goal-aside class="min-w-0 space-y-3">${criteria}${checks}</aside></div>`;
	const more = moreTrigger(
		flow.language,
		goalMoreTooltip(markdown, goal, flow),
	);
	const statusPill = showGoalStatusPill(flow, isCurrent)
		? `<div class="flex shrink-0 items-center gap-2">${goalStatusMark(goal, status)}</div>`
		: "";
	const tone = goalPanelTone(goal, isCurrent, status.tone);
	const attrs = `data-rough-card${tone ? ` data-tone="${tone}"` : ""} class="h-full bg-[var(--report-surface)] p-5"`;
	return `<article ${attrs}>
<div class="flex items-start justify-between gap-3">
<div class="flex min-w-0 items-center gap-3">
${node}
<h2 class="truncate text-base font-semibold text-stone-900 dark:text-stone-100">${escapeHtml(goal.title)}</h2>
${goalElapsed(flow, goal)}
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
		[t.verification, verificationText(markdown).trim()],
		[flow.language === "en" ? "Plan file" : "计划文件", goal.file],
		[flow.language === "en" ? "Session" : "运行记录", session],
		[
			flow.language === "en" ? "Started at" : "开始于",
			goal.startedAt === null
				? ""
				: reportTimeText(goal.startedAt, flow.language),
		],
		[
			flow.language === "en" ? "Completed at" : "完成于",
			goal.completedAt === null
				? ""
				: reportTimeText(goal.completedAt, flow.language),
		],
	]
		.filter(([, value]) => value.trim())
		.map(
			([label, value]) => `${label}\n${clipText(tooltipPlainText(value), 900)}`,
		)
		.join("\n\n");
}

function successCriteriaCard(
	markdown: string,
	language: FlowState["language"],
) {
	const criteria = planSection(markdown, "Success Criteria");
	if (!criteria) return "";
	const itemCount = [...criteria.matchAll(/^\s*[-*]\s+/gmu)].length;
	const count =
		itemCount === 0
			? ""
			: language === "en"
				? `${itemCount} item${itemCount === 1 ? "" : "s"}`
				: `${itemCount} 项`;
	const title = language === "en" ? "Criteria" : "标准";
	return `<section data-success-criteria data-rough-card data-tone="blue" class="min-w-0 bg-[var(--report-surface-soft)] p-4">
<div data-criteria-header><div data-criteria-title><span data-criteria-icon>${reportIcon("list-checks", "h-5 w-5")}</span><p data-criteria-title-text>${title}</p></div>${count ? `<span data-criteria-count>${count}</span>` : ""}</div>
<div data-criteria-list>${renderMarkdownBlock(criteria, "")}</div>
</section>`;
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
	const live = flowGoalIsLive(flow, goal);
	const consulting =
		live && (checks.acceptance.consulting || checks.quality.consulting);
	return checkPhases(checks, {
		keyPrefix,
		language: flow.language,
		hidePassedStatus: goal.status === "complete",
		hideWaitingStatus: goal.status === "pending",
		live,
		...(consulting ? { advisorModel: advisorDisplayModel() } : {}),
	});
}

/** 咨询进行中的顾问模型展示名；配置不可读时省略（只影响 pill 细节）。 */
function advisorDisplayModel() {
	try {
		const advisor = advisorConsultModel(readFlowConfig());
		return { label: shortModel(advisor.model), thinking: advisor.thinking };
	} catch {
		return undefined;
	}
}

function checksPassedChip(goal: FlowGoal, language: FlowState["language"]) {
	return `<div data-rough-card data-tone="green" class="bg-[var(--tone-green-surface)] p-4"><span${goal.result.summary ? ` title="${escapeHtml(clipText(goal.result.summary, 200))}"` : ""} class="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">${reportIcon("check-circle", "h-4 w-4")} ${language === "en" ? "Checks passed" : "检查通过"}</span></div>`;
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
				"mt-3 space-y-2 text-sm leading-6 text-emerald-900 dark:text-emerald-200",
			)
		: "";
	const deviationText = deviation
		? completionDeviationText(flow.language, finalAcceptance)
		: en
			? "All steps passed checks with no acceptance deviation"
			: "全部步骤通过检查，无验收偏差";
	const detailsButton = finalGoal?.result.handoff
		? `<div class="mt-4 flex justify-end"><button type="button" data-modal-open="dlg-delivery-details" class="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-emerald-800 underline-offset-4 transition-colors hover:text-emerald-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 dark:text-emerald-300 dark:hover:text-emerald-100 dark:focus-visible:ring-sky-700"><span>${escapeHtml(t.deliveryDetails)}</span>${reportIcon("arrow-right", "h-3.5 w-3.5")}</button></div>`
		: "";
	const detailsModal = finalGoal?.result.handoff
		? modal({
				id: "dlg-delivery-details",
				title: t.deliveryDetails,
				icon: "arrow-right",
				tone: "green",
				body: renderMarkdownBlock(
					clipText(finalGoal.result.handoff, 4000),
					"space-y-2 text-sm leading-6 text-stone-700 dark:text-stone-300",
				),
				language: flow.language,
			})
		: "";
	return card(
		`<p class="inline-flex items-center gap-2 text-base font-semibold text-emerald-900 dark:text-emerald-200">${reportIcon("seal-check", "h-5 w-5")}<span>${escapeHtml(t.completionTitle(flow.goals.length))}</span></p>
${summary}
<p class="mt-2 text-xs text-emerald-800/75 dark:text-emerald-300/75">${escapeHtml(deviationText)}</p>
${suggestionsBlock(flow)}
${detailsButton}
${detailsModal}`,
		{ tone: "green", bg: "bg-[var(--tone-green-surface)]" },
	);
}

/** 遗留建议：各步骤检查降级到建议区的非阻塞项，完成时一处收口给用户决策；零建议不渲染。 */
function suggestionsBlock(flow: FlowState) {
	const en = flow.language === "en";
	const groups = flow.goals
		.map((goal) => ({ goal, items: collectSuggestions(goal.checks) }))
		.filter((group) => group.items.length > 0);
	if (groups.length === 0) return "";
	const multi = flow.goals.length > 1;
	const rows = groups
		.flatMap((group) =>
			group.items.map(
				(item) =>
					`<li class="flex gap-2 text-xs leading-5 text-stone-500 dark:text-stone-400"><span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-stone-300 dark:bg-stone-600"></span><span>${multi ? `<span class="font-medium text-stone-500 dark:text-stone-400">${en ? `Step ${group.goal.index + 1}` : `第 ${group.goal.index + 1} 步`}</span> · ` : ""}${escapeHtml(item)}</span></li>`,
			),
		)
		.join("");
	const title = en ? "Remaining suggestions" : "遗留建议";
	return `<div class="mt-4">
<p class="text-[11px] font-semibold uppercase tracking-[0.04em] text-stone-400 dark:text-stone-500">${title}</p>
<ul class="mt-1.5 space-y-1">${rows}</ul>
</div>`;
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
	const requestLog = record
		? `${requestRecordTrigger(flow.language)}${requestRecordModal(dir, flow, record)}`
		: "";
	return `<div class="grid items-center gap-3 px-1 sm:grid-cols-3">
<div class="justify-self-start">${requestLog}</div>
<div class="justify-self-center">${commandButtons(flow)}</div>
<p class="justify-self-end ${TYPE.meta} tabular-nums text-stone-400 dark:text-stone-500">${escapeHtml(t.updatedAt)} ${escapeHtml(updated)}</p>
</div>`;
}

function requestRecordTrigger(language: FlowState["language"]) {
	return modalTrigger({
		id: "dlg-request-record",
		label: requestRecordLabel(language),
		icon: "notebook",
	});
}

function requestRecordModal(
	dir: string,
	flow: FlowState,
	record: NonNullable<ReturnType<typeof requestRecord>>,
) {
	return modal({
		id: "dlg-request-record",
		title: requestRecordLabel(flow.language),
		icon: "notebook",
		body: `<div class="space-y-6">${requestSource(flow)}${requestQa(record.turns, flow.language)}${requestSourceLine(dir, flow)}</div>`,
		language: flow.language,
	});
}

function requestRecord(dir: string, flow: FlowState) {
	const hasSource =
		flow.source.type === "conversation"
			? flow.source.transcript.length > 0
			: Boolean(flow.source.text.trim());
	const turns = (
		flow.meta?.alignment?.turns ??
		readAlignmentStateIfExists(dir)?.alignmentTurns ??
		[]
	).filter((turn) => turn.question.trim() || turn.answer.trim());
	if (!hasSource && turns.length === 0) return null;
	return { turns };
}

function requestRecordLabel(language: FlowState["language"]) {
	return language === "en" ? "Request log" : "需求记录";
}

function requestSource(flow: FlowState) {
	if (flow.source.type === "conversation")
		return reportTranscript(flow.source.transcript, flow.language);
	if (!flow.source.text.trim()) return "";
	const label = flow.language === "en" ? "Original request" : "原始需求";
	return `<section data-request-source-text>${sectionTitle(label)}
<p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700 dark:text-stone-300">${escapeHtml(flow.source.text)}</p>
</section>`;
}

function requestQa(
	turns: { question: string; answer: string }[],
	language: FlowState["language"],
) {
	if (turns.length === 0) return "";
	const label = language === "en" ? "Q&A record" : "QA 记录";
	const rows = turns.map((turn, index) => requestQaTurn(turn, index)).join("");
	return `<section data-request-qa>${sectionTitle(label)}<ol class="mt-3 space-y-4">${rows}</ol></section>`;
}

function requestQaTurn(
	turn: { question: string; answer: string },
	index: number,
) {
	const question = turn.question.trim();
	const answer = turn.answer.trim();
	return `<li class="space-y-2">
${question ? `<div><p class="${TYPE.meta} font-semibold text-stone-400 dark:text-stone-500">Q${index + 1}</p><p class="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-700 dark:text-stone-300">${escapeHtml(question)}</p></div>` : ""}
${answer ? `<div><p class="${TYPE.meta} font-semibold text-stone-400 dark:text-stone-500">A${index + 1}</p><p class="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-700 dark:text-stone-300">${escapeHtml(answer)}</p></div>` : ""}
</li>`;
}

function requestSourceLine(dir: string, flow: FlowState) {
	const label = flow.language === "en" ? "Source" : "来源";
	return `<p class="flex flex-wrap items-center gap-2 border-t border-dashed border-stone-200 pt-4 ${TYPE.meta} text-stone-400 dark:border-stone-700 dark:text-stone-500"><span>${label}</span><span>·</span><span>${escapeHtml(sourceLabel(dir, flow))}</span></p>`;
}

function sourceLabel(dir: string, flow: FlowState) {
	const label = sourceTypeLabel(flow.source.type, flow.language);
	if (flow.source.type !== "file") return label;
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
