import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import { enqueueItem } from "../../../lib/queue";

// job router — list / get / retry. /jobs page polls list() every 2s.

export const jobRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(50),
          status: z.enum(["QUEUED", "RUNNING", "DONE", "FAILED"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.prisma.job.findMany({
        where: input?.status ? { status: input.status } : undefined,
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 50,
        include: {
          item: {
            select: {
              id: true,
              type: true,
              hook: true,
              project: { select: { slug: true, name: true } },
            },
          },
        },
      });
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const job = await ctx.prisma.job.findUnique({
        where: { id: input.id },
        include: {
          item: { include: { project: true } },
        },
      });
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });
      return job;
    }),

  retry: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.prisma.job.findUnique({
        where: { id: input.id },
        include: { item: { include: { project: true } } },
      });
      if (!job) throw new TRPCError({ code: "NOT_FOUND" });

      let bullJobId: string;
      if (job.kind === "BRIEF") {
        // No item attached; retry needs the original brief id which we don't
        // currently track on Job. For now reject — Phase C handoff: the
        // orchestrator agent may add briefId to Job for cleaner retries.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Retrying brief jobs requires re-running brief.start (briefId not on Job row).",
        });
      } else if (job.item && job.item.project) {
        bullJobId = await enqueueItem({
          itemId: job.item.id,
        });
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Job has no associated item — cannot retry.",
        });
      }

      const updated = await ctx.prisma.job.update({
        where: { id: input.id },
        data: {
          bullJobId,
          status: "QUEUED",
          error: null,
          startedAt: null,
          finishedAt: null,
        },
      });
      return updated;
    }),
});
