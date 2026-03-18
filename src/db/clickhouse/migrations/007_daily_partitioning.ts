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
 * 3. Cursor-based backfill: copy certificates_old → certificates in batches of
 *    BATCH_SIZE rows, using fingerprint as the cursor key (certificates_old is
 *    ORDER BY fingerprint so each batch is a fast primary-key range scan).
 *    The cursor is persisted in the metadata table after every batch so the
 *    migration is fully resumable across process restarts.
 * 4. DROP TABLE certificates_old.
 *
 * Idempotency: checks system.tables for the partition_key before doing any work,
 * and handles the case where the rename happened but the backfill did not finish
 * (certificates_old still present → resume from saved cursor).
 */

const BATCH_SIZE = 1_000_000;
const CURSOR_KEY = "migration:007_backfill_cursor";

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
          INDEX seenAt_minmax  seenAt                      TYPE minmax                       GRANULARITY 1,
          INDEX domains_ngram  domains                     TYPE ngrambf_v1(4, 262144, 3, 0) GRANULARITY 2,
          INDEX issuer_ngram   (coalesce(issuerOrg, ''))   TYPE ngrambf_v1(4, 262144, 3, 0) GRANULARITY 2,
          INDEX subject_ngram  (coalesce(subjectCn, ''))   TYPE ngrambf_v1(4, 262144, 3, 0) GRANULARITY 2
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

  await backfillWithProgress(client);

  log.info("Dropping certificates_old");
  await client.command({ query: `DROP TABLE IF EXISTS certificates_old` });

  // Clean up the cursor key left in metadata (best-effort)
  try {
    await client.command({
      query: `ALTER TABLE metadata DELETE WHERE key = {key:String}`,
      query_params: { key: CURSOR_KEY },
    });
  } catch {
    // Non-fatal — the stale key is harmless
  }
}

/**
 * Copy all rows from certificates_old into certificates using cursor-based batching.
 *
 * Why not a single INSERT INTO SELECT:
 * - ClickHouse 26.x cancels INSERT INTO SELECT when the HTTP connection closes
 *   (QUERY_WAS_CANCELLED), which happens whenever any HTTP timeout fires.
 * - There is no HTTP-level keep-alive mechanism for INSERT commands that would
 *   prevent this cancellation.
 *
 * Cursor-based approach:
 * - certificates_old is ORDER BY fingerprint, so each batch is a fast primary-key
 *   range scan with no full-table scans.
 * - Each batch is small enough (1 M rows) to complete in well under any timeout.
 * - The cursor is written to the metadata table after every successful batch so
 *   the migration is fully resumable: a process restart picks up exactly where
 *   it left off without re-copying already-migrated rows.
 * - ReplacingMergeTree deduplicates by fingerprint during background merges, so
 *   even if a batch is retried it cannot corrupt data.
 */
async function backfillWithProgress(client: ClickHouseClient): Promise<void> {
  // COUNT without WHERE reads part-level metadata — effectively instant even
  // on tables with billions of rows.
  const totalResult = await client.query({
    query: `SELECT count() AS cnt FROM certificates_old`,
    format: "JSONEachRow",
  });
  const [totalRow] = await totalResult.json<{ cnt: string }>();
  const totalRows = Number(totalRow?.cnt ?? 0);

  if (totalRows === 0) {
    log.info("certificates_old is empty, nothing to backfill");
    return;
  }

  // Restore cursor from a previous partial run
  let cursor = "";
  let rowsDone = 0;
  try {
    const r = await client.query({
      query: `SELECT value FROM metadata FINAL WHERE key = {key:String} LIMIT 1`,
      query_params: { key: CURSOR_KEY },
      format: "JSONEachRow",
    });
    const [row] = await r.json<{ value: string }>();
    cursor = row?.value ?? "";
    if (cursor) {
      // Re-derive approximate rows done so the progress percentage is correct
      const doneR = await client.query({
        query: `SELECT count() AS cnt FROM certificates_old WHERE fingerprint <= {cursor:String}`,
        query_params: { cursor },
        format: "JSONEachRow",
      });
      const [doneRow] = await doneR.json<{ cnt: string }>();
      rowsDone = Number(doneRow?.cnt ?? 0);
      log.info("Resuming backfill: {done}/{total} rows already copied", {
        done: rowsDone.toLocaleString(),
        total: totalRows.toLocaleString(),
      });
    }
  } catch {
    // Cursor key absent — start from scratch
  }

  const estimatedBatches = Math.ceil(totalRows / BATCH_SIZE);
  log.info("Backfilling {total} rows in ~{batches} batches of {batch}", {
    total: totalRows.toLocaleString(),
    batches: estimatedBatches,
    batch: BATCH_SIZE.toLocaleString(),
  });

  let batchNum = 0;

  while (true) {
    // Determine the end boundary of this batch via a primary-key range scan.
    // certificates_old ORDER BY fingerprint so OFFSET on the primary key is
    // O(ceil(BATCH_SIZE / index_granularity)) — about 122 granule reads for
    // 1 M rows, negligible cost.
    const boundaryResult = await client.query({
      query: `
        SELECT fingerprint FROM certificates_old
        WHERE fingerprint > {cursor:String}
        ORDER BY fingerprint ASC
        LIMIT 1 OFFSET {offset:UInt32}
      `,
      query_params: { cursor, offset: BATCH_SIZE - 1 },
      format: "JSONEachRow",
    });
    const [boundaryRow] = await boundaryResult.json<{ fingerprint: string }>();

    if (!boundaryRow) {
      // Fewer than BATCH_SIZE rows remain — insert them all and we're done.
      await client.command({
        query: `
          INSERT INTO certificates
          SELECT * FROM certificates_old
          WHERE fingerprint > {cursor:String}
          SETTINGS insert_deduplicate = 0
        `,
        query_params: { cursor },
      });
      batchNum++;
      log.info("Backfill complete: {total} rows copied in {batches} batches", {
        total: totalRows.toLocaleString(),
        batches: batchNum,
      });
      return;
    }

    const batchEnd = boundaryRow.fingerprint;

    await client.command({
      query: `
        INSERT INTO certificates
        SELECT * FROM certificates_old
        WHERE fingerprint > {cursor:String} AND fingerprint <= {end:String}
        SETTINGS insert_deduplicate = 0
      `,
      query_params: { cursor, end: batchEnd },
    });

    cursor = batchEnd;
    rowsDone = Math.min(rowsDone + BATCH_SIZE, totalRows);
    batchNum++;

    // Persist cursor so a restart resumes from here rather than the beginning.
    await client.insert({
      table: "metadata",
      values: [{ key: CURSOR_KEY, value: cursor, updatedAt: Date.now() }],
      format: "JSONEachRow",
    });

    const pct = ((rowsDone / totalRows) * 100).toFixed(1);
    log.info("Backfill progress: {done}/{total} ({pct}%), batch {batchNum}/{batches}", {
      done: rowsDone.toLocaleString(),
      total: totalRows.toLocaleString(),
      pct,
      batchNum,
      batches: estimatedBatches,
    });
  }
}

export async function down(client: ClickHouseClient): Promise<void> {
  // Rebuilding the old table from scratch is not feasible in a down migration.
  // If rollback is needed, restore from a snapshot taken before applying this migration.
  log.info("Migration 007 down: no-op — restore from pre-migration snapshot if needed");
}
