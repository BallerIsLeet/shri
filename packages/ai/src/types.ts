// Typed surface every consumer reads — see docs/18-ai-client.md.
// Adding a new namespace = add its config + types here, wire it in client.ts.

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  // For tool-use turns we accept the OpenAI-shaped tool_calls/tool_call_id.
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  toolCallId?: string;
  name?: string;
};

export type ChatCompleteOpts = {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "json" | "text";
};

export type ChatResponse = {
  message: ChatMessage;
  usage: TokenUsage;
};

export type ToolSchema = {
  // Wrapper-agnostic; the chat namespace adapts these into the OpenAI shape.
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolCompleteOpts = ChatCompleteOpts & {
  tools: ToolSchema[];
  toolChoice?: "auto" | "none" | { name: string };
};

export type ToolResponse = ChatResponse;

export type ImageSize = "1024x1024" | "1024x1792" | "1792x1024";

// The OpenAI SDK's `images.edit` accepts a narrower set of sizes than
// `images.generate`. Splitting the union keeps the type-check honest at the
// call site while still letting `generate` use the full set.
export type ImageEditSize =
  | "auto"
  | "1024x1024"
  | "1536x1024"
  | "1024x1536";

export type ImageGenerateOpts = {
  prompt: string;
  size?: ImageSize;
  n?: number;
};

export type ImageEditOpts = {
  prompt: string;
  references: Buffer[];
  size?: ImageEditSize;
};

export type ImageResult = {
  buffers: Buffer[];
  usage: CostUsage;
};

export type TtsOpts = {
  text: string;
  voice?: string;
  format?: "mp3" | "wav";
};

export type AudioResult = {
  buffer: Buffer;
  durationS: number;
  usage: CostUsage;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

export type CostUsage = {
  costUsd: number;
};
