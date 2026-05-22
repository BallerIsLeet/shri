import { describe, it, expect } from "vitest";
import {
  composePromptParts,
  extractThemeSections,
  inputSchema,
  outputSchema,
} from "./generateImage.js";

// Pure-function tests (no network) — exercise the bits of generate_image we
// can validate without real OpenAI/R2.
describe("generate_image — schema + prompt composition", () => {
  it("rejects empty prompt at the input boundary", () => {
    const res = inputSchema.safeParse({ prompt: "" });
    expect(res.success).toBe(false);
  });

  it("accepts minimal input and applies defaults", () => {
    const res = inputSchema.parse({ prompt: "a red circle" });
    expect(res.size).toBe("1024x1024");
    expect(res.characterIds).toEqual([]);
    expect(res.includeTheme).toBe(true);
  });

  it("extracts named sections from a theme-story markdown", () => {
    const md = [
      "# Theme & story",
      "",
      "## Setting",
      "Cozy domestic interiors, late afternoon light.",
      "",
      "## Mood",
      "warm, nostalgic.",
      "",
      "## Visual palette",
      "- muted earth",
      "- soft cream",
      "",
      "## Recurring motifs",
      "mug, sticky notes",
    ].join("\n");
    const sections = extractThemeSections(md);
    expect(sections.setting).toContain("Cozy domestic interiors");
    expect(sections.palette).toContain("muted earth");
    expect(sections.motifs).toContain("mug");
  });

  it("returns undefined for missing sections (no throw)", () => {
    const md = "# Theme\n\n## Mood\nwarm";
    const sections = extractThemeSections(md);
    expect(sections.setting).toBeUndefined();
    expect(sections.palette).toBeUndefined();
    expect(sections.motifs).toBeUndefined();
  });

  it("composes prompt with character context first, then base, then theme", () => {
    const out = composePromptParts(
      "A founder at her desk smiling at the camera.",
      { setting: "cozy office", palette: "muted earth, sage", motifs: "mug" },
      'Character "Maya" (human, 28): warm brown skin, round glasses.',
    );
    expect(out).toMatch(/^Character "Maya"/);
    expect(out).toContain("A founder at her desk smiling");
    expect(out).toContain("Setting: cozy office");
    expect(out).toContain("Palette: muted earth, sage");
    expect(out).toContain("Motifs: mug");
    expect(out).toContain("Keep characters visually consistent");
  });

  it("omits the theme block entirely when no theme sections were extracted", () => {
    const out = composePromptParts("just a circle", {}, undefined);
    expect(out).toBe("just a circle");
  });

  it("omits the character reminder when no characters were given", () => {
    const out = composePromptParts("scene", { setting: "x" }, undefined);
    expect(out).not.toContain("Keep characters visually consistent");
    expect(out).toContain("Setting: x");
  });

  it("output schema validates a well-formed result", () => {
    const ok = outputSchema.safeParse({
      r2Key: "projects/foo/outputs/it1/slide-0.png",
      url: "https://r2.example.com/projects/foo/outputs/it1/slide-0.png",
      width: 1024,
      height: 1024,
      promptUsed: "x",
      usedCharacterIds: [],
      costUsd: 0,
    });
    expect(ok.success).toBe(true);
  });
});
