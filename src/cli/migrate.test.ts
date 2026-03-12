import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/sqlite/schema.ts";
import { parseArgs, certToNewCert } from "./migrate.ts";
import { createTestDb, makeCert } from "../test-fixtures.ts";
import type { SqliteRepository } from "../db/sqlite/repository.ts";
import type { Certificate } from "../types/certificate.ts";

describe("migrate parseArgs", () => {
  test("parses valid --source and --target", () => {
    const result = parseArgs(["--source", "sqlite", "--target", "mongodb"]);
    expect(result.source).toBe("sqlite");
    expect(result.target).toBe("mongodb");
    expect(result.batchSize).toBe(1000);
  });

  test("parses custom --batch-size", () => {
    const result = parseArgs(["--source", "sqlite", "--target", "mongodb", "--batch-size", "500"]);
    expect(result.batchSize).toBe(500);
  });

  test("throws when --source is missing", () => {
    expect(() => parseArgs(["--target", "mongodb"])).toThrow("Usage:");
  });

  test("throws when --target is missing", () => {
    expect(() => parseArgs(["--source", "sqlite"])).toThrow("Usage:");
  });

  test("throws when no args provided", () => {
    expect(() => parseArgs([])).toThrow("Usage:");
  });

  test("throws on invalid source store type", () => {
    expect(() => parseArgs(["--source", "postgres", "--target", "mongodb"])).toThrow("Invalid source store");
  });

  test("throws on invalid target store type", () => {
    expect(() => parseArgs(["--source", "sqlite", "--target", "redis"])).toThrow("Invalid target store");
  });

  test("throws when source equals target", () => {
    expect(() => parseArgs(["--source", "sqlite", "--target", "sqlite"])).toThrow("must be different");
  });

  test("throws on non-numeric batch size", () => {
    expect(() => parseArgs(["--source", "sqlite", "--target", "mongodb", "--batch-size", "abc"])).toThrow("positive number");
  });

  test("throws on zero batch size", () => {
    expect(() => parseArgs(["--source", "sqlite", "--target", "mongodb", "--batch-size", "0"])).toThrow("positive number");
  });

  test("throws on negative batch size", () => {
    expect(() => parseArgs(["--source", "sqlite", "--target", "mongodb", "--batch-size", "-5"])).toThrow("positive number");
  });
});

describe("certToNewCert", () => {
  test("strips id, domainCount, and createdAt from Certificate", () => {
    const cert: Certificate = {
      id: 42,
      fingerprint: "abc",
      domains: ["a.com", "b.com"],
      domainCount: 2,
      issuerOrg: "TestCA",
      issuerCn: "TestCA CN",
      subjectCn: "a.com",
      notBefore: 1000,
      notAfter: 2000,
      serialNumber: "SN1",
      logName: "log",
      logUrl: "https://log.test",
      certIndex: 1,
      certLink: "https://log.test/1",
      seenAt: 3000,
      createdAt: 4000,
    };

    const result = certToNewCert(cert);

    expect(result).toEqual({
      fingerprint: "abc",
      domains: ["a.com", "b.com"],
      issuerOrg: "TestCA",
      issuerCn: "TestCA CN",
      subjectCn: "a.com",
      notBefore: 1000,
      notAfter: 2000,
      serialNumber: "SN1",
      logName: "log",
      logUrl: "https://log.test",
      certIndex: 1,
      certLink: "https://log.test/1",
      seenAt: 3000,
    });

    expect("id" in result).toBe(false);
    expect("domainCount" in result).toBe(false);
    expect("createdAt" in result).toBe(false);
  });

  test("preserves null fields", () => {
    const cert: Certificate = {
      id: 1,
      fingerprint: "def",
      domains: [],
      domainCount: 0,
      issuerOrg: null,
      issuerCn: null,
      subjectCn: null,
      notBefore: 0,
      notAfter: 0,
      serialNumber: "SN0",
      logName: null,
      logUrl: null,
      certIndex: null,
      certLink: null,
      seenAt: 0,
      createdAt: 0,
    };

    const result = certToNewCert(cert);
    expect(result.issuerOrg).toBeNull();
    expect(result.issuerCn).toBeNull();
    expect(result.subjectCn).toBeNull();
    expect(result.logName).toBeNull();
    expect(result.logUrl).toBeNull();
    expect(result.certIndex).toBeNull();
    expect(result.certLink).toBeNull();
  });
});

describe("migration data flow", () => {
  let sourceDb: Kysely<Database>;
  let targetDb: Kysely<Database>;
  let sourceRepo: SqliteRepository;
  let targetRepo: SqliteRepository;

  beforeEach(async () => {
    const src = await createTestDb();
    const tgt = await createTestDb();
    sourceDb = src.db;
    sourceRepo = src.repo;
    targetDb = tgt.db;
    targetRepo = tgt.repo;
  });

  afterEach(async () => {
    await sourceDb.destroy();
    await targetDb.destroy();
  });

  test("exports and imports a full batch via exportBatch → certToNewCert → insertBatch", async () => {
    const certs = Array.from({ length: 5 }, () => makeCert());
    await sourceRepo.insertBatch(certs);

    const batch = await sourceRepo.exportBatch(null, 100);
    expect(batch.certificates).toHaveLength(5);

    const newCerts = batch.certificates.map(certToNewCert);
    await targetRepo.insertBatch(newCerts);

    const targetRecent = await targetRepo.getRecent(10);
    expect(targetRecent).toHaveLength(5);

    const sourceFingerprints = new Set(certs.map((c) => c.fingerprint));
    for (const cert of targetRecent) {
      expect(sourceFingerprints.has(cert.fingerprint)).toBe(true);
    }
  });

  test("cursor-based pagination migrates all data across multiple batches", async () => {
    const certs = Array.from({ length: 7 }, () => makeCert());
    await sourceRepo.insertBatch(certs);

    let cursor: number | null = null;
    let totalMigrated = 0;
    let batchCount = 0;

    while (true) {
      const batch = await sourceRepo.exportBatch(cursor, 3);
      if (batch.certificates.length === 0) break;

      batchCount++;
      const newCerts = batch.certificates.map(certToNewCert);
      await targetRepo.insertBatch(newCerts);

      cursor = batch.cursor;
      if (cursor === null) break;
    }

    expect(batchCount).toBe(3); // 3 + 3 + 1

    const targetStats = await targetRepo.getStats();
    expect(targetStats.totalCertificates).toBe(7);
  });

  test("re-running migration is idempotent (fingerprint dedup)", async () => {
    const certs = Array.from({ length: 3 }, () => makeCert());
    await sourceRepo.insertBatch(certs);

    // First migration
    const batch = await sourceRepo.exportBatch(null, 100);
    await targetRepo.insertBatch(batch.certificates.map(certToNewCert));

    // Second migration (same data)
    const batch2 = await sourceRepo.exportBatch(null, 100);
    const inserted = await targetRepo.insertBatch(batch2.certificates.map(certToNewCert));
    expect(inserted).toBe(0);

    const stats = await targetRepo.getStats();
    expect(stats.totalCertificates).toBe(3);
  });
});
