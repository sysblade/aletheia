import type { ClickHouseClient } from "@clickhouse/client-web";

/**
 * Add ngram bloom filter indexes for fast full-text search on domains, issuer, and subject.
 * These skip indexes help ClickHouse skip data granules that don't match the search pattern.
 */
export async function up(client: ClickHouseClient): Promise<void> {
  // Add ngram indexes to existing table
  // Note: ALTER TABLE ADD INDEX is supported since ClickHouse 20.1
  await client.command({
    query: `
      ALTER TABLE certificates
      ADD INDEX IF NOT EXISTS domains_ngram domains TYPE ngrambf_v1(4, 65536, 3, 0) GRANULARITY 4
    `,
  });

  await client.command({
    query: `
      ALTER TABLE certificates
      ADD INDEX IF NOT EXISTS issuer_ngram issuerOrg TYPE ngrambf_v1(4, 65536, 3, 0) GRANULARITY 4
    `,
  });

  await client.command({
    query: `
      ALTER TABLE certificates
      ADD INDEX IF NOT EXISTS subject_ngram subjectCn TYPE ngrambf_v1(4, 65536, 3, 0) GRANULARITY 4
    `,
  });
}

export async function down(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `ALTER TABLE certificates DROP INDEX IF EXISTS domains_ngram`,
  });

  await client.command({
    query: `ALTER TABLE certificates DROP INDEX IF EXISTS issuer_ngram`,
  });

  await client.command({
    query: `ALTER TABLE certificates DROP INDEX IF EXISTS subject_ngram`,
  });
}
