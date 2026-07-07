你正在修正已有 Pi Flow 计划草稿的校验错误。只改当前计划草稿文件，不改业务代码。

目标：根据校验错误，修正 `{{flowPath}}` 下的 `flow.semantic.json` 和 Goal markdown 文件，直到草稿可由插件组装为合格 Flow。

规则：
- 只修正或补全当前 Flow 计划草稿。
- 不要写业务代码、配置、测试、README、docs。
- 只改 `flow.semantic.json` 和 `G<N>-*.md`；不要创建、手写或修改 canonical `flow.json`，也不要补全插件运行态字段；完整 Flow 状态由插件组装和校验。
- 如果错误能通过阅读代码库、文档或现有 `.flow` 文件回答，就自己查。
- 不要追问用户；缺失内容用原始需求和现有 draft 推导出最小可执行计划。
- 输出语言必须使用当前 language：`{{language}}`。`zh` 用中文 `title`、Goal 标题和 Goal 文件内容；`en` 用英文。
- 每个 Goal 必须足够细，能在单独 Goal session 中完成。
- `flow.semantic.json` 必须是 JSON 对象，字段只需要 `title` 和 `goals`；不要写 `source`、`schemaVersion`、`status`、`currentGoal`、`parallelRun`、`checks` 等运行态字段。
- `goals` 数组顺序就是执行顺序；每项只写 `title`、`role`、`file`。不要写 `index`，插件会按顺序重算 0-based index。
- 单步 Flow 只允许 1 个 `normal` Goal，不写 final acceptance；多步 Flow 的每个非最终 Goal 必须是 `normal`，最后一个 Goal 必须是 `final_acceptance`。
- 每个 Goal 文件必须有 Objective / Scope / Steps / Success Criteria / Verification / Notes / Handoff。
- 每个 Goal 的 Success Criteria 必须是普通 bullet，禁止 checkbox；完成状态和证据写入 Verification / Handoff，不要写入 Success Criteria。
- 每个 Goal 的 Steps 和 Verification 都必须使用 checkbox，初始只允许 `[ ]`；Verification 必须有命令或明确人工验证步骤。
- Steps 是运行时 Todo，不是流水账小任务或粗略阶段；每个 Goal 推荐 2–10 个用户可理解的里程碑，小任务可少于 2 个，超过 10 个优先拆 Goal 或合并过细步骤。每项必须可单独完成、完成后能给出证据并更新状态。
- Steps 每项写成 `- [ ] **短标题**：技术细节`：短标题 ≤20 字、用户视角人话；技术细节给执行 AI，可精确技术化。
- 只有多步 Flow 才必须有 final acceptance Goal，用于读取所有 Handoff、复核 criteriaChanged、跑全局验证并收口；单步 Flow 不写 final acceptance。
- 不要生成或测试 `flow.html`；插件会在结构校验通过后渲染 HTML。
- 修完 `flow.semantic.json` 和 Goal markdown 后即可结束；插件会重新组装并运行结构校验（`{{validateCommand}} {{flowPath}}`）。不要手动模拟校验结果。
- 若需要写完成后的用户下一步，统一写 `/flow go F<N>`；需要停止时写 `/flow stop F<N>`，不要创造其它控制入口。
- 如果错误来自 canonical `flow.json` 或运行态字段，不要手动补字段；优先修复语义草稿和 Goal markdown，让插件重新组装。

当前校验错误：
{{errors}}

原始需求：
{{originalRequest}}

Flow 路径：
{{flowPath}}

当前 language：
{{language}}
