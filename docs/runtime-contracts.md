# 运行契约

只记录当前实现。不要写计划、历史留档、backlog。改行为时同步更新本文档和 smoke。

## 状态

- `flow.json` 是唯一规范状态源，当前 `schemaVersion: 9`；canonical 目录只允许 `.flow/F<N>/`，`flow.id` 必须是裸 `F<N>`。
- 旧 `.flow/F<N>-slug/` 不再是合法 Flow，扫描、定位和校验都不会把它当作规范运行目录。
- 进入 `/flow` 生成或对齐流程时，插件先分配 `.flow/F<N>/` 并写入可恢复的 pre-draft `flow.json` 与同目录 `alignment.json`；模型只写该目录内的 `flow.semantic.json` 和计划 Markdown，builder 组装规范状态。
- 顶层状态只允许 `aligning` / `generating` / `draft` / `paused` / `running` / `complete`；旧取消态非法，不迁移。pre-draft 必须是 `goals: []`、`currentGoal: 0`、`startedAt: null`、`parallelRun: null`，可处于 `aligning` / `generating` / `paused`。
- `paused` 是唯一停止态：不写 `pausedFrom`、`stopped` 或第二套生命周期字段。pre-draft 暂停从 `goals: [] + alignment.json` 恢复；未启动计划暂停为 `startedAt: null`；已执行暂停为 `startedAt` 时间戳，并从当前 running Goal 的 `sessionFile` 恢复。
- `alignment.json` 只用于生成前子阶段，字段为 `version/stage/sessionFile/autoStart/alignmentTurns/lastAlignmentQuestion/createdAt/updatedAt`；Q&A 只写这里，禁止进入 `flow.json`。生成成功后删除 `alignment.json`；发送失败或校验失败保留 `generating + errors` 和 `alignment.json`，供后续恢复入口继续；用户暂停 pre-draft 时写 `flow.status = "paused"` 并保留 `alignment.json` 作为恢复事实记录。
- 生成完成后的 auto-start 只使用创建或 `/flow go F<N>` 时记录、且支持 `newSession` 的 command context；重启后或只有 `agent_end` 事件 context 时保持 `draft`，提示用户运行 `/flow go F<N>`，禁止回退到旧事件 session 启动。
- `flow.semantic.json` 的 `goals[]` 可声明 `dependsOn`（先序 0-based index；缺省等同依赖前一步，`[]` 表示无前置）和 `writeScope`（模块/目录 glob；缺省视为未知写入范围）。
- Flow 最多 10 个 `normal` 执行步骤；单步 Flow 只含 1 个 `normal` 且不写 `final_acceptance`；多步 Flow 最后必须且只能有 1 个 `final_acceptance`，最终验收不占 10 个执行步骤名额。
- `flow.json.parallelRun` 是落盘并行运行门闩：`null` 表示无活动并行运行；非空时必须为 `{ id, goalIndexes, startedAt }`，表示这些 Goal 已进入同一个并行运行。
- 并行开始时父 session 先写 `flow.json`：批次内 Goal 置为 `running`，记录 `sessionFile` / `sessionName` / `snapshot` / `snapshotHash`，`currentGoal` 指向批次最小下标，`parallelRun` 写入当前运行；该字段保留到 fan-in、恢复或暂停收口。
- 并行 worker 只在 `workers/G<index>/` 写内部 `session.jsonl`、`plan.md`、`state.json` 和完成信号 `result.json`；`result.json` 必须带匹配的 `parallelRunId` 才会被父 session 接收。worker 不写父级 `flow.json`、不触发调度。
- 父 session 收齐 worker 退出后 fan-in 写 `flow.json`：成功 worker 标记 complete，失败、退出非 0 或缺 `result.json` 的 worker 回 pending。失败收口保持 Flow running，`currentGoal` 指向首个失败 Goal，`errors` 写失败 worker 的 step label、exit code / signal、是否缺 `result.json`；不自动重试，用户运行 `/flow go` 后只调度仍 pending 的失败 Goal，已成功的同批 Goal 不重跑。`/flow stop` 会 abort 活动 batch，清空 `parallelRun`，稳定接收已完成 worker 的 `result.json`，未完成 worker 回 pending；若收口后仍有未完成步骤则标记 paused，若所有步骤已完成则标记 complete。
- 崩溃或父 session 丢失后，`/flow go` 发现持久化 `parallelRun` 时进入恢复：加锁读取匹配 `parallelRunId` 的 `result.json` 完成已成功 Goal，缺结果的 Goal 重置为 pending，清空 `parallelRun` 后重新交给调度器。
- 模型不写 `parallelRun`、`checks`、`completionCursor`、`flow.html`。
- `checks.acceptance` = 完成验收；`checks.quality` = 质量检查；两者结构都是 `enabled / rounds / active`。
- `completionCursor` 只用于内部恢复路由，用户界面不展示。
- Flow 总用时只读 `startedAt`：pre-draft 和草稿为 `null`，运行态必须是时间戳；不能用 `createdAt` 兜底。

## 命令入口

- 用户主入口只有 `/flow [需求|path.md]`、`/flow go [F<N>]`、`/flow stop [F<N>]`；`/flow status [F<N>]` 仅作为隐藏诊断入口保留，不放进主流程文案。
- `/flow go` 推进或恢复已有 Flow：pre-draft 继续对齐/生成，draft 或未启动 paused 启动执行，已执行 paused 恢复当前步骤，running 做幂等收口/恢复，complete 只打开报告并提示已完成。
- `/flow stop` 对未完成 Flow 写入唯一停止态 `paused`，保留 `flow.json`、`alignment.json` 和步骤快照；后续只能通过 `/flow go` 恢复。若并行 stop 收口后所有步骤已完成，则直接写 `complete`。
- 控制命令只接受空参数或单个裸 Flow id。其他 `/flow ...` 文本按新需求处理，不作为 Flow 控制别名。

## 同 cwd 多个可推进 Flow

- 同一 cwd 下可同时存在多个可推进 Flow：`status` 为 `aligning`、`generating`、`draft`、`paused` 或 `running`；每个 `.flow/F<N>/flow.json` 仍是各自唯一状态源。
- 用户命令先按显式裸 id 定位；无 id 时按当前 session 所属可推进 Flow，其次 cwd 下唯一可推进 Flow；多个候选且无归属时必须提示用户指定 id，不得默认选第一个。
- pre-draft 归属看 `alignment.json.sessionFile`；running 或已执行 paused 归属看当前 running Goal 的 `sessionFile`。`/flow go F<N>` 可跨 session 接管 pre-draft：`aligning/generating/paused` 会恢复到 alignment 对应阶段，提示中阶段重发隐藏 prompt，等待输入阶段只恢复活动卡和直接回复目标；接管成功后旧 session 的 late reply / `agent_end` 被忽略。
- 当前 session 直接输入非命令文本时，若有显式 `/flow go F<N>` 记住的 pre-draft 回复目标，优先继续该 Flow，直到完成、暂停、失效或被其他 session 接管；无记忆目标时，只有当前 session 归属的 `aligning/generating` Flow 恰好一个，才继续对齐或回答 need-input；多义时不猜测。
- pre-draft `/flow status` 只输出文本状态、当前问题/下一步和错误，不生成或打开 `flow.html`；draft/running/complete 沿用 HTML 报告逻辑。
- Goal runtime、完成事实、检查进度同步都按 `sessionFile` 找所属 Flow；`completion fact` 只写回该 session 所属的 `flow.json`。
- 写锁、`parallelRun` 活动批次和 `flow.html` live watcher 都以 Flow dir 为作用域；禁止回到 cwd 级单例。

## Flow 并行执行

- 调度器是纯函数：pending Goal 依赖均 complete 后才 ready；未声明 `dependsOn` 默认依赖前一步，未声明或空 `writeScope` 保守串行；有 running Goal 或落盘 `parallelRun` 时不产生新批次。
- 同一批 ready Goal 只有在 `writeScope` 两两不重叠时并行；重叠时按 index 取第一组不重叠子集，其余留到下一批。
- 多波次采用批次级 fan-in：同一批所有 worker 都结束并完成 fan-in 后，父 session 才重新运行调度器启动下一批；不做 worker 级流式下游调度。
- `final_acceptance` 是多步 Flow 的最终屏障：只有全部 `normal` step complete 后才 ready，且总是单独串行运行；它不参与 ready 批次的 `writeScope` 并行选择。
- 父 session 是唯一调度者和父级 `flow.json` 写入者；worker 不触发下一步，不判断 fan-in。
- worker 没有用户可调用的公开子命令。父 session 通过私有 bootstrap 启动 worker：创建 `workers/G<index>/session.jsonl`，传入 `PI_FLOW_WORKER_*` 环境变量和一次性控制 socket；worker 在 `session_start` 校验 job 与 token 后开始执行，运行中控制 socket 关闭即退出；完成写 `result.json` 后释放控制连接并正常退出，作为 IPC 生命线。
- 并行批次期间主 session 显示 lane 看板并隐藏默认输入；lane 状态来自 worker JSON event 与 worker `state.json` 的 `checks.active` / `rounds`。
- `flow.html` 在并行批次期间监听批次内 step markdown、worker `plan.md` 与 worker `state.json`，用 worker 内部状态渲染实时卡片；批次结束后关闭 watcher。

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
- `/flow go`、resume、自动 continuation 或没有 snapshot 的入口：开始工作前必须读取当前计划 Markdown，不得依赖旧 snapshot。
- 开始一项前改为 `[~]`；完成真实工作并有证据后改为 `[x]`；阻塞时改为 `[!]`；每次 checkbox 更新后、切换下一项前必须重新读取或检查当前 Markdown。
- 阻塞原因、已尝试动作、跳过原因、恢复路径写入 `Outcome` / `Handoff`。
- 禁止最后集中补 checkbox。
- 完成证据写入 `Verification` / `Outcome` / `Handoff`；不得把 `Success Criteria` 勾成完成。
- 执行中不得修改 `Objective` / `Scope` / `Success Criteria`。

## 角色模型

- `modelRoles.planner` 用于 `/flow` 对齐、生成、repair 入口；`modelRoles.executor` 用于 Flow 新步骤启动入口。
- planner / executor 只能是 `"current"` 或 `{ model, thinking }`；模型名必须是精确 `provider/model-id`，`thinking` 必填。
- 插件只在阶段入口用公开 API `pi.setModel()` / `pi.setThinkingLevel()` 切一次；不恢复、不持久化原模型，不在后续 prompt 抢回。
- 配置模型不可用或未登录时阻塞并提示，不 fallback。
- `modelRoles.reviewers` 是完成验收和质量检查子进程模型；旧顶层 `models` 兼容为 reviewers，两者不能同时配置。

## Prompt 与状态文案

- 插件生成的编排 prompt 默认隐藏投递：`sendOrchestrationPrompt()`。
- 用户输入和澄清补充必须可见：`appendVisibleUserInput()`。
- 每个隐藏 prompt 必须有可见锚点：状态卡、活动卡或结果卡。
- 普通对齐中间轮 prompt 保持轻量，不注入完整拷问协议、原始需求、Q&A、用户刚才回答、摘要或 `<aligned-request>`；普通生成 prompt 只指向当前 `.flow/F<N>/`，不要求模型创建 F 目录，也不注入 Q&A；只有跨会话恢复到撰写计划时才可注入结构化 Q&A。
- 每次隐藏生成 / 对齐 / follow-up / repair prompt 都带 `<!-- pi-flow:prompt:<token> -->` marker，并按 session 记录 live target；同一 session 有 live target 时禁止覆盖式发送新生成 prompt。完成、暂停或跨 session 接管会把旧 target 降为 stale tombstone，用于吞掉 late `agent_end`，但 stale 不阻塞后续 prompt。
- 用户可见文案只用：`目标进行中`、`完成验收`、`验收补完中`、`等待质量检查收口`、`质量检查`、`质量修复中`。
- 实时卡片和 status 隐藏第一轮；第二轮起显示 `第 N 轮...`。HTML 多轮历史从 `第 1 轮...` 开始展示。
- Flow 前缀格式：`🌊 flow/第 N 步 · 标题/...`。
- 运行时连接、重试、暂停、取消通知统一为 `emoji + 标题 + 空行 + 正文`；英文词与中文之间留空格，末尾不加句号；用 emoji/title 表达严重性，避免原生 `Warning:` 前缀打破格式。
- 可恢复连接中断不推进业务状态、不新增检查轮次、不改变用户可见轮次。
- Goal 完成链里的质量检查不能和独立 `/review` 同时写右下角状态计时。

主要入口：`src/shared/progress-labels.ts`、`src/goal/runtime.ts`、`src/goal/review-orchestration.ts`、`src/review/view.ts`、`src/shared/internal-prompt.ts`。
