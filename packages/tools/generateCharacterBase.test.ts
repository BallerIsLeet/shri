import { describe, it, expect } from "vitest";
import { buildBasePrompt, inputSchema, outputSchema } from "./generateCharacterBase.js";

describe("generate_character_base — schema", () => {
  it("requires characterId", () => {
    expect(inputSchema.safeParse({}).success).toBe(false);
    expect(inputSchema.safeParse({ characterId: "" }).success).toBe(false);
    expect(inputSchema.safeParse({ characterId: "c1" }).success).toBe(true);
  });

  it("output schema validates", () => {
    const ok = outputSchema.safeParse({
      r2Key: "k",
      url: "u",
      promptUsed: "p",
      costUsd: 0,
    });
    expect(ok.success).toBe(true);
  });
});

describe("generate_character_base — buildBasePrompt", () => {
  it("includes name, species, age, gender, visual style, and description", () => {
    const p = buildBasePrompt({
      name: "Maya",
      species: "human",
      age: "28",
      gender: "woman",
      visualStyle: "soft pastel watercolor",
      description: "warm brown skin, curly hair pulled back, round glasses",
    });
    expect(p).toContain("Maya");
    expect(p).toContain("human");
    expect(p).toContain("age: 28");
    expect(p).toContain("gender: woman");
    expect(p).toContain("soft pastel watercolor");
    expect(p).toContain("warm brown skin");
    expect(p).toContain("full body");
    expect(p).toContain("Neutral plain background");
  });

  it("survives missing optional fields", () => {
    const p = buildBasePrompt({
      name: "Fox",
      species: null,
      age: null,
      gender: null,
      visualStyle: null,
      description: "a friendly fox mascot",
    });
    expect(p).toContain("Fox");
    expect(p).toContain("character"); // default fallback for species
    expect(p).not.toContain("age:");
    expect(p).not.toContain("Visual style:");
    expect(p).toContain("a friendly fox mascot");
  });
});
