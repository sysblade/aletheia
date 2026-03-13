import type { ObjectId } from "mongodb";

/**
 * MongoDB document schema for certificate storage.
 * Includes numeric ID for compatibility with repository interface.
 */
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

/**
 * Counter document for generating sequential numeric IDs.
 * Uses atomic findAndModify to ensure ID uniqueness across concurrent inserts.
 */
export interface CounterDocument {
  _id: string;
  seq: number;
}
