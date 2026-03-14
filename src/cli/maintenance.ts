import type { CliCommand } from "./router.ts";
import { loadConfig } from "../config.ts";
import { createRepository } from "../db/factory.ts";
import { getLogger } from "../utils/logger.ts";

const METADATA_KEY = "last_maintenance_at";
const COOLDOWN_SECONDS = 3600; // 1 hour

/**
 * Maintenance command for one-off database optimization.
 * Spawned periodically by serve command to run PRAGMA optimize, ANALYZE, and WAL checkpoint.
 * Skips execution if maintenance ran less than 1 hour ago.
 */
export const maintenanceCommand: CliCommand = {
  name: "maintenance",
  description: "Run database maintenance (internal use for scheduled maintenance)",
  async run(args: string[]) {
    const log = getLogger(["aletheia", "maintenance"]);
    const config = loadConfig();
    const force = args.includes("--force");

    // Skip index management - serve process handles it
    const repository = await createRepository(config.store.type, config, true, "aletheia-maintenance");

    try {
      const now = Math.floor(Date.now() / 1000);
      if (!force) {
        const lastRunRaw = await repository.getMetadata(METADATA_KEY);
        if (lastRunRaw !== null) {
          const lastRun = Number(lastRunRaw);
          const secondsAgo = now - lastRun;
          if (secondsAgo < COOLDOWN_SECONDS) {
            log.info("Skipping maintenance: last run was {secondsAgo}s ago (cooldown: {cooldown}s)", {
              secondsAgo,
              cooldown: COOLDOWN_SECONDS,
            });
            return;
          }
        }
      }

      log.info("Starting one-off database maintenance");
      const t0 = performance.now();
      await repository.maintenance();
      const elapsedMs = performance.now() - t0;
      await repository.setMetadata(METADATA_KEY, String(now));
      log.info("Database maintenance completed successfully in {elapsedMs}s", { elapsedMs: Math.round(Number(elapsedMs) / 1_000) });

    } catch (err) {
      log.error("Database maintenance failed: {error}", { error: err });
      process.exit(1);
    } finally {
      await repository.close();
    }

    process.exit(0);
  },
};
