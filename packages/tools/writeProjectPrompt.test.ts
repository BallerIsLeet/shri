import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readProjectPrompt } from "@shri/prompts-fs";
import { handler, inputSchema } from "./writeProjectPrompt.js";

let tmpDir = "";
const SAVED = process.env.PROMPTS_DIR;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shri-tools-write-"));
  process.env.PROMPTS_DIR = tmpDir;
});
afterEach(async () => {
  if (SAVED === undefined) delete process.env.PROMPTS_DIR;
  else process.env.PROMPTS_DIR = SAVED;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("writeProjectPrompt", () => {
  it("writes a file that readProjectPrompt then returns verbatim", async () => {
    const result = await handler(
      {
        projectSlug: "alpha",
        file: "video-prompt.md",
        content: "# my edited video prompt",
      },
      { projectId: "x", projectSlug: "alpha" },
    );
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(Buffer.byteLength("# my edited video prompt"));

    const back = await readProjectPrompt("alpha", "video-prompt.md");
    expect(back).toBe("# my edited video prompt");
  });

  it("schema rejects unknown filenames at the boundary", () => {
    expect(() =>
      inputSchema.parse({
        projectSlug: "alpha",
        file: "evil.md",
        content: "x",
      }),
    ).toThrow();
  });

  it("schema rejects when content is missing", () => {
    expect(() =>
      inputSchema.parse({
        projectSlug: "alpha",
        file: "director-brief.md",
      }),
    ).toThrow();
  });
});
