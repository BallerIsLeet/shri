import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@shri/db";
import { handler, inputSchema, outputSchema } from "./listProjectAssets.js";

// Real Postgres. Skipped when DATABASE_URL is missing so CI without a DB stays green.
const hasDb = !!process.env.DATABASE_URL;
// Presigned URL generation pulls R2 env; skip when not available.
const hasR2 =
  !!process.env.R2_ACCOUNT_ID &&
  !!process.env.R2_ACCESS_KEY_ID &&
  !!process.env.R2_SECRET_ACCESS_KEY &&
  !!process.env.R2_BUCKET &&
  !!process.env.R2_PUBLIC_BASE_URL;

describe("listProjectAssets schemas", () => {
  it("validates a minimal input", () => {
    const parsed = inputSchema.parse({ projectSlug: "alpha" });
    expect(parsed.signedUrlTtlSec).toBe(3600);
  });
  it("validates the empty output", () => {
    expect(outputSchema.parse({ assets: [] })).toEqual({ assets: [] });
  });
  it("rejects an unknown asset kind", () => {
    expect(() => inputSchema.parse({ projectSlug: "x", kind: "BOGUS" })).toThrow();
  });
});

describe.skipIf(!hasDb || !hasR2)("listProjectAssets (real Postgres + R2)", () => {
  const slug = `list-assets-test-${Date.now()}`;
  let projectId = "";
  let assetId = "";

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        slug,
        name: "List Assets Test",
        description: "test",
        highlights: "test",
      },
    });
    projectId = project.id;
    const asset = await prisma.asset.create({
      data: {
        projectId,
        kind: "ICON",
        r2Key: `projects/${slug}/assets/test.png`,
        mimeType: "image/png",
        width: 512,
        height: 512,
      },
    });
    assetId = asset.id;
  });

  afterAll(async () => {
    await prisma.asset.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("returns the project's assets with presigned URLs", async () => {
    const result = await handler(
      { projectSlug: slug, signedUrlTtlSec: 600 },
      { projectId, projectSlug: slug },
    );
    expect(result.assets.length).toBe(1);
    const a = result.assets[0]!;
    expect(a.id).toBe(assetId);
    expect(a.kind).toBe("ICON");
    expect(a.url).toMatch(/^https?:\/\//);
    // Confirm it round-trips outputSchema (catches drift between handler + schema).
    outputSchema.parse(result);
  });

  it("filters by kind", async () => {
    const result = await handler(
      { projectSlug: slug, kind: "SCREENSHOT", signedUrlTtlSec: 600 },
      { projectId, projectSlug: slug },
    );
    expect(result.assets.length).toBe(0);
  });

  it("throws for a missing project", async () => {
    await expect(
      handler(
        { projectSlug: "does-not-exist-xyz", signedUrlTtlSec: 600 },
        { projectId: "x", projectSlug: "x" },
      ),
    ).rejects.toThrow(/project not found/);
  });
});
