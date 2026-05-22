"use client";

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/trpc/routers/_app";

// Browser-side typed tRPC client (React hooks).
export const trpc = createTRPCReact<AppRouter>();
