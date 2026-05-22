// =============================================================================
// THE canonical tool registry. Both consumers iterate `toolDescriptors`:
//
//   - apps/worker (OpenAI function-calling) — `tools: toolDescriptors.map(toOpenAIFunctionTool)`
//   - apps/mcp (MCP stdio server)          — `tools: toolDescriptors.map(toMcpToolSchema)`
//
// Tool-file convention (each file MUST export):
//   export const inputSchema: z.ZodSchema;
//   export const outputSchema: z.ZodSchema;
//   export async function handler(input, ctx): Promise<...>;
//
// Adding a tool:
//   1. Create packages/tools/myTool.ts with the three exports above.
//   2. Import the module here as a namespace.
//   3. Add one row to `toolDescriptors` below.
// Both consumers pick it up automatically — no orchestrator/MCP edits needed.
// See docs/03-tools.md.
// =============================================================================

import type { ToolContext, ToolDescriptor } from "./descriptors.js";
export type { ToolContext, ToolDescriptor } from "./descriptors.js";
export {
  toOpenAIFunctionTool,
  toMcpToolSchema,
  zodToJsonSchema,
} from "./descriptors.js";
export type {
  JsonSchema,
  OpenAIFunctionTool,
  McpToolSchema,
} from "./descriptors.js";

// --- meta-agent tools (this agent) -------------------------------------------
import * as listProjectAssets from "./listProjectAssets.js";
import * as saveContentOutput from "./saveContentOutput.js";
import * as readProjectPrompt from "./readProjectPrompt.js";
import * as writeProjectPrompt from "./writeProjectPrompt.js";
import * as crawlProductSite from "./crawlProductSite.js";
import * as generateProjectPrompts from "./generateProjectPrompts.js";

// --- image-agent tools (peer) ------------------------------------------------
import * as generateImage from "./generateImage.js";
import * as renderJsxCarousel from "./renderJsxCarousel.js";
import * as placeTextOnImage from "./placeTextOnImage.js";
import * as generateCharacterBase from "./generateCharacterBase.js";
import * as generateCharacterViews from "./generateCharacterViews.js";
import * as mergeCharacterSheet from "./mergeCharacterSheet.js";
import * as chatDesignCharacter from "./chatDesignCharacter.js";
import * as listProjectCharacters from "./listProjectCharacters.js";

// --- video-agent tools (peer) ------------------------------------------------
import * as submitSeedance from "./submitSeedance.js";
import * as pollSeedance from "./pollSeedance.js";
import * as generateTts from "./generateTts.js";
import * as muxAudio from "./muxAudio.js";
import * as concatVideos from "./concatVideos.js";
import * as estimateCost from "./estimateCost.js";

// -----------------------------------------------------------------------------
// Shape of a tool module we wrap into a descriptor. The peers' files MUST
// match this shape — if they don't, PM gate will flag it.
//
// We type-erase input/output to z.ZodTypeAny (and ctx to any) at the wrap
// boundary because Phase B's three agents each defined their own local
// `ToolContext` (some with {projectId, projectSlug}; some with {projectSlug,
// itemId?, log?}). All are STRUCTURAL SUBSETS of the canonical ToolContext
// defined in descriptors.ts, but TS's strict contravariance on function
// parameters can't see that across N independently-declared types. Phase C
// can clean this up by having peers import ToolContext from descriptors.ts.
//
// Runtime safety is preserved: executeTool re-validates input via inputSchema
// and output via outputSchema before/after every call, so the type erasure
// here is purely a typecheck convenience — wrong shapes still throw loudly.
// -----------------------------------------------------------------------------
type ToolModule = {
  inputSchema: import("zod").ZodTypeAny;
  outputSchema: import("zod").ZodTypeAny;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (input: any, ctx: any) => Promise<any>;
};

function wrap(
  name: string,
  description: string,
  mod: ToolModule,
): ToolDescriptor {
  return {
    name,
    description,
    inputSchema: mod.inputSchema as ToolDescriptor["inputSchema"],
    outputSchema: mod.outputSchema as ToolDescriptor["outputSchema"],
    handler: mod.handler as ToolDescriptor["handler"],
  };
}

// -----------------------------------------------------------------------------
// THE canonical registry. Ordering matches docs/03-tools.md "full tool surface"
// table (setup → characters → image → video → outputs → meta).
// -----------------------------------------------------------------------------
export const toolDescriptors: ToolDescriptor[] = [
  // ---- Project setup ------------------------------------------------------
  wrap(
    "list_project_assets",
    "List uploaded assets (icons, screenshots, recordings, logos, references) for a project with presigned read URLs. Read-only.",
    listProjectAssets,
  ),
  wrap(
    "crawl_product_site",
    "Fetch a product website, honor robots.txt, parse key pages, and extract a structured productProfile via an LLM pass. Persists a ProjectCrawl row.",
    crawlProductSite,
  ),
  wrap(
    "generate_project_prompts",
    "LLM-transform the seven seed prompt templates into personalized per-project copies using description, highlights, and (optional) productProfile.",
    generateProjectPrompts,
  ),

  // ---- Characters ---------------------------------------------------------
  wrap(
    "list_project_characters",
    "List all characters defined for a project, with presigned URLs for their character-sheet JPEGs. Read-only.",
    listProjectCharacters,
  ),
  wrap(
    "chat_design_character",
    "Multi-turn LLM helper that helps the user design a character. Appends each turn to Character.chatJson and returns the next reply plus an optional suggested description string.",
    chatDesignCharacter,
  ),
  wrap(
    "generate_character_base",
    "Text → 1024x1024 character base.png reference via OpenAI gpt-image-1. Writes to R2 at characters/{id}/base.png.",
    generateCharacterBase,
  ),
  wrap(
    "generate_character_views",
    "Given a base.png + an array of pose descriptions, generates N parallel view PNGs via gpt-image-1 edit/reference. Writes each to R2.",
    generateCharacterViews,
  ),
  wrap(
    "merge_character_sheet",
    "Composite the per-pose view PNGs into a single labeled character-sheet JPEG via Sharp + Satori. Writes to R2 at characters/{id}/sheet.jpg.",
    mergeCharacterSheet,
  ),

  // ---- Image / carousel ---------------------------------------------------
  wrap(
    "generate_image",
    "Generate an image via OpenAI gpt-image-1 and upload it to R2. Accepts characterIds to load character sheets as visual references; prepends theme setting/palette automatically.",
    generateImage,
  ),
  wrap(
    "render_jsx_carousel",
    "Render a constrained JSON slide spec into N PNG slides via Satori + resvg, using bundled fonts. Writes each slide to R2.",
    renderJsxCarousel,
  ),
  wrap(
    "place_text_on_image",
    "Choose a placement for overlay text using OpenCV saliency + edge density, then composite the text via Satori. Writes the composite PNG to R2.",
    placeTextOnImage,
  ),

  // ---- Video / audio ------------------------------------------------------
  wrap(
    "submit_seedance_job",
    "Submit a Seedance job to BytePlus. Requires a structured cameraPerspective (framing, angle, movement, lens, focus) which the handler weaves into the prompt. Optional references[] are mapped positionally to @ImageN tags; every reference passed must be named in the prompt body. Persists a Job row, returns immediately.",
    submitSeedance,
  ),
  wrap(
    "poll_seedance_job",
    "Poll a previously-submitted Seedance task. On success, downloads the MP4 to R2 and updates the Job row.",
    pollSeedance,
  ),
  wrap(
    "generate_tts",
    "Generate voiceover audio via OpenAI TTS and upload the MP3 to R2.",
    generateTts,
  ),
  wrap(
    "mux_audio",
    "Use ffmpeg to combine a video MP4 with an audio MP3 (or strip audio from a video). Writes the muxed MP4 to R2.",
    muxAudio,
  ),
  wrap(
    "concat_videos",
    "Use ffmpeg to concatenate multiple MP4 scenes with the chosen transitions (hard_cut, match_cut, dissolve, fade). Used only for multi-scene reels. Writes the final MP4 to R2.",
    concatVideos,
  ),
  wrap(
    "estimate_cost",
    "Deterministic cost calculator. Given a plan JSON, returns USD estimates broken down by item.",
    estimateCost,
  ),

  // ---- Output persistence + prompt files ----------------------------------
  wrap(
    "save_content_output",
    "Persist a ContentOutput row (r2Key, optional thumbR2Key, caption, meta). Required final step of every content-generation pipeline — the asset in R2 is invisible to the web UI until this row exists.",
    saveContentOutput,
  ),
  wrap(
    "read_project_prompt",
    "Read one of the seven allowlisted per-project prompt files (director-brief.md, carousel-plan.md, video-plan.md, image-caption.md, text-overlay-copy.md, video-prompt.md, theme-story.md).",
    readProjectPrompt,
  ),
  wrap(
    "write_project_prompt",
    "Atomically overwrite one of the seven allowlisted per-project prompt files. Used by both the UI editor and MCP-driven prompt edits.",
    writeProjectPrompt,
  ),
];

// -----------------------------------------------------------------------------
// Quick lookup map. Built once at module-load.
// -----------------------------------------------------------------------------
const byName: Map<string, ToolDescriptor> = new Map(
  toolDescriptors.map((d) => [d.name, d]),
);

if (byName.size !== toolDescriptors.length) {
  // Duplicate name — catch at module-load rather than at first call.
  const counts = new Map<string, number>();
  for (const d of toolDescriptors) {
    counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  }
  const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  throw new Error(
    `@shri/tools: duplicate tool name(s) in toolDescriptors: ${dupes.join(", ")}`,
  );
}

export function getTool(name: string): ToolDescriptor | undefined {
  return byName.get(name);
}

// -----------------------------------------------------------------------------
// executeTool — uniform runner used by both consumers. Validates input via the
// descriptor's Zod schema, calls the handler, validates the output, returns it.
// Throws on input/output validation failure with a clear, LLM-readable message.
// -----------------------------------------------------------------------------
export async function executeTool(
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const desc = byName.get(name);
  if (!desc) {
    throw new Error(`executeTool: unknown tool "${name}"`);
  }

  const inputParse = desc.inputSchema.safeParse(rawInput);
  if (!inputParse.success) {
    throw new Error(
      `executeTool(${name}): input validation failed — ${inputParse.error.message}`,
    );
  }

  const result = await desc.handler(inputParse.data, ctx);

  const outputParse = desc.outputSchema.safeParse(result);
  if (!outputParse.success) {
    // This is a tool-author bug, not an LLM bug. Surface loudly.
    throw new Error(
      `executeTool(${name}): output validation failed — ${outputParse.error.message}`,
    );
  }
  return outputParse.data;
}

// -----------------------------------------------------------------------------
// The complete set of tool names (handy for consumer assertions).
// -----------------------------------------------------------------------------
export const TOOL_NAMES = toolDescriptors.map((d) => d.name);
