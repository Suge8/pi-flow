import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function readReportText(path: string) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

export function formatElapsedMinutes(elapsedMs: number) {
	const minutes = Math.max(0, elapsedMs) / 60_000;
	const rounded = Math.round(minutes * 10) / 10;
	if (rounded < 0.1) return "<0.1m";
	return rounded < 10 ? `${rounded.toFixed(1)}m` : `${Math.round(minutes)}m`;
}

export function elapsedTimeHtml(elapsedMs: number, liveSince?: number) {
	const live = Number.isFinite(liveSince)
		? ` data-elapsed-since="${liveSince}"`
		: "";
	return `<span${live} class="shrink-0 font-normal tabular-nums text-stone-400 dark:text-stone-500">${formatElapsedMinutes(elapsedMs).replace("<", "&lt;")}</span>`;
}

export function shouldHideTranscriptExpander(
	collapsed: boolean,
	scrollHeight: number,
	clientHeight: number,
) {
	return collapsed && scrollHeight <= clientHeight + 1;
}

export interface StepFlowConnectorGeometry {
	source: { x: number; y: number };
	target: { x: number; y: number };
	gutterLeft: number;
	gutterRight: number;
	sourceCopyLeft: number;
	contentBottom: number;
	channelY: number;
	minimumClearance: number;
}

export interface StepFlowConnectorPath {
	path: string;
	sourceLaneX: number;
	gutterX: number;
	channelY: number;
}

export const STEP_FLOW_MIN_CLEARANCE = 12;
export const STEP_FLOW_ROUGH_OPTIONS = {
	seed: 17,
	roughness: 0.8,
	bowing: 0.4,
	maxRandomnessOffset: 0.8,
	strokeWidth: 1.25,
} as const;

/** 只有全宽单列的自然高度超过右栏时才允许换列。 */
export function stepFlowNeedsColumns(
	rowHeights: number[],
	asideHeight: number,
) {
	if (rowHeights.length < 2) return false;
	const total = rowHeights.reduce(
		(sum, height) => sum + (Number.isFinite(height) ? Math.max(0, height) : 0),
		0,
	);
	return total > Math.max(0, asideHeight);
}

/** 保证已确认超高的可变高步骤最多排成两列。 */
export function stepFlowTargetHeight(
	rowHeights: number[],
	asideHeight: number,
) {
	if (!stepFlowNeedsColumns(rowHeights, asideHeight)) return undefined;
	const heights = rowHeights.map((height) =>
		Number.isFinite(height) ? Math.max(0, height) : 0,
	);
	const total = heights.reduce((sum, height) => sum + height, 0);
	const minimum = Math.max(0, asideHeight);
	let prefix = 0;
	let balanced = total;
	for (const height of heights.slice(0, -1)) {
		prefix += height;
		balanced = Math.min(balanced, Math.max(prefix, total - prefix));
	}
	return Math.ceil(Math.max(minimum, balanced));
}

/** 双列步骤折线的纯几何规划；正文、底部或 gutter 净空不足时不画。 */
export function stepFlowConnectorPath(
	geometry: StepFlowConnectorGeometry,
): StepFlowConnectorPath | undefined {
	const sourceLaneX = geometry.source.x + 2;
	const gutterWidth = geometry.gutterRight - geometry.gutterLeft;
	if (
		geometry.sourceCopyLeft - sourceLaneX < geometry.minimumClearance ||
		geometry.channelY - geometry.contentBottom < geometry.minimumClearance ||
		gutterWidth < geometry.minimumClearance * 2
	)
		return undefined;
	const gutterX = (geometry.gutterLeft + geometry.gutterRight) / 2;
	return {
		path: [
			`M${geometry.source.x},${geometry.source.y}`,
			`C${sourceLaneX},${geometry.source.y} ${sourceLaneX},${geometry.channelY - 8} ${sourceLaneX},${geometry.channelY}`,
			`C${sourceLaneX},${geometry.channelY} ${gutterX - 8},${geometry.channelY} ${gutterX},${geometry.channelY - 8}`,
			`C${gutterX},${geometry.channelY - 12} ${gutterX},${geometry.target.y + 8} ${gutterX},${geometry.target.y + 8}`,
			`C${gutterX},${geometry.target.y + 4} ${geometry.target.x - 4},${geometry.target.y} ${geometry.target.x},${geometry.target.y}`,
		].join(" "),
		sourceLaneX,
		gutterX,
		channelY: geometry.channelY,
	};
}

let logoDataUri: string | undefined;
let tailwindCss: string | undefined;
let roughScript: string | undefined;

export function flowLogoDataUri() {
	if (logoDataUri !== undefined) return logoDataUri;
	try {
		logoDataUri = `data:image/png;base64,${readFileSync(new URL("../../assets/logo.png", import.meta.url)).toString("base64")}`;
	} catch {
		logoDataUri = "";
	}
	return logoDataUri;
}

export function reportHead() {
	const favicon = flowLogoDataUri()
		? `<link rel="icon" type="image/png" href="${flowLogoDataUri()}" />\n`
		: "";
	const script = reportScript();
	return `${contentSecurityPolicy(script)}\n${favicon}${reportStyles()}\n<script>${script}</script>`;
}

function contentSecurityPolicy(script: string) {
	const hash = createHash("sha256").update(script).digest("base64");
	return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'" />`;
}

function reportStyles() {
	return `<style>${reportAsset("report.css")}
html{
color-scheme:light;
--report-page:#fafaf9;
--report-surface:#fff;
--report-surface-soft:rgba(255,255,255,.86);
--report-surface-muted:rgba(245,245,244,.82);
--report-chip:rgba(255,255,255,.82);
--report-chip-hover:#fafaf9;
--report-text:#1c1917;
--report-muted:#57534e;
--report-subtle:#a8a29e;
--report-code:#1c1917;
--report-code-text:#fafaf9;
--ring-subtle:rgba(41,37,36,.08);
--ring-hover:rgba(41,37,36,.12);
--shadow-chip:rgba(41,37,36,.08);
--tone-green-surface:rgba(236,253,245,.9);
--tone-green-surface-hover:rgb(236,253,245);
--tone-blue-surface:rgba(240,249,255,.9);
--tone-blue-surface-hover:rgb(240,249,255);
--tone-amber-surface:rgba(255,251,235,.92);
--tone-amber-surface-hover:rgb(255,251,235);
--tone-red-surface:rgba(255,241,242,.9);
--tone-red-surface-hover:rgb(255,241,242);
--tone-indigo-surface:rgba(238,242,255,.92);
--rough-card:#d8d5cf;
--rough-ring:#e5e3de;
--rough-glow:rgba(41,37,36,.14);
--rough-green:#3d7a44;
--rough-green-card:rgba(61,122,68,.55);
--rough-green-fill:#a9cbae;
--rough-blue:#2477ad;
--rough-blue-card:rgba(36,119,173,.52);
--rough-blue-fill:#a6cce6;
--rough-amber:#a06e00;
--rough-amber-card:rgba(160,110,0,.58);
--rough-amber-fill:#e3ca8b;
--rough-red:#b0413e;
--rough-red-card:rgba(176,65,62,.55);
--rough-red-fill:#e2acaa;
--rough-gray:#a8a29e;
--rough-gray-card:#d8d5cf;
--rough-gray-fill:#dad7d2;
-webkit-font-smoothing:antialiased;
text-rendering:optimizeLegibility
}
html.dark{
color-scheme:dark;
--report-page:#101317;
--report-surface:#1a1f26;
--report-surface-soft:rgba(27,32,39,.96);
--report-surface-muted:rgba(39,46,55,.84);
--report-chip:rgba(43,50,60,.9);
--report-chip-hover:rgba(55,64,76,.94);
--report-text:#f6f7f8;
--report-muted:#cad0d7;
--report-subtle:#939da8;
--report-code:#0c0f13;
--report-code-text:#eef2f6;
--ring-subtle:rgba(185,199,215,.14);
--ring-hover:rgba(185,199,215,.22);
--shadow-chip:rgba(0,0,0,.38);
--tone-green-surface:rgba(31,94,69,.18);
--tone-green-surface-hover:rgba(37,112,82,.28);
--tone-blue-surface:rgba(33,82,121,.2);
--tone-blue-surface-hover:rgba(39,99,145,.3);
--tone-amber-surface:rgba(111,79,25,.2);
--tone-amber-surface-hover:rgba(132,94,29,.3);
--tone-red-surface:rgba(112,46,58,.2);
--tone-red-surface-hover:rgba(132,55,69,.3);
--tone-indigo-surface:rgba(76,70,182,.2);
--rough-card:rgba(217,226,236,.2);
--rough-ring:rgba(217,226,236,.2);
--rough-glow:rgba(105,190,245,.04);
--rough-green:rgba(101,230,169,.62);
--rough-green-card:rgba(101,230,169,.32);
--rough-green-fill:rgba(33,132,91,.34);
--rough-blue:rgba(105,190,245,.64);
--rough-blue-card:rgba(105,190,245,.4);
--rough-blue-fill:rgba(34,115,168,.36);
--rough-amber:rgba(245,192,83,.64);
--rough-amber-card:rgba(245,192,83,.36);
--rough-amber-fill:rgba(144,96,22,.34);
--rough-red:rgba(248,121,139,.64);
--rough-red-card:rgba(248,121,139,.36);
--rough-red-fill:rgba(145,55,70,.36);
--rough-gray:rgba(191,202,214,.72);
--rough-gray-card:rgba(217,226,236,.22);
--rough-gray-fill:rgba(86,96,108,.44)
}
h1{text-wrap:balance}
p,li{text-wrap:pretty}
pre{white-space:pre-wrap;word-break:break-word}
.flow-tooltip{position:fixed;z-index:30;width:max-content;max-width:min(30rem,calc(100vw - 24px));border-radius:14px;background:rgba(255,255,255,.96);padding:.6rem .8rem;color:#57534e;font-size:12.5px;line-height:1.55;text-align:left;white-space:pre-wrap;box-shadow:inset 0 0 0 1px var(--ring-subtle),0 14px 36px rgba(120,113,108,.18);pointer-events:none;user-select:text;opacity:0;filter:blur(1.5px);transform:translate(-50%,calc(-100% + 2px)) scale(.985);transform-origin:center bottom;transition:opacity .18s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1),filter .18s cubic-bezier(.22,1,.36,1),background-color .2s ease,color .2s ease,box-shadow .2s ease;will-change:opacity,transform}
html.dark .flow-tooltip{background:var(--report-surface);color:var(--report-muted);box-shadow:inset 0 0 0 1px var(--ring-subtle),0 14px 36px rgba(0,0,0,.45)}
html.dark .flow-tooltip[data-size="lg"]{color:var(--report-text)}
.flow-tooltip[data-show="true"]{opacity:1;filter:blur(0);pointer-events:auto;transform:translate(-50%,calc(-100% - 6px)) scale(1)}
.flow-tooltip[data-size="lg"]{max-width:min(38rem,calc(100vw - 24px));max-height:min(58vh,30rem);overflow:auto;overscroll-behavior:contain;padding:.85rem 1rem;color:#44403c;font-size:13px;line-height:1.6}
.flow-tooltip[data-side="right"]{transform-origin:left center;transform:translate(-2px,-50%) scale(.985)}
.flow-tooltip[data-side="right"][data-show="true"]{transform:translate(6px,-50%) scale(1)}
.flow-tooltip[data-side="left"]{transform-origin:right center;transform:translate(calc(-100% + 2px),-50%) scale(.985)}
.flow-tooltip[data-side="left"][data-show="true"]{transform:translate(calc(-100% - 6px),-50%) scale(1)}
.flow-tooltip[data-side="top"]{transform-origin:center bottom;transform:translate(-50%,calc(-100% + 2px)) scale(.985)}
.flow-tooltip[data-side="top"][data-show="true"]{transform:translate(-50%,calc(-100% - 6px)) scale(1)}
[data-copy-feedback]{transform:translate(-50%,3px)}
[data-copy-command][data-copy-state="success"] [data-copy-icon]{display:none}
[data-copy-command][data-copy-state="success"] [data-copy-check]{display:inline-flex}
[data-copy-command][data-copy-state="success"] [data-copy-feedback],[data-copy-command][data-copy-state="error"] [data-copy-feedback]{opacity:1;transform:translate(-50%,0)}
[data-copy-command][data-copy-state="error"]{color:#be123c}
[data-copy-command][data-copy-state="error"] [data-copy-feedback]{background:#881337}
[data-rough-card],[data-rough-ring],[data-rough-node],[data-rough-line],[data-rough-seal]{position:relative}
[data-rough-card]{border-radius:18px;background-clip:padding-box}
[data-rough-seal]{border-radius:9999px;background-clip:padding-box}
svg.rough-layer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0}
[data-rough-card]>*:not(svg.rough-layer),[data-rough-ring]>*:not(svg.rough-layer),[data-rough-node]>*:not(svg.rough-layer),[data-rough-seal]>*:not(svg.rough-layer){position:relative;z-index:1}
dialog{position:fixed;inset:auto;left:50%;top:50%;margin:0;border:none;padding:0;background:transparent;max-width:min(92vw,720px);width:100%;max-height:82dvh;transform:translate(-50%,-50%);overflow:visible}
dialog::backdrop{background:rgba(41,37,36,.32);backdrop-filter:blur(5px);opacity:0;transition:opacity .18s cubic-bezier(.2,0,0,1)}
html.dark dialog::backdrop{background:rgba(0,0,0,.55)}
dialog[open].modal-ready::backdrop{opacity:1}
dialog[data-preparing="true"]{visibility:hidden}
dialog [data-modal-shell]{opacity:0;transform:scale(.985);filter:blur(2px);transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1),filter .22s cubic-bezier(.22,1,.36,1)}
dialog.modal-ready [data-modal-shell]{opacity:1;transform:scale(1);filter:blur(0)}
dialog.modal-closing::backdrop{opacity:0}
dialog.modal-closing [data-modal-shell]{opacity:0;transform:scale(.99);filter:blur(2px)}
[data-transcript-body][data-collapsed="true"]{max-height:15rem;overflow:hidden}
[data-transcript-expand][hidden]{display:none!important}
[data-goal-select]{position:relative;border-radius:16px;transition:background-color .22s cubic-bezier(.22,1,.36,1),box-shadow .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)}
[data-goal-select]>*{position:relative;z-index:1}
[data-goal-select][data-goal-tone="gray"]:hover,[data-goal-select][data-goal-tone="gray"][data-selected="true"]:hover{background:rgba(250,250,249,.72);box-shadow:none}
[data-goal-select][data-goal-tone="blue"]:hover,[data-goal-select][data-goal-tone="blue"][data-selected="true"]:hover{background:rgba(240,249,255,.72);box-shadow:none}
[data-goal-select][data-goal-tone="green"]:hover,[data-goal-select][data-goal-tone="green"][data-selected="true"]:hover{background:rgba(236,253,245,.72);box-shadow:none}
html.dark [data-goal-select][data-goal-tone="gray"]:hover,html.dark [data-goal-select][data-goal-tone="gray"][data-selected="true"]:hover{background:var(--report-surface-muted)}
html.dark [data-goal-select][data-goal-tone="blue"]:hover,html.dark [data-goal-select][data-goal-tone="blue"][data-selected="true"]:hover{background:var(--tone-blue-surface)}
html.dark [data-goal-select][data-goal-tone="green"]:hover,html.dark [data-goal-select][data-goal-tone="green"][data-selected="true"]:hover{background:var(--tone-green-surface)}
[data-goal-select][data-selected="true"]{background:transparent;box-shadow:none}
[data-goal-select][data-selected="true"] [data-goal-title]{color:#292524;font-weight:600}
html.dark [data-goal-select][data-selected="true"] [data-goal-title]{color:#f5f5f4}
[data-goal-select][data-parallel-node="true"]{background:transparent;box-shadow:none}
[data-goal-select][data-parallel-node="true"]:hover,[data-goal-select][data-parallel-node="true"][data-selected="true"]:hover{background:transparent;box-shadow:none}
[data-parallel-group]{justify-self:center;border-radius:24px;transition:background-color .22s cubic-bezier(.22,1,.36,1)}
[data-parallel-group][data-tone="gray"]:has([data-goal-select]:hover){background:rgba(250,250,249,.72)}
[data-parallel-group][data-tone="blue"]:has([data-goal-select]:hover){background:rgba(240,249,255,.68)}
[data-parallel-group][data-tone="green"]:has([data-goal-select]:hover){background:rgba(236,253,245,.68)}
html.dark [data-parallel-group][data-tone="gray"]:has([data-goal-select]:hover){background:var(--report-surface-muted)}
html.dark [data-parallel-group][data-tone="blue"]:has([data-goal-select]:hover){background:var(--tone-blue-surface)}
html.dark [data-parallel-group][data-tone="green"]:has([data-goal-select]:hover){background:var(--tone-green-surface)}
[data-goal-panel]>article{container-type:inline-size}
[data-goal-body]{gap:20px}
[data-goal-aside]{min-width:0}
[data-step-node]>[data-step-meta]{max-width:100%}
[data-step-elapsed]{font-size:10px;line-height:1.1;letter-spacing:.035em;color:var(--report-subtle)}
[data-criteria-header]{display:flex;align-items:center;justify-content:space-between;gap:.75rem}
[data-criteria-title]{display:inline-flex;min-width:0;align-items:center;gap:.6rem}
[data-criteria-icon]{display:grid;height:1.75rem;width:1.75rem;flex-shrink:0;place-items:center;border-radius:.5rem;background:var(--tone-blue-surface);color:#0369a1}
html.dark [data-criteria-icon]{color:#7dd3fc}
[data-criteria-title-text]{font-size:1rem;font-weight:600;line-height:1.5rem;color:var(--report-text)}
[data-criteria-count]{flex-shrink:0;font-size:.6875rem;font-weight:500;line-height:1rem;color:var(--report-subtle)}
[data-criteria-list]{min-width:0;margin-top:.8rem}
[data-criteria-list]>div,[data-criteria-list] ul{min-width:0}
[data-criteria-list] ul{display:grid;gap:.7rem}
[data-criteria-list] li{min-width:0;gap:.7rem!important;padding:0!important;font-size:.8125rem;line-height:1.5;color:var(--report-muted)}
[data-criteria-list] li>span:first-child{margin-top:.52rem!important;height:.35rem!important;width:.35rem!important;flex-shrink:0;border-radius:999px;background:#0ea5e9!important;box-shadow:0 0 0 3px rgba(14,165,233,.1)}
[data-criteria-list] li>span:last-child{min-width:0;overflow-wrap:anywhere}
[data-criteria-list] code{white-space:normal;overflow-wrap:anywhere}
html.dark [data-criteria-list] li>span:first-child{background:#38bdf8!important;box-shadow:0 0 0 3px rgba(56,189,248,.12)}
[data-step-fold-source]>[data-rough-line][data-vertical]{display:none!important}
@container (min-width:901px){
[data-goal-body]{grid-template-columns:minmax(0,1fr) 340px;align-items:start}
[data-goal-aside]{position:sticky;top:24px;width:340px;max-width:340px;justify-self:end}
}
@container (min-width:420px) and (max-width:900px){
[data-goal-body]{grid-template-columns:minmax(0,1fr) clamp(220px,42cqi,288px);gap:16px}
[data-goal-aside]{position:static;top:auto;width:100%;max-width:288px;justify-self:end}
[data-goal-aside] [class*="grid-template-columns:repeat(2,max-content)"]{grid-template-columns:max-content!important}
[data-goal-aside] [data-advisor-slot]>span:first-child,[data-goal-aside] [data-advisor-slot]>span:last-child{display:none}
[data-goal-aside] [data-advisor-slot]>span:nth-child(2){min-width:0;max-width:100%;flex-shrink:1;overflow:hidden;white-space:nowrap}
[data-goal-aside] [data-advisor-consulting]>div>span:first-child,[data-goal-aside] [data-advisor-consulting]>div>span:last-child{display:none}
[data-goal-aside] [data-advisor-consulting]>div>span:nth-child(2){min-width:0;max-width:100%;flex-shrink:1;overflow:hidden;white-space:nowrap}
}
@container (max-width:419px){
[data-goal-body]{grid-template-columns:minmax(0,1fr)}
[data-goal-aside]{position:static;top:auto;width:100%;max-width:340px;justify-self:end}
}
[data-parallel-stepper]>*:not(svg.rough-branch-layer),[data-step-flow-container]>*:not(svg.rough-step-flow-layer){position:relative;z-index:1}
svg.rough-branch-layer,svg.rough-step-flow-layer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0}
[data-parallel-divider]{display:none}
[data-goal-panels][data-single="false"]>[data-parallel-divider]{display:flex}
[data-goal-panel][hidden]{display:none}
.goal-panel-enter{animation:panel-in .34s cubic-bezier(.22,1,.36,1) both}
.goal-panel-exit{animation:panel-out .16s cubic-bezier(.4,0,.2,1) both}
[data-goal-panels][data-single="true"]{display:block}
@keyframes panel-in{from{opacity:0;transform:translateY(12px) scale(.99)}}
@keyframes panel-out{to{opacity:0;transform:translateY(-6px) scale(.995)}}
@keyframes pulse-soft{50%{opacity:.4}}
@keyframes spin-soft{to{transform:rotate(360deg)}}
@keyframes rotate-3d-soft{0%,100%{transform:perspective(76px) rotateX(-14deg) rotateY(-34deg) rotateZ(-8deg) scale(.94)}50%{transform:perspective(76px) rotateX(18deg) rotateY(34deg) rotateZ(8deg) scale(1.09)}}
@keyframes bot-soft{0%,100%{transform:translateY(0) scale(1)}35%{transform:translateY(-3px) scale(1.1)}65%{transform:translateY(2px) scale(.96)}}
@keyframes line-redraw{0%{stroke-dasharray:1 80;stroke-dashoffset:24;opacity:.42}28%,72%{stroke-dasharray:80 0;stroke-dashoffset:0;opacity:1}100%{stroke-dasharray:1 80;stroke-dashoffset:-24;opacity:.58}}
@keyframes ring-ink{0%,100%{opacity:.9;filter:drop-shadow(0 0 0 transparent)}50%{opacity:1;filter:drop-shadow(0 0 3px var(--rough-glow))}}
@keyframes rise{from{opacity:0;transform:translateY(10px)}}
.pulse-soft{animation:pulse-soft 1.5s cubic-bezier(.45,0,.55,1) infinite}
.spin-soft{transform-origin:center;animation:spin-soft 1.05s linear infinite}
.rotate-3d-soft{transform-box:fill-box;transform-origin:center;animation:rotate-3d-soft 1.5s cubic-bezier(.45,0,.55,1) infinite}
.bot-soft{transform-box:fill-box;transform-origin:center;animation:bot-soft 1.05s cubic-bezier(.45,0,.55,1) infinite}
.rotate-3d-soft>*{animation:line-redraw 1.5s cubic-bezier(.4,0,.2,1) infinite}
.rotate-3d-soft>*:nth-child(2){animation-delay:.14s}
.rotate-3d-soft>*:nth-child(3){animation-delay:.28s}
[data-rough-ring] .rough-ring-progress{animation:ring-ink 2.6s ease-in-out infinite}
@media (prefers-reduced-motion:no-preference){
main>:not(dialog){animation:rise .55s cubic-bezier(.22,1,.36,1) backwards}
main>:not(dialog):nth-child(2){animation-delay:.05s}
main>:not(dialog):nth-child(3){animation-delay:.1s}
main>:not(dialog):nth-child(4){animation-delay:.15s}
main>:not(dialog):nth-child(n+5){animation-delay:.2s}
}
@media (prefers-reduced-motion:reduce){dialog [data-modal-shell],dialog::backdrop,.flow-tooltip,[data-copy-feedback]{transition:none}[data-transcript-body][data-collapsed="true"]{max-height:none;overflow:visible}[data-transcript-expand]{display:none!important}.flow-tooltip{filter:none;transform:translate(-50%,calc(-100% - 6px))!important}.flow-tooltip[data-side="right"]{transform:translate(6px,-50%)!important}.flow-tooltip[data-side="left"]{transform:translate(calc(-100% - 6px),-50%)!important}.pulse-soft,.spin-soft,.rotate-3d-soft,.bot-soft,.rotate-3d-soft>*,[data-rough-ring] .rough-ring-progress,.goal-panel-enter,.goal-panel-exit{animation:none}}
</style>`;
}

function reportScript() {
	return `${reportThemeBootScript()}
${reportAsset("rough.js")}
(() => {
  const formatElapsedMinutes = ${formatElapsedMinutes.toString()};
  let timer;
  const targets = () => [...document.querySelectorAll("[data-elapsed-since]")];
  const update = () => {
    const now = Date.now();
    targets().forEach((node) => {
      const startedAt = Number(node.dataset.elapsedSince);
      if (Number.isFinite(startedAt)) node.textContent = formatElapsedMinutes(now - startedAt);
    });
  };
  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const start = () => {
    stop();
    if (document.hidden || targets().length === 0) return;
    update();
    timer = setInterval(update, 60_000);
  };
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
  window.addEventListener("DOMContentLoaded", start);
})();

(() => {
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  const events = new EventSource("events");
  events.addEventListener("reload", (event) => {
    try {
      const data = JSON.parse(event.data || "{}");
      if (!data.path || data.path === location.pathname) location.reload();
    } catch {
      location.reload();
    }
  });
})();

(() => {
  const selectGoal = (value) => {
    const deck = document.querySelector("[data-goal-panels]");
    if (!deck) return;
    const indexes = String(value || "").split(",").filter(Boolean);
    const targets = indexes.map((index) => deck.querySelector('[data-goal-panel="' + index + '"]')).filter(Boolean);
    if (targets.length === 0 || targets.every((target) => !target.hidden)) return;
    const current = [...deck.querySelectorAll("[data-goal-panel]:not([hidden])")];
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const show = () => {
      current.forEach((panel) => { panel.hidden = true; panel.classList.remove("goal-panel-exit"); });
      targets.forEach((target) => { target.hidden = false; });
      deck.dataset.single = String(targets.length === 1);
      document.querySelectorAll("[data-goal-select]").forEach((node) => {
        const selected = String(node.dataset.goalSelect || "").split(",").some((index) => indexes.includes(index));
        node.dataset.selected = String(selected);
      });
      if (!reduce) {
        targets.forEach((target) => {
          target.classList.remove("goal-panel-enter");
          void target.offsetWidth;
          target.classList.add("goal-panel-enter");
        });
      }
      window.piFlowDraw && window.piFlowDraw(deck);
    };
    if (reduce || current.length === 0) { show(); return; }
    current.forEach((panel) => panel.classList.add("goal-panel-exit"));
    setTimeout(show, 150);
  };
  const closeModal = (dialog) => {
    if (!dialog || !dialog.open || dialog.classList.contains("modal-closing")) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      dialog.close();
      dialog.classList.remove("modal-ready", "modal-closing");
      delete dialog.dataset.preparing;
      return;
    }
    dialog.classList.remove("modal-ready");
    dialog.classList.add("modal-closing");
    setTimeout(() => {
      dialog.close();
      dialog.classList.remove("modal-closing");
      delete dialog.dataset.preparing;
    }, 180);
  };
  const shouldHideTranscriptExpander = ${shouldHideTranscriptExpander.toString()};
  const syncTranscriptExpanders = (root) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.querySelectorAll("[data-transcript-body]").forEach((body) => {
      const button = body.parentElement?.querySelector("[data-transcript-expand]");
      if (button) {
        button.hidden = shouldHideTranscriptExpander(
          body.dataset.collapsed === "true",
          body.scrollHeight,
          body.clientHeight,
        );
      }
    });
  };
  const openModal = (dialog) => {
    if (!dialog || typeof dialog.showModal !== "function") return;
    dialog.classList.remove("modal-ready", "modal-closing");
    dialog.dataset.preparing = "true";
    dialog.showModal();
    setTimeout(() => {
      try {
        window.piFlowDraw && window.piFlowDraw(dialog);
        syncTranscriptExpanders(dialog);
      } finally {
        delete dialog.dataset.preparing;
        dialog.classList.add("modal-ready");
      }
    }, 0);
  };
  window.addEventListener("load", () => {
    requestAnimationFrame(() => syncTranscriptExpanders(document));
  });
  const copyTimers = new WeakMap();
  const fallbackCopy = (text) => {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.appendChild(area);
    area.select();
    try { return document.execCommand("copy"); }
    catch { return false; }
    finally { area.remove(); }
  };
  const writeClipboard = async (text) => {
    if (!navigator.clipboard) return fallbackCopy(text);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallbackCopy(text);
    }
  };
  const copyCommand = async (button) => {
    const command = button.dataset.copyCommand || "";
    const copied = command ? await writeClipboard(command) : false;
    const state = copied ? "success" : "error";
    const feedback = button.querySelector("[data-copy-feedback]");
    if (feedback) feedback.textContent = copied ? button.dataset.copySuccess : button.dataset.copyFailure;
    button.dataset.copyState = state;
    clearTimeout(copyTimers.get(button));
    copyTimers.set(button, setTimeout(() => {
      delete button.dataset.copyState;
      if (feedback) feedback.textContent = "";
    }, 1400));
  };
  document.addEventListener("cancel", (event) => {
    if (event.target instanceof HTMLDialogElement) {
      event.preventDefault();
      closeModal(event.target);
    }
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const transcriptButton = target?.closest("[data-transcript-expand]");
    if (transcriptButton) {
      const body = transcriptButton.parentElement?.querySelector("[data-transcript-body]");
      if (!body) return;
      const expanding = body.dataset.collapsed === "true";
      body.dataset.collapsed = String(!expanding);
      transcriptButton.setAttribute("aria-expanded", String(expanding));
      const label = transcriptButton.querySelector("[data-transcript-expand-label]");
      if (label) label.textContent = expanding ? transcriptButton.dataset.collapseLabel : transcriptButton.dataset.expandLabel;
      return;
    }
    const copyButton = target?.closest("[data-copy-command]");
    if (copyButton) {
      void copyCommand(copyButton);
      return;
    }
    const selector = target?.closest("[data-goal-select]");
    if (selector) {
      selectGoal(selector.dataset.goalSelect);
      return;
    }
    const opener = target?.closest("[data-modal-open]");
    if (opener) {
      openModal(document.getElementById(opener.dataset.modalOpen));
      return;
    }
    const closer = target?.closest("[data-modal-close]");
    if (closer) {
      closeModal(closer.closest("dialog"));
      return;
    }
    if (event.target instanceof HTMLDialogElement) closeModal(event.target);
  });
})();

(() => {
  let tip;
  let hideTimer;
  let activeNode = null;
  const clearHide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = undefined;
  };
  const hide = () => {
    clearHide();
    activeNode = null;
    if (tip) tip.dataset.show = "false";
  };
  const scheduleHide = () => {
    clearHide();
    hideTimer = setTimeout(hide, 160);
  };
  const ensure = () => {
    if (tip) return tip;
    tip = document.createElement("div");
    tip.className = "flow-tooltip";
    tip.dataset.show = "false";
    tip.dataset.side = "top";
    tip.addEventListener("mouseenter", clearHide);
    tip.addEventListener("mouseleave", scheduleHide);
    document.body.appendChild(tip);
    return tip;
  };
  const place = (el, node) => {
    const rect = node.getBoundingClientRect();
    const requestedSide = node.dataset.tooltipSide || "top";
    el.dataset.side = requestedSide === "auto" ? (rect.left + rect.width / 2 < window.innerWidth / 2 ? "right" : "left") : requestedSide;
    const margin = 12;
    const width = el.offsetWidth || 240;
    const height = el.offsetHeight || 80;
    const middle = Math.min(window.innerHeight - margin - height / 2, Math.max(margin + height / 2, rect.top + rect.height / 2));
    if (el.dataset.side === "right") {
      el.style.left = Math.min(window.innerWidth - margin - width, rect.right + 10) + "px";
      el.style.top = middle + "px";
      return;
    }
    if (el.dataset.side === "left") {
      el.style.left = Math.max(margin + width, rect.left - 10) + "px";
      el.style.top = middle + "px";
      return;
    }
    el.style.left = Math.min(window.innerWidth - margin - width / 2, Math.max(margin + width / 2, rect.left + rect.width / 2)) + "px";
    el.style.top = Math.max(margin + 40, rect.top - 10) + "px";
  };
  /** 换触发器时硬复位再进场，避免共用 tip 在中途改 side/内容导致进出播不全。 */
  const show = (node) => {
    const text = node.dataset.tooltip;
    if (!text) return;
    clearHide();
    const el = ensure();
    const wasHidden = el.dataset.show !== "true";
    const nodeChanged = activeNode !== node;
    activeNode = node;
    el.textContent = text;
    el.dataset.size = node.dataset.tooltipSize || "sm";
    if (wasHidden || nodeChanged) {
      el.style.transition = "none";
      el.dataset.show = "false";
      place(el, node);
      void el.offsetWidth;
      el.style.transition = "";
      void el.offsetWidth;
      el.dataset.show = "true";
      return;
    }
    place(el, node);
    el.dataset.show = "true";
  };
  const tooltipNode = (event) => event.target instanceof Element ? event.target.closest("[data-tooltip]") : null;
  document.addEventListener("mouseover", (event) => {
    const node = tooltipNode(event);
    if (node) show(node);
  });
  document.addEventListener("focusin", (event) => {
    const node = tooltipNode(event);
    if (node) show(node);
  });
  document.addEventListener("mouseout", (event) => {
    const node = tooltipNode(event);
    if (!node) return;
    const next = event.relatedTarget;
    if (next instanceof Node && (node.contains(next) || tip?.contains(next))) return;
    // 直接滑到另一个触发器：交给 mouseover 换场，不先播退出
    if (next instanceof Element && next.closest("[data-tooltip]")) return;
    scheduleHide();
  });
  document.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Element && next.closest("[data-tooltip]")) return;
    scheduleHide();
  });
  const hideOnScroll = (event) => {
    if (tip && event.target instanceof Node && tip.contains(event.target)) return;
    hide();
  };
  window.addEventListener("scroll", hideOnScroll, true);
})();

(() => {
  const KEY = "pi-flow-theme";
  const root = document.documentElement;
  const effective = () => {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };
  const syncToggle = () => {
    const dark = root.classList.contains("dark");
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      btn.setAttribute("aria-label", dark ? (btn.dataset.labelLight || "") : (btn.dataset.labelDark || ""));
    });
  };
  const apply = (theme) => {
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    syncToggle();
    window.piFlowDraw && window.piFlowDraw();
  };
  document.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest("[data-theme-toggle]") : null;
    if (!btn) return;
    const next = effective() === "dark" ? "light" : "dark";
    localStorage.setItem(KEY, next);
    apply(next);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (localStorage.getItem(KEY)) return;
    apply(effective());
  });
  window.addEventListener("DOMContentLoaded", syncToggle);
  syncToggle();
})();

window.piFlowDraw = (root = document) => {
  if (!window.rough) return;
  const stepFlowConnectorPath = ${stepFlowConnectorPath.toString()};
  const stepFlowNeedsColumns = ${stepFlowNeedsColumns.toString()};
  const stepFlowTargetHeight = ${stepFlowTargetHeight.toString()};
  const stepFlowRoughOptions = ${JSON.stringify(STEP_FLOW_ROUGH_OPTIONS)};
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  const toneValue = (name) => ({
    stroke: token("--rough-" + name),
    card: token("--rough-" + name + "-card"),
    fill: token("--rough-" + name + "-fill")
  });
  const TONES = {
    green: toneValue("green"),
    blue: toneValue("blue"),
    amber: toneValue("amber"),
    red: toneValue("red"),
    gray: toneValue("gray")
  };
  const cardStroke = token("--rough-card");
  const ringBase = token("--rough-ring");
  const tone = (el) => TONES[el.dataset.tone] || TONES.gray;
  const pct = (el) => Math.max(0, Math.min(100, Number(el.dataset.percent) || 0));
  const cssRadius = (el, fallback) => {
    const value = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius);
    return Number.isFinite(value) ? value : fallback;
  };
  const roundedRectPath = (x, y, w, h, r) => {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    return "M" + (x + radius) + "," + y + "H" + (x + w - radius) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + radius) + "V" + (y + h - radius) + "Q" + (x + w) + "," + (y + h) + " " + (x + w - radius) + "," + (y + h) + "H" + (x + radius) + "Q" + x + "," + (y + h) + " " + x + "," + (y + h - radius) + "V" + (y + radius) + "Q" + x + "," + y + " " + (x + radius) + "," + y + "Z";
  };
  const layer = (el) => {
    el.querySelectorAll(":scope > svg.rough-layer").forEach((node) => node.remove());
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("rough-layer");
    svg.setAttribute("viewBox", "0 0 " + rect.width + " " + rect.height);
    svg.setAttribute("preserveAspectRatio", "none");
    el.prepend(svg);
    return { add: (n) => svg.appendChild(n), rc: rough.svg(svg), w: rect.width, h: rect.height };
  };
  const each = (selector, draw) => {
    const nodes = root instanceof Element && root.matches(selector)
      ? [root, ...root.querySelectorAll(selector)]
      : [...root.querySelectorAll(selector)];
    nodes.forEach((el) => {
      const s = layer(el);
      if (s) draw(el, s);
    });
  };
  const point = (el, base, side) => {
    const rect = el.getBoundingClientRect();
    const x = side === "right" ? rect.right : side === "left" ? rect.left : rect.left + rect.width / 2;
    return { x: x - base.left, y: rect.top + rect.height / 2 - base.top };
  };
  const matching = (scope, selector) => scope instanceof Element && scope.matches(selector)
    ? [scope, ...scope.querySelectorAll(selector)]
    : [...scope.querySelectorAll(selector)];
  const layoutStepFlows = (scope) => {
    const connectors = [];
    matching(scope, "[data-step-flow-container]").forEach((container) => {
      container.querySelectorAll(":scope > svg.rough-step-flow-layer").forEach((node) => node.remove());
      const flow = container.querySelector(":scope > [data-step-flow]");
      if (!flow) return;
      const rows = [...flow.children];
      flow.querySelectorAll("[data-step-fold-source]").forEach((row) => delete row.dataset.stepFoldSource);
      flow.style.position = "";
      flow.style.height = "";
      container.style.height = "";
      rows.forEach((row) => {
        row.style.position = "";
        row.style.left = "";
        row.style.top = "";
        row.style.width = "";
      });
      if (container.offsetParent === null) return;
      const body = container.closest("[data-goal-body]");
      const aside = body?.querySelector(":scope > [data-goal-aside]");
      if (!body || !aside || body.getBoundingClientRect().width <= 900) return;
      const asideHeight = aside.getBoundingClientRect().height;
      const naturalRowHeights = rows.map((row) => row.getBoundingClientRect().height);
      if (!stepFlowNeedsColumns(naturalRowHeights, asideHeight)) return;
      const flowWidth = flow.getBoundingClientRect().width;
      const columnWidth = (flowWidth - 48) / 2;
      rows.forEach((row) => { row.style.width = columnWidth + "px"; });
      const rowHeights = rows.map((row) => row.getBoundingClientRect().height);
      const targetHeight = stepFlowTargetHeight(rowHeights, asideHeight);
      if (targetHeight === undefined) {
        rows.forEach((row) => { row.style.width = ""; });
        return;
      }
      let targetIndex = 0;
      let firstHeight = 0;
      while (targetIndex < rows.length - 1 && firstHeight + rowHeights[targetIndex] <= targetHeight) {
        firstHeight += rowHeights[targetIndex];
        targetIndex += 1;
      }
      if (targetIndex === 0) targetIndex = 1;
      flow.style.position = "relative";
      flow.style.height = targetHeight + "px";
      container.style.height = targetHeight + "px";
      let leftTop = 0;
      let rightTop = 0;
      rows.forEach((row, index) => {
        const right = index >= targetIndex;
        row.style.position = "absolute";
        row.style.left = (right ? columnWidth + 48 : 0) + "px";
        row.style.top = (right ? rightTop : leftTop) + "px";
        if (right) rightTop += rowHeights[index];
        else leftTop += rowHeights[index];
      });
      const sourceRow = rows[targetIndex - 1];
      const targetRow = rows[targetIndex];
      const sourceNode = sourceRow.querySelector("[data-rough-node]");
      const targetNode = targetRow.querySelector("[data-rough-node]");
      const sourceCopy = sourceRow.querySelector("[data-step-copy]");
      if (!sourceNode || !targetNode || !sourceCopy) return;
      const rect = container.getBoundingClientRect();
      const source = point(sourceNode, rect, "right");
      const target = point(targetNode, rect, "left");
      const sourceRect = sourceRow.getBoundingClientRect();
      const targetRect = targetRow.getBoundingClientRect();
      const copyNodes = [...sourceRow.querySelectorAll("[data-step-copy], [data-step-detail]")];
      const route = stepFlowConnectorPath({
        source,
        target,
        gutterLeft: sourceRect.right - rect.left,
        gutterRight: targetRect.left - rect.left,
        sourceCopyLeft: sourceCopy.getBoundingClientRect().left - rect.left,
        contentBottom: Math.max(...copyNodes.map((node) => node.getBoundingClientRect().bottom - rect.top), source.y),
        channelY: flow.getBoundingClientRect().bottom - rect.top - 12,
        minimumClearance: ${STEP_FLOW_MIN_CLEARANCE}
      });
      if (!route) return;
      sourceRow.dataset.stepFoldSource = "";
      connectors.push({ container, sourceNode, route });
    });
    return connectors;
  };
  const drawStepFlowConnector = (connectors) => {
    connectors.forEach(({ container, sourceNode, route }) => {
      const rect = container.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("rough-step-flow-layer");
      svg.setAttribute("viewBox", "0 0 " + rect.width + " " + rect.height);
      svg.setAttribute("preserveAspectRatio", "none");
      container.prepend(svg);
      const stroke = sourceNode.dataset.tone === "green" ? TONES.green.stroke : TONES.gray.stroke;
      svg.appendChild(rough.svg(svg).path(route.path, { ...stepFlowRoughOptions, stroke }));
    });
  };
  const drawParallelConnectors = (scope) => {
    const steppers = matching(scope, "[data-parallel-stepper]");
    steppers.forEach((stepper) => {
      stepper.querySelectorAll(":scope > svg.rough-branch-layer").forEach((node) => node.remove());
      const rect = stepper.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("rough-branch-layer");
      svg.setAttribute("viewBox", "0 0 " + rect.width + " " + rect.height);
      svg.setAttribute("preserveAspectRatio", "none");
      stepper.prepend(svg);
      const rc = rough.svg(svg);
      const before = [...stepper.querySelectorAll("[data-parallel-before] [data-step-node]")].at(-1);
      const after = stepper.querySelector("[data-parallel-after] [data-step-node]");
      const branches = [...stepper.querySelectorAll("[data-parallel-branch] [data-step-node]")];
      if (branches.length === 0) return;
      const t = tone(stepper);
      const options = { stroke: t.stroke, strokeWidth: 1.45, roughness: 1.45, bowing: 1.2 };
      const source = before ? point(before, rect, "right") : { x: 18, y: rect.height / 2 };
      const target = after ? point(after, rect, "left") : { x: rect.width - 18, y: rect.height / 2 };
      branches.forEach((branch) => {
        const left = point(branch, rect, "left");
        const right = point(branch, rect, "right");
        svg.appendChild(rc.line(source.x + 7, source.y, left.x - 7, left.y, options));
        svg.appendChild(rc.line(right.x + 7, right.y, target.x - 7, target.y, options));
      });
    });
  };
  const stepFlowConnectors = layoutStepFlows(root);
  each("[data-rough-card]", (el, s) => {
    const t = TONES[el.dataset.tone];
    const inset = 1.5;
    s.add(s.rc.path(roundedRectPath(inset, inset, s.w - inset * 2, s.h - inset * 2, cssRadius(el, 18) - inset), { stroke: t ? t.card : cardStroke, strokeWidth: t ? 1.35 : 1.1, roughness: 1.4, bowing: 1.2 }));
  });
  each("[data-rough-ring]", (el, s) => {
    const t = tone(el), p = pct(el), c = s.w / 2, d = s.w - 14;
    const base = s.rc.circle(c, c, d, { stroke: ringBase, strokeWidth: 1.9, roughness: 1.6 });
    base.classList.add("rough-ring-base");
    s.add(base);
    if (p >= 100) {
      const progress = s.rc.circle(c, c, d, { stroke: t.stroke, strokeWidth: 4.6, roughness: 1.6 });
      progress.classList.add("rough-ring-progress");
      s.add(progress);
    } else if (p > 0) {
      const progress = s.rc.arc(c, c, d, d, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p / 100, false, { stroke: t.stroke, strokeWidth: 4.6, roughness: 1.3 });
      progress.classList.add("rough-ring-progress");
      s.add(progress);
    }
  });
  each("[data-rough-node]", (el, s) => {
    const t = tone(el), d = Math.min(s.w, s.h) - 5;
    const options = { stroke: t.stroke, strokeWidth: 1.6, roughness: 1.3 };
    if (el.dataset.fill === "solid") Object.assign(options, { fill: t.fill, fillStyle: "hachure", hachureGap: 3.5, fillWeight: 1.1 });
    s.add(s.rc.circle(s.w / 2, s.h / 2, d, options));
  });
  each("[data-rough-line]", (el, s) => {
    const t = tone(el);
    if (el.dataset.vertical !== undefined) s.add(s.rc.line(s.w / 2, 1, s.w / 2, s.h - 1, { stroke: t.stroke, strokeWidth: 1.3, roughness: 1.2, bowing: 0.6 }));
    else s.add(s.rc.line(1, s.h / 2, s.w - 1, s.h / 2, { stroke: t.stroke, strokeWidth: 1.4, roughness: 1.8, bowing: 2 }));
  });
  each("[data-rough-seal]", (el, s) => {
    const inset = 1;
    s.add(s.rc.path(roundedRectPath(inset, inset, s.w - inset * 2, s.h - inset * 2, cssRadius(el, s.h / 2) - inset), { stroke: tone(el).stroke, strokeWidth: 1.1, roughness: 1.7, bowing: 1.8 }));
  });
  drawParallelConnectors(root);
  drawStepFlowConnector(stepFlowConnectors);
};
(() => {
  let frame = 0;
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => window.piFlowDraw());
  };
  window.addEventListener("load", () => {
    document.querySelectorAll("[data-goal-aside]").forEach((aside) => new ResizeObserver(redraw).observe(aside));
    redraw();
  });
  window.addEventListener("resize", redraw);
})();`;
}

function reportThemeBootScript() {
	return `(()=>{const k="pi-flow-theme";const s=localStorage.getItem(k);const dark=s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);const root=document.documentElement;root.classList.toggle("dark",dark);root.dataset.theme=dark?"dark":"light";})();`;
}

function reportAsset(name: "report.css" | "rough.js") {
	if (name === "report.css" && tailwindCss !== undefined) return tailwindCss;
	if (name === "rough.js" && roughScript !== undefined) return roughScript;
	const value = readFileSync(
		new URL(`../assets/${name}`, import.meta.url),
		"utf8",
	);
	if (name === "report.css") tailwindCss = value;
	else roughScript = value;
	return value;
}
