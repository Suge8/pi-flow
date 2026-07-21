# 运行契约

只记录当前实现。不要写计划、历史留档、backlog。改行为时同步更新本文档和 smoke。

## 按需激活

- `src/index.ts` 只初始化语言和 `src/bootstrap.ts`。bootstrap 在任何领域模块加载前注册 `/flow`、`/review`、`/advisor` 命令外壳及 `session_start` / `session_info_changed` 代理；空闲、无恢复事实的普通 Session 不加载 Flow、Goal、Review、Advisor、HTML 报告或 session-name 同步链，也不启动 watcher、timer、server 或子进程。
- 每个 ExtensionAPI 分别持有 Review 与 Flow/Goal 域的单次加载 Promise，状态只从未加载进入加载中、已加载。`/review` 只激活 Review；`/flow`、`/advisor` 激活 Review、Goal、Flow，且复用同一个 Review Promise。并发命令与恢复触发共享 Promise；import/注册失败向调用者抛出并清除加载中状态，下一次显式操作可重试；ESM 不卸载。领域初始化、result-card renderer 与每个原生 event listener 另按 ExtensionAPI + 注册项逐项记账，只有注册成功才提交；中途失败后的重试跳过已成功项，只补失败项及其后续项。
- `session_start` 先用轻量事实源探测：`PI_FLOW_WORKER_*` 是否存在、`flowOwnerForSession`、最新有效 `goal-state` entry、独立 `review-checkpoint`。任一独立 review checkpoint 都加载 Review：`phase` 非空时恢复循环，`phase:null` 时只恢复既有报告的 status URL。命中 Flow/Goal/worker 时先注册 Review→Goal→Flow 的后续原生事件，再按原顺序显式执行 Goal→Review→Flow 当前启动钩子；只命中独立 Review 时仅加载并执行 Review 钩子。域已加载后，每次 Session 切换仍显式执行对应启动钩子，但不重复注册监听器。当前事件禁止依赖分发过程中新增 listener 的宿主行为。
- worker 环境存在性与完整解析共享 `flow/execution/worker-protocol.ts`；部分环境同样激活运行时，再由原 worker 启动逻辑报告真实错误。`session_info_changed` 发生后才动态加载 `shared/session-name-sync.ts`，每个真实改名事件只执行一次同步。

## 状态

- `flow.json` 是唯一规范状态源，只接受 `schemaVersion: 17`，不迁移、不改写其他版本。自动扫描跳过版本不受支持或损坏的运行态，显式 id 访问返回明确错误；canonical 目录只允许 `.flow/F<N>/`，`flow.id` 必须是同一个裸 `F<N>`。
- v17 的 `source` 是严格 union：会话来源保存 `{type:"conversation", transcript:[{kind,at,text}]}`，其中 kind 仅限 `user` / `visible_supplement` / `assistant_final`；显式 prompt 保存 `{type:"prompt", text}`；文件保存 `{type:"file", path, text}`。三种形状禁止额外字段，不保存派生平文，不读取旧形状。其余规范字段均由插件维护，模型不写：`meta`（`plannedBy` + `alignment`；新 Flow 有对齐时保存 `{kind:"recorded", turns:[{question,answer}]}`，轮数只由 `turns.length` 推导，无对齐为 `null`；生成成功先提交 canonical 原文再删除 `alignment.json`）；`attention`（需要接管的异常事实 `{kind, message, at}`，kind 限 `check_hard_cap`/`system_error`/`interrupted`/`user_action_required`；硬停、检查系统/配置错误、执行中断、BLOCKED 接管时写入，「/flow go」确认可安全推进时清空；失联步骤保持原 interrupted 事实；用户主动 `/flow stop` 不写；串行 BLOCKED 的 `paused + attention` 在同一次 `flow.json` 写入中提交）；`flow.startedAt/completedAt` 与 `goals[].startedAt/completedAt`（父进程维护的墙钟时间）；`goals[].checkAttribution`（勾级归因：只处理路径精确命中当前计划文件的成功 `edit`；`tool_call` 按 `toolCallId` 保存调用前快照，`tool_result` 重放该调用的精确 edits，只有该操作自身的非完成 → `[x]` 才记当前会话模型/强度/工具完成时间；配对以 replacement 范围和未触碰文本的偏移为准，数量变化不会跳过整段：直接新增 `[x]` 记当前时间，删除 `[x]` 清理旧归因，未触碰项在重复文案序号漂移后仍迁移原归因；同一调用内多项共享时间，取消勾选删除旧归因，重勾重新计时，可明确配对的 `[x]` 改文/重排迁移原归因且不刷新时间；重复文案含混合状态时先以「状态 + replacement 内相对位置」证明未改项；前后数量相等的混合状态组若位置无法证明身份，禁止再按「文案 + 状态」跨位置补配，按删除 + 新增处理；数量变化时，剩余同文案只有在状态相同且前后各自唯一时才配对；精确匹配后同一 replacement 只剩前后各 1 项时才认定为改文，多项无锚点替换按删除 + 新增处理，禁止按数组位置猜身份；串行归因先写 session `checkbox-attribution-outbox`，每笔待提交事实携带稳定的 `flowId + goalIndex + goalFile`、有序 key 级前值/后值 delta 与原时间；canonical Flow 锁忙时通过进程内释放信号 + 一次性 `.flow.lock` watcher 等待，生命周期事件与 `session_start` 兜底重试；锁内按稳定步骤定位，不依赖 `currentGoal`、运行状态或 session 归属，已暂停/完成/推进后的旧步骤仍可提交；每个 delta 只在当前值等于前值时应用，冲突只接受更新的完成事实，不用旧整表覆盖其他归因；事务只改目标步骤 `checkAttribution` 并刷新 HTML，不覆盖检查 checkpoint 或其他运行态；失败调用、外部夹入、`agent_end` 与页面刷新均不归因；执行期对当前计划的 `write` 以及无法在调用前快照中唯一、非重叠重放的 edit 直接阻止并要求精确 `edit`；key = 区块 + 归一化文本 + 同文本序号，未经过受管 edit 的外部改文只影响展示）；`checks.*.rounds[].advisor`（结构化顾问建议 `{model, thinking, advice}`，不再嵌 details 文本）、`goals[].pendingAdvisor`（手动建议持久化 outbox，只存 `{phase, round}` 引用，必须指向含建议的失败轮，送达执行模型后清空）与 `rounds[].elapsedMs`（轮次用时，源于 `active.startedAt`）；`checks.*.consulting` 是瞬态运行字段（顾问咨询进行中），下一次检查状态同步自然覆盖。
- 扫描、定位和校验只识别裸编号目录 `.flow/F<N>/`，其他目录名均不进入 Flow 路由。
- 进入 `/flow` 生成或对齐流程时，插件先以独占 `mkdir` 预留 `.flow/F<N>/`，随即取得该 Flow dir 锁，在同一初始化事务中先写 `alignment.json`、再写可恢复的 pre-draft `flow.json`；因此 `flow.json` 一旦可见，对应 alignment 必然已存在。初始化失败只由预留者在锁内清理尚未发布的目录。模型只写该目录内的 `flow.semantic.json` 和计划 Markdown。builder 组装规范状态时，在 canonical validator 前为缺失的可空 `Notes` / `Handoff` 章节追加空标题；其余章节缺失仍进入模型修复。builder 只改 Flow 目录内的普通文件。
- 顶层状态只允许 `aligning` / `generating` / `draft` / `paused` / `running` / `complete`；旧取消态非法，不迁移。pre-draft 必须是 `goals: []`、`currentGoal: 0`、`startedAt: null`、`completedAt: null`、`parallelRun: null`，可处于 `aligning` / `generating` / `paused`。
- `paused` 是唯一停止态：不写 `pausedFrom`、`stopped` 或第二套生命周期字段。pre-draft 暂停从 `goals: [] + alignment.json` 恢复；未启动计划暂停为 `startedAt: null`；已执行串行暂停从当前 running Goal 的 `sessionFile` 恢复；已执行并行暂停保留 `parallelRun` 并由并行控制台 reconcile。
- `alignment.json` 只用于生成前子阶段，严格要求 `version/stage/sessionFile/autoStart/depth/alignmentTurns/lastAlignmentQuestion/createdAt/updatedAt`，其中 `depth` 只能是 coarse/standard/deep；缺字段、未知字段或非法值直接报错。`updatedAt` 同时是严格单调的 generation revision，每次写入取 `max(Date.now(), previous + 1)`。插件拥有的问答、stage、失败、repair、接管、暂停/恢复和 semantic 收口都在 Flow dir 锁内重读 Flow + alignment，并比较 id、revision、session owner 与允许状态；不匹配的 late callback 零写入。需要同时更新两文件时固定先写 alignment、再写由它派生的 Flow，第二步失败保留较新的 alignment 供恢复重算，禁止旧 Flow rollback；锁忙只通过一次性释放 watcher 重试一次，不轮询。用户的对齐回答或 blocking 补充遇锁忙时保留同一 input continuation：CAS 提交成功后才追加可见输入并投递下一条隐藏 prompt；stale 则零追加、零投递。生成成功则先提交含 `meta.alignment` 的最终 draft Flow，再幂等删除 alignment。恢复时 active alignment 可把未暂停 Flow 的顶层状态对齐到 stage，显式 paused 不被被动覆盖；最终 draft 已含 meta 但 alignment 残留时只删除残留，不重发模型。若崩溃发生在 builder 首次落盘 `draft + meta:null` 后，恢复以 meta 继续作为提交标记：semantic 可读且 canonical draft 校验通过时锁内补写 `meta.alignment`（无法恢复计划模型时 `plannedBy:null`）再删 alignment；semantic 缺失/损坏或 draft 校验失败时回到 `generating + errors` repair，禁止把未校验 draft 当作已提交计划执行。发送失败或校验失败保留 `generating + errors` 和 alignment；用户暂停 pre-draft 时写 `flow.status = "paused"` 并保留 alignment 作为恢复事实记录。
- 自动推进不得在 `agent_end` / `agent_settled` 派发链内替换 session。生成完成、串行步骤完成与并行 fan-in 只登记当前 session 的单一 transition intent；一次性 `setImmediate` 脱离事件派发后等待原 command context 的 `waitForIdle()`，再重读 canonical Flow 并启动下一步。同一 session + Flow 的重复 intent 合并，冲突 intent 拒绝；`session_shutdown` 取消尚未执行的 intent。重启后或没有 command context 时保持 canonical 可恢复状态并提示「/flow go F<N>」。若进程在新 Goal 写入 `running + sessionFile` 后、session 文件首条记录落盘前退出，「/flow go」只在该 Goal 尚无 goalId、检查轮、结果、归因、顾问待投或 completion cursor 时把纯启动中断原子重置为 pending 后重开。runtime 创建后先写入 session，再在执行 prompt 投递前于既有 Flow 锁内把真实 ID 写入 `goals[].goalId`；paused runtime 恢复时若轮换 ID，也在恢复 prompt 前同步，因此 `goalId:null` 只能代表尚无可执行 runtime 的启动窗口，不能覆盖已收到执行 prompt 的步骤。除此之外，当前 Goal 的 session 文件不存在，或文件存在但 running Goal runtime 缺失时，禁止新建 session、伪造 runtime 或重发执行 prompt；同一 Flow 写入原子保留 running Goal 全部证据并提交 `paused + interrupted attention`，重复 `/flow go` 只重复接管提示，不改写 `updatedAt` / `attention.at`。即使 cursor 位于检查/收口阶段也不能在整个 session 记录失联时自动续跑，因为检查依赖的原对话与 token/时间证据不在 Flow canonical；恢复原会话记录后才可重试，另一条真实路径是基于现有计划和仓库创建新 Flow。该分类不是 HTML repair 或 plan repair。`newSession` / `switchSession` 的 `withSession` 内只允许使用回调传入的 `sessionCtx`，禁止捕获旧 `pi` / `ctx`。
- `flow.semantic.json` 的 `goals[]` 可声明 `dependsOn`（先序 0-based index；缺省等同依赖前一步，`[]` 表示无前置）和 `writeScope`（只允许 `**` 或以 `/**` 结尾的相对目录 glob；缺省视为未知写入范围）。
- Flow 最多 10 个 `normal` 执行步骤；生成默认 1 个执行步骤，只有拆分判据（单会话上下文装不下 / writeScope 不相交可并行提速 / 真实阶段交接边界）成立才拆分。
- `final_acceptance` 可选：0 或 1 个，有则必须位于最后（多步无最终验收、单步带最终验收均合法）；默认不生成，串行 Flow 把全局验证与 docs 收口写进最后一个 `normal` 步骤的 Steps；最终验收不占 10 个执行步骤名额。
- `flow.json.parallelRun` 是落盘并行运行门闩：`null` 表示无活动并行运行；非空时必须为 `{ id, goalIndexes, startedAt, consoleSessionFile, consoleSessionName }`，表示这些 Goal 属于同一个并行运行，且由该控制台 session 拥有。
- 并行开始时插件先打开或恢复可见控制台会话；该会话是唯一前台 owner，负责 dashboard、worker 启动、fan-in 和后续调度。控制台命名为 `F1-G2+G3 并行控制台`，超过 4 个 lane 时写作 `F1-G2+G3+G4+… 并行控制台`。控制台先写 `flow.json`：批次内待运行 Goal 置为 `running`，写入各自 `startedAt`，记录默认 session dir 下的 worker `sessionFile` / `sessionName` / `snapshot`，`currentGoal` 指向批次最小下标，`parallelRun` 写入当前运行；该字段保留到全量 fan-in，部分失败或暂停时不清空。
- 并行 worker 使用 `flow.json.goals[i].file` 指向的 Flow 根目录步骤 Markdown（通常为 `G<N>-*.md`）作为唯一 markdown 事实源。`G<N>-worker.json`（schema v3）的唯一写 owner 是 worker 进程（启动前的 init 与退出后的 failed 标记除外）；父进程运行期只写独立的 `G<N>-worker-events.json`，用于 live report 刷新和保留进程/JSON 解析错误，禁止跨进程对同一 JSON read-modify-write。worker 的勾级归因实时写该 artifact 的 `checkAttribution`，live report 从这里投影；`completion` 是完成凭证，`handoff` 是 BLOCKED 接管凭证，两者必须属于匹配的 `parallelRunId`，且不能同时存在。同一 `parallelRunId` 的未完成 artifact 只更新运行状态和 session 归属，保留 `completionCursor/checks/result`；重新启动时清空已消费的 `handoff`。respawn 恢复按 `completionCursor` 判定（active checkpoint 为空也成立）：检查/收口阶段（`*_retry`/`finalize_retry`）的 CLI 初始 prompt 换为 hold 指令防止重复执行，worker bootstrap 按 cursor 续跑检查；修复/执行阶段正常重新投递执行 prompt。worker 不写父级 `flow.json`、不触发调度；运行时不读取其他 worker 目录或结果文件。
- 控制台收齐当前 run 的全部 completion 后 fan-in 写 `flow.json`：对应 Goal 标记 complete 并写 `completedAt`，`result/handoff/checks` 从 completion 提交；全部步骤完成时同时写 `flow.completedAt`；始终清空 `parallelRun`，再通过统一调度器计算下一批。任一 worker 写入 BLOCKED `handoff` 后正常退出；控制台立即终止同批其余 lane，在 Flow 锁内用一次 `flow.json` 写入收口已到 completion，并同时提交 Flow paused、未完成 Goal paused、受阻 Goal 为 `currentGoal`、`attention: user_action_required`，保留 `parallelRun` 供恢复。普通部分失败、退出非 0 或缺 completion 时，已完成 lane 先收口 complete，未完成 lane 标记 paused，Flow 标记 paused 并保留 `parallelRun`；`errors` 写失败 worker 的 step label、exit code / signal、是否缺 worker completion 和 stderr 摘要。`/flow go` 后 reconcile 同一 `parallelRun`：completion 已到的 lane 不重跑，只启动缺失/暂停 lane；已 complete lane 保留原 `startedAt/completedAt`，fan-in 不重复提交其 completion fact。
- `/flow stop` 会 abort 活动 batch 并杀 worker 进程树；已完成 completion 先收口 complete，未完成 lane 标记 paused，若仍有未完成步骤则 Flow paused 且保留 `parallelRun`，若所有步骤已完成则直接 complete 并清空 `parallelRun`。
- 崩溃或控制台丢失后，「/flow go」发现持久化 `parallelRun` 时进入 reconcile：加锁读取匹配 `parallelRunId` 的 `G<N>-worker.json` completion 字段，全部到齐则直接 fan-in；否则恢复原控制台或启动新的控制台，只恢复缺失/暂停 lane。
- 模型不写 `parallelRun`、`checks`、`completionCursor`、`flow.html`。
- `checks.acceptance` = 验收；`checks.quality` = 质检；两者结构都是 `enabled / rounds / active`。`active` 是当前检查轮次的 durable reviewer checkpoint：保存 `round/generation/runId/startedAt/inputHash/models`；`runId` 在同一次崩溃恢复中沿用，新逻辑检查运行重新生成；每个模型 outcome 在内部重试结束后、终态 UI 展示前原子写入。失败/终止 result-card 带基于 `phase/runId` 的 durable `deliveryId`（对应 branch 事件即 receipt），且与检查启动卡一样标记为 check control card，不进入后续 Context Evidence / `inputHash`。普通失败只有 `failed` receipt；触发自动顾问时先写 `failed` 失败卡，再以 `repair` receipt 写独立建议卡，建议结构同时保存在卡片 entry data，卡片携带触发修复回合的模型 prompt。发送失败保留 `_retry` 与已完成 outcome；发送成功但提交前中断时，重启通过 receipt 跳过重复投递并复用已完成 reviewer；`repair` 命中时还会从建议卡恢复结构化建议，不重复咨询。Goal 的 history、`active=null` 与 repair cursor 在同一个 generation-CAS / Flow 锁事务中提交；终止反馈则保留 active 到暂停收口事务。恢复只运行 outcome 为空或 reviewer 配置已变化的模型，真实用户输入变化才开启全新检查并全部重跑。
- Flow 检查 checkpoint 的唯一 owner 是对应 `flow.json` 或 `G<N>-worker.json`；独立 `/review` 使用当前 session 的 `review-checkpoint` custom entry（严格 v3：`active/round/phase/history/reportRun`；v2 无兼容读取）。`reportRun` 是目录账本 generation：新一轮 `max(Date.now(), previous+1)`，中断恢复复用同一值，终态后新一轮必须递增。`round:0 + phase:awaiting_agent + active:null` 表示执行完成后自动质检的武装态；`round>=1` 时 `phase` 区分检查中与等待修复，`history` 保存往轮发现供重启后跨轮收敛与失败计数不失忆。异常退出与 Flow 暂停保留 checkpoint；独立 `/review` 的用户主动取消清除 checkpoint，generation 冲突不覆盖更新 owner，真实写入失败必须明确提示并保留 checkpoint 供重启恢复，禁止假报「质检已取消」。Flow 锁忙或 generation 已失效时，验收与质检 checkpoint 都返回结构化 `deferred`：立即结束当前检查 run，但不记为检查错误、不暂停 Goal、不改写 Flow；Flow 与 Goal 保持运行态，后续由 `/flow go` 按 canonical checkpoint 重试。
- 独立 `/review` 每次提交 checkpoint 后只把投影请求写入当前 context 的单一后台队列；启动卡和 reviewer 先启动，队列在下一事件帧重读最新 `review-checkpoint`，合并帧内旧请求并串行渲染，再用异步文件 IO 写到 `<cwd>/.flow/reviews/<session 文件名去扩展名>.html`，因此旧 HTML 不会在新 checkpoint 后落盘覆盖。页面与质检 prompt 共用 `buildContextEvidence` 的 review 投影，证据 modal 原样展示实际投喂的 coverage、对话证据与操作证据，并投影 active、完整 history 和 `rounds[].advisor`；报告通过该轮 active generation 的首条 checkpoint 定位 prompt 构建时的 branch 边界，未再次送检的后续修复回合不得混入；预算等原因导致投影失败时页面显示原因。该目录没有 JSON、锁、扫描、watcher，也不从 HTML 反读状态；`session_start` 只按当前 session 文件名定位已存在的 HTML 并后台恢复 status URL，删除后会在下一次独立质检 checkpoint 提交时重建。HTML 写盘成功后由同一投影任务发起后台注册，status URL 在服务就绪后独立出现；结果卡和终态通知也不等待报告。渲染或报告服务失败只通知，不回滚 checkpoint，不中断质检；`session_shutdown` 在释放 status context 前等待已入队投影收口，禁止迟到任务重新绑定旧 context。goal-scoped 质检不生成该投影。round-0 武装卡同步发布，保证带文本需求在同一调用栈立即入队；报告存在后只在 status 常驻 live URL，启动卡、轮次结果卡与终态通知不重复附 URL。首个 checkpoint 前的配置错误没有报告，不伪造入口。
- `completionCursor` 只用于阶段级内部恢复路由，用户界面不展示；禁止按模型扩展 cursor。

## Context Evidence

- `src/shared/context-evidence.ts` 是上下文取证单一实现：直接遍历 `sessionManager.getBranch()` 原始事件，分类真实用户、`Pi Flow 用户补充`、assistant 最终声明、内部控制、检查卡、工具调用/结果和压缩边界。原始 branch 可用时不读取普通或 native compaction summary，也不解析压缩插件 details。
- 同一事实层提供 `requirements` 与 `review` 两种投影。conversation 无显式参数时，`requirements` packet 以 `conversation: [{kind,at,text}]` 返回入选对话，插件原样保存到 `flow.source.transcript`；计划、修复 prompt 与报告需要平文时统一调用 `formatTranscript` 现场派生，不存第二份文本，也不从文本反解析。prompt/file 来源直接保存各自 `text`，文件另存 `path`。验收、质检和顾问继续共用 `review` packet，其投影语义不变：按 `toolCallId` 配对结果，保留失败头尾、最近验证、edit/write 路径与最近操作链；旧成功 read/bash 输出只留动作和状态。真实用户与可见补充保留原文、时间、顺序和格式；不同事件即使正文相同也保留，入选内容不做凭据遮罩。Goal、Plan、往轮检查仍由各自 canonical 状态提供，不从事件中重写。
- 每次构建按目标模型中最小 `contextWindow` 预算：初始 prompt 上限为 `min(128K, contextWindow × 25%)`，先预留 Pi system/tool 空间，再扣协议、Goal/Plan 与往轮内容；证据 soft target 由真实三模型 A/B 锁定为 32K（16K 关键原文溢出，32K/64K/96K 生成相同的完整 packet），关键来源可增长到动态 hard limit。A/B 用固定 requirement/defect ID、packet 内真实 entry/call 定位符、所属 block 的精确原文与正负 rubric 判分；fixture 为每个预期 ID 声明允许的定位符和原文锚点，多事件缺陷必须逐组举证。每个 reviewer 独立采样 3 次，需求召回/缺陷检出按 2/3 多数、误报数取中位数。Transcript 基线与候选共用同一 prompt、scorer 和 benchmark 指纹，基线 artifact 保存实际输入并由当前 scorer 重算，唯一变量是上下文材料。模型窗口无法解析、固定 prompt 已溢出或关键来源仍超 hard limit 时返回结构化错误；计划生成拒绝启动，验收/质检暂停，顾问按 unavailable 退出。公开配置没有上下文预算参数。
- 检查在 reviewer pool 启动前构建一次不可变 packet，所有模型共用，packet 全文进入 `inputHash`。check control 和内部消息的动态数量不写入 packet 文本，避免同轮恢复因新 receipt 改变 hash；修复完成后的下一轮重新取证。

## 重启恢复

- 目标 session 重启（`session_start`）时先从 canonical `flow.json` / worker artifact 对账重建验收/质检 history、round 与连续失败数，再按 cursor 自愈。检查/收口阶段（`acceptance_retry`/`quality_retry`/`finalize_retry`）在空闲时自动续跑（durable checkpoint 幂等，只跑未完成模型）；若启动时 busy 或有待处理消息，则在该 session 记录 pending，并由下一次 `agent_end` 幂等续跑，不轮询、不永久放弃。修复/执行阶段不自动触发模型，活动框显示真实「已中断」（无火焰）+「/flow go F<N>」恢复入口。worker 进程由私有 bootstrap 负责恢复，不双触发。
- 无活动循环时的 `agent_end(stop)` 按 cursor 路由完成链：`quality_repair` 直接续质检（不重跑验收），`acceptance_repair`/`null` 进验收，`finalize_retry` 直接收口。
- 同一目标的验收/质检已在跑时，所有恢复入口（session_start 自愈、/flow go、agent_end 路由）幂等返回，禁止中断重启已在进行的检查。
- 独立 `/review` 的 `phase=checking` 在空闲时自动恢复（autoFix / manual 均适用）；启动时非空闲则显示「质检 · 已中断」框并由下一次 `agent_end` 幂等重试（不轮询）。`round:0 + phase=awaiting_agent` 在 autoFix / manual 下都只重建武装骨架，不自动触发模型；显示「自动质检 · 已中断」，保持回复输入可见，但显式捕获 Esc/Ctrl+C 以清除武装；用户回复开始执行时切回「执行中 · 完成后自动质检」，本轮 `agent_end` 后进入第 1 轮。`round>=1 + phase=awaiting_agent` 仍只属于 autoFix 修复等待，用户任意回复继续修复后，`agent_end` 自动进入下一轮质检。失败反馈发送成功后，轮次结论与 `awaiting_agent` 才在同一条 checkpoint 中原子提交；发送成功但 checkpoint 提交前中断时，重启读取 result-card receipt，直接提交而不重复发卡、不重跑 reviewer。自动顾问轮恢复时保留相同的 `onRoundFailed` owner：`failed` receipt 跳过失败卡，`repair` receipt 从建议卡恢复建议并跳过顾问。manual 同样在失败卡成功投递后才清 checkpoint。终态停止（通过/用户取消/受控停止）清除 phase；终态 checkpoint 重开会话时不恢复循环，只重新绑定已存在的独立质检报告与 status URL。被动中断（shutdown/flow_stop）保留；取消来源 first-writer-wins。review-only `session_shutdown` 同步清理 activity-frame 的安装态与旧 TUI 引用，宿主移除旧编辑器后，下一次 `session_start` 必须重新调用 `setEditorComponent`。
- 裸「/flow go」无可推进 Flow 且存在已完成 Flow 时，提示最近的「F<N> 已完成」与报告入口，避免误导。
- Flow 创建时做一次 workspace 护栏（`src/flow/workspace-hint.ts`）：cwd 不在 git 仓库内警告 `.flow` 将写入当前目录；在仓库内但 `.gitignore`（cwd 或仓库根）未忽略 `.flow` 时提示补加，防止运行态进仓库或被 git clean 删除。
- `flow.startedAt/completedAt` 与 `goals[].startedAt/completedAt` 都是父进程维护的墙钟时间。新状态先初始化为 `null`；串行步骤启动事务写步骤 `startedAt`，并行批次启动事务写批内步骤 `startedAt`；串行完成、并行 fan-in 和 stop 收口 completion 时写步骤 `completedAt`；Flow 首次启动写 `flow.startedAt`，落成 complete 的同一收口事务写 `flow.completedAt`。worker 不写父级时间字段。恢复不重置开始时间，所以步骤耗时会包含暂停时段。终端完成卡的总用时只读 `flow.startedAt`，不能用 `createdAt` 兜底；HTML 的 Flow 级信息只展示开始、完成时刻，不合成总耗时数字。

## 命令入口

- 用户主入口为「/flow [需求|path.md]」、「/flow go [F<N>]」、「/flow stop [F<N>]」、「/advisor」与「/review [需求]」；`/flow status [F<N>]` 仅作为隐藏诊断入口保留，不放进主流程文案。`/review` 是三态入口：空闲无参立即质检；有参把文本作为真实用户消息投递并先写 round-0 武装态，空闲时立即执行、忙碌时按 follow-up 排到当前工具执行后；`agent_end` 同步入口冻结当时的 ReviewLoop 身份与 skip 位，延迟收口只消费该快照，因此目标用户消息开始后不能把旧轮结束误判为需求完成；执行中无参只武装当前轮。已存在独立或 goal-scoped 质检循环时仍返回 busy；`quality.enabled=false` 时三态均明确拒绝且不写武装态。
- `/advisor` 不带参数，只路由当前 session 所属的串行 Flow 步骤：必须存在尾部尚未解决的失败检查轮；零失败、失败已通过后清零、并行批次、会话忙、非交互模式均明确 no-op。`advisor.enabled=false` 同时关闭自动与手动咨询。最新失败轮已有建议或已有待投建议时不重复 spawn、不覆盖审计记录。
- 「/flow go」推进或恢复已有 Flow：pre-draft 继续对齐/生成，draft 或未启动 paused 启动执行，已执行 paused 恢复当前步骤，running 做幂等收口/恢复，complete 只打开报告并提示已完成。
- 「/flow stop」对未完成 Flow 写入唯一停止态 `paused`，保留 `flow.json`、`alignment.json` 和步骤快照；后续只能通过「/flow go」恢复。若并行 stop 收口后所有步骤已完成，则直接写 `complete`。
- 控制命令只接受空参数或单个裸 Flow id。其他 `/flow ...` 文本按新需求处理，不作为 Flow 控制别名。

## 同 cwd 多个可推进 Flow

- 同一 cwd 下可同时存在多个可推进 Flow：`status` 为 `aligning`、`generating`、`draft`、`paused` 或 `running`；每个 `.flow/F<N>/flow.json` 仍是各自唯一状态源。
- 用户命令先按显式裸 id 定位；无 id 时按当前 session 所属可推进 Flow，其次 cwd 下唯一可推进 Flow；多个候选且无归属时必须提示用户指定 id，不得默认选第一个。
- pre-draft 归属看 `alignment.json.sessionFile`；running 或已执行 paused 归属优先看 `parallelRun.consoleSessionFile`，否则看当前 running Goal 的 `sessionFile`。「/flow go F<N>」可跨 session 接管 pre-draft：锁内一次提交新的 `sessionFile` / revision 与 alignment 对应的 Flow 状态；恢复 generating 时同事务清理旧 semantic/Goal Markdown。提示中阶段重发隐藏 prompt，等待输入阶段只恢复活动卡和直接回复目标；接管或 paused 恢复推进 revision 后，旧 session / 旧 revision 的 late reply、`agent_end` 和 repair callback 均无权写入。
- 当前 session 直接输入非命令文本时，若有显式「/flow go F<N>」记住的 pre-draft 回复目标，优先继续该 Flow，直到完成、暂停、失效或被其他 session 接管；无记忆目标时，只有当前 session 归属的 `aligning/generating` Flow 恰好一个，才继续对齐或回答 need-input；多义时不猜测。并行控制台只允许「/flow go F<N>」或「/flow stop F<N>」，普通输入不进模型、不写历史，只提示可用命令。
- pre-draft `/flow status` 只输出文本状态、当前问题/下一步和错误，不生成或打开 `flow.html`；draft/running/complete 沿用 HTML 报告逻辑。
- Goal runtime、完成事实、检查进度同步都按 `sessionFile` 找所属 Flow；`completion fact` 只写回该 session 所属的 `flow.json`。
- 写锁、`parallelRun` 活动批次和 `flow.html` live watcher 都以 Flow dir 为作用域；禁止回到 cwd 级单例。

## 计划轨迹继承（prewalk）

- 目标：首批执行会话从生成会话 fork，执行模型继承计划模型的代码探索与对齐问答，减少执行会话重读。`prewalk.enabled` 是总开关；未配置时运行时回退值为 `false`，随包 `config.template.json` 默认开启。证据现状：`npm run eval:prewalk`（无参默认即 3 任务 × 9 对）是**隔离 harness A/B**——真实模型调用，但绕过 /flow 扩展路径与验收/质检环节，任务为 3 个单文件合成任务（探索实现/读密集理解/症状定位修 bug）；账单以计划完成点为界，共享计划成本单列不计入任一 arm；每任务带行为断言 + 变更范围断言；任一 arm 验证失败即非零退出。单次全量产物（fable-5 计划 + sol 执行）：专用读取工具调用 1 vs 54（bash 单列 40 vs 65），首步中位提速 1.42×（范围 0.79–2.44×），执行成本中位 0.99×（范围 0.54–1.20×，持平），质量 18/18 持平。真实 Flow 路径初步 A/B（`npm run eval:prewalk:flow`，RPC 驱动完整扩展链：生成→autoStart→执行→验收→质检；串行单步同任务 3 对，交替顺序，自包含 CLI 可复现且任一 arm 未干净收口即非零退出）：fork 在生产链路真实工作（goal 会话带 parentSession 血缘、执行段专用读取显著减少），6/6 全部 complete 且检查最终通过；但成本方向不稳（fork/cold 各对 2.20×/0.74×/1.43×，fork 1 胜 2 负，其中 1 对 fork 首轮验收+质检失败付修复轮），首轮失败归因是 first-edit swap 决策门需要继续采集的信号。并行 worker 路径未实测（CLI 对 --modes parallel 明确拒绝而非静默）。样本限单代码库单模型搭配，不宣称普遍收益；官方模板开启，删除该配置则回到运行时 `false`。指标口径：readCalls 只统计专用读取工具（read/grep/find/ls/glob），bash 调用（可能含 shell 读取）单列为 bashCalls。
- 事实源：只有最终 draft CAS 返回 applied 后，才在释放 Flow 锁后计算工作区指纹并记忆 `Flow dir → { 生成会话文件, 计划完成点 leafId, 当时上下文占用 }`（`src/flow/prewalk.ts`）；stale/stop/takeover callback 不登记，指纹计算不占锁。不落盘，重启后丢失即回退冷启动。记忆在首次启动（fork 或冷启动）时由启动路径释放；**不随 `session_shutdown` 清除**——并行控制台创建会先 teardown 生成会话，分支基于磁盘文件不需要生成会话仍在前台，shutdown 清除会让并行首批 fork 永远不可达。
- 资格（轨迹保鲜判据）：仅限首批（`flow.startedAt === null`，代码未被步骤修改）+ 串行要求当前会话就是该 Flow 的生成会话（并行分支只要求记忆存在）+ 生成完成时上下文占用 < 50%（未知视为不达标）+ **计划完成点未漂移**（记忆的 leafId 仍在当前分支上，且其后没有新对话轮 `message`/`custom_message`；插件 custom 卡片不算漂移）+ 全支无 `goal-state` / `review-checkpoint` 运行态 entry（物理拷贝会污染新会话的恢复探测；并行分支拷贝由 `prewalk.ts` 纯 fs 自实现——宿主包运行时动态 import 在 `-e` 扩展加载形态下无法解析，会让整个 flow 域激活失败）+ **工作区未漂移**（记忆时记录 git 指纹：HEAD + tracked 内容 diff + porcelain 状态 + 全部非忽略 untracked 文件的路径与内容（`ls-files --others --exclude-standard` 逐文件哈希），均排除 `.flow/`；启动前比对，外部改码/untracked 内容变化/git 操作后轨迹已过期；非 git 仓库或指纹不可得视为不达标，与 contextPercent 未知同构）。fork/分支点永远是记忆的计划完成点，不是启动时的当前 leaf。任一不满足即回退现有冷启动，不通知、不重试；冷启动是完全正确的执行路径，prewalk 只是优化。
- 串行：`startSelectedGoalWithLock` 用 `ctx.fork(生成会话 leaf, { position: "at" })` 代替 `ctx.newSession()`；分支文件是 root→leaf 路径的自包含拷贝，恢复/归属/报告链路不变。启动 prompt 附加解禁句（生成期只读限制已解除）。
- 并行首批：`prepareParallelBatchStart` 经 `prewalk.ts` 的纯 fs 分支拷贝（与宿主 `createBranchedSession` 语义等价的子集：root→计划完成点、过滤 label、重链 parentId、header 记 parentSession；不用宿主包运行时 API——其动态 import 在 `-e` 加载形态下不可解析）为每个 lane 物理分支独立 worker 会话文件（落在同一 session dir）；已有 artifact/goal sessionFile（respawn）优先；资格不满足时整批回退冷启动，分支文件 IO/格式错误会清理本批已建文件并明确失败，不静默降级。fork lane 的 worker 执行 prompt 带同一解禁句。
- 证据锚点：每个 goal 创建时记录当时会话 leaf（`ActiveGoal.sessionAnchorId`，随 goal-state 持久化）；验收/质检/顾问的 Context Evidence 只取锚点之后的执行段，不吃计划期前缀（预算保护 + 干净上下文的评审更准）。非 fork 会话锚点在会话开头，切片无损。
- 串行第 2 步起不 fork（前序步骤已改代码，轨迹过期；交接物是 handoff）；不做链式 fork。

## Flow 并行执行

- 调度器是纯函数：pending Goal 依赖均 complete 后才 ready；未声明 `dependsOn` 默认依赖前一步，未声明或空 `writeScope` 保守串行；有 running Goal 或落盘 `parallelRun` 时不产生新批次。
- 同一批 ready Goal 只有在 canonical `writeScope` 两两不重叠时并行；validator 拒绝具体文件及其他 glob 语法，scheduler 对绕过校验的非法值一律视为重叠。重叠时按 index 取第一组不重叠子集，其余留到下一批。
- 多波次采用批次级 fan-in：同一批所有 worker 都结束并完成 fan-in 后，父 session 才重新运行调度器启动下一批；不做 worker 级流式下游调度。
- `final_acceptance` 是多步 Flow 的最终屏障：只有全部 `normal` step complete 后才 ready，且总是单独串行运行；它不参与 ready 批次的 `writeScope` 并行选择。
- 父 session 是唯一调度者和父级 `flow.json` 写入者；worker 不触发下一步，不判断 fan-in。
- worker 没有用户可调用的公开子命令。控制台通过私有 bootstrap 启动 worker：复用或创建默认 session dir 下的 worker session，传入 `PI_FLOW_WORKER_*` 环境变量和一次性控制 socket；worker 在 `session_start` 校验 job 与 token 后开始执行，运行中控制 socket 关闭即退出；完成写 `G<N>-worker.json` completion 字段后释放控制连接并正常退出，作为 IPC 生命线。
- 并行批次期间控制台 session 保留输入框，只显示 above-editor dashboard 和底部命令「/flow stop F<N>」暂停 · 「/flow go F<N>」继续；控制台不调用 Agent、不发送普通 user prompt。dashboard 每 lane 默认 5 行：最近活动在上，底部固定槽按「验收」「质检」顺序展示，未发生的检查槽隐藏并把空间让给最近活动；空间不足时压缩到 3 行，再不足时压缩到 1 行摘要。lane 完成只看 completion/flow 状态，不能因为验收通过就显示已完成。执行中的当前工具、参数、耗时、最近工具和 token/call 指标只读进程内结构化进度；completion/exit 与进程/JSON 解析错误作为终态或异常补充，stderr 只在失败时显示一行摘要。不再从原始事件生成工具或 assistant 文本摘要。board 每次活动生命周期只挂载一次 widget；每次 render 动态读取当前 TUI terminal rows，终端缩放时仍在 5/3/1 行布局间切换。progress 订阅只更新内存 snapshot，worker/exit 事件只重读对应 lane 后请求渲染。唯一的 1 秒 `unref` 时钟只刷新缓存中的耗时和 spinner，不读文件、不写 canonical、不重挂组件；dispose 同步退订、清时钟和 widget。
- `flow.html` 在并行批次期间监听批次内 step markdown、`G<N>-worker.json` 与 `G<N>-worker-events.json`，用 worker 内部状态渲染实时卡片；completion result 收集同时订阅同一批 `G<N>-worker.json`，但与报告刷新共用 Flow 目录多路复用 watcher，不另建 artifact watcher。事件文件同时是刷新自愈信号源（macOS FSEventStream 重建窗口可能丢单次文件事件）；批次结束后各 owner 幂等退订，最后一个注册释放底层 watcher。

## 子代理监控悬浮窗

- TUI 中创建并行、验收、质检或顾问进度 scope 后自动打开监控悬浮窗；同一时刻只显示一个，新的 scope 替换旧窗。`Alt+S` 打开最近创建的活跃 scope；没有活跃 scope 时只提示，不创建空窗。入口在 `bootstrap.ts` 内按需加载，不增加普通 Session 的静态依赖。
- Esc 只关闭当前聚焦的悬浮窗，不触发下层 Flow/Review 的取消处理；悬浮窗关闭后，下一次 Esc/Ctrl+C 才由下层活动框处理。Esc 仅静默当前 scope 的后续自动弹出，`Alt+S` 仍可手动重开；scope 关闭时清除该记忆，新 scope 仍会自动打开。
- Pi 只把 extension shortcut dispatcher 安装在默认编辑器；活动框替换为 `FlowActivityEditor` 后必须在输入隐藏与取消守卫之前显式处理同一个 `MONITOR_SHORTCUT`，否则验收/质检/顾问期间 Esc 关闭后无法重开。键匹配 API 经 `shared/tui.ts` 运行时桥获取，并由 `index.ts` 注入；lazy module 禁止静态 import optional host package。overlay 关闭回调同步清除活动 handle，禁止 Alt+S 命中已从宿主栈移除的旧窗口。
- `src/shared/agent-progress.ts` 的 scope、当前工具、最近工具、calls/token 与计时是进程内瞬态投影，不写入 `flow.json`、worker artifact 或检查 checkpoint；scope 关闭即丢弃，重启不恢复旧工具历史。`G<N>-worker-events.json` 仍承担并行报告刷新和异常取证，不是结构化进度事实源。

## 报告服务

- 同一 OS 用户的所有 Pi 进程共用一个 detached `dist/report-daemon.js`，默认监听 `127.0.0.1:49327`；禁止随机端口 fallback。Bun 脚本宿主直接复用 `process.execPath`；Node 宿主或编译版 Pi 先校验 Node.js 版本，低于 `22.19` 明确视为不合格候选并尝试 `PATH` 中的 Bun。编译版 Pi 的 `process.execPath` 是应用本身，只从 `PATH` 依次选择 Node.js `>=22.19`、兼容 Bun；除命令不存在与 Node 版本不足外，版本探测异常及合格 runtime 启动后的真实错误不得被 fallback 掩盖，两者都不可用时明确报错。进程级 `report-client` 只保持一条认证 control 连接和一个启动 single-flight；control 建立后 unref 底层 socket，交互宿主仍正常持有连接，one-shot 进程空闲时可自然退出并由 OS 断开 control，启动者退出不终止 daemon。daemon 的监听 server 保持进程存活，由唯一 idle timer 主动关闭；配置变更不热重载，存活 daemon 的 bind/port 与当前配置冲突时明确报错。
- runtime dir 固定为 `${PI_CODING_AGENT_DIR ?? ~/.pi/agent}/pi-flow-report/`（`0700`）；32-byte `access.key`、`startup.lock`、`endpoint.json`、`directory.json` 均为 `0600`。endpoint 只保存 protocol 2、PID、bind、port、startedAt；启动竞态通过原子 lock + 文件事件收口，不轮询。冷启动中 health 若先于 endpoint 可见，client 等待活跃 startup lock 的一次文件变化后重读 endpoint，不把正常 daemon 误判为无 discovery。daemon 在 ready 前失败时关闭 listener、清理本 PID 的 endpoint/temp，并在发送原始 IPC 错误后断开，禁止遗留固定端口进程。
- HTTP 面：无凭据的 `/health`、匿名目录 `GET /` 与目录 SSE `GET /events`、Bearer 认证的 control connect/register/changed，以及浏览器 `/r/<cap>/` 与对应相对 `events`。禁止浏览器控制 API、cwd/磁盘扫描与任意文件浏览。capability 是 `HMAC-SHA256(access.key, realpath)`；daemon 只服务已认证注册且仍为普通文件的 `<cwd>/.flow/F<N>/flow.html` 或 `<cwd>/.flow/reviews/<safe-basename>.html`，其他文件、symlink、未注册 HTML 与路径绕过一律 404。根路径与目录 SSE 只接受未归一化的精确 raw path，避免 `/r/%2e%2e/` 等探测命中目录页。
- 注册协议为严格 protocol 2：请求体精确固定为 `{cwd,path,state,generation}`，`state` 仅 `live|complete`，`generation` 为正安全整数；响应 capability 形状不变。旧 protocol 1 daemon/client 直接报不兼容，无 optional 字段、默认 state 或 fallback。Flow 的 `generation=flow.createdAt`，仅 `status==="complete"` 为 complete；独立质检 `generation=checkpoint.reportRun`，仅 `active===null && phase===null` 为 complete。
- `directory.json` 是 daemon 单写的有界导航投影（schema version 1），不是业务事实源：按真实路径/capability 唯一定位，统一 CAS——旧 generation 返回 409，同 generation 的 complete 不得降级为 live，更高 generation 可替换；先原子落盘再更新内存并广播目录 SSE，失败不得假成功。保留全部 Live 与最近 50 条 Recent。冷启动只按 ledger 精确记录重新校验，不扫描目录；缺失或不安全记录标 `available:false` 且无链接。
- daemon 分别跟踪 Pi control、目录 SSE 与浏览器 report SSE；任一集合非空即存活，全部为空才启动唯一 15 分钟 idle timer，新连接立即取消。daemon 同时登记全部 TCP socket，shutdown 先停止 accept 再销毁连接全集，因此未认证半开请求和普通 keep-alive 不能阻塞 idle/显式退出；并发 close 共用同一完成 Promise。client 断线且已有 registry 时只立即重连/重注册一次；失败后等待下一次真实 register/open，不形成 crash loop。同 path 的 register 按调用顺序串行，缓存键含 generation/state；`notifyReportChanged(path)` 只通知本进程已精确注册的 path，未注册写盘不启动服务。
- `report.bind` 接受 `localhost` 或 IP，`report.port` 固定配置，`report.publicBaseUrl` 只改展示 URL。wildcard bind 的本机 control 走 loopback；非 loopback 每个 Pi 进程只警告一次。推荐保留 localhost 并由 Tailscale Serve 代理；`0.0.0.0`/`::` 会同时暴露给 LAN，不代表只开放 tailnet。远程 bind 时匿名目录页会暴露完整 cwd，这是已接受的产品取舍。
- 报告注册/打开分两类边界：显式 `/flow status` 与 complete 查看等待 URL，失败必须带原始原因明确提示；生成收口、执行启动/完成、检查同步、独立质检投影和 session 恢复只发起进程级后台 side effect，不 await、不阻断 canonical、prompt、reviewer、autoStart、结果卡、终态通知或下一步调度。同一进程连续遇到同一服务错误只提示一次，任一次成功后才允许再次提示；测试关闭 client 时等待全部后台 side effect 收口。

## 报告刷新

- `flow.json`、worker artifact、completion/handoff 与检查 checkpoint 仍由各自事务同步原子提交；生成、启动、停止、fan-in、检查提交、会话名同步和最终完成随后同步尝试 HTML 最终投影。canonical 一旦提交，普通报告或校验错误页的渲染/写盘失败只通知一次「报告刷新失败」并返回无路径，不回滚状态、不发结果卡、不重试，也不中断 prompt、worker、后续 Flow 同步、完成事实消费、结果卡或下一步调度。只有 canonical 写失败才使原事务失败。
- plan/schema 校验结果独立决定是否进入既有修复路径；对应错误页投影失败仍继续确认、发送 repair prompt 或报告修复耗尽。单独发生的 HTML 投影错误不触发模型修复，执行模型无法修复宿主文件权限或 renderer。`writeFlowHtml()` 与 `writeFlowErrorHtml()` 保留 throwing 语义供 renderer 测试，显式 `/flow status`、complete Flow 查看报告也使用 throwing renderer；这些入口由调用方捕获并明确提示报告打开失败，不修改 canonical。
- step markdown、worker artifact/events 文件触发的派生刷新经过 watcher frame，最多延迟 25ms；watcher 使用结构化 no-throw 写入结果，timer callback 不产生未处理异常。HTML 内容未变化时继续不写盘、不发 SSE reload。
- 每个 Flow dir 独占一个报告 watcher 条目，内含逻辑 owner、dirty、关闭标记和至多一个 `unref` pending frame；进程级目录注册表让同一 Flow 的报告刷新与 completion result 收集在共同父目录上只创建一个 OS `FSWatcher`，内部按 basename 分发 callback，并以独立 unsubscribe 保留 owner 生命周期。文件事件只标 dirty，frame 后若期间又变 dirty 才安排下一帧。首次注册额外安排一帧，用于覆盖 macOS/Linux 目录 watcher 订阅建立窗口，之后不再自发调度。不同 Flow dir 不合并，不存在 interval、轮询或 cwd 级门闩。
- 被观察文件始终通过共享父目录 watcher + 精确 basename 过滤，不切换为 `watch(file)`；因此 step Markdown 的编辑器原子保存，以及 worker artifact/events 的 temp+rename 连续替换都持续跟踪新 inode。文件删除同样触发刷新，让报告回到 canonical fallback。
- 串行 frame 执行时重读最新 `flow.json`，仅在 Flow 仍 running、无并行 run、current Goal 的 index/file/status 与 watcher 目标一致时渲染。并行 frame 只保存预期 `parallelRun.id`，执行时重读 canonical Flow，并只投影同一 run id 的 worker artifact；Flow 已 paused/complete、run id 已更换或 watcher 已关闭时丢弃刷新。
- `closeFlowGoalWatcher(dir)` 同步关闭该 Flow 的目录 watcher、取消 pending frame 并清 dirty；无参关闭逐个执行。stop、BLOCKED 收口、fan-in 和 complete 的命令路径先关闭或在同一同步调用栈内关闭 watcher，因此迟到事件不能覆盖终态 HTML。

## 计划 Markdown Todo

计划 Markdown 是执行 Todo、工作记忆、checkbox 进度和 HTML 实时任务清单来源；进度状态变化必须写回当前 Markdown 文件。

```text
[ ] 待做
[~] 进行中
[!] 阻塞
[x] 完成
```

- `Objective` / `Scope` / `Success Criteria` 是启动合同区，禁止 checkbox；`Success Criteria` 使用普通 bullet 表达验收标准。
- `Steps` 和 `Verification` 必须是 checkbox 列表；`Steps` 是用户可理解的里程碑，不是高频流水账。
- 启动首轮：如果隐藏启动消息包含标为初始计划状态的完整 snapshot，首个 item 可使用该 snapshot 作为初始读取，第一次进度更新前不要为复述同一状态重复读取文件。
- 「/flow go」、resume、自动 continuation 或没有 snapshot 的入口：开始工作前必须读取当前计划 Markdown，不得依赖旧 snapshot。
- 开始一项前改为 `[~]`；完成真实工作并有证据后改为 `[x]`；阻塞时改为 `[!]`；勾选用针对该项的单行精确编辑，不重写整个文件，不要求每次勾选后重读计划文件。
- 拖延勾选自动提醒：回合内有 write/edit 工具调用但当前计划 Markdown 无 checkbox 状态变化时，下一条自动延续隐藏 prompt 头部注入一行更新提醒（`src/goal/check-discipline.ts`）。
- 阻塞原因、已尝试动作、跳过原因、恢复路径写入 `Outcome` / `Handoff`。
- 禁止最后集中补 checkbox。
- 完成证据写入 `Verification` / `Outcome` / `Handoff`；不得把 `Success Criteria` 勾成完成。
- 执行中不得修改 `Objective` / `Scope` / `Success Criteria`。

## 角色模型

- `modelRoles.advisor` 兼任两职：`/flow` 对齐、生成、repair 入口的会话模型，以及检查停滞时的顾问咨询模型；`modelRoles.executor` 用于 Flow 新步骤启动入口。配置对象只接受当前文档列出的字段，未知字段直接报错。
- advisor / executor 只能是 `"current"` 或 `{ model, thinking }`；reviewers 每项也只接受 `{ model, thinking }`。模型名必须是精确 `provider/model-id`，`thinking` 必填。`background` 只配置后台 Pi 的 `command/extensions`；`checks` 是验收、质检和失败顾问共用的唯一能力源（`tools/timeoutMinutes/openaiFast`）。咨询子进程需要显式模型：advisor 为 `"current"` 时只回落第一个 reviewer 的模型与 thinking，不改变共享检查能力。Reviewer / 顾问命令按独立进程组启动，超时或取消会终止整棵进程树，命令包装器产生的孙进程不得继续占用管道或拖住 session/test 退出。
- 顶层 `advisor.enabled`（缺省 true）是失败咨询总开关，管 Flow 验收/质检、独立 `/review` 与手动 `/advisor`；关闭后其余停滞纪律（修订许可、硬停）不变，计划生成不受影响。
- 插件只在阶段入口用公开 API `pi.setModel()` / `pi.setThinkingLevel()` 切一次；不恢复、不持久化原模型，不在后续 prompt 抢回。
- 配置模型不可用或未登录时阻塞并提示，不 fallback。
- `modelRoles.reviewers` 是验收和质检子进程模型，也是 reviewer 模型选择的唯一入口；检查模型快照携带 `thinking` 供展示面统一渲染「模型 + 强度」。`checks.openaiFast=true` 给检查与顾问子进程传布尔 `--pi-flow-openai-fast`；只有 child extension 注册该 flag，并在真实请求时同时核对 provider、Responses API、模型白名单、payload 模型与 `input` 形状，全部匹配才注入付费 `service_tier: priority`。其他 provider、API、模型或 payload 原样走普通模式，不提示；真实请求错误仍照常上抛。默认 false；不保留 `checks.fast` alias 或旧 CLI 通道。

## Prompt 与状态文案

- 插件生成的编排 prompt 默认隐藏投递：`sendOrchestrationPrompt()` 同步发起 `triggerTurn` 并返回，不保留 async 包装；同步调用抛错才算提示投递失败。generation 的初始、恢复、澄清/确认与 repair prompt 都先在锁外完成模型切换，再进入短 Flow 锁事务重读 revision/session/status 并核对当前进程的 prompt token；只有 CAS 仍有效才先递增 alignment revision 作为 durable prompt claim，再同步投递。stop/takeover 先提交则不发送旧 prompt；同进程同 revision 的重复投递由 token 单赢家，独立进程同 revision 的竞争由 revision claim 单赢家；投递先获锁则后续 stop 通过 revision/status 使其 callback 失效。replacement session 的 `sendMessage()` Promise 表示完整 agent turn，只订阅 rejection 并报告「执行回合失败」，禁止 await 后把调用方事务、Flow 锁或命令生命周期跨越模型执行；后续推进与中断恢复只由 `agent_end` 等领域事件及 canonical checkpoint 驱动。
- 用户输入和澄清补充必须可见：`appendVisibleUserInput()`。
- 每个隐藏 prompt 必须有可见锚点：状态卡、活动卡或结果卡。
- `/flow` 对齐入口只发一张「开始对齐 Flow」结果卡（含 `编号：F<N>` 与范围确认说明）并显示活动框，不再另发开始对齐通知；direct 入口只发「Flow F<N> 计划生成中 / 完成后自动启动」通知。
- 对齐提问活动框显示「准备问题中」；生成活动框状态词为「生成中」，0 轮对齐时显示「洞察全部上下文，生成全面计划」，1 轮及以上显示「基于 N 轮问答生成全面计划」；对应状态摘要结尾不加句号。
- 对齐入口选项为四项：直接生成 / 粗对齐（约 10 问内）/ 标准对齐（约 20-30 问）/ 深度对齐（不设硬上限）；档位写入 `alignment.json.depth`，首次对齐只向 `grilling.md` 注入预算数字，follow-up 仅发送同档预算与「遵循首次协议」的精简触发提示。
- 对齐等待回复状态栏显示问答进度（粗/标准档「Q<n> / ~预算」，深度档只显示「Q<n>」）与「按推荐」委托剩余决策提示；「按推荐」由拷问协议约定，插件不解析该关键词。
- 活动态固定框（执行中、验收中、质检中、优化中、顾问介入中、生成中、修复中）在终端宽度 ≥60 列时显示火焰品牌动画：「内容（左对齐）+ 间隔 + 全高火焰」作为紧凑组合整体居中；间隔理想 16 列，空间不足时压缩到最小 8 列，两侧边距各 ≥6 列；框级活动只用火焰，不叠加 spinner。验收、质检、顾问的每模型 spinner 只在对应子进程收到首个结构化事件后出现，注册占位期间不渲染静态「思考中 · 0 calls」；宽度 <60 列回退为无火焰居中布局。等待用户回复/确认、等待你接管、已暂停、预算受限框不显示火焰。
- 并行 lane dashboard 不显示火焰；running lane 的最近活动首行显示小 spinner，复用 dashboard elapsed 刷新，不新增每 lane 计时器。
- Flow 步骤启动卡标题使用用户可见步骤名：单步只显示目标标题，不显示「第 1 步」；卡片行顺序为编号、目标，多步再显示进度/后续，executor 配置非 `current` 时追加模型行。
- Flow 执行中、已暂停、验收中、优化中活动框只显示 Flow/步骤标签和必要进度，不注入 Objective 全文；单步 Flow 不显示 `1/1` 进度。BLOCKED 接管时暂停框改为「等待你接管」，显示一行待办与「/flow go」恢复命令。验收/质检启动卡的目标行会压缩空白并裁剪到 120 字。
- 独立 `/review` 检查活动框标题为「💯 质检中」或修复轮次，不显示「会话」、对象或证据行；round-0 武装期显示带火焰的「💯 执行中」与「完成后自动质检」，并在右下角持续计时，进入第 1 轮后自然切换现有质检框。重启后的武装等待显示无火焰「自动质检 · 已中断」与取消提示，输入保持可见。Goal scope 仍显示对应 Flow/目标上下文。
- 验收/质检的启动卡、状态栏、活动框和 activity signal 只能在完整配置校验通过且本轮 active checkpoint 已持久化后发布；checkpoint deferred/写入失败表示检查从未启动，不得留下任何检查中 UI。配置错误同样不得先显示检查中状态或「模型：配置读取失败」；Goal scope 只发一张对应的「验收无法启动」/「质检无法启动」结果卡，并将 session Goal 与 canonical `flow.json` 同步暂停，保留 `acceptance_retry`/`quality_retry` 供修正配置后「/flow go」直接重试对应检查。
- Goal 与质检活动框是互斥 surface：执行/暂停/预算受限只保留 `goal-progress`，优化/质检只保留 `review-progress`；任何终态切换必须先清除另一 surface，禁止同时显示活动态与暂停态。
- 终止事件只有状态 owner 可以输出：独立 `/review` 由 review runtime 输出，Goal scope 由 Goal runtime 输出，禁止两层同时发结果卡或通知。用户按 Esc/Ctrl+C 主动取消只发一条 `⏸` 通知，不生成结果卡、不注入模型上下文、不新增 `error` 检查轮次；round-0 武装期（含重启后的输入可见等待态）同样立即清 checkpoint 与活动 UI，当前执行可继续但结束后不启动质检。Goal scope 在同一 canonical owner 事务中清除当前 active check、保留对应 `_retry` cursor 并暂停 Flow，事务成功后才暂停 session Goal 和发布通知；若 session entry 未落盘，重启按 canonical artifact 将旧 `active` Goal 校正为 `paused`，禁止偷偷续跑。验收取消后保留暂停活动框。shutdown/`/flow stop` 属于被动中断，保留 active checkpoint。系统错误只发一张「验收/质检未完成」结果卡；Flow 暂停、自动重试耗尽与下一步已就绪均由对应结果卡承载，不再追加同义通知。连续检查达到硬上限时，最后一轮质检反馈与 Flow 暂停/恢复命令合并为一张卡。
- 外部终端提醒使用进程内 activity / attention 两种语义：activity 只控制忙碌状态，独立 `/review` 的 activity 从 round-0 武装执行开始覆盖「执行→审查→自动修复→再审」整个 ReviewLoop，轮间不得清空；重启后等待用户继续的武装态不发 activity。attention 只在确实等待用户的 `needs_user`、对齐提问/最终确认、计划生成阻塞提问、不可恢复错误、受控暂停、硬上限、预算受限或缺少自动推进上下文时发出。进入对齐/生成等待态必须先清除对应 activity，再发 attention；用户回复或 `/flow go` 后恢复 activity。PASS 后的最终回复由普通 `agent_end` 提醒；自动修复、自动续审、自动推进、用户主动取消和仍计划自动恢复的首次重试耗尽不发 attention。
- `/flow stop` 是串行 Flow 停止事务的唯一 owner：持有 Flow 锁时，按 Goal id 等待正在运行或等待修复的 goal-scoped 质检完整收口，再写入 Flow 暂停态；跨 session 停止同时终止目标 session 的当前执行轮。该过程不额外发送质检取消提示，`/flow stop` 自身是唯一停止通知。取消标记优先于迟到的质检结果，已暂停 Goal 的质检通过回调与最终完成写入都会被丢弃，不能写 completion fact、发终局卡或把 Flow 推进为完成。
- 普通对齐中间轮 prompt 只是触发下一回合的精简信封：携带同档预算并要求遵循首次拷问协议，不重复完整协议、原始需求、Q&A、用户刚才回答、摘要或 `<aligned-request>`；普通生成 prompt 只指向当前 `.flow/F<N>/`，不要求模型创建 F 目录，也不注入 Q&A；只有跨会话恢复到生成计划时才可注入结构化 Q&A。
- 每次隐藏生成 / 对齐 / follow-up / repair prompt 都带 `<!-- pi-flow:prompt:<token> -->` marker，并按 session 记录 live target；同一 session 有 live target 时禁止覆盖式发送新生成 prompt。AI 回显的 prompt marker 会在 `message_end` 被移除后再展示/落盘，同时记录 token 供 `agent_end` 归属匹配。完成、暂停或跨 session 接管会把旧 target 降为 stale tombstone，用于吞掉 late `agent_end`，但 stale 不阻塞后续 prompt。
- 运行与检查的用户可见主状态词只用：`启动中`、`执行中`、`验收中`、`补完中`、`质检中`、`优化中`、`顾问介入中`、`生成中`、`等待收口`、`等待你接管`、`已完成`、`已暂停`、`已中断`；生成前对齐沿用本节专用文案；检查名只用「验收」「质检」。
- 实时卡片和 status 隐藏第一轮；第二轮起显示 `第 N 轮...`。HTML 多轮历史从 `第 1 轮...` 开始展示。
- Flow 前缀格式：`🌊 flow/第 N 步 · 标题/...`。
- 运行时连接、重试、暂停、取消通知统一为 `emoji + 标题 + 空行 + 正文`；英文词与中文之间留空格，末尾不加句号；用 emoji/title 表达严重性，避免原生 `Warning:` 前缀打破格式。
- 可恢复连接中断不推进业务状态、不新增检查轮次、不改变用户可见轮次。
- Goal 完成链里的质检不能和独立 `/review` 同时写右下角状态计时。
- Flow 完成链不发送「已完成」通知：单步 Flow 完成只显示质检轮次卡（启用时）和一张终局卡，终局卡标题带步骤标题，行内包含编号、目标、验收/质检轮次历史和唯一「总用时」；单步质检轮次卡不显示「/ 总」时长。多步 Flow 保留每步步骤完成卡，最后再显示一张摘要终局卡（Flow、已完成步数、总用时），终局卡继续 `triggerTurn` 并注入最终回复指令。

## 检查停滞自愈

- 同一步骤连续未通过的检查轮次（验收与质检合并计数）记在运行态 `consecutiveCheckFailures`（session custom entry，不进 `flow.json`）；验收通过清零，系统错误与可恢复中断不计数。独立 `/review` 的计数从循环 history 尾部连续失败推导（`trailingFailures`，checkpoint 带 history，重启不失忆）。
- 连续 2 轮未通过后，Flow 失败反馈 prompt 注入修订许可条款（与顾问首咨同轮解锁，顾问建议修订时执行模型立即有权执行）：先穷举替代方案，确认 Success Criteria 内在矛盾或不可满足才可修订，理由写入 Notes；首轮不注入。独立 `/review` 无计划可修订，不注入修订许可。
- 连续 2/4/6/8 轮未通过（未达硬上限，且 `advisor.enabled` 未关）时，插件自动以 `--no-session` spawn 顾问模型（`modelRoles.advisor`，`current` 时回落第一个 reviewer）；顾问与 Reviewer 原样共用 `checks.tools`，默认含 read/grep/find/ls/bash，write/edit 始终由插件排除。顾问可读取代码、运行现有测试和只读诊断，并可在系统临时目录执行一次性验证；协议禁止修改项目代码、配置、测试、计划或运行态，禁止安装依赖、更新快照、破坏性 Git 和通过 bash 绕过禁用工具。输入含目标与计划、全部轮次的完整失败发现、计划修订 diff 与 Context Evidence；失败历史不做逐轮截断，完整计入 fixed prompt 预算，真正超窗时按 `fixed_prompt_overflow` 明确退出；Flow 验收/质检与独立 `/review` 均适用（独立质检的目标段为质检范围文案）。失败卡先于咨询写入 session，卡尾显示「🧭 连续 N 轮未通过 · 正在咨询顾问」，但不触发修复回合；随后才挂「🧭 顾问介入中」活动框（验收→goal 框、质检→review 框，含步骤标签、顾问模型·强度、连续轮次，遵循活动框火焰规则）+ 输入锁 + 状态行计时。咨询完成后，建议正文不截断，以和手动 `/advisor` 相同的独立「顾问建议」卡展示；卡片 entry data 保存完整 `{model, thinking, advice}`，其模型内容按「检查发现 → 建议 → 处理纪律 → 可选修订许可」触发修复回合，建议再结构化落入 `rounds[].advisor`，HTML 数据源不变。Esc/Ctrl+C 只跳过本次咨询，不取消检查；顾问不可用时低调 notify；两者都直接发送不含建议的隐藏修复 prompt。咨询中崩溃保留已发失败卡；建议卡已发但 history 未提交时，重启从 `repair` receipt 恢复建议，不重复 spawn 或投递。自动触发完全由插件失败计数决定；`/advisor` 绕过 2/4/6/8 节奏，但不绕过开关与“存在未解决失败”的前置条件。
- 手动建议与最近失败轮在同一 Flow 锁事务中落盘，并写 `pendingAdvisor` 引用；咨询卡只展示、不自动继续。下一次 `/flow go` 或运行态延续把建议作为“待核实假设”送给执行模型，发送成功后清空引用；进程在发送前重启不会丢。可见咨询卡标记为 check-result，隐藏投递使用专用 `pi-flow-advisor-direction` 消息类型；Context Evidence 提取器排除两者，验收/质检协议另明确禁止把运行态中可能看到的顾问建议当作 PASS/FAIL 证据，保证顾问只影响修复者、不影响裁判。Esc 时不写轮记录或 outbox。
- 跨轮收敛：第 2 轮起检查 prompt 注入当前轮次与往轮发现清单（验收取 `checks.acceptance.rounds`，质检取循环 history；长度预算 12k 字符，超出从最新往旧保留）；判定规则（`prompts/*/goal-audit.md`、`prompts/*/review.md`）要求：优先复核往轮未闭环项与上轮修复引入的回归（已修复项需复核证据）；有充分证据的当前高/中严重度仍须 FAIL；与往轮重复、无证据、超范围的发现不得驱动 FAIL（写入建议区由顾问仲裁）；已被驳回且驳回依据成立的发现不得原样重提，重提须先引用并反驳驳回依据；同一缺陷模式须指出模式并列举全部可见实例、要求全量排查一次修复，禁止每轮只报一个实例；硬停时禁止降标结束循环。质检检查范围额外覆盖无关改动、过度工程（低，进建议区）与依赖纪律。
- 修订仲裁基线是 `flow.json` 持久化的 `goals[].snapshot`（步骤首次启动时的计划全文，串行取归属 Flow 当前步骤，并行 worker 从自身 artifact 所在 Flow 目录只读对应步骤），跨进程、跨重启不可漂白；验收/质检/顾问启动时检测相对基线的修订，有修订则把变更内容与「先判定修订是否合理，降标逃避按原标准 FAIL」注入检查 prompt。计划内容变更不机械断流：恢复前置校验只拦缺快照 / 步骤文件被删两种不可恢复事实。修订口径：增行、删行、改行、跨区块移动算修订；checkbox 进度变化与同区块内重排不算（重排不改变承诺内容，报出只会制造仲裁噪声）。
- 连续 10 轮未通过时强制置 `paused` 并输出受控停止文案（含轮次与「/flow go F<N>」提示）+ `attention: check_hard_cap`，防止无限循环；独立 `/review` 同阈值硬停，发「质检已自动暂停」通知并清循环。
- 阈值是常量（`src/goal/check-discipline.ts`），不提供配置面。

## BLOCKED 接管协议

- 失败反馈指令（`src/shared/check-feedback.ts#checkFeedbackDiscipline`）含三条公共纪律：同模式实例穷举后一次性修复；技术方案/架构/工具选型自主决策并留档，不向用户征求批准；仅当发现只能由用户亲手完成（真机人工操作、系统权限开关、外部账号）时，回复末尾单独一行输出 `BLOCKED: <需要用户做的事>` 后停止；不适用于方案批准、偏好确认或风险告知。步骤 system prompt 同样声明该协议（权威版）。
- Flow 侧：`agent_end(stop)` 检测到 BLOCKED 行时不送检查。串行步骤在同一次 canonical 写入中提交 `paused` + `attention: user_action_required`；Flow 锁忙时把 `{goalId, reason}` 写入 session durable outbox，活动框立即显示「等待你接管」且不再展示执行态，通过进程内释放信号 + 一次性 `.flow.lock` watcher 重试，`session_start` 兜底恢复，提交成功后清 outbox。并行 worker 则在一次 artifact 写入中提交 `status: paused` + `handoff` 后正常退出；父控制台识别 handoff 后终止其余 lane，并在一次 Flow 锁事务中提交父级暂停状态与 attention；控制台崩溃时，「/flow go」也会先从 durable handoff 完成该收口，不会把它当普通 worker 失败。HTML 报告只是 canonical 提交后的投影，刷新失败只通知、不回滚暂停。不发结果卡或模型消息；活动框显示「等待你接管」；再次「/flow go」清空 attention 和已消费 handoff，保留原检查 cursor 后恢复。BLOCKED 不是免检金牌（理由随原始用户/assistant 事件进入 Context Evidence，检查方可见）。
- 独立 `/review`：修复回合声明 BLOCKED 时停循环（stop kind `user_action`），发「需要你操作」通知（含待办 + 「完成后重新运行 /review」）。
- 空问回复（无写入、无 BLOCKED、纯提问）照常送检查，由「停在分析不算完成」判定打回——现状即惩罚，不另加机制。

主要入口：`src/shared/progress-labels.ts`、`src/goal/runtime.ts`、`src/goal/review-orchestration.ts`、`src/review/view.ts`、`src/shared/internal-prompt.ts`。全部 prompt 面（协议文件 + 运行时注入点）索引见 `docs/prompts.md`。

- 步骤 system prompt 含编排来源声明：自动延续与检查反馈由编排系统注入、非用户发言、默认无人回答提问，附 BLOCKED 协议；不向模型暴露插件名。声明分层：system prompt 是唯一权媁完整版，恢复 prompt（`buildResumePrompt`）开头注入一句入口纠偏（`orchestrationContextLine`：用户已离场、仍是自动化流程），失败反馈指令带 recency 补强（自主决策 + BLOCKED）；其余注入面不重复声明。
- 自动延续 prompt 不重复目标文本（system prompt 每回合已注入）。
- 验收 = 范围完整性 gate，质检 = 实现质量 gate；goal scope 质检不重复逐项验证需求覆盖，但验收结论不可作为质检通过证据。两侧 PASS 均须带证据锚点（实际读取的文件 + 实际运行的命令）；质检 FAIL 仅由高/中严重度驱动，低严重度建议随 PASS/FAIL 的「## 建议（非阻塞）」区落盘展示，不触发修复循环；Flow 完成时各步建议区聚合为 HTML 完成卡「遗留建议」（去重、按步分组），终端完成卡带「💡 N 条非阻塞建议 · 见报告」一行，零建议不渲染。
- PASS 输出的机器强制边界（`src/shared/review-verdict.ts#passOutputIssue`）：摘要行必须在证据行前；证据行固定格式 `证据：文件=…；命令=…`，以首个证据行为唯一判定行（该行必须同时含两段，拆行拼装无法通过），文件段含至少一个带扩展名路径、命令段非空；违反者按格式无效拒绝（多模型下忽略该模型，全部违反受控停止）；段内容真实性机器无法验证，由检查协议约束。
- 检查反馈处理指令单一事实源：`src/shared/check-feedback.ts`。
