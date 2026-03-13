import type { CertificateRepository } from "../db/repository.ts";
import type { NewCertificate } from "../types/certificate.ts";
import type { MetricsCollector } from "../utils/metrics.ts";
import type { EventBus } from "../utils/events.ts";
import { getLogger } from "../utils/logger.ts";

const log = getLogger(["aletheia", "writer"]);

/**
 * Writes certificate batches to repository and updates metrics.
 * Emits certificate events for live stream updates.
 */
export class BatchWriter {
  constructor(
    private repository: CertificateRepository,
    private metrics: MetricsCollector,
    private certEvents?: EventBus<NewCertificate[]>,
  ) {}

  async write(batch: NewCertificate[]): Promise<void> {
    if (batch.length === 0) return;

    const inserted = await this.repository.insertBatch(batch);
    this.metrics.increment("certsInserted", inserted);
    this.metrics.increment("certsDroppedDuplicate", batch.length - inserted);
    this.metrics.recordBatch();

    log.debug("Batch written: {inserted} inserted, {duplicates} duplicates out of {batchSize}", {
      batchSize: batch.length,
      inserted,
      duplicates: batch.length - inserted,
    });

    this.certEvents?.emit(batch);
  }
}
