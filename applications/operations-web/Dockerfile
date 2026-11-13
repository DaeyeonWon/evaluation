# syntax=docker/dockerfile:1
#
# AIPO operations console — production image (Next.js standalone output).
#
#   docker build -t aipo-ops-web .
#   docker build -t aipo-ops-web --build-arg OPERATIONS_API_URL=https://ops-api.internal/api/v1 .   # proxy mode
#   docker run --rm -p 8080:8080 -e CONSOLE_SESSION_SECRET=$(openssl rand -hex 32) aipo-ops-web
#
# OPERATIONS_API_URL is baked in at BUILD time (next.config.ts rewrite). Everything else
# (CONSOLE_AUTH_MODE, IAP_AUDIENCE, CONSOLE_ADMINS, HERMES_DASHBOARD_URL, …) is read at RUNTIME.
# See .env.example and docs/auth.md.

ARG NODE_VERSION=22-alpine

# ── deps: install exactly the lockfile ───────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── build ────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ARG OPERATIONS_API_URL=""
ENV OPERATIONS_API_URL=${OPERATIONS_API_URL} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next/font/google fetches IBM Plex Mono at build time (network required); SUIT is bundled from node_modules.
RUN mkdir -p public && npm run build

# ── runtime: standalone server only, non-root ────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
