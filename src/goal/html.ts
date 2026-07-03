import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	objectiveText,
	outcomeText,
	planSection,
	stepsText,
	verificationText,
} from "../plan/markdown.js";
import {
	checkboxProgress,
	type PlanProgress,
	parseSteps,
} from "../plan/view.js";
import { copy } from "../shared/copy.js";
import { clipText, renderMarkdownBlock } from "../shared/html-markdown.js";
import {
	card,
	debugList,
	detailsCard,
	errorCard,
	errorPage,
	hero,
	pageShell,
	progressBar,
	seal,
	sectionTitle,
	subSection,
	type Tone,
} from "../shared/report-blocks.js";
import { readReportText } from "../shared/report-html.js";
import {
	checkPhase,
	checkProgress,
	phaseState,
} from "../shared/report-review.js";
import { notifyReportChanged } from "../shared/report-server.js";
import { stepList } from "../shared/report-steps.js";
import { goalPlanPath } from "./store.js";
import type { CheckPhase, GoalArtifactState, GoalChecks } from "./types.js";

export function writeGoalHtml(dir: string, goal: GoalArtifactState) {
	const htmlPath = join(dir, "goal.html");
	writeFileSync(htmlPath, renderGoalHtml(dir, goal));
	notifyReportChanged(htmlPath);
	return htmlPath;
}

export function writeGoalErrorHtml(
	dir: string,
	input: {
		title: string;
		errors: string[];
		originalRequest?: string;
		language?: GoalArtifactState["language"];
	},
) {
	const htmlPath = join(dir, "goal.html");
	writeFileSync(
		htmlPath,
		errorPage({
			pageTitle:
				input.language === "en"
					? `Goal — ${input.title}`
					: `目标 — ${input.title}`,
			kindLabel:
				input.language === "en" ? "Goal validation errors" : "目标校验错误",
			...input,
		}),
	);
	notifyReportChanged(htmlPath);
	return htmlPath;
}

export function goalArtifactStatusLabel(
	status: string,
	language: GoalArtifactState["language"] = "zh",
) {
	return goalStatus(language)[status]?.label ?? status;
}

function goalStatus(
	language: GoalArtifactState["language"],
): Record<string, { label: string; tone: Tone }> {
	const t = copy(language);
	return {
		draft: { label: t.draftGoal, tone: "gray" },
		running: { label: t.running, tone: "blue" },
		paused: { label: t.paused, tone: "amber" },
		budget_limited: { label: t.budgetLimited, tone: "amber" },
		complete: { label: t.completed, tone: "green" },
		cancelled: { label: t.cancelled, tone: "red" },
	};
}

const TONE_BG: Record<Tone, string> = {
	green: "bg-emerald-50/50",
	blue: "bg-sky-50/40",
	amber: "bg-amber-50/40",
	red: "bg-rose-50/50",
	gray: "bg-white",
};

function renderGoalHtml(dir: string, goal: GoalArtifactState) {
	const t = copy(goal.language);
	const markdown = readPlan(dir);
	const progress = checkboxProgress(stepsText(markdown));
	const checks = checkProgress(goal.checks);
	const totalSlots = progress.total + checks.enabled;
	const percent =
		totalSlots === 0
			? 0
			: Math.round(((progress.done + checks.passed) / totalSlots) * 100);
	const caption =
		checks.enabled > 0
			? t.goalProgressCaption(
					progress.done,
					progress.total,
					checks.passed,
					checks.enabled,
				)
			: t.stepsDoneCaption(progress.done, progress.total);
	const status = goalStatus(goal.language)[goal.status] ?? {
		label: goal.status,
		tone: "gray" as Tone,
	};
	const outcome = (goal.result.outcome || outcomeText(markdown)).trim();
	const main = [
		stepsCard(stepsText(markdown), progress, goal.language),
		goal.status === "complete" && outcome
			? outcomeCard(outcome, goal.language)
			: "",
	]
		.filter(Boolean)
		.join("\n");
	const aside = [
		goal.checks ? checksCards(goal.checks, goal.language) : "",
		acceptanceDetails(markdown, goal.language),
		extrasDetails(markdown, goal.id, goal.language),
	]
		.filter(Boolean)
		.join("\n");
	return pageShell(
		`${t.goal} — ${goal.title}`,
		[
			hero({
				kindLabel: t.goal,
				statusSeal: seal(status.label, status.tone),
				title: goal.title,
				subtitle:
					firstLine(objectiveText(markdown)) ||
					(goal.language === "en" ? "Goal not filled" : "目标未填写"),
				percent,
				tone: status.tone,
				caption,
			}),
			goal.errors.length ? errorCard(goal.errors, goal.language) : "",
			`<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
<aside class="space-y-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">${aside}</aside>
<div class="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">${main}</div>
</div>`,
		]
			.filter(Boolean)
			.join("\n"),
		{ language: goal.language },
	);
}

function checksCards(
	checks: GoalChecks,
	language: GoalArtifactState["language"],
) {
	const t = copy(language);
	return [
		checkCard(
			t.completionAcceptance,
			t.completionAcceptanceHint,
			checks.acceptance,
			"goal-acceptance",
			language,
		),
		checkCard(
			t.qualityCheck,
			t.qualityCheckHint,
			checks.quality,
			"goal-quality",
			language,
		),
	].join("\n");
}

function checkCard(
	name: string,
	hint: string,
	phase: CheckPhase,
	keyPrefix: string,
	language: GoalArtifactState["language"],
) {
	const tone = phaseState(phase, language).tone;
	return card(checkPhase(name, hint, phase, keyPrefix, language), {
		tone,
		bg: toneBg(tone),
	});
}

function stepsCard(
	steps: string,
	progress: PlanProgress,
	language: GoalArtifactState["language"],
) {
	const t = copy(language);
	const parsed = parseSteps(steps);
	const body = parsed.length
		? stepList(parsed, { keyPrefix: "step", expandCurrent: true, language })
		: renderMarkdownBlock(
				steps || (language === "en" ? "Not filled" : "未填写"),
				"mt-4 space-y-2 text-sm leading-6 text-stone-700",
			);
	const tone = stepsTone(progress);
	return card(
		`<div class="flex items-center justify-between gap-3">${sectionTitle(t.checklist)}<span class="text-xs font-semibold tabular-nums text-stone-500">${progress.done}/${progress.total}</span></div>
<div class="mt-3">${progressBar(progress.percent, tone)}</div>
${body}`,
		{ tone, bg: toneBg(tone) },
	);
}

function stepsTone(progress: PlanProgress): Tone {
	if (progress.total === 0) return "gray";
	return progress.done === progress.total ? "green" : "amber";
}

function toneBg(tone: Tone) {
	return TONE_BG[tone];
}

function outcomeCard(outcome: string, language: GoalArtifactState["language"]) {
	const t = copy(language);
	const [first = "", ...rest] = outcome.split(/\n{2,}/u);
	const more = rest.join("\n\n").trim();
	const details = more
		? `<details data-key="outcome-more" class="mt-3"><summary class="text-xs font-medium text-stone-500">${t.fullDetails}</summary>${renderMarkdownBlock(clipText(more, 2000), "mt-2 space-y-2 text-sm leading-6 text-stone-600")}</details>`
		: "";
	return card(
		`${sectionTitle(t.outcome)}${renderMarkdownBlock(clipText(first, 600), "mt-3 space-y-2 text-sm leading-6 text-stone-700")}${details}`,
		{ tone: "green", bg: "bg-emerald-50/50" },
	);
}

function acceptanceDetails(
	markdown: string,
	language: GoalArtifactState["language"],
) {
	const t = copy(language);
	const criteria = planSection(markdown, "Success Criteria");
	const verification = verificationText(markdown).trim();
	if (!criteria && !verification) return "";
	return detailsCard(
		t.completionStandards,
		[
			criteria ? subSection(t.successCriteria, clipText(criteria, 1200)) : "",
			verification
				? subSection(t.verification, clipText(verification, 1500))
				: "",
		]
			.filter(Boolean)
			.join(""),
	);
}

function extrasDetails(
	markdown: string,
	goalId: string,
	language: GoalArtifactState["language"],
) {
	const t = copy(language);
	const scope = planSection(markdown, "Scope");
	const notes = planSection(markdown, "Notes");
	return detailsCard(
		t.details,
		[
			scope ? subSection(t.scope, clipText(scope, 1200)) : "",
			notes ? subSection(t.notes, clipText(notes, 1500)) : "",
			debugList([[t.planId, goalId]]),
		]
			.filter(Boolean)
			.join(""),
	);
}

function firstLine(text: string) {
	const line =
		text
			.split(/\r?\n/)
			.map((item) => item.trim())
			.find(Boolean) ?? "";
	return clipText(line, 140);
}

function readPlan(dir: string) {
	return readReportText(goalPlanPath(dir));
}
