// Promo 用报告投影：当前渲染器渲染 F20 真实运行态。
// 加工：G6 注入顾问介入 demo、默认选中 G6 详情、英文版翻译入镜文案、去遗留建议长列表与 CSP（便于注入选中脚本）。
import {
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const { renderFlowHtml } = await import(join(root, "dist/flow/html.js"));

const en = {
	title: "Land six audit-fix plans and close them out clean",
	goals: [
		[
			"Bring benchmark, eval and packaging checks back to current facts",
			"Schema, config mapping, standalone build and change records all aligned; every acceptance command passed.",
		],
		[
			"Only parallelize write scopes proven disjoint",
			"Original goal complete; the invalid-container gap from the previous round fixed; all gates green.",
		],
		[
			"Report refresh failures no longer drag down the main chain",
			"HTML projection failures isolated from the canonical chain; full regression passed.",
		],
		[
			"One user-level report service shared by every session",
			"Shared user-level report daemon, strict access boundaries, self-contained assets and lifecycle goals all delivered.",
		],
		[
			"Stop safely when a step session is lost instead of re-running",
			"Revision did not lower the bar; lost-session recovery and the original full verification both passed.",
		],
		[
			"Serialize every generation-phase state change under one lock",
			"Revision sound; generation locking, CAS, race and crash recovery all complete.",
		],
		[
			"Final acceptance: all six plans green and closed out",
			"All six plans closed out as a whole, every verification passed, revisions did not lower the bar.",
		],
	],
	handoff:
		"Acceptance criteria were adjusted during execution; re-reviewed at final acceptance.",
};

const advisorAdvice = {
	zh: "两轮都卡在同一处：stop 提交后旧 session 的迟到回调仍能覆盖 canonical 状态。建议不要继续在回调里补条件判断，而是把胜负判定收敛到锁内 CAS：任何 mutation 先重读 revision/session，不匹配即无害退出。红测先复现『stop 先提交、迟到回调后到』的时序，再让实现满足它。",
	en: "Both rounds are stuck on the same spot: after a stop commits, the old session's late callback can still overwrite canonical state. Stop patching conditions inside the callback; converge the verdict into an in-lock CAS instead — every mutation re-reads revision/session first and exits harmlessly on mismatch. Write the red test for the 'stop commits first, late callback lands second' ordering, then make the implementation satisfy it.",
};

const renderDir = join(here, ".render");
rmSync(renderDir, { recursive: true, force: true });
mkdirSync(renderDir, { recursive: true });
cpSync(join(root, ".flow/F20"), renderDir, { recursive: true });

for (const lang of ["zh", "en"]) {
	const flow = JSON.parse(
		readFileSync(join(root, ".flow/F20/flow.json"), "utf8"),
	);
	const g6 = flow.goals[5];
	const advisor = {
		model: "anthropic/claude-fable-5",
		thinking: "xhigh",
		advice: advisorAdvice[lang],
	};
	g6.checks.acceptance.rounds[1].advisor = advisor;
	g6.checks.acceptance.rounds[3].advisor = advisor;
	if (lang === "en") {
		flow.language = "en";
		flow.title = en.title;
		flow.goals.forEach((goal, i) => {
			goal.title = en.goals[i][0];
			if (goal.result?.summary) goal.result.summary = en.goals[i][1];
			if (goal.result?.handoff) goal.result.handoff = en.handoff;
		});
		cpSync(join(here, "G6-goal.en.md"), join(renderDir, g6.file));
	} else {
		cpSync(join(root, ".flow/F20", g6.file), join(renderDir, g6.file));
	}
	const html = renderFlowHtml(renderDir, flow)
		.replace(
			/<div class="mt-4">\s*<p[^>]*>(Remaining suggestions|遗留建议)<\/p>[\s\S]*?<\/ul>\s*<\/div>/,
			"",
		)
		.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
		.replace(
			"</body>",
			`<script>document.querySelector('[data-goal-select="5"]')?.click();</script></body>`,
		);
	writeFileSync(join(here, `report-${lang}.html`), html);
	console.log(lang, "ok");
}
