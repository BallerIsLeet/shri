import { z } from "zod";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWED_PROMPT_FILES,
  ensureProjectPrompts,
  writeProjectPrompt,
} from "@shri/prompts-fs";
import { aiClient } from "@shri/ai";
import { prisma } from "@shri/db";
import type { ToolContext } from "./descriptors.js";

// generate_project_prompts — for each of the seven seed templates, run one LLM
// pass to personalize it with the productProfile + description + highlights.
// See docs/13-crawling-and-prompt-gen.md and docs/07-prompts.md.
//
// LLM passes run in parallel via Promise.all — independent, no shared state.

const productProfileSchema = z
  .object({
    name: z.string().nullable(),
    tagline: z.string().nullable(),
    features: z.array(z.string()),
    valueProps: z.array(z.string()),
    targetAudience: z.string().nullable(),
    tone: z.string(),
    inferredCategory: z.string().nullable(),
  })
  .partial();

export const inputSchema = z.object({
  projectSlug: z.string().describe("URL-safe project slug"),
  basis: z.object({
    description: z.string().describe("User-provided product description"),
    highlights: z.string().describe("User-provided highlights / feature notes"),
    productProfile: productProfileSchema
      .optional()
      .describe("Optional productProfile from a prior crawl_product_site call"),
    websiteUrl: z.string().url().optional(),
  }),
  overwrite: z
    .boolean()
    .default(false)
    .describe(
      "When false (default), refuses to clobber files modified after the last generation timestamp.",
    ),
});

export const outputSchema = z.object({
  files: z.record(z.string()),
  written: z.boolean(),
  skipped: z.array(z.string()),
});

export type GenerateProjectPromptsInput = z.infer<typeof inputSchema>;
export type GenerateProjectPromptsOutput = z.infer<typeof outputSchema>;

export async function handler(
  input: GenerateProjectPromptsInput,
  _ctx: ToolContext,
): Promise<GenerateProjectPromptsOutput> {
  const project = await prisma.project.findUnique({
    where: { slug: input.projectSlug },
    select: { id: true, promptsGeneratedAt: true },
  });
  if (!project) {
    throw new Error(
      `generate_project_prompts: project not found for slug "${input.projectSlug}"`,
    );
  }

  // Ensure all seven seed files exist on disk for this project (idempotent —
  // copies missing seeds; doesn't overwrite). This is the safe baseline if
  // anything below fails.
  await ensureProjectPrompts(input.projectSlug);

  // 1. Load all seven seed templates from the repo's prompts/ directory.
  const seedsDir = resolveSeedsDir();
  const seeds: Record<string, string> = {};
  await Promise.all(
    ALLOWED_PROMPT_FILES.map(async (file) => {
      seeds[file] = await fs.readFile(path.join(seedsDir, file), "utf8");
    }),
  );

  // 2. Overwrite-protection: when overwrite=false, skip files whose mtime is
  //    newer than the last generation timestamp (user edits in flight).
  const skipped: string[] = [];
  const filesToGenerate: string[] = [];
  const promptsRoot = process.env.PROMPTS_DIR ?? "./prompts-projects";
  const projectDir = path.join(promptsRoot, input.projectSlug);
  const lastGen = project.promptsGeneratedAt?.getTime() ?? 0;

  for (const file of ALLOWED_PROMPT_FILES) {
    if (input.overwrite) {
      filesToGenerate.push(file);
      continue;
    }
    const target = path.join(projectDir, file);
    try {
      const stat = await fs.stat(target);
      // Skip when the user has edited since last generation. First-time projects
      // have promptsGeneratedAt = null (lastGen = 0) → all files generate.
      if (lastGen > 0 && stat.mtimeMs > lastGen + 1000) {
        skipped.push(file);
        continue;
      }
    } catch {
      // File missing entirely → generate.
    }
    filesToGenerate.push(file);
  }

  // 3. Parallel LLM passes.
  const generated = await Promise.all(
    filesToGenerate.map(async (file) => {
      const content = await personalizeOneFile({
        file,
        seed: seeds[file]!,
        basis: input.basis,
      });
      return [file, content] as const;
    }),
  );

  // 4. Write results via the allowlisted writer (which enforces filename + path
  //    safety + atomic rename).
  await Promise.all(
    generated.map(([file, content]) =>
      writeProjectPrompt(input.projectSlug, file, content),
    ),
  );

  // 5. Mark the generation timestamp so future runs can detect user edits.
  await prisma.project.update({
    where: { id: project.id },
    data: { promptsGeneratedAt: new Date() },
  });

  // 6. Return all seven files' current contents (generated + skipped).
  const files: Record<string, string> = {};
  for (const [file, content] of generated) {
    files[file] = content;
  }
  await Promise.all(
    skipped.map(async (file) => {
      const target = path.join(projectDir, file);
      files[file] = await fs.readFile(target, "utf8");
    }),
  );

  return {
    files,
    written: generated.length > 0,
    skipped,
  };
}

// -----------------------------------------------------------------------------
// One file → one LLM pass.
// -----------------------------------------------------------------------------

async function personalizeOneFile(args: {
  file: string;
  seed: string;
  basis: GenerateProjectPromptsInput["basis"];
}): Promise<string> {
  const { file, seed, basis } = args;

  const profileBlock = basis.productProfile
    ? JSON.stringify(basis.productProfile, null, 2)
    : "(no crawl profile available)";

  const system = [
    "You personalize marketing-prompt seed templates.",
    "Rewrite the seed below so that any '## TO PERSONALIZE' blocks are replaced with concrete, product-specific paragraphs grounded in the description, highlights, and crawl profile.",
    "Preserve ALL other sections verbatim (especially '## Always include', '## What never to do', '## Output shape', heading structure).",
    "Output ONLY the rewritten markdown — no commentary, no fences, no JSON wrapping.",
    "If a section needs information you don't have, write a short, honest placeholder line; do NOT invent product features.",
  ].join(" ");

  const user = [
    `# Seed file: ${file}`,
    "",
    "## Product description",
    basis.description,
    "",
    "## Highlights",
    basis.highlights,
    "",
    "## Crawl profile (JSON)",
    "```json",
    profileBlock,
    "```",
    "",
    basis.websiteUrl ? `## Website\n${basis.websiteUrl}\n` : "",
    "## Seed template (rewrite this)",
    "```markdown",
    seed,
    "```",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await aiClient.chat.complete({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    maxTokens: 4000,
    responseFormat: "text",
  });

  const out = (res.message.content ?? "").trim();
  // Sanity floor: never persist a personalization that's drastically shorter
  // than the seed (likely a refusal or truncation). Fall back to the seed in
  // that case rather than write a degraded prompt.
  if (out.length < Math.max(200, Math.floor(seed.length * 0.4))) {
    return seed;
  }
  // Strip a leading ```markdown / trailing ``` if the model added one despite
  // the system instruction.
  return unwrapMarkdownFence(out);
}

function unwrapMarkdownFence(s: string): string {
  const fenceOpen = /^```(?:markdown|md)?\s*\n/;
  const fenceClose = /\n```\s*$/;
  if (fenceOpen.test(s) && fenceClose.test(s)) {
    return s.replace(fenceOpen, "").replace(fenceClose, "");
  }
  return s;
}

function resolveSeedsDir(): string {
  // packages/tools/generateProjectPrompts.ts → repo root is two levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "prompts");
}
