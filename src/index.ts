import { Command } from "commander";
import { configureLogging } from "./utils/logger.ts";
import { serveCommand } from "./cli/serve.ts";
import { migrateCommand } from "./cli/migrate.ts";
import { workerCommand } from "./cli/worker.ts";
import { maintenanceCommand } from "./cli/maintenance.ts";
import { statsCommand } from "./cli/stats.ts";

const program = new Command();

program
  .name("aletheia")
  .description("Certificate Transparency Log Monitor - Real-time TLS certificate tracking")
  .version("1.0.0");

// Serve command (default)
program
  .command("serve", { isDefault: true })
  .description("Start the CT Log monitor server (default)")
  .action(async () => {
    await configureLogging("serve");
    await serveCommand.run([]);
  });

// Migrate command
program
  .command("migrate")
  .description("Migrate data between storage backends (SQLite ↔ MongoDB)")
  .requiredOption("--source <store>", "Source store (sqlite or mongodb)")
  .requiredOption("--target <store>", "Target store (sqlite or mongodb)")
  .option("--batch-size <n>", "Number of certificates per batch", "1000")
  .addHelpText("after", `
Examples:
  $ aletheia migrate --source sqlite --target mongodb
  $ aletheia migrate --source mongodb --target sqlite --batch-size 500

Notes:
  - Migration is resumable: if interrupted, it will continue from where it left off
  - Cursor is saved to ./data/.migrate-cursor
  - Schema migrations (001_*, 002_*, etc.) run automatically on startup
  `)
  .action(async (options) => {
    await configureLogging("migrate");

    // Convert commander options to args array for backward compatibility
    const args: string[] = [];
    args.push("--source", options.source);
    args.push("--target", options.target);
    if (options.batchSize) args.push("--batch-size", options.batchSize);

    await migrateCommand.run(args);
  });

// Worker command (internal use)
program
  .command("worker")
  .description("Start certificate ingest worker (internal use)")
  .action(async () => {
    await configureLogging("worker");
    await workerCommand.run([]);
  });

// Maintenance command (internal use)
program
  .command("maintenance")
  .description("Run database maintenance (internal use for scheduled maintenance)")
  .action(async () => {
    await configureLogging("maintenance");
    await maintenanceCommand.run([]);
  });

// Stats command
program
  .command("stats")
  .description("Compute and aggregate certificate statistics")
  .option("--backfill", "Backfill missing stats for historical periods")
  .option("--from <date>", "Start date for backfill (YYYY-MM-DD)")
  .option("--to <date>", "End date for backfill (YYYY-MM-DD)")
  .option("--granularity <type>", "Compute hourly, daily, or both (comma-separated)", "hourly,daily")
  .option("--force", "Recompute all periods in range (overwrite existing stats)")
  .addHelpText("after", `
Examples:
  $ aletheia stats                              # Compute missing stats for last completed periods
  $ aletheia stats --backfill                   # Fill all missing stats from oldest to yesterday
  $ aletheia stats --backfill --from 2025-03-01 --to 2025-03-13
  $ aletheia stats --backfill --granularity hourly
  $ aletheia stats --backfill --force           # Recompute all (overwrite existing)
  `)
  .action(async (options) => {
    await configureLogging("stats");

    // Convert commander options to args array for backward compatibility
    const args: string[] = [];
    if (options.backfill) args.push("--backfill");
    if (options.force) args.push("--force");
    if (options.from) args.push(`--from=${options.from}`);
    if (options.to) args.push(`--to=${options.to}`);
    if (options.granularity) args.push(`--granularity=${options.granularity}`);

    await statsCommand.run(args);
  });

// Parse command line arguments
await program.parseAsync(process.argv);
