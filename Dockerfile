# Argus runs under Bun at runtime — required for the bun:sqlite driver.
FROM oven/bun:1.1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM oven/bun:1.1 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV ARGUS_DB_PATH=/app/data/argus.db

# Full node_modules + build output. We run `next start` (not standalone) because
# the SQLite driver is loaded via createRequire and isn't captured by Next's
# standalone dependency tracing.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs

RUN mkdir -p /app/data
EXPOSE 3000

# Apply migrations, then serve. Fails fast if ARGUS_MASTER_KEY is malformed.
CMD ["sh", "-c", "bun run db:migrate && bun run start"]
