import { Worker } from "node:worker_threads";
import type { Subprocess } from "bun";
import { Cron } from "croner";
import type { CliCommand } from "./router.ts";
import { loadConfig } from "../config.ts";
import { getLogger } from "../utils/logger.ts";
import { createRepository } from "../db/factory.ts";
import { CertFilter } from "../ingestor/filter.ts";
import { createApp } from "../server/app.ts";
import { MetricsStore } from "../utils/metrics.ts";
import { EventBus } from "../utils/events.ts";
import type { NewCertificate } from "../types/certificate.ts";
import type { WorkerMessage, MainMessage } from "../ingestor/messages.ts";

/**
 * Main serve command that starts the CT Log monitor.
 * Initializes database, spawns ingest worker, starts web server, and handles graceful shutdown.
 */
export const serveCommand: CliCommand = {
  name: "serve",
  description: "Start the CT Log monitor server (default)",
  async run() {
    const config = loadConfig();
    const metricsStore = new MetricsStore();
    const certEvents = new EventBus<NewCertificate[]>();
    const log = getLogger(["ctlog", "main"]);

    log.info("Starting CT Log Monitor on port {port}, store {storeType}, retention {retentionDays} days", {
      port: config.server.port,
      storeType: config.store.type,
      retentionDays: config.db.retentionDays,
    });

    const repository = await createRepository(config.store.type, config, false, "ctlog-serve");

    const filter = new CertFilter(config.filters.domains, config.filters.issuers);
    log.info("Filter mode: {mode}", { mode: filter.describe() });

    // Detect if running from compiled binary
    const isCompiled = !Bun.main.endsWith(".ts");

    // Helper function to spawn maintenance process
    function spawnMaintenance(reason: string) {
      const execPath = isCompiled ? process.execPath : "bun";
      const args = isCompiled ? ["maintenance"] : ["run", "src/index.ts", "maintenance"];

      log.info("Spawning database maintenance process ({reason})", { reason });

      const maintenanceProc = Bun.spawn({
        cmd: [execPath, ...args],
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
      });

      maintenanceProc.exited.then((code) => {
        if (code === 0) {
          log.info("Database maintenance process completed successfully");
        } else {
          log.error("Database maintenance process exited with code {code}", { code });
        }
      });
    }

    // Helper function to spawn stats computation process
    function spawnStats(reason: string) {
      if (!config.stats.enabled) return;

      const execPath = isCompiled ? process.execPath : "bun";
      const args = isCompiled ? ["stats"] : ["run", "src/index.ts", "stats"];

      log.info("Spawning stats computation ({reason})", { reason });

      const statsProc = Bun.spawn({
        cmd: [execPath, ...args],
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
      });

      statsProc.exited.then((code) => {
        if (code === 0) {
          log.info("Stats computation completed successfully");
        } else {
          log.error("Stats computation failed with code {code}", { code });
        }
      });
    }

    // Run maintenance at startup
    spawnMaintenance("startup");
    let worker: Worker | null = null;
    let workerProc: Subprocess | null = null;

    let stoppedResolve: (() => void) | null = null;
    const stoppedPromise = new Promise<void>((resolve) => {
      stoppedResolve = resolve;
    });

    if (isCompiled) {
      // In compiled mode, spawn the binary with worker subcommand
      log.info("Running in compiled mode, spawning worker process");
      workerProc = Bun.spawn({
        cmd: [process.execPath, "worker"],
        stdout: "pipe",
        stderr: "inherit",
        env: process.env,
      });

      // Read stdout for IPC messages (newline-delimited JSON)
      if (workerProc.stdout && typeof workerProc.stdout !== "number") {
        const reader = workerProc.stdout.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        async function readStdout() {
        try {
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
                  switch (msg.type) {
                    case "ready":
                      log.info("Ingest worker ready");
                      break;
                    case "batch-written":
                      metricsStore.update(msg.metrics);
                      certEvents.emit([]);
                      break;
                    case "error":
                      log.error("Ingest worker error: {message}", { message: msg.message });
                      break;
                  }
                } catch (err) {
                  log.warn("Failed to parse IPC message from worker: {error}", { error: String(err), line });
                }
              }
            }
          }
        } catch (err) {
          if (err instanceof Error && err.message !== "Reader has been released") {
            log.error("Error reading worker IPC stream: {error}", { error: String(err) });
          }
        }
      }

        readStdout();
      }

      // Monitor process exit
      workerProc.exited.then((code) => {
        if (code !== 0) {
          log.error("Ingest worker process exited with code {code}", { code });
        }
        stoppedResolve?.();
      });

      log.info("Ingest worker process started");
    } else {
      // In development mode, use worker thread
      worker = new Worker(new URL("../ingestor/worker.ts", import.meta.url), {
        workerData: config,
      });

      worker.on("message", (msg: WorkerMessage) => {
        switch (msg.type) {
          case "ready":
            log.info("Ingest worker ready");
            break;
          case "batch-written":
            metricsStore.update(msg.metrics);
            certEvents.emit([]);
            break;
          case "error":
            log.error("Ingest worker error: {message}", { message: msg.message });
            break;
          case "stopped":
            log.info("Ingest worker stopped");
            stoppedResolve?.();
            break;
        }
      });

      worker.on("error", (err) => {
        log.error("Ingest worker thread error: {error}", { error: String(err) });
      });

      worker.on("exit", (code) => {
        if (code !== 0) {
          log.error("Ingest worker exited with code {code}", { code });
        }
        stoppedResolve?.();
      });
    }

    const app = createApp({
      repository,
      metrics: metricsStore,
      config,
      filter,
      certEvents,
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

    const maintenanceInterval = setInterval(() => {
      spawnMaintenance("scheduled");
    }, config.db.maintenanceIntervalHours * 60 * 60 * 1000);

    // Schedule stats computation
    const hourlyStatsCron = config.stats.enabled
      ? new Cron(config.stats.hourlySchedule, () => {
          spawnStats("hourly");
        })
      : null;

    const dailyStatsCron = config.stats.enabled
      ? new Cron(config.stats.dailySchedule, () => {
          spawnStats("daily");
        })
      : null;

    if (config.stats.enabled) {
      log.info("Stats computation enabled, hourly: {hourly}, daily: {daily}", {
        hourly: config.stats.hourlySchedule,
        daily: config.stats.dailySchedule,
      });
    }

    const server = Bun.serve({
      fetch: app.fetch,
      port: config.server.port,
      hostname: config.server.host,
    });

    log.info("Server listening on {host}:{port}", { host: config.server.host, port: config.server.port });

    const SHUTDOWN_TIMEOUT_MS = 10_000;

    async function shutdown() {
      log.info("Shutting down...");

      if (worker) {
        // Worker thread mode - send shutdown message
        worker.postMessage({ type: "shutdown" } satisfies MainMessage);
        await Promise.race([
          stoppedPromise,
          new Promise<void>((resolve) =>
            setTimeout(() => {
              log.warn("Worker shutdown timed out after {ms}ms, forcing exit", { ms: SHUTDOWN_TIMEOUT_MS });
              resolve();
            }, SHUTDOWN_TIMEOUT_MS),
          ),
        ]);
      } else if (workerProc) {
        // Process mode - send SIGTERM
        workerProc.kill("SIGTERM");
        await Promise.race([
          workerProc.exited,
          new Promise<void>((resolve) =>
            setTimeout(() => {
              log.warn("Worker process shutdown timed out after {ms}ms, forcing kill", { ms: SHUTDOWN_TIMEOUT_MS });
              workerProc?.kill("SIGKILL");
              resolve();
            }, SHUTDOWN_TIMEOUT_MS),
          ),
        ]);
      }

      clearInterval(cleanupInterval);
      clearInterval(maintenanceInterval);

      if (hourlyStatsCron) hourlyStatsCron.stop();
      if (dailyStatsCron) dailyStatsCron.stop();

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
