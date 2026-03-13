import { sql } from "kysely";
import type { Kysely } from "kysely";
import { SearchError, type CertificateRepository } from "../repository.ts";
import { parseSearchQuery } from "../search-query.ts";
import type { SearchTerm } from "../search-query.ts";
import type { Certificate, DailyStats, ExportBatch, HourlyStats, NewCertificate, SearchOpts, SearchResult, Stats, TopEntry } from "../../types/certificate.ts";
import type { Database, CertificateRow, DailyStatsRow, HourlyStatsRow } from "./schema.ts";
import { getLogger } from "../../utils/logger.ts";

const log = getLogger(["ctlog", "sqlite", "repository"]);

const INSERT_CHUNK_SIZE = 50;

function parseDomains(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    log.warn("Failed to parse domains JSON, raw starts with {preview}", { preview: raw.slice(0, 100) });
    return [];
  }
}

function rowToCertificate(row: CertificateRow): Certificate {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    domains: parseDomains(row.domains),
    domainCount: row.domain_count,
    issuerOrg: row.issuer_org,
    issuerCn: row.issuer_cn,
    subjectCn: row.subject_cn,
    notBefore: row.not_before,
    notAfter: row.not_after,
    serialNumber: row.serial_number,
    logName: row.log_name,
    logUrl: row.log_url,
    certIndex: row.cert_index,
    certLink: row.cert_link,
    seenAt: row.seen_at,
    createdAt: row.created_at,
  };
}

function parseTopEntries(raw: string): TopEntry[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    log.warn("Failed to parse top entries JSON, raw starts with {preview}", { preview: raw.slice(0, 100) });
    return [];
  }
}

function rowToHourlyStats(row: HourlyStatsRow): HourlyStats {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    totalCertificates: row.total_certificates,
    uniqueDomains: row.unique_domains,
    uniqueIssuers: row.unique_issuers,
    wildcardCount: row.wildcard_count,
    avgSanCount: row.avg_san_count,
    topDomains: parseTopEntries(row.top_domains),
    topIssuers: parseTopEntries(row.top_issuers),
    computedAt: row.computed_at,
  };
}

function rowToDailyStats(row: DailyStatsRow): DailyStats {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    totalCertificates: row.total_certificates,
    uniqueDomains: row.unique_domains,
    uniqueIssuers: row.unique_issuers,
    wildcardCount: row.wildcard_count,
    avgSanCount: row.avg_san_count,
    peakHourlyRate: row.peak_hourly_rate,
    topDomains: parseTopEntries(row.top_domains),
    topIssuers: parseTopEntries(row.top_issuers),
    computedAt: row.computed_at,
  };
}

/**
 * SQLite-based certificate repository implementation.
 * Uses FTS5 for full-text search and WAL mode for concurrent access.
 */
export class SqliteRepository implements CertificateRepository {
  constructor(private db: Kysely<Database>) {}

  async insertBatch(certs: NewCertificate[]): Promise<number> {
    if (certs.length === 0) return 0;

    const rows = certs.map((cert) => ({
      fingerprint: cert.fingerprint,
      domains: JSON.stringify(cert.domains),
      domain_count: cert.domains.length,
      issuer_org: cert.issuerOrg,
      issuer_cn: cert.issuerCn,
      subject_cn: cert.subjectCn,
      not_before: cert.notBefore,
      not_after: cert.notAfter,
      serial_number: cert.serialNumber,
      log_name: cert.logName,
      log_url: cert.logUrl,
      cert_index: cert.certIndex,
      cert_link: cert.certLink,
      seen_at: cert.seenAt,
    }));

    let totalInserted = 0;

    try {
      for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
        const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
        await this.db
          .insertInto("certificates")
          .values(chunk)
          .onConflict((oc) => oc.column("fingerprint").doNothing())
          .execute();

        const changesResult = await sql<{ n: number }>`SELECT changes() as n`.execute(this.db);
        totalInserted += changesResult.rows[0]?.n ?? 0;
      }
      return totalInserted;
    } catch (err) {
      log.error("Batch insert failed with {error}, batch had {batchSize} certs", { error: String(err), batchSize: certs.length });
      throw err;
    }
  }

  async search(query: string, opts: SearchOpts): Promise<SearchResult> {
    const { page, limit } = opts;
    const offset = (page - 1) * limit;
    const parsed = parseSearchQuery(query);

    if (parsed.groups.length === 0) {
      throw new SearchError("Query must contain at least one search term.");
    }

    const FTS_COL: Record<string, string> = {
      domain: "domains",
      issuer: "issuer_org",
      cn: "subject_cn",
    };

    function termPhrase(t: SearchTerm): string {
      const safe = t.text.replace(/\0/g, "").replace(/"/g, '""');
      const col = t.column ? `${FTS_COL[t.column]}:` : "";
      return `${col}"${safe}"`;
    }

    function buildGroupExpr(terms: SearchTerm[]): string {
      const pos = terms.filter((t) => !t.negate);
      const neg = terms.filter((t) => t.negate);

      if (pos.length === 0) {
        throw new SearchError("Each OR group must contain at least one positive search term.");
      }

      const posExpr = pos.length === 1 ? termPhrase(pos[0]!) : `(${pos.map(termPhrase).join(" AND ")})`;
      return neg.length === 0
        ? posExpr
        : `${posExpr} ${neg.map((t) => `NOT ${termPhrase(t)}`).join(" ")}`;
    }

    const groupExprs = parsed.groups.map(buildGroupExpr);
    const matchExpr =
      groupExprs.length === 1 ? groupExprs[0]! : groupExprs.map((e) => `(${e})`).join(" OR ");

    try {
      const countResult = await sql<{ cnt: number }>`
        SELECT COUNT(*) as cnt FROM certificates
        WHERE id IN (SELECT rowid FROM certificates_fts WHERE certificates_fts MATCH ${matchExpr})
      `.execute(this.db);

      const total = countResult.rows[0]?.cnt ?? 0;

      if (total === 0) {
        return { certificates: [], total: 0, page, limit, totalPages: 0 };
      }

      const rows = await sql<CertificateRow>`
        SELECT c.* FROM certificates c
        WHERE c.id IN (SELECT rowid FROM certificates_fts WHERE certificates_fts MATCH ${matchExpr})
        ORDER BY c.seen_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `.execute(this.db);

      return {
        certificates: rows.rows.map(rowToCertificate),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (err) {
      log.error("Search query failed with {error} for query {query}", { error: String(err), query });
      throw new SearchError("Search failed. Try a different query.");
    }
  }

  async getById(id: number): Promise<Certificate | null> {
    const row = await this.db
      .selectFrom("certificates")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();

    return row ? rowToCertificate(row) : null;
  }

  async getRecent(limit: number): Promise<Certificate[]> {
    const rows = await this.db
      .selectFrom("certificates")
      .selectAll()
      .orderBy("id", "desc")
      .limit(limit)
      .execute();
    return rows.map(rowToCertificate);
  }

  async getStats(): Promise<Stats> {
    const result = await this.db
      .selectFrom("certificates")
      .select([
        sql<number>`COUNT(*)`.as("total"),
        sql<number>`COUNT(DISTINCT issuer_org)`.as("unique_issuers"),
        sql<number | null>`MAX(seen_at)`.as("latest_seen_at"),
        sql<number | null>`MIN(seen_at)`.as("oldest_seen_at"),
      ])
      .executeTakeFirstOrThrow();

    return {
      totalCertificates: result.total,
      uniqueIssuers: result.unique_issuers,
      latestSeenAt: result.latest_seen_at,
      oldestSeenAt: result.oldest_seen_at,
    };
  }

  async cleanup(olderThanDays: number): Promise<number> {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;

    const result = await this.db
      .deleteFrom("certificates")
      .where("seen_at", "<", cutoff)
      .execute();

    const deleted = result.reduce((sum, r) => sum + Number(r.numDeletedRows ?? 0), 0);

    if (deleted > 0) {
      log.info("Cleanup completed, deleted {deleted} rows older than {olderThanDays} days", { deleted, olderThanDays });
      await sql`INSERT INTO certificates_fts(certificates_fts) VALUES('merge=500')`.execute(this.db);
    }

    return deleted;
  }

  async maintenance(): Promise<void> {
    log.info("Starting database maintenance");

    // Update query planner statistics
    await sql`PRAGMA optimize`.execute(this.db);

    // Full statistics analysis with reasonable limit
    await sql`PRAGMA analysis_limit = 1000`.execute(this.db);
    await sql`ANALYZE`.execute(this.db);

    // Checkpoint WAL without blocking
    const result = await sql<{ busy: number; log: number; checkpointed: number }>`
      PRAGMA wal_checkpoint(PASSIVE)
    `.execute(this.db);

    const row = result.rows[0];
    if (row) {
      log.info("Maintenance completed: WAL checkpointed {checkpointed} frames, {log} frames remain", {
        checkpointed: row.checkpointed,
        log: row.log,
      });
    } else {
      log.info("Maintenance completed");
    }
  }

  async exportBatch(cursor: number | null, limit: number): Promise<ExportBatch> {
    let query = this.db
      .selectFrom("certificates")
      .selectAll()
      .orderBy("id", "asc")
      .limit(limit);

    if (cursor !== null) {
      query = query.where("id", ">", cursor);
    }

    const rows = await query.execute();
    const certificates = rows.map(rowToCertificate);
    const nextCursor = rows.length < limit ? null : rows[rows.length - 1]!.id;

    return { certificates, cursor: nextCursor };
  }

  async getHourlyStats(fromTimestamp: number, toTimestamp: number): Promise<HourlyStats[]> {
    const rows = await this.db
      .selectFrom("hourly_stats")
      .selectAll()
      .where("period_start", ">=", fromTimestamp)
      .where("period_start", "<", toTimestamp)
      .orderBy("period_start", "asc")
      .execute();

    return rows.map(rowToHourlyStats);
  }

  async getDailyStats(fromTimestamp: number, toTimestamp: number): Promise<DailyStats[]> {
    const rows = await this.db
      .selectFrom("daily_stats")
      .selectAll()
      .where("period_start", ">=", fromTimestamp)
      .where("period_start", "<", toTimestamp)
      .orderBy("period_start", "asc")
      .execute();

    return rows.map(rowToDailyStats);
  }

  async computeStatsForPeriod(periodStart: number, granularity: "hourly" | "daily"): Promise<void> {
    // Lazy import domain utilities to avoid loading psl during module initialization
    const { extractTwoLevelDomain, isWildcardDomain } = await import("../../utils/domain.ts");

    const periodEnd = periodStart + (granularity === "hourly" ? 3600 : 86400);

    log.debug("Computing {granularity} stats for period {start} to {end}", {
      granularity,
      start: periodStart,
      end: periodEnd,
    });

    // Use SQL aggregation for simple stats (memory efficient)
    const basicStats = await sql<{
      total: number;
      total_domain_count: number;
    }>`
      SELECT
        COUNT(*) as total,
        SUM(domain_count) as total_domain_count
      FROM certificates
      WHERE seen_at >= ${periodStart} AND seen_at < ${periodEnd}
    `.execute(this.db);

    const totalCertificates = basicStats.rows[0]?.total ?? 0;

    if (totalCertificates === 0) {
      log.debug("No certificates in period, skipping stats computation");
      return;
    }

    const totalDomainCount = basicStats.rows[0]?.total_domain_count ?? 0;
    const avgSanCount = totalDomainCount / totalCertificates;

    // Get issuer counts using SQL (memory efficient)
    const issuerRows = await sql<{ issuer: string; count: number }>`
      SELECT issuer_org as issuer, COUNT(*) as count
      FROM certificates
      WHERE seen_at >= ${periodStart} AND seen_at < ${periodEnd}
        AND issuer_org IS NOT NULL
      GROUP BY issuer_org
      ORDER BY count DESC
      LIMIT 100
    `.execute(this.db);

    const issuerCounts = new Map(issuerRows.rows.map((r) => [r.issuer, r.count]));
    const uniqueIssuers = issuerCounts.size;

    // Build top issuers list
    const topIssuers: TopEntry[] = issuerRows.rows.map((r) => ({
      value: r.issuer,
      count: r.count,
    }));

    // Stream process certificates in batches for domain extraction
    // This is the memory-intensive part due to JSON parsing and PSL lookups
    // BATCH_SIZE of 5000 balances memory usage (~50-100MB per batch) with performance
    // Reduce to 1000-2000 for very memory-constrained environments
    const BATCH_SIZE = 5000;
    const twoLevelDomainCounts = new Map<string, number>();
    let wildcardCount = 0;
    let lastId = 0;
    let processedCount = 0;

    while (true) {
      const batch = await this.db
        .selectFrom("certificates")
        .select(["id", "domains"])
        .where("seen_at", ">=", periodStart)
        .where("seen_at", "<", periodEnd)
        .where("id", ">", lastId)
        .orderBy("id", "asc")
        .limit(BATCH_SIZE)
        .execute();

      if (batch.length === 0) break;

      // Process batch in memory
      for (const cert of batch) {
        const domains = parseDomains(cert.domains);

        // Count wildcards
        if (domains.some(isWildcardDomain)) {
          wildcardCount++;
        }

        // Extract and count 2-level domains
        for (const domain of domains) {
          const twoLevel = extractTwoLevelDomain(domain);
          if (twoLevel) {
            twoLevelDomainCounts.set(twoLevel, (twoLevelDomainCounts.get(twoLevel) ?? 0) + 1);
          }
        }
      }

      lastId = batch[batch.length - 1]!.id;
      processedCount += batch.length;

      // Log progress for large periods
      if (totalCertificates > 10000 && processedCount % 10000 === 0) {
        log.debug("Domain extraction progress: {processed}/{total} certificates", {
          processed: processedCount,
          total: totalCertificates,
        });
      }

      // Break if we processed fewer than batch size (last batch)
      if (batch.length < BATCH_SIZE) break;
    }

    const uniqueDomains = twoLevelDomainCounts.size;

    // Build top 100 domains
    const topDomains = Array.from(twoLevelDomainCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)
      .map(([value, count]) => ({ value, count }));

    // topIssuers was already built from SQL query above

    if (granularity === "hourly") {
      // Store hourly stats
      await sql`
        REPLACE INTO hourly_stats (
          period_start, period_end, total_certificates, unique_domains,
          unique_issuers, wildcard_count, avg_san_count, top_domains, top_issuers
        ) VALUES (
          ${periodStart}, ${periodEnd}, ${totalCertificates}, ${uniqueDomains},
          ${uniqueIssuers}, ${wildcardCount}, ${avgSanCount},
          ${JSON.stringify(topDomains)}, ${JSON.stringify(topIssuers)}
        )
      `.execute(this.db);

      log.debug("Stored hourly stats for period {start}", {
        start: periodStart,
        total: totalCertificates,
        uniqueDomains,
      });
    } else {
      // For daily stats, compute peak hourly rate
      const peakHourlyRate = await this.computePeakHourlyRate(periodStart, periodEnd);

      await sql`
        REPLACE INTO daily_stats (
          period_start, period_end, total_certificates, unique_domains,
          unique_issuers, wildcard_count, avg_san_count, peak_hourly_rate,
          top_domains, top_issuers
        ) VALUES (
          ${periodStart}, ${periodEnd}, ${totalCertificates}, ${uniqueDomains},
          ${uniqueIssuers}, ${wildcardCount}, ${avgSanCount}, ${peakHourlyRate},
          ${JSON.stringify(topDomains)}, ${JSON.stringify(topIssuers)}
        )
      `.execute(this.db);

      log.debug("Stored daily stats for period {start}", {
        start: periodStart,
        total: totalCertificates,
        uniqueDomains,
        peakHourlyRate,
      });
    }
  }

  private async computePeakHourlyRate(dayStart: number, dayEnd: number): Promise<number> {
    // Query each hour in the day to find the peak
    const result = await sql<{ max_hourly: number }>`
      SELECT MAX(hourly_count) as max_hourly
      FROM (
        SELECT
          CAST((seen_at - ${dayStart}) / 3600 AS INTEGER) as hour_bucket,
          COUNT(*) as hourly_count
        FROM certificates
        WHERE seen_at >= ${dayStart} AND seen_at < ${dayEnd}
        GROUP BY hour_bucket
      )
    `.execute(this.db);

    return result.rows[0]?.max_hourly ?? 0;
  }

  async close(): Promise<void> {
    await sql`PRAGMA optimize`.execute(this.db);
    await this.db.destroy();
    log.info("Database connection closed");
  }
}
