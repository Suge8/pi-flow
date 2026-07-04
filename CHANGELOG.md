# Changelog

All notable changes to this project are documented here.

## [0.2.1] - 2026-07-05

### English

#### Fixed

- Avoid echoing streaming Goal and Flow alignment replies as model-visible custom messages while still sending the hidden alignment context.
- Preserve the original `/flow` command context when auto-starting a generated Flow, so step sessions can start even if the completion event context lacks session creation APIs.

### 中文

#### 修复

- 修复 Goal 和 Flow 在流式对齐回复时把用户输入回显成模型可见 custom message 的问题；隐藏对齐上下文仍会继续发送。
- 修复 Flow 计划生成后自动启动时丢失原始 `/flow` 命令上下文的问题；即使完成事件上下文没有新建会话能力，也能启动步骤会话。
