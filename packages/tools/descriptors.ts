// =============================================================================
// THE CONTRACT every tool in packages/tools/ honors.
//
// Both consumers — apps/worker (OpenAI function-calling) and apps/mcp (MCP stdio
// server) — iterate `toolDescriptors` (exported from ./index.ts) as their single
// source of truth. This file defines the shape of one descriptor and the
// adapter helpers each consumer uses.
//
// CONVENTION for tool files:
//   Each tool file (e.g. listProjectAssets.ts) MUST export THREE named members:
//
//     export const inputSchema: z.ZodSchema<...>;
//     export const outputSchema: z.ZodSchema<...>;
//     export async function handler(input, ctx: ToolContext): Promise<...>;
//
//   ./index.ts wraps these into a ToolDescriptor with `name` + `description`.
//
// =============================================================================

import { z } from "zod";

// -----------------------------------------------------------------------------
// ToolContext — passed to every handler. The orchestrator (Phase C) fills in
// projectId + projectSlug; the MCP server fills them from the call args (the
// MCP path always carries projectSlug in the input, but ctx still travels for
// downstream tools that prefer the id).
// -----------------------------------------------------------------------------

export type ToolContext = {
  projectId: string;
  projectSlug: string;
  /** Optional — present only when a future auth layer surfaces it. */
  userId?: string;
  /** "worker" when called from the BullMQ orchestrator; "mcp" when called over MCP. */
  source?: "worker" | "mcp" | "web";
  /** ContentItem id when the call is item-scoped (e.g. save_content_output). */
  itemId?: string;
};

// -----------------------------------------------------------------------------
// ToolDescriptor — the canonical shape both consumers understand.
// -----------------------------------------------------------------------------

export type ToolDescriptor<I = unknown, O = unknown> = {
  /** snake_case — required by both OpenAI function-calling and MCP. */
  name: string;
  /** Shown to the LLM during tool selection. Should describe purpose + side effects. */
  description: string;
  /** Zod schema validating the input the LLM produced. */
  inputSchema: z.ZodSchema<I>;
  /** Zod schema validating the handler's output. */
  outputSchema: z.ZodSchema<O>;
  /** The tool's implementation. */
  handler: (input: I, ctx: ToolContext) => Promise<O>;
};

// -----------------------------------------------------------------------------
// JSON Schema conversion. Hand-rolled instead of pulling `zod-to-json-schema`
// as a dep — we only need the subset of Zod we actually use (string, number,
// boolean, enum, array, object, optional, default, nullable, literal, union of
// literals). Keeps the dep tree slim and the output predictable for both
// OpenAI's function-calling parser and the MCP client.
//
// Output shape: an OpenAPI-3 / JSON-Schema-Draft-7 object, which is the common
// subset both OpenAI and MCP accept.
// -----------------------------------------------------------------------------

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  nullable?: boolean;
};

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return convert(schema);
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  // Unwrap descriptions onto the leaf result.
  const description = schema.description;

  // Optional / default / nullable: unwrap and tag.
  if (schema instanceof z.ZodOptional) {
    const inner = convert(schema.unwrap());
    return tagDescription(inner, description);
  }
  if (schema instanceof z.ZodDefault) {
    const inner = convert((schema as z.ZodDefault<z.ZodTypeAny>)._def.innerType);
    return tagDescription(
      { ...inner, default: (schema as z.ZodDefault<z.ZodTypeAny>)._def.defaultValue() },
      description,
    );
  }
  if (schema instanceof z.ZodNullable) {
    const inner = convert(schema.unwrap());
    // JSON-Schema-style: extend type to allow "null".
    const types = Array.isArray(inner.type)
      ? [...inner.type, "null"]
      : inner.type
        ? [inner.type, "null"]
        : ["null"];
    return tagDescription({ ...inner, type: types, nullable: true }, description);
  }

  if (schema instanceof z.ZodString) {
    const out: JsonSchema = { type: "string" };
    for (const check of (schema._def.checks ?? []) as Array<{
      kind: string;
      value?: number;
    }>) {
      if (check.kind === "min" && typeof check.value === "number") out.minLength = check.value;
      if (check.kind === "max" && typeof check.value === "number") out.maxLength = check.value;
      if (check.kind === "url") out.format = "uri";
      if (check.kind === "email") out.format = "email";
    }
    return tagDescription(out, description);
  }
  if (schema instanceof z.ZodNumber) {
    const out: JsonSchema = { type: "number" };
    for (const check of (schema._def.checks ?? []) as Array<{
      kind: string;
      value?: number;
    }>) {
      if (check.kind === "min" && typeof check.value === "number") out.minimum = check.value;
      if (check.kind === "max" && typeof check.value === "number") out.maximum = check.value;
      if (check.kind === "int") out.type = "integer";
    }
    return tagDescription(out, description);
  }
  if (schema instanceof z.ZodBoolean) {
    return tagDescription({ type: "boolean" }, description);
  }
  if (schema instanceof z.ZodLiteral) {
    const val = (schema as z.ZodLiteral<unknown>).value;
    return tagDescription({ const: val, type: jsonTypeOf(val) }, description);
  }
  if (schema instanceof z.ZodEnum) {
    const values = (schema as z.ZodEnum<[string, ...string[]]>).options;
    return tagDescription({ type: "string", enum: [...values] }, description);
  }
  if (schema instanceof z.ZodNativeEnum) {
    const values = Object.values(
      (schema as z.ZodNativeEnum<{ [k: string]: string | number; [n: number]: string }>).enum,
    ).filter((v) => typeof v === "string" || typeof v === "number");
    return tagDescription({ enum: values }, description);
  }
  if (schema instanceof z.ZodArray) {
    return tagDescription(
      {
        type: "array",
        items: convert((schema as z.ZodArray<z.ZodTypeAny>).element),
      },
      description,
    );
  }
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const v = value as z.ZodTypeAny;
      properties[key] = convert(v);
      if (!isOptional(v)) required.push(key);
    }
    const out: JsonSchema = {
      type: "object",
      properties,
      additionalProperties: false,
    };
    if (required.length > 0) out.required = required;
    return tagDescription(out, description);
  }
  if (schema instanceof z.ZodUnion) {
    const options = (schema as z.ZodUnion<readonly [z.ZodTypeAny, ...z.ZodTypeAny[]]>)
      .options;
    // Special-case union-of-literals → enum (LLMs handle enums better).
    if (options.every((o) => o instanceof z.ZodLiteral)) {
      const values = options.map((o) => (o as z.ZodLiteral<unknown>).value);
      return tagDescription(
        {
          type: jsonTypeOf(values[0]),
          enum: values,
        },
        description,
      );
    }
    return tagDescription({ anyOf: options.map(convert) }, description);
  }
  if (schema instanceof z.ZodRecord) {
    return tagDescription(
      {
        type: "object",
        additionalProperties: convert(
          (schema as z.ZodRecord<z.ZodString, z.ZodTypeAny>).valueSchema,
        ),
      },
      description,
    );
  }
  if (schema instanceof z.ZodAny || schema instanceof z.ZodUnknown) {
    return tagDescription({}, description);
  }
  // Fallback: at worst we emit `{}` (matches anything) which is safer than
  // throwing inside a tool registration.
  return tagDescription({}, description);
}

function isOptional(schema: z.ZodTypeAny): boolean {
  return (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodDefault ||
    (schema instanceof z.ZodNullable && isOptional(schema.unwrap()))
  );
}

function jsonTypeOf(val: unknown): string {
  if (val === null) return "null";
  if (typeof val === "string") return "string";
  if (typeof val === "number") return "number";
  if (typeof val === "boolean") return "boolean";
  if (Array.isArray(val)) return "array";
  return "object";
}

function tagDescription(schema: JsonSchema, description: string | undefined): JsonSchema {
  if (description) return { ...schema, description };
  return schema;
}

// -----------------------------------------------------------------------------
// Consumer adapters — used by apps/worker and apps/mcp respectively. They live
// here (not in index.ts) so the type/utility surface is in one place and a
// consumer can import from `@shri/tools` for the array AND from
// `@shri/tools/descriptors` for the type without circularity worries.
// -----------------------------------------------------------------------------

/** Shape OpenAI's chat.completions endpoint accepts under `tools: []`. */
export type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

export function toOpenAIFunctionTool(d: ToolDescriptor): OpenAIFunctionTool {
  return {
    type: "function",
    function: {
      name: d.name,
      description: d.description,
      parameters: zodToJsonSchema(d.inputSchema),
    },
  };
}

/** Shape the MCP `tools/list` response expects. */
export type McpToolSchema = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export function toMcpToolSchema(d: ToolDescriptor): McpToolSchema {
  return {
    name: d.name,
    description: d.description,
    inputSchema: zodToJsonSchema(d.inputSchema),
  };
}
