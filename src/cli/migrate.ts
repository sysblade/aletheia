import { unlink } from "node:fs/promises";
import type { CliCommand } from "./router.ts";
import type { StoreType } from "../db/factory.ts";
import type { Certificate, NewCertificate } from "../types/certificate.ts";
import { loadConfig } from "../config.ts";
import { createRepository } from "../db/factory.ts";
import { getLogger } from "../utils/logger.ts";

const log = getLogger(["ctlog", "migrate"]);

const VALID_STORES: StoreType[] = ["sqlite", "mongodb", "clickhouse"];
const CURSOR_FILE = "./data/.migrate-cursor";

/**
 * Convert Certificate (with DB fields) to NewCertificate (for insertion).
 * Used during migration to strip database-generated fields.
 */
export function certToNewCert(cert: Certificate): NewCertificate {
  return {
    fingerprint: cert.fingerprint,
    domains: cert.domains,
    issuerOrg: cert.issuerOrg,
    issuerCn: cert.issuerCn,
    subjectCn: cert.subjectCn,
    notBefore: cert.notBefore,
    notAfter: cert.notAfter,
    serialNumber: cert.serialNumber,
    logName: cert.logName,
    logUrl: cert.logUrl,
    certIndex: cert.certIndex,
    certLink: cert.certLink,
    seenAt: cert.seenAt,
  };
}

/**
 * Parse CLI arguments for migrate command.
 * Validates source/target stores and batch size.
 */
export function parseArgs(args: string[]): { source: StoreType; target: StoreType; batchSize: number } {
  let source: string | undefined;
  let target: string | undefined;
  let batchSize = 1000;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--source" && args[i + 1]) {
      source = args[++i];
    } else if (arg === "--target" && args[i + 1]) {
      target = args[++i];
    } else if (arg === "--batch-size" && args[i + 1]) {
      batchSize = Number(args[++i]);
      if (!Number.isFinite(batchSize) || batchSize < 1) {
        throw new Error("--batch-size must be a positive number");
      }
    }
  }

  if (!source || !target) {
    throw new Error("Usage: migrate --source <store> --target <store> [--batch-size <n>]");
  }

  if (!VALID_STORES.includes(source as StoreType)) {
    throw new Error(`Invalid source store: ${source}. Valid: ${VALID_STORES.join(", ")}`);
  }
  if (!VALID_STORES.includes(target as StoreType)) {
    throw new Error(`Invalid target store: ${target}. Valid: ${VALID_STORES.join(", ")}`);
  }
  if (source === target) {
    throw new Error("Source and target stores must be different");
  }

  return { source: source as StoreType, target: target as StoreType, batchSize };
}

async function loadCursor(): Promise<string | null> {
  try {
    const saved = (await Bun.file(CURSOR_FILE).text()).trim();
    return saved.length > 0 ? saved : null;
  } catch {
    return null;
  }
}

async function saveCursor(cursor: string): Promise<void> {
  await Bun.write(CURSOR_FILE, cursor);
}

async function removeCursor(): Promise<void> {
  try {
    await unlink(CURSOR_FILE);
  } catch {}
}

/**
 * Database migration command for copying certificates between storage backends.
 * Supports resumable migration via cursor file for safe large-scale migrations.
 */
export const migrateCommand: CliCommand = {
  name: "migrate",
  description: "Migrate data between stores",
  async run(args) {
    const config = loadConfig();
    const { source, target, batchSize } = parseArgs(args);

    log.info("Starting migration from {source} to {target}, batch size {batchSize}", { source, target, batchSize });

    const sourceRepo = await createRepository(source, config, false, "ctlog-migrate-source");
    const targetRepo = await createRepository(target, config, false, "ctlog-migrate-target");

    try {
      const { totalCertificates } = await sourceRepo.getStats();
      const totalBatches = Math.ceil(totalCertificates / batchSize);

      let cursor = await loadCursor();
      if (cursor !== null) {
        log.info("Resuming migration from cursor {cursor}", { cursor });
      }

      let totalMigrated = 0;
      let batchNumber = 0;

      while (true) {
        const batch = await sourceRepo.exportBatch(cursor, batchSize);

        if (batch.certificates.length === 0) break;

        batchNumber++;
        const newCerts = batch.certificates.map(certToNewCert);
        const inserted = await targetRepo.insertBatch(newCerts);
        totalMigrated += inserted;

        log.info("Batch {batchNumber}/{totalBatches}: exported {exported}, inserted {inserted}, total migrated {totalMigrated}", {
          batchNumber,
          totalBatches,
          exported: batch.certificates.length,
          inserted,
          totalMigrated,
        });

        cursor = batch.cursor;
        if (cursor !== null) {
          await saveCursor(cursor);
        }
        if (cursor === null) break;
      }

      await removeCursor();
      log.info("Migration complete: {totalMigrated} certificates in {batchNumber} batches", { totalMigrated, batchNumber });
    } finally {
      await sourceRepo.close();
      await targetRepo.close();
    }
  },
};
