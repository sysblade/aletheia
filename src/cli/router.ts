/**
 * CLI command interface for backward compatibility.
 * Commands implement this interface and are registered in src/index.ts using commander.
 *
 * @deprecated This interface is kept for backward compatibility.
 * New commands should be added directly to src/index.ts using commander's API.
 */
export interface CliCommand {
  name: string;
  description: string;
  run(args: string[]): Promise<void>;
}

/**
 * Run CLI router based on process.argv.
 *
 * @deprecated This function is kept for backward compatibility with tests.
 * The actual CLI uses commander.js in src/index.ts.
 */
export async function runCli(commands: Map<string, CliCommand>): Promise<void> {
  const args = process.argv.slice(2);
  const commandName = args[0] || "serve";

  if (commandName === "--help" || commandName === "-h") {
    return;
  }

  const command = commands.get(commandName);
  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    process.exit(1);
  }

  const commandArgs = args.slice(1);
  await command.run(commandArgs);
}
