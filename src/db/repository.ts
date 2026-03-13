import type { Certificate, ExportBatch, NewCertificate, SearchOpts, SearchResult, Stats } from "../types/certificate.ts";

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

  /** Get single certificate by numeric ID. Returns null if not found. */
  getById(id: number): Promise<Certificate | null>;

  /** Get most recently inserted certificates. */
  getRecent(limit: number): Promise<Certificate[]>;

  /** Get aggregate statistics about stored certificates. */
  getStats(): Promise<Stats>;

  /** Delete certificates older than specified days. Returns count of deleted rows. */
  cleanup(olderThanDays: number): Promise<number>;

  /** Run database maintenance operations (optimize, checkpoint, analyze). */
  maintenance(): Promise<void>;

  /** Export certificates in batches for data migration. Uses cursor-based pagination. */
  exportBatch(cursor: number | null, limit: number): Promise<ExportBatch>;

  /** Close database connection and run final cleanup. */
  close(): Promise<void>;
}
