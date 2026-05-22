// Cost-estimation constants for the studio. Single source of truth; consumed by
// estimateCost.ts and any UI that needs to display per-content cost.
//
// These are intentionally rough — directional signal ("is this $3 or $30?")
// rather than billing. See docs/10-cost-and-pricing.md for the recalibration
// procedure and how they interact with actual `Job.costUsd` post-hoc.
//
// Constants honor the names listed in the tools-video-agent spec. Where the
// docs use longer names (e.g. CAROUSEL_CANVA_PER_SLIDE), the equivalent here
// is the umbrella CAROUSEL_PER_SLIDE — both carousel types share the same
// rough cost driver (one image-gen per slide).

export const PRICING = {
  CAROUSEL_PER_SLIDE: 0.04,
  REEL_SEEDANCE_PER_SECOND: 0.5,
  REEL_VOICEOVER_TTS_FLAT: 0.02,
  // ffmpeg concat is local — no API cost. Kept as a named constant so
  // estimateCost reads cleanly even when the value is zero.
  REEL_CONCAT_PER_TRANSITION: 0.0,
  BRIEF_PLANNING_FLAT: 0.03,
} as const;

export type Pricing = typeof PRICING;
