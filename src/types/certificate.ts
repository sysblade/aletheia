export interface Certificate {
  id: number;
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

export interface SearchOpts {
  page: number;
  limit: number;
}

export interface SearchResult {
  certificates: Certificate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Stats {
  totalCertificates: number;
  uniqueIssuers: number;
  latestSeenAt: number | null;
  oldestSeenAt: number | null;
}

export interface ExportBatch {
  certificates: Certificate[];
  cursor: number | null;
}
