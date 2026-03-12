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

  increment(key: keyof Omit<Metrics, "lastBatchAt" | "startedAt">, amount = 1) {
    (this.data[key] as number) += amount;
  }

  recordBatch() {
    this.data.lastBatchAt = Date.now();
    this.data.batchesWritten++;
  }

  snapshot(): Readonly<Metrics> {
    return { ...this.data };
  }

  insertRate(): number {
    const elapsed = (Date.now() - this.data.startedAt) / 1000;
    if (elapsed < 1) return 0;
    return Math.round(this.data.certsInserted / elapsed);
  }
}

export const metrics = new MetricsCollector();
