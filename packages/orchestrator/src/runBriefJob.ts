// runBriefJob — the Brief generation entry point.
//
// Flow (per docs/01-data-flow.md + docs/16-editable-concepts.md):
//   1. Load the project (description + highlights + crawl profile + assets).
//   2. Load all seven per-project prompt .md files via loadProjectPrompts.
//   3. Run the LLM loop with the tool registry → final JSON brief.
//   4. Parse + Zod-validate the brief envelope.
//   5. Persist a Brief row + N ContentItem rows. Every ContentItem has BOTH:
//        - aiConceptJson — raw LLM output, frozen (docs/16 "Reset to AI")
//        - conceptJson   — elaborated/validated, user-editable later
//   6. For REELs: validate `conceptJson.seedanceScript` (or each scene's) has
//      ALL FIVE cameraPerspective sub-fields. Reject the whole brief if any
//      REEL is missing camera direction (CLAUDE.md #6).
//
// CONVENTIONS HONORED:
//   - All AI calls flow through llmLoop → aiClient (CLAUDE.md #1).
//   - Tool calls during the LLM loop go through executeTool (CLAUDE.md #2).
//   - Single-scene is the default; multi-scene only when scenes.length ≥ 2
//     (CLAUDE.md #7). The validator accepts both shapes; runItemJob picks
//     the right pipeline based on scenes.length.
//
// See docs/02-orchestrator.md for the loop, docs/16 for the concept contract,
// docs/17 for the director's-scenes model.

import { z } from "zod";
import { prisma, type ContentType, type Platform } from "@shri/db";
import { toolDescriptors } from "@shri/tools";
import type { ToolContext } from "@shri/tools";
import { llmLoop, type LoopLogEntry } from "./llmLoop.js";
import {
  composeBriefSystemPrompt,
  loadProjectPrompts,
} from "./loadProjectPrompts.js";

// ───── Brief-time tool allowlist ─────────────────────────────────────────
//
// Tools the brief LLM may call. EVERYTHING ELSE is filtered out before the
// loop sees `tools`. Generative + side-effectful tools (image gen, video
// submit, ffmpeg, R2 writes) only ever fire from runItemJob's deterministic
// pipeline.
//
// Why an allowlist (not a denylist)? Safer when a new tool is added: it has
// to be opted IN for brief-time, so the default for new tools is "planning
// phase does not call this." See CLAUDE.md #6.
export const BRIEF_TIME_TOOLS = new Set<string>([
  "list_project_assets",
  "list_project_characters",
  "estimate_cost",
  "read_project_prompt",
]);

// ───── conceptJson schemas (the elaborated contract) ─────────────────────
//
// Cross-checked against docs/16-editable-concepts.md + docs/17-director-scenes.md.
// We keep the schemas permissive (passthrough) so a forward-compatible LLM can
// add fields without breaking the worker, but enforce the hard contract:
// every REEL has fully-populated cameraPerspective on every scene.

export const cameraPerspectiveSchema = z.object({
  framing: z.enum([
    "extreme_wide",
    "wide",
    "medium",
    "close_up",
    "extreme_close_up",
  ]),
  angle: z.enum(["low", "eye_level", "high", "birds_eye", "dutch"]),
  movement: z.enum([
    "static",
    "pan",
    "tilt",
    "dolly_in",
    "dolly_out",
    "tracking",
    "handheld",
    "crane",
  ]),
  lens: z.enum(["wide_angle", "normal", "telephoto", "macro"]),
  focus: z.enum(["shallow_dof", "deep_dof", "rack_focus"]),
});

export const environmentSchema = z
  .object({
    setting: z.string().optional(),
    background: z.string().optional(),
    surroundings: z.string().optional(),
    timeOfDay: z
      .enum([
        "dawn",
        "morning",
        "midday",
        "afternoon",
        "golden_hour",
        "dusk",
        "night",
      ])
      .optional(),
    weather: z.string().optional(),
    mood: z.string().optional(),
    paletteHint: z.string().optional(),
  })
  .passthrough();

const seedanceScriptSchema = z
  .object({
    prompt: z.string().min(1),
    cameraPerspective: cameraPerspectiveSchema,
  })
  .passthrough();

const reelSceneSchema = z
  .object({
    order: z.number().int().nonnegative(),
    durationS: z.number().positive(),
    seedanceScript: seedanceScriptSchema,
    transitionToNext: z
      .enum(["hard_cut", "dissolve", "match_cut", "whip_pan", "fade_to_black"])
      .optional(),
    characterViewR2Key: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export const reelConceptSchema = z
  .object({
    hook: z.string().min(1),
    caption: z.string().min(1),
    audioMode: z.enum(["seedance", "silent", "voiceover"]),
    voiceoverText: z.string().optional(),
    durationS: z.number().positive(),
    characterIds: z.array(z.string()).optional(),
    environment: environmentSchema.optional(),
    scenes: z.array(reelSceneSchema).min(1),
    notes: z.string().optional(),
  })
  .passthrough();

const slideSpecPassthrough = z.unknown();
const embeddedPromptSchema = z
  .object({
    layerId: z.string(),
    prompt: z.string().min(1),
    size: z.enum(["1024x1024", "1024x1792", "1792x1024"]).default("1024x1024"),
  })
  .passthrough();

export const canvaCarouselConceptSchema = z
  .object({
    hook: z.string().min(1),
    caption: z.string().min(1),
    characterIds: z.array(z.string()).optional(),
    slides: z
      .array(
        z
          .object({
            spec: slideSpecPassthrough,
            embeddedImagePrompts: z.array(embeddedPromptSchema).default([]),
            notes: z.string().optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export const textOverlayConceptSchema = z
  .object({
    hook: z.string().min(1),
    caption: z.string().min(1),
    characterIds: z.array(z.string()).optional(),
    basePrompt: z.string().min(1),
    overlayText: z.string().min(1),
    textStyle: z
      .object({
        font: z.enum(["Inter", "Inter-Bold", "DM-Serif", "JetBrains-Mono"]),
        size: z.number().positive(),
        color: z.string(),
        align: z.enum(["left", "center", "right"]).optional(),
      })
      .passthrough(),
    notes: z.string().optional(),
  })
  .passthrough();

// ───── brief envelope schemas ────────────────────────────────────────────

const contentTypeSchema = z.enum([
  "CAROUSEL_CANVA",
  "CAROUSEL_TEXT_OVERLAY",
  "REEL",
]);
const platformSchema = z.enum(["TIKTOK", "REELS", "SHORTS", "IG_FEED", "X"]);

export const briefItemSchema = z
  .object({
    type: contentTypeSchema,
    platform: z.array(platformSchema).min(1),
    ratio: z.string().min(1),
    hook: z.string().min(1),
    estCostUsd: z.number().nonnegative().default(0),
    // The fully elaborated concept. Per-type schema lives below the union —
    // we validate it after picking the variant by `type`.
    conceptJson: z.unknown(),
  })
  .passthrough();

export const briefEnvelopeSchema = z
  .object({
    rangeDays: z.number().int().positive().optional(),
    summary: z.string().optional(),
    items: z.array(briefItemSchema).min(1),
  })
  .passthrough();

export type BriefEnvelope = z.infer<typeof briefEnvelopeSchema>;

// ───── conceptJson validator + dispatcher ───────────────────────────────

/**
 * Validate the elaborated conceptJson for one ContentItem against its type.
 * Returns the parsed (and Zod-narrowed) concept; throws with a CLEAR message
 * the orchestrator surfaces back to the LLM if any required field is missing.
 *
 * Single-scene reels are the default. We accept any scenes.length ≥ 1. The
 * runItemJob switches on scenes.length to pick single vs concat pipeline.
 *
 * cameraPerspective is enforced PER SCENE. The brief LLM MUST populate all 5
 * sub-fields on every scene — CLAUDE.md convention #6.
 */
export function validateConceptJson(
  type: ContentType,
  raw: unknown,
): unknown {
  switch (type) {
    case "REEL": {
      const parsed = reelConceptSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `runBriefJob: REEL conceptJson is invalid — ${parsed.error.message}. ` +
            `Every REEL needs hook, caption, audioMode, durationS, and scenes[] ` +
            `with each scene carrying a seedanceScript.prompt + full cameraPerspective ` +
            `(framing, angle, movement, lens, focus). See docs/16-editable-concepts.md.`,
        );
      }
      // Defense-in-depth: re-check every scene's cameraPerspective fully.
      for (let i = 0; i < parsed.data.scenes.length; i++) {
        const scene = parsed.data.scenes[i]!;
        const cp = scene.seedanceScript.cameraPerspective;
        for (const field of [
          "framing",
          "angle",
          "movement",
          "lens",
          "focus",
        ] as const) {
          if (cp[field] === undefined || cp[field] === null) {
            throw new Error(
              `runBriefJob: REEL scene ${i} (order=${scene.order}) is missing cameraPerspective.${field}. ` +
                `All five fields are required — CLAUDE.md #6.`,
            );
          }
        }
      }
      if (parsed.data.audioMode === "voiceover" && !parsed.data.voiceoverText) {
        throw new Error(
          "runBriefJob: REEL audioMode='voiceover' but no voiceoverText was provided. " +
            "Populate conceptJson.voiceoverText with the line the TTS should speak.",
        );
      }
      return parsed.data;
    }
    case "CAROUSEL_CANVA": {
      const parsed = canvaCarouselConceptSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `runBriefJob: CAROUSEL_CANVA conceptJson is invalid — ${parsed.error.message}. ` +
            `Need hook, caption, and slides[] with .spec + .embeddedImagePrompts[]. ` +
            `See docs/16.`,
        );
      }
      return parsed.data;
    }
    case "CAROUSEL_TEXT_OVERLAY": {
      const parsed = textOverlayConceptSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `runBriefJob: CAROUSEL_TEXT_OVERLAY conceptJson is invalid — ${parsed.error.message}. ` +
            `Need hook, caption, basePrompt, overlayText, textStyle. See docs/16.`,
        );
      }
      return parsed.data;
    }
  }
}

// ───── public API ────────────────────────────────────────────────────────

export type RunBriefJobOpts = {
  projectId: string;
  /** Default 7 days if omitted. */
  rangeDays?: number;
  /** Optional user hint appended to the user prompt — UI's "regenerate with note". */
  hint?: string;
  /** Cap on llmLoop turns. Default 12 per docs/02. */
  maxIterations?: number;
  /** Existing Brief row to populate. When set, runBriefJob updates that row
   *  instead of creating a fresh one — lets web pre-create the Brief for
   *  navigation purposes (so /projects/[slug]/brief/[id] resolves immediately). */
  briefId?: string;
};

export type RunBriefJobResult = {
  briefId: string;
  itemIds: string[];
  iterations: number;
  log: LoopLogEntry[];
  // Echoed for the worker to persist on Job.logs if it wants.
  rawBriefJson: BriefEnvelope;
};

/**
 * Run a brief generation job end-to-end. The caller (apps/worker) wraps this
 * in BullMQ + Job-row lifecycle; this function itself is queue-agnostic.
 */
export async function runBriefJob(
  opts: RunBriefJobOpts,
): Promise<RunBriefJobResult> {
  const project = await prisma.project.findUnique({
    where: { id: opts.projectId },
    include: {
      assets: { select: { id: true, kind: true, r2Key: true, mimeType: true } },
      characters: { select: { id: true, name: true, description: true } },
    },
  });
  if (!project) {
    throw new Error(`runBriefJob: project not found: ${opts.projectId}`);
  }

  const rangeDays = opts.rangeDays ?? 7;
  const prompts = await loadProjectPrompts(project.slug);
  const systemPrompt = composeBriefSystemPrompt(prompts);
  const userPrompt = composeUserPrompt({
    project: {
      name: project.name,
      slug: project.slug,
      description: project.description,
      highlights: project.highlights,
      websiteUrl: project.websiteUrl,
      crawlJson: project.crawlJson,
    },
    assets: project.assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      r2Key: a.r2Key,
      mimeType: a.mimeType,
    })),
    characters: project.characters,
    rangeDays,
    hint: opts.hint,
  });

  const toolContext: ToolContext = {
    projectId: project.id,
    projectSlug: project.slug,
    source: "worker",
  };

  // Brief-time tool surface is intentionally NARROW: only read-only or pure
  // calc tools. Generative tools (generate_image, submit_seedance_job, etc.)
  // would burn money and don't belong in the planning phase — they fire from
  // runItemJob's deterministic pipeline only.
  const briefTools = toolDescriptors.filter((d) =>
    BRIEF_TIME_TOOLS.has(d.name),
  );

  const loopRes = await llmLoop({
    systemPrompt,
    userPrompt,
    tools: briefTools,
    toolContext,
    maxIterations: opts.maxIterations ?? 12,
    responseFormat: "json",
    temperature: 0.4,
  });

  let parsedEnvelope: BriefEnvelope;
  try {
    const rawJson = JSON.parse(loopRes.finalMessage) as unknown;
    parsedEnvelope = briefEnvelopeSchema.parse(rawJson);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `runBriefJob: LLM final message did not parse as a Brief envelope — ${msg}. ` +
        `First 500 chars: ${loopRes.finalMessage.slice(0, 500)}`,
    );
  }

  // Validate every item's elaborated concept BEFORE writing anything.
  const validatedItems = parsedEnvelope.items.map((it) => {
    const concept = validateConceptJson(it.type, it.conceptJson);
    return { item: it, concept };
  });

  // Persist the Brief + ContentItems in a transaction. The transaction is
  // load-bearing: a partial write would leave orphaned ContentItems with no
  // Brief, which the UI can't navigate to.
  const { briefId, itemIds } = await prisma.$transaction(async (tx) => {
    const brief = opts.briefId
      ? await tx.brief.update({
          where: { id: opts.briefId },
          data: {
            rangeDays,
            rawJson: parsedEnvelope as unknown as object,
            status: "READY",
          },
        })
      : await tx.brief.create({
          data: {
            projectId: project.id,
            rangeDays,
            rawJson: parsedEnvelope as unknown as object,
            status: "READY",
          },
        });

    const created: string[] = [];
    for (const { item, concept } of validatedItems) {
      const row = await tx.contentItem.create({
        data: {
          projectId: project.id,
          briefId: brief.id,
          type: item.type as ContentType,
          platform: item.platform as Platform[],
          ratio: item.ratio,
          hook: item.hook,
          // CLAUDE.md #6: BOTH aiConceptJson (raw) and conceptJson (elaborated)
          // are populated at brief time. aiConceptJson is frozen for "Reset
          // to AI"; conceptJson is mutable for user edits.
          aiConceptJson: item.conceptJson as object,
          conceptJson: concept as object,
          estCostUsd: item.estCostUsd ?? 0,
          status: "PROPOSED",
        },
      });
      created.push(row.id);
    }
    return { briefId: brief.id, itemIds: created };
  });

  return {
    briefId,
    itemIds,
    iterations: loopRes.iterations,
    log: loopRes.log,
    rawBriefJson: parsedEnvelope,
  };
}

// ───── private composition helpers ───────────────────────────────────────

type ProjectInputForPrompt = {
  name: string;
  slug: string;
  description: string;
  highlights: string;
  websiteUrl: string | null;
  crawlJson: unknown;
};

type AssetForPrompt = {
  id: string;
  kind: string;
  r2Key: string;
  mimeType: string;
};

type CharacterForPrompt = {
  id: string;
  name: string;
  description: string;
};

/**
 * Compose the user prompt the brief LLM sees. Kept structured so the model
 * picks out fields easily; the LLM-facing copy lives mostly in the system
 * prompt (loaded from .md files). Exported for tests.
 */
export function composeUserPrompt(args: {
  project: ProjectInputForPrompt;
  assets: AssetForPrompt[];
  characters: CharacterForPrompt[];
  rangeDays: number;
  hint?: string;
}): string {
  const lines: string[] = [];
  lines.push(`# Project: ${args.project.name}`);
  lines.push(`Slug: ${args.project.slug}`);
  lines.push(`Range: ${args.rangeDays} days`);
  if (args.project.websiteUrl) {
    lines.push(`Website: ${args.project.websiteUrl}`);
  }
  lines.push("");
  lines.push("## Description");
  lines.push(args.project.description);
  lines.push("");
  lines.push("## Highlights");
  lines.push(args.project.highlights);

  if (args.project.crawlJson) {
    lines.push("");
    lines.push("## Crawl profile (latest)");
    lines.push("```json");
    lines.push(JSON.stringify(args.project.crawlJson, null, 2));
    lines.push("```");
  }

  if (args.characters.length > 0) {
    lines.push("");
    lines.push("## Characters available");
    for (const c of args.characters) {
      lines.push(`- ${c.id}: ${c.name} — ${c.description}`);
    }
  }

  if (args.assets.length > 0) {
    lines.push("");
    lines.push("## Uploaded assets");
    for (const a of args.assets) {
      lines.push(`- ${a.id} [${a.kind}] ${a.r2Key} (${a.mimeType})`);
    }
  }

  if (args.hint) {
    lines.push("");
    lines.push("## User hint");
    lines.push(args.hint);
  }

  lines.push("");
  lines.push("## Your task");
  lines.push(
    [
      `Produce a single JSON object matching the Brief envelope:`,
      `{`,
      `  "rangeDays": ${args.rangeDays},`,
      `  "summary": string,`,
      `  "items": [`,
      `    { "type": "CAROUSEL_CANVA" | "CAROUSEL_TEXT_OVERLAY" | "REEL",`,
      `      "platform": ["TIKTOK" | "REELS" | "SHORTS" | "IG_FEED" | "X", ...],`,
      `      "ratio": "9:16" | "1:1" | "4:5" | "16:9",`,
      `      "hook": string,`,
      `      "estCostUsd": number,`,
      `      "conceptJson": <fully elaborated per type — see system prompt> }`,
      `  ]`,
      `}`,
      ``,
      `Every REEL conceptJson MUST include scenes[] with a full cameraPerspective`,
      `on every scene (framing, angle, movement, lens, focus). Single-scene is`,
      `the default; only propose scenes.length >= 2 when the content has a real`,
      `narrative arc (docs/17-director-scenes.md).`,
      ``,
      `Every CAROUSEL_CANVA conceptJson MUST include slides[] with .spec and`,
      `.embeddedImagePrompts[] (which may be empty).`,
      ``,
      `Every CAROUSEL_TEXT_OVERLAY conceptJson MUST include basePrompt,`,
      `overlayText, and textStyle.`,
      ``,
      `You MAY call tools (list_project_assets, estimate_cost) before finalising.`,
      `Your FINAL assistant message must be ONLY the JSON envelope — no prose.`,
    ].join("\n"),
  );

  return lines.join("\n");
}
