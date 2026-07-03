const REVIEW = "审查";

const LEGACY_COPY: [string, string][] = [
	[`目标${REVIEW}`, "完成验收"],
	[`状态${REVIEW}`, "完成验收"],
	[`质量${REVIEW}`, "质量检查"],
	[`${REVIEW}模型`, "模型"],
	[`${REVIEW}中`, "检查中"],
	["页面文件", "报告入口"],
	["sessionFile", "运行记录"],
];

export function cleanReportCopy(text: string) {
	let output = text;
	for (const [from, to] of LEGACY_COPY) output = output.replaceAll(from, to);
	const cwd = process.cwd();
	return cwd ? output.replaceAll(cwd, ".") : output;
}
