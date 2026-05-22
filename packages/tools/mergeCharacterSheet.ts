// merge_character_sheet — view PNGs → labeled JPEG sheet, uploaded to R2.
//
// Pipeline:
//   1. Download all view PNGs from R2.
//   2. Per view, resize to 1024×1024 and prepend a label tile (76px high) via
//      a Satori-rendered label strip → 1024×1100 tile.
//   3. Lay tiles out in a grid (default grid_3x2 = 3 cols, 2 rows).
//   4. Sharp encodes the canvas as JPEG quality 85; downscale longest side to
//      max 1500 if needed.
//   5. Upload to keys.characterSheet(slug, characterId) and update the
//      Character row with sheetR2Key + status="READY".

import { z } from "zod";
import satori from "satori";
// sharp and Resvg are imported lazily inside handler functions to avoid loading
// native binaries at module-init time (Next.js build loads this module during
// "Collecting page data" but never calls handlers).
import { getObject, keys, publicUrlFor, putObject } from "@shri/storage";
import { prisma } from "@shri/db";
import { type SatoriElement, loadFonts } from "./renderJsxCarousel.js";
import type { ToolContext } from "./descriptors.js";

export type { ToolContext };

function el(
  type: string,
  props: Record<string, unknown>,
  children?: SatoriElement[] | string,
): SatoriElement {
  return { type, props: { ...props, children } };
}

const ViewRef = z.object({
  pose: z.string().min(1),
  r2Key: z.string().min(1),
  order: z.number().int().nonnegative(),
});

export const inputSchema = z.object({
  characterId: z.string().min(1),
  // Optional — if omitted we load CharacterView rows from DB.
  views: z.array(ViewRef).optional(),
  layout: z.enum(["grid_3x2", "grid_2x3", "horizontal"]).default("grid_3x2"),
});
export type MergeCharacterSheetInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  sheetR2Key: z.string(),
  url: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type MergeCharacterSheetOutput = z.infer<typeof outputSchema>;

const TILE_IMAGE_SIZE = 1024;
const LABEL_STRIP_H = 76;
const TILE_H = TILE_IMAGE_SIZE + LABEL_STRIP_H; // 1100
const MAX_LONG_SIDE = 1500;

// Exported for unit testing.
export function gridDimensionsFor(
  layout: z.infer<typeof inputSchema>["layout"],
  count: number,
): { cols: number; rows: number } {
  if (layout === "grid_3x2") {
    return { cols: 3, rows: Math.max(1, Math.ceil(count / 3)) };
  }
  if (layout === "grid_2x3") {
    return { cols: 2, rows: Math.max(1, Math.ceil(count / 2)) };
  }
  // horizontal
  return { cols: count, rows: 1 };
}

async function renderLabelStrip(label: string, width: number): Promise<Buffer> {
  const fonts = await loadFonts();
  const root = el(
    "div",
    {
      style: {
        display: "flex",
        width,
        height: LABEL_STRIP_H,
        background: "#111111",
        color: "#ffffff",
        fontFamily: "Inter-Bold",
        fontSize: 32,
        fontWeight: 700,
        alignItems: "center",
        justifyContent: "center",
      },
    },
    label,
  );
  type SatoriArgs = Parameters<typeof satori>;
  const svg = await satori(root as unknown as SatoriArgs[0], {
    width,
    height: LABEL_STRIP_H,
    fonts,
  } as unknown as SatoriArgs[1]);
  const { Resvg } = await import("@resvg/resvg-js");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } })
    .render()
    .asPng();
  return Buffer.from(png);
}

async function buildTile(
  viewBuf: Buffer,
  label: string,
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  // Resize the view to TILE_IMAGE_SIZE square; flatten any alpha onto white
  // so the sheet has a consistent background under JPEG.
  const resized = await sharp(viewBuf)
    .resize(TILE_IMAGE_SIZE, TILE_IMAGE_SIZE, {
      fit: "cover",
      position: "centre",
    })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();

  const label_png = await renderLabelStrip(label, TILE_IMAGE_SIZE);

  // Vertical stack: image on top, label strip below.
  const tile = await sharp({
    create: {
      width: TILE_IMAGE_SIZE,
      height: TILE_H,
      channels: 3,
      background: "#000000",
    },
  })
    .composite([
      { input: resized, top: 0, left: 0 },
      { input: label_png, top: TILE_IMAGE_SIZE, left: 0 },
    ])
    .png()
    .toBuffer();

  return tile;
}

async function loadViewRows(
  characterId: string,
): Promise<Array<{ pose: string; r2Key: string; order: number }>> {
  const rows = await prisma.characterView.findMany({
    where: { characterId },
    orderBy: { order: "asc" },
  });
  return rows.map((r) => ({ pose: r.pose, r2Key: r.r2Key, order: r.order }));
}

export async function mergeCharacterSheet(
  rawInput: MergeCharacterSheetInput,
  ctx: ToolContext,
): Promise<MergeCharacterSheetOutput> {
  const input = inputSchema.parse(rawInput);

  const character = await prisma.character.findUnique({
    where: { id: input.characterId },
  });
  if (!character) {
    throw new Error(
      `merge_character_sheet: character ${input.characterId} not found`,
    );
  }
  if (character.projectId !== ctx.projectId) {
    throw new Error(
      `merge_character_sheet: character ${input.characterId} does not belong to project ${ctx.projectId}`,
    );
  }

  const viewRefs =
    input.views && input.views.length > 0
      ? [...input.views].sort((a, b) => a.order - b.order)
      : await loadViewRows(character.id);
  if (viewRefs.length === 0) {
    throw new Error(
      `merge_character_sheet: no views provided and no CharacterView rows for ${character.id}`,
    );
  }

  // Download all view buffers in parallel.
  const viewBufs = await Promise.all(viewRefs.map((v) => getObject(v.r2Key)));

  // Build labeled tiles in parallel.
  const tiles = await Promise.all(
    viewRefs.map((v, i) => buildTile(viewBufs[i]!, v.pose)),
  );

  const { cols, rows } = gridDimensionsFor(input.layout, viewRefs.length);
  const canvasW = cols * TILE_IMAGE_SIZE;
  const canvasH = rows * TILE_H;

  const composites = tiles.map((tile, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return {
      input: tile,
      top: r * TILE_H,
      left: c * TILE_IMAGE_SIZE,
    };
  });

  const sharp = (await import("sharp")).default;
  let sheet = sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 3,
      background: "#000000",
    },
  }).composite(composites);

  // Downscale longest side to MAX_LONG_SIDE.
  const longest = Math.max(canvasW, canvasH);
  let finalW = canvasW;
  let finalH = canvasH;
  if (longest > MAX_LONG_SIDE) {
    const scale = MAX_LONG_SIDE / longest;
    finalW = Math.round(canvasW * scale);
    finalH = Math.round(canvasH * scale);
    sheet = sheet.resize(finalW, finalH);
  }

  const jpeg = await sheet.jpeg({ quality: 85 }).toBuffer();

  const r2Key = keys.characterSheet(ctx.projectSlug, character.id);
  await putObject(r2Key, jpeg, "image/jpeg");

  await prisma.character.update({
    where: { id: character.id },
    data: { sheetR2Key: r2Key, status: "READY" },
  });

  const base = process.env.R2_PUBLIC_BASE_URL ?? "";
  return {
    sheetR2Key: r2Key,
    url: base ? publicUrlFor(base, r2Key) : r2Key,
    width: finalW,
    height: finalH,
  };
}

// Convention alias — descriptors.ts wraps a tool by its `handler` export.
export const handler = mergeCharacterSheet;
