import { describe, it, expect } from "vitest";
import { gridDimensionsFor, inputSchema, outputSchema } from "./mergeCharacterSheet.js";

describe("merge_character_sheet — schema", () => {
  it("requires characterId", () => {
    expect(inputSchema.safeParse({}).success).toBe(false);
    expect(inputSchema.safeParse({ characterId: "c1" }).success).toBe(true);
  });

  it("defaults to grid_3x2 layout", () => {
    const r = inputSchema.parse({ characterId: "c1" });
    expect(r.layout).toBe("grid_3x2");
  });

  it("rejects unknown layout", () => {
    expect(
      inputSchema.safeParse({ characterId: "c1", layout: "diagonal" }).success,
    ).toBe(false);
  });

  it("accepts optional views array", () => {
    const r = inputSchema.parse({
      characterId: "c1",
      views: [
        { pose: "front", r2Key: "k1", order: 0 },
        { pose: "side", r2Key: "k2", order: 1 },
      ],
    });
    expect(r.views?.length).toBe(2);
  });

  it("rejects view entries missing fields", () => {
    expect(
      inputSchema.safeParse({
        characterId: "c1",
        views: [{ pose: "front", r2Key: "k1" }],
      }).success,
    ).toBe(false);
  });

  it("output schema validates", () => {
    const ok = outputSchema.safeParse({
      sheetR2Key: "k",
      url: "u",
      width: 1500,
      height: 1000,
    });
    expect(ok.success).toBe(true);
  });
});

describe("merge_character_sheet — gridDimensionsFor", () => {
  it("grid_3x2 with 6 views → 3 cols × 2 rows", () => {
    expect(gridDimensionsFor("grid_3x2", 6)).toEqual({ cols: 3, rows: 2 });
  });
  it("grid_3x2 with 7 views → 3 cols × 3 rows (rounded up)", () => {
    expect(gridDimensionsFor("grid_3x2", 7)).toEqual({ cols: 3, rows: 3 });
  });
  it("grid_2x3 with 6 views → 2 cols × 3 rows", () => {
    expect(gridDimensionsFor("grid_2x3", 6)).toEqual({ cols: 2, rows: 3 });
  });
  it("grid_2x3 with 5 views → 2 cols × 3 rows", () => {
    expect(gridDimensionsFor("grid_2x3", 5)).toEqual({ cols: 2, rows: 3 });
  });
  it("horizontal with 4 views → 4 cols × 1 row", () => {
    expect(gridDimensionsFor("horizontal", 4)).toEqual({ cols: 4, rows: 1 });
  });
  it("grid_3x2 with 1 view returns 1 row", () => {
    expect(gridDimensionsFor("grid_3x2", 1)).toEqual({ cols: 3, rows: 1 });
  });
});
