import type { CertificateRepository } from "../db/repository.ts";
import type { NewCertificate } from "../types/certificate.ts";
import { metrics } from "../utils/metrics.ts";
import { getLogger } from "../utils/logger.ts";

const log = getLogger(["ctlog", "writer"]);

export class BatchWriter {
  constructor(private repository: CertificateRepository) {}

  async write(batch: NewCertificate[]): Promise<void> {
    if (batch.length === 0) return;

    try {
      const inserted = await this.repository.insertBatch(batch);
      metrics.increment("certsInserted", inserted);
      metrics.increment("certsDroppedDuplicate", batch.length - inserted);
      metrics.recordBatch();

      log.debug("Batch written: {inserted} inserted, {duplicates} duplicates out of {batchSize}", {
        batchSize: batch.length,
        inserted,
        duplicates: batch.length - inserted,
      });
    } catch (err) {
      log.error("Failed to write batch of {batchSize}: {error}", { error: String(err), batchSize: batch.length });
    }
  }
}
