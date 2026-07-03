import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatError } from "../shared/guards.js";
import { runtimeLanguage } from "../shared/language.js";
import { liveReportUrl } from "../shared/report-server.js";
import { notifyUser } from "../shared/ui-language.js";
import { statusText } from "./execution.js";
import { writeFlowHtml } from "./html.js";
import { findFlow, latestFlow, runningFlow } from "./store.js";
import type { FlowLocation } from "./types.js";
import { validateFlowDir } from "./validator.js";

export async function showStatus(
	ctx: ExtensionCommandContext,
	id: string | undefined,
) {
	let location: FlowLocation | undefined;
	try {
		location = id
			? findFlow(ctx.cwd, id)
			: (runningFlow(ctx.cwd) ??
				latestFlow(ctx.cwd, (flow) => flow.status !== "cancelled"));
	} catch (error) {
		const language = runtimeLanguage();
		return notifyUser(
			ctx,
			language === "en"
				? `flow.json read failed: ${formatError(error)}`
				: `flow.json 读取失败：${formatError(error)}`,
			"error",
			language,
		);
	}
	if (!location) {
		const language = runtimeLanguage();
		return notifyUser(
			ctx,
			language === "en"
				? "No Flow in the current directory."
				: "当前目录没有 Flow。",
			"info",
			language,
		);
	}
	const validation = validateFlowDir(location.dir, location.flow.language);
	if (!validation.ok || !validation.flow) {
		return notifyUser(
			ctx,
			location.flow.language === "en"
				? `Flow validation failed:\n${validation.errors.join("\n")}`
				: `Flow 校验失败：\n${validation.errors.join("\n")}`,
			"error",
			location.flow.language,
		);
	}
	const htmlPath = writeFlowHtml(location.dir, validation.flow);
	const report = await liveReportUrl(
		ctx,
		htmlPath,
		validation.flow.language,
	).catch(() => undefined);
	notifyUser(
		ctx,
		[
			statusText(validation.flow),
			report
				? validation.flow.language === "en"
					? `🌐 Web report: ${report}`
					: `🌐 网页报告: ${report}`
				: undefined,
		]
			.filter(Boolean)
			.join("\n"),
		"info",
		validation.flow.language,
	);
}
