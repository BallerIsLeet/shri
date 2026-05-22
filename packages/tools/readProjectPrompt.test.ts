import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeProjectPrompt } from "@shri/prompts-fs";
import { handler, inputSchema } from "./readProjectPrompt.js";

let tmpDir = "";
const SAVED = process.env.PROMPTS_DIR;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shri-tools-read-"));
  process.env.PROMPTS_DIR = tmpDir;
});
afterEach(async () => {
  if (SAVED === undefined) delete process.env.PROMPTS_DIR;
  else process.env.PROMPTS_DIR = SAVED;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("readProjectPrompt", () => {
  it("reads a previously-written allowlisted file", async () => {
    await writeProjectPrompt("alpha", "director-brief.md", "# brief content");
    const result = await handler(
      { projectSlug: "alpha", file: "director-brief.md" },
      { projectId: "x", projectSlug: "alpha" },
    );
    expect(result.file).toBe("director-brief.md");
    expect(result.content).toBe("# brief content");
  });

  it("schema rejects unknown filenames at the boundary", () => {
    expect(() =>
      inputSchema.parse({ projectSlug: "alpha", file: "secrets.md" }),
    ).toThrow();
  });

  it("propagates fs errors when the file is missing", async () => {
    await expect(
      handler(
        { projectSlug: "no-such-project", file: "director-brief.md" },
        { projectId: "x", projectSlug: "no-such-project" },
      ),
    ).rejects.toThrow();
  });
});
