# Shri

Automated marketing content studio. Drop in a product, get a director's brief + content plan + finished carousels and 6-12s reels.

Architecture, data model, and full feature deep-dives live in [Docs.md](Docs.md) and the [`docs/`](docs/) sub-files. Read those first when ramping up.

## Quick start

```bash
pnpm install                                  # install across the monorepo
docker compose up -d                          # local Postgres + Redis
cp .env.example .env                          # then fill in keys
pnpm db:migrate                               # Prisma migrate dev
pnpm dev                                      # web + worker concurrently
pnpm --filter @shri/mcp start                 # MCP stdio server (separate process)
pnpm -r typecheck                             # type-check every package
pnpm -r test                                  # vitest across every package
pnpm -r lint                                  # eslint across every package
pnpm tsx scripts/manual-seedance-smoke.ts     # user-run Seedance live smoke
```

See [`CLAUDE.md`](CLAUDE.md) for the conventions any contributor (human or agent) must respect.
