import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  TOOL_NAMES,
  executeTool,
  getTool,
  toMcpToolSchema,
  toOpenAIFunctionTool,
  toolDescriptors,
  zodToJsonSchema,
} from "./index.js";

// -----------------------------------------------------------------------------
// Registry shape — every tool docs/03-tools.md lists must be present, exactly
// once, with snake_case names and non-empty descriptions + Zod schemas.
// -----------------------------------------------------------------------------

const EXPECTED_TOOLS = [
  "list_project_assets",
  "save_content_output",
  "read_project_prompt",
  "write_project_prompt",
  "crawl_product_site",
  "generate_project_prompts",
  "generate_image",
  "render_jsx_carousel",
  "place_text_on_image",
  "generate_character_base",
  "generate_character_views",
  "merge_character_sheet",
  "chat_design_character",
  "list_project_characters",
  "submit_seedance_job",
  "poll_seedance_job",
  "generate_tts",
  "mux_audio",
  "concat_videos",
  "estimate_cost",
] as const;

describe("toolDescriptors registry", () => {
  it("registers every expected tool exactly once", () => {
    const names = new Set(TOOL_NAMES);
    expect(names.size).toBe(TOOL_NAMES.length);
    for (const expected of EXPECTED_TOOLS) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it("every name is snake_case", () => {
    for (const name of TOOL_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("every descriptor has a non-empty description + zod schemas", () => {
    for (const d of toolDescriptors) {
      expect(d.description.length).toBeGreaterThan(20);
      expect(d.inputSchema).toBeDefined();
      expect(d.outputSchema).toBeDefined();
      // Calling _def is the cheapest "is this a ZodType" check.
      expect((d.inputSchema as z.ZodTypeAny)._def).toBeDefined();
      expect((d.outputSchema as z.ZodTypeAny)._def).toBeDefined();
    }
  });

  it("getTool returns the descriptor by name", () => {
    const d = getTool("read_project_prompt");
    expect(d?.name).toBe("read_project_prompt");
    expect(getTool("does_not_exist")).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// OpenAI + MCP adapters — both consumers iterate the same registry.
// -----------------------------------------------------------------------------

describe("consumer adapters", () => {
  it("toOpenAIFunctionTool emits a chat.completions-shaped function tool", () => {
    const d = toolDescriptors.find((x) => x.name === "list_project_assets")!;
    const t = toOpenAIFunctionTool(d);
    expect(t.type).toBe("function");
    expect(t.function.name).toBe("list_project_assets");
    expect(t.function.description.length).toBeGreaterThan(0);
    expect(t.function.parameters.type).toBe("object");
    expect(t.function.parameters.properties).toBeDefined();
    expect(t.function.parameters.properties?.projectSlug).toBeDefined();
  });

  it("toMcpToolSchema emits a tools/list-shaped entry", () => {
    const d = toolDescriptors.find((x) => x.name === "list_project_assets")!;
    const t = toMcpToolSchema(d);
    expect(t.name).toBe("list_project_assets");
    expect(t.inputSchema.type).toBe("object");
  });

  it("all 20 tools convert without throwing for both adapters", () => {
    for (const d of toolDescriptors) {
      const o = toOpenAIFunctionTool(d);
      const m = toMcpToolSchema(d);
      expect(o.function.name).toBe(d.name);
      expect(m.name).toBe(d.name);
    }
  });
});

// -----------------------------------------------------------------------------
// zodToJsonSchema — spot-check the subset of Zod we actually use.
// -----------------------------------------------------------------------------

describe("zodToJsonSchema", () => {
  it("converts primitives + describe()", () => {
    expect(zodToJsonSchema(z.string().describe("hi"))).toMatchObject({
      type: "string",
      description: "hi",
    });
    expect(zodToJsonSchema(z.number().int().min(0).max(10))).toMatchObject({
      type: "integer",
      minimum: 0,
      maximum: 10,
    });
    expect(zodToJsonSchema(z.boolean())).toMatchObject({ type: "boolean" });
  });

  it("converts enums to string + enum", () => {
    expect(zodToJsonSchema(z.enum(["a", "b", "c"]))).toMatchObject({
      type: "string",
      enum: ["a", "b", "c"],
    });
  });

  it("converts objects with required/optional", () => {
    const s = z.object({
      a: z.string(),
      b: z.number().optional(),
      c: z.string().default("x"),
    });
    const out = zodToJsonSchema(s);
    expect(out.type).toBe("object");
    expect(out.properties?.a).toMatchObject({ type: "string" });
    expect(out.required).toEqual(["a"]);
    expect(out.properties?.c).toMatchObject({ default: "x" });
  });

  it("converts arrays", () => {
    const out = zodToJsonSchema(z.array(z.string()));
    expect(out.type).toBe("array");
    expect(out.items).toMatchObject({ type: "string" });
  });

  it("converts union-of-literals to enum (LLM-friendly)", () => {
    const out = zodToJsonSchema(z.union([z.literal("x"), z.literal("y")]));
    expect(out.enum).toEqual(["x", "y"]);
  });

  it("converts nullable to a multi-type", () => {
    const out = zodToJsonSchema(z.string().nullable());
    expect(out.type).toEqual(["string", "null"]);
    expect(out.nullable).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// executeTool round-trip — register one ad-hoc descriptor and exercise the
// validate-input → handler → validate-output flow without touching peer code.
// -----------------------------------------------------------------------------

describe("executeTool", () => {
  it("throws for unknown tools", async () => {
    await expect(
      executeTool("nonexistent_tool", {}, { projectId: "x", projectSlug: "x" }),
    ).rejects.toThrow(/unknown tool/);
  });

  it("rejects bad input before invoking the handler", async () => {
    // list_project_assets requires projectSlug — empty input must fail at input parse.
    await expect(
      executeTool(
        "list_project_assets",
        {},
        { projectId: "x", projectSlug: "x" },
      ),
    ).rejects.toThrow(/input validation failed/);
  });

  it("round-trips: input parse → handler → output parse", async () => {
    // Use read_project_prompt with a temp PROMPTS_DIR to keep things hermetic.
    const { promises: fs } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { writeProjectPrompt } = await import("@shri/prompts-fs");

    const saved = process.env.PROMPTS_DIR;
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "shri-tools-idx-"));
    process.env.PROMPTS_DIR = tmp;
    try {
      await writeProjectPrompt("rr", "image-caption.md", "# round-trip ok");
      const result = (await executeTool(
        "read_project_prompt",
        { projectSlug: "rr", file: "image-caption.md" },
        { projectId: "rr", projectSlug: "rr" },
      )) as { file: string; content: string };
      expect(result.file).toBe("image-caption.md");
      expect(result.content).toBe("# round-trip ok");
    } finally {
      if (saved === undefined) delete process.env.PROMPTS_DIR;
      else process.env.PROMPTS_DIR = saved;
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
