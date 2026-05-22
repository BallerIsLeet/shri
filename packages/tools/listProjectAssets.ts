import { z } from "zod";
import { prisma } from "@shri/db";
import { signedReadUrl } from "@shri/storage";
import type { ToolContext } from "./descriptors.js";

// list_project_assets — DB read + presigned URLs. Used by the orchestrator and
// MCP server to let the LLM "see" what the user uploaded for this project.

export const inputSchema = z.object({
  projectSlug: z.string().describe("URL-safe project slug"),
  kind: z
    .enum(["ICON", "SCREENSHOT", "SCREEN_RECORDING", "LOGO", "REFERENCE"])
    .optional()
    .describe("Filter by asset kind"),
  signedUrlTtlSec: z
    .number()
    .int()
    .min(60)
    .max(86400)
    .default(3600)
    .describe("Presigned read URL TTL in seconds (default 1h)"),
});

export const outputSchema = z.object({
  assets: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["ICON", "SCREENSHOT", "SCREEN_RECORDING", "LOGO", "REFERENCE"]),
      r2Key: z.string(),
      url: z.string().describe("Presigned read URL"),
      mimeType: z.string(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      durationS: z.number().nullable(),
      caption: z.string().nullable(),
      createdAt: z.string().describe("ISO timestamp"),
    }),
  ),
});

export type ListProjectAssetsInput = z.infer<typeof inputSchema>;
export type ListProjectAssetsOutput = z.infer<typeof outputSchema>;

export async function handler(
  input: ListProjectAssetsInput,
  _ctx: ToolContext,
): Promise<ListProjectAssetsOutput> {
  const project = await prisma.project.findUnique({
    where: { slug: input.projectSlug },
    select: { id: true },
  });
  if (!project) {
    throw new Error(`list_project_assets: project not found for slug "${input.projectSlug}"`);
  }
  const rows = await prisma.asset.findMany({
    where: {
      projectId: project.id,
      ...(input.kind ? { kind: input.kind } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  const assets = await Promise.all(
    rows.map(async (a) => ({
      id: a.id,
      kind: a.kind,
      r2Key: a.r2Key,
      url: await signedReadUrl(a.r2Key, input.signedUrlTtlSec),
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
      durationS: a.durationS,
      caption: a.caption,
      createdAt: a.createdAt.toISOString(),
    })),
  );
  return { assets };
}
