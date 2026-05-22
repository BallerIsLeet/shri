// generate_character_views — base.png + poses[] → N PNGs uploaded in parallel.
//
// Per docs/14-characters.md: for each pose, calls aiClient.image.edit with the
// base.png as the reference and a prompt asking for the same character in the
// requested pose. Uploads to keys.characterView(slug, charId, pose). Persists
// a CharacterView row per pose.
//
// The default poses match the 3×2 character sheet layout documented in 14.

import { z } from "zod";
import { aiClient } from "@shri/ai";
import { getObject, keys, publicUrlFor, putObject } from "@shri/storage";
import { prisma } from "@shri/db";
import type { ToolContext } from "./descriptors.js";

export type { ToolContext };

export const DEFAULT_POSES = [
  "front",
  "three-quarter",
  "side",
  "back",
  "smile",
  "neutral",
] as const;

export const inputSchema = z.object({
  characterId: z.string().min(1),
  // Optional explicit baseR2Key; if absent we read it from the Character row.
  baseR2Key: z.string().optional(),
  // Free-form pose names. Default is the canonical six.
  poses: z.array(z.string().min(1)).min(1).default([...DEFAULT_POSES]),
});
export type GenerateCharacterViewsInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  views: z.array(
    z.object({
      pose: z.string(),
      r2Key: z.string(),
      url: z.string(),
      order: z.number().int().nonnegative(),
    }),
  ),
  totalCostUsd: z.number().nonnegative(),
});
export type GenerateCharacterViewsOutput = z.infer<typeof outputSchema>;

// Exported for unit tests — pure prompt composition.
export function buildViewPrompt(pose: string, characterName: string): string {
  return (
    `Same character as the reference image (${characterName}). ` +
    `Show them in a ${pose} pose. ` +
    `Keep identical face, outfit, proportions, color palette, art style, and lighting as the reference. ` +
    `Neutral plain background. Full body framing where possible. No text or logos.`
  );
}

function slugifyPose(pose: string): string {
  return pose
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "view";
}

async function generateOneView(
  pose: string,
  order: number,
  characterId: string,
  characterName: string,
  projectSlug: string,
  baseBuf: Buffer,
): Promise<{
  pose: string;
  r2Key: string;
  url: string;
  order: number;
  costUsd: number;
}> {
  const prompt = buildViewPrompt(pose, characterName);
  const res = await aiClient.image.edit({
    prompt,
    references: [baseBuf],
    size: "1024x1024",
  });
  const png = res.buffers[0];
  if (!png) {
    throw new Error(
      `generate_character_views: aiClient returned zero buffers for pose "${pose}"`,
    );
  }
  const r2Key = keys.characterView(projectSlug, characterId, slugifyPose(pose));
  await putObject(r2Key, png, "image/png");
  // Upsert the CharacterView row. Same (characterId, pose) on subsequent runs
  // updates the existing row rather than duplicating.
  const existing = await prisma.characterView.findFirst({
    where: { characterId, pose },
  });
  if (existing) {
    await prisma.characterView.update({
      where: { id: existing.id },
      data: { r2Key, order },
    });
  } else {
    await prisma.characterView.create({
      data: { characterId, pose, r2Key, order },
    });
  }
  const base = process.env.R2_PUBLIC_BASE_URL ?? "";
  return {
    pose,
    r2Key,
    url: base ? publicUrlFor(base, r2Key) : r2Key,
    order,
    costUsd: res.usage.costUsd,
  };
}

export async function generateCharacterViews(
  rawInput: GenerateCharacterViewsInput,
  ctx: ToolContext,
): Promise<GenerateCharacterViewsOutput> {
  const input = inputSchema.parse(rawInput);
  const character = await prisma.character.findUnique({
    where: { id: input.characterId },
  });
  if (!character) {
    throw new Error(
      `generate_character_views: character ${input.characterId} not found`,
    );
  }
  if (character.projectId !== ctx.projectId) {
    throw new Error(
      `generate_character_views: character ${input.characterId} does not belong to project ${ctx.projectId}`,
    );
  }
  const baseR2Key = input.baseR2Key ?? character.baseR2Key;
  if (!baseR2Key) {
    throw new Error(
      `generate_character_views: character ${input.characterId} has no baseR2Key — run generate_character_base first`,
    );
  }
  const baseBuf = await getObject(baseR2Key);

  // Fan out in parallel. Each pose is one image.edit call.
  const settled = await Promise.allSettled(
    input.poses.map((pose, i) =>
      generateOneView(
        pose,
        i,
        character.id,
        character.name,
        ctx.projectSlug,
        baseBuf,
      ),
    ),
  );

  const views: GenerateCharacterViewsOutput["views"] = [];
  const errors: string[] = [];
  let totalCostUsd = 0;
  for (const r of settled) {
    if (r.status === "fulfilled") {
      views.push({
        pose: r.value.pose,
        r2Key: r.value.r2Key,
        url: r.value.url,
        order: r.value.order,
      });
      totalCostUsd += r.value.costUsd;
    } else {
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
  }
  if (errors.length > 0 && views.length === 0) {
    throw new Error(
      `generate_character_views: all poses failed:\n${errors.join("\n")}`,
    );
  }
  // If only some poses failed, surface the partial set + the errors.
  if (errors.length > 0) {
    throw new Error(
      `generate_character_views: ${errors.length}/${input.poses.length} poses failed:\n${errors.join(
        "\n",
      )}\n(${views.length} succeeded; rerun the failed poses)`,
    );
  }

  return { views, totalCostUsd };
}

// Convention alias — descriptors.ts wraps a tool by its `handler` export.
export const handler = generateCharacterViews;
