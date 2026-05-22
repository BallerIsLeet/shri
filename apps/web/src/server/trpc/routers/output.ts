import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { signedReadUrl } from "@shri/storage";
import { router, publicProcedure } from "../init";

// output router — list outputs for a content item, signed download URL.

export const outputRouter = router({
  listByItem: publicProcedure
    .input(z.object({ itemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.contentOutput.findMany({
        where: { itemId: input.itemId },
        orderBy: { createdAt: "desc" },
      });
      return Promise.all(
        rows.map(async (o) => ({
          ...o,
          url: await signedReadUrl(o.r2Key).catch(() => null),
          thumbUrl: o.thumbR2Key
            ? await signedReadUrl(o.thumbR2Key).catch(() => null)
            : null,
        })),
      );
    }),

  download: publicProcedure
    .input(z.object({ outputId: z.string(), ttlSec: z.number().int().min(60).max(86400).default(900) }))
    .query(async ({ ctx, input }) => {
      const o = await ctx.prisma.contentOutput.findUnique({
        where: { id: input.outputId },
        select: { r2Key: true },
      });
      if (!o) throw new TRPCError({ code: "NOT_FOUND" });
      const url = await signedReadUrl(o.r2Key, input.ttlSec);
      return { url };
    }),
});
