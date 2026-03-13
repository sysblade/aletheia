import type { CliCommand } from "./router.ts";
import { getLogger } from "../utils/logger.ts";
import { loadConfig } from "../config.ts";
import { createRepository } from "../db/factory.ts";
import { CertStreamClient } from "../ingestor/stream.ts";
import { CertFilter } from "../ingestor/filter.ts";
import { BatchBuffer } from "../ingestor/buffer.ts";
import { BatchWriter } from "../ingestor/writer.ts";
import { MetricsCollector } from "../utils/metrics.ts";

/**
 * Worker command for running ingest pipeline in compiled mode.
 * Spawned as subprocess by serve command when running from compiled binary.
 */
export const workerCommand: CliCommand = {
  name: "worker",
  description: "Run the ingestor worker (internal use for compiled mode)",
  async run() {
  const log = getLogger(["aletheia", "ingest-worker"]);
  const config = loadConfig();

  log.info("Ingest worker starting with store {storeType}", { storeType: config.store.type });

  // Skip index management - serve process handles it
  const repository = await createRepository(config.store.type, config, true, "aletheia-worker");
  const metrics = new MetricsCollector();
  const filter = new CertFilter(config.filters.domains, config.filters.issuers);
  const writer = new BatchWriter(repository, metrics);

  // Write an IPC message to stdout. Catch EPIPE (parent closed the pipe) and
  // treat it as a shutdown signal rather than crashing the process.
  function writeIPC(msg: object): void {
    try {
      process.stdout.write(JSON.stringify(msg) + "\n");
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "EPIPE") {
        void shutdown();
      }
    }
  }

  // Also catch EPIPE emitted as a stream error event
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") void shutdown();
  });

  // SIGPIPE is sent on Linux when writing to a broken pipe if the signal is not ignored
  process.on("SIGPIPE", () => void shutdown());

  const buffer = new BatchBuffer(config.batch.size, config.batch.intervalMs, config.batch.maxQueueSize, async (batch) => {
    await writer.write(batch);
    writeIPC({
      type: "batch-written",
      metrics: {
        ...metrics.snapshot(),
        insertRate: metrics.insertRate(),
        bufferPending: buffer.pending,
        queueDepth: buffer.queueDepth,
      },
    });
    log.debug("Batch written, {count} rows", { count: batch.length });
  });
  buffer.start();

  const stream = new CertStreamClient(config.certstream.url, filter, buffer, metrics);
  stream.start();

  writeIPC({ type: "ready" });
  log.info("Ingest worker ready");

  let shuttingDown = false;

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("Shutdown signal received");
    stream.stop();
    // Close repository first — this aborts any in-flight ClickHouse requests,
    // which unblocks the buffer queue so buffer.stop() can drain cleanly.
    await repository.close();
    await buffer.stop();
    log.info("Ingest worker stopped");
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  process.on("uncaughtException", (err) => {
    log.error("Uncaught exception in worker: {error}", { error: err });
  });
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled rejection in worker: {error}", { error: reason });
  });
  },
};
