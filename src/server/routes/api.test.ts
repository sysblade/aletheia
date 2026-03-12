import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../../db/sqlite/schema.ts";
import { createApp, type AppDeps } from "../app.ts";
import { createTestDb, makeCert } from "../../test-fixtures.ts";
import type { SqliteRepository } from "../../db/sqlite/repository.ts";
import { SearchError, type CertificateRepository } from "../../db/repository.ts";
import { MetricsCollector } from "../../utils/metrics.ts";
import { CertFilter } from "../../ingestor/filter.ts";
import { EventBus } from "../../utils/events.ts";
import { loadConfig } from "../../config.ts";
import type { NewCertificate } from "../../types/certificate.ts";

function testDeps(repo: CertificateRepository): AppDeps {
  return {
    repository: repo,
    metrics: new MetricsCollector(),
    config: loadConfig(),
    filter: new CertFilter([], []),
    certEvents: new EventBus<NewCertificate[]>(),
  };
}

async function json(res: Response): Promise<any> {
  return res.json();
}

describe("API routes", () => {
  let db: Kysely<Database>;
  let repo: SqliteRepository;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    repo = testDb.repo;
    app = createApp(testDeps(repo));
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("GET /api/search", () => {
    test("returns 400 for missing query", async () => {
      const res = await app.request("/api/search");
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("at least 2 characters");
    });

    test("returns 400 for short query", async () => {
      const res = await app.request("/api/search?q=a");
      expect(res.status).toBe(400);
    });

    test("returns search results", async () => {
      await repo.insertBatch([
        makeCert({ domains: ["search-api-test.example.com"] }),
      ]);
      const res = await app.request("/api/search?q=search-api-test");
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.total).toBe(1);
      expect(body.certificates).toHaveLength(1);
    });

    test("respects page and limit params", async () => {
      const certs = Array.from({ length: 5 }, (_, i) =>
        makeCert({ domains: ["pagetest.com"], fingerprint: `pagetest${i.toString().padStart(58, "0")}` }),
      );
      await repo.insertBatch(certs);
      const res = await app.request("/api/search?q=pagetest&page=2&limit=2");
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.page).toBe(2);
      expect(body.limit).toBe(2);
      expect(body.certificates.length).toBeLessThanOrEqual(2);
    });

    test("clamps limit to bounds", async () => {
      await repo.insertBatch([makeCert({ domains: ["clamptest.com"] })]);
      const res = await app.request("/api/search?q=clamptest&limit=999");
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.limit).toBe(100);
    });
  });

  describe("GET /api/cert/:id", () => {
    test("returns 400 for invalid id", async () => {
      const res = await app.request("/api/cert/abc");
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toContain("Invalid");
    });

    test("returns 404 for nonexistent id", async () => {
      const res = await app.request("/api/cert/9999");
      expect(res.status).toBe(404);
      const body = await json(res);
      expect(body.error).toContain("not found");
    });

    test("returns 200 with cert data", async () => {
      const cert = makeCert();
      await repo.insertBatch([cert]);
      const recent = await repo.getRecent(1);
      const id = recent[0]!.id;

      const res = await app.request(`/api/cert/${id}`);
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.fingerprint).toBe(cert.fingerprint);
      expect(body.domains).toEqual(cert.domains);
    });
  });

  describe("GET /api/stats", () => {
    test("returns stats with ingestion and filters", async () => {
      const res = await app.request("/api/stats");
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body).toHaveProperty("totalCertificates");
      expect(body).toHaveProperty("uniqueIssuers");
      expect(body).toHaveProperty("ingestion");
      expect(body.ingestion).toHaveProperty("certsReceived");
      expect(body.ingestion).toHaveProperty("insertRate");
      expect(body.ingestion).toHaveProperty("uptimeSeconds");
      expect(body).toHaveProperty("filters");
      expect(body.filters).toHaveProperty("mode");
    });
  });

  describe("GET /health", () => {
    test("returns health status", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.status).toBe("ok");
      expect(body).toHaveProperty("uptimeSeconds");
      expect(body).toHaveProperty("certsInserted");
      expect(body).toHaveProperty("bufferPending");
    });
  });

  describe("error handler", () => {
    test("SearchError returns 400 JSON", async () => {
      const failRepo: CertificateRepository = {
        insertBatch: (c) => repo.insertBatch(c),
        getById: (id) => repo.getById(id),
        getRecent: (l) => repo.getRecent(l),
        getStats: () => repo.getStats(),
        cleanup: (d) => repo.cleanup(d),
        exportBatch: (cursor, limit) => repo.exportBatch(cursor, limit),
        close: () => repo.close(),
        search: () => Promise.reject(new SearchError("test search error")),
      };
      const failApp = createApp(testDeps(failRepo));
      const res = await failApp.request("/api/search?q=test");
      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toBe("test search error");
    });
  });
});
