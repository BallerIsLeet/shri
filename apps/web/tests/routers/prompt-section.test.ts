import { describe, it, expect } from "vitest";

// Pure helper test — section extraction used by prompt.themeSummary. We mirror
// the helper inline rather than re-export it from the router (which would
// require touching the router solely for testability). If we move the helper
// to a shared lib later this test should import from there.

function extractMarkdownSection(content: string, heading: string): string | null {
  const re = new RegExp(
    `##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
    "i",
  );
  const m = content.match(re);
  if (!m) return null;
  const body = (m[1] ?? "").trim();
  return body || null;
}

const SAMPLE = `# Theme

## Setting
warm domestic interiors, late afternoon

## Mood
nostalgic, slightly playful

## Visual palette
- muted earth
- soft cream
- occasional sage

## Story arc
ordinary → magical
`;

describe("extractMarkdownSection", () => {
  it("pulls a single section by heading", () => {
    expect(extractMarkdownSection(SAMPLE, "Setting")).toBe(
      "warm domestic interiors, late afternoon",
    );
  });
  it("preserves multi-line content", () => {
    expect(extractMarkdownSection(SAMPLE, "Visual palette")).toMatch(
      /muted earth[\s\S]*soft cream[\s\S]*occasional sage/,
    );
  });
  it("returns null for missing sections", () => {
    expect(extractMarkdownSection(SAMPLE, "Nope")).toBeNull();
  });
  it("is case-insensitive on the heading", () => {
    expect(extractMarkdownSection(SAMPLE, "MOOD")).toBe("nostalgic, slightly playful");
  });
});
