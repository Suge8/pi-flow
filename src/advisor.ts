import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { quoteCommand } from "./flow/parallel/console.js";
import {
	consultActiveFlowAdvisor,
	type ManualAdvisorResult,
} from "./goal/runtime.js";
import { sendAdvisorCard } from "./shared/advisor-card.js";
import { runtimeLanguage } from "./shared/language.js";
import {
	formatUserNotice,
	installLocalizedUi,
	localizeUserText,
	notifyUser,
} from "./shared/ui-language.js";

export default function advisorExtension(pi: ExtensionAPI) {
	pi.registerCommand("advisor", {
		description: localizeUserText("咨询顾问模型") ?? "咨询顾问模型",
		handler: (args, ctx) => handleAdvisorCommand(pi, args, ctx),
	});
}

export async function handleAdvisorCommand(
	pi: ExtensionAPI,
	args: string,
	ctx: ExtensionCommandContext,
) {
	installLocalizedUi(ctx);
	const language = runtimeLanguage();
	if (args.trim())
		return notifyUser(
			ctx,
			formatUserNotice("⚠️", language === "en" ? "Usage" : "用法", [
				quoteCommand("/advisor"),
			]),
			"info",
			language,
		);
	if (!ctx.hasUI)
		return notifyUser(
			ctx,
			advisorNeedsInteractiveNotice(language),
			"info",
			language,
		);
	if (!ctx.isIdle())
		return notifyUser(
			ctx,
			advisorWaitForIdleNotice(language),
			"info",
			language,
		);
	const result = await consultActiveFlowAdvisor(ctx);
	if (result.kind === "advice") {
		sendManualAdvisorCard(pi, ctx, result);
		return;
	}
	if (result.kind !== "aborted")
		notifyUser(ctx, manualAdvisorNotice(result), "info", result.language);
}

function sendManualAdvisorCard(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	result: Extract<ManualAdvisorResult, { kind: "advice" }>,
) {
	const next =
		result.language === "en"
			? `Next: ${quoteCommand(`/flow go ${result.flowId}`)} continues the Flow and delivers this advice to the executor`
			: `下一步：${quoteCommand(`/flow go ${result.flowId}`)} 继续 Flow，并把建议送给执行模型`;
	return sendAdvisorCard(pi, ctx, {
		advice: result.advice,
		language: result.language,
		next,
	});
}

function manualAdvisorNotice(
	result: Exclude<ManualAdvisorResult, { kind: "advice" | "aborted" }>,
) {
	const en = result.language === "en";
	if (result.kind === "pending")
		return formatUserNotice(
			"🧭",
			en ? "Advisor advice is queued" : "顾问建议已排队",
			[
				en
					? `${quoteCommand(`/flow go ${result.flowId}`)} resumes the step and delivers it`
					: `${quoteCommand(`/flow go ${result.flowId}`)} 恢复步骤并送达执行模型`,
			],
		);
	if (result.kind === "already_advised")
		return formatUserNotice(
			"🧭",
			en ? "This failed round already has advisor advice" : "本轮已有顾问建议",
			[
				en
					? `Open the Flow report to review it · ${quoteCommand(`/flow go ${result.flowId}`)} continues`
					: `可在 Flow 报告中查看 · ${quoteCommand(`/flow go ${result.flowId}`)} 继续`,
			],
		);
	if (result.kind === "parallel")
		return formatUserNotice(
			"🧭",
			en ? "Advisor needs one step" : "顾问需要单一步骤",
			[
				en
					? "The current Flow is running a parallel batch; consult after the batch settles"
					: "当前 Flow 正在并行执行；批次收口后再咨询",
			],
		);
	if (result.kind === "disabled")
		return formatUserNotice("🧭", en ? "Advisor is disabled" : "顾问已关闭", [
			en
				? "Set advisor.enabled to true in config.json"
				: "在 config.json 中将 advisor.enabled 设为 true",
		]);
	if (result.kind === "no_flow")
		return formatUserNotice(
			"🧭",
			en ? "No Flow step to advise" : "没有可咨询的 Flow 步骤",
			[
				en
					? "Run this command in the session that owns the active or paused step"
					: "请在活动或已暂停步骤所属的会话中运行此命令",
			],
		);
	if (result.kind === "no_failure")
		return formatUserNotice(
			"🧭",
			en ? "Nothing for the advisor to diagnose" : "顾问无可诊断项",
			[
				en
					? "The current step has no unresolved failed checks"
					: "当前步骤没有尚未解决的失败检查",
			],
		);
	if (result.kind === "busy") return advisorWaitForIdleNotice(result.language);
	return formatUserNotice(
		"⚠️",
		en ? "Advisor consultation failed" : "顾问咨询失败",
		[result.reason],
	);
}

function advisorNeedsInteractiveNotice(language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("⚠️", "Advisor requires interactive mode", [])
		: formatUserNotice("⚠️", "顾问需要交互模式", []);
}

function advisorWaitForIdleNotice(language: "zh" | "en") {
	return language === "en"
		? formatUserNotice("⏳", "Advisor is waiting", [
				"Run /advisor after the current agent or check finishes",
			])
		: formatUserNotice("⏳", "顾问正在等待", [
				"当前执行或检查结束后再运行 /advisor",
			]);
}
