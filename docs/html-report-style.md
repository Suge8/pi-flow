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
- rough 卡片和状态 seal 使用与 DOM 背景一致的圆角 SVG path；card 是柔和圆角，seal 是 pill 圆角。
- 顶部卡片外显示品牌行：圆角带描边 logo + `Flow` 字样；顶部卡片内不展示 Flow 状态 seal。
- 步骤进度不展示“执行进度”标题，直接展示节点。
- 折叠细节不使用 CSS 三角箭头；步骤说明用 `list-checks` +「说明」，交接用 `arrow-right` + 标题，完整说明用 `list-checks` + 标题，避免同屏重复一堆相同省略号。
- 完成验收与质量检查分成独立小卡片；描述不常驻展示，标题右侧小 `?` hover/focus 展示说明；标题用深色文本，icon 使用语义色。
- 完成验收标题使用本地 `target` SVG，质量检查标题使用本地 `shield-check` SVG；节点、seal、ring 内部图标必须压在 rough hachure 纹理上方。
- 状态标签：`等待`、`检查中`、`已通过`、`未通过`、`错误`、`未启用`。
- Todo 状态：`[ ]` 待做、`[~]` 进行中、`[!]` 阻塞、`[x]` 完成；进度只把 `[x]` 算完成；已完成步骤用左侧 check 表达，不在标题右侧重复「完成」。
- flow 环形进度按步骤算：完成步数 / 总步数。

## 禁止

- 禁止把 HTML 模板、候选项结构或长样式说明写进计划文件。
- 禁止为了视觉效果放宽 schema 校验。
