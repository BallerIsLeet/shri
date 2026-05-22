import { PrismaClient } from "@prisma/client";

// Singleton: re-using one PrismaClient across hot-reloads in dev avoids exhausting
// Postgres connection pool. Next.js + tsx both honor this pattern.
declare global {
  var __shri_prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__shri_prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__shri_prisma = prisma;
}

export * from "@prisma/client";
