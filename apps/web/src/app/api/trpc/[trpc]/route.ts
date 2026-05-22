import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/routers/_app";
import { createContext } from "@/server/trpc/init";

// tRPC v11 over Next.js App Router. The handler uses fetch-style req/res.

const handler = async (req: Request): Promise<Response> =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () =>
      createContext({
        user: req.headers.get("x-shri-user") ?? undefined,
      }),
    onError({ error, path }) {
      console.error(`tRPC error on ${path ?? "<no-path>"}:`, error);
    },
  });

export { handler as GET, handler as POST };

// Force Node runtime — tRPC procedures use Prisma + the AWS SDK + bullmq,
// none of which run on the edge.
export const runtime = "nodejs";
