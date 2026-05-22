# 10 — Cost & Pricing Estimation

**Purpose:** Document the flat-rate cost model, how it surfaces in the UI, and how to recalibrate the constants once you have real invoices.

---

## The model

Cost estimation is deliberately rough — the goal is to give you "is this $3 or $30?" signal before you click Generate, not to be a billing system.

Constants live in `packages/tools/pricing.ts`:

```ts
export const PRICING = {
  // Per-content estimates
  CAROUSEL_CANVA_PER_SLIDE: 0.04,       // image gen for any photos + cheap Satori
  CAROUSEL_TEXT_OVERLAY_PER_SLIDE: 0.04, // image gen for base image + local opencv
  REEL_SEEDANCE_PER_SECOND: 0.50,        // placeholder; multiplied by SUM(scenes[].durationS) for multi-scene
  REEL_VOICEOVER_ADDON: 0.02,            // TTS for the hook line
  CONCAT_PER_TRANSITION: 0.001,          // negligible — local ffmpeg, only for multi-scene reels

  // Planning — brief LLM now outputs fully elaborated concepts (see docs/16)
  // so brief jobs cost more, but runItemJob no longer hits the LLM.
  BRIEF_PLANNING: 0.12,                  // ~25k tokens chat (elaborated output)

  // Per-tool primitives (informational, used by detailed views)
  IMAGE_GEN_PER_IMAGE: 0.04,
  TTS_PER_SECOND: 0.015,
} as const;
```

The function:

```ts
export function estimateCost(item: ContentItem): number {
  switch (item.type) {
    case "CAROUSEL_CANVA":
      return PRICING.CAROUSEL_CANVA_PER_SLIDE * item.conceptJson.slides.length;
    case "CAROUSEL_TEXT_OVERLAY":
      return PRICING.CAROUSEL_TEXT_OVERLAY_PER_SLIDE * item.conceptJson.slides.length;
    case "REEL": {
      const seconds = item.conceptJson.durationS ?? 8;
      const base = PRICING.REEL_SEEDANCE_PER_SECOND * seconds;
      const voiceover = item.conceptJson.audioMode === "voiceover" ? PRICING.REEL_VOICEOVER_ADDON : 0;
      return base + voiceover;
    }
  }
}
```

That's the whole pricing layer. No per-token math, no GPU-time estimates. The numbers are stable across runs so the table is comparable.

---

## How it surfaces

- **Brief page** — `Brief.estCostUsd` shown in the header. Sum of all proposed items.
- **Selection table** — per-row cost in the rightmost column. Footer shows the live sum as you check boxes.
- **Item detail** — `ContentItem.estCostUsd` shown vs `Job.costUsd` (actual, once available — see below).
- **`/jobs`** — total spend over a date range, summed from `Job.costUsd` across DONE jobs.

The table is the most important surface — it's where you decide what to actually generate. The estimate doesn't need to be precise; it needs to be directionally right.

---

## Actual vs estimated cost

`Job.costUsd` is populated post-hoc when we know the real spend. For most providers we approximate from response metadata:

- **OpenAI** — usage tokens × per-token price = $ exactly.
- **OpenAI image gen** — flat per image, lookup table by model + size.
- **Seedance** — no per-job billing in the API response. We assume `PRICING.REEL_SEEDANCE_PER_SECOND × actual seconds`. Once you have a BytePlus invoice, divide invoice total by total billed seconds and update the constant.

For the brief job, `Job.costUsd` is computed from OpenAI usage tokens.

For item jobs, we sum across every tool call recorded in `Job.logs` and add the Seedance estimate if applicable.

---

## Recalibrating

Quarterly (or after any major API price change):

1. Pull invoices from OpenAI + BytePlus.
2. Pull `SELECT type, COUNT(*) FROM ContentItem WHERE created in period AND status=READY GROUP BY type` from Postgres.
3. Compute real avg cost per type from invoice ÷ count.
4. Update constants in `packages/tools/pricing.ts`.
5. Commit. No DB migration needed — historical `Job.costUsd` values are kept as recorded.

---

## What's deliberately not modeled

- **R2 storage cost** — basically free at our volume. Egress is zero on R2.
- **Postgres / Redis on Railway** — flat addon cost, not per-job.
- **Compute time on Railway** — workers are mostly idle waiting on external APIs. Doesn't dominate.

If any of these become significant, add them as flat monthly overhead in a dashboard, not per-job.

---

## See also
- [02-orchestrator.md](02-orchestrator.md) — where `Job.costUsd` is computed and persisted
- [03-tools.md](03-tools.md) — `estimate_cost` tool descriptor
- [09-web-app.md](09-web-app.md) — where the numbers show up in the UI
