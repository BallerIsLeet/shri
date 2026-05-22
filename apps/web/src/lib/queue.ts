import { Queue, type JobsOptions } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import {
  BRIEF_QUEUE,
  ITEM_QUEUE,
  SEEDANCE_POLL_QUEUE,
  type BriefJobPayload,
  type ItemJobPayload,
} from "@shri/orchestrator";

// BullMQ enqueue helpers for tRPC mutations. Web is producer-only — the
// consumer worker lives in apps/worker/.
//
// Queue NAMES + payload TYPES come from @shri/orchestrator so producer (web)
// and consumer (worker) can never drift.

// Re-export so existing callers (tests, routers) keep their import paths.
export {
  BRIEF_QUEUE,
  ITEM_QUEUE,
  SEEDANCE_POLL_QUEUE,
  type BriefJobPayload,
  type ItemJobPayload,
};

// Lazy singletons so importing this module without REDIS_URL configured
// (e.g. for typecheck) doesn't throw.
let _connection: Redis | undefined;
let _briefQueue: Queue | undefined;
let _itemQueue: Queue | undefined;

function getRedis(): Redis {
  if (_connection) return _connection;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("@shri/web/queue: REDIS_URL must be set to enqueue jobs.");
  }
  _connection = new IORedis(url, {
    // BullMQ requires this — null means "wait forever for commands".
    maxRetriesPerRequest: null,
  });
  return _connection;
}

export function getBriefQueue(): Queue {
  if (_briefQueue) return _briefQueue;
  _briefQueue = new Queue(BRIEF_QUEUE, { connection: getRedis() });
  return _briefQueue;
}

export function getItemQueue(): Queue {
  if (_itemQueue) return _itemQueue;
  _itemQueue = new Queue(ITEM_QUEUE, { connection: getRedis() });
  return _itemQueue;
}

export async function enqueueBrief(
  payload: BriefJobPayload,
  opts?: JobsOptions,
): Promise<string> {
  const job = await getBriefQueue().add("brief", payload, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 1,
    ...opts,
  });
  return job.id!;
}

export async function enqueueItem(
  payload: ItemJobPayload,
  opts?: JobsOptions,
): Promise<string> {
  const job = await getItemQueue().add("item", payload, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 1,
    ...opts,
  });
  return job.id!;
}

// Test-only reset.
export function __resetQueuesForTests(): void {
  _briefQueue = undefined;
  _itemQueue = undefined;
  if (_connection) {
    void _connection.quit().catch(() => undefined);
  }
  _connection = undefined;
}
