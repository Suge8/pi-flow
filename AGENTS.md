# pi-flow 开发索引

Pi 扩展：`/flow`（单步/多步编排 + 验收 + 质检）、`/review`（立即质检 / 执行后自动质检）。

## 命令

```bash
npm run check            # biome + tsc + dist build，必须 exit 0
npm run build            # 清空并生成 dist/
npm test                 # smoke + npm 解包验证全绿
npm run bench:startup    # 裸 Pi / 插件启动中位耗时与 RSS
npm run bench:soak       # 100+ 次 Session / Flow 生命周期内存稳定性
npm run bench:report     # 串/并行事件风暴、完整渲染、写盘与终态 hash
npm run format           # biome 自动修复
npm run release:patch    # 本地发布：版本、tag、npm publish、push
npm run release:current  # 仅发布当前版本，用于 tag 已有但 npm 未发
```

发布只用 `npm run release:*`；不要手动改 version、打 tag 或 `npm publish`。CI 只校验，不发布。

## 模块地图

| 路径 | 职责 |
|------|------|
| `src/index.ts` | 轻量扩展入口：语言与 bootstrap；禁止静态引入领域运行时 |
| `src/bootstrap.ts` | `/flow`、`/review`、`/advisor` 命令外壳与按需激活；任一独立 review checkpoint（含 `phase:null` 终态）都会激活 Review，以恢复报告 status；flow runtime 是进程级单例，首次懒加载，加载后每个 session_start 把运行时幂等补注册到新 pi（session 重建后禁止持有 stale pi） |
| `src/advisor.ts` | `/advisor` 用户命令：交互/空闲守卫、结果文案与顾问建议卡；领域逻辑复用 goal runtime |
| `src/goal.ts` + `src/goal/` | Flow step 内部运行、验收、质检与状态同步引擎；不注册用户命令；`check-discipline.ts` 集中检查停滞自愈阈值、尾部失败计数与纯函数；`advisor.ts` 负责安全诊断顾问子进程（与 Reviewer 共用 checks，允许 bash 验证，禁 write/edit），runtime 负责自动/手动咨询、持久化 outbox 与执行模型投递（咨询期间挂「顾问介入中」活动框，Esc 只跳过咨询） |
| `src/flow.ts` + `src/flow/` | `/flow` 命令，单步/多步生成、执行、恢复、状态与报告 |
| `src/flow/target.ts` | Flow 命令目标解析：显式 id、当前 session、唯一 active 与多义提示 |
| `src/flow/prewalk.ts` | 计划轨迹继承（prewalk）：生成会话记忆、首批 fork 资格判定、并行 worker 会话分支 |
| `src/flow/lock.ts` | Flow dir 级写锁，保护单个 `flow.json` 调度与收口事务 |
| `src/flow/goal-events.ts` | Goal runtime 到私有 worker 的进程内事件桥；BLOCKED artifact 落盘后通知 worker 退出 |
| `src/flow/scheduler.ts` | Flow 依赖与 `writeScope` ready batch 纯函数调度器；生产只调用 `computeReadyBatch()`；`computeLaunchSet()` 仅供测试与 `eval:graph` 四臂协调器，不进用户运行路径 |
| `src/flow/watcher.ts` | 每 Flow 事件驱动报告 frame：合并文件风暴，重读 canonical 状态并阻止迟到覆盖 |
| `src/flow/parallel/` | 并行控制台、worker artifact、私有启动、result watcher、fan-in、恢复收口与 lane UI |
| `src/review.ts` + `src/review/` | `/review` 三态命令（立即质检、带需求执行后质检、执行中武装）与质检视图/聚合；`review/report.ts` 生成独立质检 HTML 投影 |
| `src/auditor.ts` | 验收模型调用与结果聚合 |
| `src/plan/` | `plan.md` / 步骤 markdown 解析与校验 |
| `src/shared/` | 配置、语言、报告、卡片、生成前 `alignment.json`、子进程、会话、检查池等共享代码 |
| `src/report-daemon.ts` + `src/shared/report-{client,protocol}.ts` | 用户级固定端口报告 daemon、进程级单连接 client 与严格 protocol 1；精确 capability registry，双连接集合空闲 15 分钟退出 |
| `src/shared/plan-file-watcher.ts` | 持续监听父目录并按 basename 过滤，支持编辑器及 worker 的 temp+rename 原子替换，禁止退回旧 inode 的 `watch(file)` |
| `src/shared/context-evidence.ts` | 从原始 branch 事件提取事实，生成计划用 `requirements` 与检查/顾问共用 `review` 投影，并按目标模型窗口预算 |
| `src/shared/activity-signal.ts` | 可选进程内 activity / attention 协议：前者表示忙碌，后者表示需要用户接管 |
| `src/shared/agent-progress.ts` | 子代理瞬态进度单一事实源：按 scope 聚合当前/最近工具与 calls/token，并以订阅发布；不落盘 |
| `src/shared/tool-line.ts` | 监控与活动框共用的工具名、路径/命令分段、耗时/token 和宽度收敛格式化 |
| `src/shared/monitor-overlay.ts` | 子代理监控悬浮窗：订阅活跃 progress scope，自动弹出、Esc 静默当前 scope、Alt+S 重开 |
| `src/validate-draft.ts` | 复用 canonical Flow validator 的 CLI 入口，发布为 `dist/validate-draft.js` |
| `scripts/evaluate-context-evidence.mjs` + `scripts/context-evidence-evaluation.mjs` | Context Evidence 真实三模型 A/B 与纯评分：固定 ID + packet 内 locator + 精确原文；每模型 3 次采样，召回/检出取多数，误报取中位数；基线/候选校验同一 prompt/scorer/benchmark 指纹 |
| `scripts/evaluate-prewalk-flow.mjs` | prewalk 真实 Flow A/B（RPC 驱动完整扩展链含验收/质检；自包含 fixture/扩展准备，任一 arm 未干净收口非零退出；仅串行，parallel 未实现会明确拒绝）（`npm run eval:prewalk:flow`） |
| `scripts/evaluate-graph-flow.mjs` + `scripts/graph-flow-evaluation.mjs` + `scripts/eval-host-pi-cli.mjs` | 图执行四臂真实 Flow 评测与纯评分（`npm run eval:graph`；`--runs 3` 扩样）；模型/语言/检查开关固定在已提交的 `tests/fixtures/graph-flow/evaluation-contract.json`（当前 `xai/grok-4.5` + `high`），不读取本机 `config.json`；planner RPC 经 `eval-host-pi-cli.mjs` 转宿主 `pi`，与 worker 共用 oauth。基础设施重试逐 attempt 计时/usage；完成态 process/protocol 错误计入不可靠；任一 arm 失败不得 positive/proceed。故障注入与真实协调共用 DAG/attempt/resource 纯状态转换。artifact 绑定 `benchmarkIds`（= `evaluation-contract.json` 有序全集，禁止自选/重排/重复）、`scorerFingerprint`、`executorFingerprint`、`schedulerFingerprint`（`src/flow/scheduler.ts`）；`armOrder` 按合同 index 的 `expectedArmOrder` 校验。CLI verify 以合同 ID 集为唯一可信根加载 fixture，不从 artifact 推导实验集合。写 artifact 时同次落盘确定性 `*.summary.md`（非模型撰写；verify 若存在则必须与重算一致）。Grok 合同 baseline 由评测 CLI 一次写出：12/12 complete，`processErrors=0`；无凭证退出按 `protocol`/`process_start` 最多重试 3 次并保留 attempt evidence。方向历史 neutral、scope positive、不等长 positive，结论 `expand`；elapsed（serial/current/optimized/streaming）历史 `247/190/206/246s`、scope `208/168/155/203s`、不等长 `193/166/171/152s`。1 次 completion-fill；单样本不足以授权生产 streaming。SIGINT/SIGTERM abort 后立刻 stop 已登记 Planner/worker（`raceAbort` 解开 promptAndWait），shutdown 再删本进程临时根；进度 `replace` 切换 benchmark/arm 并重置计时，仅阶段键变化+心跳。 |
| `scripts/evaluate-prewalk.mjs` | prewalk 隔离 harness A/B（真实模型调用，绕过 /flow 路径与检查链）：3 类单文件合成任务轮转，同一计划会话下冷启动 vs fork 继承；账单以计划完成点为界（共享计划成本不计入 arm），两 arm 同一快照启动、奇偶交替顺序、每任务行为断言 + 变更范围断言，计划只读违规自动重试；无参默认即文档口径（9 对），任一 arm 验证失败非零退出（`npm run eval:prewalk [--task id]`） |
| `scripts/release.mjs` | 本地发版：check/test、版本、tag、npm publish、push |
| `prompts/` | 中英文模型协议与修复提示；全部 prompt 面（含运行时隐藏注入）索引见 `docs/prompts.md` |
| `site/` | 双语落地页（Svelte 5 + Vite + GSAP，独立子包，Vercel 部署）；文案集中在 `src/lib/i18n.svelte.js`，受 copy-lint-smoke 保护，不进 npm 包 |
| `tests/` | smoke 回归测试 |
| `docs/runtime-contracts.md` | 当前运行契约：状态、Todo、prompt 投递、状态文案 |
| `docs/html-report-style.md` | HTML 报告展示规则 |

## 关键约定

- 状态单一事实源：运行态只接受 `flow.json` schema v17，不迁移、不改写其他版本；自动扫描跳过不受支持或损坏的运行态，显式 id 访问明确报错。生成前子阶段为同目录 `alignment.json`。模型只写 `flow.semantic.json` 与 markdown；插件 builder 组装 canonical 状态，并在校验前为计划文件补齐可空的 `Notes` / `Handoff` 标题。`goals[].snapshot` 是步骤首次启动时的计划全文，也是修订仲裁的唯一基线（跨进程、跨重启不可漂白）；计划内容变更不机械断流，合法性由检查仲裁按 diff 裁决，恢复前置校验只拦缺快照 / 步骤文件被删。v17 `source` 是严格 union：conversation 保存 `{type, transcript:[{kind,at,text}]}`，prompt 保存 `{type,text}`，file 保存 `{type,path,text}`；平文只经 `formatTranscript` 派生，不双写、不反解析。插件维护字段：`meta`（计划模型 + 原始对齐 Q&A，轮数由数组长度推导）、`attention`（需要接管的异常事实，go 确认可安全推进时清空；失联步骤保留）、`startedAt/completedAt` 与 `goals[].startedAt/completedAt`（父进程写墙钟时间）、`goals[].checkAttribution`（勾级归因）、`rounds[].advisor/elapsedMs`、`goals[].pendingAdvisor`（手动建议待投引用，送达即清）。
- HTML 报告由内置渲染器生成；模型禁止手写 `flow.html`。plan/schema 校验结果独立决定修复路径，对应错误页失败仍继续确认或发送 repair prompt；单独的 HTML 错误不触发模型修复。canonical 提交后的普通/错误 HTML 最终投影统一经同一个 no-throw 执行器：渲染/写盘失败只通知「报告刷新失败」并返回无路径，不回滚、不重试，也不中断 prompt、worker、后续 Flow 会话名同步、完成事实消费、结果卡或下一步调度。显式查看报告保留 throwing renderer，但调用方必须捕获并提示打开失败。
- 所有 Pi 进程共用 `${PI_CODING_AGENT_DIR ?? ~/.pi/agent}/pi-flow-report/` 下的用户级报告 daemon，默认 `127.0.0.1:49327`；禁止 embedded server、随机 fallback、cwd 静态 root、报告列表和浏览器控制 API。daemon 只服务 control 注册的两类精确 HTML capability，control/SSE 全空 15 分钟后退出；client control 建立后必须 unref 底层 socket，使 one-shot 进程可自然退出并由 OS 断开 control。daemon shutdown 必须停止 accept 并销毁全部 TCP socket，半开请求不得阻塞退出，并发 close 共用同一 Promise。冷启动 health 先于 endpoint 可见时，client 必须等待活跃 startup lock 的文件事件后重读，禁止轮询或误判无 discovery；daemon ready 前失败必须关闭 listener、清本 PID endpoint/temp 并断开 IPC。报告资源由 build 生成并全部内联，CSP hash-only script，禁止 CDN。显式 status/open 等待注册并显示原始失败；生成/执行/检查/恢复主链只走去重提示的后台 no-throw 绑定，禁止 await 报告服务后再提交收口、autoStart、结果卡或调度。
- `alignment.json` 严格保存 `version/stage/sessionFile/autoStart/depth/alignmentTurns/lastAlignmentQuestion/createdAt/updatedAt`；缺字段或非法字段直接报错。`updatedAt` 是严格单调 generation CAS revision。pre-draft 目录独占预留后立即加 Flow dir 锁，首次提交先 alignment 后 Flow；后续插件 mutation 全部锁内重读并比较 revision/session/status，stale callback 零写入。双文件更新同样 alignment-first、禁止旧 Flow rollback；恢复只把未暂停 Flow 对齐到较新的 alignment。`draft + meta` 是已校验提交标记：有残留 alignment 时只删残留；`draft + meta:null + alignment` 是 builder 中断态，semantic 可读且 draft 校验通过才补 meta 后删除 alignment，否则回到 generating repair，禁止直接执行。初始、恢复、澄清/确认、repair prompt 均在锁外切模型，锁内核对当前进程 prompt token + revision/session/status，递增 alignment revision 取得 durable claim 后同步投递，不持锁等待 agent turn；同进程 token 与跨进程 revision 都是单赢家，stop/takeover 先提交则旧 prompt 不发送。Q&A 不进生成前 `flow.json`；生成成功后先写入 `meta.alignment`，再删除 alignment。
- `parallelRun`、`checks.acceptance` 与 `checks.quality` 是运行时字段，由插件初始化和更新，模型不写。
- Context Evidence 只从 `sessionManager.getBranch()` 原始事件临时派生：不消费 compaction summary/details；不同事件不按正文去重，入选原文不遮罩；计划生成用 `requirements` 投影，验收/质检/顾问共用 `review` 投影；按目标模型最小 `contextWindow` 自动预算，关键证据溢出必须停止，不提供公开预算配置。
- 计划生成默认 1 个执行步骤；`final_acceptance` 可选（0 或 1 个，有则必须在最后）。验收前收口闸门：自然结束但计划仍有 [ ]/[~] 时先发隐藏延续顶回执行模型（每验收轮最多一次，内存态，[!] 放行），再次结束放行交验收仲裁；投递受阻（排队消息/待投延续）或发送失败时推迟验收不放行；串行失败通知 + 写 `attention`（system_error）并请求接管，「/flow go」重试，成功重投自清；并行 worker 失败复用 BLOCKED 收口（自身 artifact 写 paused+handoff 后退出，父控制台提交 attention）。所有「暂停且需接管」路径（验收系统错误/硬上限/配置错误/质检 stop/闸门投递失败）统一走拓扑感知暂停：接管事实随 canonical 事务原子落盘（串行写 flow.attention 保留真实 kind；worker 映射为 user_action_required handoff 并发 blocked 事件驱动退出）；`setFlowAttention` 在 worker 进程内直接无效（单写者约束）。检查停滞自愈（Flow 与独立 `/review` 同一套节奏）：连续 2 轮检查未通过注入修订许可（仅 Flow，与顾问首咨同轮解锁，修订合法性由检查仲裁按启动快照 diff 裁决）、连续 2/4/6/8 轮自动咨询顾问模型（`modelRoles.advisor` 兼任计划与顾问，`current` 时咨询回落第一个 reviewer；`advisor.enabled` 是自动+手动总开关；失败卡先落盘，咨询完成后建议以独立卡展示并结构化入 `rounds[].advisor`）；Flow 串行步骤有尾部未解决失败时可用 `/advisor` 绕过节奏手动咨询，建议落最近失败轮并由 `pendingAdvisor` 排队到下一次 `/flow go`/延续，Context Evidence 明确排除建议；第 2 轮起检查 prompt 注入往轮发现清单与跨轮收敛规则、计划修订会连同仲裁要求注入检查 prompt、连续 10 轮强制 `paused` + attention。执行模型声明 `BLOCKED: <待办>` 时不送检查：串行在一次 Flow 写入中提交暂停与接管待办，锁忙时持久化 outbox 并订阅释放；并行 worker 原子写 paused + handoff 后退出，父控制台停掉其余 lane 并在一次 Flow 锁事务中收口 paused + attention。HTML 刷新失败不否定 canonical 提交；不发结果卡，活动框显示「等待你接管」；详见 `docs/runtime-contracts.md`。
- 计划轨迹继承（prewalk，未配置时运行时回退 `false`，随包 `config.template.json` 默认开启；隔离 harness A/B 见 `npm run eval:prewalk`，3 类单文件合成任务 × 9 对：读工具调用 1 vs 54、首步中位提速 1.4×、成本中位 0.99× 持平；真实 Flow 初步 A/B 见 `npm run eval:prewalk:flow`，3 对串行含验收/质检：fork 在生产链路工作、全部收口，但成本上 fork 仅 1/3 对占优，并行 worker 路径未实测；样本不足以宣称普遍收益，官方模板选择开启）：首批执行会话从生成会话 fork（串行 `ctx.fork`；并行每 lane 由 `prewalk.ts` 纯 fs 自实现分支拷贝——宿主包运行时动态 import 在 `-e` 加载形态下不可解析；分支基于磁盘文件，记忆不随 session_shutdown 清除），执行模型继承计划探索减少重读；生成记忆只由 applied 最终 draft 在释放 Flow 锁后登记，workspace fingerprint 不在锁内计算，stale/stop/takeover callback 不登记；资格＝首批 + 记忆命中 + 上下文 <50% + 计划完成点 leaf 未漂移 + 工作区指纹未漂移（git HEAD+diff+porcelain+untracked 路径与内容，排除 .flow；非 git 保守不 fork）+ 无运行态 entry，fork 点永远是记忆的计划完成点；资格不满足时回退冷启动，配置/分支 IO 错误不吞；启动 prompt 附解禁句；每个 goal 记 `sessionAnchorId`，验收/质检/顾问证据只取锚后执行段；串行第 2 步起不 fork、不链式 fork。详见 `docs/runtime-contracts.md`。
- `completionCursor` 是完成链恢复路由字段；用户界面不展示内部枚举。
- 用户可见文案只用「验收」「质检」；多步步骤称呼「第 N 步」，单步 Flow 的检查/完成提示不展示多余「第 1 步」；内部状态必须映射成人话。
- 根目录 `config.json` 是本机配置，必须忽略；发布只带 `config.template.json`。
- 合法运行目录仅为 `.flow/F<N>/`，`flow.id` 必须是同一个裸 `F<N>`。并行 worker session 位于 Pi 默认 session dir；worker 使用 `flow.json.goals[i].file` 指向的根目录步骤 Markdown，唯一运行态为 Flow 根目录 `Gx-worker.json`（schema v3；唯一写 owner 是 worker 进程，父进程只写 `Gx-worker-events.json`），完成凭证写 `completion`，BLOCKED 接管凭证写 `handoff`，不生成额外 worker 目录或 step-level HTML 报告。
- 同一 cwd 可有多个可推进 Flow（`aligning/generating/draft/paused/running`）；用户提示使用裸 id（如「/flow go F4」、「/flow stop F4」）。无 id 命令只在当前 session 归属或唯一可推进 Flow 时路由，多义必须要求显式 id；pre-draft 归属看 `alignment.json.sessionFile`，parallel 归属看 `parallelRun.consoleSessionFile`，串行 running / 已执行 paused 归属看 running Goal 的 `sessionFile`。
- 「/flow go [id]」是唯一推进/恢复语义入口：pre-draft 继续对齐或生成，draft/未启动 paused 启动，已执行 paused 恢复，running 幂等收口，complete 只打开报告；串行 Goal 的 session 文件不存在或 running runtime 缺失时，只有无 goalId/cursor/result/handoff/advisor/归因/检查证据的纯启动中断可原子 reset 后重开；runtime 先持久化到 session，再在执行 prompt 前于已有 Flow 锁内写真实 `goals[].goalId`，paused 恢复若轮换 ID 也在恢复 prompt 前同步，故已收到执行 prompt 的步骤不得仍为 `goalId:null`；session 存在的 pending Goal 可首次建立 runtime，其余一次写入 `paused + interrupted attention` 并保留 running Goal 全部字段，重复 go 不改中断时间；即使检查 cursor 可续跑，整个 session 记录失联也必须先恢复原记录或另建 Flow，禁止伪造 runtime、重发执行 prompt或回落普通 start；自动推进只登记 session transition intent，脱离生命周期事件派发并 `waitForIdle()` 后复用同一推进逻辑，禁止在 `agent_end` / `agent_settled` 内替换 session，`withSession` 禁止使用旧 `pi` / `ctx`；`/flow status [id]` 是隐藏诊断入口，pre-draft 只输出文本不生成 HTML。
- 「/flow stop [id]」写入 `paused` 且保留恢复事实：pre-draft 保留 `alignment.json` checkpoint，串行 running 写 completion boundary 并暂停目标，parallel 会 abort active batch、杀 worker 进程树、稳定收口已完成 completion，未完成 worker 置 `paused` 并保留 `parallelRun`；若因此所有步骤已完成则落成 `complete` 并清空 `parallelRun`。
- Flow 写操作、active parallel batch 和 live report watcher 都按 Flow dir 作用域管理，禁止退回 cwd 单例。生成锁冲突只用 `watchFlowLockRelease()` 一次性等待并按 `dir + expected revision` 合并 waiter；用户对齐/补充输入保留同一 continuation，释放后 CAS 成功才追加可见输入并续投 prompt，stale 零追加零投递；再次锁忙明确提示，禁止轮询/sleep。被观察文件持续监听父目录以跨越 temp+rename inode 更换；每个 watcher 同时最多一个 25ms `unref` 派生刷新 frame，首次注册安排一帧覆盖 OS 订阅建立窗口；frame 重读 `flow.json`，串行核对当前 Goal，并行核对 `parallelRun.id` 与 worker artifact 代际；close 取消 pending frame。命令事务后的最终 HTML 仍同步尝试，watcher 使用结构化 no-throw 写入结果，timer callback 不产生未处理异常；相同内容仍不写盘、不发 SSE reload。
- 活动态固定框（执行中/验收中/质检中/优化中/顾问介入中/生成中/修复中）宽度 ≥60 列显示火焰：内容左对齐 + 全高火焰作为紧凑组合整体居中，间隔 8-16 列、两侧边距 ≥6 列；框级活动不叠加 spinner，验收/质检/顾问的每模型 spinner 只在首个结构化子进程事件后出现，空注册占位不渲染；宽度 <60 回退无火焰居中布局；等待用户回复/确认、等待你接管、已暂停、预算受限不显示火焰；并行 lane dashboard 不显示火焰，running lane 最近活动首行只显示小 spinner。
- 并行、验收、质检、顾问的 progress scope 在 TUI 自动打开监控悬浮窗；Esc 只关闭并静默当前 scope，Alt+S 可重开，scope 关闭后清除静默记忆；Pi 只给默认 editor 安装 extension shortcut dispatcher，`FlowActivityEditor` 必须在输入隐藏守卫前显式转发监控键，overlay close 同步清活动 handle；`matchesKey` 经 `shared/tui.ts` 运行时桥并由入口注入，lazy module 禁止静态 import optional host package；结构化进度只存进程内存，不落 canonical 状态。
- worker 没有用户可调用的公开子命令；父 session 通过私有 bootstrap 启动，崩溃恢复入口是「/flow go」。
- 重启恢复：`session_start` 对检查/收口阶段（`*_retry`/`finalize_retry`）自动续跑，修复/执行阶段显示真实「已中断」框不自动烧 token；`agent_end(stop)` 按 cursor 路由（quality_repair 直接续质检）；独立 `/review` 用 checkpoint v2（`active/round/phase`）恢复；忙碌带文本时 `agent_end` 必须在同步入口冻结所属 loop + skip 位，禁止延迟回调读取 `message_start` 已改写的可变归属；`round:0 + awaiting_agent` 是执行后自动质检的武装态，重启只显示「已中断」且不自动烧 token，保持回复输入可见但仍捕获 Esc/Ctrl+C 取消，用户回复完成后由 `agent_end` 进入第 1 轮；review-only shutdown 必须清 activity-frame 安装态/旧 TUI，确保宿主 teardown 后新会话重装编辑器；所有恢复入口对在跑检查幂等；详见 `docs/runtime-contracts.md`。
- `.flow/reviews/` 只保存按 session 文件名生成的独立 `/review` HTML 投影；运行时不从该目录读取状态，不写 JSON，不扫描恢复。每次 HTML 写盘成功后由同一 refresh 点发布报告 status，禁止终态分支各自手工编排；独立质检的事实源仍是 session `review-checkpoint`；goal-scoped 质检不写该目录。
- `.flow/` 是运行态产物，默认忽略，不进入开源仓库或 npm 包。GitHub 保存源码；npm 入口只指向预编译 `dist/index.js`，发布包不含 `src/`、测试、评测或 release 脚本。
- README 面向用户（英文主体 `README.md` + 中文 `README.zh-CN.md`，两份都受 `copy-lint-smoke` 保护）；AGENTS 面向维护者与编码代理；`CONTEXT.md` 是领域词汇表（活文档，用法冲突确认后随手修订）；`docs/PRODUCT.md` 是产品边界三行版，防止给极简插件顺手加企业级功能；`docs/` 只保留当前事实源，不放历史 backlog 或未执行计划；npm 包不发布 docs。社区文件（CONTRIBUTING、SECURITY）放 `.github/`。

## 测试约定

- 行为变更必须跑受影响 smoke；发布前跑 `npm run check && npm test`。
- `npm test` 的 pretest 只构建一次根 `dist/`，各 smoke 通过 `tests/prepare-dist.mjs` 复制到独立临时目录；直接运行单个 smoke 时仍自行编译。新增 smoke 禁止重复手写整库 `tsc`。
- 实际绑定固定 49327 的 flow/review/report-server/package smoke 必须持有 `tests/report-port-lock.mjs` 的机器级 TCP 测试锁；锁只序列化测试，等待 holder 连接关闭且由 OS 随进程释放，不轮询、不改变生产固定端口或 endpoint discovery。新增端口 smoke 必须接入同一锁。
- 文案变更同步测试断言；不要为了过测降低断言强度。
- `tests/copy-lint-smoke.mjs` 保护用户可见文案，新增公开文档时同步检查范围。
