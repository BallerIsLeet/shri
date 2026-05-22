import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { signedPutUrl, signedReadUrl, keys, getObject } from "@shri/storage";
import { router, publicProcedure } from "../init";

// asset router — presigned PUT URLs for direct browser → R2 uploads, plus a
// confirm step that records the Asset row after the upload completes.
// See docs/09-web-app.md "Asset upload flow".

const ALLOWED_KINDS = ["ICON", "SCREENSHOT", "SCREEN_RECORDING", "LOGO", "REFERENCE"] as const;

function extFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "bin";
  return filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function randomId(): string {
  // Cheap urlsafe-ish id (no extra dep). Used for asset filenames in R2 only.
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const assetRouter = router({
  presignUpload: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        filename: z.string().min(1),
        mimeType: z.string().min(1),
        kind: z.enum(ALLOWED_KINDS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // CLAUDE.md #2: keys ONLY come from @shri/storage.keys.* helpers.
      const ext = extFromFilename(input.filename);
      const id = randomId();
      const r2Key = keys.asset(project.slug, id, ext);

      // 5-minute presigned PUT — long enough for a multi-MB upload, short
      // enough that a leaked URL goes stale fast.
      const uploadUrl = await signedPutUrl(r2Key, input.mimeType, 300);
      return {
        uploadUrl,
        r2Key,
        kind: input.kind,
        mimeType: input.mimeType,
      };
    }),

  confirm: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        r2Key: z.string(),
        kind: z.enum(ALLOWED_KINDS),
        mimeType: z.string(),
        caption: z.string().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        durationS: z.number().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // Verify the upload actually landed by trying to fetch a byte. R2 doesn't
      // expose a cheap HEAD via the existing storage helpers, so reuse
      // getObject — we discard the buffer. If the upload didn't land, the
      // SDK call throws and we never write the DB row.
      try {
        await getObject(input.r2Key);
      } catch (err) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Upload not found in R2 at ${input.r2Key}: ${(err as Error).message}`,
        });
      }

      const asset = await ctx.prisma.asset.create({
        data: {
          projectId: project.id,
          kind: input.kind,
          r2Key: input.r2Key,
          mimeType: input.mimeType,
          width: input.width ?? null,
          height: input.height ?? null,
          durationS: input.durationS ?? null,
          caption: input.caption ?? null,
        },
      });
      const url = await signedReadUrl(input.r2Key).catch(() => null);
      return { ...asset, url };
    }),

  listForProject: publicProcedure
    .input(z.object({ projectSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const rows = await ctx.prisma.asset.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "asc" },
      });
      return Promise.all(
        rows.map(async (a) => ({
          ...a,
          url: await signedReadUrl(a.r2Key).catch(() => null),
        })),
      );
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.asset.delete({ where: { id: input.id } });
      return { ok: true as const };
    }),
});
