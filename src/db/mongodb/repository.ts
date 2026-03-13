import type { Db, Collection, Filter } from "mongodb";
import { MongoBulkWriteError } from "mongodb";
import { SearchError, type CertificateRepository } from "../repository.ts";
import { parseSearchQuery } from "../search-query.ts";
import type { SearchTerm } from "../search-query.ts";
import type { Certificate, ExportBatch, NewCertificate, SearchOpts, SearchResult, Stats } from "../../types/certificate.ts";
import type { CertificateDocument, CounterDocument } from "./schema.ts";
import { getLogger } from "../../utils/logger.ts";

const log = getLogger(["ctlog", "mongodb", "repository"]);

function docToCertificate(doc: CertificateDocument): Certificate {
  return {
    id: doc.numericId,
    fingerprint: doc.fingerprint,
    domains: doc.domains,
    domainCount: doc.domainCount,
    issuerOrg: doc.issuerOrg,
    issuerCn: doc.issuerCn,
    subjectCn: doc.subjectCn,
    notBefore: doc.notBefore,
    notAfter: doc.notAfter,
    serialNumber: doc.serialNumber,
    logName: doc.logName,
    logUrl: doc.logUrl,
    certIndex: doc.certIndex,
    certLink: doc.certLink,
    seenAt: doc.seenAt,
    createdAt: doc.createdAt,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * MongoDB-based certificate repository implementation.
 * Uses regex-based search and atomic counter for numeric IDs.
 */
export class MongoRepository implements CertificateRepository {
  private certs: Collection<CertificateDocument>;
  private counters: Collection<CounterDocument>;

  constructor(private db: Db) {
    this.certs = db.collection<CertificateDocument>("certificates");
    this.counters = db.collection<CounterDocument>("counters");
  }

  private async nextIdRange(count: number): Promise<number> {
    const result = await this.counters.findOneAndUpdate(
      { _id: "certificates" },
      { $inc: { seq: count } },
      { returnDocument: "after" },
    );
    if (!result) throw new Error("Failed to allocate ID range");
    return result.seq - count + 1;
  }

  async insertBatch(certs: NewCertificate[]): Promise<number> {
    if (certs.length === 0) return 0;

    const startId = await this.nextIdRange(certs.length);
    const now = Math.floor(Date.now() / 1000);

    const docs: Omit<CertificateDocument, "_id">[] = certs.map((cert, i) => ({
      numericId: startId + i,
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
      const result = await this.certs.insertMany(docs as CertificateDocument[], { ordered: false });
      return result.insertedCount;
    } catch (err: unknown) {
      if (err instanceof MongoBulkWriteError) {
        return err.result.insertedCount;
      }
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

    function termFilter(term: SearchTerm): object {
      const pattern = escapeRegex(term.text);
      const re = { $regex: pattern, $options: "i" };

      if (term.negate) {
        switch (term.column) {
          case "domain": return { domains: { $not: re } };
          case "issuer": return { issuerOrg: { $not: re } };
          case "cn": return { subjectCn: { $not: re } };
          default: return { $nor: [{ domains: re }, { issuerOrg: re }, { subjectCn: re }] };
        }
      }

      switch (term.column) {
        case "domain": return { domains: { $elemMatch: re } };
        case "issuer": return { issuerOrg: re };
        case "cn": return { subjectCn: re };
        default: return { $or: [{ domains: { $elemMatch: re } }, { issuerOrg: re }, { subjectCn: re }] };
      }
    }

    function groupFilter(terms: SearchTerm[]): object {
      const conditions = terms.map(termFilter);
      return conditions.length === 1 ? conditions[0]! : { $and: conditions };
    }

    try {
      const groupFilters = parsed.groups.map(groupFilter);
      const filter: Filter<CertificateDocument> =
        groupFilters.length === 1
          ? (groupFilters[0] as Filter<CertificateDocument>)
          : ({ $or: groupFilters } as Filter<CertificateDocument>);

      const [total, docs] = await Promise.all([
        this.certs.countDocuments(filter),
        this.certs.find(filter).sort({ seenAt: -1 }).skip(offset).limit(limit).toArray(),
      ]);

      return {
        certificates: docs.map(docToCertificate),
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
    const doc = await this.certs.findOne({ numericId: id });
    return doc ? docToCertificate(doc) : null;
  }

  async getRecent(limit: number): Promise<Certificate[]> {
    const docs = await this.certs
      .find()
      .sort({ numericId: -1 })
      .limit(limit)
      .toArray();
    return docs.map(docToCertificate);
  }

  async getStats(): Promise<Stats> {
    const pipeline = [
      {
        $facet: {
          total: [{ $count: "count" }],
          uniqueIssuers: [
            { $group: { _id: "$issuerOrg" } },
            { $count: "count" },
          ],
          seenRange: [
            {
              $group: {
                _id: null,
                latest: { $max: "$seenAt" },
                oldest: { $min: "$seenAt" },
              },
            },
          ],
        },
      },
    ];

    const [result] = await this.certs.aggregate(pipeline).toArray();

    const total = result?.total[0]?.count ?? 0;
    const uniqueIssuers = result?.uniqueIssuers[0]?.count ?? 0;
    const latest = result?.seenRange[0]?.latest ?? null;
    const oldest = result?.seenRange[0]?.oldest ?? null;

    return {
      totalCertificates: total,
      uniqueIssuers,
      latestSeenAt: latest,
      oldestSeenAt: oldest,
    };
  }

  async cleanup(olderThanDays: number): Promise<number> {
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;
    const result = await this.certs.deleteMany({ seenAt: { $lt: cutoff } });
    const deleted = result.deletedCount;

    if (deleted > 0) {
      log.info("Cleanup completed, deleted {deleted} docs older than {olderThanDays} days", { deleted, olderThanDays });
    }

    return deleted;
  }

  async maintenance(): Promise<void> {
    // MongoDB handles most maintenance automatically
    // No manual optimization needed for most deployments
    log.debug("Maintenance called (no-op for MongoDB)");
  }

  async exportBatch(cursor: number | null, limit: number): Promise<ExportBatch> {
    const filter = cursor !== null ? { numericId: { $gt: cursor } } : {};

    const docs = await this.certs
      .find(filter)
      .sort({ numericId: 1 })
      .limit(limit)
      .toArray();

    const certificates = docs.map(docToCertificate);
    const nextCursor = docs.length < limit ? null : docs[docs.length - 1]!.numericId;

    return { certificates, cursor: nextCursor };
  }

  async close(): Promise<void> {
    await this.db.client.close();
    log.info("MongoDB connection closed");
  }
}
