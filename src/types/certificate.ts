/**
 * Stored certificate record with database ID and timestamps.
 * Represents a certificate that has been persisted to the repository.
 */
export interface Certificate {
  fingerprint: string;
  domains: string[];
  domainCount: number;
  issuerOrg: string | null;
  issuerCn: string | null;
  subjectCn: string | null;
  notBefore: number;
  notAfter: number;
  serialNumber: string;
  logName: string | null;
  logUrl: string | null;
  certIndex: number | null;
  certLink: string | null;
  seenAt: number;
  createdAt: number;
}

/**
 * Certificate data for insertion into the repository.
 * Does not include database-generated fields (id, createdAt).
 */
export interface NewCertificate {
  fingerprint: string;
  domains: string[];
  issuerOrg: string | null;
  issuerCn: string | null;
  subjectCn: string | null;
  notBefore: number;
  notAfter: number;
  serialNumber: string;
  logName: string | null;
  logUrl: string | null;
  certIndex: number | null;
  certLink: string | null;
  seenAt: number;
}

/**
 * Progress update emitted during a streaming search COUNT query.
 * Only produced by backends that support streaming (e.g. ClickHouse).
 */
export interface SearchProgress {
  readRows: number;
  totalRows?: number; // undefined when ClickHouse can't precompute
  readBytes: number;
  elapsedMs: number;
}

/**
 * Pagination options for certificate search queries.
 */
export interface SearchOpts {
  page: number;
  limit: number;
  /**
   * Total result count from a previous page-1 query.
   * When provided on page > 1, the COUNT query is skipped entirely.
   */
  knownTotal?: number;
  /**
   * Cursor for forward pagination: "seenAt:fingerprint" of the last row
   * from the previous page. When provided, replaces OFFSET with a keyset
   * WHERE condition for O(1) page fetching regardless of page depth.
   */
  cursor?: string;
}

/**
 * Paginated search results containing matching certificates and pagination metadata.
 */
export interface SearchResult {
  certificates: Certificate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Aggregate statistics about stored certificates.
 */
export interface Stats {
  totalCertificates: number;
  uniqueIssuers: number;
  latestSeenAt: number | null;
  oldestSeenAt: number | null;
}

/**
 * Batch of certificates for export with cursor-based pagination.
 * Cursor is null when no more certificates remain.
 */
export interface ExportBatch {
  certificates: Certificate[];
  cursor: string | null;
}

/**
 * Entry in top-N aggregated lists (domains or issuers).
 */
export interface TopEntry {
  value: string;
  count: number;
}

/**
 * Hourly aggregated statistics.
 */
export interface HourlyStats {
  id: number;
  periodStart: number;
  periodEnd: number;
  totalCertificates: number;
  uniqueDomains: number;
  uniqueIssuers: number;
  wildcardCount: number;
  avgSanCount: number;
  topDomains: TopEntry[];
  topIssuers: TopEntry[];
  computedAt: number;
}

/**
 * Daily aggregated statistics.
 * Extends HourlyStats with peak hourly rate metric.
 */
export interface DailyStats extends HourlyStats {
  peakHourlyRate: number;
}
