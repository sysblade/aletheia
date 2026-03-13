# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1.3.3 AS builder

WORKDIR /app

# Install dependencies first (cache-friendly layer)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and compile to a self-contained binary
COPY . .

# GIT_COMMIT is passed at build time (e.g. --build-arg GIT_COMMIT=$(git rev-parse --short HEAD))
ARG GIT_COMMIT=dev

RUN bun build src/index.ts \
    --compile \
    --bytecode \
    --sourcemap \
    --minify \
    --target=bun-linux-x64 \
    --define "GIT_COMMIT=\"${GIT_COMMIT}\"" \
    --outfile out/aletheia

# ── Production stage ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runner

# ca-certificates is needed for outbound TLS (CertStream WebSocket, MongoDB, etc.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -r -u 1001 -g root -d /app -s /sbin/nologin aletheia

WORKDIR /app

COPY --from=builder --chown=aletheia:root /app/out/aletheia ./aletheia

# Persistent data directory (SQLite DB lives here by default)
RUN mkdir -p data && chown aletheia:root data

USER aletheia

# ── Defaults ──────────────────────────────────────────────────────────────────
ENV STORE_TYPE=sqlite \
    DB_PATH=/app/data/aletheia.sqlite \
    HOST=0.0.0.0 \
    PORT=3000 \
    LOG_LEVEL=info

EXPOSE 3000

VOLUME ["/app/data"]

ENTRYPOINT ["./aletheia"]
CMD ["serve"]
