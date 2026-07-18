<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/logo.png" width="96" alt="Pi Flow logo">
</p>

<h1 align="center">Pi Flow</h1>

<p align="center">
  <strong>Loop Engineering 的最佳实践，指数级提升 Agent 交付质量。<br>
  零工具注入 — 尊重 Pi 极简哲学，经验证的优雅实现。</strong>
</p>

<p align="center">
  <a href="./README.md">🇺🇸 English</a> · 🇨🇳 简体中文
  · <a href="https://pi-flow.vercel.app">官网</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@surgee/pi-flow"><img alt="npm" src="https://img.shields.io/npm/v/%40surgee%2Fpi-flow"></a>
  <a href="https://github.com/Suge8/pi-flow/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Suge8/pi-flow/ci.yml?branch=main"></a>
  <a href="https://pi-flow.vercel.app"><img alt="Website" src="https://img.shields.io/badge/website-pi--flow.vercel.app-black"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
</p>

---

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/hero-zh.png" alt="Pi Flow 中文 hero banner">
</p>

Agent 很会写代码，但长任务常死在四件事：
1. 计划遗漏关键信息，不符合你真正的需求
2. 说自己做完了，实际上是幻觉
3. 完成质量差
4. 不同模型擅长不同角色，单模型硬扛效果不佳

Pi Flow 解决这个问题：多轮对齐需求 → 可执行计划 → 实时报告 → 多模型对抗检查 → 循环修复直至高质量交付

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/demo.gif" alt="Pi Flow 真实工作流演示">
</p>
<p align="center"><sub>10 秒产品短片 · 对齐 → 计划 → 执行 → 检查 → 顾问 → 验收</sub></p>

## 对比

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

## 亮点

- **零工具注入** — 纯 Prompt 识别，不加 agent tool，不侵入 Pi 运行时
- **追问对齐** — 先澄清再计划，不像其他 Agents 靠自己的想当然发挥
- **角色模型** — 计划、执行、审查分别指定模型，让合适的模型做擅长的事
- **多模型验收** — 交叉审查，按需求反查，减少"假完成"
- **多代理审查** — 只读审查，循环优化，不偷懒、不遗漏
- **子代理实时监控** — Pi Flow 会在并行执行、验收、质检和顾问咨询时自动打开监控悬浮窗。按 Esc 关闭，按 Alt+S 重开。
- **实时报告** — HTML 步骤级进度，本地运行，随时回溯

<p align="center">
  <img src="https://raw.githubusercontent.com/Suge8/pi-flow/main/assets/report.png" alt="Pi Flow 实时 HTML 报告">
</p>
<p align="center"><sub>演示报告 · 6 轮验收 · 3 个审查模型 · 顾问介入 · 2 轮质检</sub></p>

## 安装

```bash
pi install npm:@surgee/pi-flow
```

如果 Pi 已经在运行，重启或执行：

```text
/reload
```

需要 Node.js `>=22.19.0`。

## 配置

复制模板作为本机配置：

```bash
cp config.template.json config.json
```

**模型角色**

`config.template.json` 已包含 `modelRoles`。某个角色写 `"current"` 就沿用 Pi 当前模型；写 `{ "model", "thinking" }` 就固定到指定模型。

```json
{
  "modelRoles": {
    "advisor": { "model": "52mx/free/glm-5.2", "thinking": "xhigh" },
    "executor": { "model": "openai-codex/gpt-5.5", "thinking": "xhigh" },
    "reviewers": [
      { "model": "openai-codex/gpt-5.4", "thinking": "high" }
    ]
  }
}
```

- `advisor`：追问对齐、生成计划；步骤检查未通过时自动或按需咨询方向
- `executor`：进入执行时使用
- `reviewers`：验收和质检
- `advisor` / `executor` 也可以写 `"current"`（咨询子进程回落第一个 reviewer）

计划阶段使用当前 Pi 会话工具；失败顾问以后台子进程运行，与验收、质检共用 `checks.tools`，可用 `bash` 做安全验证，但始终没有 `write`、`edit`。

`thinking: "max"` 需要 Pi `>=0.80.6`。

**推荐角色模型**

- **顾问模型** — Claude Fable 5、Claude Ops 4.8、GLM 5.2
- **执行模型** — Claude Fable 5、GPT-5.5
- **审查模型** — GPT-5.2、GPT-5.3 Codex、GPT-5.4、GLM 5.2、Kimi K2.7、DeepSeek V4、GPT-5.4 Mini
- [综合性价比 benchmark →](https://factory.ai/news/code-review-benchmark)

<details>
<summary>常用配置</summary>

| 配置 | 值 | 说明 |
|---|---|---|
| `generation.align` | `"ask"` / `"coarse"` / `"standard"` / `"deep"` / `"no"` | `ask`＝每次询问；三档＝总是按该问答预算对齐（约 10 问 / 约 20-30 问 / 不设硬上限）；`no`＝直接生成 |
| `modelRoles.advisor` | `"current"` / 角色模型 | 对齐、生成计划，以及连续 2/4/6/8 轮检查未通过时自动咨询顾问；失败卡先显示，建议随后单独成卡。角色模型必须写精确 `provider/model` 和 `thinking`；`"current"` 时咨询子进程回落第一个 reviewer |
| `modelRoles.executor` | `"current"` / 角色模型 | 执行开始时切一次；之后保留 Pi 当前选择 |
| `modelRoles.reviewers` | 模型数组 | 验收和质检用的模型，每项含 `model` 和 `thinking`（`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`） |
| `advisor.enabled` | 布尔 | 自动咨询与 `/advisor` 的总开关；默认 `true` |
| `prewalk.enabled` | 布尔 | 首个执行会话从计划会话 fork，执行模型直接继承计划期的代码探索；计划会话上下文过大、或计划完成后工作区被改动时自动回退新会话。隔离 harness A/B（真实模型调用；绕过 /flow 扩展路径与验收/质检环节；3 个单文件合成任务 × 9 对，含行为断言）：专用读取工具调用 1 vs 54，首步中位提速 1.4 倍，执行成本中位 0.99 倍（持平，范围 0.54–1.20），质量 18/18 持平。真实 Flow 初步 A/B（`npm run eval:prewalk:flow`，3 对串行、含验收/质检全链）确认 fork 在生产链路真实工作（goal 会话带计划血缘、执行期读取显著减少）且全部收口，但成本上 fork 仅 1/3 对占优，样本不足以宣称普遍收益。未配置 `prewalk` 时运行时回退值为 `false`；随包提供的 `config.template.json` 默认开启 |
| `background.command` | `"pi"` | 后台 Worker 与检查子进程使用的 Pi 命令 |
| `background.extensions` | 路径数组 | 后台 Pi 进程额外加载的扩展 |
| `checks.tools` | 工具名数组 | 验收、质检和失败顾问共用的工具；始终禁用 `write`/`edit` |
| `checks.timeoutMinutes` | 分钟 | 每个检查或顾问子进程的超时，默认 `20` |
| `checks.openaiFast` | 布尔 | 对支持的 OpenAI Responses 请求启用付费优先处理；其他请求静默使用普通模式。默认 `false` |
| `acceptance.enabled` | `true` / `false` | 开关验收 |
| `quality.enabled` | `true` / `false` | 开关质检 |
| `quality.mode` | `"autoFix"` / `"manual"` | `autoFix`＝不过自动修；`manual`＝只报告 |
| `report.bind` | `"localhost"` / IP | 监听地址，默认 `127.0.0.1` |
| `report.port` | 整数 | 用户级报告服务固定端口，默认 `49327` |
| `report.publicBaseUrl` | HTTP(S) origin / `null` | 报告链接展示的公开 origin；不改变监听地址 |

只接受文档列出的配置字段；未知字段会明确报错，不会静默忽略。

</details>

### 通过 Tailscale 远程查看报告

同一 OS 用户的所有 Pi 会话共用一个报告服务。启动它的会话退出后服务仍可用；最后一个 Pi control 或浏览器事件连接关闭 15 分钟后，服务自动退出。

推荐保持 `report.bind` 为 `127.0.0.1`，用 [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) 代理固定端口，再把 `report.publicBaseUrl` 设为 Serve 输出的 HTTPS origin：

```bash
tailscale serve --bg 49327
```

这样后端仍只监听本机，远程访问经过 Tailscale Serve，并受 tailnet 访问规则约束。参数与状态命令见 [`tailscale serve` CLI 文档](https://tailscale.com/docs/reference/tailscale-cli/serve)。Pi Flow 不会自动修改 Tailscale 配置。

高级用法可以直接绑定本机 Tailscale IP。绑定 `0.0.0.0` 或 `::` 还会向其他可达的 LAN 网卡暴露服务，并不等于「只开放 Tailscale」；直接绑定时必须配合 tailnet ACL 与主机防火墙。报告 URL 含不可猜测的 capability，但仍是 bearer 链接：不要公开，也不要当作长期公共链接。

## 5 秒开始

```text
/flow [需求|path.md]  # 计划 → 执行 → 验收 → 质检
/flow go [F1]         # 推进或恢复 Flow
/flow stop [F1]       # 停止 Flow，之后用 go 恢复
/advisor              # 当前步骤有未解决的失败检查时手动咨询
/review [需求]        # 立即质检，或执行需求后自动质检
```

`/advisor` 不带参数，只咨询当前对话所属的 Flow 步骤，且当前必须有尚未解决的验收或质检失败。建议会写入报告并排队；再运行 `/flow go F<N>` 继续并送给执行模型。并行批次期间不运行；顾问建议不进入审查用的上下文证据，也不得作为审查证据。

空闲时运行 `/review`，立即质检当前对话里已完成的工作。运行 `/review 修复登录超时`，需求会作为普通用户消息直接执行，完成后自动开始质检。AI 正在执行时，裸 `/review` 会为当前这轮开启同样的自动质检；质检开始前按 Esc 或 Ctrl+C 可取消。

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

推进或停止已有 Flow：

```text
/flow go        # 当前对话所属 Flow，或唯一活跃 Flow
/flow go F1     # 显式指定 Flow id
/flow stop F1   # 停止，之后仍可用 go 恢复
```

同一项目可同时有多个进行中的 Flow，包括对齐、计划生成和执行中。裸 `go` 会路由到当前对话所属 Flow 或唯一进行中的 Flow；多义时 Pi 会要求指定 id。对齐或计划生成期间，直接在当前对话回复会继续同一个 Flow。

验收或质检中断后，已经完成的同配置模型结果会保留；重新打开会话时检查会自动续跑，只重跑未完成或配置已变化的模型；修复中断则显示「已中断」与恢复入口，直接回复或运行 `/flow go` 即可接着跑。

互不相关的 Flow 也可以在各自的 [git worktree](https://git-scm.com/docs/git-worktree) 里物理并行：每个 worktree 有独立的 `.flow` 运行态，每个 worktree 开一个 Pi 会话即可，无需额外配置。

</details>

## 工作流程

```text
对齐 → 计划 → 执行 → 验收 → 质检 → 收口
                   ↘ 不通过则循环修复 ↙
```

- 对齐："多轮问答全面挖掘你的需求"
- 验收："确保任务完整完成，无偷懒"
- 质检："确保实现干净、可靠、可维护"
- 报告默认共用用户级服务 `http://127.0.0.1:49327`

## 共创

Pi Flow 还在快速迭代。如果你也在探索更可靠的 Agent 循环，欢迎一起打磨。

- 讨论 — 用 issue 描述你的工作流和痛点
- 贡献 — 先读 [CONTRIBUTING.md](.github/CONTRIBUTING.md)，保持改动小而清晰

## License

Apache-2.0. See [`LICENSE`](LICENSE).
