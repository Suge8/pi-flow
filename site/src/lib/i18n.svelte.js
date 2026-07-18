// Bilingual copy store (Svelte 5 runes). All user-visible strings live here.
const en = {
	"nav.aria": "Switch to Chinese",
	"hero.l1a": "Stop trusting",
	"hero.l1em": "“done.”",
	"hero.l2": "Verify the loop.",
	"hero.sub":
		"Pi Flow wraps your Pi coding agent in a delivery loop — multi-round alignment, an executable plan, live HTML reports, and multi-model adversarial checks that keep fixing until quality actually ships.",
	"hero.gh": "Star on GitHub",
	"hero.note":
		"Zero tool injection · zero production dependencies · Apache-2.0",
	copy: "copy",
	copied: "copied ✓",
	"problem.ghost": "FOUR WAYS",
	"problem.h2": "Long agent tasks<br>die four ways.",
	"problem.p1": "The plan misses what you actually need.",
	"problem.p2": "It claims “done.” It’s hallucinated.",
	"problem.p3": "It ships — and the quality is poor.",
	"problem.p4": "One model plays every role, and underperforms.",
	"problem.out": "Pi Flow closes all four.",
	"loop.h2": "One loop. Six stages.",
	"loop.s1": "Align",
	"loop.s1d":
		"It interrogates your request first — multi-round Q&A until the requirement is nailed, not guessed.",
	"loop.s2": "Plan",
	"loop.s2d":
		"An executable plan with per-step acceptance criteria, written by a model that plans well.",
	"loop.s3": "Execute",
	"loop.s3d":
		"The executor model implements step by step — tracked in a live HTML report the whole way.",
	"loop.s4": "Check",
	"loop.s4d":
		"Multiple reviewer models cross-examine every requirement. No player doubling as referee.",
	"loop.s5": "Advise",
	"loop.s5d":
		"Stuck after failed rounds? An advisor model consults on direction — automatically.",
	"loop.s6": "Ship",
	"loop.s6d":
		"The loop only closes when every check passes. “Done” finally means verified.",
	"loop.back": "check fails → fix → check again",
	"roles.h2": "Every model plays<br>the role it’s best at.",
	"roles.sub":
		'Pin a specialist model to each role in <code>modelRoles</code> — or keep <code>"current"</code> and let Pi Flow use whatever you have selected.',
	"roles.r1t": "Advisor",
	"roles.r1d":
		"Alignment, planning, and direction consults when a step keeps failing.",
	"roles.r2t": "Executor",
	"roles.r2d": "Implements the plan, step by step, in your repo.",
	"roles.r3t": "Reviewers",
	"roles.r3d":
		"Acceptance and quality checks. Read-only — bash to verify, never write.",
	"review.h2": "Adversarial by design.",
	"review.sub":
		"Checks run as isolated read-only subagents with shared evidence — requirements, plan, code, output and every model’s verdict.",
	"review.c1": "Acceptance — per-requirement cross-examination",
	"review.c2": "Quality — iterative multi-agent review",
	"review.c3": "Advisor — automatic consults after 2/4/6/8 failed rounds",
	"evidence.h2": "Evidence, not vibes.",
	"evidence.sub":
		"Every step, every check round, every model’s verdict — in a live local HTML report.",
	"evidence.b1": "step-level progress",
	"evidence.b2": "per-model verdicts",
	"evidence.b3": "runs on 127.0.0.1",
	"compare.h2": "Why not just…?",
	"cmp.r1": "Approach",
	"cmp.r1a": "Pure prompt recognition, zero tools",
	"cmp.r2": "Alignment",
	"cmp.r2a": "Clarifies first, then plans",
	"cmp.r3": "Model roles",
	"cmp.r3a": "Plan · execute · review, separately",
	"cmp.r4": "Acceptance",
	"cmp.r4a": "Multi-model cross-review",
	"cmp.r5": "Evidence",
	"cmp.r5a": "Requirements + code + output + opinions",
	"cmp.r6": "Reports",
	"cmp.r6a": "Live HTML, step-level, traceable",
	"cmp.no1": "tool injection",
	"cmp.no2": "player & referee",
	"cmp.no3": "small model",
	"cmp.no4": "conversation only",
	"cta.h2": "Ship verified.",
	"cta.note":
		"Requires Node.js ≥ 22.19.0 · then <code>/flow your request</code>",
	"doc.title": "Pi Flow — Stop trusting “done.” Verify the loop.",
};

const zh = {
	"nav.aria": "Switch to English",
	"hero.l1a": "别再轻信",
	"hero.l1em": "“做完了”。",
	"hero.l2": "让循环去验证。",
	"hero.sub":
		"Pi Flow 给你的 Pi 编码代理套上一条交付循环——多轮对齐、可执行计划、实时 HTML 报告、多模型对抗检查，循环修复直到真正高质量交付。",
	"hero.gh": "GitHub 加星",
	"hero.note": "零工具注入 · 零生产依赖 · Apache-2.0",
	copy: "复制",
	copied: "已复制 ✓",
	"problem.ghost": "四种死法",
	"problem.h2": "Agent 长任务，<br>常死在四件事上。",
	"problem.p1": "计划遗漏关键信息，不是你真正要的。",
	"problem.p2": "说自己做完了——其实是幻觉。",
	"problem.p3": "交付了，但质量很差。",
	"problem.p4": "单模型硬扛所有角色，效果不佳。",
	"problem.out": "Pi Flow 把这四条全部堵死。",
	"loop.h2": "一个循环，六个阶段。",
	"loop.s1": "对齐",
	"loop.s1d": "先多轮追问澄清，把需求钉死，而不是靠想当然发挥。",
	"loop.s2": "计划",
	"loop.s2d": "生成可执行计划，每一步都带验收标准，由擅长规划的模型来写。",
	"loop.s3": "执行",
	"loop.s3d": "执行模型逐步实现，实时 HTML 报告全程可回溯。",
	"loop.s4": "检查",
	"loop.s4d": "多个审查模型交叉验收，逐项反查，不让球员兼裁判。",
	"loop.s5": "顾问",
	"loop.s5d": "连续失败卡住时，顾问模型自动介入，给出方向建议。",
	"loop.s6": "交付",
	"loop.s6d": "所有检查通过，循环才收口。「完成」终于等于「已验证」。",
	"loop.back": "检查不过 → 修复 → 再检查",
	"roles.h2": "让每个模型<br>只做最擅长的角色。",
	"roles.sub":
		'在 <code>modelRoles</code> 里给每个角色固定擅长它的模型——或写 <code>"current"</code> 沿用当前选择。',
	"roles.r1t": "顾问",
	"roles.r1d": "对齐、生成计划，步骤连续失败时给出方向建议。",
	"roles.r2t": "执行",
	"roles.r2d": "在你的仓库里按计划逐步实现。",
	"roles.r3t": "审查",
	"roles.r3d": "验收与质检。只读——可用 bash 验证，永远不能写。",
	"review.h2": "天生对抗。",
	"review.sub":
		"检查以独立只读子代理运行，共享同一套证据——需求、计划、代码、输出和每个模型的结论。",
	"review.c1": "验收 — 按需求逐项交叉反查",
	"review.c2": "质检 — 多代理循环审查",
	"review.c3": "顾问 — 连续 2/4/6/8 轮失败自动咨询",
	"evidence.h2": "讲证据，不讲感觉。",
	"evidence.sub":
		"每一步、每一轮检查、每个模型的结论，都在本地实时 HTML 报告里。",
	"evidence.b1": "步骤级进度",
	"evidence.b2": "逐模型结论",
	"evidence.b3": "只跑在 127.0.0.1",
	"compare.h2": "为什么不直接用……？",
	"cmp.r1": "实现",
	"cmp.r1a": "纯 Prompt 识别，零工具注入",
	"cmp.r2": "对齐",
	"cmp.r2a": "先追问澄清，再生成计划",
	"cmp.r3": "角色模型",
	"cmp.r3a": "计划 · 执行 · 审查分别指定",
	"cmp.r4": "验收",
	"cmp.r4a": "多模型交叉审查",
	"cmp.r5": "证据",
	"cmp.r5a": "需求 + 代码 + 输出 + 多模型意见",
	"cmp.r6": "报告",
	"cmp.r6a": "实时 HTML，步骤级可回溯",
	"cmp.no1": "工具注入",
	"cmp.no2": "球员兼裁判",
	"cmp.no3": "小模型",
	"cmp.no4": "只看对话",
	"cta.h2": "交付，经过验证。",
	"cta.note": "需要 Node.js ≥ 22.19.0 · 然后 <code>/flow 你的需求</code>",
	"doc.title": "Pi Flow — 别再轻信“做完了”，让循环去验证。",
};

export const DICTS = { en, zh };

const initial =
	(typeof localStorage !== "undefined" &&
		localStorage.getItem("piflow-lang")) ||
	(typeof navigator !== "undefined" && navigator.language.startsWith("zh")
		? "zh"
		: "en");

export const i18n = $state({ lang: initial });

export function t(key) {
	return DICTS[i18n.lang][key] ?? en[key] ?? key;
}

export function setLang(next) {
	i18n.lang = next;
	localStorage.setItem("piflow-lang", next);
	document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
	document.title = t("doc.title");
}
