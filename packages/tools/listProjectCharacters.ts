// list_project_characters — DB read returning every Character for a project
// alongside a presigned read URL for its merged sheet (if present).
//
// Used by the brief LLM to decide which characters (if any) belong in a given
// content item. The presigned URL TTL defaults to 1 hour — long enough for an
// LLM run, short enough that we're not handing out long-lived public links.

import { z } from "zod";
import { prisma } from "@shri/db";
import { signedReadUrl } from "@shri/storage";
import type { ToolContext } from "./descriptors.js";

export type { ToolContext };

export const inputSchema = z.object({
  // No required input — the project is on ctx. We expose an optional override
  // for callers that want to inspect a different project (e.g. MCP test).
  projectId: z.string().optional(),
  // Whether to include characters whose sheets aren't ready yet (default true
  // so the LLM can see WIP characters and skip them if it wants).
  includeUnready: z.boolean().default(true),
  // Read-URL TTL in seconds. 1h default.
  signedUrlTtlSec: z.number().int().positive().default(3600),
});
export type ListProjectCharactersInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  characters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      species: z.string().nullable(),
      age: z.string().nullable(),
      gender: z.string().nullable(),
      visualStyle: z.string().nullable(),
      description: z.string(),
      status: z.enum(["DRAFTING", "GENERATING", "READY", "FAILED"]),
      sheetR2Key: z.string().nullable(),
      sheetUrl: z.string().nullable(),
      baseR2Key: z.string().nullable(),
      baseUrl: z.string().nullable(),
    }),
  ),
});
export type ListProjectCharactersOutput = z.infer<typeof outputSchema>;

export async function listProjectCharacters(
  rawInput: ListProjectCharactersInput,
  ctx: ToolContext,
): Promise<ListProjectCharactersOutput> {
  const input = inputSchema.parse(rawInput);
  const projectId = input.projectId ?? ctx.projectId;

  const rows = await prisma.character.findMany({
    where: input.includeUnready
      ? { projectId }
      : { projectId, status: "READY" },
    orderBy: { createdAt: "asc" },
  });

  const characters = await Promise.all(
    rows.map(async (r) => {
      const sheetUrl = r.sheetR2Key
        ? await signedReadUrl(r.sheetR2Key, input.signedUrlTtlSec)
        : null;
      const baseUrl = r.baseR2Key
        ? await signedReadUrl(r.baseR2Key, input.signedUrlTtlSec)
        : null;
      return {
        id: r.id,
        name: r.name,
        species: r.species,
        age: r.age,
        gender: r.gender,
        visualStyle: r.visualStyle,
        description: r.description,
        status: r.status,
        sheetR2Key: r.sheetR2Key,
        sheetUrl,
        baseR2Key: r.baseR2Key,
        baseUrl,
      };
    }),
  );

  return { characters };
}

// Convention alias — descriptors.ts wraps a tool by its `handler` export.
export const handler = listProjectCharacters;
