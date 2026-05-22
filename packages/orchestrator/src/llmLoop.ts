// llmLoop.ts — the reusable LLM-with-tools loop.
//
// CONVENTIONS HONORED:
//   - All AI calls flow through aiClient.chat.completeWithTools (CLAUDE.md #1).
//     No raw openai import lives in this file (or anywhere in this package).
//   - Tool calls are dispatched via executeTool(name, input, ctx) — never the
//     raw handler. executeTool validates input AND output via Zod, and is the
//     canonical entrypoint for both worker and MCP. (CLAUDE.md #2 / #8.)
//   - Independent tool calls in one assistant turn run in parallel.
//   - The loop is pure of BullMQ concerns. The orchestrator (the caller) is
//     responsible for delayed re-enqueue when a tool returns a "pending
//     Seedance job" signal — the loop simply surfaces that signal back to the
//     caller via the optional `onToolResult` hook so the caller decides.
//
// Why no BullMQ wiring inline? The brief LLM loop has no async polling — every
// tool it calls is fully synchronous from its perspective (image gen, cost
// estimation, asset listing). The Seedance polling re-enqueue pattern only
// applies to `runItemJob`'s deterministic pipeline; that pipeline orchestrates
// BullMQ directly without an LLM loop in the happy path.
//
// See docs/02-orchestrator.md for the design.

import { aiClient } from "@shri/ai";
import type { ChatMessage } from "@shri/ai";
import {
  executeTool,
  toOpenAIFunctionTool,
  type ToolContext,
  type ToolDescriptor,
} from "@shri/tools";

/**
 * One log entry the loop appends to its in-memory journal. The caller can
 * forward these to Job.logs as it sees fit (see runBriefJob's logger).
 */
export type LoopLogEntry =
  | {
      at: string;
      event: "iteration_start";
      iteration: number;
    }
  | {
      at: string;
      event: "tool_start";
      iteration: number;
      name: string;
      toolCallId: string;
      args: unknown;
    }
  | {
      at: string;
      event: "tool_end";
      iteration: number;
      name: string;
      toolCallId: string;
      ms: number;
      ok: true;
      result: unknown;
    }
  | {
      at: string;
      event: "tool_error";
      iteration: number;
      name: string;
      toolCallId: string;
      ms: number;
      ok: false;
      error: string;
    }
  | {
      at: string;
      event: "iteration_end";
      iteration: number;
      stop: boolean;
      contentLength: number;
    };

export type LlmLoopOpts = {
  /** System prompt — fully composed by the caller. */
  systemPrompt: string;
  /** User prompt — same. */
  userPrompt: string;
  /** Tool registry the LLM may call. Typically `toolDescriptors` from @shri/tools. */
  tools: ToolDescriptor[];
  /** Passed through to every executeTool invocation. */
  toolContext: ToolContext;
  /** Hard cap on assistant turns. Default 12 per docs/02. */
  maxIterations?: number;
  /** Forced to "json" by default so the final message parses; pass "text" to opt out. */
  responseFormat?: "json" | "text";
  /** Temperature for the chat call. Default 0.2 for stable briefs. */
  temperature?: number;
  /** Optional per-iteration callback (e.g. forward to Job.logs). */
  onLog?: (entry: LoopLogEntry) => void;
  /**
   * Optional per-tool-result callback. The loop still feeds the result back to
   * the model as a tool message, but the caller can also inspect it (e.g.
   * runItemJob escape hatches that want to capture a Seedance taskId without
   * reading Job.logs).
   */
  onToolResult?: (info: {
    name: string;
    toolCallId: string;
    args: unknown;
    result: unknown;
    iteration: number;
  }) => void;
};

export type LlmLoopResult = {
  /** Final assistant message content (typically JSON when responseFormat=json). */
  finalMessage: string;
  /** How many assistant turns happened (1-indexed for the terminating turn). */
  iterations: number;
  /** Full message journal — useful for debugging + persisting to Job.logs. */
  messages: ChatMessage[];
  /** Step-by-step log entries (also delivered via onLog as they happen). */
  log: LoopLogEntry[];
};

const DEFAULT_MAX_ITERATIONS = 12;

/**
 * Run the LLM-with-tools loop.
 *
 * Termination rules:
 *   - Assistant turn returns NO tool calls → terminate; finalMessage = content.
 *   - maxIterations reached → throw with the message journal in the error.
 *
 * Tool execution:
 *   - All `tool_calls` from one assistant turn run via Promise.all.
 *   - Each call goes through `executeTool` so Zod validates input/output and
 *     the canonical ToolContext + audit trail are honored.
 *   - On handler error, the error MESSAGE is fed back to the model as a tool
 *     message so it can react (per docs/02 "Errors are caught and returned as
 *     { error: ... }").
 */
export async function llmLoop(opts: LlmLoopOpts): Promise<LlmLoopResult> {
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const responseFormat = opts.responseFormat ?? "json";
  const temperature = opts.temperature ?? 0.2;

  const openaiTools = opts.tools.map((d) => {
    const wrapped = toOpenAIFunctionTool(d);
    return {
      name: wrapped.function.name,
      description: wrapped.function.description,
      parameters: wrapped.function.parameters as Record<string, unknown>,
    };
  });

  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: opts.userPrompt },
  ];

  const log: LoopLogEntry[] = [];
  const pushLog = (e: LoopLogEntry): void => {
    log.push(e);
    opts.onLog?.(e);
  };

  for (let i = 1; i <= maxIterations; i++) {
    pushLog({ at: nowIso(), event: "iteration_start", iteration: i });

    const res = await aiClient.chat.completeWithTools({
      messages,
      tools: openaiTools,
      toolChoice: "auto",
      temperature,
      responseFormat,
    });

    const assistant = res.message;
    messages.push(assistant);

    const calls = assistant.toolCalls ?? [];
    if (calls.length === 0) {
      pushLog({
        at: nowIso(),
        event: "iteration_end",
        iteration: i,
        stop: true,
        contentLength: (assistant.content ?? "").length,
      });
      return {
        finalMessage: assistant.content ?? "",
        iterations: i,
        messages,
        log,
      };
    }

    // Parallel tool execution. Each tool call is independent (the LLM
    // serializes via subsequent turns when it needs the result of one to
    // shape the input of another).
    const settled = await Promise.all(
      calls.map(async (call) => {
        let parsedArgs: unknown;
        try {
          parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            id: call.id,
            name: call.name,
            args: call.arguments,
            ok: false as const,
            error: `tool args were not valid JSON: ${msg}`,
            ms: 0,
          };
        }

        pushLog({
          at: nowIso(),
          event: "tool_start",
          iteration: i,
          name: call.name,
          toolCallId: call.id,
          args: parsedArgs,
        });

        const start = Date.now();
        try {
          const result = await executeTool(call.name, parsedArgs, opts.toolContext);
          const ms = Date.now() - start;
          opts.onToolResult?.({
            name: call.name,
            toolCallId: call.id,
            args: parsedArgs,
            result,
            iteration: i,
          });
          pushLog({
            at: nowIso(),
            event: "tool_end",
            iteration: i,
            name: call.name,
            toolCallId: call.id,
            ms,
            ok: true,
            result,
          });
          return {
            id: call.id,
            name: call.name,
            args: parsedArgs,
            ok: true as const,
            result,
            ms,
          };
        } catch (e) {
          const ms = Date.now() - start;
          const msg = e instanceof Error ? e.message : String(e);
          pushLog({
            at: nowIso(),
            event: "tool_error",
            iteration: i,
            name: call.name,
            toolCallId: call.id,
            ms,
            ok: false,
            error: msg,
          });
          return {
            id: call.id,
            name: call.name,
            args: parsedArgs,
            ok: false as const,
            error: msg,
            ms,
          };
        }
      }),
    );

    for (const r of settled) {
      // Tool message content per OpenAI spec must be a string. Stringify the
      // result so the model can read it; errors are surfaced as { error: ... }
      // so the model can react instead of crashing the loop (docs/02).
      const content = r.ok
        ? safeJsonStringify(r.result)
        : safeJsonStringify({ error: r.error });
      messages.push({
        role: "tool",
        content,
        toolCallId: r.id,
        name: r.name,
      });
    }

    pushLog({
      at: nowIso(),
      event: "iteration_end",
      iteration: i,
      stop: false,
      contentLength: (assistant.content ?? "").length,
    });
  }

  // We exhausted maxIterations without the model emitting a tool-call-free
  // turn. Surface the full message journal in the error so the caller can
  // either bump the cap or fix the prompt.
  const err = new Error(
    `llmLoop: maxIterations (${maxIterations}) reached without a terminating assistant message`,
  ) as Error & { messages?: ChatMessage[]; log?: LoopLogEntry[] };
  err.messages = messages;
  err.log = log;
  throw err;
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return JSON.stringify({ error: "result was not JSON-serializable" });
  }
}
