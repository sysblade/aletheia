# Aletheia

![logo](static/logo.png)

Real-time Certificate Transparency log monitor. Streams certificates from CertStream, stores them with full-text search, and provides a web UI with live updates and search.

## Quick Start

```bash
bun install
cp .env.example .env    # optional: configure filters
bun run dev
```

Open http://localhost:3000

## Features

- Real-time CT certificate ingestion via CertStream WebSocket
- Multi-store support: SQLite (default), MongoDB, or ClickHouse
- Full-text trigram search across domains, issuers, and subjects
- Advanced search syntax: `domain:`, `issuer:`, `cn:`, negation with `-`
- Server-Sent Events (SSE) live stream with HTMX
- Configurable domain glob filters and issuer substring filters
- Automatic deduplication by certificate fingerprint
- Configurable data retention with automatic cleanup
- Hourly and daily aggregated statistics with cron scheduling
- Server-rendered UI with HTMX for interactive search
- Data migration between storage backends with resume support
- Self-contained binary compilation

## Configuration

See `.env.example` for all options.

| Variable | Default | Description |
|----------|---------|-------------|
| `STORE_TYPE` | `sqlite` | Storage backend: `sqlite`, `mongodb`, or `clickhouse` |
| `DB_PATH` | `./data/aletheia.sqlite` | SQLite database file path |
| `DB_RETENTION_DAYS` | `90` | Auto-delete certificates older than this |
| `DB_MAINTENANCE_INTERVAL_HOURS` | `6` | How often to run DB maintenance |
| `MONGO_URL` | `mongodb://localhost:27017` | MongoDB connection URL |
| `MONGO_DATABASE` | `aletheia` | MongoDB database name |
| `MONGO_MAX_POOL_SIZE` | `10` | MongoDB connection pool size |
| `CLICKHOUSE_URL` | `http://localhost:8123` | ClickHouse HTTP endpoint |
| `CLICKHOUSE_DATABASE` | `aletheia` | ClickHouse database name |
| `CLICKHOUSE_REQUEST_TIMEOUT_MS` | `30000` | Timeout for regular queries (ms) |
| `CLICKHOUSE_MAINTENANCE_TIMEOUT_MS` | `600000` | Timeout for `OPTIMIZE TABLE` and other long maintenance ops (ms) |
| `CERTSTREAM_URL` | `wss://api.certstream.dev/` | CertStream WebSocket endpoint |
| `BATCH_SIZE` | `500` | Flush buffer when this many certs accumulate |
| `BATCH_INTERVAL` | `3000` | Buffer flush interval in milliseconds |
| `BATCH_MAX_QUEUE_SIZE` | `50` | Max queued batches before backpressure |
| `PORT` | `3000` | HTTP server port |
| `HOST` | `0.0.0.0` | HTTP server bind address |
| `FILTER_DOMAINS` | _(empty = firehose)_ | Comma-separated glob patterns (e.g. `*.google.com,*bank*`) |
| `FILTER_ISSUERS` | _(empty)_ | Comma-separated issuer org substrings |
| `STATS_ENABLED` | `true` | Enable hourly/daily stats computation |
| `STATS_HOURLY_SCHEDULE` | `5 * * * *` | Cron expression for hourly stats |
| `STATS_DAILY_SCHEDULE` | `5 0 * * *` | Cron expression for daily stats |
| `LOG_LEVEL` | `info` | Log level: trace, debug, info, warning, error, fatal |

## Architecture

Single Bun process with three logical components. The ingest worker runs as a separate thread (dev) or subprocess (compiled):

```
CertStream WebSocket
        |
  CertStreamClient --> CertFilter --> BatchBuffer
                                           |
                                      BatchWriter
                                           |
                                 CertificateRepository
                                    /       |       \
                             SQLite+FTS5  MongoDB  ClickHouse
```

- **Ingestor** (worker): CertStream WebSocket client parses, filters, and buffers incoming certificates
- **Batch Writer**: Flushes buffer on interval/size threshold, writes to database, emits SSE events
- **Web Server**: Hono app serving REST API + server-rendered HTMX UI with live SSE stream

All database access goes through the `CertificateRepository` interface (`src/db/repository.ts`), making the storage backend swappable.

## Multi-Store

Switch between backends by setting `STORE_TYPE`:

```bash
# SQLite (default) - zero-config, FTS5 trigram search
STORE_TYPE=sqlite

# MongoDB - horizontal scaling, text index search
STORE_TYPE=mongodb
MONGO_URL=mongodb://localhost:27017

# ClickHouse - columnar analytics
STORE_TYPE=clickhouse
CLICKHOUSE_URL=http://localhost:8123
```

## Search Syntax

| Syntax | Example | Description |
|--------|---------|-------------|
| Free text | `google` | Search across domains, issuer, CN |
| `domain:` | `domain:*.google.com` | Filter by domain |
| `issuer:` | `issuer:Let's Encrypt` | Filter by issuer substring |
| `cn:` | `cn:myserver` | Filter by subject common name |
| `-` prefix | `-domain:example.com` | Negate any filter |

## Migration

Migrate data between storage backends:

```bash
bun run src/index.ts migrate --source sqlite --target mongodb [--batch-size 1000]
```

Migration is resumable: progress is saved to `./data/.migrate-cursor` and automatically resumed if interrupted.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=<query>&page=1&limit=50` | Search certificates |
| `GET /api/cert/:fingerprint` | Certificate details by SHA1 fingerprint |
| `GET /api/stats` | Database stats + ingestion metrics |
| `GET /health` | Health check with uptime |
| `GET /events/live-stream` | SSE stream of new certificates |

## CLI Commands

```bash
bun run src/index.ts serve              # Start server (default)
bun run src/index.ts migrate --source sqlite --target mongodb
bun run src/index.ts stats [--backfill] # Compute statistics
bun run src/index.ts worker             # Ingest worker (internal)
bun run src/index.ts maintenance        # DB maintenance (internal)
```

## Development

```bash
bun run dev       # Start with watch mode
bun run start     # Production start
bun run check     # TypeScript type-check
bun test          # Run tests
bun compile       # Build self-contained binary to out/aletheia
```
