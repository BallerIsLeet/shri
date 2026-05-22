import { afterAll, beforeAll, describe, expect, it } from "vitest";

// tRPC round-trip tests for item.updateConcept / item.resetConcept.
//
// Test honesty (PHASE.md): NEVER instantiate aiClient or env-throwing helpers
// in the describe body before skipIf — do it inside beforeAll. We similarly
// don't import the tRPC app router at the top level so that `pnpm -r test`
// without DATABASE_URL doesn't blow up at import time.

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("item router — concept edit round-trip", () => {
  let appRouter: typeof import("../../src/server/trpc/routers/_app").appRouter;
  let createContext: typeof import("../../src/server/trpc/init").createContext;
  let prisma: typeof import("@shri/db").prisma;
  let createdProjectId: string | null = null;
  let createdBriefId: string | null = null;
  let createdItemId: string | null = null;

  beforeAll(async () => {
    const router = await import("../../src/server/trpc/routers/_app");
    const init = await import("../../src/server/trpc/init");
    const db = await import("@shri/db");
    appRouter = router.appRouter;
    createContext = init.createContext;
    prisma = db.prisma;

    const project = await prisma.project.create({
      data: {
        slug: `test-edit-${Date.now()}`,
        name: "test edit",
        description: "test",
        highlights: "test",
      },
    });
    createdProjectId = project.id;

    const brief = await prisma.brief.create({
      data: {
        projectId: project.id,
        status: "DRAFTING",
        rangeDays: 7,
        rawJson: {},
      },
    });
    createdBriefId = brief.id;

    const item = await prisma.contentItem.create({
      data: {
        projectId: project.id,
        briefId: brief.id,
        type: "REEL",
        platform: ["TIKTOK"],
        ratio: "9:16",
        hook: "test hook",
        aiConceptJson: {
          hook: "test hook",
          audioMode: "seedance",
          durationS: 8,
        } as object,
        conceptJson: {
          hook: "test hook",
          audioMode: "seedance",
          durationS: 8,
        } as object,
        conceptRevision: 0,
      },
    });
    createdItemId = item.id;
  });

  afterAll(async () => {
    if (!createdProjectId) return;
    // Cascade deletes wipe brief, item, etc.
    await prisma.project.delete({ where: { id: createdProjectId } }).catch(() => undefined);
  });

  it("updateConcept persists conceptJson, bumps revision, leaves aiConceptJson untouched", async () => {
    expect(createdItemId).toBeTruthy();
    const ctx = await createContext();
    const caller = appRouter.createCaller(ctx);

    const updated = await caller.item.updateConcept({
      itemId: createdItemId!,
      conceptJson: {
        hook: "EDITED hook",
        audioMode: "voiceover",
        voiceoverText: "Hello world",
        durationS: 10,
      },
    });

    expect(updated.conceptRevision).toBe(1);
    expect((updated.conceptJson as { hook: string }).hook).toBe("EDITED hook");
    expect((updated.conceptJson as { audioMode: string }).audioMode).toBe("voiceover");
    // The audit-trail field is preserved.
    expect((updated.aiConceptJson as { hook: string }).hook).toBe("test hook");
    expect((updated.aiConceptJson as { audioMode: string }).audioMode).toBe("seedance");
  });

  it("resetConcept copies aiConceptJson back onto conceptJson and bumps the revision", async () => {
    const ctx = await createContext();
    const caller = appRouter.createCaller(ctx);
    const reset = await caller.item.resetConcept({ itemId: createdItemId! });
    expect((reset.conceptJson as { hook: string }).hook).toBe("test hook");
    expect((reset.conceptJson as { audioMode: string }).audioMode).toBe("seedance");
    expect(reset.conceptRevision).toBeGreaterThanOrEqual(2);
  });

  it("listByBrief returns the (edited) item and its current revision", async () => {
    const ctx = await createContext();
    const caller = appRouter.createCaller(ctx);
    const items = await caller.item.listByBrief({ briefId: createdBriefId! });
    expect(items.length).toBe(1);
    const it = items[0]!;
    expect(it.id).toBe(createdItemId);
    expect(it.conceptRevision).toBeGreaterThanOrEqual(2);
  });
});
