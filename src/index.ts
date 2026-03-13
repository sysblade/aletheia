import { configureLogging } from "./utils/logger.ts";
import { runCli } from "./cli/router.ts";
import { serveCommand } from "./cli/serve.ts";
import { migrateCommand } from "./cli/migrate.ts";
import { workerCommand } from "./cli/worker.ts";
import { maintenanceCommand } from "./cli/maintenance.ts";
import { statsCommand } from "./cli/stats.ts";

// Use command name as log role (defaults to "main" when no command specified)
const role = process.argv[2] || "main";
await configureLogging(role);

const commands = new Map([
  [serveCommand.name, serveCommand],
  [migrateCommand.name, migrateCommand],
  [workerCommand.name, workerCommand],
  [maintenanceCommand.name, maintenanceCommand],
  [statsCommand.name, statsCommand],
]);

await runCli(commands);
