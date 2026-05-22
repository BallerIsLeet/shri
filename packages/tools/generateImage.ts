// generateImage — Text → image via aiClient.image, uploaded to R2.
//
// Two modes:
//   1. No character refs: aiClient.image.generate (text-only).
//   2. With character refs: aiClient.image.edit, passing the character sheet(s)
//      as visual references. The character textual context is prepended to the
//      prompt.
//
// Theme context (from prompts-projects/{slug}/theme-story.md, if present) is
// always appended to the final prompt — the "Visual palette", "Setting", and
// "Recurring motifs" sections. Missing sections are silently omitted.
//
// See docs/05-images-carousels.md, docs/14-characters.md, docs/15-theme-story.md.

import { z } from "zod";
import { aiClient } from "@shri/ai";
import { getObject, keys, publicUrlFor, putObject } from "@shri/storage";
import { prisma } from "@shri/db";
import { readProjectPrompt } from "@shri/prompts-fs";
import type { ToolContext } from "./descriptors.js";

export type { ToolContext };

export const inputSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  // Optional — output R2 key. If omitted we derive one from itemId or a uuid.
  r2Key: z.string().optional(),
  // Used only to compose the default R2 key when r2Key is omitted.
  itemId: z.string().optional(),
  slideIndex: z.number().int().nonnegative().optional(),
  size: z
    .enum(["1024x1024", "1024x1792", "1792x1024"])
    .default("1024x1024"),
  // Optional character IDs — the sheets are loaded and passed as visual refs.
  characterIds: z.array(z.string()).default([]),
  // Allow the caller to opt out of theme prepend when they have a fully-formed
  // prompt (e.g. an embedded slide image where the LLM already encoded theme).
  includeTheme: z.boolean().default(true),
});

export type GenerateImageInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  r2Key: z.string(),
  url: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  promptUsed: z.string(),
  usedCharacterIds: z.array(z.string()),
  costUsd: z.number().nonnegative(),
});

export type GenerateImageOutput = z.infer<typeof outputSchema>;

// Exported for unit testing. Strict per docs/15: pull only the three sections
// the image-gen pipeline cares about.
export function extractThemeSections(themeMd: string): {
  setting?: string;
  palette?: string;
  motifs?: string;
} {
  return {
    setting: extractSection(themeMd, "Setting"),
    palette: extractSection(themeMd, "Visual palette"),
    motifs: extractSection(themeMd, "Recurring motifs"),
  };
}

function extractSection(md: string, heading: string): string | undefined {
  // Match "## Heading" through to the next "## " heading or EOF.
  // (?:^|\n) so ## doesn't match inside a code block on the same line.
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
    "i",
  );
  const m = md.match(re);
  if (!m || !m[1]) return undefined;
  const body = m[1].trim();
  return body.length > 0 ? body : undefined;
}

// Exported for unit testing.
export function composePromptParts(
  basePrompt: string,
  theme: { setting?: string; palette?: string; motifs?: string },
  characterContext: string | undefined,
): string {
  const parts: string[] = [];
  if (characterContext) parts.push(characterContext);
  parts.push(basePrompt.trim());
  const themeBlock: string[] = [];
  if (theme.setting) themeBlock.push(`Setting: ${theme.setting}`);
  if (theme.palette) themeBlock.push(`Palette: ${theme.palette}`);
  if (theme.motifs) themeBlock.push(`Motifs: ${theme.motifs}`);
  if (themeBlock.length > 0) parts.push(themeBlock.join("\n"));
  if (characterContext) {
    parts.push(
      "Keep characters visually consistent with the reference sheets provided.",
    );
  }
  return parts.join("\n\n");
}

async function loadThemeSections(
  slug: string,
  enabled: boolean,
): Promise<{ setting?: string; palette?: string; motifs?: string }> {
  if (!enabled) return {};
  try {
    const md = await readProjectPrompt(slug, "theme-story.md");
    return extractThemeSections(md);
  } catch {
    // Theme file missing is fine — projects don't have to declare one.
    return {};
  }
}

type CharacterRef = {
  id: string;
  name: string;
  description: string;
  species: string | null;
  age: string | null;
  sheetBuf: Buffer | null;
};

async function loadCharacterRefs(
  characterIds: string[],
  projectId: string,
): Promise<CharacterRef[]> {
  if (characterIds.length === 0) return [];
  const rows = await prisma.character.findMany({
    where: { id: { in: characterIds }, projectId },
    select: {
      id: true,
      name: true,
      description: true,
      species: true,
      age: true,
      sheetR2Key: true,
      baseR2Key: true,
    },
  });
  const refs: CharacterRef[] = [];
  for (const r of rows) {
    const sheetKey = r.sheetR2Key ?? r.baseR2Key;
    let sheetBuf: Buffer | null = null;
    if (sheetKey) {
      sheetBuf = await getObject(sheetKey);
    }
    refs.push({
      id: r.id,
      name: r.name,
      description: r.description,
      species: r.species,
      age: r.age,
      sheetBuf,
    });
  }
  return refs;
}

function characterContextFor(refs: CharacterRef[]): string | undefined {
  if (refs.length === 0) return undefined;
  return refs
    .map(
      (c) =>
        `Character "${c.name}" (${c.species ?? "unspecified"}, ${c.age ?? "?"}): ${c.description}`,
    )
    .join("\n\n");
}

function parseSize(size: string): { width: number; height: number } {
  const [wStr, hStr] = size.split("x");
  const w = Number(wStr);
  const h = Number(hStr);
  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error(`generate_image: invalid size "${size}"`);
  }
  return { width: w, height: h };
}

function deriveR2Key(
  ctx: ToolContext,
  input: GenerateImageInput,
): string {
  if (input.r2Key) return input.r2Key;
  if (input.itemId && typeof input.slideIndex === "number") {
    return keys.outputSlide(ctx.projectSlug, input.itemId, input.slideIndex);
  }
  if (input.itemId) {
    return keys.outputComposite(ctx.projectSlug, input.itemId);
  }
  // Last-resort fallback: a timestamped slide-style key under an "adhoc" item.
  // The orchestrator should always supply r2Key or itemId; this exists for the
  // MCP-driven ad-hoc case.
  const stamp = Date.now();
  return keys.outputSlide(ctx.projectSlug, `adhoc-${stamp}`, 0);
}

export async function generateImage(
  rawInput: GenerateImageInput,
  ctx: ToolContext,
): Promise<GenerateImageOutput> {
  const input = inputSchema.parse(rawInput);

  const theme = await loadThemeSections(ctx.projectSlug, input.includeTheme);
  const refs = await loadCharacterRefs(input.characterIds, ctx.projectId);
  if (input.characterIds.length > 0 && refs.length !== input.characterIds.length) {
    throw new Error(
      `generate_image: requested ${input.characterIds.length} characters but only ${refs.length} were found in project ${ctx.projectId}`,
    );
  }

  const characterContext = characterContextFor(refs);
  const finalPrompt = composePromptParts(input.prompt, theme, characterContext);

  // image.edit accepts a different size enum than generate; gate accordingly.
  const refsWithSheets = refs.filter((r): r is CharacterRef & { sheetBuf: Buffer } => r.sheetBuf !== null);
  const useEdit = refsWithSheets.length > 0;

  let buffers: Buffer[];
  let costUsd: number;
  if (useEdit) {
    const editSize = mapToEditSize(input.size);
    const res = await aiClient.image.edit({
      prompt: finalPrompt,
      references: refsWithSheets.map((r) => r.sheetBuf),
      size: editSize,
    });
    buffers = res.buffers;
    costUsd = res.usage.costUsd;
  } else {
    const res = await aiClient.image.generate({
      prompt: finalPrompt,
      size: input.size,
      n: 1,
    });
    buffers = res.buffers;
    costUsd = res.usage.costUsd;
  }

  const png = buffers[0];
  if (!png) {
    throw new Error("generate_image: aiClient returned zero image buffers");
  }

  const r2Key = deriveR2Key(ctx, input);
  await putObject(r2Key, png, "image/png");

  const { width, height } = parseSize(input.size);
  // publicUrlFor needs the base; reconstruct from env via storage.publicUrlFor.
  // We don't want to call signedReadUrl here — caller can request that
  // separately if the bucket isn't publicly addressable.
  const base = process.env.R2_PUBLIC_BASE_URL ?? "";
  const url = base ? publicUrlFor(base, r2Key) : r2Key;

  return {
    r2Key,
    url,
    width,
    height,
    promptUsed: finalPrompt,
    usedCharacterIds: refs.map((r) => r.id),
    costUsd,
  };
}

// Convention alias — descriptors.ts wraps a tool by its `handler` export.
export const handler = generateImage;

function mapToEditSize(
  size: "1024x1024" | "1024x1792" | "1792x1024",
): "1024x1024" | "1024x1536" | "1536x1024" {
  // image.edit doesn't accept the same wide/tall sizes as generate. Map to the
  // closest edit-supported aspect.
  if (size === "1024x1792") return "1024x1536";
  if (size === "1792x1024") return "1536x1024";
  return "1024x1024";
}
