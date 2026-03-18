import type { ClickHouseClient } from "@clickhouse/client-web";
import { getLogger } from "../../../utils/logger.ts";

const log = getLogger(["aletheia", "clickhouse", "migrate"]);

/**
 * Rebuild certificates table with daily partitioning and seenAt-first sort order.
 *
 * Changes:
 * - PARTITION BY toDate(toDateTime(seenAt)): one partition per calendar day.
 *   At ~172 M rows/day ClickHouse can prune entire days for after:/before: filters,
 *   skipping vastly more data than a minmax skip index alone can.
 * - ORDER BY (seenAt, fingerprint): seenAt is the dominant search/sort axis.
 *   Searches with ORDER BY seenAt DESC now walk the primary key in reverse without
 *   a re-sort. Point lookups by fingerprint still work via the sort key suffix.
 * - Larger bloom filters (262144 bytes) and finer granularity (GRANULARITY 2)
 *   carried over from migration 006 are baked into the new table definition.
 *
 * Migration strategy (safe for live systems):
 * 1. Create certificates_v2 with the new schema.
 * 2. RENAME TABLE certificates → certificates_old, certificates_v2 → certificates.
 *    This is atomic: from this point all live writes go to the new schema.
 * 3. INSERT INTO certificates SELECT * FROM certificates_old to backfill history.
 *    Uses max_execution_time = 86400 (server-side). The HTTP client uses the
 *    maintenance timeout (see connection.ts). For very large datasets this INSERT
 *    may outlive the HTTP timeout; the server continues and the next restart will
 *    retry (ReplacingMergeTree deduplicates any re-inserted rows automatically).
 * 4. DROP TABLE certificates_old.
 *
 * Idempotency: the migration checks system.tables for the partition_key before
 * doing any work, and handles the case where the rename happened but the backfill
 * did not complete (certificates_old still present).
 */
export async function up(client: ClickHouseClient): Promise<void> {
  // Check if certificates already has daily partitioning
  const tableResult = await client.query({
    query: `
      SELECT partition_key
      FROM system.tables
      WHERE database = currentDatabase() AND name = 'certificates'
    `,
    format: "JSONEachRow",
  });
  const [tableInfo] = await tableResult.json<{ partition_key: string }>();

  const alreadyPartitioned = tableInfo?.partition_key === "toDate(toDateTime(seenAt))";

  // Check if a previous run got through the rename but not the backfill
  const oldExistsResult = await client.query({
    query: `
      SELECT count() AS cnt
      FROM system.tables
      WHERE database = currentDatabase() AND name = 'certificates_old'
    `,
    format: "JSONEachRow",
  });
  const [oldExistsRow] = await oldExistsResult.json<{ cnt: string }>();
  const oldTableExists = Number(oldExistsRow?.cnt ?? 0) > 0;

  if (alreadyPartitioned && !oldTableExists) {
    // Fully done — nothing to do
    return;
  }

  if (!oldTableExists) {
    // First run: create new table and atomically swap it in
    log.info("Creating certificates_v2 with daily partitioning");
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS certificates_v2 (
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
          INDEX seenAt_minmax  seenAt    TYPE minmax                       GRANULARITY 1,
          INDEX domains_ngram  domains   TYPE ngrambf_v1(4, 262144, 3, 0) GRANULARITY 2,
          INDEX issuer_ngram   issuerOrg TYPE ngrambf_v1(4, 262144, 3, 0) GRANULARITY 2,
          INDEX subject_ngram  subjectCn TYPE ngrambf_v1(4, 262144, 3, 0) GRANULARITY 2
        ) ENGINE = ReplacingMergeTree(createdAt)
        PARTITION BY toDate(toDateTime(seenAt))
        ORDER BY (seenAt, fingerprint)
        SETTINGS index_granularity = 8192
      `,
    });

    // Atomic swap: live writes immediately go to the new schema.
    // Historical data remains in certificates_old until backfilled below.
    log.info("Renaming certificates → certificates_old, certificates_v2 → certificates");
    await client.command({
      query: `RENAME TABLE certificates TO certificates_old, certificates_v2 TO certificates`,
    });
  }

  // Backfill historical data from the old table.
  // max_execution_time gives the server up to 24 h to complete this.
  // If the HTTP client times out first, the server continues running the INSERT;
  // the next startup retries (ReplacingMergeTree deduplicates the overlap).
  log.info("Backfilling historical certificates from certificates_old (this may take a while)");
  await client.command({
    query: `
      INSERT INTO certificates
      SELECT * FROM certificates_old
      ORDER BY seenAt, fingerprint
      SETTINGS max_execution_time = 86400
    `,
  });

  log.info("Backfill complete, dropping certificates_old");
  await client.command({ query: `DROP TABLE IF EXISTS certificates_old` });
}

export async function down(client: ClickHouseClient): Promise<void> {
  // Rebuilding the old table from scratch is not feasible in a down migration.
  // If rollback is needed, restore from a snapshot taken before applying this migration.
  log.info("Migration 007 down: no-op — restore from pre-migration snapshot if needed");
}
