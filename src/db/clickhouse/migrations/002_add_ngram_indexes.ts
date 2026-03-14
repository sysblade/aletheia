import type { ClickHouseClient } from "@clickhouse/client-web";

/**
 * No-op migration: Ngram indexes moved to inline definition in migration 001.
 *
 * Originally this migration added indexes via ALTER TABLE, but ClickHouse doesn't
 * support adding ngram bloom filter indexes to Nullable(String) columns after table creation.
 * The indexes must be defined inline in CREATE TABLE, so they were moved to migration 001.
 *
 * This migration is kept as a no-op to maintain migration sequence numbering.
 */
export async function up(_client: ClickHouseClient): Promise<void> {
  // Indexes are created inline in migration 001
  // Nothing to do here
}

export async function down(_client: ClickHouseClient): Promise<void> {
  // Indexes are part of table definition in migration 001
  // They would be dropped when the table is dropped
  // Nothing to do here
}
