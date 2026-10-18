# FriendConnect production image (Next.js standalone + socket server)
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
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r fc && useradd -r -g fc fc
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/socket-server.js ./socket-server.js
COPY --from=builder /app/scripts/turn-server.js ./scripts/turn-server.js
COPY --from=builder /app/src/lib/db-runtime.js ./src/lib/db-runtime.js
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/socket.io ./node_modules/socket.io
COPY --from=builder /app/node_modules/socket.io-adapter ./node_modules/socket.io-adapter
COPY --from=builder /app/node_modules/socket.io-parser ./node_modules/socket.io-parser
COPY --from=builder /app/node_modules/engine.io ./node_modules/engine.io
COPY --from=builder /app/node_modules/@socket.io ./node_modules/@socket.io
COPY --from=builder /app/node_modules/node-turn ./node_modules/node-turn
COPY --from=builder /app/node_modules/crc ./node_modules/crc
COPY --from=builder /app/node_modules/js-yaml ./node_modules/js-yaml
COPY --from=builder /app/node_modules/log4js ./node_modules/log4js
COPY --from=builder /app/node_modules/ioredis ./node_modules/ioredis
COPY --from=builder /app/node_modules/web-push ./node_modules/web-push
RUN mkdir -p upload logs db && chown -R fc:fc /app
USER fc
EXPOSE 3000 3003 3478/udp 3478/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
