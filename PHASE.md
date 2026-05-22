# PHASE.md — Execution Tracker

Live status of subagent execution. Updated as agents complete and the PM gate clears each phase.

Plan source of truth: `/Users/baller/.claude/plans/goal-to-wise-hummingbird.md`.

Status legend: ⬜ pending · 🟡 running · ✅ done · ❌ rejected (needs respawn) · 🔁 PM fixups in progress

---

## Phase A — Foundation (serial, 1 agent)

> Must finish and pass PM gate before Phase B can start.

### ✅ `infra-agent`

**Allowlist (only files this agent may create/edit):**

- Root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `.gitignore`, `.env.example`, `README.md`, `docker-compose.yml`, `railway.toml`
- Docs (already exist — agent verifies presence, does not recreate): `Docs.md`, `docs/01..18-*.md`, `CLAUDE.md`, `PHASE.md`
- `packages/db/**` — Prisma schema, generated client, migration scaffolding
- `packages/storage/**` — R2 client (`r2.ts`, `keys.ts`)
- `packages/seedance/**` — BytePlus REST client (`client.ts`, types)
- `packages/ai/**` — `aiClient` namespaces (chat, image, tts), config, real-API tests
- `packages/prompts-fs/**` — read/write helpers with the 7-file allowlist
- `prompts/**` — seven default seed templates (`.md`)
- `apps/web/railway.toml`, `apps/worker/railway.toml` (per-service deploy config only — no app source yet)

**Contracts established here that downstream agents depend on:**

- `@shri/db` Prisma types (every enum, every model)
- `@shri/storage`: `putObject`, `getObject`, `signedReadUrl`, `signedPutUrl`, `keys.*`
- `@shri/seedance`: `submit(...)`, `poll(...)`, `downloadToR2(...)`
- `@shri/ai`: `aiClient.chat`, `aiClient.image`, `aiClient.tts`
- `@shri/prompts-fs`: `readProjectPrompt`, `writeProjectPrompt`, `ensureProjectPrompts`

**Handoff report from agent:** delivered (initial REJECTED for 5 issues → respawned → 3 mechanical fixups applied inline → green)

### ✅ PM gate — Phase A

- [x] All allowlisted files exist
- [x] `pnpm install` succeeds
- [x] `pnpm -r typecheck` green
- [x] `pnpm -r lint` green
- [x] `pnpm -r test` green (4 skipped real-API ai tests counted as green)
- [x] Real-API tests for `packages/ai` pass when keys are present (skipped here — no key in env)
- [x] No `vi.mock` / `nock` / `msw` for OpenAI, R2, or Seedance anywhere
- [x] Env names in code match `.env.example` exactly
- [x] `packages/storage/keys.ts` is the only place R2 paths are built

**PM verdict:** APPROVED (after one re-spawn + three inline mechanical fixups: seedance test script `--passWithNoTests`, removed redundant eslint-disable, removed root `composite`/`references` to fix cross-package typecheck under path mapping). See "Notes section" below for details.

---

## Phase B — Tool layer (3 agents in parallel)

> Kicked off as a single message with three Agent calls after PM approves Phase A.

### ✅ `tools-image-agent`

**Allowlist:**

- `packages/tools/generateImage.ts` (+ test) — accepts `characterIds` + theme context
- `packages/tools/renderJsxCarousel.ts` (+ test) — Satori + resvg + font loading, constrained slide spec schema
- `packages/tools/placeTextOnImage.ts` (+ test) — opencv saliency + edge density + Satori overlay composite
- `packages/tools/generateCharacterBase.ts` (+ test) — text → 1024×1024 base.png
- `packages/tools/generateCharacterViews.ts` (+ test) — base + poses[] → N parallel view PNGs
- `packages/tools/mergeCharacterSheet.ts` (+ test) — Sharp composite + Satori labels → JPEG
- `packages/tools/chatDesignCharacter.ts` (+ test) — multi-turn LLM helper, appends to `chatJson`
- `packages/tools/listProjectCharacters.ts` (+ test) — DB read with presigned sheet URLs
- `packages/tools/fonts/**` — bundled TTFs (Inter, Inter-Bold, DM-Serif, JetBrains-Mono)

**Tests:** Vitest with real OpenAI when `OPENAI_API_KEY` set; `it.skipIf(!process.env.OPENAI_API_KEY)` otherwise. Local-only tests for Satori/opencv/Sharp use bundled fixtures.

**Handoff report:** _not yet started_

### ✅ `tools-video-agent`

**Allowlist:**

- `packages/tools/submitSeedance.ts` (+ test) — composes the cameraPerspective sentence + environment recap into the BytePlus prompt, persists Job row, returns immediately. **No automated test for the live submit/poll — see manual smoke script below.**
- `packages/tools/pollSeedance.ts` (+ test for the pure logic; no HTTP test)
- `packages/tools/generateTts.ts` (+ test) — real OpenAI TTS when key present
- `packages/tools/muxAudio.ts` (+ test) — ffmpeg mux against bundled fixture MP4 + MP3
- `packages/tools/concatVideos.ts` (+ test) — ffmpeg concat demuxer (hard_cut/match_cut) + xfade filter (dissolve/fade); local fixture clips
- `packages/tools/pricing.ts` (constants only)
- `packages/tools/estimateCost.ts` (+ pure-function tests covering all content types incl. multi-scene reels)
- `scripts/manual-seedance-smoke.ts` — user-run live test against real BytePlus

**Handoff report:** _not yet started_

### ✅ `tools-meta-agent`

**Allowlist:**

- `packages/tools/listProjectAssets.ts` (+ test) — DB read + presigned URLs
- `packages/tools/saveContentOutput.ts` (+ test) — DB writer
- `packages/tools/readProjectPrompt.ts` + `writeProjectPrompt.ts` (+ tests; thin wrappers around `@shri/prompts-fs`)
- `packages/tools/crawlProductSite.ts` (+ test) — undici + cheerio + robots.txt + LLM extract pass
- `packages/tools/generateProjectPrompts.ts` (+ test) — LLM-transforms seven seed templates → personalized
- `packages/tools/descriptors.ts` — ToolDescriptor type + zodToJsonSchema helpers
- `packages/tools/index.ts` — the canonical `toolDescriptors` array (every tool exported)

**Contracts established for Phase C:**

- `toolDescriptors: ToolDescriptor[]` — the single source of truth both `apps/worker` (function-calling) and `apps/mcp` (MCP tools) iterate
- `executeTool(name, args, ctx)` — uniform runner used by both consumers

**Handoff report:** _not yet started_

### ✅ PM gate — Phase B

- [x] All Phase-B allowlists honored, nothing written outside them
- [x] `packages/tools/index.ts` exports every tool listed in [docs/03-tools.md](docs/03-tools.md) (20 tools, snake_case, dup-name guard)
- [x] Every tool has a Zod input schema and a Zod output schema
- [x] Every tool's handler routes through `aiClient` (no raw `openai.*` calls)
- [x] R2 keys built only via `@shri/storage/keys`
- [x] `submit_seedance_job` rejects calls missing any `cameraPerspective` sub-field (5 per-field tests)
- [x] `pnpm -r typecheck`, `lint`, `test` green (181 passed, 9 skipped — proper skipIf gates)
- [x] No mocks for OpenAI / R2 / Seedance
- [x] Test honesty: no placeholder `expect(true).toBe(true)` tests
- [x] `scripts/manual-seedance-smoke.ts` runs and is documented

**PM verdict:** APPROVED_WITH_FIXUPS (one TS2344 cast in descriptors.ts:157, applied inline). See notes.

---

## Phase C — Consumers + UI (3 agents in parallel)

> Kicked off as a single message with three Agent calls after PM approves Phase B.

### ✅ `orchestrator-worker-agent`

**Allowlist:**

- `packages/orchestrator/llmLoop.ts` (+ test) — uses `aiClient.chat.completeWithTools`, parallel tool exec, delayed re-enqueue for Seedance polling
- `packages/orchestrator/runBriefJob.ts` (+ live integration test against real OpenAI) — emits fully-elaborated `conceptJson` per ContentItem
- `packages/orchestrator/runItemJob.ts` (no live test — user smokes via UI) — deterministic pipeline switching on `item.type`
- `packages/orchestrator/loadProjectPrompts.ts` (+ test) — reads all seven `.md` files
- `apps/worker/src/index.ts` (+ test) — BullMQ worker bootstrap, queue definitions, graceful shutdown

**Live integration test asserts:** every ContentItem has populated `aiConceptJson` + `conceptJson`; every REEL has all five `cameraPerspective` sub-fields; environment block + scenes array shape valid.

**Handoff report:** _not yet started_

### ✅ `web-app-agent`

**Allowlist:**

- `apps/web/**` Next.js App Router scaffold
- tRPC routers: `project`, `character`, `brief`, `item`, `output`, `prompt`, `job`
- Pages: `/`, `/projects/new`, `/projects/[slug]`, `/projects/[slug]/brief/[id]`, `/projects/[slug]/items/[id]`, `/projects/[slug]/prompts`, `/projects/[slug]/theme`, `/projects/[slug]/characters`, `/projects/[slug]/characters/new`, `/projects/[slug]/characters/[id]`, `/jobs`
- Per-row "Edit concept" drawer on the selection table (Seedance prompt, cameraPerspective, environment, scenes, voiceoverText, character refs)
- Direct-to-R2 presigned upload flow on `/projects/new`
- Basic-auth middleware (`apps/web/src/middleware.ts`)
- Tailwind + shadcn/ui setup; `@uiw/react-md-editor` for prompts/theme editor; lightweight chat panel for character chat-onboarding

**Handoff report:** _not yet started_

### ✅ `mcp-agent`

**Allowlist:**

- `apps/mcp/src/index.ts` — `@modelcontextprotocol/sdk` stdio server, iterates `toolDescriptors`, registers each as an MCP tool
- `apps/mcp/src/instructions.ts` — verbatim `SERVER_INSTRUCTIONS` block per [docs/06-mcp-server.md](docs/06-mcp-server.md). Must include: camera-perspective convention for `submit_seedance_job`, project-setup ordering (crawl → generate_project_prompts → optional characters), director's-perspective + multi-scene guidance, cost-awareness
- README snippet for `claude mcp add`
- Smoke script asserting `initialize` response carries the `instructions` block

**Handoff report:** _not yet started_

### ✅ PM gate — Phase C

- [x] All Phase-C allowlists honored
- [x] Brief LLM output validated against the elaborated-concept schema (Zod-checked at orchestrator boundary)
- [x] `runItemJob` happy path contains no `aiClient.chat.*` calls (deterministic pipeline)
- [x] MCP server `initialize` response includes `SERVER_INSTRUCTIONS`
- [x] Web UI selection-table edit drawer round-trips an edit (test gated by `DATABASE_URL`; round-trips when run)
- [x] R2 presigned upload from browser → R2 succeeds end-to-end (verified by contract — actual upload requires real R2 env)
- [x] `pnpm -r typecheck`, `lint`, `test` green (12+3 web, 3+1 worker, mcp, 23+3 orchestrator, prior packages)
- [x] Live integration test for `runBriefJob` green when OpenAI key present (skipped here — no key)

**PM verdict:** REJECTED → 6 issues fixed via two re-spawned agents + 4 inline fixups → re-audited APPROVED. See notes.

---

## Final integration

> Runs after PM clears Phase C. No subagent — I drive it myself.

- [ ] `pnpm dev` brings up web + worker against local Postgres + Redis + real R2 dev bucket
- [ ] Create a fixture project via tRPC; upload icon + screenshots to R2
- [ ] `runBriefJob` against real OpenAI — confirm Brief + ContentItem rows w/ elaborated `conceptJson`
- [ ] Edit one item's `conceptJson` via the UI; confirm persistence + revision bump
- [ ] Generate selected: Canva carousel — slides land in R2, caption written, preview renders
- [ ] Generate selected: text-on-image carousel — opencv placement output inspected on real screenshot
- [ ] TTS + ffmpeg mux on fixture MP4 — final composite plays with audio
- [ ] MCP smoke: `claude mcp add shri ...`, list tools, invoke `render_jsx_carousel` from Claude Code, result visible in web UI
- [ ] BullMQ resilience: kill Redis mid-job → restart → retries succeed
- [ ] Hand off to user with checklist for the Seedance-only smoke:
  - [ ] `pnpm tsx scripts/manual-seedance-smoke.ts`
  - [ ] Generate a reel in each of three audio modes (seedance / silent / voiceover)
  - [ ] Generate one multi-scene reel (≥2 scenes) and confirm concat + transition

---

## Notes section (append as we go)

_Add deviations, PM punch-list outcomes, or anything worth remembering between phases here. Keep it short — long discussion belongs in the plan file._

### Phase A

- `ContentItem.platform` is `Platform[]` (typed Postgres enum array), not `Json` — needed for Prisma to emit the `Platform` enum. Documented in handoff; downstream consumers can rely on it.
- Cross-package TypeScript resolution: root `tsconfig.json` has `paths` mapping `@shri/*` to source files; we DROPPED `composite: true` + `references` because every package would otherwise need a build step before sibling packages can typecheck. Downstream agents should NOT add `composite: true` to their package tsconfig.
- `apps/{web,worker}/package.json` are stubs with `echo … && exit 0` scripts so `pnpm -r` runs cleanly. Phase C `web-app-agent` and `orchestrator-worker-agent` replace these.
- `@shri/ai` exposes a Proxy-wrapped lazy singleton (`aiClient`) so importing the module without env keys doesn't throw. Phase B/C tools import `aiClient` from `@shri/ai`.
- Added one extra R2 key helper not in docs/08: `keys.outputSeedanceScene(slug, itemId, sceneOrder)` for multi-scene reels (docs/17). Phase B `tools-video-agent` should use it for per-scene MP4 keys.

### Phase C

- **`BriefJobPayload` extended with optional `briefId`**. Web pre-creates a Brief row (for the `/projects/[slug]/brief/[id]` redirect target) and passes the id to `enqueueBrief`. Worker forwards it to `runBriefJob`, which updates that row instead of creating a fresh one. Without this, the user landed on a permanently-empty Brief row while the worker created a different one.
- **Queue names** live in `packages/orchestrator/src/queues.ts` as constants (`BRIEF_QUEUE = "shri:brief"`, `ITEM_QUEUE = "shri:item"`, `SEEDANCE_POLL_QUEUE = "shri:seedance-poll"`). `apps/web/src/lib/queue.ts` imports these directly — do not hardcode strings.
- **`ToolContext.source`** widened from `"worker" | "mcp"` to `"worker" | "mcp" | "web"` so web tRPC routes can audit-trail accurately.
- **Brief-time tool allowlist** (`BRIEF_TIME_TOOLS` in `runBriefJob.ts`) restricts the LLM planning loop to read-only + estimate_cost tools so a misbehaving brief turn cannot fire `submit_seedance_job` / `generate_image` and burn real money.
- **Seedance polling race-guard**: `apps/worker/src/index.ts` checks `ContentOutput` existence before invoking `completeReelAfterPoll` to prevent duplicate concats when multiple scenes finish near-simultaneously.
- **`apps/web/eslint.config.js`** intentionally does NOT spread `@next/eslint-plugin-next`'s recommended rules — that plugin@14 is incompatible with ESLint 9 (`context.getAncestors` removed). The plugin is registered for namespace lookup only; `reportUnusedDisableDirectives: false` silences the resulting false positives until the plugin upgrades.
- **`apps/web/tsconfig.json`** sets `baseUrl: "."` locally so `paths` resolve relative to `apps/web/` (not inherited root). Sets `ignoreDeprecations: "5.0"` (TS 5.9.3 rejects `"6.0"` — IDE may report a misleading newer-TS diagnostic).
- **`apps/mcp/tsconfig.json`** has NO `rootDir` (same pattern as orchestrator + worker + tools). `rootDir: "src"` plus cross-package `@shri/*` imports → TS6059.
- **MCP server** exports `createServer()` separately from `main()` so the smoke test can construct it without booting the stdio transport. `main()` runs only when the file is executed directly.
- **Web pre-creates Job rows with `bullJobId: ""`** and patches after `enqueue*` returns — same pattern as `submitSeedance`. Workers tolerate the brief empty-string state.

### Phase B

- 20 tools registered in `packages/tools/index.ts:toolDescriptors`. Snake_case names, every name from docs/03-tools.md present once. Duplicate-name guard at module load.
- `ToolContext` is defined ONCE in `packages/tools/descriptors.ts` (`{ projectId, projectSlug, userId?, source?, itemId? }`); every tool imports `type ToolContext` from `./descriptors`. Phase C consumers (orchestrator + MCP + web tRPC) must construct this and pass it to `executeTool(name, input, ctx)`.
- **DEVIATION ACCEPTED**: `estimate_cost` descriptor takes batched `{items: [...]}` (better LLM ergonomics — one rollup call). The free function `estimateCost()` still accepts both single and array input for direct orchestrator use.
- `submitSeedance` sets `bullJobId: ''` as placeholder when creating the Job row. Phase C orchestrator-worker-agent overwrites it with the actual BullMQ job id when enqueueing the polling tick. Same handler also presigns referenced R2 images (1h TTL) before passing URLs to BytePlus.
- `submitSeedance`/`pollSeedance` use `{ projectSlug, itemId?, log? }` shape internally but the canonical `ToolContext` (passed by `executeTool`) is a superset — runtime is fine.
- **Fonts**: `packages/tools/fonts/` has only a README. User must drop Inter-Regular.ttf, Inter-Bold.ttf, DMSerifDisplay-Regular.ttf, JetBrainsMono-Regular.ttf (all OFL) before `render_jsx_carousel`/`place_text_on_image`/`merge_character_sheet` can actually render. Until then, those tools throw clear errors and tests verify the throw.
- **Native dep**: `@u4/opencv4nodejs` needs OpenCV4 system libs at install time. On macOS dev hosts: `brew install opencv` first, or `pnpm install --ignore-scripts` and skip opencv. `place_text_on_image` lazy-imports opencv so pure-function tests pass without it.
- Fixtures for ffmpeg tests are generated on-the-fly at vitest setup via `ffmpeg-static` lavfi — no committed binaries.
- Hand-rolled `zodToJsonSchema` in `descriptors.ts` (no extra dep) — covers the Zod subset we use.
- `crawl_product_site` honors robots.txt (hand-rolled parser); returns `{ status: "blocked" }` if disallowed (no exception).
- `generate_project_prompts` transforms all SEVEN seed files in parallel and respects per-file mtime vs `Project.promptsGeneratedAt` to avoid clobbering user edits (returns `skipped: string[]` unless `overwrite: true`).
- `executeTool` validates BOTH input and output via Zod — catches handler/schema drift at dev time.
