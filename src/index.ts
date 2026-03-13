import { configureLogging } from "./utils/logger.ts";
import { runCli } from "./cli/router.ts";
import { serveCommand } from "./cli/serve.ts";
import { migrateCommand } from "./cli/migrate.ts";
import { workerCommand } from "./cli/worker.ts";
import { maintenanceCommand } from "./cli/maintenance.ts";

await configureLogging();

const commands = new Map([
  [serveCommand.name, serveCommand],
  [migrateCommand.name, migrateCommand],
  [workerCommand.name, workerCommand],
  [maintenanceCommand.name, maintenanceCommand],
]);

await runCli(commands);
