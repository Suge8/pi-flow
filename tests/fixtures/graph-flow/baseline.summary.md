# 图执行评测摘要

> 本文件由 artifact 确定性生成，非模型撰写；数字须与 JSON 一致。

- **结论**: `expand`
- **样本**: runsPerArm=1 · workerBudget=2
- **任务集**: historical-cross-module, scope-conflict, uneven-fork-join

## 方向

| 任务 | 方向 |
|------|------|
| historical-cross-module | neutral |
| scope-conflict | positive |
| uneven-fork-join | positive |

## 耗时（秒，serial / current-batch / optimized-batch / streaming）

| 任务 | serial | current | optimized | streaming |
|------|--------|---------|-----------|-----------|
| historical-cross-module | 247 | 190 | 206 | 246 |
| scope-conflict | 208 | 168 | 155 | 203 |
| uneven-fork-join | 193 | 166 | 171 | 152 |

## 完整性

- complete: 12/12
- processErrors: 0
- streaming completion-fills: 1

## 指纹（前 12 位）

- scorer: `d71fb705bb14`
- executor: `48fe46ae43ea`
- scheduler: `d695d432f3a5`
- evaluationConfig: `a465661058a2`

## 边界

- 摘要不能替代 artifact 校验；请以 `evaluate-graph-flow --verify-artifact` 为准。
- 单样本不足以授权生产 streaming；`expand` 表示先扩样，不是 proceed。
- 不能证明 worktree/patch 隔离后的墙钟收益。
