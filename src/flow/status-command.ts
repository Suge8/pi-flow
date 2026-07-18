import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readAlignmentStateIfExists } from "../shared/generation-state.js";
import { formatError } from "../shared/guards.js";
import { liveReportUrl } from "../shared/report-client.js";
import { formatUserNotice, notifyUser } from "../shared/ui-language.js";
import { flowTargetOrNotify } from "./execution/shared.js";
import { statusText } from "./execution.js";
import { writeFlowHtml } from "./html.js";
import { activeParallelBatchForDir } from "./parallel/batch-runner.js";
import type { FlowState } from "./types.js";

export async function showStatus(
	ctx: ExtensionCommandContext,
	id: string | undefined,
) {
	const location = flowTargetOrNotify(ctx, {
		id,
		command: "status",
		level: "info",
		requireRunning: false,
	});
	if (!location) return;
	if (isPreDraftStatus(location.flow)) {
		notifyUser(
			ctx,
			statusText(location.flow, readAlignmentStateIfExists(location.dir)),
			"info",
			location.flow.language,
		);
		return;
	}
	const activeBatch = activeParallelBatchForDir(location.dir);
	if (activeBatch)
		return notifyStatus(
			ctx,
			activeBatch.flow,
			join(activeBatch.dir, "flow.html"),
		);
	try {
		const htmlPath = writeFlowHtml(location.dir, location.flow);
		return notifyStatus(ctx, location.flow, htmlPath);
	} catch (error) {
		notifyUser(
			ctx,
			flowReportOpenFailedNotice(formatError(error), location.flow.language),
			"info",
			location.flow.language,
		);
	}
}

function flowReportOpenFailedNotice(
	error: string,
	language: FlowState["language"],
) {
	return language === "en"
		? formatUserNotice("⚠️", "Flow report could not open", [error])
		: formatUserNotice("⚠️", "Flow 报告打开失败", [error]);
}

function isPreDraftStatus(flow: FlowState) {
	return (
		flow.goals.length === 0 &&
		(flow.status === "aligning" ||
			flow.status === "generating" ||
			flow.status === "paused")
	);
}

async function notifyStatus(
	ctx: ExtensionCommandContext,
	flow: FlowState,
	htmlPath: string,
) {
	let report: string | undefined;
	let reportError: string | undefined;
	try {
		report = await liveReportUrl(ctx, htmlPath, flow.language);
	} catch (error) {
		reportError = formatError(error);
	}
	notifyUser(
		ctx,
		[
			statusText(flow),
			report
				? flow.language === "en"
					? `🌐 Web report: ${report}`
					: `🌐 网页报告: ${report}`
				: flow.language === "en"
					? `⚠️ Web report unavailable: ${reportError}`
					: `⚠️ 网页报告不可用：${reportError}`,
		].join("\n"),
		"info",
		flow.language,
	);
}
