import { clipText } from "./clip.js";
import type { Language } from "./config.js";

export interface PlanEvidence {
	path?: string | null;
	text?: string | null;
}

const PLAN_EVIDENCE_LIMIT = 24_000;

export function formatPlanEvidence(
	plan: PlanEvidence | undefined,
	language: Language = "zh",
) {
	const text = plan?.text?.trim();
	if (!text) return "";
	const path = plan?.path?.trim();
	const label =
		language === "en"
			? path
				? `Plan (${path})`
				: "Plan"
			: path
				? `计划（${path}）`
				: "计划";
	const separator = language === "en" ? ":" : "：";
	return `${label}${separator}\n${clipText(text, PLAN_EVIDENCE_LIMIT, "...")}`;
}
