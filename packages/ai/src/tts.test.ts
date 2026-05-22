import { describe, it, expect, beforeAll } from "vitest";
import { AIClient } from "./client.js";
import { loadAIConfig } from "./config.js";

const hasKey = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasKey)("tts namespace (real OpenAI)", () => {
  // Defer construction past the skip check — describe bodies run at collect time.
  let client: AIClient;

  beforeAll(() => {
    process.env.OPENAI_CHAT_MODEL ??= "gpt-4o-mini";
    process.env.OPENAI_IMAGE_MODEL ??= "gpt-image-1";
    process.env.OPENAI_TTS_MODEL ??= "gpt-4o-mini-tts";
    process.env.OPENAI_TTS_VOICE ??= "alloy";
    client = new AIClient(loadAIConfig());
  });

  it("produces a non-empty MP3 buffer for a short phrase", async () => {
    const res = await client.tts.speak({
      text: "Hello from the studio.",
      format: "mp3",
    });
    expect(res.buffer.length).toBeGreaterThan(1024);
    // MP3 frame sync byte: 0xFF, second byte starts 0xE/0xF (frame header).
    // Or ID3v2 header: "ID3".
    const head = res.buffer.subarray(0, 3).toString("ascii");
    const isId3 = head === "ID3";
    const isFrame = res.buffer[0] === 0xff && (res.buffer[1]! & 0xe0) === 0xe0;
    expect(isId3 || isFrame).toBe(true);
    expect(res.durationS).toBeGreaterThan(0);
  }, 30_000);
});
