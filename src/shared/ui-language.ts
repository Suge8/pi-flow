import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Language } from "./config.js";
import { localizeErrorText } from "./error-language.js";
import { runtimeLanguage } from "./language.js";

type NotifyHost = { ui: { notify: ExtensionContext["ui"]["notify"] } };
type ConfirmHost = {
	ui: { confirm: NonNullable<ExtensionContext["ui"]["confirm"]> };
};
type StatusHost = {
	ui: { setStatus?: NonNullable<ExtensionContext["ui"]["setStatus"]> };
};

const localized = new WeakSet<object>();
const originalNotify = new WeakMap<object, ExtensionContext["ui"]["notify"]>();
const originalConfirm = new WeakMap<
	object,
	NonNullable<ExtensionContext["ui"]["confirm"]>
>();
const originalSetStatus = new WeakMap<
	object,
	NonNullable<ExtensionContext["ui"]["setStatus"]>
>();

const EN_REPLACEMENTS: [string, string][] = [
	[
		"生成并执行单步或多步任务：/flow [需求|path.md]",
		"Plan and run a single- or multi-step task: /flow [request|path.md]",
	],
	[
		"运行质检或执行后自动质检",
		"Run quality checks now or automatically after execution",
	],
	["咨询顾问模型", "Consult the advisor model"],
	["⏳ 已有运行中的 Flow\n\n编号：", "⏳ A Flow is already running\n\nID: "],
	["❌ Flow 步骤会话启动失败", "❌ Flow step session start failed"],
	["已有活动目标：", "Active Goal already exists: "],
	["⚠️ 会话名同步失败", "⚠️ Session name sync failed"],
	["会话名同步失败", "Session name sync failed"],
	["；已按 ask 处理。", "; handled as ask."],
	["已按 ask 处理", "Handled as ask"],
	["⚠️ 生成配置已回退", "⚠️ Generation config fallback"],
	[
		"⏳ 质检自动循环仍在等待\n\n等待 Pi 自动重试\n未停止",
		"⏳ Quality check auto loop is still waiting\n\nWaiting for Pi to retry automatically\nNot stopped",
	],
	[
		"⚠️ 质检自动循环已停止\n\nAI 中断或失败",
		"⚠️ Quality check auto loop stopped\n\nAI interrupted or failed",
	],
	[
		"⚠️ 质检自动循环已停止\n\nPi 自动重试耗尽",
		"⚠️ Quality check auto loop stopped\n\nPi automatic retries are exhausted",
	],
	["❌ 质检失败", "❌ Quality check failed"],
	["质检失败", "Quality check failed"],
	["❌ 目标完成事实写入失败", "❌ Goal completion fact write failed"],
	["目标完成事实写入失败", "Goal completion fact write failed"],
	["❌ 目标状态保存失败", "❌ Goal state save failed"],
	["目标状态保存失败", "Goal state save failed"],
	["❌ 目标取消保存失败", "❌ Goal cancellation save failed"],
	["目标取消保存失败", "Goal cancellation save failed"],
	["⚠️ 目标检查进度同步失败", "⚠️ Goal review sync failed"],
	["目标校验失败", "Goal validation failed"],
	["❌ 验收启动失败", "❌ Acceptance start failed"],
	["验收启动失败", "Acceptance start failed"],
	["子进程启动失败", "Child process start failed"],
	["子进程失败，退出码 ", "Child process failed, exit code "],
	["目标状态为 ", "Goal status is "],
	["；只有活动目标可以暂停。", "; only an active Goal can be paused."],
	[
		"；只有已暂停或预算受限的目标可以恢复。",
		"; only a paused or budget-limited Goal can be resumed.",
	],
	["目标令牌预算仍已达到：", "Goal token budget is still reached: "],
	["❌ 目标提示发送失败", "❌ Goal prompt send failed"],
	["目标提示发送失败", "Goal prompt send failed"],
	["❌ Flow 计划提示发送失败", "❌ Flow plan prompt send failed"],
	["❌ Flow 计划修复提示发送失败", "❌ Flow plan repair prompt send failed"],
	[
		"❌ Flow 计划澄清提示发送失败",
		"❌ Flow plan clarification prompt send failed",
	],
	["🛠️ Flow 计划修复中", "🛠️ Flow plan repair in progress"],
	["完成后会自动校验", "It will be validated automatically when done"],
	["ℹ️ 当前步骤状态\n\n状态：", "ℹ️ Current step status\n\nStatus: "],
	[
		"⚠️ Flow 推进结果未知\n\n结果：",
		"⚠️ Flow advance result unknown\n\nResult: ",
	],
	["❌ .flow 目录不可用\n\n", "❌ .flow directory unavailable\n\n"],
	[
		"对齐阶段不接受目标计划；请继续对齐后再生成。",
		"Alignment does not accept a Goal plan; continue alignment before generating.",
	],
	[
		"⚠️ 对齐阶段不接受 Flow 计划\n\n请继续对齐后再生成",
		"⚠️ Alignment cannot accept a Flow plan\n\nContinue alignment before generating",
	],
	[
		"❌ AI 未生成有效 Flow 计划\n\n请重试 /flow",
		"❌ AI did not generate a valid Flow plan\n\nRetry /flow",
	],
	["当前没有目标。", "No Goal."],
	["生成计划前先对齐思路？", "Align before generating the plan?"],
	[
		"粗对齐：约 10 问内，高杠杆问题优先",
		"Coarse alignment: ~10 questions, prioritize high-leverage decisions",
	],
	[
		"标准对齐：约 20-30 问，高杠杆 + 关键实现决策",
		"Standard alignment: ~20-30 questions, high-leverage + key implementation decisions",
	],
	[
		"深度对齐：不设硬上限，高杠杆问题优先",
		"Deep alignment: no hard cap, prioritize high-leverage questions",
	],
	[
		"跳过对齐，直接根据上下文生成计划",
		"Skip alignment and generate from context",
	],
	["你想完成什么？", "What do you want to accomplish?"],
	["开始对齐目标", "Start Goal alignment"],
	["开始对齐 Flow", "Start Flow alignment"],
	[
		"先问清关键点，再生成计划。",
		"Ask key questions before generating the plan.",
	],
	[
		"先确认范围和拆分方式，再生成计划",
		"Confirm scope and split before generating the plan",
	],
	["计划生成中", "plan generating"],
	["完成后自动启动", "Starts automatically when done"],
	[
		"请基于上面的验收和质检，给用户一个简洁最终回复：说明完成了什么、验证了什么、剩余风险。不要继续改代码，除非发现检查结果与当前事实冲突。",
		"Based on the acceptance and quality checks above, give the user a concise final reply: explain what was completed, what was verified, and any remaining risks. Do not continue changing code unless the check results conflict with current facts.",
	],
	["用法：", "Usage: "],
	[
		"当前目录已有未完成的计划生成。",
		"This directory already has an unfinished plan generation.",
	],
	[
		"当前目录已有 Flow 计划在生成中；等它完成后再运行 /flow。",
		"This directory already has a Flow plan being generated; wait for it to finish before running /flow again.",
	],
	["Flow 计划已生成", "Flow plan generated"],
	["目标计划生成已取消。", "Goal plan generation cancelled."],
	["Flow 计划生成已暂停。", "Flow plan generation paused."],
	["质检通过。", "Quality check passed."],
	["非修复项：模型系统错误", "Non-fix item: model system error"],
	["卡点：质检未完成", "Blocker: quality check did not complete"],
	[
		"将质检反馈视为待核实假设，而非事实；先基于当前文件、测试/检查输出和会话约束核实。反馈属实时，逐条修复全部属实发现，修根因而非表象，同一根因的其他出现点一并修复，修完端到端验证问题已彻底解决再结束，避免无关重构、抽象、依赖或风格改动；反馈不成立时，不应用该反馈，并说明依据（文件、命令输出或约束）。处理完反馈后继续完成原目标；不要只处理检查反馈。",
		"Treat the quality-check feedback as hypotheses to verify, not facts. Verify it against current files, test/check output, and conversation constraints. When feedback is valid, fix every valid finding at the root cause rather than the symptom, fix other occurrences of the same root cause, and verify end to end that the problems are fully resolved before finishing; avoid unrelated refactors, abstractions, dependencies, or style changes. When feedback is invalid, do not apply it and state the basis (file, command output, or constraint). After handling the feedback, continue completing the original Goal; do not only handle the review feedback.",
	],
	[
		"将质检反馈视为待核实假设，而非事实；先基于当前文件、测试/检查输出和会话约束核实。反馈属实时，逐条修复全部属实发现，修根因而非表象，同一根因的其他出现点一并修复，修完端到端验证问题已彻底解决再结束，避免无关重构、抽象、依赖或风格改动；反馈不成立时，不应用该反馈，并说明依据（文件、命令输出或约束）。",
		"Treat the quality-check feedback as hypotheses to verify, not facts. Verify it against current files, test/check output, and conversation constraints. When feedback is valid, fix every valid finding at the root cause rather than the symptom, fix other occurrences of the same root cause, and verify end to end that the problems are fully resolved before finishing; avoid unrelated refactors, abstractions, dependencies, or style changes. When feedback is invalid, do not apply it and state the basis (file, command output, or constraint).",
	],
	["质检需要交互模式。", "Quality check requires interactive mode."],
	[
		"质检循环已在运行，请等待结果",
		"A quality-check loop is already running; wait for the result",
	],
	["质检已禁用", "Quality check is disabled"],
	["质检中", "Quality check in progress"],
	["质检通过", "Quality check passed"],
	["质检未通过", "Quality check failed"],
	["质检未完成", "Quality check incomplete"],
	["优化中", "Quality fix in progress"],
	["验收中", "Acceptance in progress"],
	["验收通过", "Acceptance passed"],
	["验收未通过", "Acceptance failed"],
	["验收未完成", "Acceptance incomplete"],
	["质检", "quality check"],
	["验收", "acceptance"],
	["没有活动目标。", "No active Goal."],
	["当前目录没有目标。", "No Goal in the current directory."],
	["当前目录没有 Flow。", "No Flow in the current directory."],
	[
		"没有待启动的 Flow。先运行 /flow <需求> 生成。",
		"No ready Flow to start. Run /flow <request> first.",
	],
	[
		"⚠️ Flow 无法启动\n\n当前 Pi 运行环境不支持新建会话",
		"⚠️ Flow cannot start\n\nThe current Pi runtime cannot create a new session",
	],
	["AI 正在运行", "AI is running"],
	["稍后再试", "Try again later"],
	["目标已继续执行。", "Goal continued."],
	["当前目录没有运行中的 Flow。", "No running Flow in the current directory."],
	["没有进行中的步骤", "No active step"],
	["Flow 已恢复", "Flow resumed"],
	["Flow 暂不能推进", "Flow cannot advance yet"],
	["Flow 无法推进", "Flow cannot advance"],
	["Flow 无法恢复", "Flow cannot resume"],
	["Flow 状态不受支持", "Flow status is not supported"],
	["当前会话没有进行中的目标", "No active Goal in the current session"],
	["当前步骤不在可恢复状态", "The current step is not resumable"],
	[
		"步骤已完成，但缺少会话记录，无法交接。",
		"The step is complete, but no session record exists for handoff.",
	],
	["当前: 无", "Current: none"],
	["后续：无", "Remaining: none"],
	["（无）", "(none)"],
	["目标已完成", "Goal complete"],
	["目标已暂停", "Goal paused"],
	["目标已恢复", "Goal resumed"],
	["目标已取消", "Goal cancelled"],
	["编号：", "ID: "],
	["编号", "ID"],
	["Flow 已完成", "Flow complete"],
	["Flow 已暂停", "Flow paused"],
	["网页报告", "Web report"],
	["结果卡片发送失败", "Result card send failed"],
	["读取失败", "read failed"],
	["校验失败", "validation failed"],
	["发送失败", "send failed"],
	["启动失败", "start failed"],
	["已暂停", "paused"],
	["已完成", "complete"],
	["已启动", "started"],
	["已生成", "generated"],
	["已就绪", "ready"],
	["执行中", "running"],
	["待执行", "pending"],
	["原目标", "Original Goal"],
	["计划文件", "Plan file"],
	["计划修复中", "Repairing plan"],
	["目标", "Goal"],
	["计划", "plan"],
	["当前", "Current"],
	["状态", "Status"],
	["标题", "Title"],
	["下一步", "Next"],
	["模型", "Model"],
	["检查结果", "Check result"],
	["卡点", "Blocker"],
	["原因", "Reason"],
	["总用时", "Total elapsed"],
	["总耗时", "Total time"],
	["用时", "Elapsed"],
	["进度", "Progress"],
	["后续", "Remaining"],
	["会话", "Session"],
	["交接", "Handoff"],
	["错误", "Errors"],
	["已收到", "Received"],
];

export function installLocalizedUi(ctx: Pick<ExtensionContext, "ui">) {
	if (runtimeLanguage() !== "en" || localized.has(ctx.ui)) return;
	localized.add(ctx.ui);
	const ui = ctx.ui as typeof ctx.ui & {
		notify?: ExtensionContext["ui"]["notify"];
		select?: ExtensionContext["ui"]["select"];
		confirm?: ExtensionContext["ui"]["confirm"];
		input?: ExtensionContext["ui"]["input"];
		setStatus?: ExtensionContext["ui"]["setStatus"];
	};
	const notify = ui.notify?.bind(ui);
	if (notify) {
		originalNotify.set(ctx.ui, notify);
		ui.notify = (message, type) => notify(localizeRequired(message), type);
	}
	const select = ui.select?.bind(ui);
	if (select)
		ui.select = async (title, options, opts) => {
			const localizedOptions = options.map(localizeRequired);
			const selected = await select(
				localizeRequired(title),
				localizedOptions,
				opts,
			);
			if (selected === undefined) return selected;
			const selectedIndex = localizedOptions.indexOf(selected);
			return selectedIndex >= 0 ? options[selectedIndex] : selected;
		};
	const confirm = ui.confirm?.bind(ui);
	if (confirm) {
		originalConfirm.set(ctx.ui, confirm);
		ui.confirm = (title, message, opts) =>
			confirm(localizeRequired(title), localizeRequired(message), opts);
	}
	const input = ui.input?.bind(ui);
	if (input)
		ui.input = (title, placeholder, opts) =>
			input(
				localizeRequired(title),
				placeholder === undefined ? "" : localizeRequired(placeholder),
				opts,
			);
	const setStatus = ui.setStatus?.bind(ui);
	if (setStatus) {
		originalSetStatus.set(ctx.ui, setStatus);
		ui.setStatus = (key, text) => setStatus(key, localizeUserText(text));
	}
}

function localizeRequired(text: string) {
	return localizeUserText(text) ?? text;
}

export function notifyUser(
	ctx: NotifyHost,
	message: string,
	type?: Parameters<ExtensionContext["ui"]["notify"]>[1],
	language?: Language,
) {
	const notify = originalForLanguage(ctx.ui, originalNotify, language);
	(notify ?? ctx.ui.notify.bind(ctx.ui))(message, type);
}

export function laneThinkingText(language: Language) {
	return language === "en" ? "Thinking" : "思考中";
}

export function laneSilentWarningText(minutes: number, language: Language) {
	return language === "en"
		? `⚠ No activity for ${minutes} min`
		: `⚠ ${minutes} 分钟无活动`;
}

export function toolDisplayLabel(tool: string, language: Language) {
	if (language === "en") return tool;
	if (tool === "read") return "读取";
	if (tool === "bash") return "操作";
	if (tool === "edit") return "修改";
	if (tool === "write") return "写入";
	return tool;
}

export function monitorThinkingText(language: Language) {
	return language === "en" ? "Thinking" : "思考中";
}

export function monitorCloseHint(language: Language) {
	return language === "en" ? "esc close" : "esc 关闭";
}

export const MONITOR_SHORTCUT = { key: "alt+s", label: "Alt+S" } as const;

export function monitorDetailsHint(language: Language) {
	return language === "en"
		? `${MONITOR_SHORTCUT.label} details`
		: `${MONITOR_SHORTCUT.label} 详情`;
}

export function monitorNoActiveAgentsText(language: Language) {
	return language === "en"
		? "No subagents are currently running"
		: "当前没有运行中的子代理";
}

export function monitorOpenFailedText(message: string, language: Language) {
	return language === "en"
		? `Subagent monitor failed to open: ${message}`
		: `子代理监控打开失败：${message}`;
}

export function monitorShortcutDescription(language = runtimeLanguage()) {
	return language === "en" ? "Open subagent monitor" : "打开子代理监控";
}

export function formatUserNotice(
	emoji: string,
	title: string,
	lines: readonly string[],
) {
	const safeTitle = trimNoticeTerminalPunctuation(title);
	const body = lines
		.filter(Boolean)
		.map(trimNoticeTerminalPunctuation)
		.join("\n");
	return body ? `${emoji} ${safeTitle}\n\n${body}` : `${emoji} ${safeTitle}`;
}

function trimNoticeTerminalPunctuation(value: string) {
	return value.trim().replace(/(?<!\.)[。.]$/u, "");
}

export function confirmUser(
	ctx: ConfirmHost,
	title: string,
	message: string,
	options?: Parameters<NonNullable<ExtensionContext["ui"]["confirm"]>>[2],
	language?: Language,
) {
	const confirm = originalForLanguage(ctx.ui, originalConfirm, language);
	return (confirm ?? ctx.ui.confirm.bind(ctx.ui))(title, message, options);
}

export function setStatusText(
	ctx: StatusHost,
	key: string,
	text: string | undefined,
	language?: Language,
) {
	const setStatus = originalForLanguage(ctx.ui, originalSetStatus, language);
	(setStatus ?? ctx.ui.setStatus?.bind(ctx.ui))?.(key, text);
}

export function localizeUserText(text: string | undefined): string | undefined {
	return localizeUserTextForLanguage(text, runtimeLanguage());
}

export function localizeUserTextForLanguage(
	text: string | undefined,
	language: Language,
): string | undefined {
	if (text === undefined) return undefined;
	if (language !== "en") return text;
	let output = text;
	for (const [from, to] of EN_REPLACEMENTS)
		output = output.replaceAll(from, to);
	return localizeErrorText(output, "en");
}

function originalForLanguage<T>(
	ui: object,
	originals: WeakMap<object, T>,
	language: Language | undefined,
) {
	return language && language !== runtimeLanguage()
		? originals.get(ui)
		: undefined;
}
