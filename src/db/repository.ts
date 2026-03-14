import type { Certificate, DailyStats, ExportBatch, HourlyStats, NewCertificate, SearchOpts, SearchProgress, SearchResult, Stats } from "../types/certificate.ts";

/**
 * User-friendly error thrown when search query parsing or execution fails.
 * Caught by HTTP error handler to return 400 with error message.
 */
export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchError";
  }
}

/**
 * Repository interface for certificate storage and retrieval.
 * Implementations include SQLite (SqliteRepository) and MongoDB (MongoRepository).
 */
export interface CertificateRepository {
  /** Insert certificates in batch, skipping duplicates. Returns count of inserted rows. */
  insertBatch(certs: NewCertificate[]): Promise<number>;

  /** Search certificates using FTS query. Supports column filters (domain:, issuer:, cn:) and negation (-term). */
  search(query: string, opts: SearchOpts): Promise<SearchResult>;

  /**
   * Optional: search with streaming progress callbacks during the COUNT query.
   * Only implemented by backends that support streaming (e.g. ClickHouse).
   * Falls back to a single `result` SSE event when absent.
   */
  searchWithProgress?(
    query: string,
    opts: SearchOpts,
    onProgress: (p: SearchProgress) => void,
  ): Promise<SearchResult>;

  /** Get single certificate by fingerprint. Returns null if not found. */
  getByFingerprint(fingerprint: string): Promise<Certificate | null>;

  /** Get most recently inserted certificates. */
  getRecent(limit: number): Promise<Certificate[]>;

  /** Get aggregate statistics about stored certificates. */
  getStats(): Promise<Stats>;

  /** Delete certificates older than specified days. Returns count of deleted rows. */
  cleanup(olderThanDays: number): Promise<number>;

  /** Run database maintenance operations (optimize, checkpoint, analyze). */
  maintenance(): Promise<void>;

  /** Export certificates in batches for data migration. Uses cursor-based pagination (fingerprint-ordered). */
  exportBatch(cursor: string | null, limit: number): Promise<ExportBatch>;

  /** Get hourly stats for a time range. Returns empty array if no data. */
  getHourlyStats(fromTimestamp: number, toTimestamp: number): Promise<HourlyStats[]>;

  /** Get daily stats for a time range. Returns empty array if no data. */
  getDailyStats(fromTimestamp: number, toTimestamp: number): Promise<DailyStats[]>;

  /** Compute and store stats for specified period. Overwrites existing stats. */
  computeStatsForPeriod(periodStart: number, granularity: "hourly" | "daily"): Promise<void>;

  /** Close database connection and run final cleanup. */
  close(): Promise<void>;
}
