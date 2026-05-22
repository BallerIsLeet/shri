// Env-resolution for AI namespaces. Each namespace falls back to the shared
// OPENAI_API_KEY / OPENAI_BASE_URL when its own override isn't set.
// See docs/18-ai-client.md for the tiered-config rationale.

export type NamespaceConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
};

export type TtsConfig = NamespaceConfig & {
  voice: string;
};

export type AIConfig = {
  chat: NamespaceConfig;
  image: NamespaceConfig;
  tts: TtsConfig;
};

function need(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `@shri/ai: env var ${name} is required (see .env.example).`,
    );
  }
  return value;
}

export function loadAIConfig(): AIConfig {
  const baseApiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

  const chatKey = process.env.OPENAI_CHAT_API_KEY ?? baseApiKey;
  const imageKey = process.env.OPENAI_IMAGE_API_KEY ?? baseApiKey;
  const ttsKey = process.env.OPENAI_TTS_API_KEY ?? baseApiKey;

  return {
    chat: {
      apiKey: need("OPENAI_API_KEY (or OPENAI_CHAT_API_KEY)", chatKey),
      baseURL: process.env.OPENAI_CHAT_BASE_URL ?? baseUrl,
      model: need("OPENAI_CHAT_MODEL", process.env.OPENAI_CHAT_MODEL),
    },
    image: {
      apiKey: need("OPENAI_API_KEY (or OPENAI_IMAGE_API_KEY)", imageKey),
      baseURL: process.env.OPENAI_IMAGE_BASE_URL ?? baseUrl,
      model: need("OPENAI_IMAGE_MODEL", process.env.OPENAI_IMAGE_MODEL),
    },
    tts: {
      apiKey: need("OPENAI_API_KEY (or OPENAI_TTS_API_KEY)", ttsKey),
      baseURL: process.env.OPENAI_TTS_BASE_URL ?? baseUrl,
      model: need("OPENAI_TTS_MODEL", process.env.OPENAI_TTS_MODEL),
      voice: need("OPENAI_TTS_VOICE", process.env.OPENAI_TTS_VOICE),
    },
  };
}
