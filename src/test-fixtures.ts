import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { Database as BunDatabase } from "bun:sqlite";
import type { Database } from "./db/sqlite/schema.ts";
import type { NewCertificate } from "./types/certificate.ts";

let counter = 0;

export function makeCert(overrides?: Partial<NewCertificate>): NewCertificate {
  counter++;
  return {
    fingerprint: `abcdef${counter.toString().padStart(58, "0")}`,
    domains: [`test${counter}.example.com`],
    issuerOrg: "Test CA",
    issuerCn: "Test CA CN",
    subjectCn: `test${counter}.example.com`,
    notBefore: 1700000000,
    notAfter: 1731536000,
    serialNumber: `SN${counter}`,
    logName: "test-log",
    logUrl: "https://ct.test/log",
    certIndex: counter,
    certLink: `https://ct.test/cert/${counter}`,
    seenAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

export function makeCertStreamJson(overrides?: Record<string, unknown>): string {
  counter++;
  const msg = {
    message_type: "certificate_update",
    data: {
      update_type: "X509LogEntry",
      leaf_cert: {
        subject: { CN: `test${counter}.example.com`, aggregated: `/CN=test${counter}.example.com` },
        issuer: { O: "Test CA", CN: "Test CA CN", aggregated: "/O=Test CA/CN=Test CA CN" },
        not_before: 1700000000,
        not_after: 1731536000,
        serial_number: `SN${counter}`,
        fingerprint: `AA:BB:CC:${counter.toString().padStart(2, "0")}:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00`,
        as_der: "",
        all_domains: [`test${counter}.example.com`, `www.test${counter}.example.com`],
        extensions: {},
      },
      chain: [],
      cert_index: counter,
      cert_link: `https://ct.test/cert/${counter}`,
      seen: Math.floor(Date.now() / 1000),
      source: { url: "https://ct.test/log", name: "test-log" },
    },
    ...overrides,
  };
  return JSON.stringify(msg);
}

export async function createTestDb() {
  // Lazy import to avoid loading heavy dependencies during test setup
  const { runMigrations } = await import("./db/sqlite/migrate.ts");
  const { SqliteRepository } = await import("./db/sqlite/repository.ts");

  const sqlite = new BunDatabase(":memory:");
  const db = new Kysely<Database>({
    dialect: new BunSqliteDialect({ database: sqlite }),
  });
  await runMigrations(db);
  const repo = new SqliteRepository(db);
  return { db, repo };
}
