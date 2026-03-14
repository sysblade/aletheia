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

  const isMaintenance = appName.includes("maintenance");
  const client = createClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    database: cfg.database,
    application: appName,
    request_timeout: isMaintenance ? cfg.maintenanceTimeoutMs : cfg.requestTimeoutMs,
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
        createdAt    Int64,
        INDEX domains_ngram  domains   TYPE ngrambf_v1(4, 65536, 3, 0) GRANULARITY 4,
        INDEX issuer_ngram   issuerOrg TYPE ngrambf_v1(4, 65536, 3, 0) GRANULARITY 4,
        INDEX subject_ngram  subjectCn TYPE ngrambf_v1(4, 65536, 3, 0) GRANULARITY 4
      ) ENGINE = ReplacingMergeTree(createdAt)
      ORDER BY fingerprint
      SETTINGS index_granularity = 8192
    `,
  });

  // Add skip indexes to existing tables (IF NOT EXISTS supported since ClickHouse 22.11).
  // Safe to run repeatedly; silently ignored if index already exists.
  for (const [name, col, type] of [
    ["domains_ngram",  "domains",   "ngrambf_v1(4, 65536, 3, 0)"],
    ["issuer_ngram",   "issuerOrg", "ngrambf_v1(4, 65536, 3, 0)"],
    ["subject_ngram",  "subjectCn", "ngrambf_v1(4, 65536, 3, 0)"],
  ] as const) {
    try {
      await client.command({
        query: `ALTER TABLE certificates ADD INDEX IF NOT EXISTS ${name} ${col} TYPE ${type} GRANULARITY 4`,
      });
    } catch {
      // Already exists on older ClickHouse versions that don't support IF NOT EXISTS
    }
  }

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
      CREATE TABLE IF NOT EXISTS metadata (
        key        String,
        value      String,
        updatedAt  Int64
      ) ENGINE = ReplacingMergeTree(updatedAt)
      ORDER BY key
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
