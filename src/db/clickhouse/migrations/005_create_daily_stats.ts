import type { ClickHouseClient } from "@clickhouse/client-web";

/**
 * Create daily_stats table for pre-aggregated daily statistics.
 * Similar to hourly_stats but with additional peakHourlyRate field.
 */
export async function up(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS daily_stats (
        periodStart       Int64,
        periodEnd         Int64,
        totalCertificates UInt64,
        uniqueDomains     UInt64,
        uniqueIssuers     UInt64,
        wildcardCount     UInt64,
        avgSanCount       Float64,
        peakHourlyRate    UInt64,
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
    query: `DROP TABLE IF EXISTS daily_stats`,
  });
}
