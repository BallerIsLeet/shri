import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeBriefSystemPrompt,
  loadProjectPrompts,
  ALLOWED_PROMPT_FILES,
} from "./loadProjectPrompts.js";

// Real filesystem; we point PROMPTS_DIR at a tmp dir for isolation.
let workDir = "";
let originalPromptsDir: string | undefined;
const slug = "load-prompts-test";

const seeds: Record<string, string> = {
  "director-brief.md": "# Director\n\nbe a director.",
  "carousel-plan.md": "# Carousel\n\nplan carousels.",
  "video-plan.md": "# Video\n\nplan videos.",
  "image-caption.md": "# Caption\n\nwrite captions.",
  "text-overlay-copy.md": "# Overlay\n\nwrite overlays.",
  "video-prompt.md": "# Seedance\n\nprompt seedance.",
  "theme-story.md":
    "# Theme\n\n## Setting\n\nA warm kitchen.\n\n## Visual palette\n\nWarm earth tones.\n",
};

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "shri-load-prompts-"));
  originalPromptsDir = process.env.PROMPTS_DIR;
  process.env.PROMPTS_DIR = workDir;
  const projDir = join(workDir, slug);
  await mkdir(projDir, { recursive: true });
  for (const [name, content] of Object.entries(seeds)) {
    await writeFile(join(projDir, name), content, "utf8");
  }
});

afterAll(async () => {
  if (originalPromptsDir === undefined) {
    delete process.env.PROMPTS_DIR;
  } else {
    process.env.PROMPTS_DIR = originalPromptsDir;
  }
  await rm(workDir, { recursive: true, force: true });
});

describe("loadProjectPrompts", () => {
  it("reads all seven files into the typed shape", async () => {
    const prompts = await loadProjectPrompts(slug);
    expect(prompts.directorBrief).toContain("be a director");
    expect(prompts.carouselPlan).toContain("plan carousels");
    expect(prompts.videoPlan).toContain("plan videos");
    expect(prompts.imageCaption).toContain("write captions");
    expect(prompts.textOverlayCopy).toContain("write overlays");
    expect(prompts.videoPrompt).toContain("prompt seedance");
    expect(prompts.themeStory).toContain("Warm earth tones");
  });

  it("covers exactly the seven allowlisted filenames", () => {
    expect(ALLOWED_PROMPT_FILES.length).toBe(7);
    expect(new Set(ALLOWED_PROMPT_FILES)).toEqual(
      new Set(Object.keys(seeds)),
    );
  });

  it("rejects when any file is missing — surfaces a real error, no silent default", async () => {
    const missingSlug = "load-prompts-missing";
    const dir = join(workDir, missingSlug);
    await mkdir(dir, { recursive: true });
    // Only write six of seven.
    for (const [name, content] of Object.entries(seeds).slice(0, 6)) {
      await writeFile(join(dir, name), content, "utf8");
    }
    await expect(loadProjectPrompts(missingSlug)).rejects.toThrow();
  });
});

describe("composeBriefSystemPrompt", () => {
  it("includes the director, carousel, video, and theme sections in order", async () => {
    const prompts = await loadProjectPrompts(slug);
    const composed = composeBriefSystemPrompt(prompts);
    expect(composed.indexOf("# Director's brief")).toBeGreaterThanOrEqual(0);
    expect(composed.indexOf("# Carousel plan")).toBeGreaterThan(
      composed.indexOf("# Director's brief"),
    );
    expect(composed.indexOf("# Video plan")).toBeGreaterThan(
      composed.indexOf("# Carousel plan"),
    );
    expect(composed.indexOf("# Theme & story")).toBeGreaterThan(
      composed.indexOf("# Video plan"),
    );
    // image/text-overlay/seedance live at item-time, not brief-time.
    expect(composed).not.toContain("write captions");
    expect(composed).not.toContain("write overlays");
    expect(composed).not.toContain("prompt seedance");
  });
});
