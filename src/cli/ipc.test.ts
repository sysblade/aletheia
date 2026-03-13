import { describe, test, expect } from "bun:test";
import type { WorkerMessage } from "../ingestor/messages.ts";
import type { MetricsSnapshot } from "../utils/metrics.ts";

/**
 * Tests for IPC between main serve process and worker subprocess.
 * Verifies JSON message serialization, parsing, and error handling.
 */

describe("Worker IPC Message Serialization", () => {
  test("serializes ready message as valid JSON", () => {
    const msg: WorkerMessage = { type: "ready" };
    const serialized = JSON.stringify(msg) + "\n";

    expect(serialized).toContain("\n");
    const parsed = JSON.parse(serialized.trim());
    expect(parsed).toEqual({ type: "ready" });
  });

  test("serializes batch-written message with metrics", () => {
    const metrics: MetricsSnapshot = {
      certsReceived: 100,
      certsFiltered: 20,
      certsInserted: 75,
      certsDroppedDuplicate: 5,
      batchesWritten: 3,
      wsReconnections: 0,
      lastBatchAt: Date.now(),
      startedAt: Date.now() - 60000,
      insertRate: 12.5,
      bufferPending: 25,
      queueDepth: 2,
    };

    const msg: WorkerMessage = { type: "batch-written", metrics };
    const serialized = JSON.stringify(msg) + "\n";

    const parsed = JSON.parse(serialized.trim());
    expect(parsed.type).toBe("batch-written");
    expect(parsed.metrics.certsInserted).toBe(75);
    expect(parsed.metrics.insertRate).toBe(12.5);
  });

  test("serializes error message", () => {
    const msg: WorkerMessage = { type: "error", message: "Database connection failed" };
    const serialized = JSON.stringify(msg) + "\n";

    const parsed = JSON.parse(serialized.trim());
    expect(parsed).toEqual({ type: "error", message: "Database connection failed" });
  });

  test("multiple messages are newline-separated", () => {
    const msg1 = JSON.stringify({ type: "ready" }) + "\n";
    const msg2 = JSON.stringify({ type: "error", message: "test" }) + "\n";
    const combined = msg1 + msg2;

    const lines = combined.split("\n").filter(l => l.trim());
    expect(lines).toHaveLength(2);

    const parsed1 = JSON.parse(lines[0]!);
    const parsed2 = JSON.parse(lines[1]!);
    expect(parsed1.type).toBe("ready");
    expect(parsed2.type).toBe("error");
  });
});

describe("Main Process IPC Parser", () => {
  test("parses single complete JSON message", () => {
    const line = '{"type":"ready"}';
    const parsed = JSON.parse(line) as WorkerMessage;

    expect(parsed.type).toBe("ready");
  });

  test("parses batch-written message with metrics", () => {
    const msg: WorkerMessage = {
      type: "batch-written",
      metrics: {
        certsReceived: 50,
        certsFiltered: 10,
        certsInserted: 40,
        certsDroppedDuplicate: 0,
        batchesWritten: 1,
        wsReconnections: 0,
        lastBatchAt: 1234567890,
        startedAt: 1234567000,
        insertRate: 5.5,
        bufferPending: 10,
        queueDepth: 1,
      },
    };

    const line = JSON.stringify(msg);
    const parsed = JSON.parse(line) as WorkerMessage;

    expect(parsed.type).toBe("batch-written");
    if (parsed.type === "batch-written") {
      expect(parsed.metrics.insertRate).toBe(5.5);
      expect(parsed.metrics.certsInserted).toBe(40);
    }
  });

  test("handles malformed JSON gracefully", () => {
    const badLines = [
      '{"type":"ready"',  // Missing closing brace
      '{invalid json}',   // Invalid syntax
      'not json at all',  // Not JSON
      '',                 // Empty line
      '   ',              // Whitespace only
    ];

    for (const line of badLines) {
      if (!line.trim()) continue; // Empty lines should be skipped

      try {
        JSON.parse(line);
        expect.unreachable("Should have thrown for: " + line);
      } catch (err) {
        expect(err).toBeInstanceOf(SyntaxError);
      }
    }
  });

  test("parses multiple messages from buffer", () => {
    const buffer = '{"type":"ready"}\n{"type":"error","message":"test"}\n{"type":"ready"}\n';
    const lines = buffer.split("\n").filter(l => l.trim());

    expect(lines).toHaveLength(3);

    const messages = lines.map(line => JSON.parse(line) as WorkerMessage);
    expect(messages[0]?.type).toBe("ready");
    expect(messages[1]?.type).toBe("error");
    expect(messages[2]?.type).toBe("ready");
  });

  test("handles incomplete message in buffer", () => {
    let buffer = '{"type":"ready"}\n{"type":"err';
    const lines = buffer.split("\n");
    const incomplete = lines.pop();

    expect(incomplete).toBe('{"type":"err');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0] as string) as WorkerMessage;
    expect(parsed.type).toBe("ready");

    // Incomplete part stays in buffer for next chunk
    buffer = (incomplete ?? "") + 'or","message":"test"}\n';
    const nextLines = buffer.split("\n");
    const parsed2 = JSON.parse(nextLines[0] as string) as WorkerMessage;
    expect(parsed2.type).toBe("error");
  });

  test("validates message type field", () => {
    const validTypes: Array<WorkerMessage["type"]> = ["ready", "batch-written", "error", "stopped"];

    for (const type of validTypes) {
      const msg: WorkerMessage = type === "batch-written"
        ? { type, metrics: {} as MetricsSnapshot }
        : type === "error"
        ? { type, message: "test" }
        : { type };

      const line = JSON.stringify(msg);
      const parsed = JSON.parse(line) as WorkerMessage;
      expect(parsed.type).toBe(type);
    }
  });

  test("handles large metrics payload", () => {
    const largeMetrics: MetricsSnapshot = {
      certsReceived: 999999,
      certsFiltered: 500000,
      certsInserted: 499999,
      certsDroppedDuplicate: 1,
      batchesWritten: 10000,
      wsReconnections: 5,
      lastBatchAt: Date.now(),
      startedAt: Date.now() - 3600000,
      insertRate: 138.88,
      bufferPending: 1000,
      queueDepth: 50,
    };

    const msg: WorkerMessage = { type: "batch-written", metrics: largeMetrics };
    const serialized = JSON.stringify(msg);
    const parsed = JSON.parse(serialized) as WorkerMessage;

    expect(parsed.type).toBe("batch-written");
    if (parsed.type === "batch-written") {
      expect(parsed.metrics.certsReceived).toBe(999999);
      expect(parsed.metrics.insertRate).toBe(138.88);
    }
  });
});

describe("IPC Stream Processing", () => {
  test("processes chunks with partial messages", () => {
    // Simulate streaming data arriving in chunks
    const chunks = [
      '{"type":"re',
      'ady"}\n{"ty',
      'pe":"error","mes',
      'sage":"test"}\n',
    ];

    let buffer = "";
    const messages: WorkerMessage[] = [];

    for (const chunk of chunks) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line

      for (const line of lines) {
        if (line.trim()) {
          messages.push(JSON.parse(line) as WorkerMessage);
        }
      }
    }

    expect(messages).toHaveLength(2);
    expect(messages[0]?.type).toBe("ready");
    expect(messages[1]?.type).toBe("error");
  });

  test("handles messages with embedded newlines in strings", () => {
    // Error messages might contain newlines
    const msg: WorkerMessage = {
      type: "error",
      message: "Error on line 1\nError on line 2"
    };

    const serialized = JSON.stringify(msg) + "\n";
    const parsed = JSON.parse(serialized.trim()) as WorkerMessage;

    expect(parsed.type).toBe("error");
    if (parsed.type === "error") {
      expect(parsed.message).toContain("\n");
      expect(parsed.message).toBe("Error on line 1\nError on line 2");
    }
  });

  test("handles rapid message bursts", () => {
    const burst = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({ type: "ready" }) + "\n"
    ).join("");

    const lines = burst.split("\n").filter(l => l.trim());
    expect(lines).toHaveLength(100);

    const messages = lines.map(line => JSON.parse(line) as WorkerMessage);
    expect(messages.every(m => m.type === "ready")).toBe(true);
  });
});

describe("IPC Error Handling", () => {
  test("skips empty lines", () => {
    const buffer = '\n\n{"type":"ready"}\n\n{"type":"error","message":"test"}\n\n';
    const lines = buffer.split("\n").filter(l => l.trim());

    expect(lines).toHaveLength(2);
    const messages = lines.map(line => JSON.parse(line) as WorkerMessage);
    expect(messages).toHaveLength(2);
  });

  test("recovers from malformed message and continues", () => {
    const buffer = '{"type":"ready"}\n{bad json}\n{"type":"error","message":"test"}\n';
    const lines = buffer.split("\n").filter(l => l.trim());

    const validMessages: WorkerMessage[] = [];
    const errors: string[] = [];

    for (const line of lines) {
      try {
        validMessages.push(JSON.parse(line) as WorkerMessage);
      } catch (err) {
        errors.push(line);
      }
    }

    expect(validMessages).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe("{bad json}");
  });

  test("handles unicode characters in messages", () => {
    const msg: WorkerMessage = {
      type: "error",
      message: "Failed to process 日本語 domain 🚨"
    };

    const serialized = JSON.stringify(msg) + "\n";
    const parsed = JSON.parse(serialized.trim()) as WorkerMessage;

    if (parsed.type === "error") {
      expect(parsed.message).toBe("Failed to process 日本語 domain 🚨");
    }
  });

  test("handles very long message lines", () => {
    const longMessage = "x".repeat(10000);
    const msg: WorkerMessage = { type: "error", message: longMessage };

    const serialized = JSON.stringify(msg) + "\n";
    const parsed = JSON.parse(serialized.trim()) as WorkerMessage;

    if (parsed.type === "error") {
      expect(parsed.message).toHaveLength(10000);
    }
  });
});
