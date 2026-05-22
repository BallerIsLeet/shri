import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { executeTool } from "@shri/tools";
import { ensureProjectPrompts } from "@shri/prompts-fs";
import { router, publicProcedure } from "../init";
import { makeWebToolContext } from "../../tool-ctx";

// project router — list / create / read / crawl / generatePrompts.
// See docs/09-web-app.md, docs/13-crawling-and-prompt-gen.md.

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
}

const createInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1),
  highlights: z.string().min(1),
  websiteUrl: z.string().url().optional(),
});

export const projectRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { briefs: true, items: true, characters: true } },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      websiteUrl: p.websiteUrl,
      promptsGeneratedAt: p.promptsGeneratedAt,
      createdAt: p.createdAt,
      counts: {
        briefs: p._count.briefs,
        items: p._count.items,
        characters: p._count.characters,
      },
    }));
  }),

  bySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.slug },
        include: {
          assets: { orderBy: { createdAt: "asc" } },
          _count: { select: { briefs: true, items: true, characters: true } },
        },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      return project;
    }),

  create: publicProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    let slug = slugify(input.name);
    // Avoid slug collisions with a counter suffix.
    for (let i = 1; i < 1000; i++) {
      const taken = await ctx.prisma.project.findUnique({ where: { slug } });
      if (!taken) break;
      slug = `${slugify(input.name)}-${i + 1}`;
    }
    const project = await ctx.prisma.project.create({
      data: {
        slug,
        name: input.name,
        description: input.description,
        highlights: input.highlights,
        websiteUrl: input.websiteUrl,
      },
    });
    // Seed the seven prompt files for the project from defaults. The web UI
    // (and any subsequent generate_project_prompts call) can edit from there.
    try {
      await ensureProjectPrompts(slug);
    } catch (err) {
      // Don't fail project creation if filesystem isn't ready — the prompts
      // page can re-trigger ensure. Surface via logs only.
      console.error("ensureProjectPrompts failed", err);
    }
    return project;
  }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.project.delete({ where: { id: input.id } });
      return { ok: true as const };
    }),

  // Trigger a crawl via the tool. Returns the productProfile + persists a row.
  crawl: publicProcedure
    .input(z.object({ slug: z.string(), url: z.string().url(), maxPages: z.number().int().min(1).max(20).optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({ where: { slug: input.slug } });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const toolCtx = makeWebToolContext({ projectId: project.id, projectSlug: project.slug });
      const result = await executeTool(
        "crawl_product_site",
        { projectSlug: project.slug, url: input.url, ...(input.maxPages ? { maxPages: input.maxPages } : {}) },
        toolCtx,
      );
      // Persist the latest profile for quick UI display.
      const profile = (result as { productProfile?: unknown }).productProfile;
      if (profile) {
        await ctx.prisma.project.update({
          where: { id: project.id },
          data: { crawlJson: profile as object, websiteUrl: input.url },
        });
      }
      return result;
    }),

  generatePrompts: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        overwrite: z.boolean().optional(),
        productProfile: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({ where: { slug: input.slug } });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const toolCtx = makeWebToolContext({ projectId: project.id, projectSlug: project.slug });
      const result = await executeTool(
        "generate_project_prompts",
        {
          projectSlug: project.slug,
          basis: {
            description: project.description,
            highlights: project.highlights,
            ...(input.productProfile ? { productProfile: input.productProfile } : {}),
            ...(project.websiteUrl ? { websiteUrl: project.websiteUrl } : {}),
          },
          overwrite: input.overwrite ?? false,
        },
        toolCtx,
      );
      await ctx.prisma.project.update({
        where: { id: project.id },
        data: { promptsGeneratedAt: new Date() },
      });
      return result;
    }),

  latestCrawl: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.slug },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const row = await ctx.prisma.projectCrawl.findFirst({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
      });
      return row;
    }),
});
