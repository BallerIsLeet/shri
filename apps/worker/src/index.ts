// apps/worker — BullMQ worker bootstrap.
//
// Three queues, three handlers:
//   - BRIEF_QUEUE          → runBriefJob
//   - ITEM_QUEUE           → runItemJob (deterministic pipeline)
//   - SEEDANCE_POLL_QUEUE  → poll_seedance_job (re-enqueues with delay until DONE)
//
// CONVENTIONS:
//   - All Seedance polling is non-blocking: we re-enqueue with delay 15s
//     (SEEDANCE_POLL_DELAY_MS) rather than spinning a worker. See docs/04.
//   - All tool calls during polling go through executeTool(name, input, ctx)
//     from @shri/tools (CLAUDE.md #2).
//   - All AI calls travel through @shri/ai via the orchestrator package —
//     the worker NEVER imports openai directly.
//   - Graceful SIGTERM/SIGINT: BullMQ's Worker.close() waits for in-flight
//     jobs to settle before tearing down the connection.
//
// The worker process runs on Railway as a separate service. One process
// handles all three queues — concurrency settings keep them tuned per queue.

import { Worker, Queue, type Job } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { executeTool, type ToolContext } from "@shri/tools";
import { prisma } from "@shri/db";
import {
  BRIEF_QUEUE,
  ITEM_QUEUE,
  SEEDANCE_POLL_QUEUE,
  SEEDANCE_POLL_DELAY_MS,
  SEEDANCE_MAX_POLL_TICKS,
  completeReelAfterPoll,
  runBriefJob,
  runItemJob,
  type BriefJobPayload,
  type ItemJobPayload,
  type SeedancePollPayload,
} from "@shri/orchestrator";
import { keys } from "@shri/storage";

// ─── Queue NAMES re-exported so callers importing from @shri/worker get them
// from one place. The orchestrator also exports them; this is a convenience.
export {
  BRIEF_QUEUE,
  ITEM_QUEUE,
  SEEDANCE_POLL_QUEUE,
} from "@shri/orchestrator";

// ─── Concurrency tuning per queue ─────────────────────────────────────────
// Brief: long-running LLM loop, mostly I/O wait. 4 concurrent OK.
// Item: deterministic pipeline; image/video gen is the hot path. 4 concurrent.
// Polling tick: nearly free (one HTTP request to Seedance). High concurrency.
const CONCURRENCY = {
  brief: parseIntEnv("WORKER_BRIEF_CONCURRENCY", 4),
  item: parseIntEnv("WORKER_ITEM_CONCURRENCY", 4),
  poll: parseIntEnv("WORKER_POLL_CONCURRENCY", 16),
} as const;

function parseIntEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ─── Connection ────────────────────────────────────────────────────────────
// BullMQ requires maxRetriesPerRequest=null on the ioredis connection it uses
// for its blocking consumers — otherwise it throws on first reconnect.
export function makeRedisConnection(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "@shri/worker: REDIS_URL not set. See .env.example.",
    );
  }
  return new IORedis(url, { maxRetriesPerRequest: null });
}

// ─── Queue + worker registry ───────────────────────────────────────────────
// We keep references so the graceful-shutdown step can close them all in order
// (workers first → queues → connection).

export type WorkerBundle = {
  connection: Redis;
  queues: {
    brief: Queue<BriefJobPayload>;
    item: Queue<ItemJobPayload>;
    seedancePoll: Queue<SeedancePollPayload>;
  };
  workers: {
    brief: Worker<BriefJobPayload>;
    item: Worker<ItemJobPayload>;
    seedancePoll: Worker<SeedancePollPayload>;
  };
  close: () => Promise<void>;
};

export function buildWorkers(opts: {
  connection?: Redis;
} = {}): WorkerBundle {
  const connection = opts.connection ?? makeRedisConnection();

  const briefQueue = new Queue<BriefJobPayload>(BRIEF_QUEUE, { connection });
  const itemQueue = new Queue<ItemJobPayload>(ITEM_QUEUE, { connection });
  const seedancePollQueue = new Queue<SeedancePollPayload>(
    SEEDANCE_POLL_QUEUE,
    { connection },
  );

  // ─── BRIEF handler ──────────────────────────────────────────────────
  const briefWorker = new Worker<BriefJobPayload>(
    BRIEF_QUEUE,
    async (job: Job<BriefJobPayload>) => {
      const { projectId, rangeDays, hint, briefId } = job.data;
      const res = await runBriefJob({ projectId, rangeDays, hint, briefId });
      return {
        briefId: res.briefId,
        itemIds: res.itemIds,
        iterations: res.iterations,
      };
    },
    { connection, concurrency: CONCURRENCY.brief },
  );

  // ─── ITEM handler ───────────────────────────────────────────────────
  const itemWorker = new Worker<ItemJobPayload>(
    ITEM_QUEUE,
    async (job: Job<ItemJobPayload>) => {
      const { itemId } = job.data;
      const enqueuePollTick = async (
        payload: SeedancePollPayload,
        delayMs: number,
      ): Promise<void> => {
        await seedancePollQueue.add("poll", payload, { delay: delayMs });
      };
      const res = await runItemJob({ itemId, enqueuePollTick });
      return res;
    },
    { connection, concurrency: CONCURRENCY.item },
  );

  // ─── SEEDANCE POLLING handler ───────────────────────────────────────
  // Per-tick logic:
  //   1. executeTool("poll_seedance_job", ...) → PENDING | DONE | FAILED.
  //   2. PENDING → re-enqueue this same payload with attempt+1 + delay.
  //        - Hard cap SEEDANCE_MAX_POLL_TICKS; past that → mark Job FAILED.
  //   3. DONE → record the per-scene download. If this scene is the LAST
  //        one not-yet-done for its item, kick the post-Seedance phase
  //        (concat + tts + mux + save_content_output) via completeReelAfterPoll.
  //   4. FAILED → mark the item FAILED.
  const seedancePollWorker = new Worker<SeedancePollPayload>(
    SEEDANCE_POLL_QUEUE,
    async (job: Job<SeedancePollPayload>) => {
      const p = job.data;
      const ctx: ToolContext = {
        projectId: p.projectId,
        projectSlug: p.projectSlug,
        source: "worker",
        itemId: p.itemId,
      };

      const pollOut = (await executeTool(
        "poll_seedance_job",
        {
          projectSlug: p.projectSlug,
          itemId: p.itemId,
          jobId: p.jobId,
          taskId: p.taskId,
          sceneOrder: p.sceneOrder,
        },
        ctx,
      )) as {
        status: "PENDING" | "DONE" | "FAILED";
        r2Key?: string;
        error?: string;
      };

      if (pollOut.status === "PENDING") {
        const attempt = p.attempt + 1;
        if (attempt >= SEEDANCE_MAX_POLL_TICKS) {
          await prisma.contentItem.update({
            where: { id: p.itemId },
            data: { status: "FAILED" },
          });
          await prisma.job.update({
            where: { id: p.jobId },
            data: {
              status: "FAILED",
              error: `polling timed out after ${SEEDANCE_MAX_POLL_TICKS} ticks`,
              finishedAt: new Date(),
            },
          });
          return { ok: false, reason: "poll_timeout" };
        }
        await seedancePollQueue.add(
          "poll",
          { ...p, attempt },
          { delay: SEEDANCE_POLL_DELAY_MS },
        );
        return { ok: true, status: "PENDING", attempt };
      }

      if (pollOut.status === "FAILED") {
        await prisma.contentItem.update({
          where: { id: p.itemId },
          data: { status: "FAILED" },
        });
        return { ok: false, reason: "seedance_failed", error: pollOut.error };
      }

      // DONE — see if this completes the item's scene set.
      const ready = await collectReadyScenes(p);
      if (!ready.allReady) {
        return {
          ok: true,
          status: "SCENE_DONE",
          completed: ready.completed,
          total: ready.total,
        };
      }

      // Race guard: when 2+ scenes finish near-simultaneously, multiple
      // poll handlers can pass the allReady check. Whichever one wins the
      // claim runs the concat + mux + save_content_output; the others
      // observe the existing ContentOutput row and short-circuit.
      const already = await prisma.contentOutput.findFirst({
        where: { itemId: p.itemId },
        select: { id: true },
      });
      if (already) {
        return {
          ok: true,
          status: "ALREADY_COMPLETED",
          outputId: already.id,
        };
      }

      const completion = await completeReelAfterPoll({
        itemId: p.itemId,
        ctx,
        sceneR2Keys: ready.orderedR2Keys,
      });
      return { ok: true, status: "READY", outputId: completion.outputId };
    },
    { connection, concurrency: CONCURRENCY.poll },
  );

  // ─── Wire fault handlers so background failures don't go silent ────
  for (const [name, w] of Object.entries({
    brief: briefWorker,
    item: itemWorker,
    seedancePoll: seedancePollWorker,
  })) {
    w.on("failed", async (job, err) => {
      // Surface to Postgres if we can recover an itemId; otherwise just log.
      // eslint-disable-next-line no-console
      console.error(
        `[worker:${name}] job ${job?.id ?? "?"} failed: ${err.message}`,
      );
      const payload = job?.data as { itemId?: string } | undefined;
      if (payload?.itemId) {
        try {
          await prisma.contentItem.update({
            where: { id: payload.itemId },
            data: { status: "FAILED" },
          });
        } catch {
          // Item may not exist if the failure was in payload parsing.
        }
      }
    });
  }

  // ─── Close helper for graceful shutdown ────────────────────────────
  const close = async (): Promise<void> => {
    await Promise.all([
      briefWorker.close(),
      itemWorker.close(),
      seedancePollWorker.close(),
    ]);
    await Promise.all([
      briefQueue.close(),
      itemQueue.close(),
      seedancePollQueue.close(),
    ]);
    await connection.quit();
  };

  return {
    connection,
    queues: { brief: briefQueue, item: itemQueue, seedancePoll: seedancePollQueue },
    workers: {
      brief: briefWorker,
      item: itemWorker,
      seedancePoll: seedancePollWorker,
    },
    close,
  };
}

/**
 * Once a scene poll returns DONE, check if every scene for the item is on
 * disk. For single-scene items this is trivially true after one DONE; for
 * multi-scene we infer expectedness from the item's conceptJson and probe
 * R2 (cheaper than tracking per-scene Job rows for the cross-scene
 * coordination layer).
 *
 * We return the ORDERED R2 keys so the caller can pass them straight to
 * concat_videos.
 */
async function collectReadyScenes(
  p: SeedancePollPayload,
): Promise<
  | { allReady: false; completed: number; total: number; orderedR2Keys: string[] }
  | { allReady: true; completed: number; total: number; orderedR2Keys: string[] }
> {
  // Fast path: single scene (no sceneOrder) → 1 of 1, always allReady.
  if (p.sceneOrder === undefined) {
    return {
      allReady: true,
      completed: 1,
      total: 1,
      orderedR2Keys: [keys.outputSeedance(p.projectSlug, p.itemId)],
    };
  }

  // Multi-scene: look up sibling Job rows for this item to know how many
  // scenes we expected. We treat any Job(kind=REEL).status=DONE as a finished
  // scene. (The orchestrator persists exactly one Job per submit_seedance_job
  // call, and pollSeedance flips it to DONE.)
  const item = await prisma.contentItem.findUnique({
    where: { id: p.itemId },
    select: { conceptJson: true },
  });
  if (!item) {
    throw new Error(`collectReadyScenes: item ${p.itemId} not found`);
  }
  const concept = item.conceptJson as { scenes?: Array<{ order: number }> };
  const total = concept.scenes?.length ?? 0;

  const jobsForItem = await prisma.job.findMany({
    where: { itemId: p.itemId, kind: "REEL" },
    select: { status: true },
  });

  const done = jobsForItem.filter((j) => j.status === "DONE").length;

  if (done < total) {
    return {
      allReady: false,
      completed: done,
      total,
      orderedR2Keys: [],
    };
  }

  // All done — build the ordered list from the conceptJson's scene order.
  const orderedR2Keys = (concept.scenes ?? [])
    .map((s) => s.order)
    .sort((a, b) => a - b)
    .map((order) => keys.outputSeedanceScene(p.projectSlug, p.itemId, order));

  return { allReady: true, completed: done, total, orderedR2Keys };
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────
// When run directly (not imported by tests), spin up the workers and wait for
// SIGTERM/SIGINT.

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("[worker] starting…");
  const bundle = buildWorkers();
  // eslint-disable-next-line no-console
  console.log(
    `[worker] listening on queues: ${BRIEF_QUEUE}, ${ITEM_QUEUE}, ${SEEDANCE_POLL_QUEUE}`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`[worker] received ${signal}, shutting down…`);
    await bundle.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", (s) => void shutdown(s));
  process.on("SIGINT", (s) => void shutdown(s));
}

// Allow `tsx src/index.ts` to launch the worker, while keeping the module
// importable from tests + future tRPC routes that want the queue instances.
// Crude entrypoint detection: argv[1] ends in "index.ts" or "index.js" AND
// it's not a vitest invocation.
const argv1 = typeof process !== "undefined" ? process.argv[1] ?? "" : "";
const isDirect =
  /index\.(ts|js)$/.test(argv1) && !/vitest/.test(argv1);

if (isDirect) {
  void main();
}
