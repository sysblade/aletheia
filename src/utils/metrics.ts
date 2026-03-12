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

const RATE_WINDOW_MS = 60_000;

class MetricsCollector {
  private data: Metrics = {
    certsReceived: 0,
    certsFiltered: 0,
    certsInserted: 0,
    certsDroppedDuplicate: 0,
    batchesWritten: 0,
    wsReconnections: 0,
    lastBatchAt: null,
    startedAt: Date.now(),
  };

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

    while (this.insertWindow.length > 0 && now - this.insertWindow[0]!.time > RATE_WINDOW_MS) {
      this.insertWindow.shift();
    }

    if (this.insertWindow.length === 0) return 0;

    const total = this.insertWindow.reduce((sum, s) => sum + s.count, 0);
    const windowMs = Math.min(RATE_WINDOW_MS, now - this.data.startedAt);
    if (windowMs < 1000) return 0;

    return Math.round((total / (windowMs / 1000)) * 10) / 10;
  }
}

export const metrics = new MetricsCollector();
