import type { NewCertificate } from "../types/certificate.ts";
import { getLogger } from "../utils/logger.ts";

const log = getLogger(["ctlog", "buffer"]);

/**
 * Batching buffer for certificates with size and time-based flushing.
 * Re-queues failed batches to prevent data loss during transient failures.
 */
export class BatchBuffer {
  private items: NewCertificate[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(
    private maxSize: number,
    private intervalMs: number,
    private flushCallback: (batch: NewCertificate[]) => Promise<void>,
  ) {}

  start() {
    this.timer = setInterval(() => {
      void this.flush();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  push(cert: NewCertificate) {
    this.items.push(cert);
    if (this.items.length >= this.maxSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.items.length === 0) return;
    this.flushing = true;

    const batch = this.items;
    this.items = [];

    try {
      await this.flushCallback(batch);
    } catch (err) {
      log.error("Flush failed, re-queuing {batchSize} items: {error}", { error: String(err), batchSize: batch.length });
      this.items = batch.concat(this.items);
    } finally {
      this.flushing = false;
    }
  }

  get pending(): number {
    return this.items.length;
  }
}
