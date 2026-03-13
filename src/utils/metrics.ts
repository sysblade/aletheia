/** Core ingestion metrics counters and timestamps. */
export interface Metrics {
  certsReceived: number;
  certsFiltered: number;
  certsInserted: number;
  certsDroppedDuplicate: number;
  batchesWritten: number;
  wsReconnections: number;
  lastBatchAt: number | null;
  startedAt: number;
}

/** Metrics snapshot with derived values (rate, buffer size). */
export interface MetricsSnapshot extends Metrics {
  insertRate: number;
  bufferPending: number;
}

/** Read-only metrics interface for exposing metrics to web server. */
export interface MetricsReader {
  snapshot(): Readonly<Metrics>;
  insertRate(): number;
  bufferPending(): number;
}

const RATE_WINDOW_MS = 60_000;

function zeroMetrics(): Metrics {
  return {
    certsReceived: 0,
    certsFiltered: 0,
    certsInserted: 0,
    certsDroppedDuplicate: 0,
    batchesWritten: 0,
    wsReconnections: 0,
    lastBatchAt: null,
    startedAt: Date.now(),
  };
}

/**
 * Metrics collector for ingest worker with rolling window insert rate calculation.
 * Used by the worker thread/process to track ingestion performance.
 */
export class MetricsCollector implements MetricsReader {
  private data: Metrics = zeroMetrics();
  private insertWindow: { time: number; count: number }[] = [];

  increment(key: keyof Omit<Metrics, "lastBatchAt" | "startedAt">, amount = 1) {
    (this.data[key] as number) += amount;
    if (key === "certsInserted") {
      this.insertWindow.push({ time: Date.now(), count: amount });
    }
  }

  recordBatch() {
    this.data.lastBatchAt = Date.now();
    this.data.batchesWritten++;
  }

  snapshot(): Readonly<Metrics> {
    return { ...this.data };
  }

  insertRate(): number {
    const now = Date.now();
    const cutoff = now - RATE_WINDOW_MS;

    const firstValid = this.insertWindow.findIndex((e) => e.time > cutoff);
    if (firstValid === -1) {
      this.insertWindow = [];
      return 0;
    }
    if (firstValid > 0) {
      this.insertWindow = this.insertWindow.slice(firstValid);
    }

    const total = this.insertWindow.reduce((sum, s) => sum + s.count, 0);
    const windowMs = Math.min(RATE_WINDOW_MS, now - this.data.startedAt);
    if (windowMs < 1000) return 0;

    return Math.round((total / (windowMs / 1000)) * 10) / 10;
  }

  bufferPending(): number {
    return 0;
  }
}

/**
 * Metrics store for main thread that receives snapshots from worker.
 * Used by web server to display metrics without direct worker access.
 */
export class MetricsStore implements MetricsReader {
  private data: Metrics = zeroMetrics();
  private rate = 0;
  private pending = 0;

  update(snap: MetricsSnapshot): void {
    const { insertRate, bufferPending, ...base } = snap;
    this.data = base;
    this.rate = insertRate;
    this.pending = bufferPending;
  }

  snapshot(): Readonly<Metrics> {
    return { ...this.data };
  }

  insertRate(): number {
    return this.rate;
  }

  bufferPending(): number {
    return this.pending;
  }
}
