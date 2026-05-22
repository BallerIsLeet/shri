# CLAUDE.md

Project memory for Claude Code sessions in this repo. Auto-loaded into context.

---

## What this repo is

**Shri** — automated marketing content studio. Drop in a product, get a director's brief + content plan + finished carousels and 6-12s reels. Single-user, single deploy on Railway.

Full architecture lives in [Docs.md](Docs.md). Read that first when ramping up.

---

## Quick commands

```bash
pnpm install                                  # one-time install across the monorepo
docker compose up -d                          # local Postgres + Redis
cp .env.example .env                          # then fill in keys (see "Env" below)
pnpm db:migrate                               # Prisma migrate dev
pnpm dev                                      # runs web + worker concurrently
pnpm --filter @shri/mcp start                 # MCP stdio server (separate process)
pnpm -r typecheck                             # type-check every package
pnpm -r test                                  # vitest across every package
pnpm -r lint                                  # eslint across every package
pnpm tsx scripts/manual-seedance-smoke.ts     # user-run Seedance live smoke
```

---

## Architecture in one breath

`apps/web` (Next.js + tRPC) handles the UI and enqueues BullMQ jobs.
`apps/worker` consumes jobs, runs the `packages/orchestrator` LLM loop for brief generation, and a deterministic pipeline for item generation.
`apps/mcp` exposes the same `packages/tools/` surface as an MCP stdio server for Claude Code.
`packages/ai` is the single object every AI call flows through.
`packages/storage` (R2), `packages/seedance` (BytePlus), `packages/db` (Prisma) round it out.

---

## Critical conventions (do not break)

1. **All AI calls go through `aiClient`** in `packages/ai/`. Never import `openai` directly in tool code. See [docs/18-ai-client.md](docs/18-ai-client.md).
2. **All R2 keys come from `packages/storage/keys.ts`** helper functions. Never build R2 paths inline. See [docs/08-storage-and-data.md](docs/08-storage-and-data.md).
3. **`submit_seedance_job` requires `cameraPerspective` (5 sub-fields)**. The handler composes those into the BytePlus prompt automatically. See [docs/04-seedance.md](docs/04-seedance.md).
4. **No mocks anywhere for Seedance.** Real `fetch` only. User owns the smoke test. Other providers (OpenAI image, TTS, chat): real-API tests with `it.skipIf(!process.env.OPENAI_API_KEY)`, never `vi.mock`.
5. **Seven prompt files allowlisted.** `packages/prompts-fs` refuses any filename outside the seven. See [docs/07-prompts.md](docs/07-prompts.md).
6. **Brief LLM outputs fully-elaborated concepts.** `runItemJob` is deterministic — no LLM in happy path. See [docs/16-editable-concepts.md](docs/16-editable-concepts.md).
7. **Single-scene reels are the default.** Multi-scene is opt-in and only used when content has a real arc. See [docs/17-director-scenes.md](docs/17-director-scenes.md).
8. **Tools are added by writing one descriptor.** Both the worker (OpenAI function-calling) and MCP server pick it up via `toolDescriptors`. See [docs/03-tools.md](docs/03-tools.md).
9. **Per-project prompts and per-item concepts are both user-editable.** Don't bake either into code.

---

## Env

Required for any non-trivial work:

- `OPENAI_API_KEY` + `OPENAI_BASE_URL` (shared default for chat / image / tts)
- `OPENAI_CHAT_MODEL`, `OPENAI_IMAGE_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`
- `ARK_API_KEY` (BytePlus Seedance)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`
- `DATABASE_URL`, `REDIS_URL`
- `PROMPTS_DIR` (defaults to `./prompts-projects` locally; Railway volume mount in prod)
- `BASIC_AUTH_USER`, `BASIC_AUTH_PASS`

Per-namespace AI overrides (only when splitting providers): `OPENAI_CHAT_API_KEY`, `OPENAI_CHAT_BASE_URL`, `OPENAI_IMAGE_*`, `OPENAI_TTS_*`.

---

## What I (Claude) am allowed to verify automatically

Everything except Seedance. Real OpenAI, real R2, real Postgres, real Redis, real ffmpeg.

**Seedance is user-owned.** When the time comes, the user runs `scripts/manual-seedance-smoke.ts` against real BytePlus. I do not write mocks for Seedance and I do not fabricate the contract.

---

## How execution is structured

Three-phase scaffold with subagents and a PM gate between phases. See [PHASE.md](PHASE.md) for the live tracker.

The plan file lives at `/Users/baller/.claude/plans/goal-to-wise-hummingbird.md` and is the source of truth for subagent scopes.

---

## When in doubt

Read the relevant `docs/*.md` before writing code. Each is short (300-600 lines) and answers one focused question. The links in [Docs.md](Docs.md) are organized by question, not by file order.
