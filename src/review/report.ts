import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GoalChecks } from "../goal/types.js";
import type { Language } from "../shared/config.js";
import type { ContextEvidenceResult } from "../shared/context-evidence.js";
import { roundLabel } from "../shared/progress-labels.js";
import {
	escapeHtml,
	escapeHtmlLiteral,
	modal,
	modalTrigger,
	pageShell,
	statusText,
	TONE,
	type Tone,
	TYPE,
	themeToggleButton,
} from "../shared/report-blocks.js";
import { notifyReportChanged } from "../shared/report-client.js";
import { flowLogoDataUri } from "../shared/report-html.js";
import { reportIcon } from "../shared/report-icons.js";
import { checkPhases } from "../shared/report-review.js";
import { currentSessionFile } from "../shared/session.js";
import type { ReviewCheckpointState } from "./checkpoint.js";

export function reviewReportPath(
	ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
) {
	const sessionFile = currentSessionFile(ctx);
	if (!sessionFile) throw new Error("当前会话没有持久化文件，无法生成质检报告");
	const fileName = basename(sessionFile);
	const extension = extname(fileName);
	const sessionName = extension
		? fileName.slice(0, -extension.length)
		: fileName;
	return join(ctx.cwd, ".flow", "reviews", `${sessionName}.html`);
}

export async function writeReviewReport(
	ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
	checkpoint: ReviewCheckpointState,
	language: Language,
	evidence: ContextEvidenceResult,
) {
	const path = reviewReportPath(ctx);
	const html = renderReviewReport(checkpoint, language, evidence);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, html);
	notifyReportChanged(path);
	return path;
}

export function renderReviewReport(
	checkpoint: ReviewCheckpointState,
	language: Language,
	evidence: ContextEvidenceResult,
) {
	const updatedAt = new Date();
	return pageShell(
		language === "en" ? "Flow — Quality review" : "Flow — 独立质检",
		[
			brandHeader(language),
			headerCard(checkpoint, language),
			roundsSection(checkpoint, language),
			footer(updatedAt, checkpoint, evidence, language),
		].join("\n"),
		{ language, themeToggle: false },
	);
}

function brandHeader(language: Language) {
	const logo = flowLogoDataUri();
	const mark = logo
		? `<img src="${logo}" alt="Flow" class="h-full w-full rounded-xl object-cover" />`
		: reportIcon("sparkle", "h-6 w-6 text-stone-900 dark:text-stone-100");
	return `<div class="flex items-center justify-between gap-3 px-1 pb-1" aria-label="Flow Review">
<div class="flex min-w-0 items-center gap-3">
<span class="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--report-surface)] p-1 shadow-[0_0_0_1px_var(--ring-subtle),0_10px_24px_var(--shadow-chip)]">${mark}</span>
<span class="font-serif text-3xl font-semibold tracking-[-0.055em] text-stone-950 dark:text-stone-50">Flow</span>
<span class="text-sm font-medium text-stone-400 dark:text-stone-500">/ ${language === "en" ? "Review" : "质检"}</span>
</div>
${themeToggleButton(language)}
</div>`;
}

function headerCard(checkpoint: ReviewCheckpointState, language: Language) {
	const state = reportState(checkpoint, language);
	return `<header data-review-report data-rough-card data-tone="${state.tone}" class="bg-[var(--report-surface)] px-6 py-5">
<div class="flex flex-wrap items-start justify-between gap-4">
<div class="min-w-0 flex-1">
<h1 class="font-serif text-3xl leading-snug text-stone-900 dark:text-stone-100">${language === "en" ? "Standalone quality review" : "独立质检"}</h1>
<p class="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">${language === "en" ? "Delivery quality for the current task in this conversation" : "当前会话当前任务的交付质量"}</p>
</div>
${statusText(state.label, state.tone)}
</div>
<div class="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-dashed border-stone-200 pt-4 dark:border-stone-700">
<span class="inline-flex items-center gap-1.5 ${TYPE.meta} font-medium ${TONE[state.tone].text}">${reportIcon("shield-check", "h-4 w-4")} ${state.round === 0 ? (language === "en" ? "First review pending" : "等待第 1 轮") : roundLabel(state.round, language)}</span>
<span class="${TYPE.meta} text-stone-400 dark:text-stone-500">${escapeHtml(roundProgress(checkpoint, language))}</span>
</div>
</header>`;
}

function evidenceRecord(
	checkpoint: ReviewCheckpointState,
	evidence: ContextEvidenceResult,
	language: Language,
) {
	const label = language === "en" ? "Review evidence" : "质检证据";
	return `${modalTrigger({
		id: "dlg-review-evidence",
		label,
		icon: "notebook",
	})}${modal({
		id: "dlg-review-evidence",
		title: label,
		icon: "notebook",
		body: evidenceBody(checkpoint, evidence, language),
		language,
	})}`;
}

function evidenceBody(
	checkpoint: ReviewCheckpointState,
	evidence: ContextEvidenceResult,
	language: Language,
) {
	if (!evidence.ok)
		return `<div data-context-evidence-error class="rounded-xl bg-[var(--tone-amber-surface)] p-4 text-sm leading-6 text-amber-900 dark:text-amber-200">
<p class="font-medium">${language === "en" ? "Evidence was not provided to the review models." : "证据未能提供给质检模型"}</p>
<p class="mt-1">${escapeHtmlLiteral(evidence.error.message)}</p>
</div>`;
	const provided = checkpoint.active !== null || checkpoint.history.length > 0;
	const note = provided
		? language === "en"
			? "The following content was provided to the review models as evidence."
			: "以下内容已作为证据提供给质检模型"
		: language === "en"
			? "The following content will be provided to the review models as evidence."
			: "以下内容将作为证据提供给质检模型";
	return `<p data-review-evidence-note class="text-sm font-medium leading-6 text-stone-700 dark:text-stone-300">${note}</p>
<pre data-context-evidence class="mt-4 rounded-xl bg-[var(--report-surface-muted)] p-4 font-mono text-xs leading-5 text-stone-700 dark:text-stone-300">${escapeHtmlLiteral(evidence.packet.text)}</pre>`;
}

function roundsSection(checkpoint: ReviewCheckpointState, language: Language) {
	const checks: GoalChecks = {
		acceptance: { enabled: false, rounds: [], active: null },
		quality: {
			enabled: true,
			rounds: checkpoint.history,
			active: checkpoint.active,
		},
	};
	return `<section data-review-rounds class="space-y-3">
<h2 class="px-1 text-sm font-semibold text-stone-700 dark:text-stone-300">${language === "en" ? "Review rounds" : "质检轮次"}</h2>
${checkPhases(checks, {
	keyPrefix: "standalone-review",
	language,
	live: checkpoint.phase !== null,
})}
</section>`;
}

function footer(
	updatedAt: Date,
	checkpoint: ReviewCheckpointState,
	evidence: ContextEvidenceResult,
	language: Language,
) {
	const timestamp = updatedAt.toISOString();
	const displayed = updatedAt.toLocaleString(
		language === "en" ? "en" : "zh-CN",
	);
	return `<footer class="grid items-center gap-3 px-1 sm:grid-cols-2">
<div class="justify-self-start">${evidenceRecord(checkpoint, evidence, language)}</div>
<p class="justify-self-end ${TYPE.meta} tabular-nums text-stone-400 dark:text-stone-500">${language === "en" ? "Updated" : "更新于"} <time datetime="${timestamp}">${escapeHtml(displayed)}</time></p>
</footer>`;
}

function reportState(checkpoint: ReviewCheckpointState, language: Language) {
	if (checkpoint.phase === "awaiting_agent" && checkpoint.round === 0)
		return {
			label:
				language === "en"
					? "Running · quality check when done"
					: "执行中 · 完成后自动质检",
			tone: "blue" as Tone,
			round: 0,
		};
	if (checkpoint.phase === "checking")
		return {
			label: language === "en" ? "Quality check in progress" : "质检中",
			tone: "blue" as Tone,
			round: checkpoint.active?.round ?? Math.max(1, checkpoint.round),
		};
	if (checkpoint.phase === "awaiting_agent")
		return {
			label: language === "en" ? "Quality fix in progress" : "优化中",
			tone: "blue" as Tone,
			round: Math.max(1, checkpoint.round),
		};
	const last = checkpoint.history.at(-1);
	if (last?.result === "passed")
		return {
			label: language === "en" ? "Passed" : "已通过",
			tone: "green" as Tone,
			round: last.round,
		};
	if (last?.result === "failed")
		return {
			label: language === "en" ? "Failed" : "未通过",
			tone: "red" as Tone,
			round: last.round,
		};
	return {
		label: last
			? language === "en"
				? "Error"
				: "错误"
			: language === "en"
				? "Waiting"
				: "等待",
		tone: last ? ("amber" as Tone) : ("gray" as Tone),
		round: last?.round ?? Math.max(1, checkpoint.round),
	};
}

function roundProgress(checkpoint: ReviewCheckpointState, language: Language) {
	if (checkpoint.phase === "awaiting_agent" && checkpoint.round === 0)
		return language === "en"
			? "Starts automatically after execution"
			: "执行完成后自动开始";
	const active = checkpoint.active;
	if (active) {
		const settled = active.models.filter((model) => model.outcome).length;
		return language === "en"
			? `${settled}/${active.models.length} models settled`
			: `${settled}/${active.models.length} 个模型已结算`;
	}
	const rounds = checkpoint.history.length;
	return language === "en"
		? `${rounds} ${rounds === 1 ? "round" : "rounds"} recorded`
		: `已记录 ${rounds} 轮`;
}
