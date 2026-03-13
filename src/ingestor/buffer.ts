import PQueue from "p-queue";
import type { NewCertificate } from "../types/certificate.ts";
import { getLogger } from "../utils/logger.ts";

const log = getLogger(["aletheia", "buffer"]);

/**
 * Batching buffer for certificates with size and time-based flushing.
 * Uses p-queue for reliable sequential write processing with backpressure handling.
 */
export class BatchBuffer {
  private items: NewCertificate[] = [];
  private queue: PQueue;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastQueueWarning = 0;
  private flushing = false;

  constructor(
    private maxSize: number,
    private intervalMs: number,
    private maxQueueSize: number,
    private flushCallback: (batch: NewCertificate[]) => Promise<void>,
  ) {
    this.queue = new PQueue({
      concurrency: 1, // Sequential writes - one batch at a time
    });

    // Monitor queue size and warn when getting full
    this.queue.on("active", () => {
      const size = this.queue.size;
      if (size >= maxQueueSize * 0.8) {
        const now = Date.now();
        if (now - this.lastQueueWarning > 10_000) {
          log.warn("Write queue filling up ({queueSize}/{maxQueueSize})", {
            queueSize: size,
            maxQueueSize,
          });
          this.lastQueueWarning = now;
        }
      }
    });
  }

  start() {
    this.timer = setInterval(() => {
      this.flush().catch((err) => {
        log.error("Unhandled flush error: {error}", { error: err });
      });
    }, this.intervalMs);
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Wait for pending writes to complete
    await this.queue.onIdle();
  }

  push(cert: NewCertificate) {
    this.items.push(cert);
    if (this.items.length >= this.maxSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.items.length === 0) return;

    // Guard: prevent concurrent flushes
    if (this.flushing) return;

    this.flushing = true;
    const batch = this.items;
    this.items = [];

    try {
      // Add batch to queue and wait for it to process.
      // Retry up to 3 times with backoff; drop the batch after that to avoid
      // an infinite accumulation loop on permanent failures.
      await this.queue.add(async () => {
        const MAX_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            await this.flushCallback(batch);
            return;
          } catch (err) {
            if (attempt === MAX_ATTEMPTS) {
              log.error("Batch write failed after {attempts} attempts, dropping {batchSize} items: {error}", {
                error: err,
                attempts: MAX_ATTEMPTS,
                batchSize: batch.length,
              });
              return;
            }
            log.warn("Batch write failed (attempt {attempt}/{maxAttempts}), retrying: {error}", {
              error: err,
              attempt,
              maxAttempts: MAX_ATTEMPTS,
            });
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          }
        }
      });
    } finally {
      this.flushing = false;
    }
  }

  get pending(): number {
    return this.items.length;
  }

  get queueDepth(): number {
    return this.queue.size + this.queue.pending;
  }

  get totalPending(): number {
    // Estimate: current batch + queued batches (assume avg batch size)
    return this.items.length + this.queueDepth * (this.maxSize / 2);
  }
}
