# Changelog

## Unreleased

### English

#### Highlights

- Made `/flow` the single task runtime; Goal internals now run as Flow steps instead of user-facing Goal commands.
- Added dependency-aware Flow scheduling with parallel execution for ready goals that do not conflict by `writeScope`.
- Consolidated Flow advancement into `/flow go`; generation, draft start, pause resume, running fan-in, and completed reports now share one entry point.
- Added `/flow stop` lifecycle support for draft, pre-draft, running, and parallel Flow runs.
- Reworked the static Flow HTML report with a modern stepper, live check state, parallel lanes, and richer hover details.

#### Added

- Added Flow-level write locks to protect `flow.json` scheduling, fan-in, recovery, rollback, and status transactions.
- Added private parallel worker bootstrap, worker protocol, configured runner spawning, and isolated worker artifacts under `workers/Gx/`.
- Added parallel fan-in that settles successful workers, resets failed workers, and preserves retryable Flow state.
- Added parallel result watching so live reports can reflect worker `plan.md`, `state.json`, and `result.json` updates during active batches.
- Added crash recovery for persisted `parallelRun` state; `/flow go` can collect matching worker results and reschedule missing work.
- Added paused Flow schema and resume facts so stopped pre-draft, draft, running, and parallel runs can continue safely.
- Added explicit Flow target resolution for bare ids, current-session ownership, unique active Flow selection, and ambiguity prompts.
- Added persisted pre-draft alignment state in `alignment.json`, including session ownership, turns, prompt state, and auto-start intent.
- Added per-model completion acceptance and quality-check summaries to persisted review history and HTML reports.
- Added compact diagnostic `/flow status [id]` output for active, paused, draft, and pre-draft Flows.

#### Changed

- Changed Flow ids to canonical bare `F<N>` directories and updated generation prompts to target allocated Flow dirs.
- Changed pre-draft continuation so `/flow go [id]` can continue alignment, generate from final confirmation, or start a ready draft.
- Changed running Flow handling so `/flow go` is idempotent and can fan-in active parallel batches before continuing scheduling.
- Changed parallel execution to run inside a visible orchestrator session that owns lane UI, worker launch, fan-in, and follow-up scheduling.
- Changed completion prompts so Flow step snapshots stay authoritative after progress updates and checkbox mutations.
- Changed final acceptance handling so final acceptance steps are counted outside normal step limits and gated after normal goals.
- Changed runtime notices and result cards to card-style copy with clearer recovery, busy, connection, and save-failure messages.
- Changed review and Flow copy to consistently use user-facing terms: completion acceptance, quality check, `/flow go`, and `/flow stop`.
- Changed report icons from Phosphor-style paths to vendored Lucide SVGs with no icon dependency.
- Changed report command chips, hover chips, modal animation, progress rings, and check status presentation to reduce visual noise.

#### Fixed

- Fixed success criteria mutation and negated criteria deviations being treated as invalid handoff changes.
- Fixed semantic draft validation for parallel fields and stricter generated Flow shapes.
- Fixed worker spawning to honor configured runner command, extension flags, and initial prompts.
- Fixed live parallel status reports being overwritten by `/flow status` during active batches.
- Fixed failed parallel workers so retries only rerun failed pending goals, not already completed workers.
- Fixed parallel fan-in to report missing `result.json`, exit code, signal, and stderr summaries.
- Fixed Flow owner routing across pre-draft, running, paused, and completed states.
- Fixed cross-session generation replies, stale prompt targets, and old prompt results from hijacking active Flow generation.
- Fixed hidden generation prompt markers being shown or persisted in assistant messages.
- Fixed scoped live report openings so one Flow report no longer steals another Flow's live server state.
- Fixed multiline card rows so UI notices render stable text instead of broken rows.
- Fixed truncated Goal save and review errors to use `…`, keeping copy checks stable on long CI paths.
- Fixed Flow smoke race conditions by arming fake worker release watchers before signaling readiness.

#### Reports, docs, and tests

- Added iconized Flow report layout with brand header, compact overall progress, active step cards, and source/request context.
- Added report stepper behavior for selected steps, parallel branch groups, completion acceptance, and quality check micro-status.
- Added report hover details for model results, request records, QA history, scope, done criteria, verification, and long handoff content.
- Added scheduler, routing, paused lifecycle, parallel worker, prompt contract, generation alignment, and copy smoke coverage.
- Added fail-fast Flow smoke scenario timeouts and monotonic test waits to prevent CI hangs from hiding root causes.
- Updated runtime and HTML report contracts to document Flow-only runtime, `alignment.json`, parallel orchestration, `/flow go`, and `/flow stop`.

### 中文

#### 重点

- 将 `/flow` 收敛为唯一任务运行时；Goal 内部逻辑现在作为 Flow step 运行，不再作为用户命令暴露。
- 新增依赖感知调度；满足依赖且 `writeScope` 不冲突的步骤可并行执行。
- 将 Flow 推进收敛到 `/flow go`；生成、草稿启动、暂停恢复、运行中收口和完成报告共用同一入口。
- 新增 `/flow stop` 生命周期，覆盖草稿、生成前、运行中和并行 Flow。
- 重做静态 Flow HTML 报告，加入现代 stepper、实时检查状态、并行 lane 和更丰富的 hover 详情。

#### 新增

- 新增 Flow 级写锁，保护 `flow.json` 的调度、fan-in、恢复、回滚和 status 事务。
- 新增私有并行 worker bootstrap、worker protocol、配置化 runner 启动，以及 `workers/Gx/` 隔离产物。
- 新增并行 fan-in：完成成功 worker，重置失败 worker，并保留可重试 Flow 状态。
- 新增并行结果监听，活动批次中实时报告可反映 worker `plan.md`、`state.json` 和 `result.json` 更新。
- 新增持久化 `parallelRun` 崩溃恢复；`/flow go` 可收口匹配 worker 结果并重新调度缺失工作。
- 新增暂停 Flow schema 和恢复事实，确保生成前、草稿、运行中和并行 Flow 停止后可安全继续。
- 新增显式 Flow 目标解析：裸 id、当前 session 归属、唯一 active Flow 选择和多义提示。
- 新增 `alignment.json` 生成前对齐状态，记录 session 归属、问答轮次、prompt 状态和 auto-start 意图。
- 新增按模型记录的完成验收与质量检查摘要，并持久化到历史与 HTML 报告。
- 新增紧凑诊断 `/flow status [id]` 输出，覆盖 active、paused、draft 和 pre-draft Flow。

#### 变更

- Flow id 改为裸 `F<N>` 目录，并更新生成 prompt，使其写入已分配 Flow 目录。
- 生成前继续逻辑改为 `/flow go [id]` 可继续对齐、从最终确认生成计划，或启动已就绪草稿。
- 运行中 Flow 的 `/flow go` 改为幂等；可先收口活动并行批次，再继续调度。
- 并行执行改为在可见 orchestrator session 中运行，由该 session 负责 lane UI、worker 启动、fan-in 和后续调度。
- 完成 prompt 调整为 Flow step snapshot 在进度更新和 checkbox 变更后始终作为权威事实。
- 最终验收步骤改为不占用普通步骤数量限制，并在普通步骤完成后再 gate。
- 运行时通知和结果卡片改为卡片式文案，恢复、忙碌、连接中断和保存失败提示更清晰。
- review 与 Flow 文案统一使用用户可见术语：完成验收、质量检查、`/flow go` 和 `/flow stop`。
- 报告图标从 Phosphor 风格 path 改为 vendored Lucide SVG，不新增 icon 依赖。
- 报告命令 chip、hover chip、modal 动画、进度环和检查状态展示改为更轻、更少视觉噪音。

#### 修复

- 修复成功标准被错误改写，以及否定式标准偏差被误判为非法 handoff 变更。
- 修复语义草稿中并行字段和生成 Flow 形状的校验缺口。
- 修复 worker 启动未正确遵守配置的 runner command、extension flags 和 initial prompt。
- 修复活动并行批次中 `/flow status` 覆盖实时 parallel status report。
- 修复并行失败重试会误重跑已完成 worker 的问题；现在只重跑失败 pending 目标。
- 修复并行 fan-in 错误信息，补充缺失 `result.json`、exit code、signal 和 stderr 摘要。
- 修复 pre-draft、running、paused 和 completed 状态下的 Flow 归属路由。
- 修复跨 session 生成回复、stale prompt target 和旧 prompt 结果抢占当前 Flow 生成的问题。
- 修复隐藏 generation prompt marker 被展示或落盘到 assistant 消息的问题。
- 修复多 Flow live report 作用域串扰，一个 Flow 不再抢走另一个 Flow 的 live server 状态。
- 修复多行 card row 渲染不稳定导致通知文本断裂的问题。
- 修复 Goal 保存与检查错误截断使用 `...` 导致长 CI 路径下 copy 检查不稳定的问题，改用 `…`。
- 修复 Flow smoke 中 fake worker release watcher 的竞态，先 arm watcher 再写 ready marker。

#### 报告、文档与测试

- 新增带图标的 Flow 报告布局，包含品牌头、紧凑总进度、活动步骤卡和来源/需求上下文。
- 新增报告 stepper 行为，覆盖选中步骤、并行分支组、完成验收和质量检查微状态。
- 新增模型结果、需求记录、QA 历史、范围、完成标准、验证方式和长 handoff 内容的 hover 详情。
- 新增 scheduler、路由、暂停生命周期、并行 worker、prompt contract、生成对齐和 copy smoke 覆盖。
- 新增 Flow smoke 单场景 fail-fast 超时和单调时钟等待，避免 CI hang 掩盖根因。
- 更新 runtime 与 HTML 报告契约，记录 Flow-only runtime、`alignment.json`、并行编排、`/flow go` 和 `/flow stop`。

## 0.2.1 - 2026-07-05

### English

- Fixed streaming Goal/Flow alignment replies being echoed as model-visible custom messages; hidden alignment context still sends.
- Fixed Flow auto-start losing the original `/flow` command context; generated flows can create step sessions correctly.

### 中文

- 修复 Goal/Flow 流式对齐回复被回显为模型可见 custom message；隐藏对齐上下文仍发送。
- 修复 Flow 自动启动丢失原始 `/flow` 命令上下文；生成后的 Flow 能正常创建步骤会话。
