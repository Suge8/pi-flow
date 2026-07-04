# 运行契约

只记录当前实现。不要写计划、历史留档、backlog。改行为时同步更新本文档和 smoke。

## 状态

- `goal.json` / `flow.json` 是唯一规范状态源，当前 `schemaVersion: 5`。
- 模型只写 `goal.semantic.json` / `flow.semantic.json` 和计划 Markdown；builder 组装规范状态。
- 模型不写 `checks`、`completionCursor`、`goal.html`、`flow.html`。
- `checks.acceptance` = 完成验收；`checks.quality` = 质量检查；两者结构都是 `enabled / rounds / active`。
- `completionCursor` 只用于内部恢复路由，用户界面不展示。
- Flow 总用时只读 `startedAt`：草稿为 `null`，运行态必须是时间戳；不能用 `createdAt` 兜底。

## 计划 Markdown Todo

计划 Markdown 是执行 Todo、工作记忆和 HTML 实时进度来源。

```text
[ ] 待做
[~] 进行中
[!] 阻塞
[x] 完成
```

- `Steps` 和 `Verification` 必须是 checkbox 列表。
- 执行或继续前必须先读计划 Markdown。
- 开始一项前改为 `[~]`；完成真实工作并有证据后改为 `[x]`；阻塞时改为 `[!]`。
- 阻塞原因、已尝试动作、跳过原因、恢复路径写入 `Outcome` / `Handoff`。
- 禁止最后集中补 checkbox。
- 执行中只允许维护 `Steps`；不得改 `Objective` / `Scope` / `Success Criteria`。

## 角色模型

- `modelRoles.planner` 用于 `/goal` / `/flow` 对齐、生成、repair 入口；`modelRoles.executor` 用于 `/goal start` 与 Flow 新步骤启动入口。
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
