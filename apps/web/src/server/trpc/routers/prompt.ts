import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ALLOWED_PROMPT_FILES, ensureProjectPrompts } from "@shri/prompts-fs";
import { executeTool } from "@shri/tools";
import { router, publicProcedure } from "../init";
import { makeWebToolContext } from "../../tool-ctx";

// prompt router — the seven allowlisted per-project markdown files.
// CLAUDE.md #9 + docs/07-prompts.md. Read/write go through the existing tools
// (read_project_prompt, write_project_prompt) so MCP + web share one path.

const fileSchema = z.enum(
  ALLOWED_PROMPT_FILES as unknown as [string, ...string[]],
);

export const promptRouter = router({
  list: publicProcedure.query(async () => {
    return [...ALLOWED_PROMPT_FILES];
  }),

  read: publicProcedure
    .input(z.object({ projectSlug: z.string(), file: fileSchema }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      // Guarantee the file exists (copies seed if missing) — keeps the editor
      // from 500ing on a freshly-created project where prompts weren't yet
      // ensured.
      await ensureProjectPrompts(project.slug);
      const toolCtx = makeWebToolContext({
        projectId: project.id,
        projectSlug: project.slug,
      });
      const out = (await executeTool(
        "read_project_prompt",
        { projectSlug: project.slug, file: input.file },
        toolCtx,
      )) as { file: string; content: string };
      return out;
    }),

  write: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        file: fileSchema,
        content: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const toolCtx = makeWebToolContext({
        projectId: project.id,
        projectSlug: project.slug,
      });
      return executeTool(
        "write_project_prompt",
        {
          projectSlug: project.slug,
          file: input.file,
          content: input.content,
        },
        toolCtx,
      );
    }),

  /**
   * Parsed summary of theme-story.md — extracts ## Setting / ## Mood /
   * ## Visual palette sections. Powers the project dashboard "Theme" card
   * (docs/15-theme-story.md). Returns null sections if the file is empty
   * or missing the heading.
   */
  themeSummary: publicProcedure
    .input(z.object({ projectSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      await ensureProjectPrompts(project.slug);
      const toolCtx = makeWebToolContext({
        projectId: project.id,
        projectSlug: project.slug,
      });
      const out = (await executeTool(
        "read_project_prompt",
        { projectSlug: project.slug, file: "theme-story.md" },
        toolCtx,
      )) as { content: string };
      return {
        setting: extractMarkdownSection(out.content, "Setting"),
        mood: extractMarkdownSection(out.content, "Mood"),
        palette: extractMarkdownSection(out.content, "Visual palette"),
      };
    }),
});

function extractMarkdownSection(content: string, heading: string): string | null {
  // Match `## Heading\n…` up to the next `## ` or EOF.
  const re = new RegExp(
    `##\\s+${escapeRegex(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,
    "i",
  );
  const m = content.match(re);
  if (!m) return null;
  const body = (m[1] ?? "").trim();
  return body || null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
