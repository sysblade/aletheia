import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import type { CliCommand } from "./router.ts";
import { runCli } from "./router.ts";

function makeCommand(name: string, runFn?: CliCommand["run"]): CliCommand {
  return {
    name,
    description: `${name} command`,
    run: runFn ?? mock(() => Promise.resolve()),
  };
}

describe("runCli", () => {
  let savedArgv: string[];

  beforeEach(() => {
    savedArgv = process.argv;
  });

  afterEach(() => {
    process.argv = savedArgv;
  });

  test("dispatches to the named command", async () => {
    const serve = makeCommand("serve");
    const commands = new Map([["serve", serve]]);

    process.argv = ["bun", "index.ts", "serve"];
    await runCli(commands);

    expect(serve.run).toHaveBeenCalledTimes(1);
  });

  test("passes remaining args to the command", async () => {
    const migrate = makeCommand("migrate");
    const commands = new Map([["migrate", migrate]]);

    process.argv = ["bun", "index.ts", "migrate", "--source", "sqlite", "--target", "mongodb"];
    await runCli(commands);

    expect(migrate.run).toHaveBeenCalledWith(["--source", "sqlite", "--target", "mongodb"]);
  });

  test("defaults to serve when no command given", async () => {
    const serve = makeCommand("serve");
    const commands = new Map([["serve", serve]]);

    process.argv = ["bun", "index.ts"];
    await runCli(commands);

    expect(serve.run).toHaveBeenCalledTimes(1);
  });

  test("does not run serve on --help", async () => {
    const serve = makeCommand("serve");
    const commands = new Map([["serve", serve]]);

    process.argv = ["bun", "index.ts", "--help"];
    await runCli(commands);

    expect(serve.run).not.toHaveBeenCalled();
  });

  test("does not run serve on -h", async () => {
    const serve = makeCommand("serve");
    const commands = new Map([["serve", serve]]);

    process.argv = ["bun", "index.ts", "-h"];
    await runCli(commands);

    expect(serve.run).not.toHaveBeenCalled();
  });

  test("exits with code 1 on unknown command", async () => {
    const commands = new Map([["serve", makeCommand("serve")]]);

    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error("process.exit called");
    }) as never;

    process.argv = ["bun", "index.ts", "bogus"];
    try {
      await runCli(commands);
    } catch {
      // Expected — mock throws to stop execution
    }

    process.exit = originalExit;
    expect(exitCode).toBe(1);
  });
});
