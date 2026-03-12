import { configureLogging } from "./utils/logger.ts";
import { runCli } from "./cli/router.ts";
import { serveCommand } from "./cli/serve.ts";
import { migrateCommand } from "./cli/migrate.ts";

await configureLogging();

const commands = new Map([
  [serveCommand.name, serveCommand],
  [migrateCommand.name, migrateCommand],
]);

await runCli(commands);
