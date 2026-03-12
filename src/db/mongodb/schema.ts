import type { ObjectId } from "mongodb";

export interface CertificateDocument {
  _id: ObjectId;
  numericId: number;
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

export interface CounterDocument {
  _id: string;
  seq: number;
}
