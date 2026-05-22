# syntax=docker/dockerfile:1
# Build context: repo root (Railway uses the full repo even when source = apps/web)

# ── Stage 1: install all workspace deps ───────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# Copy only package manifests first (maximises layer cache)
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
# Prisma schema needed so @prisma/client postinstall can generate the client
COPY packages/db/prisma             packages/db/prisma

RUN pnpm install --frozen-lockfile

# ── Stage 2: build Next.js ────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY --from=deps /app/node_modules              ./node_modules
# pnpm scopes package-local binaries into each workspace package's own node_modules.
# Copy the ones we need: prisma (devDep of @shri/db) and next (dep of @shri/web).
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/apps/web/node_modules    ./apps/web/node_modules
COPY . .

# Regenerate Prisma client for this OS/arch in case postinstall didn't run
RUN packages/db/node_modules/.bin/prisma generate --schema=packages/db/prisma/schema.prisma

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @shri/web build

# ── Stage 3: minimal production image ────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# standalone output is self-contained — no pnpm, no node_modules copy needed.
# outputFileTracingRoot=repo-root means standalone lands at apps/web/.next/standalone/
# with the structure: apps/web/server.js + node_modules/ at root.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static     ./apps/web/.next/static
COPY --from=builder /app/apps/web/public           ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
