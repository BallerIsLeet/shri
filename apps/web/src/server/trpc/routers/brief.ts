import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import { enqueueBrief } from "../../../lib/queue";

// brief router — start a new brief (enqueues a BRIEF job), read briefs.

export const briefRouter = router({
  start: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        rangeDays: z.number().int().min(1).max(30).default(7),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // Create a DRAFTING brief immediately so the UI has something to link to.
      // The worker flips it to READY when items are populated.
      const brief = await ctx.prisma.brief.create({
        data: {
          projectId: project.id,
          status: "DRAFTING",
          rangeDays: input.rangeDays,
          rawJson: {},
        },
      });
      const job = await ctx.prisma.job.create({
        data: {
          itemId: null,
          kind: "BRIEF",
          bullJobId: "",
          status: "QUEUED",
        },
      });
      try {
        const bullJobId = await enqueueBrief({
          projectId: project.id,
          rangeDays: input.rangeDays,
          briefId: brief.id,
        });
        await ctx.prisma.job.update({
          where: { id: job.id },
          data: { bullJobId },
        });
      } catch (err) {
        await ctx.prisma.job.update({
          where: { id: job.id },
          data: { status: "FAILED", error: (err as Error).message },
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to enqueue brief job: ${(err as Error).message}`,
        });
      }
      return { brief, jobId: job.id };
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const brief = await ctx.prisma.brief.findUnique({
        where: { id: input.id },
        include: {
          project: true,
          items: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!brief) throw new TRPCError({ code: "NOT_FOUND" });
      return brief;
    }),

  latestForProject: publicProcedure
    .input(z.object({ projectSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true },
      });
      if (!project) return null;
      return ctx.prisma.brief.findFirst({
        where: { projectId: project.id },
        orderBy: { createdAt: "desc" },
      });
    }),
});
