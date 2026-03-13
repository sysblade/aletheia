/**
 * ClickHouse row type for the certificates table.
 * Int64 fields arrive as strings in JSONEachRow format — convert with Number().
 */
export interface CertificateRow {
  fingerprint: string;
  domains: string[];
  domainCount: number;
  issuerOrg: string | null;
  issuerCn: string | null;
  subjectCn: string | null;
  notBefore: string;   // Int64 serialised as string
  notAfter: string;
  serialNumber: string;
  logName: string | null;
  logUrl: string | null;
  certIndex: string | null;  // Nullable(Int64)
  certLink: string | null;
  seenAt: string;
  createdAt: string;
}

export interface HourlyStatsRow {
  periodStart: string;
  periodEnd: string;
  totalCertificates: string;
  uniqueDomains: string;
  uniqueIssuers: string;
  wildcardCount: string;
  avgSanCount: number;
  topDomains: string;
  topIssuers: string;
  computedAt: string;
}

export interface DailyStatsRow extends HourlyStatsRow {
  peakHourlyRate: string;
}
