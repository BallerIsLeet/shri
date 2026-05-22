import { describe, it, expect } from "vitest";
import {
  type Cell,
  estimateTextBbox,
  findBestRegion,
  inputSchema,
  outputSchema,
} from "./placeTextOnImage.js";

describe("place_text_on_image — schema", () => {
  it("requires itemId, baseR2Key, text", () => {
    expect(inputSchema.safeParse({}).success).toBe(false);
    expect(
      inputSchema.safeParse({ itemId: "x", baseR2Key: "x" }).success,
    ).toBe(false);
  });

  it("applies textStyle defaults", () => {
    const r = inputSchema.parse({
      itemId: "i",
      baseR2Key: "k",
      text: "hello",
    });
    expect(r.textStyle.font).toBe("Inter-Bold");
    expect(r.textStyle.size).toBe(72);
    expect(r.gridSize).toBe(8);
  });

  it("rejects gridSize out of range", () => {
    expect(
      inputSchema.safeParse({
        itemId: "i",
        baseR2Key: "k",
        text: "x",
        gridSize: 1,
      }).success,
    ).toBe(false);
    expect(
      inputSchema.safeParse({
        itemId: "i",
        baseR2Key: "k",
        text: "x",
        gridSize: 64,
      }).success,
    ).toBe(false);
  });
});

describe("place_text_on_image — estimateTextBbox", () => {
  it("scales width with character count", () => {
    const small = estimateTextBbox("hi", "Inter-Bold", 60, 1.1, 1000);
    const big = estimateTextBbox(
      "this is a much longer line of headline text",
      "Inter-Bold",
      60,
      1.1,
      1000,
    );
    expect(big.w).toBeGreaterThan(small.w);
  });

  it("wraps when the line wouldn't fit in maxWidth (line count grows)", () => {
    const narrow = estimateTextBbox(
      "alpha bravo charlie delta echo",
      "Inter-Bold",
      60,
      1.1,
      200,
    );
    expect(narrow.lineCount).toBeGreaterThan(1);
    expect(narrow.h).toBeGreaterThan(60);
  });

  it("handles a single word longer than the line by chunking", () => {
    const r = estimateTextBbox(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "Inter",
      40,
      1.1,
      200,
    );
    expect(r.lineCount).toBeGreaterThan(1);
  });

  it("throws on a non-positive advance", () => {
    expect(() => estimateTextBbox("x", "Inter", 0, 1.1, 100)).toThrow();
  });
});

describe("place_text_on_image — findBestRegion", () => {
  function uniformGrid(size: number, score: number): Cell[][] {
    return Array.from({ length: size }, (_, cy) =>
      Array.from({ length: size }, (_, cx) => ({ cx, cy, score })),
    );
  }

  it("picks the low-score quadrant when one is clearly best", () => {
    const grid: Cell[][] = uniformGrid(8, 0.9);
    // Make the top-left 2x2 a clear winner.
    for (let cy = 0; cy < 2; cy++) {
      const row = grid[cy]!;
      for (let cx = 0; cx < 2; cx++) {
        row[cx] = { cx, cy, score: 0.05 };
      }
    }
    const out = findBestRegion(grid, 8, 800, 800, 200, 200);
    expect(out.region.x).toBeLessThan(200);
    expect(out.region.y).toBeLessThan(200);
    expect(out.scoreAtRegion).toBeLessThan(0.2);
    expect(out.fallback).toBe(false);
  });

  it("flags fallback when every cell is busy", () => {
    const grid: Cell[][] = uniformGrid(8, 0.95);
    const out = findBestRegion(grid, 8, 800, 800, 100, 100);
    expect(out.fallback).toBe(true);
  });

  it("returns a centered fallback when text is too big for the grid", () => {
    const grid: Cell[][] = uniformGrid(8, 0.1);
    const out = findBestRegion(grid, 8, 100, 100, 1000, 1000);
    expect(out.fallback).toBe(true);
  });

  it("region.w and region.h equal the requested text bbox", () => {
    const grid: Cell[][] = uniformGrid(8, 0.1);
    const out = findBestRegion(grid, 8, 800, 800, 250, 80);
    expect(out.region.w).toBe(250);
    expect(out.region.h).toBe(80);
  });
});

describe("place_text_on_image — output schema", () => {
  it("validates a well-formed result", () => {
    const ok = outputSchema.safeParse({
      r2Key: "k",
      url: "u",
      region: { x: 10, y: 20, w: 100, h: 50 },
      scoreAtRegion: 0.12,
      fallback: false,
    });
    expect(ok.success).toBe(true);
  });
});
