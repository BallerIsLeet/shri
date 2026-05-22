import { z } from "zod";
import {
  ALLOWED_PROMPT_FILES,
  readProjectPrompt as fsReadProjectPrompt,
} from "@shri/prompts-fs";
import type { ToolContext } from "./descriptors.js";

// read_project_prompt — thin wrapper around @shri/prompts-fs. Allowlist
// enforcement lives in prompts-fs (CLAUDE.md convention #5); do not duplicate
// it here.

export const inputSchema = z.object({
  projectSlug: z.string().describe("URL-safe project slug"),
  file: z
    .enum(ALLOWED_PROMPT_FILES as unknown as [string, ...string[]])
    .describe("One of the seven allowlisted prompt files"),
});

export const outputSchema = z.object({
  file: z.string(),
  content: z.string(),
});

export type ReadProjectPromptInput = z.infer<typeof inputSchema>;
export type ReadProjectPromptOutput = z.infer<typeof outputSchema>;

export async function handler(
  input: ReadProjectPromptInput,
  _ctx: ToolContext,
): Promise<ReadProjectPromptOutput> {
  const content = await fsReadProjectPrompt(input.projectSlug, input.file);
  return { file: input.file, content };
}
