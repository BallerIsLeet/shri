import type { ToolContext } from "@shri/tools";

// Helper to build a canonical ToolContext when calling executeTool from a
// tRPC procedure. CLAUDE.md convention: every tool call goes through
// executeTool(name, input, ctx) so input/output get Zod-validated.

export function makeWebToolContext(args: {
  projectId: string;
  projectSlug: string;
  itemId?: string;
  userId?: string;
}): ToolContext {
  return {
    projectId: args.projectId,
    projectSlug: args.projectSlug,
    itemId: args.itemId,
    userId: args.userId,
    // The tools layer only defines "worker" | "mcp" for source. Web is a third
    // consumer; we use "mcp" as the closest sibling so tools that branch on
    // source treat web like an external caller. If a tool ever needs a "web"
    // discriminator, extend ToolContext in @shri/tools first.
    source: "mcp",
  };
}
