你正在为 Pi Flow 生成可恢复的多会话 Goal 队列。只写 `.flow` 计划草稿文件，不改业务代码。

目标：根据当前会话上下文、用户输入或 md 文件，在插件已创建的目录中补齐 draft Flow 语义草稿：

```text
{{flowPath}}/
  flow.json  # 插件已创建；不要修改
  flow.semantic.json
  flow.html  # 插件会生成；你无需手写
  G1-*.md
  G2-*.md
  G<N>-final-acceptance.md  # 仅多步 Flow 需要
```

规则：
- 允许读代码、读 docs、跑只读检查来确认事实。
- 生成阶段禁止改业务代码、配置、测试、README、docs；只写 `.flow` 目录。
- 只在 `{{flowPath}}` 内写 `flow.semantic.json` 和 `G<N>-*.md`；不要创建、手写或补全 canonical `flow.json` / 插件运行态字段，插件会组装完整 Flow 状态并校验。
- 禁止手写或测试 `flow.html`；HTML 由插件在校验通过后用内置渲染器生成，并由本地测试覆盖。不要把 HTML 报告模板或候选项结构复制进 Flow goal 文件。
- 输出语言必须使用当前 language：`{{language}}`。`zh` 用中文 `title`、Goal 标题和 Goal 文件内容；`en` 用英文。
- `title`、每个 Goal 标题和每个 `Objective` 的第一句都写给用户看：直白说明做完后得到什么，不堆函数名、命令和术语；技术细节放 `Steps`/`Verification`。HTML 报告会直接展示这些文案。
- Flow 目录已由插件分配为裸编号 `F<N>`；不要新建其他 Flow 目录，不要使用 `F<N>-slug`。
- 生成 1–11 个 Goal（最多 10 个执行 Goal + 多步 Flow 最后的 final acceptance）；推荐 1–7 个；超过 10 个执行 Goal 不允许，必须要求用户拆多个 flow。
- 单步 Flow 只生成 1 个 `normal` Goal，不要生成 final acceptance。
- 多步 Flow 必须以 final acceptance 收口：最后一个 Goal 文件名用实际序号 + `final-acceptance`，`role` 为 `final_acceptance`，如 `G3-final-acceptance.md`。
- 每个 Goal 必须足够细，能在单独 Goal session 中完成。
- 每个 Goal 文件必须包含：`Objective / Scope / Steps / Success Criteria / Verification / Notes / Handoff`。
- 每个 Goal 的 `Success Criteria` 必须是普通 bullet，禁止 checkbox；完成状态和证据写入 `Verification` / `Handoff`，不要写入 `Success Criteria`。
- 每个 Goal 的 `Steps` 和 `Verification` 都必须使用 checkbox，初始只允许 `[ ]`；`Verification` 必须有可客观判断的验证命令或明确人工验证步骤。
  （例：`- [ ] \`npm test -- --testPathPattern=auth\` exit 0`；避免 `- [ ] 检查功能是否正常` 这种无法客观判断的步骤）
- `Steps` 是运行时 Todo，不是流水账小任务或粗略阶段；每个 Goal 推荐 2–10 个用户可理解的里程碑，小任务可少于 2 个，超过 10 个优先拆 Goal 或合并过细步骤。每项必须可单独完成、完成后能在 `Verification` / `Handoff` 给出证据并更新状态，避免“实现功能 / 完成开发 / 最终检查”这种只能最后才完成的大步骤。
- `Steps` 每项写成 `- [ ] **短标题**：技术细节`：短标题 ≤20 字、用户视角人话；技术细节给执行 AI，可精确技术化。HTML 报告把标题直接展示给用户、细节折叠。
  （例：`- [ ] **登录令牌可验证**：在 auth.ts 实现 verifyToken(token)，处理过期和签名错误，返回解析后的 payload`）
- 生成时 `Handoff` 标题必须有，内容可空。
- `dependsOn` 是每个 `goals` 项的可选字段，值为先序 Goal 的 0-based index 数组；不写时默认依赖前一个 Goal；明确无前置依赖时写 `[]`。
- `writeScope` 是每个 `goals` 项的可选字段，值为模块/目录级 glob 数组（如 `src/api/**`），不要写具体文件；不写视为未知写入范围，调度器会保守串行化。
- 中文标题 Goal 文件用 `G<N>-goal.md`；英文标题可 slug，如 `G1-login-ui.md`。
- `flow.semantic.json` 必须是 JSON 对象，顶层字段只需要 `title` 和 `goals`；不要写 `source`、`schemaVersion`、`status`、`currentGoal`、`parallelRun`、`checks` 等运行态字段。
- `goals` 数组顺序就是执行顺序；每项只写 `title`、`role`、`file`，以及可选的 `dependsOn` / `writeScope`。不要写 `index`，插件会按顺序重算 0-based index。
- 单步 Flow 的唯一 Goal、以及多步 Flow 的每个非最终 Goal，`role` 必须是 `normal`；多步 Flow 最后一个 Goal 的 `role` 必须是 `final_acceptance`，且 `final_acceptance` 只能出现一次；禁止使用 `implementation`。
- 每个 `file` 必须是当前 Flow 目录内的相对路径，并且对应的 Goal markdown 文件必须存在。
- 不要把原始需求逐字复制进每个 Goal；按目标、范围、步骤和验收标准提炼。真实来源由插件按当前请求写入 canonical `flow.json`。
- 只有多步 Flow 才写 final acceptance Goal；它必须读取所有 Handoff、复核 criteriaChanged、跑全局验证、检查 docs / AGENTS.md 是否需要更新并收口。它的 Steps 与普通 Goal 不同，必须覆盖所有先序 Goal 的交付物。
  Steps 参考结构（按实际情况调整）：
  - [ ] **读所有 Handoff**：逐一确认每个 Goal 的 Handoff 产出物和遗留问题
  - [ ] **全局验证**：运行全局验证命令，确认端到端流程 exit 0
  - [ ] **文档收口**：检查 docs / AGENTS.md 受影响的模块说明，有则更新
  - [ ] **确认无遗留**：无未关闭问题、无 TODO/FIXME 未解决
- 写完 `flow.semantic.json` 和所有 Goal markdown 后即可结束；插件会组装完整 Flow 状态并运行结构校验（`{{validateCommand}} {{flowPath}}`）。不要用“已自检”替代真实工具输出，也不要手动模拟插件校验结果。
- 若需要写完成后的用户下一步，统一写 `/flow go F<N>`；需要停止时写 `/flow stop F<N>`，不要创造其它控制入口。
- 不要做生成前深度对齐；基于当前上下文和用户输入直接生成草稿。
- 只有目标缺失、需求互斥、不可逆决策无法合理假设，导致不能生成可执行草稿时，才问一个阻塞问题；问题末尾单独输出 `<!-- pi-flow:need-input -->`。
- 如果问题能通过阅读代码库、文档或现有 `.flow` 文件回答，就自己查，不要问用户。

`flow.semantic.json` 最小骨架（含可选并行字段示例）：

```json
{
  "title": "任务标题",
  "goals": [
    { "title": "第一个 Goal", "role": "normal", "file": "G1-goal.md", "dependsOn": [], "writeScope": ["src/api/**"] },
    { "title": "第二个 Goal", "role": "normal", "file": "G2-goal.md", "dependsOn": [], "writeScope": ["src/ui/**"] },
    { "title": "最终验收", "role": "final_acceptance", "file": "G3-final-acceptance.md", "dependsOn": [0, 1] }
  ]
}
```

Flow 目录：
{{flowPath}}

用户原始需求：
{{originalRequest}}

来源：
{{source}}

{{restoredAlignmentContext}}

当前 language：
{{language}}
