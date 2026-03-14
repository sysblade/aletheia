import type { ClickHouseClient } from "@clickhouse/client-web";

/**
 * Create certificates table with ReplacingMergeTree for deduplication.
 * ReplacingMergeTree keeps the row with the highest createdAt on background merges.
 */
export async function up(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS certificates (
        fingerprint  String,
        domains      Array(String),
        domainCount  UInt32,
        issuerOrg    Nullable(String),
        issuerCn     Nullable(String),
        subjectCn    Nullable(String),
        notBefore    Int64,
        notAfter     Int64,
        serialNumber String,
        logName      Nullable(String),
        logUrl       Nullable(String),
        certIndex    Nullable(Int64),
        certLink     Nullable(String),
        seenAt       Int64,
        createdAt    Int64
      ) ENGINE = ReplacingMergeTree(createdAt)
      ORDER BY fingerprint
      SETTINGS index_granularity = 8192
    `,
  });
}

export async function down(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `DROP TABLE IF EXISTS certificates`,
  });
}
