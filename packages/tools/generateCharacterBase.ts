// generate_character_base — text → 1024×1024 base.png via aiClient.image.generate.
//
// Loads the Character row from DB, composes a structured visual prompt from
// (name, species, age, gender, visualStyle, description), generates a single
// canonical reference image, uploads to keys.characterBase(slug, charId), and
// persists baseR2Key on the Character row.
//
// See docs/14-characters.md.

import { z } from "zod";
import { aiClient } from "@shri/ai";
import { keys, publicUrlFor, putObject } from "@shri/storage";
import { prisma } from "@shri/db";
import type { ToolContext } from "./descriptors.js";

export type { ToolContext };

export const inputSchema = z.object({
  characterId: z.string().min(1),
});
export type GenerateCharacterBaseInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  r2Key: z.string(),
  url: z.string(),
  promptUsed: z.string(),
  costUsd: z.number().nonnegative(),
});
export type GenerateCharacterBaseOutput = z.infer<typeof outputSchema>;

// Exported for unit testing.
export function buildBasePrompt(c: {
  name: string;
  species: string | null;
  age: string | null;
  gender: string | null;
  visualStyle: string | null;
  description: string;
}): string {
  const lines: string[] = [];
  lines.push(
    `Single full-body reference image of "${c.name}", a ${c.species ?? "character"}.`,
  );
  const facets: string[] = [];
  if (c.age) facets.push(`age: ${c.age}`);
  if (c.gender) facets.push(`gender: ${c.gender}`);
  if (facets.length > 0) lines.push(facets.join(", "));
  if (c.visualStyle) lines.push(`Visual style: ${c.visualStyle}.`);
  lines.push(c.description);
  lines.push(
    "Neutral plain background, even soft lighting, character centered, " +
      "front-facing, full body visible from head to feet, no text, no logos. " +
      "This is a canonical reference image; subsequent renders will use it as a guide.",
  );
  return lines.join("\n");
}

export async function generateCharacterBase(
  rawInput: GenerateCharacterBaseInput,
  ctx: ToolContext,
): Promise<GenerateCharacterBaseOutput> {
  const input = inputSchema.parse(rawInput);
  const character = await prisma.character.findUnique({
    where: { id: input.characterId },
  });
  if (!character) {
    throw new Error(`generate_character_base: character ${input.characterId} not found`);
  }
  if (character.projectId !== ctx.projectId) {
    throw new Error(
      `generate_character_base: character ${input.characterId} does not belong to project ${ctx.projectId}`,
    );
  }

  const prompt = buildBasePrompt(character);
  const res = await aiClient.image.generate({
    prompt,
    size: "1024x1024",
    n: 1,
  });
  const png = res.buffers[0];
  if (!png) {
    throw new Error("generate_character_base: aiClient returned zero buffers");
  }

  const r2Key = keys.characterBase(ctx.projectSlug, character.id);
  await putObject(r2Key, png, "image/png");

  await prisma.character.update({
    where: { id: character.id },
    data: { baseR2Key: r2Key, status: "GENERATING" },
  });

  const base = process.env.R2_PUBLIC_BASE_URL ?? "";
  return {
    r2Key,
    url: base ? publicUrlFor(base, r2Key) : r2Key,
    promptUsed: prompt,
    costUsd: res.usage.costUsd,
  };
}

// Convention alias — descriptors.ts wraps a tool by its `handler` export.
export const handler = generateCharacterBase;
