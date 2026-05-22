// queues.ts — BullMQ queue NAMES + payload types.
//
// SINGLE source of truth for queue names. Both apps/worker (the consumer) and
// apps/web (the producer) import these constants so the two never drift.
//
// Why constants over instances? An instance needs a live Redis connection,
// which would force apps/web to take a Redis dep at module-load. Names are
// strings — cheap to share, no runtime coupling. Each side builds its own
// Queue / Worker instances around the same name.
//
// See docs/01-data-flow.md + docs/04-seedance.md for the three-stage state
// machine (BRIEF → ITEM → POLLING_TICK).

/**
 * BRIEF queue — runs `runBriefJob` end-to-end. One job per "Generate brief"
 * click in the UI. Produces a Brief row + N ContentItem rows.
 */
export const BRIEF_QUEUE = "shri:brief" as const;

/**
 * ITEM queue — runs `runItemJob` for one ContentItem. One job per "Generate
 * selected" tick. Deterministic pipeline (no LLM in happy path).
 */
export const ITEM_QUEUE = "shri:item" as const;

/**
 * Seedance polling tick — re-enqueued with `delay` to poll a single Seedance
 * task without blocking a worker. See docs/04-seedance.md.
 */
export const SEEDANCE_POLL_QUEUE = "shri:seedance-poll" as const;

export const QUEUE_NAMES = [BRIEF_QUEUE, ITEM_QUEUE, SEEDANCE_POLL_QUEUE] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * Default delay before re-polling a Seedance task. Seedance jobs typically
 * complete in 60-90s; 15s ticks give us 4-6 polls per task. See docs/04.
 */
export const SEEDANCE_POLL_DELAY_MS = 15_000;

/**
 * Cap on polling ticks per Seedance task. 20 ticks × 15s = 5 minutes — past
 * that the task is presumed stuck and the Job is marked FAILED. See docs/04
 * "Error handling" table.
 */
export const SEEDANCE_MAX_POLL_TICKS = 20;

// ── Payload shapes ────────────────────────────────────────────────────────

export type BriefJobPayload = {
  /** Project the brief is being drafted for. */
  projectId: string;
  /** Range in days the brief should cover (passed through to Brief row). */
  rangeDays?: number;
  /** Optional user note prepended to the user-prompt — UI "regenerate with hint". */
  hint?: string;
  /** Existing Brief row id to populate (web pre-creates one for navigation). When set,
   *  runBriefJob updates that row instead of creating a fresh Brief. */
  briefId?: string;
};

export type ItemJobPayload = {
  /** ContentItem id to generate. The item's conceptJson drives everything. */
  itemId: string;
};

/**
 * Seedance polling tick payload. Each scene of a multi-scene reel has its own
 * polling state machine — the worker tracks per-scene status on Job.logs and
 * only fires the post-scene work (concat, mux) when every scene is DONE.
 */
export type SeedancePollPayload = {
  /** Parent ContentItem. */
  itemId: string;
  /** Project slug — pollSeedance writes the downloaded MP4 to R2 keyed by this. */
  projectSlug: string;
  projectId: string;
  /** Job row id (created by submit_seedance_job). */
  jobId: string;
  /** BytePlus task id returned from submit. */
  taskId: string;
  /** Scene index within a multi-scene reel; omit for single-scene. */
  sceneOrder?: number;
  /** How many polls have already fired. Used to enforce SEEDANCE_MAX_POLL_TICKS. */
  attempt: number;
};
