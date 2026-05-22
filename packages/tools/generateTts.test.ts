// generateTts.test.ts — schema tests always; the live OpenAI-driven handler
// path is gated on OPENAI_API_KEY + R2 vars per CLAUDE.md (no mocks, real API
// when keys are present).
//
// We deliberately do NOT run the handler in CI when keys are absent — it would
// require either mocking (forbidden) or a partial fake (still forbidden). The
// schema tests give us deterministic coverage of the input contract regardless.

import { describe, expect, it } from "vitest";
import { inputSchema, outputSchema } from "./generateTts.js";

describe("generateTts inputSchema", () => {
  it("accepts a minimal input with default format = mp3", () => {
    const res = inputSchema.parse({
      projectSlug: "demo",
      itemId: "item_1",
      text: "Hello world.",
    });
    expect(res.format).toBe("mp3");
  });

  it("rejects empty text", () => {
    expect(
      inputSchema.safeParse({
        projectSlug: "demo",
        itemId: "item_1",
        text: "",
      }).success,
    ).toBe(false);
  });

  it("accepts wav format", () => {
    const res = inputSchema.parse({
      projectSlug: "demo",
      itemId: "item_1",
      text: "Hi",
      format: "wav",
    });
    expect(res.format).toBe("wav");
  });

  it("rejects unknown format values", () => {
    expect(
      inputSchema.safeParse({
        projectSlug: "demo",
        itemId: "item_1",
        text: "Hi",
        format: "ogg",
      }).success,
    ).toBe(false);
  });

  it("passes through optional voice override", () => {
    const res = inputSchema.parse({
      projectSlug: "demo",
      itemId: "item_1",
      text: "Hi",
      voice: "echo",
    });
    expect(res.voice).toBe("echo");
  });
});

describe("generateTts outputSchema", () => {
  it("requires r2Key, url, durationS, costUsd", () => {
    const res = outputSchema.safeParse({
      r2Key: "projects/demo/outputs/item_1/voice.mp3",
      url: "https://r2.example.com/x",
      durationS: 2.4,
      costUsd: 0.0001,
    });
    expect(res.success).toBe(true);
  });

  it("rejects missing fields", () => {
    expect(
      outputSchema.safeParse({
        r2Key: "x",
        url: "y",
        durationS: 1,
        // costUsd missing
      }).success,
    ).toBe(false);
  });
});

// Live handler test — opt-in. The handler hits aiClient.tts (real OpenAI) AND
// R2 (real upload), both real or skipped. No mocks anywhere. The R2 portion
// also needs DB? No — generateTts does not write to Prisma; only Seedance
// tools persist Job rows.
const hasOpenAi = !!process.env.OPENAI_API_KEY;
const hasR2 =
  !!process.env.R2_ACCOUNT_ID &&
  !!process.env.R2_ACCESS_KEY_ID &&
  !!process.env.R2_SECRET_ACCESS_KEY &&
  !!process.env.R2_BUCKET &&
  !!process.env.R2_PUBLIC_BASE_URL;

describe.skipIf(!hasOpenAi || !hasR2)(
  "generateTts handler — real OpenAI + real R2",
  () => {
    it("speaks a short phrase, uploads MP3 to R2, returns r2Key+url+duration", async () => {
      // Dynamic import so module load doesn't crash CI without env.
      const { handler } = await import("./generateTts.js");
      const slug = "tts-smoke";
      const itemId = `it_${Date.now()}`;
      const out = await handler(
        {
          projectSlug: slug,
          itemId,
          text: "Hello from the Shri studio test.",
          format: "mp3",
        },
        // Minimal ctx; the meta-agent's ToolContext requires projectId
        // alongside projectSlug. For this smoke we use slug as the id stand-in.
        { projectId: slug, projectSlug: slug, itemId, source: "worker" },
      );
      expect(out.r2Key).toBe(
        `projects/${slug}/outputs/${itemId}/voice.mp3`,
      );
      expect(out.url).toMatch(/^https?:\/\//);
      expect(out.durationS).toBeGreaterThan(0);
    }, 30_000);
  },
);
