# FriendConnect app + realtime image (deploy stack)
#
# npm, not Bun: this repository is an npm project with a committed
# `package-lock.json` and no `bun.lock`. The previous version ran
# `bun install --frozen-lockfile` against a lockfile that does not exist, so the
# image could not build (audit finding 4).
#
# Build context is the repository root (`context: ..` in docker-compose.yml).
FROM node:22-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `--ignore-scripts` is not used: better-sqlite3 and sharp both need their
# install scripts. `prisma` postinstall only downloads engines, which this image
# does need for `prisma migrate deploy`.
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` must not need a reachable database: the client is lazily created
# (src/lib/db-backend.ts). A throwaway SQLite URL satisfies Prisma's URL parsing.
ENV DATABASE_URL="file:./build-only.db"
# `src/lib/auth.ts` throws at module scope in production when no secret is set, and
# Next collects page data during the build. Same reasoning as the root Dockerfile:
# this value lives only in this stage and is never copied to the runner.
ENV NEXTAUTH_SECRET="build-only-not-a-runtime-secret-000000000000"
# The MySQL variant is what this stack deploys, so generate that client.
RUN npx prisma generate --schema prisma/schema.mysql.prisma && npm run build

# Build a separate runtime-only dependency tree. The app and realtime server use
# modules outside Next's trace (Prisma CLI/adapters, socket.io, sharp), so the
# complete `npm ci --omit=dev` tree is safer than a hand-maintained package list
# and cannot silently omit a transitive runtime module.
FROM node:22-bookworm AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund \
  && npx prisma generate --schema prisma/schema.mysql.prisma

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV SOCKET_PORT=3003
# Both processes resolve `file:`/relative paths against APP_DIR, and mkdir the
# upload directory on first use (src/lib/paths.ts).
ENV APP_DIR=/app
ENV UPLOAD_DIR=/data/upload

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r fc && useradd -r -g fc -d /app fc

# --- Next.js standalone output -------------------------------------------------
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# --- Realtime server and the CommonJS modules it requires at runtime ------------
#
# Audit finding 3: the image copied only `src/lib/db-runtime.js`, but that file
# `require`s three generated modules and `socket-server.js` requires two more.
# Next's standalone file tracer does not follow these plain `require()` calls from
# a file outside the app graph, so they must be copied explicitly. Every file here
# is required for startup; a missing one is a boot failure, not a degraded mode.
COPY --from=builder /app/socket-server.js ./socket-server.js
COPY --from=builder /app/scripts/turn-server.js ./scripts/turn-server.js
COPY --from=builder /app/scripts/load-env.cjs ./scripts/load-env.cjs
COPY --from=builder /app/src/lib/db-runtime.js ./src/lib/db-runtime.js
COPY --from=builder /app/src/lib/schema-metadata.cjs ./src/lib/schema-metadata.cjs
COPY --from=builder /app/src/lib/sqlite-ddl.cjs ./src/lib/sqlite-ddl.cjs
COPY --from=builder /app/src/lib/db-migrations.cjs ./src/lib/db-migrations.cjs
COPY --from=builder /app/src/lib/socket-security.cjs ./src/lib/socket-security.cjs
COPY --from=builder /app/src/lib/file-access.cjs ./src/lib/file-access.cjs
COPY --from=builder /app/src/lib/upload-security.cjs ./src/lib/upload-security.cjs
COPY --from=builder /app/src/lib/session-registry.cjs ./src/lib/session-registry.cjs

# --- Prisma CLI, schema and migrations (for `prisma migrate deploy`) ------------
COPY --from=builder /app/prisma ./prisma
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

RUN mkdir -p /data/upload /app/db /app/logs && chown -R fc:fc /app /data
USER fc
EXPOSE 3000 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

# Overridden with `command: ["node", "socket-server.js"]` for the socket service.
CMD ["node", "server.js"]
