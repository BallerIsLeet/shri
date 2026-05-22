// apps/worker tests — wiring assertions + (when REDIS_URL is set) a live
// integration that boots the worker bundle and shuts it down cleanly.

import { afterAll, describe, expect, it } from "vitest";
import {
  BRIEF_QUEUE,
  ITEM_QUEUE,
  SEEDANCE_POLL_QUEUE,
} from "@shri/orchestrator";
import * as workerModule from "./index.js";

const hasRedis = !!process.env.REDIS_URL;

describe("worker — wiring (no live infra)", () => {
  it("re-exports the canonical queue names from @shri/orchestrator", () => {
    // The worker and any external producer (apps/web) MUST agree on these
    // names. Re-exporting them from the worker module guarantees both surfaces
    // point to the same constants.
    expect(workerModule.BRIEF_QUEUE).toBe(BRIEF_QUEUE);
    expect(workerModule.ITEM_QUEUE).toBe(ITEM_QUEUE);
    expect(workerModule.SEEDANCE_POLL_QUEUE).toBe(SEEDANCE_POLL_QUEUE);

    expect(BRIEF_QUEUE).toBe("shri:brief");
    expect(ITEM_QUEUE).toBe("shri:item");
    expect(SEEDANCE_POLL_QUEUE).toBe("shri:seedance-poll");
  });

  it("exposes buildWorkers + makeRedisConnection factories", () => {
    expect(typeof workerModule.buildWorkers).toBe("function");
    expect(typeof workerModule.makeRedisConnection).toBe("function");
  });

  it("throws a clear error when REDIS_URL is missing", () => {
    const original = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      expect(() => workerModule.makeRedisConnection()).toThrow(/REDIS_URL/);
    } finally {
      if (original !== undefined) process.env.REDIS_URL = original;
    }
  });
});

describe.skipIf(!hasRedis)("worker — live Redis bootstrap", () => {
  // Build a real bundle, ensure workers come up and close cleanly. We don't
  // dispatch any jobs — that's covered downstream by the runBriefJob /
  // runItemJob live tests (and by the user-owned manual smokes).

  let bundle: workerModule.WorkerBundle | undefined;

  afterAll(async () => {
    if (bundle) await bundle.close();
  });

  it("starts and shuts down without errors", async () => {
    bundle = workerModule.buildWorkers();
    expect(bundle.workers.brief.name).toBe(BRIEF_QUEUE);
    expect(bundle.workers.item.name).toBe(ITEM_QUEUE);
    expect(bundle.workers.seedancePoll.name).toBe(SEEDANCE_POLL_QUEUE);
    expect(bundle.queues.brief.name).toBe(BRIEF_QUEUE);

    // The Worker instances are real — assert basic shape rather than poking
    // at internals (bullmq's `concurrency` is an instance getter but reading
    // it on a closed worker is undefined behaviour).
    expect(typeof bundle.workers.brief.close).toBe("function");
    expect(typeof bundle.workers.item.close).toBe("function");
    expect(typeof bundle.workers.seedancePoll.close).toBe("function");

    await bundle.close();
    bundle = undefined;
  }, 30_000);
});
