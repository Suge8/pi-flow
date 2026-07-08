import { readFileSync } from "node:fs";

export function readReportText(path: string) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

let logoDataUri: string | undefined;

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
	return `${favicon}${reportStyles()}\n${reportScripts()}`;
}

function reportStyles() {
	return `<style>
html{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
details>summary{cursor:pointer;list-style:none}
details>summary::-webkit-details-marker{display:none}
h1{text-wrap:balance}
p,li{text-wrap:pretty}
pre{white-space:pre-wrap;word-break:break-word}
.flow-tooltip{position:fixed;z-index:30;max-width:min(28rem,calc(100vw - 24px));transform:translate(-50%,calc(-100% - 4px));border-radius:14px;background:rgba(255,255,255,.96);padding:.55rem .7rem;color:#57534e;font-size:12px;line-height:1.45;text-align:left;white-space:pre-wrap;box-shadow:inset 0 0 0 1px rgba(41,37,36,.08),0 14px 36px rgba(120,113,108,.18);pointer-events:none;user-select:text;opacity:0;transition:opacity .18s cubic-bezier(.22,1,.36,1)}
.flow-tooltip[data-show="true"]{opacity:1;pointer-events:auto}
.flow-tooltip[data-size="lg"]{max-width:min(44rem,calc(100vw - 24px));max-height:min(60vh,32rem);overflow:auto;overscroll-behavior:contain;padding:.85rem 1rem;color:#44403c;font-size:14px;line-height:1.62}
.flow-tooltip[data-side="right"]{transform:translate(4px,-50%)}
.flow-tooltip[data-side="right"][data-show="true"]{opacity:1}
.flow-tooltip[data-side="left"]{transform:translate(calc(-100% - 4px),-50%)}
.flow-tooltip[data-side="left"][data-show="true"]{opacity:1}
[data-rough-card],[data-rough-ring],[data-rough-node],[data-rough-line],[data-rough-seal]{position:relative}
[data-rough-card]{border-radius:18px;background-clip:padding-box}
[data-rough-seal]{border-radius:9999px;background-clip:padding-box}
svg.rough-layer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0}
[data-rough-card]>*:not(svg.rough-layer),[data-rough-ring]>*:not(svg.rough-layer),[data-rough-node]>*:not(svg.rough-layer),[data-rough-seal]>*:not(svg.rough-layer){position:relative;z-index:1}
dialog{position:fixed;inset:auto;left:50%;top:50%;margin:0;border:none;padding:0;background:transparent;max-width:min(92vw,720px);width:100%;max-height:82dvh;transform:translate(-50%,-50%);overflow:visible}
dialog::backdrop{background:rgba(41,37,36,.32);backdrop-filter:blur(5px);opacity:0;transition:opacity .18s cubic-bezier(.2,0,0,1)}
dialog[open].modal-ready::backdrop{opacity:1}
dialog[data-preparing="true"]{visibility:hidden}
dialog [data-modal-shell]{opacity:0;transform:scale(.985);filter:blur(2px);transition:opacity .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1),filter .22s cubic-bezier(.22,1,.36,1)}
dialog.modal-ready [data-modal-shell]{opacity:1;transform:scale(1);filter:blur(0)}
dialog.modal-closing::backdrop{opacity:0}
dialog.modal-closing [data-modal-shell]{opacity:0;transform:scale(.99);filter:blur(2px)}
[data-goal-select]{position:relative;border-radius:16px;transition:background-color .22s cubic-bezier(.22,1,.36,1),box-shadow .22s cubic-bezier(.22,1,.36,1),transform .22s cubic-bezier(.22,1,.36,1)}
[data-goal-select]>*{position:relative;z-index:1}
[data-goal-select][data-goal-tone="gray"]:hover,[data-goal-select][data-goal-tone="gray"][data-selected="true"]:hover{background:rgba(250,250,249,.72);box-shadow:none}
[data-goal-select][data-goal-tone="blue"]:hover,[data-goal-select][data-goal-tone="blue"][data-selected="true"]:hover{background:rgba(240,249,255,.72);box-shadow:none}
[data-goal-select][data-goal-tone="green"]:hover,[data-goal-select][data-goal-tone="green"][data-selected="true"]:hover{background:rgba(236,253,245,.72);box-shadow:none}
[data-goal-select][data-selected="true"]{background:transparent;box-shadow:none}
[data-goal-select][data-selected="true"] [data-goal-title]{color:#292524;font-weight:600}
[data-goal-select][data-parallel-node="true"]{background:transparent;box-shadow:none}
[data-goal-select][data-parallel-node="true"]:hover,[data-goal-select][data-parallel-node="true"][data-selected="true"]:hover{background:transparent;box-shadow:none}
[data-parallel-group]{justify-self:center;border-radius:24px;transition:background-color .22s cubic-bezier(.22,1,.36,1)}
[data-parallel-group][data-tone="gray"]:has([data-goal-select]:hover){background:rgba(250,250,249,.72)}
[data-parallel-group][data-tone="blue"]:has([data-goal-select]:hover){background:rgba(240,249,255,.68)}
[data-parallel-group][data-tone="green"]:has([data-goal-select]:hover){background:rgba(236,253,245,.68)}
[data-parallel-stepper]>*:not(svg.rough-branch-layer){position:relative;z-index:1}
svg.rough-branch-layer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0}
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
@keyframes ring-ink{0%,100%{opacity:.9;filter:drop-shadow(0 0 0 rgba(41,37,36,0))}50%{opacity:1;filter:drop-shadow(0 0 3px rgba(41,37,36,.14))}}
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
@media (prefers-reduced-motion:reduce){dialog [data-modal-shell],dialog::backdrop{transition:none}.pulse-soft,.spin-soft,.rotate-3d-soft,.bot-soft,.rotate-3d-soft>*,[data-rough-ring] .rough-ring-progress,.goal-panel-enter,.goal-panel-exit{animation:none}}
</style>`;
}

function reportScripts() {
	return `<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/roughjs@4/bundled/rough.min.js" defer></script>
<script>
(() => {
  const KEY = "pi-flow-details:" + location.pathname;
  window.addEventListener("beforeunload", () => {
    const state = {};
    document.querySelectorAll("details[data-key]").forEach((node) => {
      state[node.dataset.key] = node.open;
    });
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  });
  window.addEventListener("DOMContentLoaded", () => {
    let state;
    try { state = JSON.parse(sessionStorage.getItem(KEY) || "{}"); } catch { return; }
    document.querySelectorAll("details[data-key]").forEach((node) => {
      if (node.dataset.key in state) node.open = state[node.dataset.key];
    });
  });
})();
</script>
<script>
(() => {
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  const events = new EventSource("/events");
  events.addEventListener("reload", (event) => {
    try {
      const data = JSON.parse(event.data || "{}");
      if (!data.path || data.path === location.pathname) location.reload();
    } catch {
      location.reload();
    }
  });
})();
</script>
<script>
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
  const openModal = (dialog) => {
    if (!dialog || typeof dialog.showModal !== "function") return;
    dialog.classList.remove("modal-ready", "modal-closing");
    dialog.dataset.preparing = "true";
    dialog.showModal();
    setTimeout(() => {
      try { window.piFlowDraw && window.piFlowDraw(dialog); } finally {
        delete dialog.dataset.preparing;
        dialog.classList.add("modal-ready");
      }
    }, 0);
  };
  document.addEventListener("cancel", (event) => {
    if (event.target instanceof HTMLDialogElement) {
      event.preventDefault();
      closeModal(event.target);
    }
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
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
</script>
<script>
(() => {
  let tip;
  let hideTimer;
  const clearHide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = undefined;
  };
  const hide = () => {
    clearHide();
    if (tip) tip.dataset.show = "false";
  };
  const scheduleHide = () => {
    clearHide();
    hideTimer = setTimeout(hide, 180);
  };
  const ensure = () => {
    if (tip) return tip;
    tip = document.createElement("div");
    tip.className = "flow-tooltip";
    tip.addEventListener("mouseenter", clearHide);
    tip.addEventListener("mouseleave", scheduleHide);
    document.body.appendChild(tip);
    return tip;
  };
  const show = (node) => {
    const text = node.dataset.tooltip;
    if (!text) return;
    clearHide();
    const el = ensure();
    el.textContent = text;
    el.dataset.size = node.dataset.tooltipSize || "sm";
    el.dataset.show = "true";
    const rect = node.getBoundingClientRect();
    const requestedSide = node.dataset.tooltipSide || "top";
    el.dataset.side = requestedSide === "auto" ? (rect.left + rect.width / 2 < window.innerWidth / 2 ? "right" : "left") : requestedSide;
    const margin = 12;
    const width = el.offsetWidth || 240;
    const height = el.offsetHeight || 80;
    const middle = Math.min(window.innerHeight - margin - height / 2, Math.max(margin + height / 2, rect.top + rect.height / 2));
    if (el.dataset.side === "right") {
      const left = Math.min(window.innerWidth - margin - width, rect.right + 10);
      el.style.left = left + "px";
      el.style.top = middle + "px";
      return;
    }
    if (el.dataset.side === "left") {
      const left = Math.max(margin + width, rect.left - 10);
      el.style.left = left + "px";
      el.style.top = middle + "px";
      return;
    }
    const left = Math.min(window.innerWidth - margin - width / 2, Math.max(margin + width / 2, rect.left + rect.width / 2));
    const top = Math.max(margin + 40, rect.top - 10);
    el.style.left = left + "px";
    el.style.top = top + "px";
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
    scheduleHide();
  });
  document.addEventListener("focusout", scheduleHide);
  window.addEventListener("scroll", hide, true);
})();
</script>
<script>
window.piFlowDraw = (root = document) => {
  if (!window.rough) return;
  const TONES = {
    green: { stroke: "#3D7A44", fill: "#A9CBAE" },
    blue: { stroke: "#2477AD", fill: "#A6CCE6" },
    amber: { stroke: "#A06E00", fill: "#E3CA8B" },
    red: { stroke: "#B0413E", fill: "#E2ACAA" },
    gray: { stroke: "#A8A29E", fill: "#DAD7D2" }
  };
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
  const drawParallelConnectors = (scope) => {
    const steppers = scope instanceof Element && scope.matches("[data-parallel-stepper]")
      ? [scope, ...scope.querySelectorAll("[data-parallel-stepper]")]
      : [...scope.querySelectorAll("[data-parallel-stepper]")];
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
      const options = { stroke: t.stroke, strokeWidth: 1.7, roughness: 1.45, bowing: 1.2 };
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
  each("[data-rough-card]", (el, s) => {
    const t = TONES[el.dataset.tone];
    const inset = 1.5;
    s.add(s.rc.path(roundedRectPath(inset, inset, s.w - inset * 2, s.h - inset * 2, cssRadius(el, 18) - inset), { stroke: t ? t.stroke : "#D8D5CF", strokeWidth: t ? 1.4 : 1.1, roughness: 1.4, bowing: 1.2 }));
  });
  each("[data-rough-ring]", (el, s) => {
    const t = tone(el), p = pct(el), c = s.w / 2, d = s.w - 14;
    const base = s.rc.circle(c, c, d, { stroke: "#E5E3DE", strokeWidth: 1.4, roughness: 1.6 });
    base.classList.add("rough-ring-base");
    s.add(base);
    if (p >= 100) {
      const progress = s.rc.circle(c, c, d, { stroke: t.stroke, strokeWidth: 3, roughness: 1.6 });
      progress.classList.add("rough-ring-progress");
      s.add(progress);
    } else if (p > 0) {
      const progress = s.rc.arc(c, c, d, d, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p / 100, false, { stroke: t.stroke, strokeWidth: 3, roughness: 1.3 });
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
};
(() => {
  let frame = 0;
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => window.piFlowDraw());
  };
  window.addEventListener("load", () => {
    document.querySelectorAll("details").forEach((node) => node.addEventListener("toggle", redraw));
    redraw();
  });
  window.addEventListener("resize", redraw);
})();
</script>`;
}
