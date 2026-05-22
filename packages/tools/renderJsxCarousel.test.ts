import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import {
  CarouselSpec,
  SlideSpec,
  buildSlideTree,
  inputSchema,
  loadFonts,
  renderSlideToPng,
  __resetFontCacheForTests,
} from "./renderJsxCarousel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.join(here, "fonts");

async function hasAllFonts(): Promise<boolean> {
  const required = [
    "Inter-Regular.ttf",
    "Inter-Bold.ttf",
    "DMSerifDisplay-Regular.ttf",
    "JetBrainsMono-Regular.ttf",
  ];
  for (const f of required) {
    try {
      await fs.access(path.join(fontsDir, f));
    } catch {
      return false;
    }
  }
  return true;
}

describe("render_jsx_carousel — schema", () => {
  it("rejects an empty slides array", () => {
    const res = CarouselSpec.safeParse({ slides: [] });
    expect(res.success).toBe(false);
  });

  it("caps the slides array at 12", () => {
    const slide = {
      width: 100,
      height: 100,
      background: { kind: "color", value: "#fff" },
      layers: [],
    };
    const res = CarouselSpec.safeParse({ slides: new Array(13).fill(slide) });
    expect(res.success).toBe(false);
  });

  it("rejects an unknown layer kind", () => {
    const res = SlideSpec.safeParse({
      width: 100,
      height: 100,
      background: { kind: "color", value: "#fff" },
      layers: [{ kind: "video", x: 0, y: 0, w: 10, h: 10, src: "x" }],
    });
    expect(res.success).toBe(false);
  });

  it("requires itemId on the top-level input", () => {
    const res = inputSchema.safeParse({
      spec: {
        slides: [
          {
            width: 100,
            height: 100,
            background: { kind: "color", value: "#fff" },
            layers: [],
          },
        ],
      },
    });
    expect(res.success).toBe(false);
  });

  it("accepts a well-formed text+rect slide", () => {
    const res = SlideSpec.safeParse({
      width: 1080,
      height: 1350,
      background: { kind: "color", value: "#000" },
      layers: [
        {
          kind: "rect",
          x: 0,
          y: 1000,
          w: 1080,
          h: 350,
          fill: "rgba(0,0,0,0.5)",
        },
        {
          kind: "text",
          x: 40,
          y: 1050,
          w: 1000,
          text: "Hello",
          font: "Inter-Bold",
          size: 72,
          color: "#fff",
        },
      ],
    });
    expect(res.success).toBe(true);
  });
});

describe("render_jsx_carousel — buildSlideTree", () => {
  it("composes a root div with style for background color", () => {
    const slide = SlideSpec.parse({
      width: 100,
      height: 100,
      background: { kind: "color", value: "#abcdef" },
      layers: [],
    });
    const root = buildSlideTree(slide, new Map());
    expect(root.type).toBe("div");
    const style = root.props["style"] as Record<string, unknown>;
    expect(style["width"]).toBe(100);
    expect(style["background"]).toBe("#abcdef");
  });

  it("composes a gradient background via CSS linear-gradient", () => {
    const slide = SlideSpec.parse({
      width: 100,
      height: 100,
      background: { kind: "gradient", from: "#f00", to: "#00f", angle: 45 },
      layers: [],
    });
    const root = buildSlideTree(slide, new Map());
    const style = root.props["style"] as Record<string, unknown>;
    expect(style["backgroundImage"]).toContain("linear-gradient(45deg");
    expect(style["backgroundImage"]).toContain("#f00");
    expect(style["backgroundImage"]).toContain("#00f");
  });

  it("throws if an image layer references a key not preloaded", () => {
    const slide = SlideSpec.parse({
      width: 100,
      height: 100,
      background: { kind: "color", value: "#fff" },
      layers: [
        { kind: "image", x: 0, y: 0, w: 50, h: 50, r2Key: "not-loaded.png" },
      ],
    });
    expect(() => buildSlideTree(slide, new Map())).toThrow(
      /image layer r2Key not preloaded/,
    );
  });
});

const fontsAvailablePromise = hasAllFonts();

describe("render_jsx_carousel — Satori + resvg pipeline (real fonts)", () => {
  let fontsOk = false;

  beforeAll(async () => {
    __resetFontCacheForTests();
    fontsOk = await fontsAvailablePromise;
  });

  it("renders a real PNG for a trivial color-only slide (requires fonts)", async () => {
    if (!fontsOk) {
      // Skip is implicit: assert the documented failure mode instead.
      await expect(loadFonts()).rejects.toThrow(/missing required font/);
      return;
    }
    const fonts = await loadFonts();
    const slide = SlideSpec.parse({
      width: 200,
      height: 200,
      background: { kind: "color", value: "#112233" },
      layers: [
        {
          kind: "text",
          x: 20,
          y: 80,
          w: 160,
          text: "OK",
          font: "Inter",
          size: 48,
          color: "#ffffff",
        },
      ],
    });
    const png = await renderSlideToPng(slide, fonts, new Map());
    expect(png.length).toBeGreaterThan(100);
    // PNG magic
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  }, 30_000);
});
