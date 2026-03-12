import { config } from "./config.ts";
import { createDatabase } from "./db/sqlite/connection.ts";
import { runMigrations } from "./db/sqlite/migrate.ts";
import { SqliteRepository } from "./db/sqlite/repository.ts";
import { CertStreamClient } from "./ingestor/stream.ts";
import { CertFilter } from "./ingestor/filter.ts";
import { BatchBuffer } from "./ingestor/buffer.ts";
import { BatchWriter } from "./ingestor/writer.ts";
import { createApp } from "./server/app.ts";
import { createLogger } from "./utils/logger.ts";
import { metrics } from "./utils/metrics.ts";

const log = createLogger("main");

async function main() {
  log.info("Starting CT Log Monitor", {
    port: config.server.port,
    dbPath: config.db.path,
    retentionDays: config.db.retentionDays,
  });

  const db = createDatabase(config.db.path);
  await runMigrations(db);

  const repository = new SqliteRepository(db);

  const filter = new CertFilter(config.filters.domains, config.filters.issuers);
  log.info("Filter mode", { mode: filter.describe() });

  const writer = new BatchWriter(repository);

  const buffer = new BatchBuffer(config.batch.size, config.batch.intervalMs, (batch) => writer.write(batch));
  buffer.start();

  const stream = new CertStreamClient(config.certstream.url, filter, buffer);
  stream.start();

  const app = createApp(repository);

  app.get("/health", (c) => {
    const m = metrics.snapshot();
    return c.json({
      status: "ok",
      uptimeSeconds: Math.floor((Date.now() - m.startedAt) / 1000),
      certsInserted: m.certsInserted,
      bufferPending: buffer.pending,
    });
  });

  const cleanupInterval = setInterval(async () => {
    try {
      const deleted = await repository.cleanup(config.db.retentionDays);
      if (deleted > 0) {
        log.info("Retention cleanup completed", { deleted });
      }
    } catch (err) {
      log.error("Retention cleanup failed", { error: String(err) });
    }
  }, 24 * 60 * 60 * 1000); // daily

  async function shutdown() {
    log.info("Shutting down...");

    stream.stop();
    buffer.stop();
    clearInterval(cleanupInterval);

    await buffer.flush();
    log.info("Buffer flushed");

    await repository.close();
    log.info("Shutdown complete");

    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log.info(`Server listening on ${config.server.host}:${config.server.port}`);

  Bun.serve({
    fetch: app.fetch,
    port: config.server.port,
    hostname: config.server.host,
  });
}

main().catch((err) => {
  log.error("Fatal error", { error: String(err) });
  process.exit(1);
});
