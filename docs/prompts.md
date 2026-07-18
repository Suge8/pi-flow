# Prompt 面索引

pi-flow 全部模型可见文案的位置、触发时机与投递方式。改任何注入文案时同步更新本索引与对应 smoke。

模型可见的注入面分三类，可见性与审计方式不同：

1. 隐藏 custom message（`sendOrchestrationPrompt`，`src/shared/internal-prompt.ts`，`display: false`）：用户不可见，但落盘 session jsonl，直接看 session 文件即可审计。
2. 步骤 system prompt（`before_agent_start` 返回 `systemPrompt` 拼接）：不落盘 session，审计看源码注入点 `src/goal/prompts.ts#buildGoalSystemPrompt` 与对应 smoke 断言。
3. 结果卡触发回合（`sendResultCard`，`src/shared/result-card.ts`，`display: true` + `triggerTurn`）：落盘 session jsonl；用户看到 renderer 的 `details` 卡片，模型收到 `content`。普通检查失败与完成后指令直接走结果卡；自动顾问轮由独立建议卡承载隐藏修复内容。

## 协议文件（`prompts/{zh,en}/`，子进程或生成会话的完整协议）

| 文件 | 用途 | 消费方 |
|------|------|--------|
| `flow-draft-contract.md` | 草稿格式契约单一事实源（semantic JSON 字段、Goal 七段结构、Steps/Verification 格式、FA 规则、边界与收尾） | `src/flow/prompt.ts` 拼接进生成与修复 prompt |
| `flow-plan.md` | 计划草稿生成（工作方式、设计协议、用户视角文案、拆分判据） | advisor 角色会话，`src/flow/prompt.ts#generationPrompt` 组装（末尾拼接契约后统一替换变量） |
| `flow-repair.md` | 草稿校验错误修复（纯修复指令，格式规则由拼接契约提供） | advisor 角色会话，`src/flow/prompt.ts#repairPrompt` 组装（末尾拼接契约后统一替换变量） |
| `grilling.md` | 对齐拷问协议（高杠杆问题优先、假设默认制、技术选型条款、「按推荐」委托、预算收敛） | advisor 角色会话；`src/shared/generation-alignment.ts` 按 coarse/standard/deep 只替换 `{{questionBudget}}` 数字，后续轮发送带同档预算的精简触发提示 |
| `goal-audit.md` | 验收 reviewer（完整性 gate：目标是否按原范围完成；PASS 带证据锚点；FAIL 锚定具体要求） | reviewer 子进程，`src/auditor.ts#buildAuditPrompt` 组装 |
| `review.md` | 质检 reviewer（质量 gate：逻辑缺陷、虚假测试、回归；必须读源码；FAIL 仅高/中严重度；PASS 带证据锚点与非阻塞建议） | reviewer 子进程，`src/review.ts#buildReviewPrompt` 组装 |
| `advisor.md` | 顾问模型（同一步骤连续 2/4/6/8 轮检查未通过时自动咨询，或串行 Flow 有未解决失败时由 `/advisor` 手动咨询；跨轮核实根因、提炼系统性洞察、给出方向与验证/转向条件，并仲裁 Success Criteria；可用 bash 做安全验证但不得修改项目） | advisor 子进程（`advisorConsultModel` 解析，`current` 只回落第一个 reviewer 的模型选择；检查能力共用 `checks`），`src/goal/advisor.ts#buildAdvisorPrompt` 组装 |

验收与质检的分工：验收管范围完整性，质检管实现质量；goal scope 的质检不重复逐项验证需求覆盖（`src/review.ts#reviewScopeText`）。

PASS 输出的机器强制边界（`src/shared/review-verdict.ts#passOutputIssue`）：摘要行必须在证据行前；证据行固定格式 `证据：文件=…；命令=…`（en `Evidence: files=...; commands=...`），以首个证据行为唯一判定行（拆行拼装无法通过），文件段含至少一个带扩展名路径、命令段非空，违反者按格式无效拒绝；段内容真实性（真读过、真跑过）机器无法验证，由协议约束与落盘详情审计兜底。

## 运行时注入（TS，隐藏投递或结果卡触发回合）

| 注入点 | 位置 | 触发时机 | 投递 |
|--------|------|----------|------|
| 步骤启动 prompt（snapshot + 前序 Handoff + 边界 + FA 职责；prewalk fork 启动时前置解禁句：生成期只读限制已解除、探索结论可复用） | `src/flow/prompt.ts#planGoalPrompt` | 步骤启动 | 隐藏 `sendOrchestrationPrompt` |
| 步骤 system prompt（目标 + Flow 步骤规则 + todoRule + 反循环 + 编排来源声明） | `src/goal/prompts.ts#buildGoalSystemPrompt` | 每回合 `before_agent_start` | systemPrompt 拼接 |
| 恢复 prompt（开头注入编排上下文声明 `orchestrationContextLine`：用户已离场、仍是自动化流程、BLOCKED 协议；有手动待投顾问建议时前置“待核实假设”段） | `src/goal/prompts.ts#buildResumePrompt` | 「/flow go」恢复已执行步骤 | 普通恢复隐藏；含手动建议时用 `pi-flow-advisor-direction` 隐藏投递，Context Evidence 提取时排除 |
| 自动延续 prompt（不重复目标，可携带拖延勾选提醒） | `src/goal/prompts.ts#buildContinuePrompt` | `agent_end` 未完成且无检查 | 隐藏 followUp |
| 验收前收口闸门（列出未收口 [ ]/[~] 项原文，穷举补勾/继续/标 [!] 三种出路，`src/goal/check-discipline.ts#todoClosureReminder`） | `src/goal/runtime.ts#gateAcceptanceOnOpenTodos` | 自然结束将进验收但计划仍有未收口 checkbox（每验收轮最多一次，[!] 放行；投递受阻/失败时推迟验收不放行：串行写 attention 并请求接管，并行 worker 经自身 artifact paused+handoff 收口退出） | 并入隐藏延续 prompt，顶替拖延勾选提醒 |
| 拖延勾选提醒 / 修订许可条款 / 计划修订注入 / 硬上限文案 | `src/goal/check-discipline.ts` | staleness 命中 / 连续 2 轮未过 / 检查启动时计划有修订 / 连续 10 轮未过 | 并入所属 prompt |
| 自动顾问修复 prompt（检查发现 + `advisorDirectionLines` + 处理纪律 + 可选修订许可） | `src/goal/runtime.ts#goalReviewRepairPrompt`、`src/review/view.ts#reviewFailContent` | 连续 2/4/6/8 轮检查未过；失败卡已先落盘 | 有建议时作为独立建议卡的 `content` 隐藏承载并由该卡 `triggerTurn`；Esc 或顾问不可用时通过 `sendOrchestrationPrompt` 隐藏投递，锚点为已发失败卡 |
| 手动顾问方向（`src/goal/prompts.ts#manualAdvisorDirection`） | `/advisor` 写 `rounds[].advisor + pendingAdvisor`，下一次 `/flow go`/延续消费 | 当前串行 Flow 步骤尾部有未解决失败，且开关开启、会话空闲 | 与自动路径共用 `src/shared/advisor-card.ts`；手动卡仅展示，执行模型收到专用隐藏消息，发送后清 outbox；验收/质检 Context Evidence 排除该消息 |
| 失败反馈公共纪律（模式穷举 / 自主决策 / BLOCKED 协议，`src/shared/check-feedback.ts#checkFeedbackDiscipline`） | 验收/质检失败反馈指令尾部 | 每次检查 FAIL | 并入修复 prompt |
| 验收失败反馈（原目标 + 发现 + 处理指令 + 可选修订许可） | `src/goal/runtime.ts#goalReviewContent` / `goalReviewRepairPrompt` + `src/shared/check-feedback.ts` | 验收 FAIL | 普通轮由失败卡直接 `triggerTurn`；顾问轮先发不触发回合的失败卡，再由建议卡或隐藏 prompt 触发 |
| 质检失败反馈（检查结果 + 处理指令 + 可选修订许可） | `src/review/view.ts#reviewFailContent` + `src/shared/check-feedback.ts` | 质检 FAIL（autoFix） | 普通轮由失败卡直接 `triggerTurn`；顾问轮先发不触发回合的失败卡，再由建议卡或隐藏 prompt 触发 |
| 完成后最终回复指令 | `src/shared/result-card.ts#finalReplyInstruction` | 全部检查通过 | 结果卡 `triggerTurn` |
| 对齐轮次 / 跨会话恢复 / follow-up | `src/flow/generation.ts`、`src/shared/generation-alignment.ts` | 生成前子阶段 | 隐藏，带 prompt marker |
| worker 引导 | `src/flow/execution/worker-command.ts` | 并行 worker 启动 | 私有 bootstrap |

## Context Evidence 输入组装

- `src/shared/context-evidence.ts` 直接读取 `sessionManager.getBranch()` 原始事件。它不读取 compaction/branch summary 内容，也不解析压缩插件 details。
- `requirements` 投影供 conversation 来源的计划生成使用：按原顺序保留真实用户、可见用户补充和 assistant 最终声明；不同事件即使正文相同也保留，入选原文不做遮罩。
- `review` 投影供验收、质检和顾问共用：在 `requirements` 基础上加入工具动作与配对结果、失败头尾、最近验证、edit/write 路径和最近完整操作链；旧成功 read/bash 输出只保留动作与状态。
- 验收：`goal-audit.md` + 目标 + 计划 markdown + 计划修订注入（有修订时）+ 往轮发现清单（第 2 轮起，`priorRoundsSection`）+ `review` packet（`src/auditor.ts`）。
- 质检：`review.md` + scope 限定（goal scope 含正交化说明与计划修订注入）+ 往轮发现清单（第 2 轮起，`priorRoundsSection`）+ `review` packet（`src/review.ts`）。
- 顾问：`advisor.md` + 目标与计划 markdown + 失败发现历史（验收+质检全部失败轮，详情完整保留并计入 fixed prompt 预算）+ 计划修订注入（有修订时）+ 同一 `review` packet（`src/goal/advisor.ts`）。失败历史与工具证据共同展示尝试和失败演化；真正超窗时按 `fixed_prompt_overflow` 明确退出。
- 提取器排除隐藏编排消息、结果检查卡和 `pi-flow-advisor-direction`；手动顾问建议只影响执行模型。packet 带来源、coverage 和动态预算。所有 reviewer 在 pool 启动前共用同一个不可变 packet，prompt 全文参与 `inputHash`。
- 验收与质检若证实文件在验证期间被并行修改，会丢弃该次结果、读取最新文件后重跑，并以最后一次完整结果为准。

## 维护约定

- 检查反馈处理指令的单一事实源是 `src/shared/check-feedback.ts`；不要在别处复制「假设待核实」文案。
- 用户可见文案变更跑 `tests/copy-lint-smoke.mjs`；prompt 行为断言在 `tests/flow-smoke.mjs`、`tests/goal-review-smoke.mjs`、`tests/review-smoke.mjs`。
