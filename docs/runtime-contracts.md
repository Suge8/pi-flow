# 运行契约

只记录当前实现。不要写计划、历史留档、backlog。改行为时同步更新本文档和 smoke。

## 状态

- `flow.json` 是唯一规范状态源，当前 `schemaVersion: 7`。
- 模型只写 `flow.semantic.json` 和计划 Markdown；builder 组装规范状态。
- `flow.semantic.json` 的 `goals[]` 可声明 `dependsOn`（先序 0-based index；缺省等同依赖前一步，`[]` 表示无前置）和 `writeScope`（模块/目录 glob；缺省视为未知写入范围）。
- Flow 最多 10 个 `normal` 执行步骤；单步 Flow 只含 1 个 `normal` 且不写 `final_acceptance`；多步 Flow 最后必须且只能有 1 个 `final_acceptance`，最终验收不占 10 个执行步骤名额。
- `flow.json.parallelRun` 是落盘并行运行门闩：`null` 表示无活动并行运行；非空时必须为 `{ id, goalIndexes, startedAt }`，表示这些 Goal 已进入同一个并行运行。
- 并行开始时父 session 先写 `flow.json`：批次内 Goal 置为 `running`，记录 `sessionFile` / `sessionName` / `snapshot` / `snapshotHash`，`currentGoal` 指向批次最小下标，`parallelRun` 写入当前运行；该字段保留到 fan-in、恢复或取消收口。
- 并行 worker 只在 `workers/G<index>/` 写内部 `session.jsonl`、`plan.md`、`state.json` 和完成信号 `result.json`；`result.json` 必须带匹配的 `parallelRunId` 才会被父 session 接收。worker 不写父级 `flow.json`、不触发调度。
- 父 session 收齐 worker 退出后 fan-in 写 `flow.json`：成功 worker 标记 complete，失败、退出非 0 或缺 `result.json` 的 worker 回 pending。失败收口保持 Flow running，`currentGoal` 指向首个失败 Goal，`errors` 写失败 worker 的 step label、exit code / signal、是否缺 `result.json`；不自动重试，用户运行 `/flow continue` 后只调度仍 pending 的失败 Goal，已成功的同批 Goal 不重跑。取消清空 `parallelRun` 并标记 Flow cancelled。
- 崩溃或父 session 丢失后，`/flow continue` 发现持久化 `parallelRun` 时进入恢复：加锁读取匹配 `parallelRunId` 的 `result.json` 完成已成功 Goal，缺结果的 Goal 重置为 pending，清空 `parallelRun` 后重新交给调度器。
- 模型不写 `parallelRun`、`checks`、`completionCursor`、`flow.html`。
- `checks.acceptance` = 完成验收；`checks.quality` = 质量检查；两者结构都是 `enabled / rounds / active`。
- `completionCursor` 只用于内部恢复路由，用户界面不展示。
- Flow 总用时只读 `startedAt`：草稿为 `null`，运行态必须是时间戳；不能用 `createdAt` 兜底。

## 同 cwd 多 Flow 运行

- 同一 cwd 下可同时存在多个 `status: "running"` 的 Flow；每个 `.flow/F<N>-slug/flow.json` 仍是各自唯一状态源。
- 用户命令先按显式 id（短 id 或完整 id）定位；无 id 时按当前 session 所属 Flow，其次唯一 running Flow；多个 running 且无归属时必须提示用户指定短 id，不得默认选第一个。
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
- `/flow continue`、resume、自动 continuation 或没有 snapshot 的入口：开始工作前必须读取当前计划 Markdown，不得依赖旧 snapshot。
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
- 用户可见文案只用：`目标进行中`、`完成验收`、`验收补完中`、`等待质量检查收口`、`质量检查`、`质量修复中`。
- 实时卡片和 status 隐藏第一轮；第二轮起显示 `第 N 轮...`。HTML 多轮历史从 `第 1 轮...` 开始展示。
- Flow 前缀格式：`🌊 flow/第 N 步 · 标题/...`。
- 可恢复连接中断不推进业务状态、不新增检查轮次、不改变用户可见轮次。
- Goal 完成链里的质量检查不能和独立 `/review` 同时写右下角状态计时。

主要入口：`src/shared/progress-labels.ts`、`src/goal/runtime.ts`、`src/goal/review-orchestration.ts`、`src/review/view.ts`、`src/shared/internal-prompt.ts`。
