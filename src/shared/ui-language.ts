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
		"生成并执行单会话目标：/goal [需求|path.md] → /goal start [id]",
		"Generate and run a single-session Goal: /goal [request|path.md] → /goal start [id]",
	],
	[
		"把大任务拆成多个步骤依次执行：/flow [需求|path.md]",
		"Split a large task into ordered steps: /flow [request|path.md]",
	],
	["运行质量检查", "Run quality checks"],
	["已有运行中的 Flow：", "A Flow is already running: "],
	["Flow 步骤会话启动失败：", "Flow step session start failed: "],
	["已有活动目标：", "Active Goal already exists: "],
	["目标计划已生成并启动", "Goal plan generated and started"],
	[
		"目标计划已生成，但自动启动失败。运行 /goal start",
		"Goal plan generated, but auto-start failed. Run /goal start",
	],
	["会话名同步失败", "Session name sync failed"],
	["；已按 ask 处理。", "; handled as ask."],
	[
		"质量检查自动循环已停止：AI 中断或失败。",
		"Quality check auto loop stopped: AI interrupted or failed.",
	],
	["质量检查失败", "Quality check failed"],
	["目标完成事实写入失败", "Goal completion fact write failed"],
	["目标状态保存失败", "Goal state save failed"],
	["目标取消保存失败", "Goal cancellation save failed"],
	["目标校验失败", "Goal validation failed"],
	["完成验收启动失败", "Acceptance start failed"],
	["子进程启动失败", "Child process start failed"],
	["子进程失败，退出码 ", "Child process failed, exit code "],
	["目标状态为 ", "Goal status is "],
	["；只有活动目标可以暂停。", "; only an active Goal can be paused."],
	[
		"；只有已暂停或预算受限的目标可以恢复。",
		"; only a paused or budget-limited Goal can be resumed.",
	],
	["目标令牌预算仍已达到：", "Goal token budget is still reached: "],
	["目标提示发送失败", "Goal prompt send failed"],
	["当前步骤状态：", "Current step status: "],
	[
		"Flow 已更新；运行 /flow continue 继续下一步。",
		"Flow updated; run /flow continue to continue to the next step.",
	],
	["Flow 继续结果：", "Flow continue result: "],
	[".flow 目录不可用：", ".flow directory unavailable: "],
	[
		"对齐阶段不接受目标计划；请继续对齐后再生成。",
		"Alignment does not accept a Goal plan; continue alignment before generating.",
	],
	[
		"对齐阶段不接受 Flow 计划；请继续对齐后再生成。",
		"Alignment does not accept a Flow plan; continue alignment before generating.",
	],
	[
		"AI 未生成有效目标计划。请重试 /goal。",
		"AI did not generate a valid Goal plan. Retry /goal.",
	],
	[
		"AI 未生成有效 Flow 计划。请重试 /flow。",
		"AI did not generate a valid Flow plan. Retry /flow.",
	],
	["当前没有目标。", "No Goal."],
	["生成计划前先对齐思路？", "Align before generating the plan?"],
	["先进行多轮问答对齐想法", "Ask alignment questions first"],
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
		"先确认范围和拆分方式，再生成计划。",
		"Confirm scope and split before generating the plan.",
	],
	["等待 AI 提问。", "Waiting for AI to ask."],
	[
		"请基于上面的完成验收和质量检查，给用户一个简洁最终回复：说明完成了什么、验证了什么、剩余风险。不要继续改代码，除非发现检查结果与当前事实冲突。",
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
	[
		"计划已开始生成；完成后会自动校验。",
		"Plan generation started; it will be validated automatically when done.",
	],
	[
		"多步骤计划已开始生成；完成后会自动校验。",
		"Multi-step plan generation started; it will be validated automatically when done.",
	],
	["目标计划生成已取消。", "Goal plan generation cancelled."],
	["Flow 计划生成已取消。", "Flow plan generation cancelled."],
	["质量检查通过。", "Quality check passed."],
	["非修复项：模型系统错误", "Non-fix item: model system error"],
	["卡点：质量检查未完成", "Blocker: quality check did not complete"],
	[
		"将质量检查反馈视为待核实假设，而非事实；先基于当前文件、测试/检查输出和会话约束核实。反馈属实时，修根因并做最小充分修复，避免无关重构、抽象、依赖或风格改动；反馈不成立时，不应用该反馈，并说明依据（文件、命令输出或约束）。处理完反馈后继续完成原目标；不要只处理检查反馈。",
		"Treat the quality-check feedback as hypotheses to verify, not facts. Verify it against current files, test/check output, and conversation constraints. When feedback is valid, fix the root cause with the smallest sufficient change; avoid unrelated refactors, abstractions, dependencies, or style changes. When feedback is invalid, do not apply it and state the basis (file, command output, or constraint). After handling the feedback, continue completing the original Goal; do not only handle the review feedback.",
	],
	[
		"将质量检查反馈视为待核实假设，而非事实；先基于当前文件、测试/检查输出和会话约束核实。反馈属实时，修根因并做最小充分修复，避免无关重构、抽象、依赖或风格改动；反馈不成立时，不应用该反馈，并说明依据（文件、命令输出或约束）。",
		"Treat the quality-check feedback as hypotheses to verify, not facts. Verify it against current files, test/check output, and conversation constraints. When feedback is valid, fix the root cause with the smallest sufficient change; avoid unrelated refactors, abstractions, dependencies, or style changes. When feedback is invalid, do not apply it and state the basis (file, command output, or constraint).",
	],
	["质量检查需要交互模式。", "Quality check requires interactive mode."],
	[
		"请等当前轮次结束后再运行 /review。",
		"Wait for the current turn to finish before running /review.",
	],
	[
		"质量检查循环已在运行，请等待结果",
		"A quality-check loop is already running; wait for the result",
	],
	["质量检查已禁用", "Quality check is disabled"],
	["质量检查中", "Quality check in progress"],
	["质量检查通过", "Quality check passed"],
	["质量检查未通过", "Quality check failed"],
	["质量检查错误", "Quality check error"],
	["质量修复中", "Quality fix in progress"],
	["完成验收中", "Acceptance in progress"],
	["完成验收通过", "Acceptance passed"],
	["完成验收未通过", "Acceptance failed"],
	["质量检查", "quality check"],
	["完成验收", "acceptance"],
	["没有活动目标。", "No active Goal."],
	["当前目录没有目标。", "No Goal in the current directory."],
	["当前目录没有 Flow。", "No Flow in the current directory."],
	[
		"没有待启动的 Flow 计划。先运行 /flow <需求> 生成。",
		"No draft Flow to start. Run /flow <request> first.",
	],
	[
		"当前 Pi 运行环境不支持新建会话，无法启动 Flow。",
		"The current Pi runtime cannot create a new session, so Flow cannot start.",
	],
	["AI 正在运行，稍后再试。", "AI is running; try again later."],
	["目标已继续执行。", "Goal continued."],
	[
		"当前目标不能用 /goal continue 继续。",
		"The current Goal cannot be continued with /goal continue.",
	],
	["当前目录没有运行中的 Flow。", "No running Flow in the current directory."],
	["Flow 没有进行中的步骤。", "Flow has no active step."],
	["Flow 已继续执行。", "Flow continued."],
	["当前会话没有进行中的目标。", "No active Goal in the current session."],
	["当前步骤不在可恢复状态。", "The current step is not resumable."],
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
	["Flow 已完成", "Flow complete"],
	["Flow 已更新", "Flow updated"],
	["Flow 已暂停", "Flow paused"],
	["Flow 已取消", "Flow cancelled"],
	["网页报告", "Web report"],
	["结果卡片发送失败", "Result card send failed"],
	["读取失败", "read failed"],
	["校验失败", "validation failed"],
	["发送失败", "send failed"],
	["启动失败", "start failed"],
	["已暂停", "paused"],
	["已取消", "cancelled"],
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
