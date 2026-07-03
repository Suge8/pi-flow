<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/logo.png" width="96" alt="Pi Flow logo">
</p>

<h1 align="center">Pi Flow</h1>

<p align="center">
  <strong>Loop Engineering 的最佳实践，指数级提升 Agent 交付质量。</strong><br>
  Visual HTML reports, multi-model review, and reliable delivery loops for Pi.
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@surgee/pi-flow"><img alt="npm" src="https://img.shields.io/npm/v/%40surgee%2Fpi-flow"></a>
  <a href="https://github.com/Suge8/pi-flow/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Suge8/pi-flow/ci.yml?branch=main"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/hero.png" alt="Pi Flow hero banner">
</p>

<h2 align="center">Live HTML report / 实时 HTML 报告</h2>

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/report.png" alt="Pi Flow live HTML report">
</p>

<p align="center">
  Every goal gets a clear visual report: progress, task evidence, acceptance, quality checks, and reviewer status.
  <br>
  每个目标都有清晰的可视化报告：进度、任务证据、完成验收、质量检查和审查状态。
</p>

## 中文

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/hero-zh.png" alt="Pi Flow 中文 hero banner">
</p>

Pi 很会写代码，但长任务常死在三件事：计划不清、过程不可见、最后一句“做完了”没人验。Pi Flow 把这些补齐：先生成可执行计划，再用漂亮清晰的本地 HTML 报告展示进度，结束后由多个检查模型做完成验收和质量检查，不通过就回到修复闭环。

### Before / After

| 以前 | 现在 |
|---|---|
| AI 说做完了 | 计划完成、验收通过、质量确认 |
| 过程靠猜 | HTML 报告实时可见 |
| 问题靠人工翻记录 | 多模型检查自动回流修复 |

### 为什么值得装

- **进度可视化**：自动生成本地 HTML 报告，目标、步骤、检查结果一眼看清。
- **计划更稳**：`/goal` 处理单目标，`/flow` 通过多个目标组合承接海量任务。
- **审查更严**：多个检查模型参与完成验收与质量检查，减少“看起来完成其实没完成”。
- **质量更高**：质量检查失败会回流给 Pi 继续修，帮助减少遗漏、偷懒和粗糙实现。
- **收口更可靠**：不是停在 AI 自述，而是用原始需求反查完成度。

### 安装

```bash
pi install npm:@surgee/pi-flow
```

如果 Pi 已经在运行，重启或执行：

```text
/reload
```

需要 Node.js `>=22.19.0`。

### 30 秒开始

基于当前对话创建单目标：

```text
/goal
```

基于当前对话创建多目标组合：

```text
/flow
```

对 AI 的操作做质量检查：

```text
/review
```

### 三个核心命令

| 命令 | 适合什么 |
|---|---|
| `/goal` | 单个明确目标：生成计划、执行、完成验收、质量检查 |
| `/flow` | 海量任务：组合多个目标，逐个推进并保留交接 |
| `/review` | 不启动目标，只对 AI 的操作做质量检查 |

<details>
<summary>高级用法</summary>

直接带一句需求：

```text
/goal 修复刷新后的登录状态
/flow 重构登录流程，分步骤安全推进
```

把 markdown 文件作为需求：

```text
/goal task.md
/flow plan.md
```

继续、取消、状态：

```text
/goal continue
/goal cancel
/goal status
/flow continue
/flow cancel
/flow status
```

指定历史目标或运行：

```text
/goal status <id>
/flow status <id>
/goal start <id>
/flow start <id>
```

本地试运行：

```bash
pi -e .
```

</details>

### 工作闭环

```text
需求 → 可执行计划 → 执行 → 完成验收 → 质量检查 → 收口
                         ↘ 不通过则继续修复 ↙
```

- `/goal`：适合一个可以连续完成的目标。
- `/flow`：适合海量任务和复杂需求，用多个目标组合推进，每个目标都有计划、报告和交接。
- HTML 报告运行在本机 `http://127.0.0.1:<port>`。
- 完成验收关注“原始需求是否真的完成”。
- 质量检查关注“实现是否干净、可靠、可维护”。

### 配置

复制模板作为本机配置：

```bash
cp config.template.json config.json
```

常用配置：

| 配置 | 用途 |
|---|---|
| `generation.align` | 生成计划前是否先对齐需求 |
| `models` | 完成验收和质量检查使用的模型 |
| `runner` | 子进程命令、工具、超时、服务等级、扩展 |
| `acceptance.enabled` | 开关完成验收 |
| `quality.enabled` | 开关质量检查 |
| `quality.mode` | `autoFix` 或 `manual` |

### 安全与隐私

- 运行状态写入 `.flow/`，默认不提交。
- 报告服务只监听 `127.0.0.1`。
- 完成验收和质量检查会调用 `config.json` 中配置的模型。
- 检查提示会使用裁剪后的对话上下文，裁剪范围由 `transcript` 控制。

## English

Pi is great at coding, but long AI tasks often fail in silence: unclear plans, invisible progress, and a final “done” with no real check. Pi Flow adds the missing delivery loop: executable plans, beautiful local HTML reports, strict completion acceptance, and quality checks that feed failures back into Pi.

### Before / After

| Before | After |
|---|---|
| “Done” means the model said so | Done means plan complete, acceptance passed, quality verified |
| Progress is hidden | A live HTML report makes it visible |
| Review means rereading logs | Multi-model checks feed issues back into the loop |

### Why install it

- **Visual progress** — local HTML reports make goals, steps, checks, and outcomes easy to inspect.
- **Better planning** — `/goal` handles one focused target; `/flow` combines multiple goals for massive work.
- **Stricter review** — multiple reviewer models check whether the original request is truly complete.
- **Higher code quality** — failed quality checks go back into the loop instead of being buried.
- **Cleaner closure** — work closes after checks pass, not after a self-reported “done”.

### Install

```bash
pi install npm:@surgee/pi-flow
```

If Pi is already running, restart it or run:

```text
/reload
```

Requires Node.js `>=22.19.0`.

### Start in 30 seconds

Create a single target from the current conversation:

```text
/goal
```

Create a multi-goal run from the current conversation:

```text
/flow
```

Run a quality check on AI operations:

```text
/review
```

### The three commands

| Command | Use it for |
|---|---|
| `/goal` | One focused target: plan, execute, accept, quality-check |
| `/flow` | Massive work: combine multiple goals, run with handoff and recovery |
| `/review` | Quality-check AI operations without starting a target |

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
/goal continue
/goal cancel
/goal status
/flow continue
/flow cancel
/flow status
```

Target a previous item:

```text
/goal status <id>
/flow status <id>
/goal start <id>
/flow start <id>
```

Local test run:

```bash
pi -e .
```

</details>

### Delivery loop

```text
Request → executable plan → execution → completion acceptance → quality check → close
                              ↘ keep fixing if a check fails ↙
```

- `/goal` is for one focused target.
- `/flow` is for massive work composed from multiple recoverable goals.
- HTML reports run locally at `http://127.0.0.1:<port>`.
- Completion acceptance asks: “Is the original request truly done?”
- Quality checks ask: “Is the implementation clean, reliable, and maintainable?”

### Configuration

Copy the template for local overrides:

```bash
cp config.template.json config.json
```

Common keys:

| Key | Purpose |
|---|---|
| `generation.align` | clarify before planning or generate directly |
| `models` | reviewer models for completion acceptance and quality checks |
| `runner` | child Pi command, tools, timeout, service tier, extensions |
| `acceptance.enabled` | enable or disable completion acceptance |
| `quality.enabled` | enable or disable quality checks |
| `quality.mode` | `autoFix` or `manual` |

### Safety and privacy

- Runtime state is written under `.flow/` and should not be committed.
- Reports listen only on `127.0.0.1`.
- Completion acceptance and quality checks call the models configured in `config.json`.
- Check prompts receive clipped conversation context, controlled by `transcript` limits.

## Development

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

## License

Apache-2.0. See [`LICENSE`](LICENSE).
