import type { Certificate, ExportBatch, NewCertificate, SearchOpts, SearchResult, Stats } from "../types/certificate.ts";

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchError";
  }
}

export interface CertificateRepository {
  insertBatch(certs: NewCertificate[]): Promise<number>;
  search(query: string, opts: SearchOpts): Promise<SearchResult>;
  getById(id: number): Promise<Certificate | null>;
  getRecent(limit: number): Promise<Certificate[]>;
  getStats(): Promise<Stats>;
  cleanup(olderThanDays: number): Promise<number>;
  exportBatch(cursor: number | null, limit: number): Promise<ExportBatch>;
  close(): Promise<void>;
}
