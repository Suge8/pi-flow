# Contributing

## English

### Setup

```bash
npm install
npm run check
npm test
```

### Pull requests

- Keep changes small and focused.
- Update tests/docs for behavior or user-facing copy changes.
- Do not commit local files: `config.json`, `.flow/`, `.tmp-*`, local paths.
- Run `npm run check && npm test` before PR.

### Releases

Maintainers only:

```bash
npm run release:patch
```

- Use `npm run release:current` only when the tag exists and npm publish failed.
- Do not edit versions, create tags, or run `npm publish` manually.

## 中文

### 本地验证

```bash
npm install
npm run check
npm test
```

### PR

- 改动保持小而聚焦。
- 行为或用户文案变化，同步测试/文档。
- 不提交本地文件：`config.json`、`.flow/`、`.tmp-*`、本机路径。
- PR 前运行 `npm run check && npm test`。

### 发布

仅维护者执行：

```bash
npm run release:patch
```

- 只有 tag 已存在但 npm 发布失败时使用 `npm run release:current`。
- 不手动改版本、打 tag、或运行 `npm publish`。
