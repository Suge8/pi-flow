# pi-flow 开发索引

Pi 扩展：`/flow`（单步/多步编排 + 完成验收 + 质量检查）、`/review`（手动质量检查）。

## 命令

```bash
npm run check            # biome + tsc，必须 exit 0
npm test                 # smoke 全绿
npm run format           # biome 自动修复
npm run release:patch    # 本地发布：版本、tag、npm publish、push
npm run release:current  # 仅发布当前版本，用于 tag 已有但 npm 未发
```

发布只用 `npm run release:*`；不要手动改 version、打 tag 或 `npm publish`。CI 只校验，不发布。

## 模块地图

| 路径 | 职责 |
|------|------|
| `src/index.ts` | 扩展入口，注册 flow / review 与共享能力，并初始化内部 step runtime |
| `src/goal.ts` + `src/goal/` | Flow step 内部运行、完成验收、质量检查与状态同步引擎；不注册用户命令 |
| `src/flow.ts` + `src/flow/` | `/flow` 命令，单步/多步生成、执行、恢复、状态与报告 |
| `src/flow/target.ts` | Flow 命令目标解析：显式 id、当前 session、唯一 active 与多义提示 |
| `src/flow/lock.ts` | Flow dir 级写锁，保护单个 `flow.json` 调度与收口事务 |
| `src/flow/scheduler.ts` | Flow 依赖与 `writeScope` ready batch 纯函数调度器 |
| `src/flow/parallel/` | 并行 worker 私有启动、result watcher、fan-in、恢复收口与 lane UI |
| `src/review.ts` + `src/review/` | `/review` 命令与质量检查视图/聚合 |
| `src/auditor.ts` | 完成验收模型调用与结果聚合 |
| `src/plan/` | `plan.md` / 步骤 markdown 解析与校验 |
| `src/shared/` | 配置、语言、报告、卡片、生成前 `alignment.json`、子进程、会话、检查池等共享代码 |
| `scripts/validate-draft.mjs` | 生成阶段草稿校验命令（与 TS validator 双轨） |
| `scripts/release.mjs` | 本地发版：check/test、版本、tag、npm publish、push |
| `prompts/` | 中英文模型协议与修复提示 |
| `tests/` | smoke 回归测试 |
| `docs/runtime-contracts.md` | 当前运行契约：状态、Todo、prompt 投递、状态文案 |
| `docs/html-report-style.md` | HTML 报告展示规则 |

## 关键约定

- 状态单一事实源：运行态为 `flow.json`（schema v9）；生成前子阶段为同目录 `alignment.json`。模型只写 `flow.semantic.json` 与 markdown；插件 builder 组装 canonical 状态。
- HTML 报告由内置渲染器生成；模型禁止手写 `flow.html`。
- `alignment.json` 保存生成前 `stage/sessionFile/autoStart/alignmentTurns/lastAlignmentQuestion`，Q&A 不进 `flow.json`；生成成功后删除。
- `parallelRun`、`checks.acceptance` 与 `checks.quality` 是运行时字段，由插件初始化和更新，模型不写。
- `completionCursor` 是完成链恢复路由字段；用户界面不展示内部枚举。
- 用户可见文案只用「完成验收」「质量检查」；多步步骤称呼「第 N 步」，单步 Flow 的检查/完成提示不展示多余「第 1 步」；内部状态必须映射成人话。
- 根目录 `config.json` 是本机配置，必须忽略；发布只带 `config.template.json`。
- 新运行目录直接写 `.flow/F<N>/`，`flow.id` 必须是裸 `F<N>`；旧 `.flow/F<N>-slug/` 不再是合法 Flow。并行 worker 内部产物为 `workers/Gx/session.jsonl`、`plan.md`、`state.json`、`result.json`，不生成 step-level HTML 报告。
- 同一 cwd 可有多个可推进 Flow（`aligning/generating/draft/paused/running`）；用户提示使用裸 id（如 `/flow go F4`、`/flow stop F4`）。无 id 命令只在当前 session 归属或唯一可推进 Flow 时路由，多义必须要求显式 id；pre-draft 归属看 `alignment.json.sessionFile`，running / 已执行 paused 归属看 running Goal 的 `sessionFile`。
- `/flow go [id]` 是唯一推进/恢复入口：pre-draft 继续对齐或生成，draft/未启动 paused 启动，已执行 paused 恢复，running 幂等收口，complete 只打开报告；`/flow status [id]` 是隐藏诊断入口，pre-draft 只输出文本不生成 HTML。
- `/flow stop [id]` 写入 `paused` 且保留恢复事实：pre-draft 保留 `alignment.json` checkpoint，running 写 completion boundary 并暂停目标，parallel 会 abort active batch、清空 `parallelRun`、稳定收口已完成 worker，未完成 worker 回 pending；若因此所有步骤已完成则落成 `complete`。
- Flow 写操作、active parallel batch 和 live report watcher 都按 Flow dir 作用域管理，禁止退回 cwd 单例。
- worker 没有用户可调用的公开子命令；父 session 通过私有 bootstrap 启动，崩溃恢复入口是 `/flow go`。
- `.flow/` 是运行态产物，默认忽略，不进入开源仓库或 npm 包。
- README 面向用户；AGENTS 面向维护者与编码代理；`docs/` 只保留当前事实源，不放历史 backlog 或未执行计划；npm 包不发布 docs。

## 测试约定

- 行为变更必须跑受影响 smoke；发布前跑 `npm run check && npm test`。
- 文案变更同步测试断言；不要为了过测降低断言强度。
- `tests/copy-lint-smoke.mjs` 保护用户可见文案，新增公开文档时同步检查范围。
