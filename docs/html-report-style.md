# HTML 报告规则

只记录当前 HTML 展示约定。状态契约见 `docs/runtime-contracts.md`。

## 事实源

- HTML 由插件渲染：`src/flow/html.ts`、`src/shared/report-blocks.ts`。
- HTML 只展示状态，不保存事实；事实来自 `flow.json` 和计划 Markdown。
- 渲染前必须校验状态源；校验失败页只用于排查，不自动打开半成品。
- 模型禁止写 `flow.html`。

## 内容

- HTML 是给用户看的监控页，不是给执行 AI 看的计划。
- 直接展示：标题、`Objective` 首句、任务清单、完成验收、质量检查、成果首段。Flow 每步在宽屏下左侧展示任务清单，右侧展示完成验收与质量检查。
- 细节折叠：验收标准、验证命令、范围、备注、失败详情、长模型输出。
- 成果只在完成后展示。
- 最终卡片和 status 给 live report URL；默认不展示本地 HTML/Markdown 路径。

## 视觉与进度

- 静态 HTML：Tailwind CDN + rough.js CDN；图标使用本地 vendored Phosphor SVG，不引入 icon 依赖或 icon CDN。
- 风格：暖色 stone 画布、白卡片、serif 标题；语义色只用 emerald / sky / amber / rose。
- rough.js 标记是视觉契约：`data-rough-card/ring/bar/node/line/seal` + `data-tone` + `data-percent`。
- 状态标签：`等待`、`检查中`、`已通过`、`未通过`、`错误`、`未启用`。
- Todo 状态：`[ ]` 待做、`[~]` 进行中、`[!]` 阻塞、`[x]` 完成；进度只把 `[x]` 算完成。
- flow 环形进度按步骤算：完成步数 / 总步数。

## 禁止

- 禁止把 HTML 模板、候选项结构或长样式说明写进计划文件。
- 禁止为了视觉效果放宽 schema 校验。
