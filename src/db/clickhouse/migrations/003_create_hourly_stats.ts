import type { ClickHouseClient } from "@clickhouse/client-web";

/**
 * Create hourly_stats table for pre-aggregated hourly statistics.
 * ReplacingMergeTree allows recomputation of stats for the same period.
 */
export async function up(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS hourly_stats (
        periodStart       Int64,
        periodEnd         Int64,
        totalCertificates UInt64,
        uniqueDomains     UInt64,
        uniqueIssuers     UInt64,
        wildcardCount     UInt64,
        avgSanCount       Float64,
        topDomains        String,
        topIssuers        String,
        computedAt        Int64
      ) ENGINE = ReplacingMergeTree(computedAt)
      ORDER BY periodStart
    `,
  });
}

export async function down(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `DROP TABLE IF EXISTS hourly_stats`,
  });
}
