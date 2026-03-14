import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { WorkerMessage } from "../ingestor/messages.ts";
import { resolve } from "node:path";

/**
 * Integration tests for IPC between serve and worker subprocess.
 * Tests actual process spawning and message passing.
 */

describe("IPC Integration", () => {
  const testTimeout = 30000; // 30s for subprocess tests

  test("worker subprocess sends ready message", async () => {
    const workerPath = resolve(import.meta.dir, "../index.ts");

    const proc = Bun.spawn({
      cmd: ["bun", "run", workerPath, "worker"],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CERTSTREAM_URL: "wss://invalid.test", // Won't connect, just testing IPC
        STORE_TYPE: "sqlite",
        DB_PATH: ":memory:",
      },
    });

    let receivedReady = false;
    const messages: WorkerMessage[] = [];
    const timeout = setTimeout(() => {
      proc.kill();
    }, 5000); // 5s timeout for ready message

    try {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const msg = JSON.parse(line) as WorkerMessage;
              messages.push(msg);

              if (msg.type === "ready") {
                receivedReady = true;
                proc.kill("SIGTERM");
                clearTimeout(timeout);
                reader.releaseLock();
                await proc.exited;
                break;
              }
            } catch (err) {
              // Ignore parse errors, might be log lines mixed in
            }
          }
        }

        if (receivedReady) break;
      }
    } finally {
      clearTimeout(timeout);
      proc.kill("SIGKILL");
      await proc.exited;
    }

    expect(receivedReady).toBe(true);
    expect(messages.some(m => m.type === "ready")).toBe(true);
  }, testTimeout);

  test("worker subprocess outputs valid JSON on stdout", async () => {
    const workerPath = resolve(import.meta.dir, "../index.ts");

    const proc = Bun.spawn({
      cmd: ["bun", "run", workerPath, "worker"],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CERTSTREAM_URL: "wss://invalid.test",
        STORE_TYPE: "sqlite",
        DB_PATH: ":memory:",
        LOG_LEVEL: "error", // Reduce log noise
      },
    });

    const validMessages: WorkerMessage[] = [];
    const nonJsonLines: string[] = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, 5000);

    try {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value?: undefined }>((resolve) =>
            setTimeout(() => resolve({ done: true }), 6000)
          ),
        ]);

        if (done) break;
        if (!value) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const msg = JSON.parse(line) as WorkerMessage;
              validMessages.push(msg);

              if (msg.type === "ready") {
                proc.kill("SIGTERM");
                clearTimeout(timeout);
                reader.releaseLock();
                await proc.exited;
                break;
              }
            } catch {
              // Ignore non-JSON lines (might be Bun runtime output)
              nonJsonLines.push(line);
            }
          }
        }

        if (validMessages.some(m => m.type === "ready")) break;
      }
    } finally {
      clearTimeout(timeout);
      if (!proc.killed) {
        proc.kill("SIGKILL");
      }
      await proc.exited;
    }

    // Should have received at least the ready message
    expect(validMessages.length).toBeGreaterThan(0);
    expect(validMessages.some(m => m.type === "ready")).toBe(true);

    // Non-JSON lines are acceptable (Bun runtime output), but log them for debugging
    if (nonJsonLines.length > 0) {
      console.warn(`Worker sent ${nonJsonLines.length} non-JSON lines (Bun runtime output)`);
    }
  }, testTimeout);

  test("stderr contains logs, not IPC messages", async () => {
    const workerPath = resolve(import.meta.dir, "../index.ts");

    const proc = Bun.spawn({
      cmd: ["bun", "run", workerPath, "worker"],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CERTSTREAM_URL: "wss://invalid.test",
        STORE_TYPE: "sqlite",
        DB_PATH: ":memory:",
        LOG_LEVEL: "info",
      },
    });

    let stderrContent = "";
    let gotReady = false;
    let stderrDone = false;
    const timeout = setTimeout(() => {
      if (!proc.killed) proc.kill("SIGTERM");
    }, 5000);

    try {
      // Read stderr in background
      const stderrReader = proc.stderr.getReader();
      const stderrDecoder = new TextDecoder();

      // Read stdout to detect ready
      const stdoutReader = proc.stdout.getReader();
      const stdoutDecoder = new TextDecoder();
      let stdoutBuffer = "";

      const readStderr = (async () => {
        try {
          while (true) {
            const { done, value } = await Promise.race([
              stderrReader.read(),
              new Promise<{ done: true; value?: undefined }>((resolve) =>
                setTimeout(() => resolve({ done: true }), 6000)
              ),
            ]);
            if (done || !value) break;
            stderrContent += stderrDecoder.decode(value, { stream: true });
          }
        } finally {
          stderrDone = true;
        }
      })();

      const readStdout = async () => {
        try {
          while (!gotReady) {
            const { done, value } = await Promise.race([
              stdoutReader.read(),
              new Promise<{ done: true; value?: undefined }>((resolve) =>
                setTimeout(() => resolve({ done: true }), 6000)
              ),
            ]);

            if (done || !value) break;

            stdoutBuffer += stdoutDecoder.decode(value, { stream: true });
            const lines = stdoutBuffer.split("\n");
            stdoutBuffer = lines.pop() || "";

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const msg = JSON.parse(line) as WorkerMessage;
                  if (msg.type === "ready") {
                    gotReady = true;
                    break;
                  }
                } catch {
                  // Ignore non-JSON
                }
              }
            }
          }
        } finally {
          stdoutReader.releaseLock();
        }
      };

      await readStdout();

      // Give stderr a moment to accumulate
      await new Promise(resolve => setTimeout(resolve, 100));

      proc.kill("SIGTERM");
      clearTimeout(timeout);

      // Wait for stderr to finish
      await Promise.race([readStderr, new Promise(resolve => setTimeout(resolve, 1000))]);
      await proc.exited;
    } finally {
      clearTimeout(timeout);
      if (!proc.killed) {
        proc.kill("SIGKILL");
        await proc.exited;
      }
    }

    // Should have received ready on stdout
    expect(gotReady).toBe(true);

    // Stderr should contain log messages (with [WORKER] prefix)
    // Note: logs go to stderr now that we fixed LogTape config
    expect(stderrContent.length).toBeGreaterThan(0);
    expect(stderrContent).toContain("[WORKER]");

    // Stderr should NOT contain JSON IPC messages
    expect(stderrContent).not.toContain('{"type":"ready"}');
  }, testTimeout);

  test("handles worker process crash gracefully", async () => {
    const workerPath = resolve(import.meta.dir, "../index.ts");

    // Use invalid config to force crash
    const proc = Bun.spawn({
      cmd: ["bun", "run", workerPath, "worker"],
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CERTSTREAM_URL: "", // Invalid URL will cause error
        STORE_TYPE: "invalid_store", // Invalid store type will cause startup failure
        DB_PATH: ":memory:",
      },
    });

    try {
      // Wait for exit with timeout
      const exitCode = await Promise.race([
        proc.exited,
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error("Process did not exit")), 5000)
        ),
      ]);

      // Process should exit with error code
      expect(exitCode).not.toBe(0);
    } catch (err) {
      // If it didn't exit, kill it
      proc.kill("SIGKILL");
      await proc.exited;
      throw err;
    }
  }, testTimeout);
});

describe("IPC Message Types", () => {
  test("ready message has correct structure", () => {
    const msg: WorkerMessage = { type: "ready" };
    const serialized = JSON.stringify(msg);
    const parsed = JSON.parse(serialized) as WorkerMessage;

    expect(parsed.type).toBe("ready");
    expect(Object.keys(parsed)).toEqual(["type"]);
  });

  test("batch-written message has all required fields", () => {
    const msg: WorkerMessage = {
      type: "batch-written",
      metrics: {
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
      },
    };

    const serialized = JSON.stringify(msg);
    const parsed = JSON.parse(serialized) as WorkerMessage;

    expect(parsed.type).toBe("batch-written");
    if (parsed.type === "batch-written") {
      expect(parsed.metrics).toBeDefined();
      expect(parsed.metrics.certsInserted).toBe(75);
      expect(parsed.metrics.insertRate).toBe(12.5);
      expect(parsed.metrics.bufferPending).toBe(25);
      expect(parsed.metrics.queueDepth).toBe(2);
    }
  });

  test("error message has message field", () => {
    const msg: WorkerMessage = {
      type: "error",
      message: "Database connection failed",
    };

    const serialized = JSON.stringify(msg);
    const parsed = JSON.parse(serialized) as WorkerMessage;

    expect(parsed.type).toBe("error");
    if (parsed.type === "error") {
      expect(parsed.message).toBe("Database connection failed");
    }
  });

  test("stopped message has correct structure", () => {
    const msg: WorkerMessage = { type: "stopped" };
    const serialized = JSON.stringify(msg);
    const parsed = JSON.parse(serialized) as WorkerMessage;

    expect(parsed.type).toBe("stopped");
    expect(Object.keys(parsed)).toEqual(["type"]);
  });
});
