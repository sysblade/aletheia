import type { ClickHouseClient } from "@clickhouse/client-web";
import { SearchError, type CertificateRepository } from "../repository.ts";
import { parseSearchQuery } from "../search-query.ts";
import type { SearchTerm } from "../search-query.ts";
import type {
  Certificate,
  DailyStats,
  ExportBatch,
  HourlyStats,
  NewCertificate,
  SearchOpts,
  SearchResult,
  Stats,
  TopEntry,
} from "../../types/certificate.ts";
import type { CertificateRow, DailyStatsRow, HourlyStatsRow } from "./schema.ts";
import { getLogger } from "../../utils/logger.ts";
import { extractTwoLevelDomain, isWildcardDomain } from "../../utils/domain.ts";

const log = getLogger(["aletheia", "clickhouse", "repository"]);

const DOMAIN_BATCH_SIZE = 5000;
// ClickHouse HTTP server rejects requests exceeding http_max_field_value_size.
// Certificates with many SANs can produce very large JSON payloads, so we
// split inserts and dedup lookups into chunks small enough to stay under the limit.
const INSERT_CHUNK_SIZE = 50;
const DEDUP_CHUNK_SIZE = 200;

function rowToCertificate(row: CertificateRow): Certificate {
  return {
    fingerprint: row.fingerprint,
    domains: row.domains,
    domainCount: row.domainCount,
    issuerOrg: row.issuerOrg,
    issuerCn: row.issuerCn,
    subjectCn: row.subjectCn,
    notBefore: Number(row.notBefore),
    notAfter: Number(row.notAfter),
    serialNumber: row.serialNumber,
    logName: row.logName,
    logUrl: row.logUrl,
    certIndex: row.certIndex !== null ? Number(row.certIndex) : null,
    certLink: row.certLink,
    seenAt: Number(row.seenAt),
    createdAt: Number(row.createdAt),
  };
}

function rowToHourlyStats(row: HourlyStatsRow): HourlyStats {
  return {
    id: 0,
    periodStart: Number(row.periodStart),
    periodEnd: Number(row.periodEnd),
    totalCertificates: Number(row.totalCertificates),
    uniqueDomains: Number(row.uniqueDomains),
    uniqueIssuers: Number(row.uniqueIssuers),
    wildcardCount: Number(row.wildcardCount),
    avgSanCount: Number(row.avgSanCount),
    topDomains: JSON.parse(row.topDomains),
    topIssuers: JSON.parse(row.topIssuers),
    computedAt: Number(row.computedAt),
  };
}

function rowToDailyStats(row: DailyStatsRow): DailyStats {
  return {
    ...rowToHourlyStats(row),
    peakHourlyRate: Number(row.peakHourlyRate),
  };
}

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

/**
 * ClickHouse-based certificate repository.
 * Uses ReplacingMergeTree for deduplication by fingerprint.
 * Int64 fields from ClickHouse arrive as strings and are converted via Number().
 */
export class ClickHouseRepository implements CertificateRepository {
  constructor(private readonly client: ClickHouseClient) {}

  async insertBatch(certs: NewCertificate[]): Promise<number> {
    if (certs.length === 0) return 0;

    // Split into chunks to stay under ClickHouse's http_max_field_value_size.
    // Certs with many SANs can produce large payloads; chunking avoids HTTP 413.
    if (certs.length > INSERT_CHUNK_SIZE) {
      let total = 0;
      for (let i = 0; i < certs.length; i += INSERT_CHUNK_SIZE) {
        total += await this.insertBatch(certs.slice(i, i + INSERT_CHUNK_SIZE));
      }
      return total;
    }

    // Pre-filter duplicates across chunked dedup lookups.
    const fingerprints = certs.map((c) => c.fingerprint);
    const existing = new Set<string>();
    for (let i = 0; i < fingerprints.length; i += DEDUP_CHUNK_SIZE) {
      const chunk = fingerprints.slice(i, i + DEDUP_CHUNK_SIZE);
      const result = await this.client.query({
        query: `SELECT fingerprint FROM certificates WHERE fingerprint IN {fps:Array(String)}`,
        query_params: { fps: chunk },
        format: "JSONEachRow",
      });
      for (const r of await result.json<{ fingerprint: string }>()) {
        existing.add(r.fingerprint);
      }
    }

    const newCerts = certs.filter((c) => !existing.has(c.fingerprint));
    if (newCerts.length === 0) return 0;

    const now = Math.floor(Date.now() / 1000);
    const rows = newCerts.map((cert) => ({
      fingerprint: cert.fingerprint,
      domains: cert.domains,
      domainCount: cert.domains.length,
      issuerOrg: cert.issuerOrg,
      issuerCn: cert.issuerCn,
      subjectCn: cert.subjectCn,
      notBefore: cert.notBefore,
      notAfter: cert.notAfter,
      serialNumber: cert.serialNumber,
      logName: cert.logName,
      logUrl: cert.logUrl,
      certIndex: cert.certIndex,
      certLink: cert.certLink,
      seenAt: cert.seenAt,
      createdAt: now,
    }));

    try {
      await this.client.insert({
        table: "certificates",
        values: rows,
        format: "JSONEachRow",
      });
      return newCerts.length;
    } catch (err) {
      log.error("Batch insert failed with {error}, batch had {batchSize} certs", {
        error: err,
        batchSize: certs.length,
      });
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

    // Build parameterised WHERE clause.
    // Named params p0, p1, ... hold regex patterns; limit/offset are separate.
    const params: Record<string, unknown> = {};
    let paramIdx = 0;

    const addParam = (value: string): string => {
      const key = `p${paramIdx++}`;
      params[key] = value;
      return `{${key}:String}`;
    };

    const termExpr = (term: SearchTerm): string => {
      // Use LIKE '%…%' rather than match() so the ngrambf_v1 skip indexes can prune granules.
      const pattern = addParam(`%${escapeLike(term.text)}%`);
      let expr: string;
      switch (term.column) {
        case "domain":
          expr = `arrayExists(x -> x LIKE ${pattern}, domains)`;
          break;
        case "issuer":
          expr = `coalesce(issuerOrg, '') LIKE ${pattern}`;
          break;
        case "cn":
          expr = `coalesce(subjectCn, '') LIKE ${pattern}`;
          break;
        default:
          expr = `(arrayExists(x -> x LIKE ${pattern}, domains) OR coalesce(issuerOrg, '') LIKE ${pattern} OR coalesce(subjectCn, '') LIKE ${pattern})`;
      }
      return term.negate ? `NOT (${expr})` : expr;
    };

    const groupExpr = (terms: SearchTerm[]): string => {
      const pos = terms.filter((t) => !t.negate);
      if (pos.length === 0) {
        throw new SearchError("Each OR group must contain at least one positive search term.");
      }
      const exprs = terms.map(termExpr);
      return exprs.length === 1 ? exprs[0]! : `(${exprs.join(" AND ")})`;
    };

    const groupExprs = parsed.groups.map(groupExpr);
    let whereClause =
      groupExprs.length === 1 ? groupExprs[0]! : groupExprs.map((e) => `(${e})`).join(" OR ");

    const { dateFilter } = parsed;
    if (dateFilter.after !== undefined) {
      params.ts_after = dateFilter.after;
      whereClause += ` AND seenAt >= {ts_after:Int64}`;
    }
    if (dateFilter.before !== undefined) {
      params.ts_before = dateFilter.before;
      whereClause += ` AND seenAt < {ts_before:Int64}`;
    }

    try {
      const countResult = await this.client.query({
        query: `SELECT count() AS cnt FROM certificates WHERE ${whereClause}`,
        query_params: params,
        format: "JSONEachRow",
      });
      const countRows = await countResult.json<{ cnt: string }>();
      const total = Number(countRows[0]?.cnt ?? "0");

      if (total === 0) {
        return { certificates: [], total: 0, page, limit, totalPages: 0 };
      }

      const rowsResult = await this.client.query({
        query: `SELECT * FROM certificates WHERE ${whereClause} ORDER BY seenAt DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        query_params: { ...params, limit, offset },
        format: "JSONEachRow",
      });
      const rows = await rowsResult.json<CertificateRow>();
      return {
        certificates: rows.map(rowToCertificate),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (err) {
      if (err instanceof SearchError) throw err;
      log.error("Search query failed with {error} for query {query}", {
        error: err,
        query,
      });
      throw new SearchError("Search failed. Try a different query.");
    }
  }

  async getByFingerprint(fingerprint: string): Promise<Certificate | null> {
    // ORDER BY createdAt DESC picks the latest version in case of background duplicates
    const result = await this.client.query({
      query: `SELECT * FROM certificates WHERE fingerprint = {fp:String} ORDER BY createdAt DESC LIMIT 1`,
      query_params: { fp: fingerprint },
      format: "JSONEachRow",
    });
    const rows = await result.json<CertificateRow>();
    return rows[0] ? rowToCertificate(rows[0]) : null;
  }

  async getRecent(limit: number): Promise<Certificate[]> {
    const result = await this.client.query({
      query: `SELECT * FROM certificates ORDER BY seenAt DESC LIMIT {limit:UInt32}`,
      query_params: { limit },
      format: "JSONEachRow",
    });
    return (await result.json<CertificateRow>()).map(rowToCertificate);
  }

  async getStats(): Promise<Stats> {
    const result = await this.client.query({
      query: `
        SELECT
          count()                                          AS total,
          uniqExactIf(issuerOrg, isNotNull(issuerOrg))   AS uniqueIssuers,
          max(seenAt)                                     AS latestSeenAt,
          min(seenAt)                                     AS oldestSeenAt
        FROM certificates
      `,
      format: "JSONEachRow",
    });
    const [row] = await result.json<{
      total: string;
      uniqueIssuers: string;
      latestSeenAt: string | null;
      oldestSeenAt: string | null;
    }>();

    return {
      totalCertificates: Number(row?.total ?? 0),
      uniqueIssuers: Number(row?.uniqueIssuers ?? 0),
      latestSeenAt: row?.latestSeenAt !== null && row?.latestSeenAt !== undefined ? Number(row.latestSeenAt) : null,
      oldestSeenAt: row?.oldestSeenAt !== null && row?.oldestSeenAt !== undefined ? Number(row.oldestSeenAt) : null,
    };
  }

  async cleanup(olderThanDays: number): Promise<number> {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;

    const countResult = await this.client.query({
      query: `SELECT count() AS cnt FROM certificates WHERE seenAt < {cutoff:Int64}`,
      query_params: { cutoff },
      format: "JSONEachRow",
    });
    const countRows = await countResult.json<{ cnt: string }>();
    const deleted = Number(countRows[0]?.cnt ?? "0");

    if (deleted > 0) {
      await this.client.command({
        query: `DELETE FROM certificates WHERE seenAt < {cutoff:Int64}`,
        query_params: { cutoff },
      });
      log.info("Cleanup completed, deleted {deleted} docs older than {olderThanDays} days", {
        deleted,
        olderThanDays,
      });
    }

    return deleted;
  }

  async maintenance(): Promise<void> {
    // Force merging of parts, which triggers ReplacingMergeTree deduplication
    await this.client.command({ query: "OPTIMIZE TABLE certificates FINAL" });
    log.info("ClickHouse maintenance: OPTIMIZE TABLE completed");
  }

  async exportBatch(cursor: string | null, limit: number): Promise<ExportBatch> {
    // Cursor encodes (seenAt, fingerprint) as "seenAt:fingerprint".
    // seenAt is monotonically non-decreasing for new inserts, so records added
    // during migration always land at or after the cursor.
    let whereClause = "";
    const params: Record<string, unknown> = { limit };

    if (cursor !== null) {
      const colonIdx = cursor.indexOf(":");
      const cursorSeenAt = Number(cursor.slice(0, colonIdx));
      const cursorFingerprint = cursor.slice(colonIdx + 1);
      whereClause = `WHERE seenAt > {cs:Int64} OR (seenAt = {cs:Int64} AND fingerprint > {cf:String})`;
      params.cs = cursorSeenAt;
      params.cf = cursorFingerprint;
    }

    const result = await this.client.query({
      query: `SELECT * FROM certificates ${whereClause} ORDER BY seenAt ASC, fingerprint ASC LIMIT {limit:UInt32}`,
      query_params: params,
      format: "JSONEachRow",
    });
    const rows = await result.json<CertificateRow>();
    const certificates = rows.map(rowToCertificate);

    let nextCursor: string | null = null;
    if (rows.length >= limit) {
      const last = rows[rows.length - 1]!;
      nextCursor = `${last.seenAt}:${last.fingerprint}`;
    }

    return { certificates, cursor: nextCursor };
  }

  async getHourlyStats(fromTimestamp: number, toTimestamp: number): Promise<HourlyStats[]> {
    const result = await this.client.query({
      query: `
        SELECT * FROM hourly_stats FINAL
        WHERE periodStart >= {from:Int64} AND periodStart < {to:Int64}
        ORDER BY periodStart ASC
      `,
      query_params: { from: fromTimestamp, to: toTimestamp },
      format: "JSONEachRow",
    });
    return (await result.json<HourlyStatsRow>()).map(rowToHourlyStats);
  }

  async getDailyStats(fromTimestamp: number, toTimestamp: number): Promise<DailyStats[]> {
    const result = await this.client.query({
      query: `
        SELECT * FROM daily_stats FINAL
        WHERE periodStart >= {from:Int64} AND periodStart < {to:Int64}
        ORDER BY periodStart ASC
      `,
      query_params: { from: fromTimestamp, to: toTimestamp },
      format: "JSONEachRow",
    });
    return (await result.json<DailyStatsRow>()).map(rowToDailyStats);
  }

  async computeStatsForPeriod(periodStart: number, granularity: "hourly" | "daily"): Promise<void> {
    const periodEnd = periodStart + (granularity === "hourly" ? 3600 : 86400);

    log.debug("Computing {granularity} stats for period {start} to {end}", {
      granularity,
      start: periodStart,
      end: periodEnd,
    });

    // Basic aggregates — fully server-side
    const basicResult = await this.client.query({
      query: `
        SELECT
          count()                                                        AS total,
          sum(domainCount)                                               AS totalDomainCount,
          uniqExactIf(issuerOrg, isNotNull(issuerOrg))                   AS uniqueIssuers,
          countIf(arrayExists(x -> startsWith(x, '*.'), domains))        AS wildcardCount
        FROM certificates
        WHERE seenAt >= {start:Int64} AND seenAt < {end:Int64}
      `,
      query_params: { start: periodStart, end: periodEnd },
      format: "JSONEachRow",
    });
    const [basic] = await basicResult.json<{
      total: string;
      totalDomainCount: string;
      uniqueIssuers: string;
      wildcardCount: string;
    }>();

    const totalCertificates = Number(basic?.total ?? 0);
    if (totalCertificates === 0) {
      log.debug("No certificates in period, skipping stats computation");
      return;
    }

    const totalDomainCount = Number(basic?.totalDomainCount ?? 0);
    const avgSanCount = totalDomainCount / totalCertificates;
    const wildcardCount = Number(basic?.wildcardCount ?? 0);

    // Top issuers — server-side
    const issuerResult = await this.client.query({
      query: `
        SELECT issuerOrg, count() AS cnt
        FROM certificates
        WHERE seenAt >= {start:Int64} AND seenAt < {end:Int64} AND isNotNull(issuerOrg)
        GROUP BY issuerOrg
        ORDER BY cnt DESC
        LIMIT 100
      `,
      query_params: { start: periodStart, end: periodEnd },
      format: "JSONEachRow",
    });
    const issuerRows = await issuerResult.json<{ issuerOrg: string; cnt: string }>();
    const uniqueIssuers = Number(basic?.uniqueIssuers ?? 0);
    const topIssuers: TopEntry[] = issuerRows.map((r) => ({ value: r.issuerOrg, count: Number(r.cnt) }));

    // Domain extraction — needs PSL, done in JS by streaming (fingerprint, domains) batches
    const twoLevelCounts = new Map<string, number>();
    let lastFingerprint = "";
    let processedCount = 0;

    while (true) {
      const batchResult = await this.client.query({
        query: `
          SELECT fingerprint, domains
          FROM certificates
          WHERE seenAt >= {start:Int64} AND seenAt < {end:Int64}
            AND fingerprint > {cursor:String}
          ORDER BY fingerprint ASC
          LIMIT {batchSize:UInt32}
        `,
        query_params: {
          start: periodStart,
          end: periodEnd,
          cursor: lastFingerprint,
          batchSize: DOMAIN_BATCH_SIZE,
        },
        format: "JSONEachRow",
      });
      const batch = await batchResult.json<{ fingerprint: string; domains: string[] }>();
      if (batch.length === 0) break;

      for (const { domains } of batch) {
        for (const domain of domains) {
          const twoLevel = extractTwoLevelDomain(domain);
          if (twoLevel) {
            twoLevelCounts.set(twoLevel, (twoLevelCounts.get(twoLevel) ?? 0) + 1);
          }
        }
      }

      lastFingerprint = batch[batch.length - 1]!.fingerprint;
      processedCount += batch.length;

      if (totalCertificates > 10000 && processedCount % 10000 === 0) {
        log.debug("Domain extraction progress: {processed}/{total} certificates", {
          processed: processedCount,
          total: totalCertificates,
        });
      }

      if (batch.length < DOMAIN_BATCH_SIZE) break;
    }

    const uniqueDomains = twoLevelCounts.size;
    const topDomains: TopEntry[] = Array.from(twoLevelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)
      .map(([value, count]) => ({ value, count }));

    const computedAt = Math.floor(Date.now() / 1000);

    if (granularity === "hourly") {
      await this.client.insert({
        table: "hourly_stats",
        values: [
          {
            periodStart,
            periodEnd,
            totalCertificates,
            uniqueDomains,
            uniqueIssuers,
            wildcardCount,
            avgSanCount,
            topDomains: JSON.stringify(topDomains),
            topIssuers: JSON.stringify(topIssuers),
            computedAt,
          },
        ],
        format: "JSONEachRow",
      });
    } else {
      const peakHourlyRate = await this.computePeakHourlyRate(periodStart, periodEnd);

      await this.client.insert({
        table: "daily_stats",
        values: [
          {
            periodStart,
            periodEnd,
            totalCertificates,
            uniqueDomains,
            uniqueIssuers,
            wildcardCount,
            avgSanCount,
            peakHourlyRate,
            topDomains: JSON.stringify(topDomains),
            topIssuers: JSON.stringify(topIssuers),
            computedAt,
          },
        ],
        format: "JSONEachRow",
      });
    }

    log.debug("Stored {granularity} stats for period {start}", {
      granularity,
      start: periodStart,
      total: totalCertificates,
      uniqueDomains,
    });
  }

  private async computePeakHourlyRate(dayStart: number, dayEnd: number): Promise<number> {
    const result = await this.client.query({
      query: `
        SELECT max(hourlyCount) AS peak
        FROM (
          SELECT
            intDiv(seenAt - {dayStart:Int64}, 3600) AS hourBucket,
            count()                                  AS hourlyCount
          FROM certificates
          WHERE seenAt >= {dayStart:Int64} AND seenAt < {dayEnd:Int64}
          GROUP BY hourBucket
        )
      `,
      query_params: { dayStart, dayEnd },
      format: "JSONEachRow",
    });
    const [row] = await result.json<{ peak: string | null }>();
    return row?.peak !== null && row?.peak !== undefined ? Number(row.peak) : 0;
  }

  async close(): Promise<void> {
    await this.client.close();
    log.info("ClickHouse connection closed");
  }
}
