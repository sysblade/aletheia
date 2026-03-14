# Database Migrations

Aletheia uses migration systems to manage database schema changes safely across deployments.

## SQLite Migrations

**Location**: `src/db/sqlite/migrations/`
**Runner**: `src/db/sqlite/migrate.ts`
**Tracker**: Uses Kysely's built-in migration table (`kysely_migration`)

SQLite migrations are managed by Kysely's Migrator and run automatically on startup.

## ClickHouse Migrations

**Location**: `src/db/clickhouse/migrations/`
**Runner**: `src/db/clickhouse/migrate.ts`
**Tracker**: Uses `metadata` table with keys like `migration:001_create_certificates`

### How It Works

1. **On startup**, the migration runner checks which migrations have been applied
2. **Missing migrations** are applied in order (001, 002, 003, ...)
3. **Migration records** are stored in the `metadata` table
4. **Idempotent** - safe to run multiple times

### Current Migrations

| Migration | Description |
|-----------|-------------|
| 001 | Create certificates table with ReplacingMergeTree and ngram indexes |
| 002 | No-op (indexes moved inline to migration 001) |
| 003 | Create hourly_stats table |
| 004 | Create metadata table (for migration tracking) |
| 005 | Create daily_stats table |

### Adding a New ClickHouse Migration

1. **Create migration file** in `src/db/clickhouse/migrations/`:

```typescript
// src/db/clickhouse/migrations/006_add_certificate_chain.ts
import type { ClickHouseClient } from "@clickhouse/client-web";

/**
 * Add chainLength column to track certificate chain depth.
 */
export async function up(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `ALTER TABLE certificates ADD COLUMN chainLength UInt32 DEFAULT 0`,
  });
}

export async function down(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `ALTER TABLE certificates DROP COLUMN chainLength`,
  });
}
```

2. **Register migration** in `src/db/clickhouse/migrate.ts`:

```typescript
import * as m006 from "./migrations/006_add_certificate_chain.ts";

const migrations: Record<string, ClickHouseMigration> = {
  // ... existing migrations
  "006_add_certificate_chain": m006,
};
```

3. **Test migration**:

```bash
# Type check
bun run check

# Run tests
bun test

# Test against real ClickHouse (optional)
STORE_TYPE=clickhouse CLICKHOUSE_URL=http://localhost:8123 bun run dev
```

4. **Deploy** - migrations run automatically on startup

### Migration Gotchas

#### ClickHouse Index Limitations

**Problem**: Cannot add ngram bloom filter indexes to nullable columns via `ALTER TABLE`:

```typescript
// ❌ This fails on Nullable(String) columns:
ALTER TABLE certificates ADD INDEX issuer_ngram issuerOrg TYPE ngrambf_v1(...);
```

**Solution**: Define indexes inline in `CREATE TABLE`:

```typescript
// ✅ This works:
CREATE TABLE certificates (
  issuerOrg Nullable(String),
  INDEX issuer_ngram issuerOrg TYPE ngrambf_v1(4, 65536, 3, 0) GRANULARITY 4
) ENGINE = ReplacingMergeTree(createdAt);
```

#### ReplacingMergeTree Deduplication

ClickHouse's `ReplacingMergeTree` deduplicates rows on **background merges**, not immediately:

```sql
-- Duplicates may appear until merge happens
SELECT * FROM certificates WHERE fingerprint = 'abc123'
-- Might return multiple rows temporarily

-- Force merge (maintenance operation)
OPTIMIZE TABLE certificates FINAL
```

For queries that need deduplicated results immediately, use `FINAL`:

```sql
SELECT * FROM certificates FINAL WHERE fingerprint = 'abc123'
```

Note: `FINAL` is slower, so use sparingly. The application layer handles deduplication for inserts.

#### Breaking Changes

If you need to make breaking schema changes:

1. **Add new column** with migration (e.g., 006)
2. **Deploy code** that writes to both old and new columns
3. **Backfill data** with migration (e.g., 007)
4. **Deploy code** that only uses new column
5. **Drop old column** with migration (e.g., 008)

This ensures zero-downtime deployments.

### Migration Best Practices

1. ✅ **Keep migrations small** - one logical change per migration
2. ✅ **Test `up` and `down`** - ensure migrations are reversible
3. ✅ **Never modify applied migrations** - create new ones instead
4. ✅ **Use transactions where possible** - ClickHouse DDL is not transactional
5. ✅ **Add comments** - explain why the change is needed

### Troubleshooting

**Migration fails on startup:**
```bash
ERROR Migration 006_add_certificate_chain failed: ...
```

**Solution**: Check ClickHouse logs, fix migration, restart. The failed migration won't be marked as applied.

**Need to rollback a migration:**
```typescript
// Manually mark as not applied
DELETE FROM metadata WHERE key = 'migration:006_add_certificate_chain';

// Next startup will re-run migration 006
```

**Check applied migrations:**
```sql
SELECT key, value, updatedAt
FROM metadata
WHERE key LIKE 'migration:%'
ORDER BY key;
```

## MongoDB Migrations

**Status**: Not currently implemented
**Reason**: MongoDB schema is flexible (schemaless), changes are handled at application layer

If you need MongoDB migrations in the future, follow the same pattern as ClickHouse.

## Testing Migrations

All migrations are tested as part of the test suite:

```bash
# Test all backends including migrations
bun test

# Type check
bun run check
```

SQLite uses in-memory databases for tests, so migrations run on every test.
