import { clipText } from "../shared/clip.js";
import type { Language } from "../shared/config.js";

/** 连续检查未通过达到该轮次后，失败反馈注入修订许可条款；与顾问首咨同轮解锁，顾问建议修订时执行模型立即有权执行。 */
export const REVISION_PERMISSION_AFTER_FAILURES = 2;
/** 连续检查未通过达到该轮次后，强制暂停当前步骤。 */
export const MAX_CONSECUTIVE_CHECK_FAILURES = 10;
/** 连续检查未通过每满该轮数的倍数（2、4、6、8）且未达硬上限时，咨询顾问模型。 */
export const ADVISOR_CONSULT_INTERVAL = 2;

/** 检查历史尾部连续未通过轮数：停滞自愈（顾问/硬停）的唯一计数口径。 */
export function trailingFailures(
	rounds: readonly { result: string }[],
): number {
	let failures = 0;
	for (let index = rounds.length - 1; index >= 0; index -= 1) {
		if (rounds[index]?.result !== "failed") break;
		failures += 1;
	}
	return failures;
}

/** 判定当前连续失败轮次是否应触发顾问咨询。 */
export function shouldConsultAdvisor(failures: number): boolean {
	return (
		failures >= ADVISOR_CONSULT_INTERVAL &&
		failures % ADVISOR_CONSULT_INTERVAL === 0 &&
		failures < MAX_CONSECUTIVE_CHECK_FAILURES
	);
}

const PLAN_DIFF_LIMIT = 4_000;
const CHECKBOX_PATTERN = /^(\s*[-*+]\s*)\[[ x~!]\]/u;

/** 提取计划 markdown 的 checkbox 状态序列；无 checkbox 时返回空串。 */
export function planCheckboxSignature(
	planText: string | undefined,
): string | undefined {
	if (planText === undefined) return undefined;
	return planText
		.split(/\r?\n/)
		.flatMap((line) => {
			const match = /^\s*[-*+]\s*\[([ x~!])\]/u.exec(line);
			return match ? [match[1]] : [];
		})
		.join("");
}

const CLOSURE_LIST_LIMIT = 2_000;

/** 计划 markdown 中未收口的 checkbox 行原文（[ ] 与 [~]）；[!] 已按协议记录跳过，视为已收口。 */
export function unfinishedCheckboxItems(planText: string): string[] {
	return planText
		.split(/\r?\n/)
		.filter((line) => /^\s*[-*+]\s*\[[ ~]\]/u.test(line))
		.map((line) => line.trim());
}

/** 验收前收口闸门文案：列出未收口项原文，穷举补勾 / 继续执行 / 标 [!] 三种合法出路。 */
export function todoClosureReminder(
	items: string[],
	recordSection: string,
	language: Language,
): string {
	const list = clipText(items.join("\n"), CLOSURE_LIST_LIMIT, "...");
	if (language === "en")
		return [
			"Closure check: the turn ended, but the current plan markdown still has open checkbox items:",
			list,
			`Close them one by one: flip truly finished items (with evidence) to [x] via single-line precise edits; keep executing unfinished items to completion; mark blockers only the user can clear as [!] and record the reason in ${recordSection}. End the turn naturally once every item is closed; acceptance starts automatically.`,
		].join("\n\n");
	return [
		"收口检查：本回合已结束，但当前计划 markdown 仍有未收口的 checkbox：",
		list,
		`逐项收口：已完成且有证据的项，用单行精确编辑改为 [x]；未完成的项，继续执行到完成；只能由用户亲手解除的阻塞改为 [!] 并在 ${recordSection} 记录原因。全部收口后自然结束回合，系统会自动进入验收。`,
	].join("\n\n");
}

export function todoUpdateReminder(language: Language): string {
	return language === "en"
		? "Progress reminder: the previous turn wrote files, but no checkbox state in the current plan markdown changed. Before continuing, update the finished or in-progress checkbox items with single-line precise edits."
		: "进度提醒：上一回合有文件写入，但当前计划 markdown 的 checkbox 状态没有更新。继续前先用单行精确编辑把已完成或进行中步骤的 checkbox 更新到当前计划 markdown。";
}

/**
 * 计算计划 markdown 相对基线的修订内容（带区块前缀的行级多重集 diff）。
 * checkbox 状态标记会先归一化，纯进度勾选不算修订；同区块内重排不算修订（不改变承诺内容，报出只会制造仲裁噪声）；
 * 行键带所属区块前缀，跨区块移动（如把 Success Criteria 行挪到 Notes）算修订；无修订返回 undefined。
 */
export function planRevisionDiff(
	baseline: string,
	current: string,
): string | undefined {
	const baselineLines = normalizedPlanLines(baseline);
	const currentLines = normalizedPlanLines(current);
	const counts = new Map<string, number>();
	for (const line of baselineLines)
		counts.set(line, (counts.get(line) ?? 0) + 1);
	const added: string[] = [];
	for (const line of currentLines) {
		const count = counts.get(line) ?? 0;
		if (count > 0) counts.set(line, count - 1);
		else added.push(line);
	}
	const removed = baselineLines.filter((line) => {
		const count = counts.get(line) ?? 0;
		if (count > 0) {
			counts.set(line, count - 1);
			return true;
		}
		return false;
	});
	if (removed.length === 0 && added.length === 0) return undefined;
	const diff = [
		...removed.map((line) => `- ${line}`),
		...added.map((line) => `+ ${line}`),
	].join("\n");
	return clipText(diff, PLAN_DIFF_LIMIT, "...");
}

function normalizedPlanLines(text: string): string[] {
	const lines: string[] = [];
	let section = "";
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(CHECKBOX_PATTERN, "$1[]").trimEnd();
		if (line.trim() === "") continue;
		const heading = /^#{1,6}\s+(.+)$/u.exec(line.trim());
		if (heading) {
			section = heading[1].trim();
			lines.push(line);
			continue;
		}
		lines.push(section ? `[${section}] ${line}` : line);
	}
	return lines;
}

/** 检查 prompt 中的计划修订提示：附变更内容与修订合理性判定要求。 */
export function planChangeNote(diff: string, language: Language): string {
	if (language === "en")
		return [
			"Plan revision detected: the current plan markdown changed from the baseline captured at step start (checkbox progress excluded):",
			diff,
			"First judge whether the revision is legitimate. Only when the original criteria were internally contradictory or unsatisfiable, with the reason recorded in Notes, may you check against the revised criteria; if the revision lowers the bar to dodge problems, FAIL against the original criteria.",
		].join("\n");
	return [
		"计划修订检测：当前计划 markdown 相对本步启动基线发生了以下修订（不含 checkbox 进度变化）：",
		diff,
		"先判定修订是否合理：只有原标准存在内在矛盾或确实不可满足、且修订理由已写入 Notes 时，才按修订后的标准检查；若属降低标准逃避问题，必须按原标准 FAIL。",
	].join("\n");
}

/** 连续多轮检查未通过后注入的修订许可条款。 */
export function revisionPermissionClause(
	failures: number,
	language: Language,
): string {
	if (language === "en")
		return `Revision permission: this step has failed checks ${failures} rounds in a row. First follow the anti-loop discipline and enumerate 3-5 alternative approaches. Only if you confirm the Success Criteria are internally contradictory or unsatisfiable may you revise the Success Criteria in the current plan markdown (this specific revision overrides the do-not-modify rule); record the revision reason in Notes. Reviewers will arbitrate the revision, and lowering the bar to dodge problems will FAIL against the original criteria.`;
	return `修订许可：当前步骤已连续 ${failures} 轮检查未通过。先按反循环纪律穷举 3–5 个替代方案；只有确认 Success Criteria 存在内在矛盾或确实不可满足时，才允许修订当前计划 markdown 的 Success Criteria（仅此项修订不受「不得修改 Success Criteria」限制），并把修订理由写入 Notes。检查方会仲裁修订，降低标准逃避问题会按原标准 FAIL。`;
}

/** 连续检查未通过达到硬上限后的受控停止原因。 */
export function hardCapStopReason(
	failures: number,
	language: Language,
): string {
	return language === "en"
		? `checks failed ${failures} rounds in a row; automatically paused to prevent an endless loop`
		: `已连续 ${failures} 轮检查未通过，自动暂停防止无限循环`;
}
