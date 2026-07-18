## 草稿格式契约（生成与修复共用）

`flow.semantic.json`：
- 必须是 JSON 对象，顶层字段只需要 `title` 和 `goals`；不要写 `source`、`schemaVersion`、`status`、`currentGoal`、`parallelRun`、`checks` 等运行态字段。
- `goals` 数组顺序就是执行顺序；每项只写 `title`、`role`、`file`，以及可选的 `dependsOn` / `writeScope`。不要写 `index`，插件会按顺序重算 0-based index。
- `dependsOn` 可选，值为先序 Goal 的 0-based index 数组；不写时默认依赖前一个 Goal；明确无前置依赖时写 `[]`。
- `writeScope` 可选，只允许 `**` 或以 `/**` 结尾的相对目录 glob（如 `src/api/**`）；禁止具体文件和其他 glob 语法，拿不准就省略，调度器会保守串行化。
- 除 final acceptance 外每个 Goal 的 `role` 必须是 `normal`；`final_acceptance` 最多出现一次且只能是最后一个 Goal；禁止使用 `implementation`。
- 每个 `file` 必须是当前 Flow 目录内的相对路径，对应的 Goal markdown 文件必须存在；中文标题用 `G<N>-goal.md`，英文标题可 slug（如 `G1-login-ui.md`）。

`flow.semantic.json` 最小骨架（含可选并行字段示例）：

```json
{
  "title": "任务标题",
  "goals": [
    { "title": "第一个 Goal", "role": "normal", "file": "G1-goal.md", "dependsOn": [], "writeScope": ["src/api/**"] },
    { "title": "最终验收", "role": "final_acceptance", "file": "G2-final-acceptance.md", "dependsOn": [0] }
  ]
}
```

Goal markdown：
- 每个 Goal 必须足够细，能在单独 Goal session 中完成；文件必须包含 `Objective / Scope / Steps / Success Criteria / Verification / Notes / Handoff` 七段；`Handoff` 标题必须有，内容可空。
- `Success Criteria` 必须是普通 bullet，禁止 checkbox；完成状态和证据写入 `Verification` / `Handoff`，不要写入 `Success Criteria`。
- `Success Criteria` 必须有界：写成有限可枚举的验证集（具体文件、命令、场景），禁止全称量词式开放保证（如「不存在任何绕过」「任意输入都…」）；标准之间、标准与 Scope 不得互斥。
- `Steps` 和 `Verification` 都必须使用 checkbox，初始只允许 `[ ]`；`Verification` 必须有可客观判断的验证命令或明确人工验证步骤（例：`- [ ] \`npm test -- --testPathPattern=auth\` exit 0`，避免「检查功能是否正常」这种无法客观判断的步骤）。
- `Steps` 是运行时 Todo，不是流水账小任务或粗略阶段；每个 Goal 推荐 2–10 个用户可理解的里程碑，小任务可少于 2 个，超过 10 个优先拆 Goal 或合并过细步骤；每项必须可单独完成、完成后能在 `Verification` / `Handoff` 给出证据并更新状态，避免“实现功能 / 完成开发 / 最终检查”这种只能最后才完成的大步骤。
- `Steps` 每项写成 `- [ ] **短标题**：技术细节`：短标题 ≤20 字、用户视角人话；技术细节给执行 AI，可精确技术化。
  （例：`- [ ] **登录令牌可验证**：在 auth.ts 实现 verifyToken(token)，处理过期和签名错误，返回解析后的 payload`）

final acceptance：
- 可选收口 Goal，默认不生成：串行 Flow 把全局验证与 docs / AGENTS.md 收口写进最后一个 `normal` Goal 的 Steps；只有存在并行批次、或没有任何单一 Goal 能覆盖全部集成面时才生成。
- 生成时必须是最后一个 Goal 且最多 1 个，文件名用实际序号 + `final-acceptance`（如 `G3-final-acceptance.md`）。它必须读取所有 Handoff、复核 criteriaChanged、跑全局验证、检查 docs / AGENTS.md 是否需要更新并收口，Steps 必须覆盖所有先序 Goal 的交付物。

边界与收尾：
- 只在 `{{flowPath}}` 内写 `flow.semantic.json` 和 `G<N>-*.md`；不要创建、手写或修改 canonical `flow.json` / 插件运行态字段（`parallelRun`、`checks` 等），插件会组装完整 Flow 状态并校验。Flow 目录已由插件分配为裸编号 `F<N>`，不要新建其他 Flow 目录，不要使用 `F<N>-slug`。
- 禁止手写或测试 `flow.html`；HTML 由插件在校验通过后用内置渲染器生成。不要把 HTML 报告模板或候选项结构复制进 Goal 文件。
- 输出语言必须使用当前 language：`{{language}}`。`zh` 用中文 `title`、Goal 标题和 Goal 文件内容；`en` 用英文。
- 写完 `flow.semantic.json` 和 Goal markdown 后即可结束；插件会组装并运行结构校验（`{{validateCommand}} {{flowPath}}`）。不要用“已自检”替代真实工具输出，也不要手动模拟插件校验结果。
- 若需要写完成后的用户下一步，统一写 `/flow go F<N>`；需要停止时写 `/flow stop F<N>`，不要创造其它控制入口。
