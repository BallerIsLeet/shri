// loadProjectPrompts — read the seven per-project prompt .md files in parallel
// and return them as a typed object. Used by `runBriefJob` to compose the LLM
// system prompt and (potentially) by `runItemJob` escape-hatch retries.
//
// See docs/07-prompts.md for the seven files + CLAUDE.md convention #5.
//
// No caching at this layer — every job picks up the latest disk content per
// docs/02-orchestrator.md ("Edits to a .md take effect on the next job run").

import { readProjectPrompt, ALLOWED_PROMPT_FILES } from "@shri/prompts-fs";

export type ProjectPrompts = {
  directorBrief: string;
  carouselPlan: string;
  videoPlan: string;
  imageCaption: string;
  textOverlayCopy: string;
  videoPrompt: string;
  themeStory: string;
};

/**
 * Load every per-project prompt file as a single object. Filenames are the
 * canonical seven from `@shri/prompts-fs.ALLOWED_PROMPT_FILES`; the loader
 * fails loudly if any are missing (do NOT silently substitute defaults —
 * `ensureProjectPrompts` is the proper way to seed a new project).
 */
export async function loadProjectPrompts(slug: string): Promise<ProjectPrompts> {
  const [
    directorBrief,
    carouselPlan,
    videoPlan,
    imageCaption,
    textOverlayCopy,
    videoPrompt,
    themeStory,
  ] = await Promise.all([
    readProjectPrompt(slug, "director-brief.md"),
    readProjectPrompt(slug, "carousel-plan.md"),
    readProjectPrompt(slug, "video-plan.md"),
    readProjectPrompt(slug, "image-caption.md"),
    readProjectPrompt(slug, "text-overlay-copy.md"),
    readProjectPrompt(slug, "video-prompt.md"),
    readProjectPrompt(slug, "theme-story.md"),
  ]);

  return {
    directorBrief,
    carouselPlan,
    videoPlan,
    imageCaption,
    textOverlayCopy,
    videoPrompt,
    themeStory,
  };
}

/**
 * Compose the system prompt the brief LLM sees. Order matches the brief's
 * concerns: director voice + format-specific rules + theme. Image/text-overlay
 * and per-scene Seedance prompt files are NOT included here — those live with
 * the deterministic item pipeline.
 *
 * Exported so tests + the MCP server can render the exact same composition.
 */
export function composeBriefSystemPrompt(p: ProjectPrompts): string {
  return [
    "# Director's brief",
    p.directorBrief.trim(),
    "",
    "# Carousel plan",
    p.carouselPlan.trim(),
    "",
    "# Video plan",
    p.videoPlan.trim(),
    "",
    "# Theme & story",
    p.themeStory.trim(),
  ].join("\n");
}

// Re-export for downstream consumers that want the allowlist constant.
export { ALLOWED_PROMPT_FILES };
