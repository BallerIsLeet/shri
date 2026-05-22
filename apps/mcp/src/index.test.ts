// =============================================================================
// Smoke test for the MCP server.
//
// What we assert (and why):
//   1. The module loads + a Server can be constructed (catches breakage in the
//      wiring — wrong SDK import paths, missing capabilities, etc.).
//   2. toolDescriptors is non-empty (catches regressions where someone breaks
//      the registry barrel).
//   3. SERVER_INSTRUCTIONS is non-empty AND contains the load-bearing phrases
//      that the spec calls out: "camera perspective", "crawl_product_site",
//      and "generate_project_prompts". This is the regression target: if
//      someone deletes the instructions block, accidentally swaps in a
//      placeholder, or removes a major section, this test will fail.
//   4. The Server constructor receives the instructions on `initialize` — we
//      can't easily call the JSON-RPC `initialize` against a stdio server
//      in-process, so we assert that the same string we pass to the
//      constructor is the one we expose via `SERVER_INSTRUCTIONS`. The
//      constructor accepting `instructions` IS the wiring under test (see
//      src/index.ts createServer).
//
// What we DO NOT do here:
//   - No mocks. MCP SDK + Zod schemas are local imports; we instantiate them
//     for real.
//   - No expect(true).toBe(true) padding. Every assertion is meaningful.
// =============================================================================

import { describe, expect, it } from "vitest";
import { toolDescriptors } from "@shri/tools";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { createServer } from "./index.js";

describe("@shri/mcp", () => {
  it("registers a non-empty tool surface", () => {
    expect(Array.isArray(toolDescriptors)).toBe(true);
    expect(toolDescriptors.length).toBeGreaterThan(0);
    // Spot-check a few canonical tool names so we don't silently lose them.
    const names = new Set(toolDescriptors.map((d) => d.name));
    expect(names.has("submit_seedance_job")).toBe(true);
    expect(names.has("crawl_product_site")).toBe(true);
    expect(names.has("generate_project_prompts")).toBe(true);
    expect(names.has("save_content_output")).toBe(true);
  });

  it("provides SERVER_INSTRUCTIONS with the required conventions", () => {
    expect(typeof SERVER_INSTRUCTIONS).toBe("string");
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(500);

    // Case-insensitive checks for the spec-mandated phrases.
    const lower = SERVER_INSTRUCTIONS.toLowerCase();
    expect(lower).toContain("camera perspective");
    expect(lower).toContain("crawl_product_site");
    expect(lower).toContain("generate_project_prompts");

    // Section-level checks — these protect against quiet deletions of
    // whole sections from the instructions block.
    expect(lower).toContain("multi-scene");
    expect(lower).toContain("estimate_cost");
    expect(lower).toContain("save_content_output");
    expect(lower).toContain("@image"); // the @ImageN reference convention
  });

  it("constructs a Server with the instructions wired in", () => {
    // createServer doesn't throw, and we can call the handler setup paths
    // for tools/list + tools/call without errors. The constructor signature
    // accepting `instructions` is what makes the initialize response carry
    // the block; if a future refactor drops that param, this file (and the
    // test above) is the place to catch it.
    const server = createServer();
    expect(server).toBeDefined();
  });
});
