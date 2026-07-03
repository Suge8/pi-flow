export type PlanStepStatus = "pending" | "active" | "blocked" | "done";

export interface PlanStep {
	status: PlanStepStatus;
	done: boolean;
	title: string;
	detail: string;
}

/** 拆 checkbox 项为「标题 + 可折叠细节」：优先 `**标题**：细节` 模式，兜底取首句。 */
export function parseSteps(markdown: string): PlanStep[] {
	const steps: PlanStep[] = [];
	for (const line of markdown.split(/\r?\n/)) {
		const match = /^\s*-\s*\[([ xX~!])\]\s+(.+)$/u.exec(line);
		if (match) steps.push(splitStep(stepStatus(match[1]), match[2].trim()));
	}
	return steps;
}

function stepStatus(mark: string): PlanStepStatus {
	if (mark === "~") return "active";
	if (mark === "!") return "blocked";
	return mark.trim() === "" ? "pending" : "done";
}

function splitStep(status: PlanStepStatus, text: string): PlanStep {
	const done = status === "done";
	const body = text.replace(/^\d+[.)]\s*/u, "");
	const bold = body.match(/^\*\*([^*]+)\*\*[：:]?\s*(.*)$/u);
	if (bold)
		return { status, done, title: bold[1].trim(), detail: bold[2].trim() };
	const colon = body.indexOf("：");
	if (colon > 0 && colon <= 40)
		return {
			status,
			done,
			title: body.slice(0, colon).trim(),
			detail: body.slice(colon + 1).trim(),
		};
	if (body.length <= 44) return { status, done, title: body, detail: "" };
	const sentence = body.match(/^(.{8,44}?[。；;])\s*(.+)$/u);
	if (sentence)
		return {
			status,
			done,
			title: sentence[1].trim(),
			detail: sentence[2].trim(),
		};
	return { status, done, title: `${body.slice(0, 40)}…`, detail: body };
}

export interface PlanProgress {
	total: number;
	done: number;
	percent: number;
}

export function checkboxProgress(markdown: string): PlanProgress {
	const total = markdown.match(/^\s*-\s*\[[ xX~!]\]/gmu)?.length ?? 0;
	const done = markdown.match(/^\s*-\s*\[[xX]\]/gmu)?.length ?? 0;
	return {
		total,
		done,
		percent: total === 0 ? 0 : Math.round((done / total) * 100),
	};
}
