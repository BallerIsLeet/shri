// runBriefJob.test.ts — the centerpiece live integration test for Phase C.
//
// SHAPE TESTS (always run): validateConceptJson + Zod envelope behaviour.
// LIVE INTEGRATION (skipIf no OPENAI_API_KEY + no DATABASE_URL): runs the real
// loop against real OpenAI, persists to real Postgres, then ASSERTS:
//   - Brief row written; ContentItem rows written.
//   - Every ContentItem has populated aiConceptJson AND conceptJson.
//   - Every REEL ContentItem has cameraPerspective with all 5 sub-fields on
//     every scene.
//   - environment block + scenes array shape valid.
//   - Every CAROUSEL has appropriately shaped concept.
//
// CLAUDE.md convention #4: real OpenAI only, no vi.mock anywhere.
//
// We DO NOT mock fs, fs is real — the test seeds prompts-projects/{slug}/
// in a tmp dir and points PROMPTS_DIR at it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "@shri/db";
import {
  briefEnvelopeSchema,
  canvaCarouselConceptSchema,
  cameraPerspectiveSchema,
  reelConceptSchema,
  textOverlayConceptSchema,
  validateConceptJson,
  composeUserPrompt,
  runBriefJob,
} from "./runBriefJob.js";

const hasOpenAi = !!process.env.OPENAI_API_KEY;
const hasDb = !!process.env.DATABASE_URL;

// ───── Shape tests (no API) ───────────────────────────────────────────────

describe("validateConceptJson — pure", () => {
  it("accepts a fully populated REEL concept with one scene", () => {
    const concept = {
      hook: "test",
      caption: "cap",
      audioMode: "seedance",
      durationS: 8,
      scenes: [
        {
          order: 0,
          durationS: 8,
          seedanceScript: {
            prompt: "a hand reaches into frame",
            cameraPerspective: {
              framing: "close_up",
              angle: "eye_level",
              movement: "dolly_in",
              lens: "macro",
              focus: "shallow_dof",
            },
          },
        },
      ],
    };
    const out = validateConceptJson("REEL", concept) as { scenes: unknown[] };
    expect(out.scenes).toHaveLength(1);
  });

  it("rejects a REEL with missing cameraPerspective.lens", () => {
    const concept = {
      hook: "test",
      caption: "cap",
      audioMode: "seedance",
      durationS: 8,
      scenes: [
        {
          order: 0,
          durationS: 8,
          seedanceScript: {
            prompt: "x",
            cameraPerspective: {
              framing: "close_up",
              angle: "eye_level",
              movement: "dolly_in",
              // lens missing
              focus: "shallow_dof",
            },
          },
        },
      ],
    };
    expect(() => validateConceptJson("REEL", concept)).toThrow(/lens/i);
  });

  it("rejects a REEL with voiceover audioMode but no voiceoverText", () => {
    const concept = {
      hook: "test",
      caption: "cap",
      audioMode: "voiceover",
      // voiceoverText missing
      durationS: 8,
      scenes: [
        {
          order: 0,
          durationS: 8,
          seedanceScript: {
            prompt: "x",
            cameraPerspective: {
              framing: "wide",
              angle: "low",
              movement: "static",
              lens: "normal",
              focus: "deep_dof",
            },
          },
        },
      ],
    };
    expect(() => validateConceptJson("REEL", concept)).toThrow(/voiceoverText/);
  });

  it("accepts a multi-scene REEL (scenes.length >= 2)", () => {
    const cp = {
      framing: "medium",
      angle: "eye_level",
      movement: "dolly_in",
      lens: "normal",
      focus: "shallow_dof",
    };
    const concept = {
      hook: "test",
      caption: "cap",
      audioMode: "seedance",
      durationS: 9,
      environment: { setting: "kitchen", timeOfDay: "morning", mood: "warm" },
      scenes: [
        {
          order: 0,
          durationS: 3,
          seedanceScript: { prompt: "scene 1", cameraPerspective: cp },
          transitionToNext: "match_cut",
        },
        {
          order: 1,
          durationS: 6,
          seedanceScript: { prompt: "scene 2", cameraPerspective: cp },
        },
      ],
    };
    const out = validateConceptJson("REEL", concept) as { scenes: unknown[] };
    expect(out.scenes).toHaveLength(2);
  });

  it("accepts a CAROUSEL_CANVA concept with slides + spec + embeddedImagePrompts", () => {
    const concept = {
      hook: "h",
      caption: "c",
      slides: [
        {
          spec: { width: 1080, height: 1350, layers: [] },
          embeddedImagePrompts: [],
        },
        {
          spec: { width: 1080, height: 1350, layers: [] },
          embeddedImagePrompts: [
            { layerId: "L1", prompt: "photo of x", size: "1024x1024" },
          ],
        },
      ],
    };
    const out = validateConceptJson(
      "CAROUSEL_CANVA",
      concept,
    ) as { slides: unknown[] };
    expect(out.slides).toHaveLength(2);
  });

  it("accepts a CAROUSEL_TEXT_OVERLAY concept with basePrompt + overlayText + textStyle", () => {
    const concept = {
      hook: "h",
      caption: "c",
      basePrompt: "moody photo",
      overlayText: "STOP IT",
      textStyle: {
        font: "Inter-Bold",
        size: 96,
        color: "#fff",
        align: "center",
      },
    };
    const out = validateConceptJson(
      "CAROUSEL_TEXT_OVERLAY",
      concept,
    ) as { basePrompt: string };
    expect(out.basePrompt).toBe("moody photo");
  });

  it("rejects a CAROUSEL_TEXT_OVERLAY with no overlayText", () => {
    const concept = {
      hook: "h",
      caption: "c",
      basePrompt: "x",
      // overlayText missing
      textStyle: { font: "Inter", size: 72, color: "#000" },
    };
    expect(() =>
      validateConceptJson("CAROUSEL_TEXT_OVERLAY", concept),
    ).toThrow();
  });
});

describe("briefEnvelopeSchema", () => {
  it("accepts a minimal valid envelope", () => {
    const env = briefEnvelopeSchema.parse({
      items: [
        {
          type: "REEL",
          platform: ["TIKTOK"],
          ratio: "9:16",
          hook: "h",
          conceptJson: {},
        },
      ],
    });
    expect(env.items).toHaveLength(1);
  });

  it("rejects empty items array", () => {
    expect(() =>
      briefEnvelopeSchema.parse({ items: [] }),
    ).toThrow();
  });
});

describe("cameraPerspectiveSchema (re-exported for shared use)", () => {
  it("enforces all five fields", () => {
    expect(() =>
      cameraPerspectiveSchema.parse({
        framing: "wide",
        angle: "eye_level",
        movement: "static",
        lens: "normal",
        // focus missing
      }),
    ).toThrow();
  });
});

describe("composeUserPrompt", () => {
  it("includes description, highlights, assets, characters, hint", () => {
    const out = composeUserPrompt({
      project: {
        name: "Forget Me Not",
        slug: "forget-me-not",
        description: "A tasks app",
        highlights: "Quick capture; voice notes",
        websiteUrl: "https://example.com",
        crawlJson: { pages: 3 },
      },
      assets: [
        { id: "a1", kind: "ICON", r2Key: "k1", mimeType: "image/png" },
      ],
      characters: [{ id: "c1", name: "Maya", description: "lead user" }],
      rangeDays: 5,
      hint: "Lean playful",
    });
    expect(out).toContain("Forget Me Not");
    expect(out).toContain("Quick capture; voice notes");
    expect(out).toContain("Lean playful");
    expect(out).toContain("Maya");
    expect(out).toContain("ICON");
    expect(out).toContain("Crawl profile");
    expect(out).toContain("cameraPerspective");
  });
});

// ───── Live integration ──────────────────────────────────────────────────

describe.skipIf(!hasOpenAi || !hasDb)(
  "runBriefJob (real OpenAI + real Postgres)",
  () => {
    let workDir = "";
    let originalPromptsDir: string | undefined;
    const slug = `runbrief-test-${Date.now()}`;
    let projectId = "";

    beforeAll(async () => {
      process.env.OPENAI_CHAT_MODEL ??= "gpt-4o-mini";
      process.env.OPENAI_IMAGE_MODEL ??= "gpt-image-1";
      process.env.OPENAI_TTS_MODEL ??= "gpt-4o-mini-tts";
      process.env.OPENAI_TTS_VOICE ??= "alloy";

      // Seed prompts-projects/{slug}/ with the 7 real seed files so the LLM
      // gets actual director-brief / video-plan / etc. content. We resolve
      // the seeds from packages/prompts-fs's seed dir (the repo's /prompts).
      workDir = await mkdtemp(join(tmpdir(), "shri-runbrief-"));
      originalPromptsDir = process.env.PROMPTS_DIR;
      process.env.PROMPTS_DIR = workDir;
      const projDir = join(workDir, slug);
      await mkdir(projDir, { recursive: true });

      // packages/orchestrator/src/<this file> → repo root = three levels up.
      const here = dirname(fileURLToPath(import.meta.url));
      const promptsSeedDir = resolve(here, "..", "..", "..", "prompts");

      const seedFiles = [
        "director-brief.md",
        "carousel-plan.md",
        "video-plan.md",
        "image-caption.md",
        "text-overlay-copy.md",
        "video-prompt.md",
        "theme-story.md",
      ];
      for (const f of seedFiles) {
        const content = await readFile(join(promptsSeedDir, f), "utf8");
        await writeFile(join(projDir, f), content, "utf8");
      }

      const project = await prisma.project.create({
        data: {
          slug,
          name: "RunBrief Integration Test",
          description:
            "A todo app for people who keep forgetting things. Quick capture by voice, smart organization, calm UI.",
          highlights:
            "Voice-first capture; offline-first; warm minimal UI; one-tap task review at end of day",
          websiteUrl: null,
        },
      });
      projectId = project.id;
    }, 60_000);

    afterAll(async () => {
      // Cascade: ContentItem → Brief → Project cleanup
      if (projectId) {
        await prisma.contentItem.deleteMany({ where: { projectId } });
        await prisma.brief.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } });
      }
      await prisma.$disconnect();
      if (originalPromptsDir === undefined) {
        delete process.env.PROMPTS_DIR;
      } else {
        process.env.PROMPTS_DIR = originalPromptsDir;
      }
      if (workDir) await rm(workDir, { recursive: true, force: true });
    }, 30_000);

    it(
      "produces a Brief + ContentItems with elaborated conceptJson + camera perspective on every REEL",
      async () => {
        const res = await runBriefJob({
          projectId,
          rangeDays: 7,
          maxIterations: 6,
        });

        // Brief row exists
        const brief = await prisma.brief.findUnique({
          where: { id: res.briefId },
          include: { items: true },
        });
        expect(brief).not.toBeNull();
        expect(brief!.items.length).toBeGreaterThan(0);
        expect(brief!.items.length).toBe(res.itemIds.length);

        // Every item populated correctly
        for (const item of brief!.items) {
          expect(item.aiConceptJson).not.toBeNull();
          expect(item.conceptJson).not.toBeNull();
          expect(item.hook).toBeTruthy();
          expect(item.platform.length).toBeGreaterThan(0);

          if (item.type === "REEL") {
            const concept = reelConceptSchema.parse(item.conceptJson);
            expect(concept.scenes.length).toBeGreaterThanOrEqual(1);
            for (const scene of concept.scenes) {
              const cp = scene.seedanceScript.cameraPerspective;
              for (const field of [
                "framing",
                "angle",
                "movement",
                "lens",
                "focus",
              ] as const) {
                expect(cp[field]).toBeTruthy();
              }
            }
          } else if (item.type === "CAROUSEL_CANVA") {
            const concept = canvaCarouselConceptSchema.parse(item.conceptJson);
            expect(concept.slides.length).toBeGreaterThanOrEqual(1);
          } else if (item.type === "CAROUSEL_TEXT_OVERLAY") {
            const concept = textOverlayConceptSchema.parse(item.conceptJson);
            expect(concept.basePrompt.length).toBeGreaterThan(0);
            expect(concept.overlayText.length).toBeGreaterThan(0);
          }
        }
      },
      // The brief LLM can chew through several turns + tool calls. Generous
      // ceiling — better to fail loud than flake.
      180_000,
    );
  },
);
