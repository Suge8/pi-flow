import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// 用户可见文案防回归。规则：
// 1. src 字符串字面量（剥离 ${...} 插值后）：含中文则禁止大写 `Goal`（schema 字段 currentGoal 除外）
//    及内部词组合黑名单。
// 2. src 全部行（含无中文）：禁裸 `Goal ${...}` 插值（schema 引用写 goals[...]）。
// 3. 用户文档（README）：禁内部词组合，并禁止公开隐藏 status。
// 4. README / AGENTS / runtime contracts / prompts：禁旧 Flow 控制命令回流。
// 5. src Flow execution 模块路径：禁旧控制命令文件名回流。
// 豁免：模型协议文件、历史协议文本检测行（.includes(）、非法值回显（非法：）。
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const EXCLUDED_FILES = new Set([
	"src/flow/prompt.ts",
	"src/shared/session.ts", // 纯模型 transcript 构建
]);
const STRING_BLACKLIST = [
	/(?<!current)Goal/u,
	/\bagent\b/u,
	/interruption/u,
	/\} goals/u,
	/不能 start/u,
	/running flow/u,
	/Flow draft/u,
	/draft goal/u,
	/draft flow/u,
	/非法 (?:flow|goal) status/u,
];
const ANY_LINE_BLACKLIST = [
	/`Goal \$\{/u,
	/\$\{[a-zA-Z.]*\.status\}[^非]/u,
	/kindLabel: "Goal"/u,
	/command:\s*"continue"/u,
	/Flow (?:已取消|cancelled)/u,
];
const SOURCE_PATH_BLACKLIST = [
	/^src\/flow\/execution\/(?:cancel|continue)\.ts$/u,
];
const DOC_BLACKLIST = [
	/session Goal/u,
	/Goal 队列/u,
	/Goal 完成闭环/u,
	/Goal 文件/u,
	/个 Goal/u,
	/单 Goal/u,
	/多 Goal/u,
	/Goal markdown/u,
	/Goal 计划/u,
	/\bsession\b/iu,
	/\bdraft\b/iu,
	/\/flow\s+status\b/u,
];
const FLOW_MODEL_COPY_BLACKLIST = [
	/\/flow\s+(?:start|continue|pause|cancel)\b/u,
	/回复[「"]?开始生成[」"]?/u,
];
const FLOW_STATE_COPY_BLACKLIST = [/\bcancelled\b/u, /已取消/u];
const DOC_FILES = ["README.md"];
const FLOW_MODEL_COPY_FILES = [
	"README.md",
	"AGENTS.md",
	"docs/runtime-contracts.md",
	...promptMarkdownFiles().map((file) => relative(root, file)),
];
const FLOW_PROTOCOL_FILES = [
	"README.md",
	"prompts/en/flow-plan.md",
	"prompts/en/flow-repair.md",
	"prompts/zh/flow-plan.md",
	"prompts/zh/flow-repair.md",
];
const DOC_REVIEWER_THINKING =
	/`off`.*`minimal`.*`low`.*`medium`.*`high`.*`xhigh`/u;
const STRING_LITERAL =
	/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'/gu;

const violations = [];
for (const file of walk(join(root, "src"))) {
	const path = relative(root, file);
	if (EXCLUDED_FILES.has(path)) continue;
	scanSourcePath(path);
	scanSource(path, file);
}
for (const doc of DOC_FILES) scanDoc(doc, join(root, doc));
for (const file of FLOW_MODEL_COPY_FILES)
	scanFlowModelCopy(file, join(root, file), FLOW_MODEL_COPY_BLACKLIST);
for (const file of FLOW_PROTOCOL_FILES)
	scanFlowModelCopy(file, join(root, file), FLOW_STATE_COPY_BLACKLIST);

if (violations.length) {
	console.error(`用户文案残留内部词：\n${violations.join("\n")}`);
	process.exit(1);
}
console.log("copy lint smoke ok");

function scanSourcePath(path) {
	for (const pattern of SOURCE_PATH_BLACKLIST) {
		if (pattern.test(path)) violations.push(`${path} [${pattern}] banned path`);
	}
}

function scanSource(path, file) {
	const lines = readFileSync(file, "utf8").split("\n");
	lines.forEach((line, index) => {
		if (line.includes(".includes(")) return; // 历史协议文本检测，非输出
		if (ignoredByMarker(lines, index)) return; // copy-lint-ignore 行内/上行标记
		if (line.includes("非法：")) return; // 非法值回显属排障必需
		for (const pattern of ANY_LINE_BLACKLIST) {
			if (pattern.test(line))
				violations.push(`${path}:${index + 1} [${pattern}] ${line.trim()}`);
		}
		// notify 是用户通知：硬编码文案禁止英文-only（纯插值转发豁免）。
		const notifyLiteral = line.match(
			/\bnotify\(\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/u,
		);
		if (notifyLiteral) {
			const hardcoded = notifyLiteral[1].replace(/\$\{[^}]*\}/gu, "");
			if (/[a-zA-Z]/u.test(hardcoded) && !/[\u4e00-\u9fff]/u.test(hardcoded))
				violations.push(
					`${path}:${index + 1} [notify 需中文文案] ${notifyLiteral[1]}`,
				);
		}
		for (const literal of line.match(STRING_LITERAL) ?? []) {
			const text = literal.replace(/\$\{[^}]*\}/gu, "");
			if (!/[\u4e00-\u9fff]/u.test(text)) continue;
			for (const pattern of STRING_BLACKLIST) {
				if (pattern.test(text))
					violations.push(`${path}:${index + 1} [${pattern}] ${literal}`);
			}
			// 裸 goal/session 禁止；命令名与文件名 token 豁免。
			const stripped = text.replace(
				/\/flow\b|flow\.json|flow\.html|state\.json|plan\.md/gu,
				"",
			);
			if (/\bgoal\b|\bsession\b/u.test(stripped))
				violations.push(`${path}:${index + 1} [bare goal/session] ${literal}`);
		}
	});
}

function ignoredByMarker(lines, index) {
	return (
		lines[index].includes("copy-lint-ignore") ||
		(index > 0 && lines[index - 1].includes("copy-lint-ignore"))
	);
}

function scanDoc(path, file) {
	const lines = readFileSync(file, "utf8").split("\n");
	lines.forEach((line, index) => {
		for (const pattern of DOC_BLACKLIST) {
			if (pattern.test(line))
				violations.push(`${path}:${index + 1} [${pattern}] ${line.trim()}`);
		}
		if (
			line.trim().startsWith("| `modelRoles.reviewers` |") &&
			!DOC_REVIEWER_THINKING.test(line)
		) {
			violations.push(
				`${path}:${index + 1} [reviewer thinking values] ${line.trim()}`,
			);
		}
	});
}

function scanFlowModelCopy(path, file, patterns) {
	const lines = readFileSync(file, "utf8").split("\n");
	lines.forEach((line, index) => {
		for (const pattern of patterns) {
			if (pattern.test(line))
				violations.push(`${path}:${index + 1} [${pattern}] ${line.trim()}`);
		}
	});
}

function promptMarkdownFiles(dir = join(root, "prompts")) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return promptMarkdownFiles(path);
		return entry.name.endsWith(".md") ? [path] : [];
	});
}

function walk(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return walk(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}
