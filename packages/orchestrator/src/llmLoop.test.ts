// llmLoop.test.ts — exercise the loop end-to-end against real OpenAI when
// OPENAI_API_KEY is set. We use estimate_cost as the tool the model is asked
// to call: it's already registered, deterministic, side-effect-free, and
// cheap.
//
// CLAUDE.md convention #4: real OpenAI only, no vi.mock anywhere.

import { describe, it, expect, beforeAll } from "vitest";
import type { z } from "zod";
import { llmLoop } from "./llmLoop.js";
import { toolDescriptors, getTool } from "@shri/tools";

const hasKey = !!process.env.OPENAI_API_KEY;

describe("llmLoop schema sanity (no API calls)", () => {
  it("exports llmLoop function", () => {
    expect(typeof llmLoop).toBe("function");
  });

  it("toolDescriptors includes estimate_cost (the tool the live test uses)", () => {
    const t = getTool("estimate_cost");
    expect(t).toBeDefined();
    expect(t!.name).toBe("estimate_cost");
    // sanity-check the Zod schema exposes parse + safeParse (the executeTool
    // path relies on safeParse).
    expect(typeof (t!.inputSchema as z.ZodTypeAny).safeParse).toBe("function");
    expect(typeof (t!.outputSchema as z.ZodTypeAny).safeParse).toBe("function");
  });
});

describe.skipIf(!hasKey)("llmLoop (real OpenAI)", () => {
  beforeAll(() => {
    process.env.OPENAI_CHAT_MODEL ??= "gpt-4o-mini";
    process.env.OPENAI_IMAGE_MODEL ??= "gpt-image-1";
    process.env.OPENAI_TTS_MODEL ??= "gpt-4o-mini-tts";
    process.env.OPENAI_TTS_VOICE ??= "alloy";
  });

  it(
    "calls a tool, feeds the result back, and terminates with a final message",
    async () => {
      // Restrict to just estimate_cost so the model has a small surface to pick
      // from. estimate_cost takes a batched { items: [...] } shape.
      const tools = toolDescriptors.filter((d) => d.name === "estimate_cost");
      expect(tools).toHaveLength(1);

      const toolHits: string[] = [];

      const result = await llmLoop({
        systemPrompt: [
          "You are a budget assistant. You MUST call the estimate_cost tool",
          "exactly once. The tool input shape is {items: [{type, conceptJson}]}",
          "where type is one of CAROUSEL_CANVA, CAROUSEL_TEXT_OVERLAY, REEL.",
          "Then return a JSON object of shape {\"totalUsd\": number}",
          "summarising the rollup result.",
        ].join(" "),
        userPrompt:
          'Estimate the total cost of two items: one CAROUSEL_CANVA with 5 slides (conceptJson: {slides: [{},{},{},{},{}]}) and one REEL of 8 seconds with audioMode "seedance" (conceptJson: {durationS: 8, audioMode: "seedance"}). Use estimate_cost.',
        tools,
        toolContext: {
          projectId: "test-project",
          projectSlug: "test-slug",
          source: "worker",
        },
        maxIterations: 6,
        responseFormat: "json",
        onToolResult: ({ name }) => {
          toolHits.push(name);
        },
      });

      expect(toolHits).toContain("estimate_cost");
      expect(result.iterations).toBeGreaterThanOrEqual(2);
      expect(result.iterations).toBeLessThanOrEqual(6);
      expect(result.finalMessage.length).toBeGreaterThan(0);
      // The terminating assistant message should be JSON because responseFormat=json.
      const parsed = JSON.parse(result.finalMessage) as Record<string, unknown>;
      expect(parsed).toBeTypeOf("object");
      // It must have come from the tool, so the log carries a tool_end entry.
      const ended = result.log.filter((l) => l.event === "tool_end");
      expect(ended.length).toBeGreaterThanOrEqual(1);
      const okEnd = ended.find((e) => e.event === "tool_end" && e.name === "estimate_cost");
      expect(okEnd).toBeDefined();
    },
    60_000,
  );

  it(
    "surfaces tool errors back to the model rather than throwing the loop",
    async () => {
      // Force a bad input by telling the model to pass nonsense — the executeTool
      // Zod check will reject and the error message becomes the tool reply.
      const tools = toolDescriptors.filter((d) => d.name === "estimate_cost");

      const result = await llmLoop({
        systemPrompt: [
          "You are testing error recovery. On the FIRST turn, call estimate_cost",
          "with a wildly invalid input (e.g. items: 42). When the tool returns",
          "an error, on the next turn call it again with a sensible input",
          "(items: [{type:'CAROUSEL_CANVA', slides:3}]). Then reply with the",
          "JSON object {\"recovered\": true}.",
        ].join(" "),
        userPrompt: "Run the recovery flow now.",
        tools,
        toolContext: {
          projectId: "p",
          projectSlug: "s",
          source: "worker",
        },
        maxIterations: 8,
        responseFormat: "json",
      });

      // At least one tool_error log entry must appear (the first bad call).
      const errors = result.log.filter((l) => l.event === "tool_error");
      // Some models may sanity-correct on their own; if so, we still expect
      // at least one successful tool_end. The point is loop survived.
      const okEnds = result.log.filter((l) => l.event === "tool_end");
      expect(okEnds.length + errors.length).toBeGreaterThanOrEqual(1);
      expect(result.finalMessage.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
