# CT Log

Real-time Certificate Transparency log monitor. Streams certificates from CertStream, stores them in SQLite with FTS5 trigram search, and provides a web UI for domain/issuer search.

## Quick Start

```bash
bun install
cp .env.example .env    # optional: configure filters
bun run dev
```

Open http://localhost:3000

## Features

- Real-time CT certificate ingestion via CertStream WebSocket
- Full-text trigram search across domains, issuers, and subjects
- Configurable domain glob filters and issuer substring filters
- Automatic deduplication by certificate fingerprint
- 90-day data retention with automatic cleanup
- Server-rendered UI with HTMX for interactive search

## Configuration

See `.env.example` for all options. Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `FILTER_DOMAINS` | _(empty = firehose)_ | Comma-separated glob patterns (e.g. `*.google.com,*bank*`) |
| `FILTER_ISSUERS` | _(empty)_ | Comma-separated issuer org substrings |
| `DB_RETENTION_DAYS` | `90` | Auto-delete certificates older than this |
| `BATCH_SIZE` | `500` | Flush buffer when this many certs accumulate |

## API

- `GET /api/search?q=<query>&page=1&limit=50` — Search certificates
- `GET /api/cert/:id` — Certificate details
- `GET /api/stats` — Database stats + ingestion metrics
- `GET /health` — Health check
