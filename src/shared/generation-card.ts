import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { sendResultCard } from "./result-card.js";

type GenerationKind = "flow";

const ALIGNMENT_START_COPY = {
	flow: {
		icon: "🌊",
		title: "开始对齐 Flow",
		lines: ["先确认范围和拆分方式，再生成计划。", "等待 AI 提问。"],
	},
} as const;

export function sendAlignmentStartCard(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "ui">,
	kind: GenerationKind,
) {
	const copy = ALIGNMENT_START_COPY[kind];
	sendResultCard(pi, ctx, [`[${copy.title}]`, ...copy.lines].join("\n"), {
		tone: "neutral",
		result: "启动",
		title: copy.title,
		lines: [...copy.lines],
		icon: copy.icon,
	});
}
