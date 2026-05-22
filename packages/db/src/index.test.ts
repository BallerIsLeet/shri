import { describe, it, expect } from "vitest";
import { prisma } from "./index";
import {
  AssetKind,
  BriefStatus,
  ContentType,
  Platform,
  ItemStatus,
  JobKind,
  JobStatus,
  CharacterStatus,
  CharacterBasisMode,
  CrawlStatus,
} from "@prisma/client";

describe("@shri/db barrel", () => {
  it("exports a Prisma client singleton", () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe("function");
    expect(typeof prisma.$disconnect).toBe("function");
  });

  it("re-uses the same client on subsequent imports", async () => {
    const again = await import("./index");
    expect(again.prisma).toBe(prisma);
  });

  it("re-exports every Prisma-generated enum used in the schema", () => {
    // Listing each enum forces a compile-time + runtime check that the
    // generated client actually carries them — the PM gate's typecheck catches
    // any rename in schema.prisma that would silently break consumers.
    expect(AssetKind.ICON).toBe("ICON");
    expect(BriefStatus.READY).toBe("READY");
    expect(ContentType.REEL).toBe("REEL");
    expect(Platform.TIKTOK).toBe("TIKTOK");
    expect(ItemStatus.PROPOSED).toBe("PROPOSED");
    expect(JobKind.BRIEF).toBe("BRIEF");
    expect(JobStatus.QUEUED).toBe("QUEUED");
    expect(CharacterStatus.READY).toBe("READY");
    expect(CharacterBasisMode.FORM).toBe("FORM");
    expect(CrawlStatus.DONE).toBe("DONE");
  });
});
