import { parentPort, workerData } from "node:worker_threads";
import { configureLogging, getLogger } from "../utils/logger.ts";
import type { Config } from "../config.ts";
import { createRepository } from "../db/factory.ts";
import { CertStreamClient } from "./stream.ts";
import { CertFilter } from "./filter.ts";
import { BatchBuffer } from "./buffer.ts";
import { BatchWriter } from "./writer.ts";
import { MetricsCollector } from "../utils/metrics.ts";
import type { WorkerMessage, MainMessage } from "./messages.ts";

if (!parentPort) throw new Error("worker.ts must run inside a Worker thread");

const port = parentPort;

await configureLogging();

const log = getLogger(["ctlog", "ingest-worker"]);
const config = workerData as Config;

log.info("Ingest worker starting with store {storeType}", { storeType: config.store.type });

const repository = await createRepository(config.store.type, config);
const metrics = new MetricsCollector();
const filter = new CertFilter(config.filters.domains, config.filters.issuers);
const writer = new BatchWriter(repository, metrics);

const buffer = new BatchBuffer(config.batch.size, config.batch.intervalMs, async (batch) => {
  await writer.write(batch);
  port.postMessage({
    type: "batch-written",
    metrics: {
      ...metrics.snapshot(),
      insertRate: metrics.insertRate(),
      bufferPending: buffer.pending,
    },
  } satisfies WorkerMessage);
});
buffer.start();

const stream = new CertStreamClient(config.certstream.url, filter, buffer, metrics);
stream.start();

port.postMessage({ type: "ready" } satisfies WorkerMessage);

port.on("message", async (msg: MainMessage) => {
  if (msg.type === "shutdown") {
    log.info("Shutdown signal received");
    stream.stop();
    buffer.stop();
    await buffer.flush();
    await repository.close();
    port.postMessage({ type: "stopped" } satisfies WorkerMessage);
    log.info("Ingest worker stopped");
  }
});
