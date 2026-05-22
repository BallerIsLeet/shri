import { describe, it, expect, beforeAll } from "vitest";
import { AIClient } from "./client.js";
import { loadAIConfig } from "./config.js";

// Real API only — see CLAUDE.md convention #4. Tests skipped without keys.
const hasKey = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasKey)("chat namespace (real OpenAI)", () => {
  // Defer construction past the skip check: describe() callbacks run at collect
  // time even when describe.skipIf evaluates true, so building the client here
  // would crash without an OPENAI_API_KEY. beforeAll fires only for live runs.
  let client: AIClient;

  beforeAll(() => {
    // Ensure the per-namespace models are set; CI envs may only carry OPENAI_API_KEY.
    process.env.OPENAI_CHAT_MODEL ??= "gpt-4o-mini";
    process.env.OPENAI_IMAGE_MODEL ??= "gpt-image-1";
    process.env.OPENAI_TTS_MODEL ??= "gpt-4o-mini-tts";
    process.env.OPENAI_TTS_VOICE ??= "alloy";
    client = new AIClient(loadAIConfig());
  });

  it("returns an assistant message for a simple completion", async () => {
    const res = await client.chat.complete({
      messages: [
        { role: "system", content: "You are a terse assistant. Answer in one word." },
        { role: "user", content: "Capital of France?" },
      ],
      temperature: 0,
      maxTokens: 16,
    });
    expect(res.message.role).toBe("assistant");
    expect(typeof res.message.content).toBe("string");
    expect(res.message.content.toLowerCase()).toContain("paris");
    expect(res.usage.promptTokens).toBeGreaterThan(0);
    expect(res.usage.completionTokens).toBeGreaterThan(0);
  }, 30_000);

  it("returns a tool_call when the model decides to invoke one", async () => {
    const res = await client.chat.completeWithTools({
      messages: [
        {
          role: "system",
          content:
            "You must call a tool to answer. Do not answer directly. Always invoke get_weather for any weather-like question.",
        },
        { role: "user", content: "What's the weather in Tokyo?" },
      ],
      tools: [
        {
          name: "get_weather",
          description: "Get the weather for a city",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      ],
      toolChoice: "auto",
      temperature: 0,
      maxTokens: 64,
    });
    expect(res.message.role).toBe("assistant");
    expect(res.message.toolCalls).toBeDefined();
    expect(res.message.toolCalls!.length).toBeGreaterThan(0);
    expect(res.message.toolCalls![0]!.name).toBe("get_weather");
  }, 30_000);
});
