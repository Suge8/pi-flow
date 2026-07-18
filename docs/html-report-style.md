# HTML 报告规则

只记录当前 HTML 展示约定。状态契约见 `docs/runtime-contracts.md`。

## 事实源

- HTML 由插件渲染：Flow 页入口为 `src/flow/html.ts`，独立质检页入口为 `src/review/report.ts`；两者复用 `src/shared/report-blocks.ts`、`src/shared/report-review.ts`，对话 thread 唯一渲染器为 `src/shared/report-transcript.ts`。
- 样式 token 单一事实源在 `report-blocks`：`TONE`（text/seal/soft/dot）、`CHIP`（soft/neutral）、`TYPE`（meta/micro/tiny）、`PILL_INTERACTIVE`；检查卡/模型 token 在 `report-review` 只组合这些 token，不另起色表。
- 检查态文案走 `copy()`：`accepting` / `checking` / `completing` / `optimizing` / `noDetailedOutput`。
- 主题：Tailwind `darkMode: "class"`；默认读系统 `prefers-color-scheme`；用户切换写入 `localStorage.pi-flow-theme`（`light`/`dark`），有本地偏好后不再跟系统；无偏好时系统变化会同步。首屏用 head 内同步脚本防 FOUC。太阳/月亮按钮使用 Lucide；Flow 页放在 logo header 右侧，随页面滚动，不固定浮层。
- 主题 token 单一事实源在 `report-html` 的 CSS 变量：`--report-*` 管 page/surface/text/chip，`--tone-*-surface` 管语义面，`--rough-*` 管 rough 墨线/填充。组件只引用 token，不各自硬编码暗色 surface。暗色下小状态卡可用低饱和 tonal surface；大卡片主要用中等对比 `--rough-*-card` 边线 + icon/节点保留语义色，避免 neon 彩框，也避免颜色消失。
- HTML 只展示状态，不保存事实。Flow 页从 `flow.json` 读取 Flow/步骤起止时间，从 `rounds[].elapsedMs` 读取已结算轮次耗时，并在并行批次读取 Flow 根目录 `G<N>-worker.json`；独立质检页接收刚提交的 session `review-checkpoint`，并与质检 prompt 共用 `buildContextEvidence` 的 review 投影。`.flow/reviews/` 永不作为输入。
- 渲染前必须校验状态源；校验失败页只用于排查，不自动打开半成品。
- 模型禁止写 `flow.html`。

## 内容

- HTML 是给用户看的监控页，不是给执行 AI 看的计划。
- 直接展示：品牌、标题、动作命令、总进度、当前活动步骤任务清单、验收、质检、成果首段。
- 非活动步骤不常驻占版面；多步 Flow 通过横向 stepper 切换下方活动卡；并行批次作为一组选择，点击任一并行节点都同时展示整组 lane；步骤右下角只保留「更多」入口。
- 气泡宽度与触发器屏幕位置解耦：`.flow-tooltip` 用 `width:max-content`（短内容窄气泡），普通气泡 max-width 30rem、长文 lg 38rem 封顶折行（落在 60–75ch 最佳阅读行宽区间）；字号阶梯 12.5px / 13px，padding 与圆角统一；禁止固定宽（短内容撑空盒）或依赖定位时的可用空间（靠右触发器会被挤成窄长条）。
- 「更多」、模型结果和 header「对齐 N 轮」使用同一套简洁现代 hover chip，不画 rough 边，也不加 ring 边框；「更多」气泡只放范围、怎么验证、计划文件、运行记录和步骤起止时刻，验收标准改在 goal 右栏顶部常驻；模型结果 hover 展示对应反馈，模型状态 icon 使用无外圈的简洁图标；有 canonical 对齐原文时，「对齐 N 轮」使用模型 chip 的中性底色，hover 按 `Q1: 原文\nA1: 原文\n---\nQ2: ...` 展示，不加标题或分隔空行。运行中的模型用旋转 `LoaderCircle` 表示正在工作，不用钟表图标。这些 hover 触发器使用 pointer 光标，详情卡可悬停、滚动、选择和复制；滚动气泡内部内容不关闭气泡，滚动页面才关闭。气泡进出用可中断 transition：opacity + 轻微位移/scale + 极轻 blur，从触发器方向滑入滑出；快切不同触发器时硬复位再进场，避免共用 tip 中途改内容/方向导致动画播不全；`prefers-reduced-motion` 下只切显隐。长交付内容进「交付详情」模态框。
- 底部「需求记录」只在有原始需求或 QA 记录时展示，点击后打开共用模态框；conversation 来源按原顺序显示垂直 thread，每条分为角色 icon、角色名、`<time datetime>` 与正文，用户/用户补充只以 sky icon 和左侧 2px 线区分，助手保持 stone 中性，助手正文渲染 Markdown；用户与用户补充正文只做 HTML 转义，保留原始空白和绝对路径，不走报告路径遮罩。prompt/file 来源只显示原始文本块，不伪装成 thread；其后追加结构化 QA 和来源行（生成后读 `flow.meta.alignment.turns`，生成前回退 `alignment.json.alignmentTurns`）。长正文默认约 10 行并提供「展开/收起」，同一页面内关闭再打开模态时保留展开状态与可用的「收起」入口，不做列表入场或滚动动画；`prefers-reduced-motion` 下直接显示全文。组件只组合 `TONE` / `TYPE` / `CHIP` 和既有模态管线，不新增颜色或阴影。
- 成果只在完成后展示；完成卡按「全部完成 · N 步」→交付摘要→弱化的「遗留建议」排列，交付详情用右下角低调文字按钮打开模态框。遗留建议聚合各步检查建议区，去重，多步时带「第 N 步」前缀，零建议不渲染。
- Flow 最终卡片与报告 status 给精确 capability live report URL；服务根路径不跳转、不列报告。独立质检 HTML 每次写盘成功后立即发布 status URL，启动卡、轮次结果卡和终态通知均不重复展示；完成后重开同一 session 仍按已有 HTML 恢复 status 入口。默认不展示本地 HTML/Markdown 路径。
- 独立质检页固定展示品牌 header、范围与当前状态、轮次进度、从第 1 轮开始的紧凑质检历史和 footer 更新时间；已结算轮次在标题行尾展示 `elapsedMs`，进行中轮次按 `active.startedAt` 现场计时。质检证据收进 footer modal，直接显示实际投喂模型的 review 投影原文（coverage、对话证据、操作证据）；投影失败时显示原因。round-0 武装态显示「执行中 · 完成后自动质检 / 等待第 1 轮」，禁止伪装成「优化中」或泄露「第 0 轮」；轮次区使用单个 quality phase，模型详情走胶囊悬浮，顾问建议沿用该轮 `advisorSlot`。用户取消仍只发通知，不改成结果卡。goal-scoped 质检继续只投影到所属 `flow.html`。
- header 卡：标题下一行轻元信息先展示 Flow「开始于 X」，完成后追加「· 完成于 Y」；计划模型+强度与对齐事实读取 `flow.meta`，无 meta 时仍保留时间，无对齐时不显示对齐项；recorded 轮数由原文数组长度推导。状态层级一处收口：complete 绿 > attention 红 > paused 琥珀 > running 蓝。attention 态：header 整卡红（tone-red surface + 红 rough 边）、页面轻染色（暗色用深红低透明 tint）、进度环变红，卡内居中警示行：四类 kind 映射人话标题（需要接管 · 已自动暂停 / 检查系统错误 / 会话已中断；需要你操作）+ message + `/flow go` 命令胶囊。无 attention 的 paused：琥珀平静态一行「⏸ 已暂停 · /flow go 继续」，不染页不变卡；attention 优先于 paused。goal 级 `paused` 状态映射人话「已暂停」（琥珀），禁止泄露裸枚举。
- 勾级归因：已完成步骤条目标题旁行内轻文字「🧠 模型 强度：MM-DD HH:mm:ss」（10.5px、无交互、大脑 icon 淡 indigo 点睛，时间 tabular-nums，并以 `<time datetime>` 保留完整 ISO 时间）；无归因记录不渲染，页面刷新不回写事实。串行数据源为 `goals[].checkAttribution`，并行运行时从 worker artifact 的 `checkAttribution` 投影；key 算法与运行端同源（`src/plan/markdown.ts#sectionCheckboxAttributions`）。
- 顾问渲染：自动或 `/advisor` 手动建议统一从 `rounds[].advisor` 读取；完成态在该轮尾部虚线位只展示一个居中的「🧭 顾问建议 · 模型 强度」indigo 胶囊（两侧虚线延续），整个胶囊可悬停/聚焦并用 lg 气泡展示可滚动、可复制的完整建议，不再渲染摘要正文块或「…全文」入口；进行态（`checks.*.consulting` 且步骤 live）在轮次列表尾部同位展示「正在咨询顾问 · 模型 强度」spinner pill，检查卡右上状态同步换 indigo「顾问介入中」。模型胶囊到顾问建议间距 8px，顾问建议到下一轮标题 12px，均由轮次父布局控制。indigo 只用于顾问语义（`--tone-indigo-surface`），不进 rough tone 体系。
- 模型 + 思考强度统一渲染（`report-blocks#modelWithThinking`）：强度 10px 常规字重淡灰，永远弱于模型名；header 元信息、勾归因、检查模型 chip（`CheckModelSnapshot.thinking`）、顾问 pill 共用。

## 视觉与进度

- 静态 HTML 完全自包含：构建期 Tailwind CLI 扫描 `src/**/*.ts` 生成压缩 CSS，并复制 rough.js browser bundle；renderer 从 `dist/assets/` 读取、进程级缓存并内联，发布包运行时不读 `node_modules`，不请求 CDN 或其他远程资源。图标继续使用本地 vendored Lucide SVG。
- `<head>` 只保留一个受 SHA-256 CSP hash 授权的内联 script，包含首屏主题、rough.js 与交互逻辑；CSP 固定为 `default-src 'none'`、`style-src 'unsafe-inline'`、hash-only `script-src`、`connect-src 'self'`、`img-src data:`、`base-uri 'none'`、`form-action 'none'`。SSE 使用报告 URL 下的相对 `events`。
- 短周期耗时统一显示分钟：`<0.1m`、一位小数（如 `0.7m` / `3.2m`），10 分钟起取整（如 `12m`）；文字弱灰、tabular-nums、无图标。步骤耗时同时出现在 stepper 检查点行尾和步骤面板标题旁；轮次耗时出现在轮次标题行尾。Flow 级只显示起止时刻，不显示总耗时数字。步骤耗时是 `startedAt → completedAt/当前时间` 的墙钟值，跨暂停会偏大。
- 页面共用一个 60 秒 timer，只更新运行态当前步骤和 active 检查轮的 `data-elapsed-since` 目标，不写盘、不发 SSE。页面隐藏时停止 interval，回到前台立即重算并重启；paused、attention、complete 页面只输出静态耗时，不生成动态目标。
- 非 live 的 active checkpoint 保留轮次、已结算模型 outcome 和静态耗时，但阶段状态改为「等待」，未结算模型使用灰色暂停图标与「等待」tooltip；检查卡、stepper 检查点和当前步骤主节点不输出「验收中/质检中」、`spin-soft`、`pulse-soft` 或 `bot-soft`。live 同时要求 Flow running、无 attention、Goal running 且属于当前批次；父 Flow running 但 worker 投影为 paused 的 lane 仍是静态态。步骤清单里的 `[~]` `rotate-3d-soft` 只表示 Markdown 计划事实，不代表检查或页面 timer 正在运行。
- 风格：暖色 stone 画布、白卡片、serif 标题；语义色只用 emerald / sky / amber / rose。
- rough.js 标记是视觉契约：`data-rough-card/ring/node/line` + `data-tone` + `data-percent`。
- rough 只用于卡片、节点、进度环和连接线；hover chip 只用半透明底色和柔和投影，不用边框，避免小按钮全是手写边造成视觉噪音。
- 顶部卡片外显示圆角带描边 logo + `Flow` 字样；顶部卡片内只放标题与紧凑环形进度，不重复展示 Flow 状态 seal 或“正在执行第 N 步”副标题；阻断/暂停区和底部 `/flow go` / `/flow stop` 共用紧凑命令 chip，命令右侧 copy 按钮直接复制原始命令，成功原位变绿勾并短显「已复制」，失败明确显示「复制失败」；底部两个命令之间用竖向虚线分隔。
- `<head>` 使用 `assets/logo.png` data URI 作为 favicon；logo 缺失时只降级为本地图标。
- 多步 Flow 展示横向 stepper；单步 Flow 不展示横向 stepper，也不在标题左侧显示步骤数字。
- stepper 节点默认不显示外框或底色；hover 时只出现淡色圆角矩形背景，不加边框，并按节点状态着色：运行中淡蓝、已完成淡绿、未完成淡 stone；selected 只通过标题权重和节点语义色表达。并行节点在 stepper 中作为一组 hover：悬浮任一并行节点时，同批节点共用一块同状态淡色圆角背景。
- stepper 节点下方先显示验收与质检微型状态，已启动步骤的分钟耗时另起一行作为 10px 三级信息，避免与轮次争宽或溢出节点；只保留小点、文字、轮次、验收口径标记和耗时，不使用胶囊背景；灰色未开始、蓝色检查/修复中、绿色已通过、红色未通过、琥珀色错误；轮次超过 1 时显示 `N轮` / `×N`；验收/质检不换行、不弹 tooltip；验收口径调整标记只放在验收状态上，不放在主步骤节点上。
- 并行 Flow 的 active batch 在 stepper 中按分叉展示但不显示「并行」文字：连接线由 rough.js 按真实节点位置绘制，从父节点边缘指向并行节点边缘，并行节点再指向后续节点；活动区并排展示独立 lane 卡片，卡片中间用无边框 Lucide `git-branch` 图标提示同批并行，lane 内任务清单在左、验收/质检在右。
- 步骤始终展示节点、短标题、状态、勾级归因和说明，不使用 `<details>`、展开箭头或持久化展开状态。任意非空步骤清单都由服务端输出同一种语义化 `<ol>` 并按完整内容进入高度测量管线，步骤数量不参与换列判断；Goal 卡以自身内容盒为唯一响应式事实源：`>900px` 为进度区 + 340px 右栏，`420–900px` 为单列进度 + 220–288px 右栏，`<420px` 才把最长 340px 的右栏下移。宽档下先测量完整单列自然高度，仅当它超过「标准 + 验收 + 质检」右栏总高时才启用第二视觉列；确认超高后才按半列宽重新测量并计算折点，目标高度取右栏高度与两列最小平衡高度的较大值，保证最多两列。单列所有相邻节点保持连续竖线；rough.js 只在真实换列点画一条折线，从上一项节点右缘贴节点下行，在正文下方穿入真实 gutter，再沿 gutter 上行接到下一项节点左缘。路径固定正数 seed 并使用受控 roughness/bowing，正文、底部或 gutter 净空不足 12px 时不画装饰线。布局、基础 rough 与折线属于同一 `piFlowDraw` 管线；resize、右栏 `ResizeObserver` 与节点切换后统一按最终几何重绘，不轮询、不搬 DOM。
- Goal 右栏按「标准 / 验收 / 质检」排列并始终同宽。「标准」保留 `Success Criteria` 原文语义，使用 `list-checks` 图标、蓝色 rough 边、条目数与无分割线的紧凑清单；蓝点只用于定位条目，不表示已通过；长路径、URL、命令、内联代码和连续字符必须在卡内换行，不裁剪、不产生横向越界。验收与质检分成独立小卡片；描述不常驻展示，标题右侧小 `?` hover/focus 展示说明；标题用深色文本，icon 使用语义色。检查状态只显示文字，不画状态胶囊：验收运行中为「验收中」、验收未过后的修复为「补完中」；质检运行中为「质检中」、质检未过后的修复为「优化中」；这四个进行态左侧显示小 `LoaderCircle`；其余为「等待 / 已通过 / 未通过 / 错误 / 未启用」。父级已显示「待执行」时，检查卡不重复「等待」；检查禁用且无历史时整卡隐藏，有历史时保留历史但不显示「未启用」。质检中、已通过、未通过、错误都用同一结构：轮次作安静 meta 独占一行，耗时放在标题行尾，下方模型 token 整行 wrap，轮次间虚线只跟模型 token 块同宽（不拉满整卡），不再给轮次额外放状态 icon；多模型掉行时对齐 token 列。模型 token 用更圆的胶囊 + 统一中性底，状态色只在 icon；运行中 hover/占位文案只用「质检中 / 验收中」；hover 展示持久化完整输出，包括混合失败轮次里的通过模型输出，以及通过轮次里被忽略的格式错误模型输出；详情左右自适应，左侧 lane 向右展开、右侧 lane 向左展开。检查卡本身用安静白底，状态交给 rough 边与标题 icon，不整卡粉彩。紧凑右栏内模型网格改为单列，顾问胶囊去掉两侧装饰虚线并允许收缩；完整建议仍由 tooltip 承载，不得撑破卡片。
- 验收标题使用本地 `target` SVG，质检标题使用本地 `shield-check` SVG；节点、ring、modal 内部图标必须压在 rough hachure 纹理上方；打开 modal 前先绘制 rough 层，再以 opacity + 小幅 scale 渐显，关闭时渐隐，不做横向或斜向位移。
- 状态标签：`待执行`、`等待`、`验收中`、`质检中`、`补完中`、`优化中`、`已通过`、`未通过`、`错误`、`未启用` 都只显示文字，不画状态胶囊；活动步骤不额外显示「当前」，避免重复；已完成步骤详情卡使用绿色边缘，右上「已完成」只显示文字；已完成步骤下方两个检查若均已通过，不再重复显示两个「已通过」。
- Todo 状态：`[ ]` 待做、`[~]` 进行中、`[!]` 阻塞、`[x]` 完成；进度只把 `[x]` 算完成；已完成步骤用左侧 check 表达，不在标题右侧重复「完成」；进行中的总步骤节点使用动态 `bot`（无重绘、浮动更明显），具体 Todo 节点使用动态 `rotate-3d`（1.5s 线条重绘并保留完整线条停顿），不用钟表或 spinner。
- flow 环形进度按步骤算：完成步数 / 总步数；容器 h-32、数字 text-3xl，进度笔触 strokeWidth 4.6、底环 1.9；rough 环形线条不做 dash 重绘或旋转，避免碎线，只给进度笔触做非常轻的墨水呼吸（opacity/drop-shadow），不定时重跑 rough.js。

## 禁止

- 禁止把 HTML 模板、候选项结构或长样式说明写进计划文件。
- 禁止为了视觉效果放宽 schema 校验。
