// runItemJob — the deterministic generation pipeline.
//
// CONTRACT (docs/16-editable-concepts.md): runItemJob reads the elaborated
// conceptJson (the user-edited version) and walks a small sequence of tool
// calls. There is NO LLM loop in the happy path — concepts come pre-baked
// from runBriefJob (and optionally edited by the user). Narrow escape
// hatches (slide image regen, text-placement retry) are the only places the
// LLM is re-invoked at item time, and those run via @shri/orchestrator/llmLoop
// with a single-tool surface so we don't accidentally widen the contract.
//
// Switching on ContentItem.type:
//
//   REEL              → for each scene: submit_seedance_job (returns
//                       immediately with a taskId). The caller (apps/worker)
//                       enqueues a SEEDANCE_POLL_QUEUE tick with delay; that
//                       worker calls poll_seedance_job; when DONE for all
//                       scenes, the WORKER calls back into completeReelAfterPoll
//                       to concat + tts + mux + save.
//
//   CAROUSEL_CANVA    → resolve embeddedImagePrompts in parallel →
//                       generate_image x N → substitute r2Keys into spec →
//                       render_jsx_carousel → save_content_output.
//
//   CAROUSEL_TEXT_OVERLAY
//                     → generate_image(basePrompt) →
//                       place_text_on_image(overlayText, textStyle) →
//                       save_content_output.
//
// Mandatory conventions:
//   - All tool calls via executeTool(name, input, ctx) — never the raw handler.
//   - ToolContext shape: { projectId, projectSlug, source: 'worker', itemId }.
//   - For REELs, cameraPerspective is enforced at the boundary by the
//     submit_seedance_job tool. We pass it through; if a user edit corrupted
//     it, the submit handler rejects with a clear error.
//   - Single-scene is the default. We only invoke concat_videos when
//     scenes.length >= 2.

import type { ContentType } from "@shri/db";
import { prisma } from "@shri/db";
import { executeTool, type ToolContext } from "@shri/tools";
import { keys } from "@shri/storage";
import {
  canvaCarouselConceptSchema,
  reelConceptSchema,
  textOverlayConceptSchema,
  validateConceptJson,
} from "./runBriefJob.js";
import {
  SEEDANCE_POLL_DELAY_MS,
  type SeedancePollPayload,
} from "./queues.js";

// ───── Public types ──────────────────────────────────────────────────────

export type ReelSubmitOutcome = {
  /** Always "REEL". */
  kind: "REEL";
  /** Per-scene Seedance task submissions. The caller enqueues a poll tick per. */
  scenes: Array<{
    sceneOrder: number;
    durationS: number;
    jobId: string;
    taskId: string;
    composedPrompt: string;
  }>;
  /** Echoed for the worker so it can build polling-tick payloads. */
  isMultiScene: boolean;
};

export type CarouselOutcome = {
  kind: "CAROUSEL_CANVA" | "CAROUSEL_TEXT_OVERLAY";
  outputId: string;
  r2Key: string;
  caption: string;
};

export type RunItemJobResult = ReelSubmitOutcome | CarouselOutcome;

/**
 * Enqueue-helper signature the worker passes in. We invert control of BullMQ
 * so this package stays queue-free at the import layer (per CLAUDE.md the
 * worker app owns the bullmq instance).
 */
export type EnqueuePollTick = (
  payload: SeedancePollPayload,
  delayMs: number,
) => Promise<void>;

export type RunItemJobOpts = {
  itemId: string;
  /**
   * Called once per scene immediately after submit_seedance_job returns. The
   * worker uses this to enqueue the delayed polling tick — see docs/04 and
   * the seedance-poll queue in apps/worker.
   */
  enqueuePollTick?: EnqueuePollTick;
};

// ───── Entry ─────────────────────────────────────────────────────────────

export async function runItemJob(
  opts: RunItemJobOpts,
): Promise<RunItemJobResult> {
  const item = await prisma.contentItem.findUnique({
    where: { id: opts.itemId },
    include: {
      project: { select: { id: true, slug: true } },
      characters: { select: { characterId: true } },
    },
  });
  if (!item) throw new Error(`runItemJob: ContentItem not found: ${opts.itemId}`);

  const ctx: ToolContext = {
    projectId: item.project.id,
    projectSlug: item.project.slug,
    source: "worker",
    itemId: item.id,
  };

  // Mark GENERATING so the UI reflects the worker has claimed it. Idempotent
  // when the worker retries — Prisma's set on the row is harmless.
  await prisma.contentItem.update({
    where: { id: item.id },
    data: { status: "GENERATING" },
  });

  // Validate the user-current conceptJson at the boundary. If a user edit
  // corrupted it, we fail BEFORE spending any money.
  const concept = validateConceptJson(item.type, item.conceptJson);

  switch (item.type as ContentType) {
    case "REEL":
      return runReelPipeline(item.id, ctx, concept, opts.enqueuePollTick);
    case "CAROUSEL_CANVA":
      return runCanvaPipeline(item.id, ctx, concept);
    case "CAROUSEL_TEXT_OVERLAY":
      return runOverlayPipeline(item.id, ctx, concept);
  }
}

// ───── REEL ──────────────────────────────────────────────────────────────

async function runReelPipeline(
  itemId: string,
  ctx: ToolContext,
  conceptRaw: unknown,
  enqueuePollTick: EnqueuePollTick | undefined,
): Promise<ReelSubmitOutcome> {
  const concept = reelConceptSchema.parse(conceptRaw);
  const scenes = concept.scenes;
  const isMultiScene = scenes.length >= 2;

  // For each scene, submit_seedance_job in parallel. Each returns a Job + taskId
  // immediately; the actual polling happens via the SEEDANCE_POLL_QUEUE.
  // For SINGLE-scene: sceneOrder is omitted so pollSeedance writes the MP4 to
  // keys.outputSeedance(slug, itemId). For MULTI-scene: sceneOrder is set so
  // each scene lands at keys.outputSeedanceScene(slug, itemId, n) and the
  // post-poll completeReelAfterPoll step can concat them.
  const submits = await Promise.all(
    scenes.map(async (scene) => {
      const sceneOrder = isMultiScene ? scene.order : undefined;
      const submitRes = (await executeTool(
        "submit_seedance_job",
        {
          projectSlug: ctx.projectSlug,
          itemId,
          prompt: scene.seedanceScript.prompt,
          cameraPerspective: scene.seedanceScript.cameraPerspective,
          environment: concept.environment,
          // audio per docs/04: seedance-mode generates SFX; silent/voiceover
          // tells Seedance to skip audio so we mux later.
          generateAudio: concept.audioMode === "seedance",
          ratio: "9:16",
          sceneOrder,
        },
        ctx,
      )) as { jobId: string; taskId: string; composedPrompt: string };

      // Enqueue the delayed poll tick. The worker app provides this callback;
      // pure callers (tests) may skip and inspect the submits directly.
      if (enqueuePollTick) {
        await enqueuePollTick(
          {
            itemId,
            projectId: ctx.projectId,
            projectSlug: ctx.projectSlug,
            jobId: submitRes.jobId,
            taskId: submitRes.taskId,
            sceneOrder,
            attempt: 0,
          },
          SEEDANCE_POLL_DELAY_MS,
        );
      }

      return {
        sceneOrder: scene.order,
        durationS: scene.durationS,
        jobId: submitRes.jobId,
        taskId: submitRes.taskId,
        composedPrompt: submitRes.composedPrompt,
      };
    }),
  );

  return {
    kind: "REEL",
    scenes: submits,
    isMultiScene,
  };
}

/**
 * Called by the worker once all per-scene polls return DONE. Performs the
 * post-Seedance phase:
 *   - multi-scene: concat_videos with the user-chosen transitions.
 *   - voiceover:   generate_tts + mux_audio.
 *   - save_content_output.
 *
 * Returns the ContentOutput row id + the final R2 key.
 *
 * INPUT: per-scene downloaded MP4 R2 keys, in order. For single-scene this is
 * a list of one key (keys.outputSeedance). The worker computes these from
 * pollSeedance's DONE response and the conceptJson.
 */
export async function completeReelAfterPoll(args: {
  itemId: string;
  ctx: ToolContext;
  /** Per-scene MP4 R2 keys, in order (length matches scenes.length). */
  sceneR2Keys: string[];
}): Promise<CarouselOutcome> {
  const item = await prisma.contentItem.findUnique({
    where: { id: args.itemId },
    select: { type: true, conceptJson: true },
  });
  if (!item) throw new Error(`completeReelAfterPoll: item not found ${args.itemId}`);
  if (item.type !== "REEL") {
    throw new Error(
      `completeReelAfterPoll: only valid for REEL, got ${item.type}`,
    );
  }
  const concept = reelConceptSchema.parse(item.conceptJson);

  if (args.sceneR2Keys.length !== concept.scenes.length) {
    throw new Error(
      `completeReelAfterPoll: sceneR2Keys.length=${args.sceneR2Keys.length} ` +
        `but conceptJson has ${concept.scenes.length} scenes`,
    );
  }

  // Stage 1: concat if multi-scene; otherwise use the lone scene MP4 as-is.
  let videoR2Key: string;
  if (concept.scenes.length >= 2) {
    // Transitions per docs/17: take transitionToNext from scenes[0..n-2].
    // Default to "hard_cut" if unspecified. Map docs-level enum onto the
    // concat tool's narrower one (it accepts hard_cut|match_cut|dissolve|fade).
    const transitions = concept.scenes
      .slice(0, -1)
      .map((s) => mapTransition(s.transitionToNext));
    const concatOut = (await executeTool(
      "concat_videos",
      {
        projectSlug: args.ctx.projectSlug,
        itemId: args.itemId,
        videoR2Keys: args.sceneR2Keys,
        transitions,
        outputR2Key:
          // For voiceover we'll mux next, so write to an intermediate; for
          // seedance/silent the concat IS the final.
          concept.audioMode === "voiceover"
            ? keys.outputSeedance(args.ctx.projectSlug, args.itemId)
            : keys.outputFinal(args.ctx.projectSlug, args.itemId),
      },
      args.ctx,
    )) as { r2Key: string };
    videoR2Key = concatOut.r2Key;
  } else {
    videoR2Key = args.sceneR2Keys[0]!;
  }

  // Stage 2: voiceover branch (mode C per docs/04). Generate TTS, then mux.
  let finalR2Key = videoR2Key;
  if (concept.audioMode === "voiceover") {
    if (!concept.voiceoverText) {
      throw new Error(
        "completeReelAfterPoll: audioMode=voiceover but conceptJson.voiceoverText is empty",
      );
    }
    const tts = (await executeTool(
      "generate_tts",
      {
        projectSlug: args.ctx.projectSlug,
        itemId: args.itemId,
        text: concept.voiceoverText,
        format: "mp3",
      },
      args.ctx,
    )) as { r2Key: string };

    const muxed = (await executeTool(
      "mux_audio",
      {
        projectSlug: args.ctx.projectSlug,
        itemId: args.itemId,
        videoR2Key,
        audioR2Key: tts.r2Key,
        mode: "combine",
      },
      args.ctx,
    )) as { r2Key: string };
    finalR2Key = muxed.r2Key;
  }
  // silent mode: leave as-is, flag in meta for the UI.

  // Stage 3: save the ContentOutput row and mark READY.
  const saved = (await executeTool(
    "save_content_output",
    {
      itemId: args.itemId,
      r2Key: finalR2Key,
      caption: concept.caption,
      meta: {
        audioMode: concept.audioMode,
        sceneCount: concept.scenes.length,
        durationS: concept.durationS,
        needs_music: concept.audioMode === "silent",
      },
    },
    args.ctx,
  )) as { outputId: string; r2Key: string; caption: string };

  await prisma.contentItem.update({
    where: { id: args.itemId },
    data: { status: "READY" },
  });

  return {
    kind: "CAROUSEL_CANVA", // shape-only; outcome union doesn't differentiate by source
    outputId: saved.outputId,
    r2Key: saved.r2Key,
    caption: saved.caption,
  };
}

function mapTransition(
  t:
    | "hard_cut"
    | "dissolve"
    | "match_cut"
    | "whip_pan"
    | "fade_to_black"
    | undefined,
): "hard_cut" | "match_cut" | "dissolve" | "fade" {
  // concat_videos accepts hard_cut, match_cut, dissolve, fade. Map the wider
  // docs/16 transition set onto that narrower set.
  if (!t) return "hard_cut";
  if (t === "fade_to_black") return "fade";
  if (t === "whip_pan") return "dissolve"; // closest neighbour
  return t;
}

// ───── CAROUSEL_CANVA ────────────────────────────────────────────────────

async function runCanvaPipeline(
  itemId: string,
  ctx: ToolContext,
  conceptRaw: unknown,
): Promise<CarouselOutcome> {
  const concept = canvaCarouselConceptSchema.parse(conceptRaw);

  // Phase 1: resolve embeddedImagePrompts in parallel. Each prompt yields
  // an r2Key that we substitute into the slide spec by layerId.
  const allPrompts: Array<{
    slideIndex: number;
    layerId: string;
    prompt: string;
    size: "1024x1024" | "1024x1792" | "1792x1024";
  }> = [];
  concept.slides.forEach((slide, slideIndex) => {
    for (const p of slide.embeddedImagePrompts) {
      allPrompts.push({
        slideIndex,
        layerId: p.layerId,
        prompt: p.prompt,
        size: p.size,
      });
    }
  });

  const generated = await Promise.all(
    allPrompts.map(async (p) => {
      const res = (await executeTool(
        "generate_image",
        {
          prompt: p.prompt,
          itemId,
          slideIndex: p.slideIndex,
          size: p.size,
          characterIds: [],
        },
        ctx,
      )) as { r2Key: string };
      return { ...p, r2Key: res.r2Key };
    }),
  );

  // Substitute by layerId — mutates a deep copy of the spec.
  const slidesWithSubs = concept.slides.map((slide, slideIndex) => {
    const slideGen = generated.filter((g) => g.slideIndex === slideIndex);
    return { spec: substituteImageLayers(slide.spec, slideGen) };
  });

  const rendered = (await executeTool(
    "render_jsx_carousel",
    {
      itemId,
      spec: { slides: slidesWithSubs.map((s) => s.spec) },
    },
    ctx,
  )) as { slides: Array<{ r2Key: string }> };

  // The carousel "asset" the UI surfaces is the first slide's r2Key; the rest
  // live in the same outputs folder via the deterministic key helper. We pass
  // the full list in meta so the player can fetch all N.
  const slideKeys = rendered.slides.map((s) => s.r2Key);
  const firstKey = slideKeys[0]!;
  const saved = (await executeTool(
    "save_content_output",
    {
      itemId,
      r2Key: firstKey,
      caption: concept.caption,
      meta: {
        kind: "CAROUSEL_CANVA",
        slideR2Keys: slideKeys,
        slideCount: slideKeys.length,
      },
    },
    ctx,
  )) as { outputId: string; r2Key: string; caption: string };

  await prisma.contentItem.update({
    where: { id: itemId },
    data: { status: "READY" },
  });

  return {
    kind: "CAROUSEL_CANVA",
    outputId: saved.outputId,
    r2Key: saved.r2Key,
    caption: saved.caption,
  };
}

/**
 * Walk a slide spec and replace any image layer whose layerId matches a
 * generated entry with the produced r2Key. Other layers pass through. The
 * spec object is left structurally similar (we make a shallow clone) so the
 * downstream renderer's Zod validator continues to accept it.
 *
 * Exported for unit testing.
 */
export function substituteImageLayers(
  spec: unknown,
  generated: Array<{ layerId: string; r2Key: string }>,
): unknown {
  if (
    !spec ||
    typeof spec !== "object" ||
    !("layers" in (spec as Record<string, unknown>))
  ) {
    return spec;
  }
  const s = spec as { layers?: unknown[] };
  if (!Array.isArray(s.layers)) return spec;
  const byId = new Map(generated.map((g) => [g.layerId, g.r2Key]));
  const newLayers = s.layers.map((layer) => {
    if (
      layer &&
      typeof layer === "object" &&
      (layer as Record<string, unknown>).kind === "image" &&
      typeof (layer as Record<string, unknown>).layerId === "string"
    ) {
      const id = (layer as Record<string, unknown>).layerId as string;
      const r2Key = byId.get(id);
      if (r2Key) {
        return { ...(layer as Record<string, unknown>), r2Key };
      }
    }
    return layer;
  });
  return { ...(s as object), layers: newLayers };
}

// ───── CAROUSEL_TEXT_OVERLAY ────────────────────────────────────────────

async function runOverlayPipeline(
  itemId: string,
  ctx: ToolContext,
  conceptRaw: unknown,
): Promise<CarouselOutcome> {
  const concept = textOverlayConceptSchema.parse(conceptRaw);

  // Step 1: base image. We let generate_image pick the default key via
  // (itemId) → keys.outputComposite. Then place_text_on_image consumes that.
  const baseImg = (await executeTool(
    "generate_image",
    {
      prompt: concept.basePrompt,
      itemId,
      size: "1024x1024",
      characterIds: [],
    },
    ctx,
  )) as { r2Key: string };

  const composite = (await executeTool(
    "place_text_on_image",
    {
      itemId,
      baseR2Key: baseImg.r2Key,
      text: concept.overlayText,
      textStyle: concept.textStyle,
    },
    ctx,
  )) as { r2Key: string };

  const saved = (await executeTool(
    "save_content_output",
    {
      itemId,
      r2Key: composite.r2Key,
      caption: concept.caption,
      meta: { kind: "CAROUSEL_TEXT_OVERLAY" },
    },
    ctx,
  )) as { outputId: string; r2Key: string; caption: string };

  await prisma.contentItem.update({
    where: { id: itemId },
    data: { status: "READY" },
  });

  return {
    kind: "CAROUSEL_TEXT_OVERLAY",
    outputId: saved.outputId,
    r2Key: saved.r2Key,
    caption: saved.caption,
  };
}
