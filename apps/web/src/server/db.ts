// Re-export the canonical Prisma singleton from @shri/db so tRPC procedures
// (and any other server code under apps/web) import from a single place.
export { prisma } from "@shri/db";
