# ---------------------------------------------------------------------------
# One multi-stage Dockerfile producing ONE application image used by three
# services: migrate, web and worker.
#
#   migrate -> sh scripts/migrate.sh   (one-shot; waits for db, deploys, seeds)
#   web     -> npx next start          (the only publicly exposed service)
#   worker  -> npm run worker          (BullMQ consumer; no HTTP server)
#
# A single coherent production node_modules is used at runtime rather than the
# Next.js standalone bundle, because all three services must resolve the same
# dependency tree (prisma CLI + tsx for migrate/worker, next for web).
# ---------------------------------------------------------------------------

# --- Stage 1: all dependencies (needed to generate the client and build) -----
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- Stage 2: build the web application -------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate
RUN npm run build

# --- Stage 3: production dependencies only ----------------------------------
FROM node:22-bookworm-slim AS prod-deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY prisma ./prisma
# prisma is a production dependency because the migrate service needs the CLI.
RUN npx prisma generate

# --- Stage 4: runtime image --------------------------------------------------
FROM node:22-bookworm-slim AS runner
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    SHARED_STORAGE_ROOT=/app/data/shared

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/lib ./lib
COPY --from=build /app/worker ./worker
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/types ./types

# Shared audio/output volume mount point (ai-notetaker-shared).
RUN mkdir -p /app/data/shared/audio /app/data/shared/output \
 && chown -R node:node /app

USER node
EXPOSE 3000

# tini reaps zombies for the long-running web and worker processes.
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command is the web server; compose overrides it for migrate/worker.
CMD ["npx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
