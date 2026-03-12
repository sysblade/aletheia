# CT Log - Certificate Transparency Monitor

## Quick Reference

- **Runtime**: Bun (use `bun` not `node`)
- **Framework**: Hono (JSX server-rendered) + HTMX
- **Database**: SQLite via Kysely + FTS5 trigram search
- **Entry point**: `src/index.ts`

## Commands

- `bun run dev` — Start with watch mode
- `bun run start` — Production start
- `bun run check` — TypeScript type-check

## Architecture

Single Bun process, three logical components:
1. **Ingestor**: CertStream WebSocket → filter → batch buffer → SQLite
2. **Batch Writer**: Flushes buffer on interval/size threshold
3. **Web Server**: Hono app serving API + server-rendered UI

All DB access through `CertificateRepository` interface (`src/db/repository.ts`).

## Conventions

- TSX files for anything containing JSX; `.ts` for pure logic
- `kysely` for type-safe SQL — no raw strings except FTS5 queries
- Configuration via environment variables (see `.env.example`)
- Structured logging via `createLogger(component)` from `src/utils/logger.ts`
