import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { hasPrivateWorkerEnvironment } from "./flow/execution/worker-protocol.js";
import { flowOwnerForSession } from "./flow/ownership.js";
import { hasActiveGoalSessionEntry } from "./goal/session-entry.js";
import { readReviewCheckpoint } from "./review/checkpoint.js";
import {
	installLocalizedUi,
	localizeUserText,
	MONITOR_SHORTCUT,
	monitorShortcutDescription,
} from "./shared/ui-language.js";

type ReviewRuntime = typeof import("./review.js");

interface FlowRuntime {
	review: ReviewRuntime;
	goal: typeof import("./goal/runtime.js");
	flow: typeof import("./flow.js");
}

// Flow runtime 是进程级单例：模块实例在 session 重建之间共享（扩展工厂缓存），
// 而每个 session 的 pi 都是新的。一旦加载过，后续每个 session_start 都必须把
// 运行时重新注册到新 pi 上（宿主保证 session_start 先于 withSession 完成），
// 否则 goal/flow 引擎会继续持有已失效 session 的 pi（stale ctx）。
let flowRuntime: FlowRuntime | undefined;
let flowRuntimeLoading: Promise<FlowRuntime> | undefined;

export function registerBootstrap(pi: ExtensionAPI) {
	pi.registerCommand("flow", {
		description:
			localizeUserText("生成并执行单步或多步任务：/flow [需求|path.md]") ??
			"生成并执行单步或多步任务：/flow [需求|path.md]",
		handler: async (args, ctx) => {
			const runtime = await loadFlowRuntime(pi);
			await runtime.flow.handleFlowCommand(pi, args, ctx);
		},
	});
	pi.registerCommand("review", {
		description:
			localizeUserText("运行质检或执行后自动质检") ??
			"运行质检或执行后自动质检",
		handler: async (args, ctx) => {
			const runtime = await loadReviewRuntime(pi);
			await runtime.handleReviewCommand(pi, args, ctx);
		},
	});
	pi.registerCommand("advisor", {
		description: localizeUserText("咨询顾问模型") ?? "咨询顾问模型",
		handler: async (args, ctx) => {
			await loadFlowRuntime(pi);
			const { handleAdvisorCommand } = await import("./advisor.js");
			await handleAdvisorCommand(pi, args, ctx);
		},
	});
	pi.registerShortcut(MONITOR_SHORTCUT.key, {
		description: monitorShortcutDescription(),
		handler: async (ctx) => {
			const { openActiveMonitorOverlay } = await import(
				"./shared/monitor-overlay.js"
			);
			await openActiveMonitorOverlay(ctx);
		},
	});
	pi.on("session_start", (_event, ctx) => handleSessionStart(pi, ctx));
	pi.on("session_info_changed", async (event, ctx) => {
		const { handleSessionNameChange } = await import(
			"./shared/session-name-sync.js"
		);
		handleSessionNameChange(event, ctx);
	});
}

async function handleSessionStart(pi: ExtensionAPI, ctx: ExtensionContext) {
	installLocalizedUi(ctx);
	if (flowRuntime || sessionNeedsFlowRuntime(ctx)) {
		const runtime = await loadFlowRuntime(pi);
		runtime.goal.handleGoalSessionStart(ctx);
		await runtime.review.handleReviewSessionStart(pi, ctx);
		await runtime.flow.handleFlowSessionStart(pi, ctx);
		return;
	}
	if (readReviewCheckpoint(ctx)) {
		const runtime = await loadReviewRuntime(pi);
		await runtime.handleReviewSessionStart(pi, ctx);
	}
}

function sessionNeedsFlowRuntime(ctx: ExtensionContext) {
	return (
		hasPrivateWorkerEnvironment() ||
		hasActiveGoalSessionEntry(ctx) ||
		flowOwnerForSession(ctx) !== undefined
	);
}

async function loadReviewRuntime(pi: ExtensionAPI) {
	const review = flowRuntime ? flowRuntime.review : await import("./review.js");
	review.registerReviewRuntime(pi);
	return review;
}

async function loadFlowRuntime(pi: ExtensionAPI) {
	if (!flowRuntime) {
		flowRuntimeLoading ??= importFlowRuntime();
		let runtime: FlowRuntime;
		try {
			runtime = await flowRuntimeLoading;
		} catch (error) {
			flowRuntimeLoading = undefined;
			throw error;
		}
		registerFlowRuntimeParts(pi, runtime);
		flowRuntime = runtime;
		return runtime;
	}
	registerFlowRuntimeParts(pi, flowRuntime);
	return flowRuntime;
}

function registerFlowRuntimeParts(pi: ExtensionAPI, runtime: FlowRuntime) {
	runtime.review.registerReviewRuntime(pi);
	runtime.goal.registerGoalRuntime(pi);
	runtime.flow.registerFlowRuntime(pi);
}

async function importFlowRuntime(): Promise<FlowRuntime> {
	const [review, goal, flow] = await Promise.all([
		import("./review.js"),
		import("./goal/runtime.js"),
		import("./flow.js"),
	]);
	return { review, goal, flow };
}
