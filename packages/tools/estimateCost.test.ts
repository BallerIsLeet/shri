import { describe, expect, it } from "vitest";
import {
  estimateCost,
  handler as estimateCostHandler,
  inputSchema,
  outputSchema,
  type EstimateCostInput,
} from "./estimateCost.js";
import { PRICING } from "./pricing.js";

describe("estimateCost — carousels", () => {
  it("CAROUSEL_CANVA: cost = slides × CAROUSEL_PER_SLIDE", () => {
    const input: EstimateCostInput = {
      type: "CAROUSEL_CANVA",
      conceptJson: { slides: [{}, {}, {}, {}, {}] }, // 5 slides
    };
    const res = estimateCost(input);
    if (Array.isArray(res) || "items" in res) throw new Error("unexpected array result");
    expect(res.usd).toBeCloseTo(0.04 * 5, 6);
    expect(res.breakdown.slides).toBe(5);
    expect(res.breakdown.perSlideUsd).toBe(PRICING.CAROUSEL_PER_SLIDE);
  });

  it("CAROUSEL_TEXT_OVERLAY: same per-slide rate", () => {
    const res = estimateCost({
      type: "CAROUSEL_TEXT_OVERLAY",
      conceptJson: { slides: [{}, {}, {}] },
    });
    if ("items" in res) throw new Error("unexpected array result");
    expect(res.usd).toBeCloseTo(0.04 * 3, 6);
    expect(res.breakdown.slides).toBe(3);
  });

  it("carousel with no slides field treated as zero slides", () => {
    const res = estimateCost({
      type: "CAROUSEL_CANVA",
      conceptJson: { hook: "no slides yet" },
    });
    if ("items" in res) throw new Error("unexpected array result");
    expect(res.usd).toBe(0);
    expect(res.breakdown.slides).toBe(0);
  });
});

describe("estimateCost — single-scene REEL", () => {
  it("uses top-level durationS when no scenes array", () => {
    const res = estimateCost({
      type: "REEL",
      conceptJson: { durationS: 8, audioMode: "seedance" },
    });
    if ("items" in res) throw new Error("unexpected array result");
    expect(res.breakdown.seedanceSeconds).toBe(8);
    expect(res.breakdown.seedanceUsd).toBeCloseTo(0.5 * 8, 6);
    expect(res.breakdown.voiceoverUsd).toBe(0);
    expect(res.breakdown.transitionsCount).toBe(0);
    expect(res.usd).toBeCloseTo(4, 6);
  });

  it("defaults to 8 seconds when no duration info provided", () => {
    const res = estimateCost({
      type: "REEL",
      conceptJson: {},
    });
    if ("items" in res) throw new Error("unexpected array result");
    expect(res.breakdown.seedanceSeconds).toBe(8);
    expect(res.usd).toBeCloseTo(0.5 * 8, 6);
  });

  it("adds voiceover surcharge when audioMode = voiceover", () => {
    const res = estimateCost({
      type: "REEL",
      conceptJson: { durationS: 6, audioMode: "voiceover" },
    });
    if ("items" in res) throw new Error("unexpected array result");
    expect(res.breakdown.voiceoverUsd).toBe(PRICING.REEL_VOICEOVER_TTS_FLAT);
    expect(res.usd).toBeCloseTo(0.5 * 6 + 0.02, 6);
  });

  it("no voiceover surcharge for silent or seedance modes", () => {
    const silent = estimateCost({
      type: "REEL",
      conceptJson: { durationS: 6, audioMode: "silent" },
    });
    if ("items" in silent) throw new Error("unexpected");
    expect(silent.breakdown.voiceoverUsd).toBe(0);
  });
});

describe("estimateCost — multi-scene REEL", () => {
  it("sums scene durations × per-second cost", () => {
    const res = estimateCost({
      type: "REEL",
      conceptJson: {
        audioMode: "seedance",
        scenes: [
          { order: 1, durationS: 3 },
          { order: 2, durationS: 3 },
          { order: 3, durationS: 4 },
        ],
      },
    });
    if ("items" in res) throw new Error("unexpected array result");
    expect(res.breakdown.seedanceSeconds).toBe(10);
    expect(res.breakdown.seedanceUsd).toBeCloseTo(0.5 * 10, 6);
    expect(res.breakdown.transitionsCount).toBe(2); // n-1 boundaries
    expect(res.breakdown.transitionsUsd).toBe(0); // local ffmpeg
    expect(res.usd).toBeCloseTo(5, 6);
  });

  it("multi-scene + voiceover: sums seconds + flat TTS", () => {
    const res = estimateCost({
      type: "REEL",
      conceptJson: {
        audioMode: "voiceover",
        scenes: [
          { order: 1, durationS: 5 },
          { order: 2, durationS: 5 },
        ],
      },
    });
    if ("items" in res) throw new Error("unexpected array result");
    expect(res.breakdown.seedanceSeconds).toBe(10);
    expect(res.breakdown.voiceoverUsd).toBe(0.02);
    expect(res.breakdown.transitionsCount).toBe(1);
    expect(res.usd).toBeCloseTo(0.5 * 10 + 0.02 + 0, 6);
  });

  it("scenes array of length 1 still computes as multi-scene-shaped (0 transitions)", () => {
    const res = estimateCost({
      type: "REEL",
      conceptJson: {
        audioMode: "seedance",
        scenes: [{ order: 1, durationS: 7 }],
      },
    });
    if ("items" in res) throw new Error("unexpected array result");
    expect(res.breakdown.seedanceSeconds).toBe(7);
    expect(res.breakdown.transitionsCount).toBe(0);
    expect(res.usd).toBeCloseTo(0.5 * 7, 6);
  });
});

describe("estimateCost — array input", () => {
  it("sums per-item costs and returns each breakdown", () => {
    const res = estimateCost([
      { type: "CAROUSEL_CANVA", conceptJson: { slides: [{}, {}] } },
      { type: "REEL", conceptJson: { durationS: 6, audioMode: "voiceover" } },
    ]);
    if (!("items" in res)) throw new Error("expected array result");
    expect(res.items).toHaveLength(2);
    expect(res.items[0]?.usd).toBeCloseTo(0.04 * 2, 6);
    expect(res.items[1]?.usd).toBeCloseTo(0.5 * 6 + 0.02, 6);
    expect(res.usd).toBeCloseTo(0.04 * 2 + 0.5 * 6 + 0.02, 6);
  });
});

describe("estimateCost — schema validation", () => {
  it("rejects unknown ContentType at the input boundary", () => {
    expect(() =>
      estimateCost({
        // @ts-expect-error intentional bad type
        type: "POSTER",
        conceptJson: {},
      }),
    ).toThrow();
  });
});

describe("estimateCost — descriptor surface (handler/inputSchema/outputSchema)", () => {
  it("inputSchema accepts an items array, rejects empty", () => {
    expect(
      inputSchema.safeParse({
        items: [{ type: "CAROUSEL_CANVA", conceptJson: { slides: [{}, {}] } }],
      }).success,
    ).toBe(true);
    expect(inputSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it("handler returns a per-item breakdowns array + summed usd", async () => {
    const out = await estimateCostHandler(
      {
        items: [
          { type: "CAROUSEL_CANVA", conceptJson: { slides: [{}, {}] } },
          {
            type: "REEL",
            conceptJson: {
              audioMode: "voiceover",
              scenes: [
                { order: 1, durationS: 3 },
                { order: 2, durationS: 5 },
              ],
            },
          },
        ],
      },
      { projectId: "p", projectSlug: "p" },
    );
    expect(out.breakdowns).toHaveLength(2);
    expect(out.breakdowns[0]?.type).toBe("CAROUSEL_CANVA");
    expect(out.breakdowns[0]?.usd).toBeCloseTo(0.04 * 2, 6);
    expect(out.breakdowns[1]?.type).toBe("REEL");
    expect(out.breakdowns[1]?.usd).toBeCloseTo(0.5 * 8 + 0.02, 6);
    expect(out.usd).toBeCloseTo(0.04 * 2 + 0.5 * 8 + 0.02, 6);
    // Sanity: output validates against outputSchema.
    expect(outputSchema.safeParse(out).success).toBe(true);
  });
});
