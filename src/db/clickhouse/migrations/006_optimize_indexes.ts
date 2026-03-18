import type { ClickHouseClient } from "@clickhouse/client-web";

/**
 * Add seenAt minmax skip index and increase ngram bloom filter sizes.
 *
 * - seenAt_minmax: lets ClickHouse skip granules outside the queried time range
 *   when after:/before: filters are present, without a full table scan.
 *
 * - Ngram bloom filter size 65536 → 262144 bytes: reduces false-positive rate,
 *   so more granules are skipped on LIKE queries over domains/issuerOrg/subjectCn.
 *   GRANULARITY 2 (down from 4): smaller skip-index granules for finer pruning.
 *
 * MATERIALIZE INDEX runs as an async background mutation; the migration returns
 * immediately and index coverage builds up while the server is live.
 */
export async function up(client: ClickHouseClient): Promise<void> {
  // Add seenAt minmax skip index
  await client.command({
    query: `ALTER TABLE certificates ADD INDEX IF NOT EXISTS seenAt_minmax seenAt TYPE minmax GRANULARITY 1`,
  });
  await client.command({
    query: `ALTER TABLE certificates MATERIALIZE INDEX seenAt_minmax`,
  });

  // Replace ngram indexes with larger bloom filters and finer granularity.
  // DROP IF EXISTS is safe to re-run if migration was partially applied.
  await client.command({ query: `ALTER TABLE certificates DROP INDEX IF EXISTS domains_ngram` });
  await client.command({
    query: `ALTER TABLE certificates ADD INDEX domains_ngram domains TYPE ngrambf_v1(4, 262144, 3, 0) GRANULARITY 2`,
  });
  await client.command({ query: `ALTER TABLE certificates MATERIALIZE INDEX domains_ngram` });

  // issuerOrg and subjectCn are Nullable(String); ngrambf_v1 requires a non-nullable
  // type so we index the coalesced expression instead.
  await client.command({ query: `ALTER TABLE certificates DROP INDEX IF EXISTS issuer_ngram` });
  await client.command({
    query: `ALTER TABLE certificates ADD INDEX issuer_ngram (coalesce(issuerOrg, '')) TYPE ngrambf_v1(4, 262144, 3, 0) GRANULARITY 2`,
  });
  await client.command({ query: `ALTER TABLE certificates MATERIALIZE INDEX issuer_ngram` });

  await client.command({ query: `ALTER TABLE certificates DROP INDEX IF EXISTS subject_ngram` });
  await client.command({
    query: `ALTER TABLE certificates ADD INDEX subject_ngram (coalesce(subjectCn, '')) TYPE ngrambf_v1(4, 262144, 3, 0) GRANULARITY 2`,
  });
  await client.command({ query: `ALTER TABLE certificates MATERIALIZE INDEX subject_ngram` });
}

export async function down(client: ClickHouseClient): Promise<void> {
  await client.command({ query: `ALTER TABLE certificates DROP INDEX IF EXISTS seenAt_minmax` });

  // Restore original bloom filter sizes
  await client.command({ query: `ALTER TABLE certificates DROP INDEX IF EXISTS domains_ngram` });
  await client.command({
    query: `ALTER TABLE certificates ADD INDEX domains_ngram domains TYPE ngrambf_v1(4, 65536, 3, 0) GRANULARITY 4`,
  });
  await client.command({ query: `ALTER TABLE certificates MATERIALIZE INDEX domains_ngram` });

  await client.command({ query: `ALTER TABLE certificates DROP INDEX IF EXISTS issuer_ngram` });
  await client.command({
    query: `ALTER TABLE certificates ADD INDEX issuer_ngram (coalesce(issuerOrg, '')) TYPE ngrambf_v1(4, 65536, 3, 0) GRANULARITY 4`,
  });
  await client.command({ query: `ALTER TABLE certificates MATERIALIZE INDEX issuer_ngram` });

  await client.command({ query: `ALTER TABLE certificates DROP INDEX IF EXISTS subject_ngram` });
  await client.command({
    query: `ALTER TABLE certificates ADD INDEX subject_ngram (coalesce(subjectCn, '')) TYPE ngrambf_v1(4, 65536, 3, 0) GRANULARITY 4`,
  });
  await client.command({ query: `ALTER TABLE certificates MATERIALIZE INDEX subject_ngram` });
}
