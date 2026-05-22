import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { prisma } from "../db";

// tRPC v11 init. Single context = the Prisma client + (optional) basic-auth
// user. We don't carry per-request request/response — App Router handles those
// inside the route adapter.

export type Context = {
  prisma: typeof prisma;
  /** Resolved basic-auth user (always present in middleware-gated paths). */
  user: string | null;
};

export async function createContext(opts?: { user?: string }): Promise<Context> {
  return {
    prisma,
    user: opts?.user ?? null,
  };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;
