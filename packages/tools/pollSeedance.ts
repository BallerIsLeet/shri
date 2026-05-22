// pollSeedance — tool wrapper around `@shri/seedance.poll` +
// `@shri/seedance.downloadToR2`.
//
// The Seedance status enum is queued | running | succeeded | failed. We map
// that into a more orchestrator-friendly shape:
//   - PENDING   — keep polling (queued, running)
//   - DONE      — terminal success; video has been mirrored to R2
//   - FAILED    — terminal failure; orchestrator marks Job FAILED with error
//
// On DONE we always mirror to R2 (Seedance URLs expire). The R2 key is built
// via @shri/storage/keys — never inline (CLAUDE.md convention #2). For
// multi-scene reels the per-scene key is keys.outputSeedanceScene; otherwise
// keys.outputSeedance.
//
// NO mocks. Tests cover the pure status-mapping function only.

import { z } from "zod";
import { prisma } from "@shri/db";
import { poll as seedancePoll, downloadToR2 } from "@shri/seedance";
import type { SeedancePollOutput, SeedanceStatus } from "@shri/seedance";
import { keys } from "@shri/storage";
import type { ToolContext } from "./descriptors.js";

export const inputSchema = z.object({
  projectSlug: z.string().min(1),
  itemId: z.string().min(1),
  jobId: z.string().min(1),
  taskId: z.string().min(1),
  // When set, the downloaded MP4 goes to the per-scene R2 key — multi-scene
  // reels (docs/17) keep each scene separate before concat.
  sceneOrder: z.number().int().nonnegative().optional(),
});

export type ToolInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  status: z.enum(["PENDING", "DONE", "FAILED"]),
  // Populated only on DONE.
  r2Key: z.string().optional(),
  videoUrl: z.string().optional(),
  // Populated only on FAILED.
  error: z.string().optional(),
});

export type ToolOutput = z.infer<typeof outputSchema>;

export type MappedStatus = "PENDING" | "DONE" | "FAILED";

/**
 * Pure status-mapping function. Seedance enum → our terminal-vs-keep-polling
 * three-state. Exported for unit testing — no HTTP, no DB.
 */
export function mapSeedanceStatus(s: SeedanceStatus): MappedStatus {
  switch (s) {
    case "queued":
    case "running":
      return "PENDING";
    case "succeeded":
      return "DONE";
    case "failed":
      return "FAILED";
  }
}

/**
 * Pure terminal-decision helper. Given a poll response, decide which output
 * shape this maps to. Throws if the response is internally inconsistent
 * (succeeded but no video_url, failed without error message) so the
 * orchestrator can surface a clean error rather than a partial DB write.
 */
export function decideOutcome(poll: SeedancePollOutput): {
  status: MappedStatus;
  videoUrl?: string;
  error?: string;
} {
  const mapped = mapSeedanceStatus(poll.status);
  switch (mapped) {
    case "PENDING":
      return { status: "PENDING" };
    case "DONE": {
      if (!poll.videoUrl) {
        throw new Error(
          `poll_seedance_job: status=succeeded but content.video_url missing for task ${poll.taskId}`,
        );
      }
      return { status: "DONE", videoUrl: poll.videoUrl };
    }
    case "FAILED": {
      const msg = poll.error?.message ?? "unknown Seedance failure";
      return { status: "FAILED", error: msg };
    }
  }
}

/**
 * Build the destination R2 key for the downloaded MP4. Pure: only depends
 * on the @shri/storage/keys helpers. Centralized so submit and poll never
 * disagree about where the file lands.
 */
export function buildVideoKey(
  projectSlug: string,
  itemId: string,
  sceneOrder: number | undefined,
): string {
  return sceneOrder === undefined
    ? keys.outputSeedance(projectSlug, itemId)
    : keys.outputSeedanceScene(projectSlug, itemId, sceneOrder);
}

// ----- Handler -----

export async function handler(
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutput> {
  const input = inputSchema.parse(rawInput);

  const pollRes = await seedancePoll(input.taskId);
  const outcome = decideOutcome(pollRes);

  // Orchestrator owns logging; ctx is unused at this layer.
  void ctx;

  if (outcome.status === "PENDING") {
    return { status: "PENDING" };
  }

  if (outcome.status === "FAILED") {
    // Persist failure on the Job row; orchestrator may still re-enqueue if
    // policy says so but the row reflects truth right now.
    await prisma.job.update({
      where: { id: input.jobId },
      data: {
        status: "FAILED",
        error: outcome.error,
        finishedAt: new Date(),
      },
    });
    return { status: "FAILED", error: outcome.error };
  }

  // DONE — mirror to R2.
  const key = buildVideoKey(input.projectSlug, input.itemId, input.sceneOrder);
  const dl = await downloadToR2(outcome.videoUrl!, key);

  await prisma.job.update({
    where: { id: input.jobId },
    data: {
      status: "DONE",
      finishedAt: new Date(),
    },
  });

  return {
    status: "DONE",
    r2Key: dl.key,
    videoUrl: dl.url,
  };
}
