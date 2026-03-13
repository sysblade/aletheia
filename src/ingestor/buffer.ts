import PQueue from "p-queue";
import type { NewCertificate } from "../types/certificate.ts";
import { getLogger } from "../utils/logger.ts";

const log = getLogger(["ctlog", "buffer"]);

/**
 * Batching buffer for certificates with size and time-based flushing.
 * Uses p-queue for reliable sequential write processing with backpressure handling.
 */
export class BatchBuffer {
  private items: NewCertificate[] = [];
  private queue: PQueue;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastQueueWarning = 0;

  constructor(
    private maxSize: number,
    private intervalMs: number,
    private maxQueueSize: number,
    private flushCallback: (batch: NewCertificate[]) => Promise<void>,
  ) {
    this.queue = new PQueue({
      concurrency: 1, // Sequential writes - one batch at a time
      queueSize: maxQueueSize,
      throwOnTimeout: false,
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
      void this.flush();
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

    const batch = this.items;
    this.items = [];

    // Add batch to queue - p-queue handles backpressure automatically
    void this.queue.add(async () => {
      try {
        await this.flushCallback(batch);
      } catch (err) {
        log.error("Batch write failed, re-queuing {batchSize} items: {error}", {
          error: String(err),
          batchSize: batch.length,
        });
        // Re-queue failed batch by adding back to items at front
        this.items = batch.concat(this.items);
      }
    });
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
