# Argus runs under Bun at runtime — required for the bun:sqlite driver.
# Single stage: avoids slow cross-stage node_modules copies (buildkit deadlines).
FROM oven/bun:1.3-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV ARGUS_DB_PATH=/app/data/argus.db
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies first (cached unless manifests change).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source + build. We run `next start` under Bun (not standalone) because the
# SQLite driver is loaded via createRequire and isn't captured by Next tracing.
COPY . .
RUN bun run build

RUN mkdir -p /app/data
EXPOSE 8100

# Apply migrations + seed default templates, then serve.
CMD ["sh", "-c", "bun run db:migrate && bun run db:seed && bun run start"]
