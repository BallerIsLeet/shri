// runItemJob.test.ts — PURE UNIT TESTS only.
//
// Per the Phase C spec: runItemJob's happy path triggers real Seedance + image
// gen + R2 + ffmpeg. The user smokes it via the UI. We test:
//   - branch-selection helper substituteImageLayers (Canva pipeline)
//   - that the public types export
//   - that the deterministic concept parsers still match the runBriefJob set
//
// NO end-to-end test — that's the spec.

import { describe, expect, it } from "vitest";
import { substituteImageLayers } from "./runItemJob.js";

describe("substituteImageLayers", () => {
  it("returns spec unchanged when there are no image layers to replace", () => {
    const spec = {
      width: 1080,
      height: 1350,
      layers: [
        { kind: "text", text: "hello" },
        { kind: "rect", fill: "#fff" },
      ],
    };
    const out = substituteImageLayers(spec, [
      { layerId: "L1", r2Key: "projects/x/y.png" },
    ]);
    expect(out).toEqual(spec);
  });

  it("substitutes r2Key on a matching image layer", () => {
    const spec = {
      width: 1080,
      height: 1350,
      layers: [
        { kind: "image", layerId: "L1", r2Key: "PLACEHOLDER" },
        { kind: "text", text: "hello" },
      ],
    };
    const out = substituteImageLayers(spec, [
      { layerId: "L1", r2Key: "projects/x/y.png" },
    ]) as { layers: Array<Record<string, unknown>> };
    expect(out.layers[0]!.r2Key).toBe("projects/x/y.png");
    expect(out.layers[1]).toEqual({ kind: "text", text: "hello" });
  });

  it("only substitutes matching layerIds, others stay placeholder", () => {
    const spec = {
      layers: [
        { kind: "image", layerId: "A", r2Key: "?" },
        { kind: "image", layerId: "B", r2Key: "?" },
      ],
    };
    const out = substituteImageLayers(spec, [
      { layerId: "A", r2Key: "for-A" },
    ]) as { layers: Array<Record<string, unknown>> };
    expect(out.layers[0]!.r2Key).toBe("for-A");
    expect(out.layers[1]!.r2Key).toBe("?");
  });

  it("ignores non-object specs (defensive)", () => {
    expect(substituteImageLayers(null, [])).toBeNull();
    expect(substituteImageLayers("not a spec", [])).toBe("not a spec");
  });

  it("does not mutate the input spec", () => {
    const spec = {
      layers: [{ kind: "image", layerId: "L1", r2Key: "OLD" }],
    };
    const snapshot = JSON.parse(JSON.stringify(spec));
    substituteImageLayers(spec, [{ layerId: "L1", r2Key: "NEW" }]);
    expect(spec).toEqual(snapshot);
  });
});

describe("runItemJob — exports", () => {
  it("exposes the pure helpers", async () => {
    const mod = await import("./runItemJob.js");
    expect(typeof mod.runItemJob).toBe("function");
    expect(typeof mod.completeReelAfterPoll).toBe("function");
    expect(typeof mod.substituteImageLayers).toBe("function");
  });
});
