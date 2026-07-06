import type { Language } from "./config.js";
import { runtimeLanguage } from "./language.js";
import { formatDuration } from "./status.js";

export const GOAL_SCOPE = "🎯 goal";
export const REVIEW_SCOPE = "💯 quality";
export const REVIEW_OPTIMIZE_SCOPE = "💯 quality";

export function flowScope(label: string) {
	return `🌊 flow/${label}`;
}

export function flowStepLabel(
	index: number,
	title: string,
	language: Language = "zh",
) {
	return language === "en"
		? `Step ${index + 1} · ${title}`
		: `第 ${index + 1} 步 · ${title}`;
}

export function flowGoalDisplayLabel(
	index: number,
	title: string,
	totalGoals: number,
	language: Language = "zh",
) {
	return totalGoals === 1 ? title : flowStepLabel(index, title, language);
}

export function roundLabel(
	round: number,
	language: Language = runtimeLanguage(),
) {
	return language === "en" ? `Round ${round}` : `第 ${round} 轮`;
}

export function roundTitle(
	round: number,
	title: string,
	language: Language = runtimeLanguage(),
) {
	if (round <= 1) return title;
	return language === "en"
		? `${roundLabel(round, language)} ${title}`
		: `${roundLabel(round, language)}${title}`;
}

export function elapsedLabel(
	stepSeconds: number,
	totalSeconds: number,
	showTotal: boolean,
	language: Language = runtimeLanguage(),
) {
	const step = formatDuration(stepSeconds);
	if (!showTotal) return step;
	const totalLabel = language === "en" ? "total" : "总";
	return `${step} / ${totalLabel} ${formatDuration(totalSeconds)}`;
}
