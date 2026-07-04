<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/logo.png" width="96" alt="Pi Flow logo">
</p>

<h1 align="center">Pi Flow</h1>

<p align="center">
  <strong>Loop Engineering 的最佳实践，指数级提升 Agent 交付质量。<br>
  零工具注入，纯 Prompt 识别 — 尊重 PI 极简哲学，经验证的优雅实现。</strong><br>
  Best practice for Loop Engineering. Exponentially improve Agent delivery quality.<br>
  Zero tool injection, pure prompt recognition — respects Pi's minimalist philosophy, proven elegant implementation.
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
1. Unclear plan
2. Plan misses key details — doesn't match what you actually need
3. Claims "done" but it's hallucinated
4. Poor delivery quality

Pi Flow solves this: multi-round alignment → executable plan → live HTML report → multi-model adversarial checks → loop until quality ships.

### Comparison

| | Pi Flow | Codex | Claude |
|---|---|---|---|
| Approach | Prompt injection · zero tool, pure UI prompt recognition | ❌ Tool injection | ❌ Tool injection |
| Alignment | Clarify first, then plan | ❌ | ❌ |
| Acceptance | Multi-model cross-review, per-requirement verification | ❌ Player and referee | ❌ Small model |
| Evidence | Requirements + plan + code + output + multi-model opinions | ❌ Player and referee | ❌ Conversation only |
| Quality | Multi-agent read-only review, iterative optimization | ❌ | ❌ |
| Orchestration | `/flow` chains + per-goal acceptance | ❌ | ❌ |
| Reports | Live HTML report, step-level, traceable | ❌ | ❌ |

### Highlights

- **Zero tool injection** — Pure prompt recognition, no agent tools, respects Pi's runtime
- **Clarification-first** — Clarifies before planning, unlike other agents that go with assumptions
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

**Recommended review models**

- **Large** — GPT-5.2, GPT-5.3 Codex, GPT-5.4
- **Budget** — GLM-5.2, Kimi K2.7, DeepSeek V4, GPT-5.3-Codex-Spark, GPT-5.4 Mini
- [Cost-performance benchmark →](https://factory.ai/news/code-review-benchmark)

<details>
<summary>Common keys</summary>

| Key | Value | Description |
|---|---|---|
| `generation.align` | `"ask"` / `"skip"` | `ask` = align first; `skip` = generate directly |
| `models` | model array | Models for acceptance and quality checks, each with `model` and `thinking` (`low`/`medium`/`high`) |
| `runner.command` | `"pi"` | Child process CLI command |
| `runner.tools` | tool name array | Tools available to child process, e.g. `["read","bash","grep"]` |
| `runner.timeoutMs` | milliseconds | Per-step timeout, default `1200000` (20 min) |
| `runner.serviceTier` | `"default"` / `"flex"` | API service tier |
| `acceptance.enabled` | `true` / `false` | Toggle completion acceptance |
| `quality.enabled` | `true` / `false` | Toggle quality checks |
| `quality.mode` | `"autoFix"` / `"manual"` | `autoFix` = auto-fix on failure; `manual` = report only |

</details>

### 30 seconds to start

```text
/goal          # Single target: plan → execute → accept → quality check
/flow          # Multi-goal: chain goals, advance and hand off one by one
/review        # Quality-check AI operations
```

<details>
<summary>Advanced usage</summary>

Inline request:

```text
/goal Fix login state after refresh
/flow Refactor the login flow in safe steps
```

Markdown request file:

```text
/goal task.md
/flow plan.md
```

Continue, cancel, status:

```text
/goal continue | cancel | status
/flow continue | cancel | status
```

Target a previous item:

```text
/goal status <id>
/goal start <id>
/flow status <id>
/flow start <id>
```

</details>

### Delivery loop

```text
Request → plan → execution → completion acceptance → quality check → close
                           ↘ keep fixing if a check fails ↙
```

- `/goal` — one focused target.
- `/flow` — massive work, multi-goal chain with per-goal plan / accept / report / handoff.
- Reports run at `http://127.0.0.1:<port>`.
- Completion acceptance: "Is the requirement truly done?"
- Quality checks: "Is the implementation clean, reliable, and maintainable?"

---

## 中文

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/hero-zh.png" alt="Pi Flow 中文 hero banner">
</p>

Agent 很会写代码，但长任务常死在四件事：
1. 计划不清晰
2. 计划遗漏关键信息，不符合你真正的需求
3. 说自己做完了，实际上是幻觉
4. 完成质量差

Pi Flow 解决这个问题：多轮对齐需求 → 可执行计划 → 实时报告 → 多模型对抗检查 → 循环修复直至高质量交付

### 对比

| | Pi Flow | Codex | Claude |
|---|---|---|---|
| 实现 | Prompt 注入 · 零工具，纯 UI 提示符识别 | ❌ 工具注入 | ❌ 工具注入 |
| 对齐 | 先追问澄清，再生成计划 | ❌ | ❌ |
| 验收 | 多模型交叉审查，按需求逐项反查 | ❌ 既当球员又当裁判 | ❌ 小模型 |
| 证据 | 需求 + 计划 + 代码 + 输出 + 多模型意见 | ❌ 既当球员又当裁判 | ❌ 只看对话 |
| 质量 | 多代理只读审查，循环优化 | ❌ | ❌ |
| 编排 | `/flow` 串联 + 逐目标验收 | ❌ | ❌ |
| 报告 | 实时 HTML 报告，步骤级可回溯 | ❌ | ❌ |

### 亮点

- **零工具注入** — 纯 Prompt 识别，不加 agent tool，不侵入 PI 运行时
- **追问对齐** — 先澄清再计划，不像其他 Agents 靠自己的想当然发挥
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

**推荐审核模型**

- **大型** — GPT-5.2, GPT-5.3 Codex, GPT-5.4
- **低价** — GLM-5.2, Kimi K2.7, DeepSeek V4, GPT-5.3-Codex-Spark, GPT-5.4 Mini
- [综合性价比 benchmark →](https://factory.ai/news/code-review-benchmark)

<details>
<summary>常用配置</summary>

| 配置 | 值 | 说明 |
|---|---|---|
| `generation.align` | `"ask"` / `"skip"` | `ask`＝先对齐需求；`skip`＝直接生成 |
| `models` | 模型数组 | 验收和质量检查用的模型，每项含 `model` 和 `thinking`（`low`/`medium`/`high`） |
| `runner.command` | `"pi"` | 子进程 CLI 命令 |
| `runner.tools` | 工具名数组 | 子进程可用工具，如 `["read","bash","grep"]` |
| `runner.timeoutMs` | 毫秒数 | 单步超时，默认 `1200000`（20 分钟） |
| `runner.serviceTier` | `"default"` / `"flex"` | API 服务等级 |
| `acceptance.enabled` | `true` / `false` | 开关完成验收 |
| `quality.enabled` | `true` / `false` | 开关质量检查 |
| `quality.mode` | `"autoFix"` / `"manual"` | `autoFix`＝不过自动修；`manual`＝只报告 |

</details>

### 30 秒开始

```text
/goal          # 单目标：计划 → 执行 → 验收 → 质量检查
/flow          # 多目标：串联多个 goal，逐个推进并交接
/review        # 对 AI 操作做质量检查
```

<details>
<summary>高级用法</summary>

直接带需求：

```text
/goal 修复刷新后的登录状态
/flow 重构登录流程，分步骤安全推进
```

把 md 文件作为需求：

```text
/goal task.md
/flow plan.md
```

继续、取消、状态：

```text
/goal continue | cancel | status
/flow continue | cancel | status
```

指定历史目标：

```text
/goal status <id>
/goal start <id>
/flow status <id>
/flow start <id>
```

</details>

### 工作流程

```text
对齐 → 计划 → 执行 → 完成验收 → 质量检查 → 收口
                   ↘ 不通过则循环修复 ↙
```

- 对齐："多轮问答全面挖掘你的需求"
- 完成验收："确保任务完整完成，无偷懒"
- 质量检查："确保实现干净、可靠、可维护"

---

## License

Apache-2.0. See [`LICENSE`](LICENSE).
