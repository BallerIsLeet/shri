# syntax=docker/dockerfile:1
# Build context: repo root

# ── Stage 1: install all workspace deps ───────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json          apps/web/
COPY apps/worker/package.json       apps/worker/
COPY apps/mcp/package.json          apps/mcp/
COPY packages/ai/package.json       packages/ai/
COPY packages/db/package.json       packages/db/
COPY packages/orchestrator/package.json packages/orchestrator/
COPY packages/prompts-fs/package.json   packages/prompts-fs/
COPY packages/seedance/package.json packages/seedance/
COPY packages/storage/package.json  packages/storage/
COPY packages/tools/package.json    packages/tools/
COPY packages/db/prisma             packages/db/prisma

RUN pnpm install --frozen-lockfile

# ── Stage 2: production runtime ───────────────────────────────────────────────
# Worker runs TypeScript directly via tsx — no compile step needed.
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production

# pnpm virtual store + all hoisted node_modules (includes tsx, bullmq, etc.)
COPY --from=deps /app/node_modules             ./node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules

# All TypeScript source (packages are imported as TS via workspace symlinks)
COPY packages ./packages
COPY apps/worker ./apps/worker

# Workspace metadata so pnpm can resolve the graph at runtime
COPY package.json pnpm-workspace.yaml ./

# Regenerate Prisma client for this OS/arch
RUN packages/db/node_modules/.bin/prisma generate --schema=packages/db/prisma/schema.prisma

CMD ["node_modules/.bin/tsx", "apps/worker/src/index.ts"]
