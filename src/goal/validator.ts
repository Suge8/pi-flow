import { outcomeText, planSection } from "../plan/markdown.js";

export { validateChecks } from "../shared/shape-validation.js";

export function objectiveFromPlan(markdown: string) {
	return planSection(markdown, "Objective").trim();
}

export function outcomeFromPlan(markdown: string) {
	return outcomeText(markdown).trim();
}
