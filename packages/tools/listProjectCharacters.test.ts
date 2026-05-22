import { describe, it, expect } from "vitest";
import { inputSchema, outputSchema } from "./listProjectCharacters.js";

describe("list_project_characters — schema", () => {
  it("accepts empty input and applies defaults", () => {
    const r = inputSchema.parse({});
    expect(r.includeUnready).toBe(true);
    expect(r.signedUrlTtlSec).toBe(3600);
  });

  it("accepts an explicit projectId override", () => {
    const r = inputSchema.parse({ projectId: "p123" });
    expect(r.projectId).toBe("p123");
  });

  it("rejects non-positive TTL", () => {
    expect(
      inputSchema.safeParse({ signedUrlTtlSec: 0 }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({ signedUrlTtlSec: -1 }).success,
    ).toBe(false);
  });

  it("output schema validates a non-empty character list with nullable urls", () => {
    const ok = outputSchema.safeParse({
      characters: [
        {
          id: "c1",
          name: "Maya",
          species: "human",
          age: "28",
          gender: "woman",
          visualStyle: "soft pastel",
          description: "round glasses",
          status: "READY",
          sheetR2Key: "k",
          sheetUrl: "https://signed/url",
          baseR2Key: "kb",
          baseUrl: "https://signed/base",
        },
        {
          id: "c2",
          name: "Fox",
          species: null,
          age: null,
          gender: null,
          visualStyle: null,
          description: "friendly fox",
          status: "DRAFTING",
          sheetR2Key: null,
          sheetUrl: null,
          baseR2Key: null,
          baseUrl: null,
        },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("output schema rejects an unknown status", () => {
    const bad = outputSchema.safeParse({
      characters: [
        {
          id: "c1",
          name: "x",
          species: null,
          age: null,
          gender: null,
          visualStyle: null,
          description: "x",
          status: "PENDING",
          sheetR2Key: null,
          sheetUrl: null,
          baseR2Key: null,
          baseUrl: null,
        },
      ],
    });
    expect(bad.success).toBe(false);
  });
});
