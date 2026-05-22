// place_text_on_image — given a base image + headline text, find a low-detail
// region with opencv (saliency + canny edge density on an 8x8 grid), render
// the text via Satori at that region, composite onto the base with Sharp,
// upload to R2.
//
// Algorithm per docs/05-images-carousels.md:
//   1. Decode base image; compute saliency (StaticSaliencySpectralResidual).
//   2. Compute edge map via Canny.
//   3. Tile into 8x8 grid; per-cell score = mean_saliency + mean_edges.
//   4. Sort cells ascending; greedily find a contiguous rectangle whose pixel
//      bbox can hold the text bbox at the requested size.
//   5. Satori-render the headline at chosen position over a transparent
//      canvas; resvg→PNG → Sharp composite over base → R2.
//
// opencv4nodejs is a native module. We import it lazily so non-opencv code
// (and the pure-function unit tests) can run on machines without it.

import { z } from "zod";
import satori from "satori";
// sharp and Resvg are imported lazily inside handler functions to avoid loading
// native binaries at module-init time (Next.js build loads this module during
// "Collecting page data" but never calls handlers).
import { getObject, keys, putObject, publicUrlFor } from "@shri/storage";
import { type SatoriElement, type SatoriFont, loadFonts } from "./renderJsxCarousel.js";
import type { ToolContext } from "./descriptors.js";

export type { ToolContext };

function el(
  type: string,
  props: Record<string, unknown>,
  children?: SatoriElement[] | string,
): SatoriElement {
  return { type, props: { ...props, children } };
}

const FontName = z.enum(["Inter", "Inter-Bold", "DM-Serif", "JetBrains-Mono"]);

const TextStyle = z.object({
  font: FontName.default("Inter-Bold"),
  size: z.number().positive().default(72),
  color: z.string().default("#ffffff"),
  align: z.enum(["left", "center", "right"]).default("center"),
  lineHeight: z.number().positive().default(1.15),
  // Optional translucent backdrop band drawn behind text for legibility.
  backdrop: z
    .object({
      color: z.string().default("rgba(0,0,0,0.5)"),
      paddingX: z.number().nonnegative().default(24),
      paddingY: z.number().nonnegative().default(16),
      borderRadius: z.number().nonnegative().default(12),
    })
    .optional(),
});

export const inputSchema = z.object({
  itemId: z.string().min(1),
  baseR2Key: z.string().min(1),
  text: z.string().min(1),
  textStyle: TextStyle.default({
    font: "Inter-Bold",
    size: 72,
    color: "#ffffff",
    align: "center",
    lineHeight: 1.15,
  }),
  // Grid resolution. 8 is the default per docs; expose for tuning.
  gridSize: z.number().int().min(2).max(32).default(8),
});

export type PlaceTextOnImageInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  r2Key: z.string(),
  url: z.string(),
  region: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  }),
  scoreAtRegion: z.number().nonnegative(),
  fallback: z.boolean(),
});

export type PlaceTextOnImageOutput = z.infer<typeof outputSchema>;

// ─── Bounding-box estimation ──────────────────────────────────────────────

const FONT_ADVANCE_FACTOR: Record<z.infer<typeof FontName>, number> = {
  Inter: 0.5,
  "Inter-Bold": 0.55,
  "DM-Serif": 0.55,
  "JetBrains-Mono": 0.6,
};

// Exported for unit testing.
export function estimateTextBbox(
  text: string,
  font: z.infer<typeof FontName>,
  size: number,
  lineHeight: number,
  maxWidth: number,
): { w: number; h: number; lineCount: number } {
  const advance = FONT_ADVANCE_FACTOR[font] * size;
  if (advance <= 0) {
    throw new Error("estimateTextBbox: non-positive advance");
  }
  const charsPerLine = Math.max(1, Math.floor(maxWidth / advance));
  // Wrap by words, fall back to character-wrap for overlong tokens.
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (w.length > charsPerLine) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      for (let i = 0; i < w.length; i += charsPerLine) {
        lines.push(w.slice(i, i + charsPerLine));
      }
      continue;
    }
    const next = cur ? cur + " " + w : w;
    if (next.length <= charsPerLine) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  const lineCount = Math.max(1, lines.length);
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
  const w = Math.ceil(longest * advance);
  const h = Math.ceil(lineCount * size * lineHeight);
  return { w, h, lineCount };
}

// ─── Grid scoring (pure, exported for tests) ──────────────────────────────

export type Cell = { cx: number; cy: number; score: number };

export function findBestRegion(
  cells: Cell[][],
  gridSize: number,
  imageW: number,
  imageH: number,
  textW: number,
  textH: number,
): {
  region: { x: number; y: number; w: number; h: number };
  scoreAtRegion: number;
  fallback: boolean;
} {
  const cellW = imageW / gridSize;
  const cellH = imageH / gridSize;
  const cellsNeededX = Math.max(1, Math.ceil(textW / cellW));
  const cellsNeededY = Math.max(1, Math.ceil(textH / cellH));
  if (cellsNeededX > gridSize || cellsNeededY > gridSize) {
    // Text won't fit even in the entire image — return centered fallback.
    return {
      region: {
        x: Math.max(0, Math.floor((imageW - textW) / 2)),
        y: Math.max(0, Math.floor((imageH - textH) / 2)),
        w: Math.min(textW, imageW),
        h: Math.min(textH, imageH),
      },
      scoreAtRegion: Number.POSITIVE_INFINITY,
      fallback: true,
    };
  }

  // For every possible top-left position of the cellsNeededX × cellsNeededY
  // window, compute the average score. Pick min.
  let bestScore = Number.POSITIVE_INFINITY;
  let bestCx = 0;
  let bestCy = 0;
  for (let cy = 0; cy <= gridSize - cellsNeededY; cy++) {
    for (let cx = 0; cx <= gridSize - cellsNeededX; cx++) {
      let sum = 0;
      let count = 0;
      for (let dy = 0; dy < cellsNeededY; dy++) {
        for (let dx = 0; dx < cellsNeededX; dx++) {
          const row = cells[cy + dy];
          if (!row) continue;
          const c = row[cx + dx];
          if (!c) continue;
          sum += c.score;
          count++;
        }
      }
      if (count === 0) continue;
      const avg = sum / count;
      if (avg < bestScore) {
        bestScore = avg;
        bestCx = cx;
        bestCy = cy;
      }
    }
  }

  // Center the text inside the chosen window.
  const winX = bestCx * cellW;
  const winY = bestCy * cellH;
  const winW = cellsNeededX * cellW;
  const winH = cellsNeededY * cellH;
  const x = Math.round(winX + (winW - textW) / 2);
  const y = Math.round(winY + (winH - textH) / 2);
  const FALLBACK_THRESHOLD = 0.5; // mean of normalized saliency+edges
  return {
    region: {
      x: Math.max(0, x),
      y: Math.max(0, y),
      w: textW,
      h: textH,
    },
    scoreAtRegion: bestScore === Number.POSITIVE_INFINITY ? 1 : bestScore,
    fallback: bestScore > FALLBACK_THRESHOLD,
  };
}

// ─── opencv-driven scoring ────────────────────────────────────────────────

async function scoreCellsWithOpencv(
  baseBuf: Buffer,
  gridSize: number,
  imageW: number,
  imageH: number,
): Promise<Cell[][]> {
  // Lazy require — opencv4nodejs is native and may not be installed on every
  // dev machine. Construction is deferred until this code path runs.
  const cvMod = (await import("@u4/opencv4nodejs")) as unknown as {
    default?: OpenCvModule;
  } & OpenCvModule;
  const cv: OpenCvModule = cvMod.default ?? cvMod;

  const mat = cv.imdecode(baseBuf);
  const gray = mat.channels === 1 ? mat : mat.cvtColor(cv.COLOR_BGR2GRAY);

  // Saliency — fall back to a uniform map if saliency isn't built in.
  let saliencyMap: OpenCvMat;
  const SaliencyCtor = cv.StaticSaliencySpectralResidual;
  if (typeof SaliencyCtor === "function") {
    const saliency = new SaliencyCtor();
    const r = saliency.computeSaliency(mat);
    saliencyMap = isMat(r) ? r : r.saliencyMap;
    // Convert to 0..255 uint8 if needed.
    if (saliencyMap.type !== cv.CV_8U) {
      saliencyMap = saliencyMap.convertTo(cv.CV_8U, 255);
    }
  } else {
    // No saliency module — score on edges only by setting saliency to zero.
    saliencyMap = new cv.Mat(imageH, imageW, cv.CV_8U, 0);
  }

  // Edges via Canny on grayscale.
  const edges = gray.canny(80, 160);

  const cells: Cell[][] = [];
  const cellW = imageW / gridSize;
  const cellH = imageH / gridSize;
  for (let cy = 0; cy < gridSize; cy++) {
    const row: Cell[] = [];
    for (let cx = 0; cx < gridSize; cx++) {
      const x = Math.floor(cx * cellW);
      const y = Math.floor(cy * cellH);
      const w = Math.max(1, Math.floor((cx + 1) * cellW) - x);
      const h = Math.max(1, Math.floor((cy + 1) * cellH) - y);
      const sRoi = saliencyMap.getRegion(new cv.Rect(x, y, w, h));
      const eRoi = edges.getRegion(new cv.Rect(x, y, w, h));
      const sMean = meanScalar(sRoi);
      const eMean = meanScalar(eRoi);
      // Normalize to 0..1 and combine.
      const score = (sMean + eMean) / (255 * 2);
      row.push({ cx, cy, score });
    }
    cells.push(row);
  }
  return cells;
}

function meanScalar(mat: OpenCvMat): number {
  const m = mat.mean();
  // mean() returns Vec4 in opencv4nodejs; first channel is what we want for grayscale.
  if (typeof m === "number") return m;
  if (Array.isArray(m)) return Number(m[0] ?? 0);
  const obj = m as { w?: number; x?: number };
  return Number(obj.w ?? obj.x ?? 0);
}

function isMat(x: unknown): x is OpenCvMat {
  if (!x || typeof x !== "object") return false;
  const candidate = x as { rows?: unknown; cols?: unknown };
  return typeof candidate.rows === "number" && typeof candidate.cols === "number";
}

// Minimal structural typing of the opencv surface we touch — keeps us off
// `any` and out of the @u4/opencv4nodejs declaration tree (which is heavy).
type OpenCvMat = {
  rows: number;
  cols: number;
  channels: number;
  type: number;
  cvtColor: (code: number) => OpenCvMat;
  canny: (low: number, high: number) => OpenCvMat;
  getRegion: (rect: unknown) => OpenCvMat;
  convertTo: (type: number, alpha?: number, beta?: number) => OpenCvMat;
  mean: () => number | number[] | { w?: number; x?: number };
};

type SaliencyCtor = new () => {
  computeSaliency: (m: OpenCvMat) => OpenCvMat | { saliencyMap: OpenCvMat };
};

type OpenCvModule = {
  imdecode: (b: Buffer) => OpenCvMat;
  COLOR_BGR2GRAY: number;
  CV_8U: number;
  Mat: new (rows: number, cols: number, type: number, value?: number) => OpenCvMat;
  Rect: new (x: number, y: number, w: number, h: number) => unknown;
  StaticSaliencySpectralResidual?: SaliencyCtor;
};

// ─── Satori overlay rendering ─────────────────────────────────────────────

async function renderOverlayPng(
  region: { x: number; y: number; w: number; h: number },
  text: string,
  style: z.infer<typeof TextStyle>,
  imageW: number,
  imageH: number,
  fonts: SatoriFont[],
): Promise<Buffer> {
  const textStyle: Record<string, string | number> = {
    color: style.color,
    fontFamily: style.font,
    fontWeight: style.font === "Inter-Bold" ? 700 : 400,
    fontSize: style.size,
    lineHeight: style.lineHeight,
    textAlign: style.align,
    whiteSpace: "pre-wrap",
    display: "flex",
    width: region.w,
    height: region.h,
    justifyContent:
      style.align === "center"
        ? "center"
        : style.align === "right"
          ? "flex-end"
          : "flex-start",
    alignItems: "center",
  };

  const textEl = el("div", { style: textStyle }, text);

  let textWrapper: SatoriElement = textEl;
  if (style.backdrop) {
    const bdStyle: Record<string, string | number> = {
      display: "flex",
      background: style.backdrop.color,
      paddingLeft: style.backdrop.paddingX,
      paddingRight: style.backdrop.paddingX,
      paddingTop: style.backdrop.paddingY,
      paddingBottom: style.backdrop.paddingY,
      borderRadius: style.backdrop.borderRadius,
      width: region.w,
      height: region.h,
    };
    textWrapper = el("div", { style: bdStyle }, [textEl]);
  }

  const positioned = el(
    "div",
    {
      style: {
        position: "absolute",
        left: region.x,
        top: region.y,
        width: region.w,
        height: region.h,
        display: "flex",
      },
    },
    [textWrapper],
  );

  const root = el(
    "div",
    {
      style: {
        position: "relative",
        display: "flex",
        width: imageW,
        height: imageH,
      },
    },
    [positioned],
  );

  type SatoriArgs = Parameters<typeof satori>;
  const svg = await satori(root as unknown as SatoriArgs[0], {
    width: imageW,
    height: imageH,
    fonts,
  } as unknown as SatoriArgs[1]);
  const { Resvg } = await import("@resvg/resvg-js");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: imageW } })
    .render()
    .asPng();
  return Buffer.from(png);
}

// ─── Tool entry ───────────────────────────────────────────────────────────

export async function placeTextOnImage(
  rawInput: PlaceTextOnImageInput,
  ctx: ToolContext,
): Promise<PlaceTextOnImageOutput> {
  const input = inputSchema.parse(rawInput);

  const baseBuf = await getObject(input.baseR2Key);
  const sharp = (await import("sharp")).default;
  const meta = await sharp(baseBuf).metadata();
  const imageW = meta.width ?? 0;
  const imageH = meta.height ?? 0;
  if (imageW === 0 || imageH === 0) {
    throw new Error(
      `place_text_on_image: could not read dimensions from ${input.baseR2Key}`,
    );
  }

  const { w: textW, h: textH } = estimateTextBbox(
    input.text,
    input.textStyle.font,
    input.textStyle.size,
    input.textStyle.lineHeight,
    Math.floor(imageW * 0.8), // wrap inside 80% of image width
  );

  const cells = await scoreCellsWithOpencv(
    baseBuf,
    input.gridSize,
    imageW,
    imageH,
  );

  const { region, scoreAtRegion, fallback } = findBestRegion(
    cells,
    input.gridSize,
    imageW,
    imageH,
    textW,
    textH,
  );

  const fonts = await loadFonts();
  const overlay = await renderOverlayPng(
    region,
    input.text,
    input.textStyle,
    imageW,
    imageH,
    fonts,
  );

  // Composite overlay over the base image.
  const composite = await sharp(baseBuf)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  const r2Key = keys.outputComposite(ctx.projectSlug, input.itemId);
  await putObject(r2Key, composite, "image/png");
  const base = process.env.R2_PUBLIC_BASE_URL ?? "";
  const url = base ? publicUrlFor(base, r2Key) : r2Key;

  return {
    r2Key,
    url,
    region,
    scoreAtRegion,
    fallback,
  };
}

// Convention alias — descriptors.ts wraps a tool by its `handler` export.
export const handler = placeTextOnImage;
