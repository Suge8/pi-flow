# Landing Page

Pi Flow 的双语落地页。Svelte 5 + Vite + GSAP ScrollTrigger，独立子包，不进 npm 包。

- 开发：`cd site && npm install && npm run dev`；构建：`npm run build`（产物在 `site/dist/`，已被 git 与 biome 忽略）。
- 双语：默认跟随浏览器语言，右上角切换，localStorage 持久化；全部文案集中在 `src/lib/i18n.svelte.js`，事实源与 README 保持一致。
- 资产：`public/assets/` 含 logo、吉祥物、报告截图（压缩产物，勿手改）；`public/assets/gen/` 是 gpt-image 生成的 3D 黏土风插画。
- 部署：生产站 [pi-flow.vercel.app](https://pi-flow.vercel.app)；Vercel 项目 `pi-flow` 已直连 `Suge8/pi-flow`，Root Directory = `site`（`vercel.json` 声明 framework/output/缓存头；仅 `site/` 变更才重建）。本地 link 在 `site/.vercel/`（已 gitignore）。
- 文案受 `tests/copy-lint-smoke.mjs` 保护（`site/index.html`、`site/src/lib/i18n.svelte.js` 在扫描范围内）。
