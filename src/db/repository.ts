import type { Certificate, NewCertificate, SearchOpts, SearchResult, Stats } from "../types/certificate.ts";

export interface CertificateRepository {
  insertBatch(certs: NewCertificate[]): Promise<number>;
  search(query: string, opts: SearchOpts): Promise<SearchResult>;
  getById(id: number): Promise<Certificate | null>;
  getStats(): Promise<Stats>;
  cleanup(olderThanDays: number): Promise<number>;
  close(): Promise<void>;
}
