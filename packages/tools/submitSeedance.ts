// submitSeedance — tool wrapper around `@shri/seedance.submit`.
//
// Responsibilities:
//   1. Validate the structured cameraPerspective (all 5 sub-fields REQUIRED).
//      The Zod schema rejects the call if any of framing/angle/movement/lens
//      /focus is missing — see CLAUDE.md convention #3 and docs/04-seedance.md.
//   2. Compose the final BytePlus prompt by concatenating:
//        [@ImageN tagging line for refs]
//        [environment recap, if any]
//        [scene action / freeform prompt]
//        [camera sentence: framing + angle + movement + lens + focus]
//      Composition is centralized in composePrompt() so the orchestrator,
//      MCP, and edit-drawer all see the same prompt shape.
//   3. Validate that every passed reference appears in the prompt body as its
//      @ImageN tag (the "unnamed references may be ignored" floor).
//   4. Presign each R2 key for 1h and submit via @shri/seedance.
//   5. Persist a Job row (kind=REEL) with the returned taskId — returns
//      immediately; polling is handled by pollSeedance + the orchestrator's
//      delayed re-enqueue pattern.
//
// NO mocks of any kind for BytePlus. Tests in submitSeedance.test.ts cover
// pure logic only (Zod, prompt composition, ref-mention guardrail). The live
// HTTP path is exercised exclusively via scripts/manual-seedance-smoke.ts.

import { z } from "zod";
import { prisma } from "@shri/db";
import { submit as seedanceSubmit } from "@shri/seedance";
import { signedReadUrl } from "@shri/storage";
import type { ToolContext } from "./descriptors.js";

// ----- Schemas -----

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

export type CameraPerspective = z.infer<typeof cameraPerspectiveSchema>;

export const referenceSchema = z.object({
  r2Key: z.string().min(1),
  // Free-form per docs/04: "character", "environment", "the first frame", …
  role: z.string().min(1),
});

export type SeedanceReference = z.infer<typeof referenceSchema>;

// Mirrors docs/17-director-scenes.md Environment block. All fields optional at
// the tool boundary so single-scene reels without a director's set still work;
// when present, the handler prepends a recap to the final prompt.
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
  .optional();

export const inputSchema = z.object({
  projectSlug: z.string().min(1),
  itemId: z.string().min(1),
  // The scene action — describes THIS shot. MUST reference each @ImageN by tag.
  prompt: z.string().min(1),
  // Structured camera direction. ALL FIVE FIELDS REQUIRED — convention #3.
  cameraPerspective: cameraPerspectiveSchema,
  // Optional environment block (director's set description).
  environment: environmentSchema,
  // Up to 9 references per Seedance 2.0 cap.
  references: z.array(referenceSchema).max(9).optional(),
  generateAudio: z.boolean(),
  ratio: z.enum(["9:16", "1:1", "16:9", "adaptive"]),
  // For multi-scene reels: which scene we're submitting. Drives the per-scene
  // R2 key via keys.outputSeedanceScene; omit for single-scene (Job row only
  // records taskId, the polling step writes to keys.outputSeedance).
  sceneOrder: z.number().int().nonnegative().optional(),
});

export type ToolInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  jobId: z.string(),
  taskId: z.string(),
  // Echo the final composed prompt back so the orchestrator can persist it
  // alongside the Job for debugging when Seedance returns a weird result.
  composedPrompt: z.string(),
});

export type ToolOutput = z.infer<typeof outputSchema>;

// ----- Pure helpers (exported for testing) -----

/**
 * Build the camera sentence from the 5 structured fields. Format per docs/04:
 *   "{framing} shot, {angle}. {movement} camera, {lens} lens, {focus}."
 * Underscores in enum values become spaces.
 */
export function buildCameraSentence(cp: CameraPerspective): string {
  const human = (s: string): string => s.replace(/_/g, " ");
  return (
    `${human(cp.framing)} shot, ${human(cp.angle)}. ` +
    `${human(cp.movement)} camera, ${human(cp.lens)} lens, ${human(cp.focus)}.`
  );
}

/**
 * Build the "@Image1 as the character, @Image2 as the environment." line.
 * Empty string when no refs — caller filters it out of the join.
 */
export function buildRefsSentence(refs: SeedanceReference[] | undefined): string {
  if (!refs || refs.length === 0) return "";
  return refs.map((r, i) => `@Image${i + 1} as ${r.role}`).join(", ") + ".";
}

/**
 * Format the optional environment block into a single recap paragraph. Returns
 * "" when there's nothing meaningful to include. Order tries to read like a
 * shot's location card: setting + time/weather, then what's in frame.
 */
export function buildEnvironmentRecap(
  env: NonNullable<z.infer<typeof environmentSchema>> | undefined,
): string {
  if (!env) return "";
  // Two-bucket split: the "location card" reads like a shot setup line
  // (setting, time, weather joined with commas), and the labeled phrases
  // each get their own short sentence. Keeps the recap scannable for the
  // model and stable to assert against in tests.
  const locationCard: string[] = [];
  if (env.setting) locationCard.push(env.setting);
  if (env.timeOfDay) locationCard.push(env.timeOfDay.replace(/_/g, " "));
  if (env.weather) locationCard.push(env.weather);

  const labeled: string[] = [];
  if (env.background) labeled.push(`Background: ${env.background}.`);
  if (env.surroundings) labeled.push(`Surroundings: ${env.surroundings}.`);
  if (env.mood) labeled.push(`Mood: ${env.mood}.`);
  if (env.paletteHint) labeled.push(`Palette: ${env.paletteHint}.`);

  const head = locationCard.length > 0 ? `${locationCard.join(", ")}.` : "";
  const tail = labeled.join(" ");
  const recap = [head, tail].filter((s) => s.length > 0).join(" ").trim();
  return recap;
}

/**
 * The composer. Reads: refs tagging → environment recap → freeform prompt →
 * camera sentence. Each non-empty section separated by a blank line so the
 * BytePlus text block reads as discrete instructions.
 */
export function composePrompt(input: ToolInput): string {
  const refsSentence = buildRefsSentence(input.references);
  const envRecap = buildEnvironmentRecap(input.environment);
  const cameraSentence = buildCameraSentence(input.cameraPerspective);
  return [refsSentence, envRecap, input.prompt, cameraSentence]
    .filter((s) => s && s.length > 0)
    .join("\n\n");
}

/**
 * Floor against unnamed references. Every passed ref must appear as @ImageN
 * in the prompt body — Seedance silently ignores unnamed refs otherwise.
 * Returns the list of missing tags (empty when fine).
 */
export function findMissingRefTags(input: ToolInput): string[] {
  const refs = input.references ?? [];
  const missing: string[] = [];
  for (let i = 0; i < refs.length; i++) {
    const tag = `@Image${i + 1}`;
    if (!input.prompt.includes(tag)) missing.push(tag);
  }
  return missing;
}

// ----- Handler -----

export async function handler(
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutput> {
  // Re-parse to enforce schema at handler boundary even if caller skipped it.
  const input = inputSchema.parse(rawInput);

  const missing = findMissingRefTags(input);
  if (missing.length > 0) {
    throw new Error(
      `submit_seedance_job: references provided but not mentioned in prompt: ${missing.join(
        ", ",
      )}. Every reference must appear as its @ImageN tag in the prompt body — see docs/04-seedance.md.`,
    );
  }

  const composedPrompt = composePrompt(input);

  // Presign each R2 key fresh — TTL 1h per docs/04. We don't accept presigned
  // URLs as input because plans may sit in BullMQ for minutes before firing.
  const images = await Promise.all(
    (input.references ?? []).map(async (ref) => ({
      url: await signedReadUrl(ref.r2Key, 3600),
    })),
  );

  // ctx is not consulted directly here — the orchestrator records tool
  // invocations on Job.logs at the call-site after this returns.
  void ctx;

  const submitRes = await seedanceSubmit({
    prompt: composedPrompt,
    images: images.length > 0 ? images : undefined,
    generateAudio: input.generateAudio,
    ratio: input.ratio,
  });

  // Persist the Job row immediately — the orchestrator will look it up by
  // taskId when the delayed POLLING_TICK fires. kind=REEL even for a single
  // scene of a multi-scene reel; the per-scene split lives in logs.
  const job = await prisma.job.create({
    data: {
      itemId: input.itemId,
      kind: "REEL",
      bullJobId: "", // populated by the orchestrator when it enqueues the poll tick
      seedanceTaskId: submitRes.taskId,
      status: "RUNNING",
      logs: [
        {
          at: new Date().toISOString(),
          event: "submit",
          sceneOrder: input.sceneOrder ?? null,
          ratio: input.ratio,
          generateAudio: input.generateAudio,
        },
      ],
      startedAt: new Date(),
    },
  });

  return {
    jobId: job.id,
    taskId: submitRes.taskId,
    composedPrompt,
  };
}
