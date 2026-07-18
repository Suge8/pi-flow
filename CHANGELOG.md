# Changelog

## 0.3.0 - 2026-07-18

### English

#### Highlights

- Merged planning into `modelRoles.advisor`: one model now aligns, generates plans, and gives automatic advice after 2/4/6/8 consecutive failed check rounds. Failed checks are shown immediately; advisor advice follows in a separate card.
- Added `/advisor` for on-demand consultation after an unresolved Flow check failure. Advice is atomically attached to the failed round, survives restarts in a persistent outbox, is delivered to the executor on the next `/flow go`, and is explicitly hidden from reviewer transcripts; the command respects `advisor.enabled` and does not run for parallel batches or failure-free steps.
- Extended stall discipline to standalone `/review`: advisor consults at 2/4/6/8 failed rounds, a 10-round hard cap, and restart-safe failure counting via checkpoint history.
- Made `/review` a three-state entry: run it while idle to check immediately, pass a request to execute it as a real user message and auto-check afterward, or run it while the AI is busy to arm an automatic check for the current turn. Armed checks survive restarts and can be cancelled with Esc/Ctrl+C.
- Added standalone `/review` HTML reports with the complete request thread, active and historical rounds, reviewer details, advisor guidance, and live links on start and terminal results.
- Structured request records now use flow.json schema v17's strict source union: conversation preserves timestamped turns, prompt preserves text, and file preserves path + text; Flow and standalone review reports render the same readable conversation thread.
- Added cross-round convergence rules to acceptance and quality prompts: re-verify prior findings first, no FAILs from repeated/unevidenced/out-of-scope findings, defect patterns must list all visible instances, and the bar never drops to end a loop.
- Mid-run plan revision no longer breaks the Flow: revision legitimacy is arbitrated by reviewers against the persisted startup snapshot (the diff survives restarts and parallel workers) instead of a byte-level hash check that treated every change — including permitted Success Criteria revisions — as fatal. Recovery prechecks only stop for genuinely unrecoverable facts (missing snapshot or deleted step file). Revision permission now unlocks after 2 consecutive failed rounds, aligned with the advisor's first consultation.
- Added the BLOCKED handover protocol: when a fix can only be completed by the user (on-device actions, system permissions), the executor stops with `BLOCKED: <todo>`, the step pauses with a takeover card, and `/flow go` resumes checks unchanged.
- Added the current-only flow.json schema v17 with strict conversation/prompt/file request sources, recorded alignment Q&A (`meta`), takeover state (`attention`), per-checkbox attribution (`checkAttribution`), structured advisor advice + round durations, and the manual-advisor delivery outbox (`pendingAdvisor`); unsupported schemas are never migrated or rewritten.
- Reworked the HTML report header and check cards: plan-model meta line, red attention banner with resume command, calm paused line, advisor pills (done + consulting), model chips with thinking levels, checkbox attribution lines, remaining-suggestions digest, and a larger, bolder progress ring.
- Added a live subagent monitor for parallel work, acceptance, quality checks, and advisor consultations. It opens automatically; Esc closes it and Alt+S reopens it.
- Added a "🧭 Advisor consulting" activity frame (with input lock and Esc-to-skip) while the advisor subprocess runs.

- Made `/flow` the single task runtime; Goal internals now run as Flow steps instead of user-facing Goal commands.
- Added dependency-aware Flow scheduling with parallel execution for ready goals that do not conflict by `writeScope`.
- Consolidated Flow advancement into `/flow go`; generation, draft start, pause resume, running fan-in, and completed reports now share one entry point.
- Added `/flow stop` lifecycle support for draft, pre-draft, running, and parallel Flow runs.
- Reworked the static Flow HTML report with a modern stepper, live check state, parallel lanes, and richer hover details.

#### Added

- Added Flow-level write locks to protect `flow.json` scheduling, fan-in, recovery, rollback, and status transactions.
- Added private parallel worker bootstrap, worker protocol, configured runner spawning, and root-level `G<N>-worker.json` schema v3 artifacts.
- Added parallel fan-in that settles successful workers, resets failed workers, and preserves retryable Flow state.
- Added parallel result watching so live reports can reflect step Markdown, `G<N>-worker.json`, and `G<N>-worker-events.json` updates during active batches.
- Added crash recovery for persisted `parallelRun` state; `/flow go` can collect matching worker results and reschedule missing work.
- Added paused Flow schema and resume facts so stopped pre-draft, draft, running, and parallel runs can continue safely.
- Added explicit Flow target resolution for bare ids, current-session ownership, unique active Flow selection, and ambiguity prompts.
- Added persisted pre-draft alignment state in `alignment.json`, including session ownership, turns, prompt state, and auto-start intent.
- Added per-model completion acceptance and quality-check summaries to persisted review history and HTML reports.
- Added compact diagnostic `/flow status [id]` output for active, paused, draft, and pre-draft Flows.

#### Changed

- Replaced the overloaded `runner` config with `background` process settings and one shared `checks` capability profile for acceptance, quality review, and failure advisors; the breaking `checks.fast` → `checks.openaiFast` rename now enables paid priority processing only for supported OpenAI Responses requests, while other requests silently use standard processing. Removed the old `--pi-flow-service-tier` CLI path; reviewer entries accept only model + thinking.
- Expanded failure advisors into evidence-backed root-cause diagnosis with safe bash verification and temporary experiments, while hard-denying write/edit and destructive project operations; advisor output is no longer truncated to 200 characters or words.
- Changed Flow ids to canonical bare `F<N>` directories and updated generation prompts to target allocated Flow dirs.
- Changed pre-draft continuation so `/flow go [id]` can continue alignment, generate from final confirmation, or start a ready draft.
- Changed running Flow handling so `/flow go` is idempotent and can fan-in active parallel batches before continuing scheduling.
- Changed parallel execution to run inside a visible orchestrator session that owns lane UI, worker launch, fan-in, and follow-up scheduling.
- Changed completion prompts so Flow step snapshots stay authoritative after progress updates and checkbox mutations.
- Changed final acceptance handling so final acceptance steps are counted outside normal step limits and gated after normal goals.
- Changed runtime notices and result cards to card-style copy with clearer recovery, busy, connection, and save-failure messages.
- Changed review and Flow copy to consistently use user-facing terms: completion acceptance, quality check, `/flow go`, and `/flow stop`.
- Changed report icons from Phosphor-style paths to vendored Lucide SVGs with no icon dependency.
- Changed report command chips, hover chips, modal animation, progress rings, and check status presentation to reduce visual noise; completed advisor advice now uses one centered hover capsule with the full advice in its large tooltip and no duplicate summary block.
- Changed npm delivery to precompiled `dist/` JavaScript with package-level extraction smoke tests; source, tests, evaluation scripts, and release scripts are no longer published.
- Removed configuration aliases, persisted-state migrations, worker artifact fallbacks, and the duplicate draft validator implementation.

#### Fixed

- Fixed busy `/review <request>` occasionally starting quality checks from the previous turn's delayed `agent_end`; event ownership and skip state are now captured synchronously before follow-up message events can mutate loop state.
- Fixed restarted round-0 `/review` arming losing Esc/Ctrl+C cancellation while reply input remained visible; review-only teardown now resets the old activity editor so the next session reinstalls it, and visible-input cancellation is explicitly scoped to that waiting state before any later `agent_end`.
- Fixed advisor consultations dropping the tail of each failed round after 2,000 characters; all round details now reach the advisor and use the existing fixed-prompt overflow boundary.
- Fixed per-checkbox attribution timestamps being batch-assigned at agent end; each successful exact plan `edit` now records only its own transitions at tool completion, handles checkbox insertions/deletions and duplicate-key shifts, pairs repeated text only from stable mixed-state replacement position or unique text + state identity, treats equal-count mixed-state swaps and other ambiguous replacements as delete + add, and durably retries lock-blocked key-level deltas against the original Flow step even after pause/completion/advance without overwriting concurrent facts or changing original times; failed/external changes remain unattributed, active-plan rewrites are rejected in favor of auditable edits, and live parallel reports show second-level times.
- Fixed success criteria mutation and negated criteria deviations being treated as invalid handoff changes.
- Fixed semantic draft validation for parallel fields and stricter generated Flow shapes.
- Fixed worker spawning to honor configured runner command, extension flags, and initial prompts.
- Fixed live parallel status reports being overwritten by `/flow status` during active batches.
- Fixed failed parallel workers so retries only rerun failed pending goals, not already completed workers.
- Fixed parallel fan-in to report missing worker completion, exit code, signal, and stderr summaries.
- Fixed Flow owner routing across pre-draft, running, paused, and completed states.
- Fixed cross-session generation replies, stale prompt targets, and late prompt results from hijacking active Flow generation.
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
- Added a bilingual landing page (`site/`, Svelte 5 + GSAP, deployable to Vercel) with product film loops, scroll-driven storytelling, and copy-lint-protected wording.

### 中文

#### 重点

- 计划职责并入 `modelRoles.advisor`：同一模型负责对齐、生成计划，并在连续 2/4/6/8 轮检查未通过时自动咨询顾问。检查失败会立即展示，顾问建议随后以独立卡片呈现。
- 新增 `/advisor`：当前 Flow 步骤有尚未解决的检查失败时可按需咨询；建议与失败轮原子落盘，通过持久化 outbox 跨重启保留，在下一次 `/flow go` 送给执行模型，并从审查 transcript 明确过滤；命令尊重 `advisor.enabled`，并行批次或零失败步骤不运行。
- 停滞自愈扩展到独立 `/review`：2/4/6/8 轮顾问咨询、10 轮硬停，checkpoint 携带历史使失败计数重启不失忆。
- `/review` 收口为三态：空闲裸打立即质检；带需求时作为真实用户消息直接执行，完成后自动质检；AI 执行中裸打则为当前轮武装自动质检。武装状态跨重启保留，质检开始前可用 Esc/Ctrl+C 取消。
- 独立 `/review` 新增 HTML 报告，展示完整需求对话、当前与历史轮次、Reviewer 详情和顾问建议；启动与终局结果均附实时链接。
- 需求记录升级为 flow.json schema v17 的严格 source union：conversation 保存带时间的原始轮次，prompt 保存 text，file 保存 path + text；Flow 与独立质检报告复用同一可读对话 thread。
- 验收与质检 prompt 新增跨轮收敛规则：优先复核往轮发现、重复/无证据/超范围发现不得驱动 FAIL、缺陷模式须列举全部可见实例、禁止降标结束循环。
- 中途修订计划不再断流：修订合法性由检查仲裁按持久化启动快照的 diff 裁决（跨重启、跨并行 worker 不可漂白），取代把一切变更——包括已获许可的 Success Criteria 修订——判为致命错误的字节级哈希校验；恢复前置校验只拦真正不可恢复的事实（缺快照 / 步骤文件被删）。修订许可改为连续 2 轮未通过解锁，与顾问首咨同轮，顾问建议修订时执行模型立即有权执行。
- 新增 BLOCKED 接管协议：修复只能由用户亲手完成时（真机操作、系统权限），执行模型输出 `BLOCKED: <待办>` 停下，步骤暂停并发接管卡，`/flow go` 恢复后检查照常。
- flow.json 收敛为仅支持当前 schema v17：`source` 严格区分 conversation/prompt/file，`meta` 保存原始对齐 Q&A，并包含接管状态（`attention`）、勾级归因（`checkAttribution`）、结构化顾问建议与轮次用时、手动顾问投递 outbox（`pendingAdvisor`）；其他 schema 不迁移、不改写。
- 重做 HTML 报告头部与检查卡：计划模型元信息行、红色接管横幅（带恢复命令）、琥珀已暂停行、顾问两态 pill、模型带思考强度 chip、勾级归因行、遗留建议聚合、更大更粗的进度环；气泡宽度与触发器屏幕位置解耦。
- 并行执行、验收、质检和顾问咨询新增子代理实时监控；悬浮窗自动弹出，Esc 关闭，Alt+S 重开。
- 顾问子进程运行期间新增「🧭 顾问介入中」活动框（输入锁 + Esc 跳过咨询）。
- 将 `/flow` 收敛为唯一任务运行时；Goal 内部逻辑现在作为 Flow step 运行，不再作为用户命令暴露。
- 新增依赖感知调度；满足依赖且 `writeScope` 不冲突的步骤可并行执行。
- 将 Flow 推进收敛到 `/flow go`；生成、草稿启动、暂停恢复、运行中收口和完成报告共用同一入口。
- 新增 `/flow stop` 生命周期，覆盖草稿、生成前、运行中和并行 Flow。
- 重做静态 Flow HTML 报告，加入现代 stepper、实时检查状态、并行 lane 和更丰富的 hover 详情。

#### 新增

- 新增 Flow 级写锁，保护 `flow.json` 的调度、fan-in、恢复、回滚和 status 事务。
- 新增私有并行 worker bootstrap、worker protocol、配置化 runner 启动，以及根目录 `G<N>-worker.json` schema v3 运行态。
- 新增并行 fan-in：完成成功 worker，重置失败 worker，并保留可重试 Flow 状态。
- 新增并行结果监听，活动批次中实时报告可反映步骤 Markdown、`G<N>-worker.json` 和 `G<N>-worker-events.json` 更新。
- 新增持久化 `parallelRun` 崩溃恢复；`/flow go` 可收口匹配 worker 结果并重新调度缺失工作。
- 新增暂停 Flow schema 和恢复事实，确保生成前、草稿、运行中和并行 Flow 停止后可安全继续。
- 新增显式 Flow 目标解析：裸 id、当前 session 归属、唯一 active Flow 选择和多义提示。
- 新增 `alignment.json` 生成前对齐状态，记录 session 归属、问答轮次、prompt 状态和 auto-start 意图。
- 新增按模型记录的完成验收与质量检查摘要，并持久化到历史与 HTML 报告。
- 新增紧凑诊断 `/flow status [id]` 输出，覆盖 active、paused、draft 和 pre-draft Flow。

#### 变更

- 用 `background` 后台进程设置和验收、质检、失败顾问共用的 `checks` 能力配置替代职责混杂的 `runner`；破坏性地把 `checks.fast` 改名为 `checks.openaiFast`，只对支持的 OpenAI Responses 请求启用付费优先处理，其他请求静默走普通模式；移除旧 `--pi-flow-service-tier` CLI 通道。reviewer 条目只接受模型与思考强度。
- 顾问升级为基于证据的根因诊断：允许用 bash 做安全验证和临时实验，硬性禁用 write/edit 与破坏项目的操作；建议正文不再按 200 字符或词数截断。
- Flow id 改为裸 `F<N>` 目录，并更新生成 prompt，使其写入已分配 Flow 目录。
- 生成前继续逻辑改为 `/flow go [id]` 可继续对齐、从最终确认生成计划，或启动已就绪草稿。
- 运行中 Flow 的 `/flow go` 改为幂等；可先收口活动并行批次，再继续调度。
- 并行执行改为在可见 orchestrator session 中运行，由该 session 负责 lane UI、worker 启动、fan-in 和后续调度。
- 完成 prompt 调整为 Flow step snapshot 在进度更新和 checkbox 变更后始终作为权威事实。
- 最终验收步骤改为不占用普通步骤数量限制，并在普通步骤完成后再 gate。
- 运行时通知和结果卡片改为卡片式文案，恢复、忙碌、连接中断和保存失败提示更清晰。
- review 与 Flow 文案统一使用用户可见术语：完成验收、质量检查、`/flow go` 和 `/flow stop`。
- 报告图标从 Phosphor 风格 path 改为 vendored Lucide SVG，不新增 icon 依赖。
- 报告命令 chip、hover chip、modal 动画、进度环和检查状态展示改为更轻、更少视觉噪音；已完成顾问建议收敛为一个居中悬浮胶囊，完整建议只进 lg 气泡，不再重复展示摘要块。
- npm 发布改为预编译 `dist/` JavaScript，并增加真实包解压 smoke；不再发布源码、测试、评测和 release 脚本。
- 删除配置别名、持久状态迁移、worker artifact 回退和重复的草稿 validator 实现。

#### 修复

- 修复忙碌时运行 `/review <需求>` 可能被上一轮延迟 `agent_end` 提前触发质检的问题；现在会在事件同步入口冻结 loop 归属与 skip 状态，后续 follow-up 消息无法改写旧事件。
- 修复 round-0 `/review` 武装在重启后保持回复输入可见却丢失 Esc/Ctrl+C 取消能力的问题；review-only teardown 现在会重置旧活动编辑器，确保新会话重新安装，并只在该等待态显式捕获取消键、在后续 `agent_end` 前清除 checkpoint。
- 修复顾问咨询把每轮失败详情的 2,000 字符后半段丢弃的问题；现在全部轮次详情完整送达，并统一由现有 fixed prompt 超窗边界处理。
- 修复勾级归因在 Agent 结束时批量写入同一时间的问题；现在每次成功的计划精确 `edit` 只按自身转换和工具完成时间归因，支持 checkbox 新增/删除与重复文案 key 漂移，同文案仅凭稳定的混合状态 replacement 位置或唯一「文案 + 状态」身份配对，等量混合状态换位及其他歧义替换按删除 + 新增处理；canonical 锁忙时持久保留 key 级 delta 与原时间，即使步骤已暂停、完成或推进也写回原步骤，并以冲突安全合并避免覆盖并发事实；失败/外部变化不归因，执行期计划重写会被拒绝并要求可审计的精确 edit，同时覆盖并行 worker 实时报告与 HTML 秒级展示。
- 修复成功标准被错误改写，以及否定式标准偏差被误判为非法 handoff 变更。
- 修复语义草稿中并行字段和生成 Flow 形状的校验缺口。
- 修复 worker 启动未正确遵守配置的 runner command、extension flags 和 initial prompt。
- 修复活动并行批次中 `/flow status` 覆盖实时 parallel status report。
- 修复并行失败重试会误重跑已完成 worker 的问题；现在只重跑失败 pending 目标。
- 修复并行 fan-in 错误信息，补充缺失 worker completion、exit code、signal 和 stderr 摘要。
- 修复 pre-draft、running、paused 和 completed 状态下的 Flow 归属路由。
- 修复跨 session 生成回复、stale prompt target 和迟到 prompt 结果抢占当前 Flow 生成的问题。
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
- 新增双语落地页（`site/`，Svelte 5 + GSAP，可部署 Vercel）：产品循环视频、滚动叙事，文案受 copy-lint 保护。

## 0.2.1 - 2026-07-05

### English

- Fixed streaming Goal/Flow alignment replies being echoed as model-visible custom messages; hidden alignment context still sends.
- Fixed Flow auto-start losing the original `/flow` command context; generated flows can create step sessions correctly.

### 中文

- 修复 Goal/Flow 流式对齐回复被回显为模型可见 custom message；隐藏对齐上下文仍发送。
- 修复 Flow 自动启动丢失原始 `/flow` 命令上下文；生成后的 Flow 能正常创建步骤会话。
