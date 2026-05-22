import { describe, it, expect } from "vitest";
import {
  SYSTEM_PROMPT,
  inputSchema,
  outputSchema,
  parseAssistantJson,
} from "./chatDesignCharacter.js";

describe("chat_design_character — schema", () => {
  it("requires characterId and message", () => {
    expect(inputSchema.safeParse({}).success).toBe(false);
    expect(
      inputSchema.safeParse({ characterId: "c1", message: "" }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({ characterId: "c1", message: "hi" }).success,
    ).toBe(true);
  });

  it("accepts optional priorTurns with role+content shape", () => {
    const ok = inputSchema.safeParse({
      characterId: "c1",
      message: "hi",
      priorTurns: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "yes" },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects priorTurns with bad role", () => {
    const r = inputSchema.safeParse({
      characterId: "c1",
      message: "hi",
      priorTurns: [{ role: "system", content: "no" }],
    });
    expect(r.success).toBe(false);
  });

  it("output schema validates", () => {
    const ok = outputSchema.safeParse({
      reply: "what species?",
      suggestedDescription: null,
      turns: [{ role: "user", content: "hi" }],
    });
    expect(ok.success).toBe(true);
  });
});

describe("chat_design_character — parseAssistantJson", () => {
  it("parses a strict JSON object", () => {
    const r = parseAssistantJson(
      '{"reply":"What species?","suggestedDescription":null}',
    );
    expect(r.reply).toBe("What species?");
    expect(r.suggestedDescription).toBeNull();
  });

  it("parses JSON embedded in prose (best-effort)", () => {
    const r = parseAssistantJson(
      'Here is the JSON: {"reply":"ok","suggestedDescription":"warm brown skin, glasses"}',
    );
    expect(r.reply).toBe("ok");
    expect(r.suggestedDescription).toContain("glasses");
  });

  it("throws when no JSON object can be found", () => {
    expect(() => parseAssistantJson("hello world")).toThrow();
  });

  it("throws when reply is missing", () => {
    expect(() => parseAssistantJson('{"suggestedDescription":null}')).toThrow();
  });

  it("treats omitted suggestedDescription as null", () => {
    const r = parseAssistantJson('{"reply":"hi"}');
    expect(r.suggestedDescription).toBeNull();
  });
});

describe("chat_design_character — system prompt", () => {
  it("instructs the model to emit JSON", () => {
    expect(SYSTEM_PROMPT).toContain("JSON");
    expect(SYSTEM_PROMPT).toContain("suggestedDescription");
    expect(SYSTEM_PROMPT).toContain("reply");
  });
});
