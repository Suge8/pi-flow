import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { onFlowGoalCompleted } from "./flow/completion.js";
import {
	cancelFlow,
	continueFlow,
	handleGoalCompletionEnd,
	pauseFlow,
	startFlow,
} from "./flow/execution.js";
import {
	clearFlowGeneration,
	consumeFlowClarificationInput,
	handleGenerationEnd,
	showFlowGenerationStatus,
	startFromFile,
	startGeneration,
} from "./flow/generation.js";
import { flowOwnerForSession } from "./flow/ownership.js";
import {
	rememberCompletionFact,
	rememberedFlowContext,
} from "./flow/runtime.js";
import { showStatus } from "./flow/status-command.js";
import { tokenize } from "./flow/util.js";
import { closeFlowGoalWatcher } from "./flow/watcher.js";
import {
	commitGoalFlowRequest,
	pendingGoalFlowRequest,
} from "./goal/generation.js";
import { cancelGoalRecoveryAfterUserAction } from "./goal/runtime.js";
import { setGoalActivityBox } from "./shared/activity-frame.js";
import { generationStartOptions } from "./shared/generation-alignment.js";
import {
	appendVisibleUserInput,
	sendOrchestrationPrompt,
} from "./shared/internal-prompt.js";
import { liveReportUrl } from "./shared/report-server.js";
import {
	installLocalizedUi,
	localizeUserText,
	notifyUser,
} from "./shared/ui-language.js";

export default function flowExtension(pi: ExtensionAPI) {
	onFlowGoalCompleted((fact, emittedCtx) => {
		rememberCompletionFact(fact);
		const ctx = emittedCtx
			? (emittedCtx as ExtensionContext)
			: rememberedFlowContext(fact.sessionFile);
		if (ctx) void handleGoalCompletionEnd(pi, ctx);
	});
	pi.registerCommand("flow", {
		description:
			localizeUserText("把大任务拆成多个步骤依次执行：/flow [需求|path.md]") ??
			"把大任务拆成多个步骤依次执行：/flow [需求|path.md]",
		handler: (args, ctx) =>
			Promise.resolve(handleFlowCommand(pi, args, ctx)).then(() => undefined),
	});
	pi.on("session_start", async (_event, ctx) => {
		await bindOwnedFlowReportStatus(ctx);
	});
	pi.on("agent_end", async (event, ctx) => {
		const generated = await handleGenerationEnd(pi, ctx, event);
		if (generated?.autoStart) {
			const started = await startFlow(
				pi,
				ctx as ExtensionCommandContext,
				generated.id,
			);
			notifyUser(
				ctx,
				generated.language === "en"
					? started
						? `Flow plan generated and started: ${generated.id}`
						: `Flow plan generated, but auto-start failed. Run /flow start ${generated.id}.`
					: started
						? `Flow 计划已生成并启动：${generated.id}`
						: `Flow 计划已生成，但自动启动失败。运行 /flow start ${generated.id}。`,
				started ? "info" : "warning",
				generated.language,
			);
			return;
		}
		await handleGoalCompletionEnd(pi, ctx);
	});
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return;
		const action = consumeFlowClarificationInput(event.text, ctx);
		if (!action) return;
		setGoalActivityBox(ctx, action.activityBox);
		if (action.showUserInput) appendVisibleUserInput(pi, event.text);
		const sent = await sendOrchestrationPrompt(pi, ctx, action.prompt, {
			followUp: true,
			errorPrefix: "Flow 计划澄清提示发送失败",
		});
		if (!sent) clearFlowGeneration(ctx);
		return { action: "handled" as const };
	});
	pi.on("session_shutdown", () => closeFlowGoalWatcher());
}

async function bindOwnedFlowReportStatus(ctx: ExtensionContext) {
	try {
		const owner = flowOwnerForSession(ctx);
		if (owner)
			await liveReportUrl(
				ctx,
				join(owner.dir, "flow.html"),
				owner.flow.language,
			);
	} catch {}
}

async function handleFlowCommand(
	pi: ExtensionAPI,
	args: string,
	ctx: ExtensionCommandContext,
) {
	installLocalizedUi(ctx);
	cancelGoalRecoveryAfterUserAction();
	const tokens = tokenize(args.trim());
	const [command, ...rest] = tokens;
	if (!command) {
		const options = await generationStartOptions(ctx);
		if (!options) return;
		const goalRequest = pendingGoalFlowRequest(ctx);
		const started = await startGeneration(
			pi,
			ctx,
			goalRequest ?? "",
			goalRequest ? "prompt" : "conversation",
			undefined,
			options,
		);
		if (started && goalRequest) commitGoalFlowRequest(ctx);
		return;
	}
	if (command === "start") {
		if (rest.length > 1)
			return ctx.ui.notify("用法：/flow start [id]", "warning");
		return startFlow(pi, ctx, rest[0]);
	}
	if (command === "status") {
		if (rest.length > 1)
			return ctx.ui.notify("用法：/flow status [id]", "warning");
		if (!rest[0] && showFlowGenerationStatus(ctx)) return;
		return showStatus(ctx, rest[0]);
	}
	if (command === "pause") {
		if (rest.length > 0) return ctx.ui.notify("用法：/flow pause", "warning");
		return pauseFlow(ctx);
	}
	if (command === "continue") {
		if (rest.length > 0)
			return ctx.ui.notify("用法：/flow continue", "warning");
		return continueFlow(pi, ctx);
	}
	if (command === "cancel") {
		if (rest.length > 0) return ctx.ui.notify("用法：/flow cancel", "warning");
		if (clearFlowGeneration(ctx))
			return ctx.ui.notify("Flow 计划生成已取消。", "warning");
		return cancelFlow(ctx);
	}
	const options = await generationStartOptions(ctx);
	if (!options) return;
	if (tokens.length === 1 && isFile(ctx.cwd, command))
		return startFromFile(pi, ctx, [command], options);
	return startGeneration(pi, ctx, args.trim(), "prompt", undefined, options);
}

function isFile(cwd: string, path: string) {
	try {
		return lstatSync(resolve(cwd, path)).isFile();
	} catch {
		return false;
	}
}
