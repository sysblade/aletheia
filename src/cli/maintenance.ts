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
    const log = getLogger(["ctlog", "maintenance"]);
    const config = loadConfig();

    log.info("Starting one-off database maintenance");

    const repository = await createRepository(config.store.type, config);

    try {
      await repository.maintenance();
      log.info("Database maintenance completed successfully");
    } catch (err) {
      log.error("Database maintenance failed: {error}", { error: String(err) });
      process.exit(1);
    } finally {
      await repository.close();
    }

    process.exit(0);
  },
};
