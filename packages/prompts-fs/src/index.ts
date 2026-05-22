import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// THE allowlist. CLAUDE.md convention #5: any filename outside the seven is rejected.
// See docs/07-prompts.md + docs/15-theme-story.md.
export const ALLOWED_PROMPT_FILES = [
  "director-brief.md",
  "carousel-plan.md",
  "video-plan.md",
  "image-caption.md",
  "text-overlay-copy.md",
  "video-prompt.md",
  "theme-story.md",
] as const;

export type PromptFile = (typeof ALLOWED_PROMPT_FILES)[number];

const ALLOWED_SET = new Set<string>(ALLOWED_PROMPT_FILES);

function assertAllowed(file: string): asserts file is PromptFile {
  if (!ALLOWED_SET.has(file)) {
    throw new Error(
      `@shri/prompts-fs: disallowed prompt file "${file}". ` +
        `Allowed: ${ALLOWED_PROMPT_FILES.join(", ")}`,
    );
  }
}

function promptsDir(): string {
  return process.env.PROMPTS_DIR ?? "./prompts-projects";
}

// Located alongside this package's source tree at compile time. The seed
// templates live at <repo>/prompts/*.md regardless of cwd.
function seedsDir(): string {
  // packages/prompts-fs/src/index.ts → repo root is three levels up.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "prompts");
}

function projectDir(slug: string): string {
  if (!slug || slug.includes("/") || slug.includes("..") || slug.startsWith(".")) {
    throw new Error(`@shri/prompts-fs: invalid project slug "${slug}"`);
  }
  return path.join(promptsDir(), slug);
}

export async function readProjectPrompt(
  slug: string,
  file: string,
): Promise<string> {
  assertAllowed(file);
  return fs.readFile(path.join(projectDir(slug), file), "utf8");
}

export async function writeProjectPrompt(
  slug: string,
  file: string,
  content: string,
): Promise<void> {
  assertAllowed(file);
  const dir = projectDir(slug);
  await fs.mkdir(dir, { recursive: true });
  // Atomic write: a concurrent reader either sees the old content or the new,
  // never a half-flushed file. (rename is atomic within a single fs on POSIX.)
  const target = path.join(dir, file);
  const tmp = path.join(dir, `.${file}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, target);
}

export async function ensureProjectPrompts(slug: string): Promise<void> {
  const dir = projectDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const seeds = seedsDir();
  await Promise.all(
    ALLOWED_PROMPT_FILES.map(async (file) => {
      const target = path.join(dir, file);
      const exists = await fileExists(target);
      if (exists) return;
      const seed = path.join(seeds, file);
      const content = await fs.readFile(seed, "utf8");
      await fs.writeFile(target, content, "utf8");
    }),
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
