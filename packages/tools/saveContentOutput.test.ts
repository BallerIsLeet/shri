import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@shri/db";
import { handler, inputSchema, outputSchema } from "./saveContentOutput.js";

const hasDb = !!process.env.DATABASE_URL;

describe("saveContentOutput schemas", () => {
  it("requires itemId, r2Key, caption", () => {
    expect(() => inputSchema.parse({})).toThrow();
    expect(() =>
      inputSchema.parse({ itemId: "a", r2Key: "k", caption: "c" }),
    ).not.toThrow();
  });
  it("defaults meta to {}", () => {
    const parsed = inputSchema.parse({ itemId: "a", r2Key: "k", caption: "c" });
    expect(parsed.meta).toEqual({});
  });
  it("validates output", () => {
    expect(() =>
      outputSchema.parse({
        outputId: "o",
        itemId: "i",
        r2Key: "k",
        thumbR2Key: null,
        caption: "c",
        createdAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});

describe.skipIf(!hasDb)("saveContentOutput (real Postgres)", () => {
  const slug = `save-output-test-${Date.now()}`;
  let projectId = "";
  let briefId = "";
  let itemId = "";

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        slug,
        name: "Save Output Test",
        description: "test",
        highlights: "test",
      },
    });
    projectId = project.id;
    const brief = await prisma.brief.create({
      data: {
        projectId,
        rangeDays: 7,
        rawJson: { test: true },
      },
    });
    briefId = brief.id;
    const item = await prisma.contentItem.create({
      data: {
        projectId,
        briefId,
        type: "REEL",
        platform: ["TIKTOK"],
        ratio: "9:16",
        hook: "test",
        aiConceptJson: {},
        conceptJson: {},
      },
    });
    itemId = item.id;
  });

  afterAll(async () => {
    await prisma.contentOutput.deleteMany({ where: { itemId } });
    await prisma.contentItem.deleteMany({ where: { projectId } });
    await prisma.brief.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("writes a row and read-after-write returns it", async () => {
    const ctx = { projectId, projectSlug: slug };
    const result = await handler(
      {
        itemId,
        r2Key: `projects/${slug}/outputs/${itemId}/final.mp4`,
        caption: "Hello world",
        meta: { durationS: 8.5, costUsd: 0.42 },
      },
      ctx,
    );
    expect(result.itemId).toBe(itemId);
    expect(result.r2Key).toContain(itemId);
    expect(result.thumbR2Key).toBeNull();

    const reread = await prisma.contentOutput.findUnique({
      where: { id: result.outputId },
    });
    expect(reread).not.toBeNull();
    expect(reread!.caption).toBe("Hello world");
    expect((reread!.meta as { durationS?: number }).durationS).toBe(8.5);
  });

  it("persists thumbR2Key when provided", async () => {
    const ctx = { projectId, projectSlug: slug };
    const result = await handler(
      {
        itemId,
        r2Key: `projects/${slug}/outputs/${itemId}/composite.png`,
        thumbR2Key: `projects/${slug}/thumbs/${itemId}.jpg`,
        caption: "with thumb",
        meta: {},
      },
      ctx,
    );
    expect(result.thumbR2Key).toContain("thumbs/");
  });

  it("throws if the ContentItem doesn't exist", async () => {
    await expect(
      handler(
        {
          itemId: "definitely-not-a-real-id",
          r2Key: "k",
          caption: "c",
          meta: {},
        },
        { projectId, projectSlug: slug },
      ),
    ).rejects.toThrow(/ContentItem not found/);
  });
});
