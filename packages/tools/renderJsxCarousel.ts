// render_jsx_carousel — constrained JSON slide spec → N PNGs uploaded to R2.
//
// Pipeline (per slide):
//   1. Validate against CarouselSpec (Zod).
//   2. Build a React element tree from the layers (text / image / rect).
//      Backgrounds: color / linear-gradient / R2 image.
//   3. satori(tree, { width, height, fonts }) → SVG string.
//   4. new Resvg(svg).render().asPng() → PNG Buffer.
//   5. storage.putObject(keys.outputSlide(slug, itemId, i), png).
//
// Fonts: four TTFs read from packages/tools/fonts/ once and cached.
// See docs/05-images-carousels.md.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
// Resvg is imported lazily inside renderSlideToPng to avoid loading the
// native binary at module-init time (the Next.js build loads this module
// during "Collecting page data" but never calls handlers).

// Satori 0.10's Font shape (the `fonts` array element).
export type SatoriFont = {
  name: string;
  data: Buffer;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style?: "normal" | "italic";
};
import { z } from "zod";
import { getObject, keys, putObject, publicUrlFor } from "@shri/storage";
import type { ToolContext } from "./descriptors.js";

export type { ToolContext };

// Satori walks an element tree (it doesn't call React's renderer). We build
// plain {type, props} nodes — zero React runtime dependency.
export type SatoriElement = {
  type: string;
  props: Record<string, unknown> & { children?: SatoriElement[] | string };
  key?: string | number;
};

function el(
  type: string,
  props: Record<string, unknown>,
  children?: SatoriElement[] | string,
): SatoriElement {
  return { type, props: { ...props, children } };
}

// ─── Slide spec schema ─────────────────────────────────────────────────────

const FontName = z.enum(["Inter", "Inter-Bold", "DM-Serif", "JetBrains-Mono"]);
export type FontName = z.infer<typeof FontName>;

const TextLayer = z.object({
  kind: z.literal("text"),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  text: z.string(),
  font: FontName,
  size: z.number().positive(),
  color: z.string(),
  align: z.enum(["left", "center", "right"]).default("left"),
  lineHeight: z.number().positive().default(1.1),
});

const ImageLayer = z.object({
  kind: z.literal("image"),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  r2Key: z.string().min(1),
  borderRadius: z.number().nonnegative().optional(),
});

const RectLayer = z.object({
  kind: z.literal("rect"),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  fill: z.string(),
  borderRadius: z.number().nonnegative().optional(),
});

const Layer = z.discriminatedUnion("kind", [TextLayer, ImageLayer, RectLayer]);

const Background = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("color"), value: z.string() }),
  z.object({
    kind: z.literal("gradient"),
    from: z.string(),
    to: z.string(),
    angle: z.number().default(180),
  }),
  z.object({ kind: z.literal("image"), r2Key: z.string().min(1) }),
]);

export const SlideSpec = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  background: Background,
  layers: z.array(Layer).default([]),
});

export const CarouselSpec = z.object({
  slides: z.array(SlideSpec).min(1).max(12),
});

export const inputSchema = z.object({
  itemId: z.string().min(1),
  spec: CarouselSpec,
});
export type RenderJsxCarouselInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  slides: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      r2Key: z.string(),
      url: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      sizeBytes: z.number().int().positive(),
    }),
  ),
});
export type RenderJsxCarouselOutput = z.infer<typeof outputSchema>;

// ─── Font loading (cached) ─────────────────────────────────────────────────

const FONT_FILES: Record<FontName, string> = {
  Inter: "Inter-Regular.ttf",
  "Inter-Bold": "Inter-Bold.ttf",
  "DM-Serif": "DMSerifDisplay-Regular.ttf",
  "JetBrains-Mono": "JetBrainsMono-Regular.ttf",
};

let _cachedFonts: SatoriFont[] | undefined;

function fontsDir(): string {
  // This file is packages/tools/renderJsxCarousel.ts, fonts live next to it.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "fonts");
}

export async function loadFonts(): Promise<SatoriFont[]> {
  if (_cachedFonts) return _cachedFonts;
  const dir = fontsDir();
  const result: SatoriFont[] = [];
  const missing: string[] = [];
  for (const name of Object.keys(FONT_FILES) as FontName[]) {
    const file = FONT_FILES[name];
    const full = path.join(dir, file);
    try {
      const buf = await fs.readFile(full);
      result.push({
        name,
        data: buf,
        weight: name === "Inter-Bold" ? 700 : 400,
        style: "normal",
      });
    } catch {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `render_jsx_carousel: missing required font(s) in ${dir}: ${missing.join(", ")}. ` +
        `See packages/tools/fonts/README.md for procurement.`,
    );
  }
  _cachedFonts = result;
  return result;
}

// Test-only: reset cache between tests if needed.
export function __resetFontCacheForTests(): void {
  _cachedFonts = undefined;
}

// ─── React-tree composition ───────────────────────────────────────────────
// Satori expects a tree of plain elements (it doesn't run React's renderer —
// it walks the element tree directly). We build absolute-positioned divs.

type SlideSpecT = z.infer<typeof SlideSpec>;
type LayerT = z.infer<typeof Layer>;
type BackgroundT = z.infer<typeof Background>;

function backgroundStyle(
  bg: BackgroundT,
  imageDataUrls: Map<string, string>,
): Record<string, string> {
  if (bg.kind === "color") {
    return { background: bg.value };
  }
  if (bg.kind === "gradient") {
    return {
      backgroundImage: `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`,
    };
  }
  // image
  const dataUrl = imageDataUrls.get(bg.r2Key);
  if (!dataUrl) {
    throw new Error(
      `render_jsx_carousel: background image r2Key not preloaded: ${bg.r2Key}`,
    );
  }
  return {
    backgroundImage: `url(${dataUrl})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

function layerElement(
  layer: LayerT,
  imageDataUrls: Map<string, string>,
): SatoriElement {
  if (layer.kind === "text") {
    const style: Record<string, string | number> = {
      position: "absolute",
      display: "flex",
      left: layer.x,
      top: layer.y,
      width: layer.w,
      color: layer.color,
      fontFamily: layer.font,
      fontWeight: layer.font === "Inter-Bold" ? 700 : 400,
      fontSize: layer.size,
      lineHeight: layer.lineHeight,
      textAlign: layer.align,
      whiteSpace: "pre-wrap",
    };
    if (layer.align === "center") {
      style["justifyContent"] = "center";
    } else if (layer.align === "right") {
      style["justifyContent"] = "flex-end";
    }
    return el("div", { style }, layer.text);
  }
  if (layer.kind === "image") {
    const dataUrl = imageDataUrls.get(layer.r2Key);
    if (!dataUrl) {
      throw new Error(
        `render_jsx_carousel: image layer r2Key not preloaded: ${layer.r2Key}`,
      );
    }
    const style: Record<string, string | number> = {
      position: "absolute",
      left: layer.x,
      top: layer.y,
      width: layer.w,
      height: layer.h,
      objectFit: "cover",
    };
    if (typeof layer.borderRadius === "number") {
      style["borderRadius"] = layer.borderRadius;
    }
    return el("img", { src: dataUrl, style });
  }
  // rect
  const style: Record<string, string | number> = {
    position: "absolute",
    left: layer.x,
    top: layer.y,
    width: layer.w,
    height: layer.h,
    background: layer.fill,
  };
  if (typeof layer.borderRadius === "number") {
    style["borderRadius"] = layer.borderRadius;
  }
  return el("div", { style });
}

export function buildSlideTree(
  slide: SlideSpecT,
  imageDataUrls: Map<string, string>,
): SatoriElement {
  const rootStyle: Record<string, string | number> = {
    display: "flex",
    position: "relative",
    width: slide.width,
    height: slide.height,
    overflow: "hidden",
    ...backgroundStyle(slide.background, imageDataUrls),
  };
  const children = slide.layers.map((layer) =>
    layerElement(layer, imageDataUrls),
  );
  return el("div", { style: rootStyle }, children);
}

function imageMimeFromKey(r2Key: string): string {
  const lower = r2Key.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

async function preloadImagesForSlide(
  slide: SlideSpecT,
): Promise<Map<string, string>> {
  const keysToLoad = new Set<string>();
  if (slide.background.kind === "image") keysToLoad.add(slide.background.r2Key);
  for (const layer of slide.layers) {
    if (layer.kind === "image") keysToLoad.add(layer.r2Key);
  }
  const out = new Map<string, string>();
  await Promise.all(
    Array.from(keysToLoad).map(async (k) => {
      const buf = await getObject(k);
      const mime = imageMimeFromKey(k);
      out.set(k, `data:${mime};base64,${buf.toString("base64")}`);
    }),
  );
  return out;
}

export async function renderSlideToPng(
  slide: SlideSpecT,
  fonts: SatoriFont[],
  imageDataUrls: Map<string, string>,
): Promise<Buffer> {
  const tree = buildSlideTree(slide, imageDataUrls);
  // Satori's `node` parameter is typed as React.ReactNode, but the runtime is
  // happy with any element-shaped object. We cast at the boundary.
  // Satori's `node` parameter is typed as React.ReactNode and `fonts` as a
  // strict tuple; the runtime is happy with our element-shaped object and our
  // SatoriFont structurally matches its Font type. Single boundary cast.
  type SatoriArgs = Parameters<typeof satori>;
  const svg = await satori(tree as unknown as SatoriArgs[0], {
    width: slide.width,
    height: slide.height,
    fonts,
  } as unknown as SatoriArgs[1]);
  const { Resvg } = await import("@resvg/resvg-js");
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: slide.width },
  })
    .render()
    .asPng();
  return Buffer.from(png);
}

export async function renderJsxCarousel(
  rawInput: RenderJsxCarouselInput,
  ctx: ToolContext,
): Promise<RenderJsxCarouselOutput> {
  const input = inputSchema.parse(rawInput);
  const fonts = await loadFonts();

  const base = process.env.R2_PUBLIC_BASE_URL ?? "";

  const slides: RenderJsxCarouselOutput["slides"] = [];
  // Serial — Satori + resvg are CPU-bound; parallelizing across slides on a
  // small worker doesn't help and adds memory pressure. Image preload
  // *within* a slide is parallel already.
  for (let i = 0; i < input.spec.slides.length; i++) {
    const slide = input.spec.slides[i];
    if (!slide) continue;
    const imageDataUrls = await preloadImagesForSlide(slide);
    const png = await renderSlideToPng(slide, fonts, imageDataUrls);
    const r2Key = keys.outputSlide(ctx.projectSlug, input.itemId, i);
    await putObject(r2Key, png, "image/png");
    slides.push({
      index: i,
      r2Key,
      url: base ? publicUrlFor(base, r2Key) : r2Key,
      width: slide.width,
      height: slide.height,
      sizeBytes: png.length,
    });
  }

  return { slides };
}

// Convention alias — descriptors.ts wraps a tool by its `handler` export.
export const handler = renderJsxCarousel;
