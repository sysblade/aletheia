import { createClient, type ClickHouseClient } from "@clickhouse/client-web";
import { getLogger } from "../../utils/logger.ts";
import type { Config } from "../../config.ts";

const log = getLogger(["aletheia", "clickhouse"]);

export async function connectClickHouse(
  cfg: Config["clickhouse"],
  skipTableManagement = false,
  appName = "aletheia",
): Promise<ClickHouseClient> {
  log.info("Connecting to ClickHouse at {url}, database {database} (appName={appName})", {
    url: cfg.url,
    database: cfg.database,
    appName,
  });

  const client = createClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    database: cfg.database,
    application: appName,
    request_timeout: cfg.requestTimeoutMs,
    clickhouse_settings: {
      // Allow experimental lightweight deletes (ALTER TABLE ... DELETE still works on older versions)
      allow_experimental_lightweight_delete: 1,
    },
  });

  // Verify connectivity
  await client.ping();

  if (!skipTableManagement) {
    await ensureTables(client);
    log.info("ClickHouse connected, tables ensured");
  } else {
    log.info("ClickHouse connected");
  }

  return client;
}

async function ensureTables(client: ClickHouseClient): Promise<void> {
  // Certificates: ReplacingMergeTree deduplicates by fingerprint (ORDER BY key),
  // keeping the row with the highest createdAt on background merges.
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
