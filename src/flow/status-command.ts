import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { tryReadAlignmentState } from "../shared/generation-state.js";
import { liveReportUrl } from "../shared/report-server.js";
import { notifyUser } from "../shared/ui-language.js";
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
			statusText(location.flow, tryReadAlignmentState(location.dir)),
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
	const htmlPath = writeFlowHtml(location.dir, location.flow);
	return notifyStatus(ctx, location.flow, htmlPath);
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
	const report = await liveReportUrl(ctx, htmlPath, flow.language).catch(
		() => undefined,
	);
	notifyUser(
		ctx,
		[
			statusText(flow),
			report
				? flow.language === "en"
					? `🌐 Web report: ${report}`
					: `🌐 网页报告: ${report}`
				: undefined,
		]
			.filter(Boolean)
			.join("\n"),
		"info",
		flow.language,
	);
}
