import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import { enqueueItem } from "../../../lib/queue";

// item router — listByBrief, get, updateConcept (the edit-drawer round-trip),
// resetConcept, estimateCost, generateSelected (enqueue per-item jobs).
//
// CLAUDE.md #9: per-item concepts are user-editable. The round-trip is:
// edit-drawer form → item.updateConcept → DB persists conceptJson (and bumps
// conceptRevision) while aiConceptJson stays untouched as audit trail.
// See docs/16-editable-concepts.md.

const conceptJsonSchema = z.record(z.unknown());

export const itemRouter = router({
  listByBrief: publicProcedure
    .input(z.object({ briefId: z.string() }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.contentItem.findMany({
        where: { briefId: input.briefId },
        orderBy: { createdAt: "asc" },
        include: {
          characters: { include: { character: true } },
          outputs: { orderBy: { createdAt: "desc" } },
        },
      });
      return items;
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const item = await ctx.prisma.contentItem.findUnique({
        where: { id: input.id },
        include: {
          characters: { include: { character: true } },
          outputs: { orderBy: { createdAt: "desc" } },
          brief: true,
          project: true,
        },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      return item;
    }),

  /**
   * Persist an edit from the per-row Edit-concept drawer.
   *
   * Contract (CLAUDE.md #9, docs/16-editable-concepts.md):
   *  - aiConceptJson is NEVER mutated — it's the audit trail / reset target.
   *  - conceptJson holds the latest user-edited form (or LLM original if unedited).
   *  - conceptRevision bumps by 1 on every save.
   */
  updateConcept: publicProcedure
    .input(
      z.object({
        itemId: z.string(),
        conceptJson: conceptJsonSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.contentItem.findUnique({
        where: { id: input.itemId },
        select: { id: true, conceptRevision: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const updated = await ctx.prisma.contentItem.update({
        where: { id: input.itemId },
        data: {
          conceptJson: input.conceptJson as object,
          conceptRevision: existing.conceptRevision + 1,
        },
      });
      return updated;
    }),

  /** Reset conceptJson back to the original LLM output and bump the revision. */
  resetConcept: publicProcedure
    .input(z.object({ itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.prisma.contentItem.findUnique({
        where: { id: input.itemId },
        select: { id: true, aiConceptJson: true, conceptRevision: true },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const updated = await ctx.prisma.contentItem.update({
        where: { id: input.itemId },
        data: {
          conceptJson: item.aiConceptJson as object,
          conceptRevision: item.conceptRevision + 1,
        },
      });
      return updated;
    }),

  /**
   * Cost estimate for a single (already-saved) item. The selection table
   * re-fetches this after every edit so price reflects, e.g., a flipped
   * audioMode → voiceover. Uses the deterministic `estimate_cost` tool (no
   * LLM, no side effects) via the canonical executeTool surface.
   */
  estimateCost: publicProcedure
    .input(z.object({ itemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const item = await ctx.prisma.contentItem.findUnique({
        where: { id: input.itemId },
        select: { type: true, conceptJson: true, projectId: true, project: { select: { slug: true } } },
      });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const { executeTool } = await import("@shri/tools");
      const { makeWebToolContext } = await import("../../tool-ctx");
      const toolCtx = makeWebToolContext({
        projectId: item.projectId,
        projectSlug: item.project.slug,
        itemId: input.itemId,
      });
      const result = (await executeTool(
        "estimate_cost",
        {
          items: [
            {
              type: item.type,
              conceptJson: item.conceptJson,
            },
          ],
        },
        toolCtx,
      )) as { usd: number; breakdowns: Array<Record<string, unknown>> };
      return { usd: result.usd, breakdown: result.breakdowns[0] ?? null };
    }),

  /**
   * Mark a batch of items SELECTED, then enqueue one item job per id. Returns
   * the job ids so the UI can navigate to /jobs.
   */
  generateSelected: publicProcedure
    .input(z.object({ itemIds: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const items = await ctx.prisma.contentItem.findMany({
        where: { id: { in: input.itemIds } },
        select: { id: true, projectId: true, type: true, project: { select: { slug: true } } },
      });
      if (items.length !== input.itemIds.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Some items missing" });
      }
      await ctx.prisma.contentItem.updateMany({
        where: { id: { in: input.itemIds } },
        data: { status: "SELECTED" },
      });
      const jobIds: string[] = [];
      for (const item of items) {
        const job = await ctx.prisma.job.create({
          data: {
            itemId: item.id,
            kind: item.type === "REEL" ? "REEL" : "CAROUSEL",
            bullJobId: "",
            status: "QUEUED",
          },
        });
        try {
          const bullJobId = await enqueueItem({
            itemId: item.id,
          });
          await ctx.prisma.job.update({
            where: { id: job.id },
            data: { bullJobId },
          });
          jobIds.push(job.id);
        } catch (err) {
          await ctx.prisma.job.update({
            where: { id: job.id },
            data: { status: "FAILED", error: (err as Error).message },
          });
        }
      }
      return { jobIds, enqueued: jobIds.length };
    }),
});
