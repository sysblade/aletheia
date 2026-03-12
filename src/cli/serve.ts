import type { CliCommand } from "./router.ts";
import { loadConfig } from "../config.ts";
import { getLogger } from "../utils/logger.ts";
import { createRepository } from "../db/factory.ts";
import { CertStreamClient } from "../ingestor/stream.ts";
import { CertFilter } from "../ingestor/filter.ts";
import { BatchBuffer } from "../ingestor/buffer.ts";
import { BatchWriter } from "../ingestor/writer.ts";
import { createApp } from "../server/app.ts";
import { MetricsCollector } from "../utils/metrics.ts";
import { EventBus } from "../utils/events.ts";
import type { NewCertificate } from "../types/certificate.ts";

export const serveCommand: CliCommand = {
  name: "serve",
  description: "Start the CT Log monitor server (default)",
  async run() {
    const config = loadConfig();
    const metrics = new MetricsCollector();
    const certEvents = new EventBus<NewCertificate[]>();
    const log = getLogger(["ctlog", "main"]);

    log.info("Starting CT Log Monitor on port {port}, store {storeType}, retention {retentionDays} days", {
      port: config.server.port,
      storeType: config.store.type,
      retentionDays: config.db.retentionDays,
    });

    const repository = await createRepository(config.store.type, config);

    const filter = new CertFilter(config.filters.domains, config.filters.issuers);
    log.info("Filter mode: {mode}", { mode: filter.describe() });

    const writer = new BatchWriter(repository, metrics, certEvents);

    const buffer = new BatchBuffer(config.batch.size, config.batch.intervalMs, (batch) => writer.write(batch));
    buffer.start();

    const stream = new CertStreamClient(config.certstream.url, filter, buffer, metrics);
    stream.start();

    const app = createApp({
      repository,
      metrics,
      config,
      filter,
      certEvents,
      healthProvider: () => ({ bufferPending: buffer.pending }),
    });

    const cleanupInterval = setInterval(async () => {
      try {
        const deleted = await repository.cleanup(config.db.retentionDays);
        if (deleted > 0) {
          log.info("Retention cleanup completed, deleted {deleted} rows", { deleted });
        }
      } catch (err) {
        log.error("Retention cleanup failed: {error}", { error: String(err) });
      }
    }, 24 * 60 * 60 * 1000);

    const server = Bun.serve({
      fetch: app.fetch,
      port: config.server.port,
      hostname: config.server.host,
    });

    log.info("Server listening on {host}:{port}", { host: config.server.host, port: config.server.port });

    async function shutdown() {
      log.info("Shutting down...");

      stream.stop();
      buffer.stop();
      clearInterval(cleanupInterval);

      await buffer.flush();
      log.info("Buffer flushed");

      server.stop();
      log.info("Server stopped");

      await repository.close();
      log.info("Shutdown complete");

      process.exit(0);
    }

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  },
};
