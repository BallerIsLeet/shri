import { describe, it, expect, beforeAll } from "vitest";
import { AIClient } from "./client.js";
import { loadAIConfig } from "./config.js";

const hasKey = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasKey)("image namespace (real OpenAI)", () => {
  // Defer construction past the skip check — describe bodies run at collect time.
  let client: AIClient;

  beforeAll(() => {
    process.env.OPENAI_CHAT_MODEL ??= "gpt-4o-mini";
    process.env.OPENAI_IMAGE_MODEL ??= "gpt-image-1";
    process.env.OPENAI_TTS_MODEL ??= "gpt-4o-mini-tts";
    process.env.OPENAI_TTS_VOICE ??= "alloy";
    client = new AIClient(loadAIConfig());
  });

  it("generates a PNG buffer for a simple prompt", async () => {
    const res = await client.image.generate({
      prompt: "a small flat red circle on a plain white background, minimal",
      size: "1024x1024",
    });
    expect(res.buffers.length).toBe(1);
    const png = res.buffers[0]!;
    expect(png.length).toBeGreaterThan(100);
    // PNG magic bytes — covers both gpt-image-1 and dall-e gateways.
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50); // P
    expect(png[2]).toBe(0x4e); // N
    expect(png[3]).toBe(0x47); // G
  }, 60_000);
});
