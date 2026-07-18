# Pi Flow 领域词汇表

Pi 扩展的交付编排上下文：Flow 编排、多模型检查与恢复机制的术语事实源。定义以 `AGENTS.md` 与 `docs/runtime-contracts.md` 为准，本文只解释「这个词指什么」。

本表是活文档：日常开发中发现实际用法与本表冲突、或遇到本表未收的高频术语时，与用户确认后随手修订对应条目，不必专门立项。

## 编排与角色

**Flow**：
一次完整交付编排实例，运行态是 `.flow/F<N>/flow.json`（schema v16）；用户文案保持英文 Flow，不翻译。
_Avoid_: 流程, task, job, workflow

**Goal / 第 N 步**：
Flow 内的一个执行单元。代码与 schema 用 `Goal`；用户可见文案只允许「第 N 步」「步骤」。
_Avoid_: 用户文案里的 Goal、subtask

**验收（acceptance）**：
多审查模型对「需求是否真正完成」的仲裁，按需求逐项反查。
_Avoid_: 审核, verification, 用户文案里的 audit

**质检（quality check）**：
多审查模型对「实现是否干净、可靠、可维护」的只读审查；`/review` 是其独立入口。
_Avoid_: code review（用户文案）, QA

**顾问（advisor）**：
`modelRoles.advisor` 兼任的两个职责：对齐与计划生成；检查停滞时的方向咨询（自动 2/4/6/8 轮或手动 `/advisor`）。只有这一个名字，两职一角。
_Avoid_: 计划模型, planner, consultant

**执行模型（executor）**：
实际写代码的模型，进入执行时切换一次。

**审查模型（reviewer）**：
`modelRoles.reviewers` 数组中做验收与质检的模型，永远没有 `write`/`edit`。「审查」一词专指 reviewer 的行为（如只读审查、交叉审查），不作验收或质检的同义词。

## 状态与事实源

**canonical 状态**：
插件 builder 组装的 `flow.json`，运行态唯一事实源；模型只写 `flow.semantic.json` 与 markdown，禁止直接写它。

**alignment.json**：
生成计划前的对齐 checkpoint，与 `flow.json` 同目录；生成成功后并入 `meta.alignment` 并删除。

**attention**：
记录「需要用户接管」的异常事实的 `flow.json` 字段；`/flow go` 推进前清空。
_Avoid_: alert, warning

**BLOCKED**：
执行模型声明无法继续的协议词（`BLOCKED: <待办>`），触发暂停 + 接管，不送检查。

**handoff**：
并行 worker 因 BLOCKED 退出时写入 artifact 的接管凭证。

**completion**：
worker 完成一步后写入 artifact 的完成凭证。

**completionCursor**：
完成链恢复的内部路由字段，用户界面不展示。

**outbox**：
Flow 锁被占用时持久化的待写事实，锁释放后补投。

**收口（finalize）**：
一步或整个 Flow 结束时的状态提交与清理事务。
_Avoid_: 收尾

## 并行执行

**worker**：
父控制台私有启动、执行单个步骤的子进程；唯一运行态是 Flow 根目录 `Gx-worker.json`（schema v3），worker 进程是唯一写 owner。用户文案保持 Worker 不翻译。
_Avoid_: 工作进程, 子任务

**parallelRun**：
并行批次的运行时字段，由插件维护，模型不写。

**lane**：
并行控制台里每个 worker 的显示轨道。

**fan-in**：
并行批次结果的收口聚合。

**writeScope**：
步骤声明的写文件范围，调度器据此计算可并行的 ready batch。

## 检查机制

**检查（check）**：
验收与质检的统称；「检查停滞自愈」「检查 prompt」中的「检查」均指此义。

**Context Evidence**：
从 session branch 原始事件临时派生的证据包；`requirements` 投影给计划生成，`review` 投影给验收/质检/顾问共用。顾问建议明确排除在外。

**检查停滞自愈**：
检查连续未通过时的固定节奏：3 轮注入修订许可（仅 Flow）、2/4/6/8 轮自动咨询顾问、10 轮强制 `paused` + attention。

**修订许可**：
连续失败后注入执行模型的许可，允许其修订计划而非硬修。

**收口闸门**：
验收前的隐藏延续：自然结束但计划仍有未完成项时先顶回执行模型，再次结束才放行验收。

**review-checkpoint**：
独立 `/review` 的恢复事实源（v2：`active/round/phase`），存于 session，不落 `.flow/`。

## 界面

**活动框**：
活动态的固定状态框（执行中/验收中/质检中等），宽 ≥60 列显示火焰装饰。
_Avoid_: spinner（框级）, banner

**结果卡**：
一轮检查或咨询结束后的结构化结果卡片。
