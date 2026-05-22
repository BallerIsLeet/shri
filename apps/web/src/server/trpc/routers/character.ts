import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { executeTool } from "@shri/tools";
import { signedReadUrl, keys } from "@shri/storage";
import { router, publicProcedure } from "../init";
import { makeWebToolContext } from "../../tool-ctx";

// character router — list / create / update / chat / generation triggers.
// See docs/14-characters.md and docs/09-web-app.md.

const chatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const upsertCharacterSchema = z.object({
  name: z.string().min(1).max(120),
  species: z.string().nullable().optional(),
  age: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  visualStyle: z.string().nullable().optional(),
  description: z.string().min(1),
  basisMode: z.enum(["FORM", "CHAT"]).default("FORM"),
});

async function presignedSheetUrl(sheetR2Key: string | null | undefined): Promise<string | null> {
  if (!sheetR2Key) return null;
  try {
    return await signedReadUrl(sheetR2Key);
  } catch {
    return null;
  }
}

export const characterRouter = router({
  listForProject: publicProcedure
    .input(z.object({ projectSlug: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const characters = await ctx.prisma.character.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "asc" },
      });
      return Promise.all(
        characters.map(async (c) => ({
          id: c.id,
          name: c.name,
          species: c.species,
          age: c.age,
          gender: c.gender,
          visualStyle: c.visualStyle,
          description: c.description,
          basisMode: c.basisMode,
          status: c.status,
          baseR2Key: c.baseR2Key,
          sheetR2Key: c.sheetR2Key,
          sheetUrl: await presignedSheetUrl(c.sheetR2Key),
          createdAt: c.createdAt,
        })),
      );
    }),

  listForItem: publicProcedure
    .input(z.object({ itemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.contentItemCharacter.findMany({
        where: { contentItemId: input.itemId },
        include: { character: true },
      });
      return Promise.all(
        rows.map(async (r) => ({
          role: r.role,
          character: {
            id: r.character.id,
            name: r.character.name,
            description: r.character.description,
            sheetR2Key: r.character.sheetR2Key,
            sheetUrl: await presignedSheetUrl(r.character.sheetR2Key),
          },
        })),
      );
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.character.findUnique({
        where: { id: input.id },
        include: { views: { orderBy: { order: "asc" } } },
      });
      if (!c) throw new TRPCError({ code: "NOT_FOUND" });
      const sheetUrl = await presignedSheetUrl(c.sheetR2Key);
      const viewsWithUrls = await Promise.all(
        c.views.map(async (v) => ({
          ...v,
          url: await signedReadUrl(v.r2Key).catch(() => null),
        })),
      );
      const baseUrl = c.baseR2Key
        ? await signedReadUrl(c.baseR2Key).catch(() => null)
        : null;
      return { ...c, sheetUrl, baseUrl, views: viewsWithUrls };
    }),

  create: publicProcedure
    .input(
      upsertCharacterSchema.extend({
        projectSlug: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const created = await ctx.prisma.character.create({
        data: {
          projectId: project.id,
          name: input.name,
          species: input.species ?? null,
          age: input.age ?? null,
          gender: input.gender ?? null,
          visualStyle: input.visualStyle ?? null,
          description: input.description,
          basisMode: input.basisMode,
        },
      });
      return created;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        patch: upsertCharacterSchema.partial(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.prisma.character.update({
        where: { id: input.id },
        data: {
          ...(input.patch.name !== undefined ? { name: input.patch.name } : {}),
          ...(input.patch.species !== undefined ? { species: input.patch.species } : {}),
          ...(input.patch.age !== undefined ? { age: input.patch.age } : {}),
          ...(input.patch.gender !== undefined ? { gender: input.patch.gender } : {}),
          ...(input.patch.visualStyle !== undefined
            ? { visualStyle: input.patch.visualStyle }
            : {}),
          ...(input.patch.description !== undefined
            ? { description: input.patch.description }
            : {}),
        },
      });
      return updated;
    }),

  chat: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        characterId: z.string(),
        message: z.string().min(1),
        priorTurns: z.array(chatTurnSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const character = await ctx.prisma.character.findUnique({
        where: { id: input.characterId },
        select: { id: true, projectId: true },
      });
      if (!character) throw new TRPCError({ code: "NOT_FOUND" });
      const project = await ctx.prisma.project.findUnique({
        where: { id: character.projectId },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const toolCtx = makeWebToolContext({
        projectId: project.id,
        projectSlug: project.slug,
      });
      const result = await executeTool(
        "chat_design_character",
        {
          characterId: input.characterId,
          message: input.message,
          ...(input.priorTurns ? { priorTurns: input.priorTurns } : {}),
        },
        toolCtx,
      );
      return result;
    }),

  generateSheet: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        characterId: z.string(),
        poses: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const character = await ctx.prisma.character.findUnique({
        where: { id: input.characterId },
      });
      if (!character) throw new TRPCError({ code: "NOT_FOUND" });
      const toolCtx = makeWebToolContext({
        projectId: project.id,
        projectSlug: project.slug,
      });
      // 1. base (idempotent — if it already exists, the tool returns same key).
      const base = (await executeTool(
        "generate_character_base",
        { projectSlug: project.slug, characterId: input.characterId },
        toolCtx,
      )) as { r2Key: string };
      // 2. views fan-out (parallel inside the tool).
      const views = (await executeTool(
        "generate_character_views",
        {
          projectSlug: project.slug,
          characterId: input.characterId,
          baseR2Key: base.r2Key,
          ...(input.poses ? { poses: input.poses } : {}),
        },
        toolCtx,
      )) as { views: Array<{ pose: string; r2Key: string }> };
      // 3. merge into sheet.
      const sheet = await executeTool(
        "merge_character_sheet",
        {
          characterId: input.characterId,
          views: views.views.map((v, i) => ({ ...v, order: i })),
        },
        toolCtx,
      );
      return { base, views, sheet };
    }),

  regenerateBase: publicProcedure
    .input(z.object({ projectSlug: z.string(), characterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const toolCtx = makeWebToolContext({ projectId: project.id, projectSlug: project.slug });
      return executeTool(
        "generate_character_base",
        { projectSlug: project.slug, characterId: input.characterId },
        toolCtx,
      );
    }),

  regenerateViews: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        characterId: z.string(),
        poses: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const character = await ctx.prisma.character.findUnique({
        where: { id: input.characterId },
        select: { baseR2Key: true },
      });
      if (!character?.baseR2Key) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Character base must be generated before views.",
        });
      }
      const toolCtx = makeWebToolContext({ projectId: project.id, projectSlug: project.slug });
      return executeTool(
        "generate_character_views",
        {
          projectSlug: project.slug,
          characterId: input.characterId,
          baseR2Key: character.baseR2Key,
          ...(input.poses ? { poses: input.poses } : {}),
        },
        toolCtx,
      );
    }),

  regenerateSheet: publicProcedure
    .input(z.object({ projectSlug: z.string(), characterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const views = await ctx.prisma.characterView.findMany({
        where: { characterId: input.characterId },
        orderBy: { order: "asc" },
      });
      const toolCtx = makeWebToolContext({ projectId: project.id, projectSlug: project.slug });
      return executeTool(
        "merge_character_sheet",
        {
          characterId: input.characterId,
          views: views.map((v) => ({ pose: v.pose, r2Key: v.r2Key, order: v.order })),
        },
        toolCtx,
      );
    }),

  regeneratePose: publicProcedure
    .input(
      z.object({
        projectSlug: z.string(),
        characterId: z.string(),
        pose: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
        select: { id: true, slug: true },
      });
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const character = await ctx.prisma.character.findUnique({
        where: { id: input.characterId },
        select: { baseR2Key: true },
      });
      if (!character?.baseR2Key) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Character base must exist before regenerating a pose.",
        });
      }
      const toolCtx = makeWebToolContext({ projectId: project.id, projectSlug: project.slug });
      return executeTool(
        "generate_character_views",
        {
          projectSlug: project.slug,
          characterId: input.characterId,
          baseR2Key: character.baseR2Key,
          poses: [input.pose],
        },
        toolCtx,
      );
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.character.delete({ where: { id: input.id } });
      return { ok: true as const };
    }),

  // For the chat history sidebar; doesn't need its own tool.
  history: publicProcedure
    .input(z.object({ characterId: z.string() }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.character.findUnique({
        where: { id: input.characterId },
        select: { chatJson: true },
      });
      if (!c) throw new TRPCError({ code: "NOT_FOUND" });
      return Array.isArray(c.chatJson) ? c.chatJson : [];
    }),

  // Exposed so the UI can build asset paths if needed (rarely used; the
  // canonical key still comes from keys.characterSheet).
  sheetKey: publicProcedure
    .input(z.object({ projectSlug: z.string(), characterId: z.string() }))
    .query(async ({ input }) => keys.characterSheet(input.projectSlug, input.characterId)),
});
