# Aletheia - Certificate Transparency Monitor

## Quick Reference

- **Runtime**: Bun (use `bun` not `node`)
- **Framework**: Hono (JSX server-rendered) + HTMX
- **Database**: SQLite via Kysely + FTS5 trigram search (also MongoDB, ClickHouse)
- **Entry point**: `src/index.ts`

## Commands

- `bun run dev` — Start with watch mode
- `bun run start` — Production start
- `bun run check` — TypeScript type-check
- `bun test` — Run tests
- `bun compile` — Build self-contained binary to `out/aletheia`

## Architecture

Single Bun process, three logical components. Ingest worker runs as a Worker thread (dev) or subprocess (compiled binary), with auto-restart on crash using exponential backoff.

1. **Ingestor** (worker): CertStream WebSocket → parse → filter → batch buffer → database
2. **Batch Writer**: Flushes buffer on interval (3s) or size (500 certs) threshold
3. **Web Server**: Hono app serving API + server-rendered UI with SSE live stream

All DB access through `CertificateRepository` interface (`src/db/repository.ts`). Three implementations: `SqliteRepository`, `MongoRepository`, `ClickHouseRepository` — selected via `STORE_TYPE` env var.

## CLI Commands

Defined in `src/index.ts` via Commander, implemented in `src/cli/`:

- `serve` (default) — Start server + spawn worker
- `migrate --source <backend> --target <backend>` — Migrate data between backends
- `stats [--backfill]` — Compute hourly/daily aggregated statistics
- `worker` — Ingest worker (internal, spawned by serve)
- `maintenance` — DB vacuum/analyze (internal, spawned by serve)

## Conventions

- TSX files for anything containing JSX; `.ts` for pure logic
- `kysely` for type-safe SQL — no raw strings except FTS5 queries
- Configuration via environment variables (see `.env.example`)
- Structured logging via [LogTape](https://logtape.org/) — `getLogger(["aletheia", "component"])` from `src/utils/logger.ts`
  - Messages must be fixed strings with `{placeholder}` syntax, dynamic data as properties: `log.info("Wrote {count} rows", { count })`
  - Log level configurable via `LOG_LEVEL` env var (trace/debug/info/warning/error/fatal, default: info)
  - All loggers use hierarchical `["aletheia", ...]` categories
  - `configureLogging()` must be called once at startup before any logging
