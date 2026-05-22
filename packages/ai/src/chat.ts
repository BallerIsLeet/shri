import OpenAI from "openai";
import type { NamespaceConfig } from "./config.js";
import type {
  ChatCompleteOpts,
  ChatMessage,
  ChatResponse,
  ToolCompleteOpts,
  ToolResponse,
} from "./types.js";

export class ChatNamespace {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(cfg: NamespaceConfig) {
    this.client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL });
    this.model = cfg.model;
  }

  async complete(opts: ChatCompleteOpts): Promise<ChatResponse> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages(opts.messages),
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      response_format:
        opts.responseFormat === "json" ? { type: "json_object" } : undefined,
    });

    const choice = res.choices[0];
    if (!choice) {
      throw new Error("@shri/ai chat.complete: no choices in response");
    }
    const message: ChatMessage = {
      role: "assistant",
      content: choice.message.content ?? "",
    };
    return {
      message,
      usage: {
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
        costUsd: 0,
      },
    };
  }

  // Phase C will deepen this — for now we return the assistant message plus any
  // tool_calls so the orchestrator's loop can read both.
  async completeWithTools(opts: ToolCompleteOpts): Promise<ToolResponse> {
    const tools = opts.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const toolChoice =
      opts.toolChoice === "auto" || opts.toolChoice === undefined
        ? "auto"
        : opts.toolChoice === "none"
          ? "none"
          : { type: "function" as const, function: { name: opts.toolChoice.name } };

    const res = await this.client.chat.completions.create({
      model: this.model,
      messages: toOpenAIMessages(opts.messages),
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      response_format:
        opts.responseFormat === "json" ? { type: "json_object" } : undefined,
      tools,
      tool_choice: toolChoice,
    });

    const choice = res.choices[0];
    if (!choice) {
      throw new Error("@shri/ai chat.completeWithTools: no choices in response");
    }
    const raw = choice.message;
    const message: ChatMessage = {
      role: "assistant",
      content: raw.content ?? "",
      toolCalls: raw.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
    };
    return {
      message,
      usage: {
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
        costUsd: 0,
      },
    };
  }
}

function toOpenAIMessages(
  messages: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
    if (m.role === "tool") {
      if (!m.toolCallId) {
        throw new Error("@shri/ai chat: tool message requires toolCallId");
      }
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    if (m.role === "system") return { role: "system", content: m.content };
    if (m.role === "user") return { role: "user", content: m.content };
    return { role: "assistant", content: m.content };
  });
}
