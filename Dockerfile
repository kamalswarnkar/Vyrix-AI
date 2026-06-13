# ─── Stage 1: install deps (build tools for native addons) ───
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ─── Stage 2: build Next.js ───────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─── Stage 3: production runner ───────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# curl for healthcheck; libgomp1 required by FAISS at runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl libgomp1 \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/data/uploads /app/data/faiss /app/data/workspace \
  && chown -R nextjs:nodejs /app

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/src/server/db/sqlite/schema.sql ./src/server/db/sqlite/schema.sql

# Next.js file tracing misses dynamically-imported native addons.
# Copy them explicitly so they land in the standalone node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/faiss-node ./node_modules/faiss-node
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/mammoth ./node_modules/mammoth
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/pdf-parse ./node_modules/pdf-parse

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
