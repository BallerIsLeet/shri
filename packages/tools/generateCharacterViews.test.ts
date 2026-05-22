import { describe, it, expect } from "vitest";
import {
  DEFAULT_POSES,
  buildViewPrompt,
  inputSchema,
  outputSchema,
} from "./generateCharacterViews.js";

describe("generate_character_views — schema", () => {
  it("defaults to the six canonical poses", () => {
    const r = inputSchema.parse({ characterId: "c1" });
    expect(r.poses).toEqual([...DEFAULT_POSES]);
  });

  it("accepts custom poses but rejects empty list", () => {
    expect(
      inputSchema.safeParse({ characterId: "c1", poses: [] }).success,
    ).toBe(false);
    const r = inputSchema.parse({
      characterId: "c1",
      poses: ["jumping", "waving"],
    });
    expect(r.poses).toEqual(["jumping", "waving"]);
  });

  it("rejects empty characterId", () => {
    expect(inputSchema.safeParse({ characterId: "" }).success).toBe(false);
  });

  it("output schema validates", () => {
    const ok = outputSchema.safeParse({
      views: [
        { pose: "front", r2Key: "k", url: "u", order: 0 },
        { pose: "side", r2Key: "k2", url: "u2", order: 1 },
      ],
      totalCostUsd: 0,
    });
    expect(ok.success).toBe(true);
  });
});

describe("generate_character_views — buildViewPrompt", () => {
  it("mentions both the character name and the pose", () => {
    const p = buildViewPrompt("three-quarter", "Maya");
    expect(p).toContain("Maya");
    expect(p).toContain("three-quarter pose");
    expect(p).toContain("Same character as the reference image");
    expect(p).toContain("identical face, outfit");
  });
});
