<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/logo.png" width="96" alt="Pi Flow logo">
</p>

<h1 align="center">Pi Flow</h1>

<p align="center">
  <strong>Loop Engineering 的最佳实践，指数级提升 Agent 交付质量。<br>
  零工具注入 — 尊重 Pi 极简哲学，经验证的优雅实现。</strong><br>
  Best practice for Loop Engineering. Exponentially improve Agent delivery quality.<br>
  Zero tool injection — respects Pi's minimalist philosophy, proven elegant implementation.
</p>

<p align="center">
  <a href="#english">🇺🇸 English</a> · <a href="#中文">🇨🇳 中文</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@surgee/pi-flow"><img alt="npm" src="https://img.shields.io/npm/v/%40surgee%2Fpi-flow"></a>
  <a href="https://github.com/Suge8/pi-flow/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Suge8/pi-flow/ci.yml?branch=main"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
</p>

---

## English

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/hero.png" alt="Pi Flow hero banner">
</p>

Agents write great code, but long tasks often die on four things:
1. Plans miss key details — not what you actually need
2. Claims "done", but it's hallucinated
3. Poor delivery quality
4. Different models excel at different roles; one model doing everything underperforms

Pi Flow solves this: multi-round alignment → executable plan → live HTML report → multi-model adversarial checks → loop until quality ships.

### Comparison

| | Pi Flow | Codex | Claude |
|---|---|---|---|
| Approach | Prompt injection · zero tool, pure UI prompt recognition | ❌ Tool injection | ❌ Tool injection |
| Alignment | Clarify first, then plan | ❌ | ❌ |
| Model roles | Separate planning, execution, and review models | ❌ | ❌ |
| Acceptance | Multi-model cross-review, per-requirement verification | ❌ Player and referee | ❌ Small model |
| Evidence | Requirements + plan + code + output + multi-model opinions | ❌ Player and referee | ❌ Conversation only |
| Quality | Multi-agent read-only review, iterative optimization | ❌ | ❌ |
| Orchestration | `/flow` chains + per-goal acceptance | ❌ | ❌ |
| Reports | Live HTML report, step-level, traceable | ❌ | ❌ |

### Highlights

- **Zero tool injection** — Pure prompt recognition, no agent tools, respects Pi's runtime
- **Clarification-first** — Clarifies before planning, unlike other agents that go with assumptions
- **Role-based models** — Separate planning, execution, and review models, so each model does what it is best at
- **Multi-model acceptance** — Cross-review, per-requirement verification, fewer false "done"s
- **Multi-agent review** — Read-only review, iterative optimization, no shortcuts
- **Live reports** — HTML step-level progress, runs locally, always traceable

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/report-en.png" alt="Pi Flow live HTML report">
</p>
<p align="center"><sub>Report screenshot</sub></p>

### Install

```bash
pi install npm:@surgee/pi-flow
```

If Pi is already running, restart it or run:

```text
/reload
```

Requires Node.js `>=22.19.0`.

### Configuration

Copy the template for local overrides:

```bash
cp config.template.json config.json
```

**Model roles**

`config.template.json` already includes `modelRoles`. Keep a role as `"current"` to use the model currently selected in Pi, or pin it to a specific `{ "model", "thinking" }`.

```json
{
  "modelRoles": {
    "planner": { "model": "52mx/free/glm-5.2", "thinking": "xhigh" },
    "executor": { "model": "openai-codex/gpt-5.5", "thinking": "xhigh" },
    "reviewers": [
      { "model": "openai-codex/gpt-5.4", "thinking": "high" }
    ]
  }
}
```

- `planner` — alignment and plan generation
- `executor` — implementation entry
- `reviewers` — completion acceptance and quality checks
- `planner` / `executor` may also be `"current"`

**Recommended role models**

- **Planning** — Claude Fable 5, Claude Ops 4.8, GLM 5.2
- **Execution** — Claude Fable 5, GPT-5.5
- **Review** — GPT-5.2, GPT-5.3 Codex, GPT-5.4, GLM 5.2, Kimi K2.7, DeepSeek V4, GPT-5.4 Mini
- [Cost-performance benchmark →](https://factory.ai/news/code-review-benchmark)

<details>
<summary>Common keys</summary>

| Key | Value | Description |
|---|---|---|
| `generation.align` | `"ask"` / `"yes"` / `"no"` | `ask` = ask each time; `yes` = always align; `no` = generate directly |
| `modelRoles.planner` | `"current"` / role model | Model used for alignment and plan generation. Role model must use exact `provider/model` plus `thinking` |
| `modelRoles.executor` | `"current"` / role model | Model used once when execution starts. Pi keeps the selected model afterward |
| `modelRoles.reviewers` | model array | Models for acceptance and quality checks, each with `model` and `thinking` (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`) |
| `models` | model array | Legacy alias for `modelRoles.reviewers`; do not set both |
| `runner.command` | `"pi"` | Child process CLI command |
| `runner.tools` | tool name array | Tools available to child process, e.g. `["read","bash","grep"]` |
| `runner.timeoutMs` | milliseconds | Per-step timeout, default `1200000` (20 min) |
| `runner.serviceTier` | `"default"` / `"priority"` | API service tier |
| `acceptance.enabled` | `true` / `false` | Toggle completion acceptance |
| `quality.enabled` | `true` / `false` | Toggle quality checks |
| `quality.mode` | `"autoFix"` / `"manual"` | `autoFix` = auto-fix on failure; `manual` = report only |

</details>

### 5 seconds to start

```text
/flow          # Plan → execute → accept → quality check; single-step or multi-step automatically
/review        # Quality-check AI operations
```

<details>
<summary>Advanced usage</summary>

Inline request:

```text
/flow Fix login state after refresh
/flow Refactor the login flow in safe steps
```

Markdown request file:

```text
/flow task.md
/flow plan.md
```

Continue, cancel, status:

```text
/flow continue | cancel | status
```

Target a Flow by id (short id preferred; full id also works):

```text
/flow status F4
/flow start F4
/flow continue F4
```

Multiple Flows can run in one project. Bare `continue` / `cancel` / `status` targets the current Flow or the only running Flow; otherwise Pi asks for a short id.

</details>

### Delivery loop

```text
Request → plan → execution → completion acceptance → quality check → close
                           ↘ keep fixing if a check fails ↙
```

- `/flow` — one entrance for focused tasks and larger multi-step work; each step has plan / accept / report / handoff.
- Reports run at `http://127.0.0.1:<port>`.
- Completion acceptance: "Is the requirement truly done?"
- Quality checks: "Is the implementation clean, reliable, and maintainable?"

### Co-create

Pi Flow is young and opinionated. If you care about more reliable agent delivery loops, ideas, issues, and focused PRs are welcome.

- Discuss — open an issue with the workflow you want to improve
- Contribute — read [CONTRIBUTING.md](CONTRIBUTING.md) and keep changes small

---

## 中文

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/hero-zh.png" alt="Pi Flow 中文 hero banner">
</p>

Agent 很会写代码，但长任务常死在四件事：
1. 计划遗漏关键信息，不符合你真正的需求
2. 说自己做完了，实际上是幻觉
3. 完成质量差
4. 不同模型擅长不同角色，单模型硬扛效果不佳

Pi Flow 解决这个问题：多轮对齐需求 → 可执行计划 → 实时报告 → 多模型对抗检查 → 循环修复直至高质量交付

### 对比

| | Pi Flow | Codex | Claude |
|---|---|---|---|
| 实现 | Prompt 注入 · 零工具，纯 UI 提示符识别 | ❌ 工具注入 | ❌ 工具注入 |
| 对齐 | 先追问澄清，再生成计划 | ❌ | ❌ |
| 角色模型 | 计划 / 执行 / 审查分别指定模型 | ❌ | ❌ |
| 验收 | 多模型交叉审查，按需求逐项反查 | ❌ 既当球员又当裁判 | ❌ 小模型 |
| 证据 | 需求 + 计划 + 代码 + 输出 + 多模型意见 | ❌ 既当球员又当裁判 | ❌ 只看对话 |
| 质量 | 多代理只读审查，循环优化 | ❌ | ❌ |
| 编排 | `/flow` 串联 + 逐目标验收 | ❌ | ❌ |
| 报告 | 实时 HTML 报告，步骤级可回溯 | ❌ | ❌ |

### 亮点

- **零工具注入** — 纯 Prompt 识别，不加 agent tool，不侵入 Pi 运行时
- **追问对齐** — 先澄清再计划，不像其他 Agents 靠自己的想当然发挥
- **角色模型** — 计划、执行、审查分别指定模型，让合适的模型做擅长的事
- **多模型验收** — 交叉审查，按需求反查，减少"假完成"
- **多代理审查** — 只读审查，循环优化，不偷懒、不遗漏
- **实时报告** — HTML 步骤级进度，本地运行，随时回溯

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/usage-1.png" width="23%" alt="使用截图 1">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/usage-2.png" width="23%" alt="使用截图 2">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/usage-3.png" width="23%" alt="使用截图 3">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/usage-4.png" width="23%" alt="使用截图 4">
</p>
<p align="center"><sub>典型场景</sub></p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/report.png" alt="Pi Flow 实时 HTML 报告">
</p>
<p align="center"><sub>报告截图</sub></p>

### 安装

```bash
pi install npm:@surgee/pi-flow
```

如果 Pi 已经在运行，重启或执行：

```text
/reload
```

需要 Node.js `>=22.19.0`。

### 配置

复制模板作为本机配置：

```bash
cp config.template.json config.json
```

**模型角色**

`config.template.json` 已包含 `modelRoles`。某个角色写 `"current"` 就沿用 Pi 当前模型；写 `{ "model", "thinking" }` 就固定到指定模型。

```json
{
  "modelRoles": {
    "planner": { "model": "52mx/free/glm-5.2", "thinking": "xhigh" },
    "executor": { "model": "openai-codex/gpt-5.5", "thinking": "xhigh" },
    "reviewers": [
      { "model": "openai-codex/gpt-5.4", "thinking": "high" }
    ]
  }
}
```

- `planner`：追问对齐、生成计划
- `executor`：进入执行时使用
- `reviewers`：完成验收和质量检查
- `planner` / `executor` 也可以写 `"current"`

**推荐角色模型**

- **计划模型** — Claude Fable 5、Claude Ops 4.8、GLM 5.2
- **执行模型** — Claude Fable 5、GPT-5.5
- **审查模型** — GPT-5.2、GPT-5.3 Codex、GPT-5.4、GLM 5.2、Kimi K2.7、DeepSeek V4、GPT-5.4 Mini
- [综合性价比 benchmark →](https://factory.ai/news/code-review-benchmark)

<details>
<summary>常用配置</summary>

| 配置 | 值 | 说明 |
|---|---|---|
| `generation.align` | `"ask"` / `"yes"` / `"no"` | `ask`＝每次询问；`yes`＝总是先对齐；`no`＝直接生成 |
| `modelRoles.planner` | `"current"` / 角色模型 | 对齐和生成计划时使用；角色模型必须写精确 `provider/model` 和 `thinking` |
| `modelRoles.executor` | `"current"` / 角色模型 | 执行开始时切一次；之后保留 Pi 当前选择 |
| `modelRoles.reviewers` | 模型数组 | 完成验收和质量检查用的模型，每项含 `model` 和 `thinking`（`off`/`minimal`/`low`/`medium`/`high`/`xhigh`） |
| `models` | 模型数组 | 旧配置别名，等同 `modelRoles.reviewers`；不要同时配置 |
| `runner.command` | `"pi"` | 子进程 CLI 命令 |
| `runner.tools` | 工具名数组 | 子进程可用工具，如 `["read","bash","grep"]` |
| `runner.timeoutMs` | 毫秒数 | 单步超时，默认 `1200000`（20 分钟） |
| `runner.serviceTier` | `"default"` / `"priority"` | API 服务等级 |
| `acceptance.enabled` | `true` / `false` | 开关完成验收 |
| `quality.enabled` | `true` / `false` | 开关质量检查 |
| `quality.mode` | `"autoFix"` / `"manual"` | `autoFix`＝不过自动修；`manual`＝只报告 |

</details>

### 5 秒开始

```text
/flow          # 计划 → 执行 → 验收 → 质量检查；自动判断单步或多步
/review        # 对 AI 操作做质量检查
```

<details>
<summary>高级用法</summary>

直接带需求：

```text
/flow 修复刷新后的登录状态
/flow 重构登录流程，分步骤安全推进
```

把 md 文件作为需求：

```text
/flow task.md
/flow plan.md
```

继续、取消、状态：

```text
/flow continue | cancel | status
```

按 id 指定 Flow（优先使用短 id，完整 id 仍可用）：

```text
/flow status F4
/flow start F4
/flow continue F4
```

同一项目可同时运行多个 Flow。裸 `continue` / `cancel` / `status` 会路由到当前 Flow 或唯一运行中的 Flow；多义时 Pi 会要求指定短 id。

</details>

### 工作流程

```text
对齐 → 计划 → 执行 → 完成验收 → 质量检查 → 收口
                   ↘ 不通过则循环修复 ↙
```

- 对齐："多轮问答全面挖掘你的需求"
- 完成验收："确保任务完整完成，无偷懒"
- 质量检查："确保实现干净、可靠、可维护"

### 共创

Pi Flow 还在快速迭代。如果你也在探索更可靠的 Agent 循环，欢迎一起打磨。

- 讨论 — 用 issue 描述你的工作流和痛点
- 贡献 — 先读 [CONTRIBUTING.md](CONTRIBUTING.md)，保持改动小而清晰

---

## License

Apache-2.0. See [`LICENSE`](LICENSE).
