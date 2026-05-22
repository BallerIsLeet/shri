// =============================================================================
// @shri/mcp — MCP stdio server.
//
// Exposes the SAME `toolDescriptors` from @shri/tools that the BullMQ worker
// uses (see docs/06-mcp-server.md). One descriptor = one MCP tool = one OpenAI
// function tool. Adding a tool is a single edit in packages/tools/index.ts.
//
// Wiring choices worth knowing:
//   1. SERVER_INSTRUCTIONS is passed to the Server constructor so Claude Code
//      receives it on `initialize`. The smoke test asserts this.
//   2. Tool input schemas come from `toMcpToolSchema(d)` — never hand-rolled.
//   3. Tool calls route through `executeTool(name, args, ctx)`. We do NOT call
//      handlers directly; executeTool re-validates input + output via Zod and
//      surfaces clear errors back to the model.
//   4. ToolContext (projectId + projectSlug) is built from the tool's input
//      args. The MCP path has no logged-in user; every tool input already
//      carries projectSlug. If a call is missing projectSlug, we return an
//      isError tool result with a clear message rather than throwing.
// =============================================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  executeTool,
  toMcpToolSchema,
  toolDescriptors,
  type ToolContext,
} from "@shri/tools";
import { SERVER_INSTRUCTIONS } from "./instructions.js";

// ---------------------------------------------------------------------------
// Build the Server. Capabilities advertise "tools" only — no prompts,
// resources, sampling, or roots (yet). The `instructions` field is the one
// non-obvious bit: clients surface it to the model on initialize.
// ---------------------------------------------------------------------------

export function createServer(): Server {
  const server = new Server(
    {
      name: "shri",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  // tools/list — iterate the canonical registry; do NOT hand-roll a list.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDescriptors.map((d) => toMcpToolSchema(d)),
  }));

  // tools/call — extract ctx from the input args, run executeTool, wrap the
  // result as MCP tool content. On validation/handler failure, return an
  // isError result rather than throwing — this gives the model a chance to
  // see the error message and self-correct.
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const rawArgs = (req.params.arguments ?? {}) as Record<string, unknown>;

    const projectSlug = typeof rawArgs.projectSlug === "string" ? rawArgs.projectSlug : undefined;
    if (!projectSlug) {
      return errorResult(
        `MCP tool calls require \`projectSlug\` in the arguments. ` +
          `Tool "${name}" was called without one. ` +
          `Add projectSlug to every call — it scopes the call to a project.`,
      );
    }

    // projectId is resolved by the tool handlers themselves from the slug
    // (most do a Prisma lookup). The orchestrator path passes a real id; the
    // MCP path leaves it empty here and lets each handler resolve it.
    const ctx: ToolContext = {
      projectId: typeof rawArgs.projectId === "string" ? rawArgs.projectId : "",
      projectSlug,
      itemId: typeof rawArgs.itemId === "string" ? rawArgs.itemId : undefined,
      source: "mcp",
    };

    try {
      const result = await executeTool(name, rawArgs, ctx);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(message);
    }
  });

  return server;
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Stdio bootstrap. Skipped when this module is imported (e.g. by the smoke
// test) — we only start the transport when run as a script.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The process stays alive on the stdio transport. Logging to stderr is
  // safe (stdout is reserved for JSON-RPC framing on stdio).
  process.stderr.write(
    `[@shri/mcp] connected via stdio with ${toolDescriptors.length} tools\n`,
  );
}

// Detect "run as a script" without depending on import.meta.main (not in
// every Node 20.x). The check below works under both `tsx src/index.ts` and
// `node dist/index.js`.
const invokedPath = process.argv[1] ?? "";
if (invokedPath.endsWith("index.ts") || invokedPath.endsWith("index.js")) {
  main().catch((err) => {
    process.stderr.write(`[@shri/mcp] fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
