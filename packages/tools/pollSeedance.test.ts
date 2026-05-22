// pollSeedance.test.ts — pure status-mapping & key-building.
// No HTTP, no DB, no mocks. CLAUDE.md convention #4.

import { describe, expect, it } from "vitest";
import {
  buildVideoKey,
  decideOutcome,
  inputSchema,
  mapSeedanceStatus,
} from "./pollSeedance.js";

describe("mapSeedanceStatus", () => {
  it("queued → PENDING", () => {
    expect(mapSeedanceStatus("queued")).toBe("PENDING");
  });

  it("running → PENDING", () => {
    expect(mapSeedanceStatus("running")).toBe("PENDING");
  });

  it("succeeded → DONE", () => {
    expect(mapSeedanceStatus("succeeded")).toBe("DONE");
  });

  it("failed → FAILED", () => {
    expect(mapSeedanceStatus("failed")).toBe("FAILED");
  });
});

describe("decideOutcome", () => {
  it("PENDING for running with no video_url", () => {
    const out = decideOutcome({ taskId: "t1", status: "running" });
    expect(out.status).toBe("PENDING");
    expect(out.videoUrl).toBeUndefined();
  });

  it("DONE for succeeded with video_url", () => {
    const out = decideOutcome({
      taskId: "t1",
      status: "succeeded",
      videoUrl: "https://example.com/x.mp4",
    });
    expect(out.status).toBe("DONE");
    expect(out.videoUrl).toBe("https://example.com/x.mp4");
  });

  it("THROWS for succeeded without video_url (Seedance contract drift)", () => {
    expect(() =>
      decideOutcome({ taskId: "t1", status: "succeeded" }),
    ).toThrow(/video_url missing/);
  });

  it("FAILED carries the error message", () => {
    const out = decideOutcome({
      taskId: "t1",
      status: "failed",
      error: { code: "X", message: "policy violation" },
    });
    expect(out.status).toBe("FAILED");
    expect(out.error).toBe("policy violation");
  });

  it("FAILED with missing error message falls back to a sentinel", () => {
    const out = decideOutcome({ taskId: "t1", status: "failed" });
    expect(out.status).toBe("FAILED");
    expect(out.error).toBe("unknown Seedance failure");
  });
});

describe("buildVideoKey", () => {
  it("uses outputSeedance when sceneOrder is undefined (single-scene)", () => {
    expect(buildVideoKey("my-app", "item_x", undefined)).toBe(
      "projects/my-app/outputs/item_x/seedance.mp4",
    );
  });

  it("uses outputSeedanceScene with the order number (multi-scene)", () => {
    expect(buildVideoKey("my-app", "item_x", 1)).toBe(
      "projects/my-app/outputs/item_x/seedance-1.mp4",
    );
    expect(buildVideoKey("my-app", "item_x", 3)).toBe(
      "projects/my-app/outputs/item_x/seedance-3.mp4",
    );
  });
});

describe("inputSchema", () => {
  it("accepts a minimal poll input", () => {
    const res = inputSchema.parse({
      projectSlug: "my-app",
      itemId: "item_x",
      jobId: "job_x",
      taskId: "task_x",
    });
    expect(res.taskId).toBe("task_x");
    expect(res.sceneOrder).toBeUndefined();
  });

  it("accepts a multi-scene poll input", () => {
    const res = inputSchema.parse({
      projectSlug: "my-app",
      itemId: "item_x",
      jobId: "job_x",
      taskId: "task_x",
      sceneOrder: 2,
    });
    expect(res.sceneOrder).toBe(2);
  });

  it("rejects negative sceneOrder", () => {
    expect(
      inputSchema.safeParse({
        projectSlug: "my-app",
        itemId: "item_x",
        jobId: "job_x",
        taskId: "task_x",
        sceneOrder: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects empty taskId", () => {
    expect(
      inputSchema.safeParse({
        projectSlug: "my-app",
        itemId: "item_x",
        jobId: "job_x",
        taskId: "",
      }).success,
    ).toBe(false);
  });
});
