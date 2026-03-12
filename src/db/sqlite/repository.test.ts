import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "./schema.ts";
import { SqliteRepository } from "./repository.ts";
import { createTestDb, makeCert } from "../../test-fixtures.ts";

describe("SqliteRepository", () => {
  let db: Kysely<Database>;
  let repo: SqliteRepository;

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    repo = testDb.repo;
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("insertBatch", () => {
    test("inserts rows into the database", async () => {
      const certs = [makeCert(), makeCert(), makeCert()];
      await repo.insertBatch(certs);
      const recent = await repo.getRecent(10);
      expect(recent).toHaveLength(3);
    });

    test("deduplicates on fingerprint", async () => {
      const cert = makeCert();
      const dup = { ...makeCert(), fingerprint: cert.fingerprint };
      await repo.insertBatch([cert, dup]);
      const recent = await repo.getRecent(10);
      expect(recent).toHaveLength(1);
    });

    test("handles >50 rows (chunking)", async () => {
      const certs = Array.from({ length: 75 }, () => makeCert());
      await repo.insertBatch(certs);
      const stats = await repo.getStats();
      expect(stats.totalCertificates).toBe(75);
    });

    test("stores and parses JSON domains correctly", async () => {
      const cert = makeCert({ domains: ["a.com", "b.com", "c.com"] });
      await repo.insertBatch([cert]);
      const recent = await repo.getRecent(1);
      expect(recent[0]!.domains).toEqual(["a.com", "b.com", "c.com"]);
    });

    test("returns 0 for empty batch", async () => {
      const inserted = await repo.insertBatch([]);
      expect(inserted).toBe(0);
    });
  });

  describe("getById", () => {
    test("returns cert by id", async () => {
      const cert = makeCert();
      await repo.insertBatch([cert]);
      const recent = await repo.getRecent(1);
      const id = recent[0]!.id;
      const found = await repo.getById(id);
      expect(found).not.toBeNull();
      expect(found!.fingerprint).toBe(cert.fingerprint);
    });

    test("returns null for nonexistent id", async () => {
      const found = await repo.getById(9999);
      expect(found).toBeNull();
    });
  });

  describe("getRecent", () => {
    test("ordered by id DESC, respects limit", async () => {
      const certs = Array.from({ length: 5 }, () => makeCert());
      await repo.insertBatch(certs);
      const recent = await repo.getRecent(3);
      expect(recent).toHaveLength(3);
      expect(recent[0]!.id).toBeGreaterThan(recent[1]!.id);
      expect(recent[1]!.id).toBeGreaterThan(recent[2]!.id);
    });

    test("returns empty when no data", async () => {
      const recent = await repo.getRecent(10);
      expect(recent).toEqual([]);
    });
  });

  describe("search (FTS5)", () => {
    test("finds by domain", async () => {
      const cert = makeCert({ domains: ["unique-search-domain.example.com"] });
      await repo.insertBatch([cert]);
      const result = await repo.search("unique-search-domain", { page: 1, limit: 50 });
      expect(result.total).toBe(1);
      expect(result.certificates[0]!.fingerprint).toBe(cert.fingerprint);
    });

    test("finds by issuer", async () => {
      const cert = makeCert({ issuerOrg: "UniqueIssuerOrg" });
      await repo.insertBatch([cert]);
      const result = await repo.search("UniqueIssuerOrg", { page: 1, limit: 50 });
      expect(result.total).toBe(1);
    });

    test("finds by subject CN", async () => {
      const cert = makeCert({ subjectCn: "unique-subject.example.org" });
      await repo.insertBatch([cert]);
      const result = await repo.search("unique-subject.example.org", { page: 1, limit: 50 });
      expect(result.total).toBe(1);
    });

    test("returns empty for no match", async () => {
      await repo.insertBatch([makeCert()]);
      const result = await repo.search("nonexistentxyzzy", { page: 1, limit: 50 });
      expect(result.total).toBe(0);
      expect(result.certificates).toEqual([]);
    });

    test("respects pagination", async () => {
      const certs = Array.from({ length: 5 }, (_, i) =>
        makeCert({ domains: [`pagintest.example.com`], fingerprint: `pagintest${i.toString().padStart(58, "0")}` }),
      );
      await repo.insertBatch(certs);
      const page1 = await repo.search("pagintest", { page: 1, limit: 2 });
      expect(page1.certificates).toHaveLength(2);
      expect(page1.totalPages).toBe(3);
      const page2 = await repo.search("pagintest", { page: 2, limit: 2 });
      expect(page2.certificates).toHaveLength(2);
      expect(page2.page).toBe(2);
    });

    test("sanitizes null bytes and double quotes", async () => {
      const cert = makeCert({ domains: ["sanitize-test.example.com"] });
      await repo.insertBatch([cert]);
      const result = await repo.search('sanitize\0"test', { page: 1, limit: 50 });
      expect(result).toBeDefined();
    });

    test("domain: prefix scopes search to domains only", async () => {
      const certWithMatchingDomain = makeCert({ domains: ["scopetest-domain.example.com"], issuerOrg: "Other CA" });
      const certWithMatchingIssuer = makeCert({ domains: ["unrelated.example.com"], issuerOrg: "scopetest-issuer CA" });
      await repo.insertBatch([certWithMatchingDomain, certWithMatchingIssuer]);
      const result = await repo.search("domain:scopetest-domain", { page: 1, limit: 50 });
      expect(result.total).toBe(1);
      expect(result.certificates[0]!.fingerprint).toBe(certWithMatchingDomain.fingerprint);
    });

    test("issuer: prefix scopes search to issuer only", async () => {
      const certA = makeCert({ domains: ["issuerscope.example.com"], issuerOrg: "TargetIssuerOrg" });
      const certB = makeCert({ domains: ["TargetIssuerOrg.example.com"], issuerOrg: "Other CA" });
      await repo.insertBatch([certA, certB]);
      const result = await repo.search("issuer:TargetIssuerOrg", { page: 1, limit: 50 });
      expect(result.total).toBe(1);
      expect(result.certificates[0]!.fingerprint).toBe(certA.fingerprint);
    });

    test("multi-term AND finds cert containing all terms", async () => {
      const cert = makeCert({ domains: ["multiterm-alpha-beta.example.com"] });
      await repo.insertBatch([cert]);
      const result = await repo.search("multiterm alpha", { page: 1, limit: 50 });
      expect(result.total).toBe(1);
    });

    test("multi-term AND excludes cert missing any term", async () => {
      const certA = makeCert({ domains: ["onlyfoo.example.com"] });
      const certB = makeCert({ domains: ["onlybar.example.com"] });
      await repo.insertBatch([certA, certB]);
      const result = await repo.search("onlyfoo onlybar", { page: 1, limit: 50 });
      expect(result.total).toBe(0);
    });

    test("throws SearchError for empty terms after prefix", async () => {
      await expect(repo.search("domain:", { page: 1, limit: 50 })).rejects.toThrow("at least one search term");
    });

    test("OR finds certs matching either group", async () => {
      const certA = makeCert({ domains: ["orleft-unique.example.com"] });
      const certB = makeCert({ domains: ["orright-unique.example.com"] });
      const certC = makeCert({ domains: ["unrelated-zzzz.example.com"] });
      await repo.insertBatch([certA, certB, certC]);
      const result = await repo.search("orleft-unique OR orright-unique", { page: 1, limit: 50 });
      expect(result.total).toBe(2);
    });

    test("OR with column prefix on each side", async () => {
      const certA = makeCert({ domains: ["orcolA.example.com"], issuerOrg: "Other CA" });
      const certB = makeCert({ domains: ["orcolB.example.com"], issuerOrg: "Other CA" });
      await repo.insertBatch([certA, certB]);
      const result = await repo.search("domain:orcolA OR domain:orcolB", { page: 1, limit: 50 });
      expect(result.total).toBe(2);
    });

    test("-term excludes matching certs", async () => {
      const certA = makeCert({ domains: ["excl-target.example.com"] });
      const certB = makeCert({ domains: ["excl-other.example.com"] });
      await repo.insertBatch([certA, certB]);
      const result = await repo.search("excl -target", { page: 1, limit: 50 });
      expect(result.total).toBe(1);
      expect(result.certificates[0]!.fingerprint).toBe(certB.fingerprint);
    });

    test("throws SearchError when group has only negated terms", async () => {
      await expect(repo.search("-onlyneg", { page: 1, limit: 50 })).rejects.toThrow();
    });
  });

  describe("getStats", () => {
    test("returns correct counts and unique issuers", async () => {
      await repo.insertBatch([
        makeCert({ issuerOrg: "Issuer A" }),
        makeCert({ issuerOrg: "Issuer B" }),
        makeCert({ issuerOrg: "Issuer A" }),
      ]);
      const stats = await repo.getStats();
      expect(stats.totalCertificates).toBe(3);
      expect(stats.uniqueIssuers).toBe(2);
    });

    test("returns zeros when empty", async () => {
      const stats = await repo.getStats();
      expect(stats.totalCertificates).toBe(0);
      expect(stats.uniqueIssuers).toBe(0);
      expect(stats.latestSeenAt).toBeNull();
      expect(stats.oldestSeenAt).toBeNull();
    });
  });

  describe("exportBatch", () => {
    test("returns empty batch with null cursor on empty DB", async () => {
      const batch = await repo.exportBatch(null, 100);
      expect(batch.certificates).toEqual([]);
      expect(batch.cursor).toBeNull();
    });

    test("returns all rows when limit exceeds row count", async () => {
      const certs = Array.from({ length: 3 }, () => makeCert());
      await repo.insertBatch(certs);

      const batch = await repo.exportBatch(null, 100);
      expect(batch.certificates).toHaveLength(3);
      expect(batch.cursor).toBeNull();
    });

    test("returns rows in ascending id order", async () => {
      const certs = Array.from({ length: 5 }, () => makeCert());
      await repo.insertBatch(certs);

      const batch = await repo.exportBatch(null, 10);
      for (let i = 1; i < batch.certificates.length; i++) {
        expect(batch.certificates[i]!.id).toBeGreaterThan(batch.certificates[i - 1]!.id);
      }
    });

    test("respects limit and returns a cursor", async () => {
      const certs = Array.from({ length: 5 }, () => makeCert());
      await repo.insertBatch(certs);

      const batch = await repo.exportBatch(null, 3);
      expect(batch.certificates).toHaveLength(3);
      expect(batch.cursor).not.toBeNull();
    });

    test("cursor-based pagination returns all data", async () => {
      const certs = Array.from({ length: 7 }, () => makeCert());
      await repo.insertBatch(certs);

      const all: number[] = [];
      let cursor: number | null = null;

      while (true) {
        const batch = await repo.exportBatch(cursor, 3);
        all.push(...batch.certificates.map((c) => c.id));
        cursor = batch.cursor;
        if (cursor === null) break;
      }

      expect(all).toHaveLength(7);

      // Verify ascending and unique
      const sorted = [...all].sort((a, b) => a - b);
      expect(all).toEqual(sorted);
      expect(new Set(all).size).toBe(7);
    });

    test("cursor skips rows with id <= cursor", async () => {
      const certs = Array.from({ length: 5 }, () => makeCert());
      await repo.insertBatch(certs);

      const first = await repo.exportBatch(null, 2);
      expect(first.certificates).toHaveLength(2);
      const lastIdInFirst = first.cursor!;

      const second = await repo.exportBatch(lastIdInFirst, 10);
      for (const cert of second.certificates) {
        expect(cert.id).toBeGreaterThan(lastIdInFirst);
      }
      expect(second.certificates).toHaveLength(3);
    });
  });

  describe("cleanup", () => {
    test("deletes old rows, keeps recent ones", async () => {
      const now = Math.floor(Date.now() / 1000);
      const oldCert = makeCert({ seenAt: now - 100 * 86400 });
      const recentCert = makeCert({ seenAt: now });
      await repo.insertBatch([oldCert, recentCert]);

      await repo.cleanup(90);
      const remaining = await repo.getRecent(10);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.fingerprint).toBe(recentCert.fingerprint);
    });
  });
});
