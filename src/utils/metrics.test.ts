import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { MetricsCollector } from "./metrics.ts";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;
  let dateNowSpy: ReturnType<typeof spyOn>;
  let fakeNow: number;

  beforeEach(() => {
    fakeNow = 1_000_000_000;
    dateNowSpy = spyOn(Date, "now").mockImplementation(() => fakeNow);
    collector = new MetricsCollector();
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  test("increment adds to correct counter", () => {
    collector.increment("certsReceived", 5);
    collector.increment("certsFiltered", 3);
    const snap = collector.snapshot();
    expect(snap.certsReceived).toBe(5);
    expect(snap.certsFiltered).toBe(3);
    expect(snap.certsInserted).toBe(0);
  });

  test("increment defaults to 1", () => {
    collector.increment("wsReconnections");
    expect(collector.snapshot().wsReconnections).toBe(1);
  });

  test("increment certsInserted feeds the rolling window", () => {
    collector.increment("certsInserted", 10);
    expect(collector.snapshot().certsInserted).toBe(10);
  });

  test("recordBatch updates lastBatchAt and batchesWritten", () => {
    expect(collector.snapshot().lastBatchAt).toBeNull();
    expect(collector.snapshot().batchesWritten).toBe(0);

    collector.recordBatch();
    const snap = collector.snapshot();
    expect(snap.lastBatchAt).toBe(fakeNow);
    expect(snap.batchesWritten).toBe(1);
  });

  test("snapshot returns immutable copy", () => {
    collector.increment("certsReceived", 5);
    const snap1 = collector.snapshot();
    collector.increment("certsReceived", 10);
    const snap2 = collector.snapshot();
    expect(snap1.certsReceived).toBe(5);
    expect(snap2.certsReceived).toBe(15);
  });

  test("insertRate returns 0 with no data", () => {
    fakeNow += 5000;
    expect(collector.insertRate()).toBe(0);
  });

  test("insertRate returns 0 when uptime < 1s", () => {
    collector.increment("certsInserted", 100);
    fakeNow += 500;
    expect(collector.insertRate()).toBe(0);
  });

  test("insertRate computes correct rate", () => {
    collector.increment("certsInserted", 100);
    fakeNow += 10_000; // 10 seconds later
    const rate = collector.insertRate();
    // windowMs = min(60000, 10000) = 10000ms = 10s
    // rate = round((100 / 10) * 10) / 10 = 10.0
    expect(rate).toBe(10);
  });

  test("insertRate prunes entries outside the window", () => {
    collector.increment("certsInserted", 50);
    fakeNow += 61_000; // past the 60s window
    collector.increment("certsInserted", 20);
    fakeNow += 5_000;

    const rate = collector.insertRate();
    // Old 50 is pruned (61s + 5s = 66s old), only 20 in window
    // windowMs = min(60000, 66000) = 60000ms = 60s
    // rate = round((20 / 60) * 10) / 10 = 0.3
    expect(rate).toBe(0.3);
  });
});
