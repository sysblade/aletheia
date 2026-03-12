import type { Generated, Insertable, Selectable, ColumnType } from "kysely";

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

export interface CertificatesFtsTable {
  domains: string;
  issuer_org: string;
  subject_cn: string;
}

export interface Database {
  certificates: CertificatesTable;
  certificates_fts: CertificatesFtsTable;
}

export type CertificateRow = Selectable<CertificatesTable>;
export type NewCertificateRow = Insertable<CertificatesTable>;
