import type { CliCommand } from "./router.ts";
import { loadConfig } from "../config.ts";
import { createRepository } from "../db/factory.ts";
import { getLogger } from "../utils/logger.ts";

/**
 * Stats computation command.
 * Computes and stores aggregated statistics for hourly and daily periods.
 *
 * Usage:
 *   bun run src/index.ts stats                    # Compute missing stats for last completed periods
 *   bun run src/index.ts stats --backfill         # Fill all missing stats from oldest cert to yesterday
 *   bun run src/index.ts stats --backfill --from=2025-03-01 --to=2025-03-13
 *   bun run src/index.ts stats --backfill --granularity=hourly
 *   bun run src/index.ts stats --backfill --force # Recompute all periods (overwrite existing)
 */
export const statsCommand: CliCommand = {
  name: "stats",
  description: "Compute and aggregate certificate statistics",
  async run(args: string[]) {
    const log = getLogger(["aletheia", "stats"]);
    const config = loadConfig();

    const parsedArgs = parseArgs(args);

    if (parsedArgs.backfill) {
      log.info("Starting stats backfill from {from} to {to}", {
        from: new Date(parsedArgs.from * 1000).toISOString(),
        to: new Date(parsedArgs.to * 1000).toISOString(),
      });
    } else {
      log.info("Computing stats for latest completed periods");
    }

    // Skip index management - serve process handles it
    const repository = await createRepository(config.store.type, config, true, "aletheia-stats");

    try {
      if (parsedArgs.backfill) {
        await backfillStats(repository, parsedArgs);
      } else {
        await computeLatestStats(repository, parsedArgs.granularity);
      }

      log.info("Stats computation completed successfully");
    } catch (err) {
      log.error("Stats computation failed: {error}", { error: String(err) });
      process.exit(1);
    } finally {
      await repository.close();
    }

    process.exit(0);
  },
};

interface ParsedArgs {
  backfill: boolean;
  from: number;
  to: number;
  granularity: ("hourly" | "daily")[];
  force: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    backfill: false,
    from: 0,
    to: 0,
    granularity: ["hourly", "daily"],
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--backfill") {
      result.backfill = true;
    } else if (arg === "--force") {
      result.force = true;
    } else if (arg?.startsWith("--from=")) {
      const dateStr = arg.slice(7);
      result.from = parseDate(dateStr);
    } else if (arg?.startsWith("--to=")) {
      const dateStr = arg.slice(5);
      result.to = parseDate(dateStr);
    } else if (arg?.startsWith("--granularity=")) {
      const value = arg.slice(14);
      const parts = value.split(",").filter((x) => x === "hourly" || x === "daily") as ("hourly" | "daily")[];
      if (parts.length > 0) {
        result.granularity = parts;
      }
    }
  }

  return result;
}

function parseDate(dateStr: string): number {
  const date = new Date(dateStr + "T00:00:00Z");
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD`);
  }
  return Math.floor(date.getTime() / 1000);
}

async function computeLatestStats(
  repository: Awaited<ReturnType<typeof createRepository>>,
  granularity: ("hourly" | "daily")[],
): Promise<void> {
  const log = getLogger(["aletheia", "stats"]);
  const now = Math.floor(Date.now() / 1000);

  if (granularity.includes("hourly")) {
    const lastCompletedHour = Math.floor(now / 3600) * 3600 - 3600;
    const existing = await repository.getHourlyStats(lastCompletedHour, lastCompletedHour + 3600);

    if (existing.length === 0) {
      log.info("Computing hourly stats for {period}", {
        period: new Date(lastCompletedHour * 1000).toISOString(),
      });
      await repository.computeStatsForPeriod(lastCompletedHour, "hourly");
    } else {
      log.debug("Hourly stats already exist for last completed hour");
    }
  }

  if (granularity.includes("daily")) {
    const lastCompletedDay = Math.floor(now / 86400) * 86400 - 86400;
    const existing = await repository.getDailyStats(lastCompletedDay, lastCompletedDay + 86400);

    if (existing.length === 0) {
      log.info("Computing daily stats for {period}", {
        period: new Date(lastCompletedDay * 1000).toISOString().split("T")[0],
      });
      await repository.computeStatsForPeriod(lastCompletedDay, "daily");
    } else {
      log.debug("Daily stats already exist for last completed day");
    }
  }
}

async function backfillStats(
  repository: Awaited<ReturnType<typeof createRepository>>,
  parsedArgs: ParsedArgs,
): Promise<void> {
  const log = getLogger(["aletheia", "stats"]);
  let { from, to } = parsedArgs;

  if (from === 0 || to === 0) {
    const stats = await repository.getStats();
    if (!stats.oldestSeenAt) {
      log.info("No certificates in database, nothing to backfill");
      return;
    }

    if (from === 0) {
      from = Math.floor(stats.oldestSeenAt / 86400) * 86400;
    }
    if (to === 0) {
      const now = Math.floor(Date.now() / 1000);
      to = Math.floor(now / 86400) * 86400;
    }
  }

  if (parsedArgs.granularity.includes("hourly")) {
    await backfillHourly(repository, from, to, parsedArgs.force);
  }

  if (parsedArgs.granularity.includes("daily")) {
    await backfillDaily(repository, from, to, parsedArgs.force);
  }
}

async function backfillHourly(
  repository: Awaited<ReturnType<typeof createRepository>>,
  from: number,
  to: number,
  force: boolean,
): Promise<void> {
  const log = getLogger(["aletheia", "stats"]);

  const fromHour = Math.floor(from / 3600) * 3600;
  const toHour = Math.floor(to / 3600) * 3600;

  let periods: number[];

  if (force) {
    // Force mode: recompute all periods in range
    periods = [];
    for (let period = fromHour; period < toHour; period += 3600) {
      periods.push(period);
    }
    log.info("Force mode: recomputing {count} hourly periods", { count: periods.length });
  } else {
    // Normal mode: only compute missing periods
    const existing = await repository.getHourlyStats(fromHour, toHour);
    const existingPeriods = new Set(existing.map((s) => s.periodStart));

    periods = [];
    for (let period = fromHour; period < toHour; period += 3600) {
      if (!existingPeriods.has(period)) {
        periods.push(period);
      }
    }

    if (periods.length === 0) {
      log.info("No missing hourly stats in range");
      return;
    }

    log.info("Backfilling {count} hourly periods", { count: periods.length });
  }

  for (let i = 0; i < periods.length; i++) {
    const period = periods[i]!;

    if (i > 0 && i % 10 === 0) {
      log.info("Progress: {current}/{total} hourly periods processed", {
        current: i,
        total: periods.length,
      });
    }

    try {
      await repository.computeStatsForPeriod(period, "hourly");
    } catch (err) {
      log.error("Failed to compute hourly stats for period {period}: {error}", {
        period: new Date(period * 1000).toISOString(),
        error: String(err),
      });
    }
  }

  log.info("Completed hourly backfill: {count} periods processed", { count: periods.length });
}

async function backfillDaily(
  repository: Awaited<ReturnType<typeof createRepository>>,
  from: number,
  to: number,
  force: boolean,
): Promise<void> {
  const log = getLogger(["aletheia", "stats"]);

  const fromDay = Math.floor(from / 86400) * 86400;
  const toDay = Math.floor(to / 86400) * 86400;

  let periods: number[];

  if (force) {
    // Force mode: recompute all periods in range
    periods = [];
    for (let period = fromDay; period < toDay; period += 86400) {
      periods.push(period);
    }
    log.info("Force mode: recomputing {count} daily periods", { count: periods.length });
  } else {
    // Normal mode: only compute missing periods
    const existing = await repository.getDailyStats(fromDay, toDay);
    const existingPeriods = new Set(existing.map((s) => s.periodStart));

    periods = [];
    for (let period = fromDay; period < toDay; period += 86400) {
      if (!existingPeriods.has(period)) {
        periods.push(period);
      }
    }

    if (periods.length === 0) {
      log.info("No missing daily stats in range");
      return;
    }

    log.info("Backfilling {count} daily periods", { count: periods.length });
  }

  for (let i = 0; i < periods.length; i++) {
    const period = periods[i]!;

    if (i > 0 && i % 10 === 0) {
      log.info("Progress: {current}/{total} daily periods processed", {
        current: i,
        total: periods.length,
      });
    }

    try {
      await repository.computeStatsForPeriod(period, "daily");
    } catch (err) {
      log.error("Failed to compute daily stats for period {period}: {error}", {
        period: new Date(period * 1000).toISOString().split("T")[0],
        error: String(err),
      });
    }
  }

  log.info("Completed daily backfill: {count} periods processed", { count: periods.length });
}
