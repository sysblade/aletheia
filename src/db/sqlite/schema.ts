import type { Generated, Insertable, Selectable, ColumnType } from "kysely";

/**
 * Main certificates table schema.
 * Stores certificate metadata with JSON-encoded domains array.
 */
export interface CertificatesTable {
  id: Generated<number>;
  fingerprint: string;
  domains: string;
  domain_count: number;
  issuer_org: string | null;
  issuer_cn: string | null;
  subject_cn: string | null;
  not_before: number;
  not_after: number;
  serial_number: string;
  log_name: string | null;
  log_url: string | null;
  cert_index: number | null;
  cert_link: string | null;
  seen_at: number;
  created_at: ColumnType<number, number | undefined, never>;
}

/**
 * FTS5 virtual table for full-text search on certificates.
 * Synchronized with certificates table via triggers.
 */
export interface CertificatesFtsTable {
  domains: string;
  issuer_org: string;
  subject_cn: string;
}

/**
 * Hourly aggregated statistics table.
 * Stores pre-computed hourly metrics and top-N lists as JSON.
 */
export interface HourlyStatsTable {
  id: Generated<number>;
  period_start: number;
  period_end: number;
  total_certificates: number;
  unique_domains: number;
  unique_issuers: number;
  wildcard_count: number;
  avg_san_count: number;
  top_domains: string;
  top_issuers: string;
  computed_at: ColumnType<number, number | undefined, never>;
}

/**
 * Daily aggregated statistics table.
 * Stores pre-computed daily metrics and top-N lists as JSON.
 */
export interface DailyStatsTable {
  id: Generated<number>;
  period_start: number;
  period_end: number;
  total_certificates: number;
  unique_domains: number;
  unique_issuers: number;
  wildcard_count: number;
  avg_san_count: number;
  peak_hourly_rate: number;
  top_domains: string;
  top_issuers: string;
  computed_at: ColumnType<number, number | undefined, never>;
}

/**
 * Generic key-value metadata table for system state (e.g. last maintenance timestamp).
 */
export interface MetadataTable {
  key: string;
  value: string;
  updated_at: number;
}

/** Kysely database schema definition. */
export interface Database {
  certificates: CertificatesTable;
  certificates_fts: CertificatesFtsTable;
  hourly_stats: HourlyStatsTable;
  daily_stats: DailyStatsTable;
  metadata: MetadataTable;
}

/** Certificate row as selected from database. */
export type CertificateRow = Selectable<CertificatesTable>;

/** Certificate row for insertion (omits generated fields). */
export type NewCertificateRow = Insertable<CertificatesTable>;

/** Hourly stats row as selected from database. */
export type HourlyStatsRow = Selectable<HourlyStatsTable>;

/** Hourly stats row for insertion (omits generated fields). */
export type NewHourlyStatsRow = Insertable<HourlyStatsTable>;

/** Daily stats row as selected from database. */
export type DailyStatsRow = Selectable<DailyStatsTable>;

/** Daily stats row for insertion (omits generated fields). */
export type NewDailyStatsRow = Insertable<DailyStatsTable>;
