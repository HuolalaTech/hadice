# Contributing to Hadice

Thank you for contributing to Hadice, an open-source project from Huolala.

## Before you start

- Read [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- Search existing [Issues](https://github.com/HuolalaTech/hadice/issues) / PRs to avoid duplicates
- For security issues, follow [SECURITY.md](./SECURITY.md) (no public issues)

## Development setup

See [README.md](./README.md) / [README_EN.md](./README_EN.md) and [AGENTS.md](./AGENTS.md).

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@latest
cd frontend && npm install && cd ..
cp .env.ci.example .env.ci   # optional local analytics / docs URLs
task dev
```

## Private config (`.env.ci`)

- `.env.ci` is **gitignored** and must never be committed.
- Release packaging **must not** copy `.env.ci` into the app bundle.
- Build tasks run `task gen:cienv` to bake selected keys into `backend/cienv_generated.go`. Frontend `VITE_*` values are injected by Vite at build time.
- After a release build with secrets, reset before committing:

  ```bash
  task gen:cienv   # with .env.ci absent or empty keys → empty defaults
  ```

## Pull requests

1. Fork and create a feature branch from `open-source` / default branch
2. Keep changes focused; update docs when behavior changes
3. Do not commit secrets, signing materials, or filled `cienv_generated.go` values
4. Fill in the PR template and link related issues

## Code style

- Go: match existing packages under `backend/`
- Frontend: React + TypeScript under `frontend/src/` (project uses non-strict TS)
- Do not hand-edit generated bindings under `frontend/bindings/` / `frontend/wailsjs/`

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](./LICENSE), Copyright Huolala.
