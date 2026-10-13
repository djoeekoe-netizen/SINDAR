# Contributing to SINDAR

Thanks for helping build a free, self-hosted personal agent.

## Development setup

```bash
git clone https://github.com/djoeekoe-netizen/SINDAR.git
cd SINDAR
pnpm install          # Node >= 22.13, pnpm >= 10
pnpm build
pnpm test
node packages/cli/dist/index.js doctor
```

Useful scripts: `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test:watch`.

## Ground rules

- **Free first (ADR-09):** every feature must work with a free path (local model or free tier).
- **Termux compatible (ADR-16):** no hardcoded `/bin/sh`, `/tmp`, `/usr/*`. Use `@sindar/core` platform helpers.
- **No native dependencies** in runtime packages (phones cannot compile them).
- **Secrets never hit logs or prompts** — use the redaction helpers.
- Tests live next to each package in `test/` and run with the deterministic `mock` provider.
- The CLI tarball must stay installable with `npm i -g sindar-cli.tgz`: every third-party runtime
  dependency of inlined packages must be declared in `packages/cli/package.json` (guarded by a test).

## Commits & PRs

Conventional-ish messages (`feat:`, `fix:`, `docs:`, `chore:`), small focused PRs, green CI.
See `PLAN.md` for the roadmap and milestone acceptance criteria.
