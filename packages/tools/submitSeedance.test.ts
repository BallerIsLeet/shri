// submitSeedance.test.ts — PURE LOGIC ONLY.
// No HTTP, no DB, no mocks. CLAUDE.md convention #4: no Seedance mocking
// anywhere. The handler-level tests live exclusively in the user-run
// scripts/manual-seedance-smoke.ts (real BytePlus).

import { describe, expect, it } from "vitest";
import {
  buildCameraSentence,
  buildEnvironmentRecap,
  buildRefsSentence,
  cameraPerspectiveSchema,
  composePrompt,
  findMissingRefTags,
  inputSchema,
  referenceSchema,
  type ToolInput,
} from "./submitSeedance.js";

describe("cameraPerspectiveSchema", () => {
  it("accepts all 5 sub-fields with valid enum values", () => {
    const ok = cameraPerspectiveSchema.parse({
      framing: "medium",
      angle: "eye_level",
      movement: "dolly_in",
      lens: "normal",
      focus: "shallow_dof",
    });
    expect(ok.framing).toBe("medium");
    expect(ok.focus).toBe("shallow_dof");
  });

  for (const field of [
    "framing",
    "angle",
    "movement",
    "lens",
    "focus",
  ] as const) {
    it(`REJECTS when '${field}' is missing — convention #3 enforcement`, () => {
      const base = {
        framing: "medium",
        angle: "eye_level",
        movement: "dolly_in",
        lens: "normal",
        focus: "shallow_dof",
      } as Record<string, string>;
      delete base[field];
      const res = cameraPerspectiveSchema.safeParse(base);
      expect(res.success).toBe(false);
      if (!res.success) {
        const issuePaths = res.error.issues.map((i) => i.path.join("."));
        expect(issuePaths).toContain(field);
      }
    });
  }

  it("rejects unknown enum values per field", () => {
    const res = cameraPerspectiveSchema.safeParse({
      framing: "ultra_wide", // not in the enum
      angle: "eye_level",
      movement: "dolly_in",
      lens: "normal",
      focus: "shallow_dof",
    });
    expect(res.success).toBe(false);
  });
});

describe("buildCameraSentence", () => {
  it("formats the canonical sentence with underscores→spaces", () => {
    const s = buildCameraSentence({
      framing: "close_up",
      angle: "eye_level",
      movement: "dolly_in",
      lens: "macro",
      focus: "shallow_dof",
    });
    expect(s).toBe(
      "close up shot, eye level. dolly in camera, macro lens, shallow dof.",
    );
  });

  it("never contains literal underscores in the output", () => {
    const s = buildCameraSentence({
      framing: "extreme_close_up",
      angle: "birds_eye",
      movement: "dolly_out",
      lens: "wide_angle",
      focus: "deep_dof",
    });
    expect(s.includes("_")).toBe(false);
  });
});

describe("buildRefsSentence", () => {
  it("returns empty string for undefined / empty refs", () => {
    expect(buildRefsSentence(undefined)).toBe("");
    expect(buildRefsSentence([])).toBe("");
  });

  it("indexes refs from 1 (capital-I Image)", () => {
    const s = buildRefsSentence([
      { r2Key: "x", role: "the character" },
      { r2Key: "y", role: "the environment" },
    ]);
    expect(s).toBe("@Image1 as the character, @Image2 as the environment.");
  });
});

describe("buildEnvironmentRecap", () => {
  it("returns empty for undefined env", () => {
    expect(buildEnvironmentRecap(undefined)).toBe("");
  });

  it("returns empty when every field is undefined", () => {
    expect(buildEnvironmentRecap({})).toBe("");
  });

  it("composes a recap with setting + time + background + surroundings + mood", () => {
    const recap = buildEnvironmentRecap({
      setting: "warm domestic interior",
      timeOfDay: "golden_hour",
      background: "wooden desk by a window",
      surroundings: "sticky notes, mug, laptop",
      mood: "tired → relieved",
    });
    expect(recap).toContain("warm domestic interior");
    expect(recap).toContain("golden hour"); // underscores stripped
    expect(recap).toContain("Background: wooden desk by a window.");
    expect(recap).toContain("Surroundings: sticky notes, mug, laptop.");
    expect(recap).toContain("Mood: tired → relieved.");
  });

  it("works with a partial env (only setting + mood)", () => {
    const recap = buildEnvironmentRecap({
      setting: "neon city street at night",
      mood: "kinetic, electric",
    });
    expect(recap).toContain("neon city street at night");
    expect(recap).toContain("Mood: kinetic, electric.");
  });
});

describe("composePrompt", () => {
  const cp = {
    framing: "medium",
    angle: "eye_level",
    movement: "dolly_in",
    lens: "normal",
    focus: "shallow_dof",
  } as const;

  it("composes refs + env + body + camera in that order, blank-line separated", () => {
    const input: ToolInput = {
      projectSlug: "demo",
      itemId: "item_1",
      prompt:
        "@Image1 walks toward camera through @Image2 in late afternoon light.",
      cameraPerspective: cp,
      environment: {
        setting: "warm domestic interior",
        timeOfDay: "afternoon",
      },
      references: [
        { r2Key: "k1", role: "the character" },
        { r2Key: "k2", role: "the environment" },
      ],
      generateAudio: true,
      ratio: "9:16",
    };
    const out = composePrompt(input);
    const sections = out.split("\n\n");
    expect(sections).toHaveLength(4);
    expect(sections[0]).toBe(
      "@Image1 as the character, @Image2 as the environment.",
    );
    expect(sections[1]).toContain("warm domestic interior");
    expect(sections[2]).toContain("@Image1 walks toward camera");
    expect(sections[3]).toBe(
      "medium shot, eye level. dolly in camera, normal lens, shallow dof.",
    );
  });

  it("omits refs section when none provided", () => {
    const out = composePrompt({
      projectSlug: "demo",
      itemId: "item_1",
      prompt: "A sunrise over the ocean.",
      cameraPerspective: cp,
      environment: undefined,
      generateAudio: true,
      ratio: "9:16",
    });
    const sections = out.split("\n\n");
    expect(sections).toHaveLength(2); // body + camera only
    expect(sections[0]).toBe("A sunrise over the ocean.");
    expect(sections[1]).toContain("medium shot");
  });

  it("ALWAYS includes a camera sentence (convention #3 in action)", () => {
    const out = composePrompt({
      projectSlug: "demo",
      itemId: "item_1",
      prompt: "Anything.",
      cameraPerspective: cp,
      environment: undefined,
      generateAudio: false,
      ratio: "9:16",
    });
    expect(out).toMatch(/medium shot, eye level\./);
  });
});

describe("findMissingRefTags", () => {
  const cp = {
    framing: "medium",
    angle: "eye_level",
    movement: "static",
    lens: "normal",
    focus: "shallow_dof",
  } as const;

  const base = {
    projectSlug: "demo",
    itemId: "item_1",
    cameraPerspective: cp,
    environment: undefined,
    generateAudio: false,
    ratio: "9:16" as const,
  };

  it("returns [] when every ref has its @ImageN tag in the prompt", () => {
    const missing = findMissingRefTags({
      ...base,
      prompt: "@Image1 sits on @Image2",
      references: [
        { r2Key: "k1", role: "subject" },
        { r2Key: "k2", role: "the bench" },
      ],
    });
    expect(missing).toEqual([]);
  });

  it("flags missing tags", () => {
    const missing = findMissingRefTags({
      ...base,
      prompt: "@Image1 walks alone", // @Image2 not mentioned
      references: [
        { r2Key: "k1", role: "subject" },
        { r2Key: "k2", role: "environment" },
      ],
    });
    expect(missing).toEqual(["@Image2"]);
  });

  it("returns [] for no references", () => {
    const missing = findMissingRefTags({
      ...base,
      prompt: "Anything",
      references: undefined,
    });
    expect(missing).toEqual([]);
  });
});

describe("inputSchema (full top-level)", () => {
  const validCp = {
    framing: "medium" as const,
    angle: "eye_level" as const,
    movement: "static" as const,
    lens: "normal" as const,
    focus: "shallow_dof" as const,
  };

  it("accepts a minimal valid input", () => {
    const res = inputSchema.parse({
      projectSlug: "my-app",
      itemId: "item_abc",
      prompt: "A still wide shot of an empty plaza.",
      cameraPerspective: validCp,
      generateAudio: false,
      ratio: "9:16",
    });
    expect(res.itemId).toBe("item_abc");
  });

  it("rejects input missing cameraPerspective entirely", () => {
    const res = inputSchema.safeParse({
      projectSlug: "my-app",
      itemId: "item_abc",
      prompt: "Anything",
      generateAudio: false,
      ratio: "9:16",
    });
    expect(res.success).toBe(false);
  });

  it("rejects more than 9 references", () => {
    const refs = Array.from({ length: 10 }, (_, i) => ({
      r2Key: `k${i}`,
      role: "x",
    }));
    const res = inputSchema.safeParse({
      projectSlug: "my-app",
      itemId: "item_abc",
      prompt: "Anything",
      cameraPerspective: validCp,
      references: refs,
      generateAudio: false,
      ratio: "9:16",
    });
    expect(res.success).toBe(false);
  });

  it("rejects an invalid ratio", () => {
    const res = inputSchema.safeParse({
      projectSlug: "my-app",
      itemId: "item_abc",
      prompt: "Anything",
      cameraPerspective: validCp,
      generateAudio: false,
      ratio: "4:3",
    });
    expect(res.success).toBe(false);
  });
});

describe("referenceSchema", () => {
  it("requires both r2Key and role to be non-empty", () => {
    expect(referenceSchema.safeParse({ r2Key: "", role: "x" }).success).toBe(false);
    expect(referenceSchema.safeParse({ r2Key: "x", role: "" }).success).toBe(false);
    expect(referenceSchema.safeParse({ r2Key: "x", role: "x" }).success).toBe(true);
  });
});
