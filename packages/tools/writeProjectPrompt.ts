import { z } from "zod";
import {
  ALLOWED_PROMPT_FILES,
  writeProjectPrompt as fsWriteProjectPrompt,
} from "@shri/prompts-fs";
import type { ToolContext } from "./descriptors.js";

// write_project_prompt — thin wrapper around @shri/prompts-fs. Allowlist +
// atomic write semantics live in prompts-fs.

export const inputSchema = z.object({
  projectSlug: z.string().describe("URL-safe project slug"),
  file: z
    .enum(ALLOWED_PROMPT_FILES as unknown as [string, ...string[]])
    .describe("One of the seven allowlisted prompt files"),
  content: z.string().describe("Full markdown contents to write (overwrites)"),
});

export const outputSchema = z.object({
  file: z.string(),
  bytes: z.number().int(),
  ok: z.literal(true),
});

export type WriteProjectPromptInput = z.infer<typeof inputSchema>;
export type WriteProjectPromptOutput = z.infer<typeof outputSchema>;

export async function handler(
  input: WriteProjectPromptInput,
  _ctx: ToolContext,
): Promise<WriteProjectPromptOutput> {
  await fsWriteProjectPrompt(input.projectSlug, input.file, input.content);
  return {
    file: input.file,
    bytes: Buffer.byteLength(input.content, "utf8"),
    ok: true,
  };
}
