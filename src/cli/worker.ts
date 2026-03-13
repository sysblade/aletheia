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
  const log = getLogger(["ctlog", "ingest-worker"]);
  const config = loadConfig();

  log.info("Ingest worker starting with store {storeType}", { storeType: config.store.type });

  const repository = await createRepository(config.store.type, config);
  const metrics = new MetricsCollector();
  const filter = new CertFilter(config.filters.domains, config.filters.issuers);
  const writer = new BatchWriter(repository, metrics);

  const buffer = new BatchBuffer(config.batch.size, config.batch.intervalMs, config.batch.maxQueueSize, async (batch) => {
    await writer.write(batch);
    // In process mode, we can't send messages to parent, just log
    log.debug("Batch written, {count} rows", { count: batch.length });
  });
  buffer.start();

  const stream = new CertStreamClient(config.certstream.url, filter, buffer, metrics);
  stream.start();

  log.info("Ingest worker ready");

  // Handle shutdown
  async function shutdown() {
    log.info("Shutdown signal received");
    stream.stop();
    await buffer.stop();
    await repository.close();
    log.info("Ingest worker stopped");
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  },
};
