import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAIConfig } from "./config.js";

const KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_CHAT_MODEL",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_TTS_MODEL",
  "OPENAI_TTS_VOICE",
  "OPENAI_CHAT_API_KEY",
  "OPENAI_CHAT_BASE_URL",
  "OPENAI_IMAGE_API_KEY",
  "OPENAI_IMAGE_BASE_URL",
  "OPENAI_TTS_API_KEY",
  "OPENAI_TTS_BASE_URL",
] as const;

const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe("loadAIConfig", () => {
  function setMinimal(): void {
    process.env.OPENAI_API_KEY = "sk-shared";
    process.env.OPENAI_CHAT_MODEL = "gpt-4o";
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-1";
    process.env.OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
    process.env.OPENAI_TTS_VOICE = "alloy";
  }

  it("falls back every namespace to OPENAI_API_KEY + default base URL", () => {
    setMinimal();
    const cfg = loadAIConfig();
    expect(cfg.chat.apiKey).toBe("sk-shared");
    expect(cfg.image.apiKey).toBe("sk-shared");
    expect(cfg.tts.apiKey).toBe("sk-shared");
    expect(cfg.chat.baseURL).toBe("https://api.openai.com/v1");
    expect(cfg.image.baseURL).toBe("https://api.openai.com/v1");
    expect(cfg.tts.baseURL).toBe("https://api.openai.com/v1");
    expect(cfg.chat.model).toBe("gpt-4o");
    expect(cfg.image.model).toBe("gpt-image-1");
    expect(cfg.tts.model).toBe("gpt-4o-mini-tts");
    expect(cfg.tts.voice).toBe("alloy");
  });

  it("per-namespace API key overrides the shared default for that namespace only", () => {
    setMinimal();
    process.env.OPENAI_CHAT_API_KEY = "sk-or-chat";
    process.env.OPENAI_CHAT_BASE_URL = "https://openrouter.ai/api/v1";
    const cfg = loadAIConfig();
    expect(cfg.chat.apiKey).toBe("sk-or-chat");
    expect(cfg.chat.baseURL).toBe("https://openrouter.ai/api/v1");
    // Image + TTS unaffected.
    expect(cfg.image.apiKey).toBe("sk-shared");
    expect(cfg.tts.apiKey).toBe("sk-shared");
    expect(cfg.image.baseURL).toBe("https://api.openai.com/v1");
  });

  it("OPENAI_BASE_URL overrides the hard-coded default for all namespaces", () => {
    setMinimal();
    process.env.OPENAI_BASE_URL = "https://gateway.example.com/v1";
    const cfg = loadAIConfig();
    expect(cfg.chat.baseURL).toBe("https://gateway.example.com/v1");
    expect(cfg.image.baseURL).toBe("https://gateway.example.com/v1");
    expect(cfg.tts.baseURL).toBe("https://gateway.example.com/v1");
  });

  it("throws if no API key is available for a namespace", () => {
    process.env.OPENAI_CHAT_MODEL = "gpt-4o";
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-1";
    process.env.OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
    process.env.OPENAI_TTS_VOICE = "alloy";
    expect(() => loadAIConfig()).toThrow(/OPENAI_API_KEY/);
  });

  it("throws if a required model env var is missing", () => {
    setMinimal();
    delete process.env.OPENAI_CHAT_MODEL;
    expect(() => loadAIConfig()).toThrow(/OPENAI_CHAT_MODEL/);
  });
});
