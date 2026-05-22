import { z } from "zod";
import { prisma } from "@shri/db";
import type { ToolContext } from "./descriptors.js";

// save_content_output — DB writer. Final step of every content-generation
// pipeline; nothing is visible to the web UI until the row exists.

export const inputSchema = z.object({
  itemId: z.string().describe("ContentItem id this output belongs to"),
  r2Key: z.string().describe("R2 key of the final asset (built via @shri/storage.keys)"),
  thumbR2Key: z.string().optional().describe("Optional thumbnail R2 key"),
  caption: z.string().describe("Final caption text"),
  meta: z
    .record(z.unknown())
    .default({})
    .describe(
      "Free-form JSON metadata (durations, costs, scene info). Persisted on ContentOutput.meta.",
    ),
});

export const outputSchema = z.object({
  outputId: z.string(),
  itemId: z.string(),
  r2Key: z.string(),
  thumbR2Key: z.string().nullable(),
  caption: z.string(),
  createdAt: z.string(),
});

export type SaveContentOutputInput = z.infer<typeof inputSchema>;
export type SaveContentOutputOutput = z.infer<typeof outputSchema>;

export async function handler(
  input: SaveContentOutputInput,
  _ctx: ToolContext,
): Promise<SaveContentOutputOutput> {
  // Confirm the item exists — Prisma's FK would throw an opaque P2003 otherwise.
  const item = await prisma.contentItem.findUnique({
    where: { id: input.itemId },
    select: { id: true },
  });
  if (!item) {
    throw new Error(`save_content_output: ContentItem not found: "${input.itemId}"`);
  }

  const row = await prisma.contentOutput.create({
    data: {
      itemId: input.itemId,
      r2Key: input.r2Key,
      thumbR2Key: input.thumbR2Key ?? null,
      caption: input.caption,
      meta: input.meta as object,
    },
  });

  return {
    outputId: row.id,
    itemId: row.itemId,
    r2Key: row.r2Key,
    thumbR2Key: row.thumbR2Key,
    caption: row.caption,
    createdAt: row.createdAt.toISOString(),
  };
}
