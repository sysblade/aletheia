import { describe, test, expect, mock } from "bun:test";
import { BatchWriter } from "./writer.ts";
import { MetricsCollector } from "../utils/metrics.ts";
import { makeCert } from "../test-fixtures.ts";
import type { CertificateRepository } from "../db/repository.ts";

function makeRepo(overrides?: Partial<CertificateRepository>): CertificateRepository {
  return {
    insertBatch: mock(() => Promise.resolve(0)),
    search: mock(() => Promise.resolve({ certificates: [], total: 0, page: 1, limit: 50, totalPages: 0 })),
    getById: mock(() => Promise.resolve(null)),
    getRecent: mock(() => Promise.resolve([])),
    getStats: mock(() => Promise.resolve({ totalCertificates: 0, uniqueIssuers: 0, latestSeenAt: null, oldestSeenAt: null })),
    getHourlyStats: mock(() => Promise.resolve([])),
    getDailyStats: mock(() => Promise.resolve([])),
    computeStatsForPeriod: mock(() => Promise.resolve()),
    cleanup: mock(() => Promise.resolve(0)),
    maintenance: mock(() => Promise.resolve()),
    exportBatch: mock(() => Promise.resolve({ certificates: [], cursor: null })),
    close: mock(() => Promise.resolve()),
    ...overrides,
  };
}

describe("BatchWriter", () => {
  test("calls insertBatch and updates metrics", async () => {
    const insertBatch = mock(() => Promise.resolve(3));
    const repo = makeRepo({ insertBatch });
    const metrics = new MetricsCollector();
    const writer = new BatchWriter(repo, metrics);
    const batch = [makeCert(), makeCert(), makeCert(), makeCert()];

    await writer.write(batch);
    const snap = metrics.snapshot();

    expect(insertBatch).toHaveBeenCalledTimes(1);
    expect((insertBatch.mock.calls[0] as unknown as [unknown[]])[0]).toHaveLength(4);
    expect(snap.certsInserted).toBe(3);
    expect(snap.certsDroppedDuplicate).toBe(1);
    expect(snap.batchesWritten).toBe(1);
  });

  test("empty batch is a no-op", async () => {
    const insertBatch = mock(() => Promise.resolve(0));
    const repo = makeRepo({ insertBatch });
    const metrics = new MetricsCollector();
    const writer = new BatchWriter(repo, metrics);

    await writer.write([]);
    expect(insertBatch).not.toHaveBeenCalled();
  });

  test("propagates insertBatch errors", async () => {
    const insertBatch = mock(() => Promise.reject(new Error("db error")));
    const repo = makeRepo({ insertBatch });
    const metrics = new MetricsCollector();
    const writer = new BatchWriter(repo, metrics);

    await expect(writer.write([makeCert()])).rejects.toThrow("db error");
  });
});
