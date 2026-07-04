# Contributing

Thanks for improving Pi Flow.

## Setup

```bash
npm install
npm run check
npm test
```

## Pull requests

- Keep changes focused and minimal.
- Update tests/docs when behavior or user-facing copy changes.
- Do not commit `config.json`, `.flow/`, `.tmp-*`, or local paths.
- Run `npm run check && npm test` before opening a PR.

## Releases

Maintainers publish from a local machine:

```bash
npm run release:patch
```

Use `npm run release:current` only when a Git tag exists but npm publish failed.
Do not edit versions, create tags, or run `npm publish` manually.
