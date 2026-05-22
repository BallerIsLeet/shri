import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ALLOWED_PROMPT_FILES,
  ensureProjectPrompts,
  readProjectPrompt,
  writeProjectPrompt,
} from "./index.js";

let tmpDir = "";
const SAVED_PROMPTS_DIR = process.env.PROMPTS_DIR;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shri-prompts-fs-"));
  process.env.PROMPTS_DIR = tmpDir;
});

afterEach(async () => {
  if (SAVED_PROMPTS_DIR === undefined) delete process.env.PROMPTS_DIR;
  else process.env.PROMPTS_DIR = SAVED_PROMPTS_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("ALLOWED_PROMPT_FILES", () => {
  it("contains exactly the seven canonical files", () => {
    expect([...ALLOWED_PROMPT_FILES].sort()).toEqual(
      [
        "carousel-plan.md",
        "director-brief.md",
        "image-caption.md",
        "text-overlay-copy.md",
        "theme-story.md",
        "video-plan.md",
        "video-prompt.md",
      ].sort(),
    );
  });
});

describe("writeProjectPrompt + readProjectPrompt", () => {
  it("round-trips an allowlisted file", async () => {
    await writeProjectPrompt("alpha", "director-brief.md", "# hello");
    const read = await readProjectPrompt("alpha", "director-brief.md");
    expect(read).toBe("# hello");
  });

  it("rejects writes to a non-allowlisted filename", async () => {
    await expect(
      writeProjectPrompt("alpha", "secrets.md", "leak"),
    ).rejects.toThrow(/disallowed prompt file/);
  });

  it("rejects reads of a non-allowlisted filename", async () => {
    await expect(readProjectPrompt("alpha", "../etc/passwd")).rejects.toThrow(
      /disallowed prompt file/,
    );
  });

  it("rejects path-traversal slugs", async () => {
    await expect(
      writeProjectPrompt("../escape", "director-brief.md", "x"),
    ).rejects.toThrow(/invalid project slug/);
    await expect(
      writeProjectPrompt("foo/bar", "director-brief.md", "x"),
    ).rejects.toThrow(/invalid project slug/);
  });

  it("writes atomically (no .tmp residue under the project dir)", async () => {
    await writeProjectPrompt("beta", "video-plan.md", "content");
    const entries = await fs.readdir(path.join(tmpDir, "beta"));
    expect(entries).toContain("video-plan.md");
    // Atomic-write helpers leave nothing behind on success.
    expect(entries.some((e) => e.includes(".tmp"))).toBe(false);
  });
});

describe("ensureProjectPrompts", () => {
  it("copies all seven defaults into a fresh project directory", async () => {
    await ensureProjectPrompts("seed-test");
    const entries = (await fs.readdir(path.join(tmpDir, "seed-test"))).sort();
    expect(entries).toEqual([...ALLOWED_PROMPT_FILES].sort());
    // Sanity: every copy has non-empty content from the real seed templates.
    for (const f of ALLOWED_PROMPT_FILES) {
      const body = await fs.readFile(path.join(tmpDir, "seed-test", f), "utf8");
      expect(body.length).toBeGreaterThan(100);
    }
  });

  it("does not overwrite existing personalised copies", async () => {
    await writeProjectPrompt(
      "personalised",
      "director-brief.md",
      "USER EDITED — keep me",
    );
    await ensureProjectPrompts("personalised");
    const body = await readProjectPrompt("personalised", "director-brief.md");
    expect(body).toBe("USER EDITED — keep me");
    // But the other six are still seeded.
    const entries = (await fs.readdir(path.join(tmpDir, "personalised"))).sort();
    expect(entries).toEqual([...ALLOWED_PROMPT_FILES].sort());
  });
});
