你正在修正已有 Pi Goal 计划草稿的校验错误。只改当前计划草稿文件，不改业务代码。

目标：根据校验错误，修正 `{{goalPath}}` 下的 `goal.semantic.json` 和 `plan.md`，直到草稿可由插件组装为合格计划。

规则：
- 只修正或补全当前 Goal 计划草稿。
- 不要写业务代码、配置、测试、README、docs。
- 只改 `goal.semantic.json` 和 `plan.md`；不要创建、手写或修改 canonical `goal.json`，也不要补全插件运行态字段；完整 `goal.json` 由插件组装并校验。
- 如果错误能通过阅读代码库、文档或现有 `.flow` 文件回答，就自己查。
- 不要追问用户；缺失内容用原始需求和现有 draft 推导出最小可执行计划。
- 输出语言必须使用当前 language：`{{language}}`。`zh` 用中文 `title`、`plan.md` 和对用户说明；`en` 用英文。
- Goal 必须能在单个 session 内完成；如果明显太大，在 Notes 中标记建议改用 `/flow`，仍保持 draft 可组装校验。
- `goal.semantic.json` 必须是 JSON 对象，字段只需要 `title` 和 `source`；`title` 是非空字符串，`source` 保留为对象（可写 `{}`），真实来源由插件按当前请求覆盖。
- plan.md 必须有 Objective / Scope / Steps / Success Criteria / Verification / Notes / Outcome。
- Success Criteria 必须是普通 bullet，禁止 checkbox；完成状态和证据写入 Verification / Outcome，不要写入 Success Criteria。
- Steps 和 Verification 都必须使用 checkbox，初始只允许 `[ ]`；Verification 必须有验证命令或明确人工验证步骤。
- Steps 是运行时 Todo，不是粗略阶段；推荐 3–12 个小步骤，小任务可少于 3 个，超过 12 个优先改用 `/flow` 或合并过细步骤。每项必须可单独完成、可立刻更新状态，避免“实现功能 / 完成开发 / 最终检查”这种只能最后才完成的大步骤。
- Steps 每项写成 `- [ ] **短标题**：技术细节`：短标题 ≤20 字、用户视角人话；技术细节给执行 AI，可精确技术化。
- 不要生成或测试 `goal.html`；插件会在结构校验通过后渲染 HTML。
- 修完 `goal.semantic.json` 和 `plan.md` 后即可结束；插件会重新组装并运行结构校验（`{{validateCommand}} {{goalPath}}`）。不要手动模拟校验结果。
- 如果错误来自插件运行态字段，不要手动补字段；优先修复语义草稿和计划正文，让插件重新处理。

当前校验错误：
{{errors}}

原始需求：
{{originalRequest}}

Goal 路径：
{{goalPath}}

当前 language：
{{language}}
