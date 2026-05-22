# 18 — The AI Client

**Purpose:** Document the single object every part of the studio goes through when calling an AI provider. Every chat completion, image generation, TTS call, and future capability (vision, embedding, transcription) lives behind one typed interface so providers can be swapped per-method without touching call sites.

---

## Why an object, not direct `openai.*` calls

Right now you want one OpenAI-compatible gateway for everything (chat, image, TTS). Soon you might want:

- Chat planning via Claude through OpenRouter, but image gen via OpenAI directly.
- A separate fast model for caption polishing vs. the heavy model for brief generation.
- Vision (image-input chat) for analyzing user-uploaded screenshots.
- Embeddings for asset semantic search.
- Audio transcription of uploaded screen recordings to feed into the brief.

If every call site uses `openai.chat.completions.create(...)` directly, swapping any one of these means hunting through `packages/tools/`, `packages/orchestrator/`, and `apps/web/` to find raw calls. A single `aiClient` object with typed methods means the swap happens in one place, and every caller benefits.

The pattern is "service locator with typed surface" — boring, well-understood, the right move here.

---

## The package

```
packages/ai/
├── index.ts              ← exports `aiClient` (singleton) + factory + types
├── client.ts             ← AIClient class with method namespaces
├── config.ts             ← env-driven, per-method overrides
├── chat.ts               ← chat namespace (complete, completeWithTools, stream)
├── image.ts              ← image namespace (generate, edit)
├── tts.ts                ← tts namespace (speak)
├── vision.ts             ← (future) vision namespace (analyze)
├── embeddings.ts         ← (future) embeddings namespace (create)
├── types.ts              ← typed inputs/outputs per method
└── client.test.ts        ← real-API tests, skipped without keys
```

A single instance is built once at process start (web, worker, mcp) and exported:

```ts
// packages/ai/index.ts
import { AIClient } from "./client";
import { loadAIConfig } from "./config";

export const aiClient = new AIClient(loadAIConfig());
export type { AIClient } from "./client";
export * from "./types";
```

Call sites:

```ts
// before
const res = await openai.chat.completions.create({ model: ..., messages, tools });

// after
const res = await aiClient.chat.completeWithTools({ messages, tools });
```

The `model`, `baseURL`, `apiKey` aren't part of the call shape — they live in config.

---

## The shape

```ts
// packages/ai/client.ts (shape, not literal)
export class AIClient {
  chat: ChatNamespace;
  image: ImageNamespace;
  tts: TtsNamespace;
  // vision, embeddings, etc. added later as new namespaces

  constructor(cfg: AIConfig) {
    this.chat  = new ChatNamespace(cfg.chat);
    this.image = new ImageNamespace(cfg.image);
    this.tts   = new TtsNamespace(cfg.tts);
  }
}

// chat namespace
class ChatNamespace {
  constructor(private cfg: ChatConfig) {}

  complete(opts: ChatCompleteOpts): Promise<ChatResponse> { ... }
  completeWithTools(opts: ToolCompleteOpts): Promise<ToolResponse> { ... }
  stream(opts: ChatStreamOpts): AsyncIterable<ChatChunk> { ... }
}

// image namespace
class ImageNamespace {
  constructor(private cfg: ImageConfig) {}

  generate(opts: ImageGenerateOpts): Promise<ImageResult> { ... }
  edit(opts: ImageEditOpts): Promise<ImageResult> { ... }   // for character views, character-referenced gen
}

// tts namespace
class TtsNamespace {
  constructor(private cfg: TtsConfig) {}

  speak(opts: TtsOpts): Promise<AudioResult> { ... }
}
```

Each namespace owns its own SDK instance (or its own `fetch` wrapper), built from `cfg` at construction. Namespaces never share an SDK — that's how you get per-method provider override for free.

---

## Per-method config

`packages/ai/config.ts` reads env in a tiered way:

```ts
function loadAIConfig(): AIConfig {
  const base = {
    apiKey:  env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL,
  };

  return {
    chat: {
      apiKey:  env.OPENAI_CHAT_API_KEY  ?? base.apiKey,
      baseURL: env.OPENAI_CHAT_BASE_URL ?? base.baseURL,
      model:   env.OPENAI_CHAT_MODEL,
    },
    image: {
      apiKey:  env.OPENAI_IMAGE_API_KEY  ?? base.apiKey,
      baseURL: env.OPENAI_IMAGE_BASE_URL ?? base.baseURL,
      model:   env.OPENAI_IMAGE_MODEL,
    },
    tts: {
      apiKey:  env.OPENAI_TTS_API_KEY  ?? base.apiKey,
      baseURL: env.OPENAI_TTS_BASE_URL ?? base.baseURL,
      model:   env.OPENAI_TTS_MODEL,
      voice:   env.OPENAI_TTS_VOICE,
    },
  };
}
```

`.env` defaults are shared; per-method overrides are optional:

```dotenv
# --- shared defaults ---
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1

# --- per-method models (always set) ---
OPENAI_CHAT_MODEL=gpt-4o
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy

# --- per-method API/base URL overrides (optional, only when splitting providers) ---
# OPENAI_CHAT_API_KEY=sk-or-...
# OPENAI_CHAT_BASE_URL=https://openrouter.ai/api/v1
# OPENAI_IMAGE_API_KEY=...
# OPENAI_IMAGE_BASE_URL=...
```

Adding a new override is a four-step edit:
1. Add the env var to `.env.example`
2. Read it in `config.ts` with a fallback to the shared base
3. The namespace already consumes it — no code change in the namespace
4. Document it in `.env.example` comment

---

## Typed inputs / outputs

`packages/ai/types.ts` holds every input/output shape so call sites get autocomplete and IDE errors before runtime:

```ts
// chat
export type ChatCompleteOpts = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json" | "text";
};

export type ToolCompleteOpts = ChatCompleteOpts & {
  tools: ToolSchema[];                  // openai-style function schemas
  toolChoice?: "auto" | "none" | { name: string };
};

export type ToolResponse = {
  message: ChatMessage;                 // may have content or tool_calls
  usage: { promptTokens: number; completionTokens: number; costUsd: number };
};

// image
export type ImageGenerateOpts = {
  prompt: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024";
  n?: number;
};

export type ImageEditOpts = {
  prompt: string;
  references: Buffer[];                 // up to N reference images (character sheets, base.png)
  size?: "1024x1024" | "1024x1792" | "1792x1024";
};

export type ImageResult = {
  buffers: Buffer[];                    // PNG bytes per image
  usage: { costUsd: number };
};

// tts
export type TtsOpts = {
  text: string;
  voice?: string;                       // overrides config default
  format?: "mp3" | "wav";
};

export type AudioResult = {
  buffer: Buffer;
  durationS: number;                    // estimated from text length, refined post-encode
  usage: { costUsd: number };
};
```

Every call returns a `usage` object so [10-cost-and-pricing.md](10-cost-and-pricing.md) can compute actual cost from real numbers, not estimates.

---

## How call sites change

### Orchestrator (`packages/orchestrator/llmLoop.ts`)

```ts
// before
const res = await openai.chat.completions.create({
  model: env.OPENAI_CHAT_MODEL,
  messages,
  tools: tools.map(t => t.openaiSchema),
  tool_choice: "auto",
});

// after
const res = await aiClient.chat.completeWithTools({
  messages,
  tools: tools.map(t => t.openaiSchema),
  toolChoice: "auto",
});
```

### Image gen tool (`packages/tools/generateImage.ts`)

```ts
// before
const res = await openai.images.generate({
  model: env.OPENAI_IMAGE_MODEL,
  prompt,
  size,
});
const png = Buffer.from(res.data[0].b64_json!, "base64");

// after
const { buffers, usage } = await aiClient.image.generate({ prompt, size });
const png = buffers[0];
```

### Character views (`packages/tools/generateCharacterViews.ts`)

```ts
// before
const res = await openai.images.edit({
  model: env.OPENAI_IMAGE_MODEL,
  image: await fetchAsFile(baseR2Key),
  prompt: viewPrompt,
});

// after
const baseBuf = await storage.getObject(baseR2Key);
const { buffers } = await aiClient.image.edit({
  prompt: viewPrompt,
  references: [baseBuf],
});
```

### TTS (`packages/tools/generateTts.ts`)

```ts
// before
const res = await openai.audio.speech.create({
  model: env.OPENAI_TTS_MODEL,
  voice: env.OPENAI_TTS_VOICE,
  input: text,
});

// after
const { buffer } = await aiClient.tts.speak({ text });
```

Every tool drops the per-provider plumbing and reads from one object. When you swap providers, the tools don't notice.

---

## Extension story

### Add a new namespace (e.g. vision for analyzing screenshots)

```ts
// packages/ai/vision.ts
class VisionNamespace {
  constructor(private cfg: VisionConfig) {}

  async analyze(opts: VisionAnalyzeOpts): Promise<VisionResult> {
    // calls aiClient's underlying SDK with the image + prompt
  }
}

// packages/ai/client.ts
export class AIClient {
  chat:   ChatNamespace;
  image:  ImageNamespace;
  tts:    TtsNamespace;
  vision: VisionNamespace;        // new

  constructor(cfg: AIConfig) {
    // ...
    this.vision = new VisionNamespace(cfg.vision);
  }
}

// packages/ai/config.ts
export function loadAIConfig(): AIConfig {
  // ...
  return {
    chat: { ... },
    image: { ... },
    tts: { ... },
    vision: {                     // new
      apiKey:  env.OPENAI_VISION_API_KEY  ?? base.apiKey,
      baseURL: env.OPENAI_VISION_BASE_URL ?? base.baseURL,
      model:   env.OPENAI_VISION_MODEL ?? env.OPENAI_CHAT_MODEL,   // sensible default
    },
  };
}
```

Then any tool can call `aiClient.vision.analyze({...})` immediately. No changes anywhere else.

### Split a method to a different provider

Just set env vars — no code change.

```dotenv
OPENAI_CHAT_API_KEY=sk-or-v1-...
OPENAI_CHAT_BASE_URL=https://openrouter.ai/api/v1
OPENAI_CHAT_MODEL=anthropic/claude-opus-4
```

Chat now flows through OpenRouter to Claude. Image gen still hits OpenAI directly. TTS still hits OpenAI directly. None of the tool code is aware.

### Add per-task model routing (later)

If you ever want "use a small model for caption polishing, big model for brief generation," add a second method on the chat namespace:

```ts
class ChatNamespace {
  // existing
  completeWithTools(opts: ToolCompleteOpts): Promise<ToolResponse> { ... }

  // new — opinionated tier
  completeFast(opts: ChatCompleteOpts): Promise<ChatResponse> {
    return this.complete({ ...opts, _modelOverride: this.cfg.fastModel });
  }
}
```

Add `OPENAI_CHAT_FAST_MODEL` to config. Caption tools call `aiClient.chat.completeFast(...)`; brief jobs keep calling `completeWithTools(...)`. Two model tiers, one API.

---

## What this is not

- **Not a multi-provider router.** No retry-across-providers, no fallback if one provider 5xxs. If you want that, build it inside a namespace — but keep the call-site surface stable.
- **Not a prompt manager.** Prompts come from `prompts-projects/{slug}/*.md` (see [07-prompts.md](07-prompts.md)). The client receives fully-formed messages.
- **Not a rate limiter.** BullMQ already controls concurrency at the job level. Per-second throttling against a provider is the responsibility of the namespace's HTTP layer if it matters.
- **Not a cache.** Identical prompts may legitimately produce different outputs (image gen, video). Memoization belongs at the tool layer where idempotency keys live.

---

## See also
- [03-tools.md](03-tools.md) — every tool that talks to AI goes through `aiClient`
- [02-orchestrator.md](02-orchestrator.md) — `llmLoop.ts` calls `aiClient.chat.completeWithTools`
- [12-extending.md](12-extending.md) — swapping providers + adding new AI namespaces
- [11-deployment.md](11-deployment.md) — env vars for per-method overrides
