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

/** Kysely database schema definition. */
export interface Database {
  certificates: CertificatesTable;
  certificates_fts: CertificatesFtsTable;
}

/** Certificate row as selected from database. */
export type CertificateRow = Selectable<CertificatesTable>;

/** Certificate row for insertion (omits generated fields). */
export type NewCertificateRow = Insertable<CertificatesTable>;
