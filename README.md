# CT Log

Real-time Certificate Transparency log monitor. Streams certificates from CertStream, stores them in SQLite or MongoDB, and provides a web UI with live updates and full-text search.

## Quick Start

```bash
bun install
cp .env.example .env    # optional: configure filters
bun run dev
```

Open http://localhost:3000

## Features

- Real-time CT certificate ingestion via CertStream WebSocket
- Multi-store support: SQLite (default) or MongoDB
- Full-text trigram search across domains, issuers, and subjects
- Server-Sent Events (SSE) live stream with HTMX
- Configurable domain glob filters and issuer substring filters
- Automatic deduplication by certificate fingerprint
- Configurable data retention with automatic cleanup
- Server-rendered UI with HTMX for interactive search
- Data migration between storage backends with resume support

## Configuration

See `.env.example` for all options.

| Variable | Default | Description |
|----------|---------|-------------|
| `STORE_TYPE` | `sqlite` | Storage backend: `sqlite` or `mongodb` |
| `DB_PATH` | `./data/aletheia.sqlite` | SQLite database file path |
| `DB_RETENTION_DAYS` | `90` | Auto-delete certificates older than this |
| `MONGO_URL` | `mongodb://localhost:27017` | MongoDB connection URL |
| `MONGO_DATABASE` | `aletheia` | MongoDB database name |
| `CERTSTREAM_URL` | `wss://api.certstream.dev/` | CertStream WebSocket endpoint |
| `BATCH_SIZE` | `500` | Flush buffer when this many certs accumulate |
| `BATCH_INTERVAL` | `3000` | Buffer flush interval in milliseconds |
| `PORT` | `3000` | HTTP server port |
| `HOST` | `0.0.0.0` | HTTP server bind address |
| `FILTER_DOMAINS` | _(empty = firehose)_ | Comma-separated glob patterns (e.g. `*.google.com,*bank*`) |
| `FILTER_ISSUERS` | _(empty)_ | Comma-separated issuer org substrings |
| `LOG_LEVEL` | `info` | Log level: trace, debug, info, warning, error, fatal |

## Architecture

Single Bun process with three logical components:

```
CertStream WebSocket
        |
  CertStreamClient  -->  CertFilter  -->  BatchBuffer
        |                                       |
   (parse + filter)                        BatchWriter
                                                |
                                       CertificateRepository
                                          /           \
                                   SQLite+FTS5     MongoDB
```

- **Ingestor**: CertStream WebSocket client parses, filters, and buffers incoming certificates
- **Batch Writer**: Flushes buffer on interval/size threshold, writes to database, emits SSE events
- **Web Server**: Hono app serving REST API + server-rendered HTMX UI with live SSE stream

All database access goes through the `CertificateRepository` interface, making the storage backend swappable.

## Multi-Store

Switch between SQLite and MongoDB by setting `STORE_TYPE`:

```bash
# SQLite (default) - zero-config, FTS5 trigram search
STORE_TYPE=sqlite

# MongoDB - horizontal scaling, text index search
STORE_TYPE=mongodb
MONGO_URL=mongodb://localhost:27017
MONGO_DATABASE=aletheia
```

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
| `GET /api/cert/:id` | Certificate details |
| `GET /api/stats` | Database stats + ingestion metrics |
| `GET /health` | Health check |
| `GET /events/live-stream` | SSE stream of new certificates |

## Development

```bash
bun run dev       # Start with watch mode
bun run start     # Production start
bun run check     # TypeScript type-check
bun test          # Run tests
```
