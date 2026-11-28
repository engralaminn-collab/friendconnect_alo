# FriendConnect production image (Next.js standalone + socket server)
#
# This image runs two processes from one build: the Next.js app (`server.js`) and
# the realtime/call server (`socket-server.js`). Next's standalone tracer does
# not follow CommonJS files outside the app graph, so the image copies the complete
# npm production dependency tree plus the local realtime modules.
FROM node:22-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="file:./db/custom.db"
# `src/lib/auth.ts` throws at module scope when NODE_ENV=production and no secret
# is set, and Next collects page data during the build, which imports that module
# through `src/lib/session.ts`. Without this the build dies with
# "NEXTAUTH_SECRET is required in production" — a real failure found by running
# the build, not by reading the Dockerfile.
#
# This value exists only in this build stage. It is NOT copied to the runner
# stage, it is not baked into the client bundle (it is a server-only variable), and
# the runtime refuses to start if the operator does not supply a real one. It is
# intentionally a fixed string so the layer stays reproducible; it is unusable as
# a real secret because it never reaches a running container.
ENV NEXTAUTH_SECRET="build-only-not-a-runtime-secret-000000000000"
# The runtime uses the hand-rolled SQLite runtime by default, but `db-runtime.js`
# also supports the Prisma path (`@prisma/client` + the MariaDB/knex adapters), and
# the standalone build resolves `@prisma/client` at runtime for the MySQL
# deployment. The generated client lives in `node_modules/.prisma`, which only
# exists after this step — without it the runner stage's COPY fails and the MySQL
# path throws "did not initialize yet".
RUN npx prisma generate --schema prisma/schema.sqlite.prisma
RUN npm run build

# A separate production dependency tree for the runner. Next's standalone tracer
# only follows imports from the Next application graph; it cannot see the plain
# CommonJS realtime entrypoint or lazy requires such as `sharp`. A hand-picked
# COPY list failed repeatedly as transitive packages (`accepts` was the first real
# crash) were omitted. Copying the complete *production* tree is deterministic,
# uses npm's production dependency graph and cannot lose transitive dependencies.
FROM node:22-bookworm AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
  && npx prisma generate --schema prisma/schema.sqlite.prisma

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

# --- Runtime dependency tree ---------------------------------------------------
# Complete production dependencies, including every transitive dependency needed
# by `socket-server.js`, `db-runtime.js`, Prisma, sharp, and web-push. This overlays
# the smaller standalone node_modules tree without copying development packages.
COPY --from=prod-deps /app/node_modules ./node_modules

# `/data` is a named volume in the real deployment and in docker-verify.sh. A
# fresh volume mounted over a nonexistent path is root-owned; the non-root `fc`
# process then cannot create its SQLite DB or upload directory. Pre-create the
# mount point with the final uid/gid so Docker initializes the volume correctly.
RUN mkdir -p upload logs db /data/upload && chown -R fc:fc /app /data
USER fc
EXPOSE 3000 3003 3478/udp 3478/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
