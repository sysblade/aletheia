import type { CliCommand } from "./router.ts";
import { loadConfig } from "../config.ts";
import { createRepository } from "../db/factory.ts";
import { getLogger } from "../utils/logger.ts";

/**
 * Maintenance command for one-off database optimization.
 * Spawned periodically by serve command to run PRAGMA optimize, ANALYZE, and WAL checkpoint.
 */
export const maintenanceCommand: CliCommand = {
  name: "maintenance",
  description: "Run database maintenance (internal use for scheduled maintenance)",
  async run() {
    const log = getLogger(["aletheia", "maintenance"]);
    const config = loadConfig();

    log.info("Starting one-off database maintenance");

    // Skip index management - serve process handles it
    const repository = await createRepository(config.store.type, config, true, "aletheia-maintenance");

    try {
      const t0 = performance.now();
      await repository.maintenance();
      const elapsedMs = performance.now() - t0;
      log.info("Database maintenance completed successfully in {elapsedMs}", { elapsedMs: elapsedMs });

    } catch (err) {
      log.error("Database maintenance failed: {error}", { error: err });
      process.exit(1);
    } finally {
      await repository.close();
    }

    process.exit(0);
  },
};
