import { getLogger } from "../utils/logger.ts";

const log = getLogger(["ctlog", "cli"]);

export interface CliCommand {
  name: string;
  description: string;
  run(args: string[]): Promise<void>;
}

function printUsage(commands: Map<string, CliCommand>): void {
  console.log("Usage: bun run src/index.ts <command> [options]\n");
  console.log("Commands:");
  for (const cmd of commands.values()) {
    console.log(`  ${cmd.name.padEnd(12)} ${cmd.description}`);
  }
  console.log(`\n  --help       Show this help message`);
}

export async function runCli(commands: Map<string, CliCommand>): Promise<void> {
  const args = process.argv.slice(2);
  const commandName = args[0];

  if (commandName === "--help" || commandName === "-h") {
    printUsage(commands);
    return;
  }

  if (!commandName) {
    const defaultCmd = commands.get("serve");
    if (defaultCmd) {
      log.info("No command specified, defaulting to serve");
      return defaultCmd.run(args);
    }
    printUsage(commands);
    return;
  }

  const command = commands.get(commandName);
  if (!command) {
    console.error(`Unknown command: ${commandName}\n`);
    printUsage(commands);
    process.exit(1);
  }

  return command.run(args.slice(1));
}
