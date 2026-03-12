import { sql } from "kysely";
import type { Kysely } from "kysely";
import { SearchError, type CertificateRepository } from "../repository.ts";
import { parseSearchQuery } from "../search-query.ts";
import type { SearchTerm } from "../search-query.ts";
import type { Certificate, ExportBatch, NewCertificate, SearchOpts, SearchResult, Stats } from "../../types/certificate.ts";
import type { Database, CertificateRow } from "./schema.ts";
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

  async close(): Promise<void> {
    await sql`PRAGMA optimize`.execute(this.db);
    await this.db.destroy();
    log.info("Database connection closed");
  }
}
