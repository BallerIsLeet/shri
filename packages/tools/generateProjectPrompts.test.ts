import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prisma } from "@shri/db";
import { ALLOWED_PROMPT_FILES, readProjectPrompt } from "@shri/prompts-fs";
import { handler, inputSchema } from "./generateProjectPrompts.js";

const hasDb = !!process.env.DATABASE_URL;
const hasKey = !!process.env.OPENAI_API_KEY;

describe("generateProjectPrompts schemas", () => {
  it("validates a minimal input", () => {
    const parsed = inputSchema.parse({
      projectSlug: "x",
      basis: { description: "d", highlights: "h" },
    });
    expect(parsed.overwrite).toBe(false);
  });
  it("requires description + highlights", () => {
    expect(() =>
      inputSchema.parse({ projectSlug: "x", basis: { description: "d" } }),
    ).toThrow();
  });
});

describe.skipIf(!hasDb || !hasKey)(
  "generateProjectPrompts (real Postgres + real OpenAI)",
  () => {
    let tmpDir = "";
    const SAVED = process.env.PROMPTS_DIR;
    const slug = `gen-prompts-test-${Date.now()}`;
    let projectId = "";

    beforeAll(async () => {
      const project = await prisma.project.create({
        data: {
          slug,
          name: "Gen Prompts Test",
          description: "A demo product for prompt generation",
          highlights: "Fast, focused, free",
        },
      });
      projectId = project.id;
    });

    afterAll(async () => {
      await prisma.projectCrawl.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.$disconnect();
    });

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shri-genprompts-"));
      process.env.PROMPTS_DIR = tmpDir;
    });

    afterEach(async () => {
      if (SAVED === undefined) delete process.env.PROMPTS_DIR;
      else process.env.PROMPTS_DIR = SAVED;
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("writes personalised copies for all seven files", async () => {
      const result = await handler(
        {
          projectSlug: slug,
          basis: {
            description: "Acme Tasks — a calm task manager for solo founders.",
            highlights:
              "Follow-up review, inbox-to-queue capture, no notifications by default.",
            productProfile: {
              name: "Acme Tasks",
              tagline: "Never lose a follow-up",
              features: ["follow-up review", "inbox capture", "no-notifications mode"],
              valueProps: ["close every loop by Friday"],
              targetAudience: "solo founders + tiny teams",
              tone: "warm, calm, direct",
              inferredCategory: "task manager",
            },
            websiteUrl: "https://acme.app",
          },
          overwrite: false,
        },
        { projectId, projectSlug: slug },
      );

      expect(result.written).toBe(true);
      expect(Object.keys(result.files).sort()).toEqual(
        [...ALLOWED_PROMPT_FILES].sort(),
      );

      // Files actually on disk.
      for (const file of ALLOWED_PROMPT_FILES) {
        const back = await readProjectPrompt(slug, file);
        expect(back.length).toBeGreaterThan(100);
      }

      // The brief should have product-aware language — not the verbatim seed
      // placeholder "Replace this section".
      const brief = await readProjectPrompt(slug, "director-brief.md");
      expect(brief.toLowerCase()).toMatch(/acme|task|founder/);

      // Project.promptsGeneratedAt should be set.
      const fresh = await prisma.project.findUnique({
        where: { id: projectId },
        select: { promptsGeneratedAt: true },
      });
      expect(fresh?.promptsGeneratedAt).not.toBeNull();
    }, 180_000);
  },
);
