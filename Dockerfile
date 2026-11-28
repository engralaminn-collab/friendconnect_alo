# FriendConnect production image (Next.js standalone + socket server)
#
# This image runs two processes from one build: the Next.js app (`server.js`) and
# the realtime/call server (`socket-server.js`). Keep the runtime COPY list below
# in sync with the `require()` calls in `socket-server.js` and
# `scripts/turn-server.js` — Next's standalone file tracer does not follow plain
# CommonJS requires made from files outside the app graph.
FROM node:22-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="file:./db/custom.db"
RUN npm ci
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV SOCKET_PORT=3003
ENV DATABASE_URL="file:./db/custom.db"
ENV APP_DIR=/app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r fc && useradd -r -g fc fc

# --- Next.js standalone output ---
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# --- Realtime server ---
COPY --from=builder /app/socket-server.js ./socket-server.js
COPY --from=builder /app/scripts/turn-server.js ./scripts/turn-server.js

# --- CommonJS modules the realtime server requires at runtime ------------------
#
# Audit findings 2 and 3:
#   * `node_modules/node-turn` was copied but is not a dependency of this project
#     (`grep node-turn package.json` is empty), so the build failed at that layer
#     with "not found". `scripts/turn-server.js` already degrades gracefully when
#     the module is absent, and production TURN is coturn (see deploy/), so the
#     line is gone rather than adding an unused native dependency.
#   * the `src/lib/*.cjs` and `src/lib/db-runtime.js` modules were missing
#     entirely, so the container started `server.js` fine and then crashed the
#     moment `socket-server.js` was started.
COPY --from=builder /app/src/lib/db-runtime.js ./src/lib/db-runtime.js
COPY --from=builder /app/src/lib/schema-metadata.cjs ./src/lib/schema-metadata.cjs
COPY --from=builder /app/src/lib/sqlite-ddl.cjs ./src/lib/sqlite-ddl.cjs
COPY --from=builder /app/src/lib/db-migrations.cjs ./src/lib/db-migrations.cjs
COPY --from=builder /app/src/lib/socket-security.cjs ./src/lib/socket-security.cjs
COPY --from=builder /app/src/lib/file-access.cjs ./src/lib/file-access.cjs
COPY --from=builder /app/src/lib/upload-security.cjs ./src/lib/upload-security.cjs
COPY --from=builder /app/src/lib/session-registry.cjs ./src/lib/session-registry.cjs
COPY --from=builder /app/scripts/load-env.cjs ./scripts/load-env.cjs

# --- Packages the standalone tracer cannot see ---------------------------------
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=builder /app/node_modules/socket.io ./node_modules/socket.io
COPY --from=builder /app/node_modules/socket.io-adapter ./node_modules/socket.io-adapter
COPY --from=builder /app/node_modules/socket.io-parser ./node_modules/socket.io-parser
COPY --from=builder /app/node_modules/engine.io ./node_modules/engine.io
COPY --from=builder /app/node_modules/engine.io-parser ./node_modules/engine.io-parser
COPY --from=builder /app/node_modules/@socket.io ./node_modules/@socket.io
COPY --from=builder /app/node_modules/cookie ./node_modules/cookie
COPY --from=builder /app/node_modules/cors ./node_modules/cors
COPY --from=builder /app/node_modules/ioredis ./node_modules/ioredis
COPY --from=builder /app/node_modules/web-push ./node_modules/web-push

RUN mkdir -p upload logs db && chown -R fc:fc /app
USER fc
EXPOSE 3000 3003 3478/udp 3478/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
