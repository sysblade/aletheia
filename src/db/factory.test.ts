import { describe, test, expect } from "bun:test";
import { createRepository, type StoreType } from "./factory.ts";
import type { Config } from "../config.ts";

const testConfig = {
  store: { type: "sqlite" as StoreType },
  db: { path: ":memory:", retentionDays: 90, maintenanceIntervalHours: 6 },
  mongo: {
    url: "mongodb://localhost:27017",
    database: "aletheia_test",
    socketTimeoutMs: 15000,
    maxPoolSize: 10,
    minPoolSize: 2,
  },
  certstream: { url: "wss://api.certstream.dev/" },
  batch: { size: 500, intervalMs: 3000, maxQueueSize: 50 },
  server: { port: 3000, host: "0.0.0.0" },
  filters: { domains: [] as string[], issuers: [] as string[] },
  stats: { enabled: true, hourlySchedule: "5 * * * *", dailySchedule: "5 0 * * *" },
} as Config;

describe("createRepository", () => {
  test("creates a working SQLite repository", async () => {
    const repo = await createRepository("sqlite", testConfig);

    const stats = await repo.getStats();
    expect(stats.totalCertificates).toBe(0);

    await repo.close();
  });

  test("SQLite repo supports full CRUD lifecycle", async () => {
    const repo = await createRepository("sqlite", testConfig);

    await repo.insertBatch([
      {
        fingerprint: "factorytest0000000000000000000000000000000000000000000000001",
        domains: ["factory.test"],
        issuerOrg: "FactoryCA",
        issuerCn: null,
        subjectCn: "factory.test",
        notBefore: 1700000000,
        notAfter: 1731536000,
        serialNumber: "SN-FACTORY",
        logName: null,
        logUrl: null,
        certIndex: null,
        certLink: null,
        seenAt: Math.floor(Date.now() / 1000),
      },
    ]);

    const recent = await repo.getRecent(1);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.fingerprint).toBe("factorytest0000000000000000000000000000000000000000000000001");

    await repo.close();
  });

  test("throws on unsupported store type", async () => {
    await expect(createRepository("redis" as StoreType, testConfig)).rejects.toThrow("Unsupported store type");
  });
});
