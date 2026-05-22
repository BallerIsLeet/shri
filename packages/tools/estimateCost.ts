// estimateCost — pure, deterministic cost calculator.
//
// Inputs are ContentItem-shaped: a `type` discriminator plus the LLM-elaborated
// `conceptJson`. For multi-scene reels this walks `conceptJson.scenes[]` and
// sums per-scene durations × Seedance per-second cost. For single-scene reels
// it falls back to top-level `durationS`. Voiceover adds a flat TTS surcharge;
// transitions are essentially free (ffmpeg local) but tracked for parity with
// docs/17-director-scenes.md.
//
// The function is a single switch on `type`. Adding a new ContentType means
// extending the switch — Zod-side validation kept narrow to keep failures loud.
//
// See docs/10-cost-and-pricing.md and docs/17-director-scenes.md.

import { z } from "zod";
import { PRICING } from "./pricing.js";
import type { ToolContext } from "./descriptors.js";

// ContentType mirrors the Prisma enum; duplicated here to keep estimateCost
// dependency-free from @shri/db at compile time (the cost function is called
// from contexts that don't otherwise need Prisma — e.g. the brief LLM loop
// previewing a plan). Kept narrowly literal so a drift in the Prisma enum
// causes a typecheck error at the call sites that bridge the two.
export const contentTypeSchema = z.enum([
  "CAROUSEL_CANVA",
  "CAROUSEL_TEXT_OVERLAY",
  "REEL",
]);
export type ContentTypeLite = z.infer<typeof contentTypeSchema>;

const sceneSchema = z.object({
  order: z.number().int().nonnegative().optional(),
  durationS: z.number().positive(),
  transitionIn: z
    .enum(["hard_cut", "match_cut", "dissolve", "fade"])
    .optional(),
  transitionToNext: z
    .enum([
      "hard_cut",
      "match_cut",
      "dissolve",
      "fade",
      "fade_to_black",
      "whip_pan",
    ])
    .optional(),
});

const reelConceptSchema = z
  .object({
    audioMode: z.enum(["seedance", "silent", "voiceover"]).optional(),
    durationS: z.number().positive().optional(),
    scenes: z.array(sceneSchema).optional(),
  })
  .passthrough();

const carouselConceptSchema = z
  .object({
    slides: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const estimateCostInputSchema = z.object({
  type: contentTypeSchema,
  // We accept the elaborated conceptJson as opaque-ish JSON; per-type fields
  // are extracted by the matching sub-schema below.
  conceptJson: z.unknown(),
});

export type EstimateCostInput = z.infer<typeof estimateCostInputSchema>;

export type CostBreakdown = {
  type: ContentTypeLite;
  // For carousels:
  slides?: number;
  // For reels:
  seedanceSeconds?: number;
  seedanceUsd?: number;
  voiceoverUsd?: number;
  transitionsCount?: number;
  transitionsUsd?: number;
  // Always:
  perSlideUsd?: number;
};

export type EstimateCostOutput = {
  usd: number;
  breakdown: CostBreakdown;
};

function estimateOne(input: EstimateCostInput): EstimateCostOutput {
  const { type, conceptJson } = input;

  switch (type) {
    case "CAROUSEL_CANVA":
    case "CAROUSEL_TEXT_OVERLAY": {
      const parsed = carouselConceptSchema.safeParse(conceptJson ?? {});
      const slides = parsed.success ? (parsed.data.slides?.length ?? 0) : 0;
      const usd = round(PRICING.CAROUSEL_PER_SLIDE * slides);
      return {
        usd,
        breakdown: {
          type,
          slides,
          perSlideUsd: PRICING.CAROUSEL_PER_SLIDE,
        },
      };
    }

    case "REEL": {
      const parsed = reelConceptSchema.safeParse(conceptJson ?? {});
      const reel = parsed.success ? parsed.data : {};
      const scenes = reel.scenes ?? [];

      // Multi-scene: sum scene durations; single-scene: fall back to top-level
      // durationS or 8s default. Reflects how docs/17 + docs/10 split the cost.
      const seconds =
        scenes.length > 0
          ? scenes.reduce((acc, s) => acc + s.durationS, 0)
          : (reel.durationS ?? 8);

      const seedanceUsd = round(PRICING.REEL_SEEDANCE_PER_SECOND * seconds);

      const voiceoverUsd =
        reel.audioMode === "voiceover" ? PRICING.REEL_VOICEOVER_TTS_FLAT : 0;

      // transitions only exist when there are >= 2 scenes; n-1 boundaries.
      const transitionsCount =
        scenes.length >= 2 ? scenes.length - 1 : 0;
      const transitionsUsd = round(
        PRICING.REEL_CONCAT_PER_TRANSITION * transitionsCount,
      );

      const usd = round(seedanceUsd + voiceoverUsd + transitionsUsd);

      return {
        usd,
        breakdown: {
          type,
          seedanceSeconds: seconds,
          seedanceUsd,
          voiceoverUsd,
          transitionsCount,
          transitionsUsd,
        },
      };
    }
  }
}

export function estimateCost(
  input: EstimateCostInput | EstimateCostInput[],
): EstimateCostOutput | { usd: number; items: EstimateCostOutput[] } {
  if (Array.isArray(input)) {
    const items = input.map((it) => estimateOne(estimateCostInputSchema.parse(it)));
    const usd = round(items.reduce((acc, r) => acc + r.usd, 0));
    return { usd, items };
  }
  return estimateOne(estimateCostInputSchema.parse(input));
}

// -----------------------------------------------------------------------------
// Tool-descriptor surface — matches the contract in descriptors.ts so the
// meta-agent's index.ts can wrap this file via the standard pattern. The
// `items` input lets the LLM ask for a single rollup across many planned
// content pieces in one call.
// -----------------------------------------------------------------------------

export const inputSchema = z.object({
  items: z.array(estimateCostInputSchema).min(1),
});

export type ToolInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  usd: z.number(),
  breakdowns: z.array(
    z.object({
      type: contentTypeSchema,
      usd: z.number(),
      slides: z.number().optional(),
      seedanceSeconds: z.number().optional(),
      seedanceUsd: z.number().optional(),
      voiceoverUsd: z.number().optional(),
      transitionsCount: z.number().optional(),
      transitionsUsd: z.number().optional(),
      perSlideUsd: z.number().optional(),
    }),
  ),
});

export type ToolOutput = z.infer<typeof outputSchema>;

export async function handler(
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutput> {
  const input = inputSchema.parse(rawInput);
  void ctx; // pure; ctx unused
  const perItem = input.items.map((it) => estimateOne(it));
  const usd = round(perItem.reduce((acc, r) => acc + r.usd, 0));
  return {
    usd,
    breakdowns: perItem.map((r) => ({ ...r.breakdown, usd: r.usd })),
  };
}

function round(n: number): number {
  // 4-decimal rounding keeps tiny transition cost visible without floating
  // noise; UI can format to 2dp.
  return Math.round(n * 10_000) / 10_000;
}
