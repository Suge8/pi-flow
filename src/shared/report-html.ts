import { readFileSync } from "node:fs";

export function readReportText(path: string) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

export function reportHead() {
	return `${reportStyles()}\n${reportScripts()}`;
}

function reportStyles() {
	return `<style>
html{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
details>summary{cursor:pointer;list-style:none}
details>summary::-webkit-details-marker{display:none}
h1{text-wrap:balance}
p,li{text-wrap:pretty}
pre{white-space:pre-wrap;word-break:break-word}
.tooltip{position:relative}
.tooltip::before,.tooltip::after{position:absolute;left:50%;pointer-events:none;opacity:0;transition-property:opacity,transform;transition-duration:.16s;transition-timing-function:cubic-bezier(.2,0,0,1);z-index:40}
.tooltip::before{content:"";bottom:calc(100% + 2px);transform:translate(-50%,4px);border:5px solid transparent;border-top-color:rgba(41,37,36,.92)}
.tooltip::after{content:attr(data-tooltip);bottom:calc(100% + 12px);width:max-content;max-width:16rem;transform:translate(-50%,4px);border-radius:10px;background:rgba(41,37,36,.92);padding:.4rem .55rem;color:white;font-size:12px;line-height:1.45;text-align:center;box-shadow:0 10px 24px rgba(41,37,36,.18)}
.tooltip:hover::before,.tooltip:hover::after,.tooltip:focus-visible::before,.tooltip:focus-visible::after{opacity:1;transform:translate(-50%,0)}
[data-rough-card],[data-rough-ring],[data-rough-bar],[data-rough-node],[data-rough-line],[data-rough-seal]{position:relative}
[data-rough-card]{border-radius:18px;background-clip:padding-box}
[data-rough-seal]{border-radius:9999px;background-clip:padding-box}
svg.rough-layer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:0}
[data-rough-card]>*:not(svg.rough-layer),[data-rough-ring]>*:not(svg.rough-layer),[data-rough-node]>*:not(svg.rough-layer),[data-rough-seal]>*:not(svg.rough-layer){position:relative;z-index:1}
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
window.piFlowDraw = () => {
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
    document.querySelectorAll(selector).forEach((el) => {
      const s = layer(el);
      if (s) draw(el, s);
    });
  };
  each("[data-rough-card]", (el, s) => {
    const t = TONES[el.dataset.tone];
    const inset = 1.5;
    s.add(s.rc.path(roundedRectPath(inset, inset, s.w - inset * 2, s.h - inset * 2, cssRadius(el, 18) - inset), { stroke: t ? t.stroke : "#D8D5CF", strokeWidth: t ? 1.4 : 1.1, roughness: 1.4, bowing: 1.2 }));
  });
  each("[data-rough-ring]", (el, s) => {
    const t = tone(el), p = pct(el), c = s.w / 2, d = s.w - 14;
    s.add(s.rc.circle(c, c, d, { stroke: "#E5E3DE", strokeWidth: 1.4, roughness: 1.6 }));
    if (p >= 100) s.add(s.rc.circle(c, c, d, { stroke: t.stroke, strokeWidth: 3, roughness: 1.6 }));
    else if (p > 0) s.add(s.rc.arc(c, c, d, d, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p / 100, false, { stroke: t.stroke, strokeWidth: 3, roughness: 1.3 }));
  });
  each("[data-rough-bar]", (el, s) => {
    const t = tone(el), p = pct(el);
    s.add(s.rc.rectangle(1, 1, s.w - 2, s.h - 2, { stroke: "#D8D5CF", strokeWidth: 1, roughness: 1.2 }));
    if (p > 0) s.add(s.rc.rectangle(2, 2, (s.w - 4) * p / 100, s.h - 4, { stroke: "transparent", fill: t.fill, fillStyle: "hachure", hachureGap: 4, fillWeight: 1.6, roughness: 1 }));
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
