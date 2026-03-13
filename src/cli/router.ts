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
