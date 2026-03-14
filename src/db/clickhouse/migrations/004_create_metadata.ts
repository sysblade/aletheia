import type { ClickHouseClient } from "@clickhouse/client-web";

/**
 * Create metadata table for storing key-value configuration and migration tracking.
 * ReplacingMergeTree allows updates by inserting new rows with same key.
 */
export async function up(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS metadata (
        key        String,
        value      String,
        updatedAt  Int64
      ) ENGINE = ReplacingMergeTree(updatedAt)
      ORDER BY key
    `,
  });
}

export async function down(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `DROP TABLE IF EXISTS metadata`,
  });
}
