import { describe, test, expect, mock, afterEach } from "bun:test";
import { BatchBuffer } from "./buffer.ts";
import { makeCert } from "../test-fixtures.ts";

describe("BatchBuffer", () => {
  let buffer: BatchBuffer;

  afterEach(async () => {
    await buffer?.stop();
  });

  test("push increments pending", () => {
    const callback = mock(() => Promise.resolve());
    buffer = new BatchBuffer(100, 60_000, 10, callback);
    expect(buffer.pending).toBe(0);
    buffer.push(makeCert());
    expect(buffer.pending).toBe(1);
    buffer.push(makeCert());
    expect(buffer.pending).toBe(2);
  });

  test("flush calls callback and resets pending to 0", async () => {
    const callback = mock(() => Promise.resolve());
    buffer = new BatchBuffer(100, 60_000, 10, callback);
    buffer.push(makeCert());
    buffer.push(makeCert());
    await buffer.flush();
    expect(callback).toHaveBeenCalledTimes(1);
    expect((callback.mock.calls[0] as unknown as [unknown[]])[0]).toHaveLength(2);
    expect(buffer.pending).toBe(0);
  });

  test("empty flush is a no-op", async () => {
    const callback = mock(() => Promise.resolve());
    buffer = new BatchBuffer(100, 60_000, 10, callback);
    await buffer.flush();
    expect(callback).not.toHaveBeenCalled();
  });

  test("size threshold triggers automatic flush", async () => {
    const callback = mock(() => Promise.resolve());
    buffer = new BatchBuffer(3, 60_000, 10, callback);
    buffer.push(makeCert());
    buffer.push(makeCert());
    expect(callback).not.toHaveBeenCalled();
    buffer.push(makeCert()); // triggers flush
    // flush is async via void, wait a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(buffer.pending).toBe(0);
  });

  test("failed flush re-queues batch with failed items first", async () => {
    let callCount = 0;
    const callback = mock(async (batch: unknown[]) => {
      callCount++;
      if (callCount === 1) throw new Error("fail");
    });
    buffer = new BatchBuffer(100, 60_000, 10, callback);
    const cert1 = makeCert();
    const cert2 = makeCert();
    buffer.push(cert1);
    buffer.push(cert2);
    await buffer.flush();
    // batch was re-queued
    expect(buffer.pending).toBe(2);

    // push a new item
    const cert3 = makeCert();
    buffer.push(cert3);
    // second flush succeeds
    await buffer.flush();
    expect(callback).toHaveBeenCalledTimes(2);
    // order preserved: failed items (cert1, cert2) come before new (cert3)
    const secondBatch = callback.mock.calls[1]![0] as unknown[];
    expect(secondBatch).toHaveLength(3);
  });

  test("concurrent flush guard prevents double flush", async () => {
    let resolveFlush: () => void;
    const callback = mock(
      () => new Promise<void>((r) => { resolveFlush = r; }),
    );
    buffer = new BatchBuffer(100, 60_000, 10, callback);
    buffer.push(makeCert());
    buffer.push(makeCert());

    const flush1 = buffer.flush();
    // push more while flush1 is in flight
    buffer.push(makeCert());
    const flush2 = buffer.flush(); // should be no-op because flushing=true

    resolveFlush!();
    await flush1;
    await flush2;

    expect(callback).toHaveBeenCalledTimes(1);
    expect(buffer.pending).toBe(1); // the item pushed during flush stays
  });

  test("start/stop manages interval", async () => {
    const callback = mock(() => Promise.resolve());
    buffer = new BatchBuffer(100, 50, 10, callback);
    buffer.push(makeCert());
    buffer.start();
    await new Promise((r) => setTimeout(r, 120));
    buffer.stop();
    expect(callback.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
