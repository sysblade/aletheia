# CLI Migration to Commander

## Summary

Replaced the custom CLI router with **commander.js**, the industry-standard CLI framework for Node.js/Bun applications.

## Changes Made

### 1. **Added Commander Dependency**
```json
"commander": "^12.1.0"
```

### 2. **Rewrote src/index.ts**
- Replaced custom routing logic with commander's declarative API
- Added proper help text for all commands
- Added version command (`--version`)
- Set `serve` as the default command
- Added rich examples for the stats command

### 3. **Simplified src/cli/router.ts**
- Kept only the `CliCommand` interface for backward compatibility
- Removed the custom routing implementation
- Marked as deprecated for future refactoring

## New Features

### Help Text on All Commands

```bash
# Global help
$ aletheia --help
$ aletheia -h

# Command-specific help
$ aletheia serve --help
$ aletheia migrate --help
$ aletheia stats --help
$ aletheia worker --help
$ aletheia maintenance --help
```

**Example: Migrate command help**
```bash
$ aletheia migrate --help

Usage: aletheia migrate [options]

Migrate data between storage backends (SQLite ↔ MongoDB)

Options:
  --source <store>     Source store (sqlite or mongodb)
  --target <store>     Target store (sqlite or mongodb)
  --batch-size <n>     Number of certificates per batch (default: "1000")
  -h, --help           display help for command

Examples:
  $ aletheia migrate --source sqlite --target mongodb
  $ aletheia migrate --source mongodb --target sqlite --batch-size 500

Notes:
  - Migration is resumable: if interrupted, it will continue from where it left off
  - Cursor is saved to ./data/.migrate-cursor
  - Schema migrations (001_*, 002_*, etc.) run automatically on startup
```

### Version Command

```bash
$ aletheia --version
$ aletheia -V
```

### Better Option Parsing

The `stats` command now uses proper option parsing:

```bash
# Old way (still works)
$ aletheia stats --backfill --from=2025-03-01 --to=2025-03-13

# New way (also works)
$ aletheia stats --backfill --from 2025-03-01 --to 2025-03-13
```

### Rich Help Text

The stats command includes examples:

```bash
$ aletheia stats --help

Usage: aletheia stats [options]

Compute and aggregate certificate statistics

Options:
  --backfill              Backfill missing stats for historical periods
  --from <date>           Start date for backfill (YYYY-MM-DD)
  --to <date>             End date for backfill (YYYY-MM-DD)
  --granularity <type>    Compute hourly, daily, or both (comma-separated) (default: "hourly,daily")
  --force                 Recompute all periods in range (overwrite existing stats)
  -h, --help              display help for command

Examples:
  $ aletheia stats                              # Compute missing stats for last completed periods
  $ aletheia stats --backfill                   # Fill all missing stats from oldest to yesterday
  $ aletheia stats --backfill --from 2025-03-01 --to 2025-03-13
  $ aletheia stats --backfill --granularity hourly
  $ aletheia stats --backfill --force           # Recompute all (overwrite existing)
```

## Installation

After pulling these changes, install the new dependency:

```bash
bun install
```

## Testing

Test that the new CLI works:

```bash
# Show global help
bun run src/index.ts --help

# Show stats command help
bun run src/index.ts stats --help

# Show version
bun run src/index.ts --version

# Run commands (should work as before)
bun run src/index.ts migrate
bun run src/index.ts serve
bun run src/index.ts stats --backfill
```

## Backward Compatibility

✅ **All existing commands work exactly as before**
✅ **Existing scripts and workflows are not affected**
✅ **Command interfaces unchanged** (still use `run(args: string[])`)

The only change is HOW arguments are parsed and help text is generated. The functionality is identical.

## Benefits

### 1. **Industry Standard**
- Commander is used by thousands of CLI tools
- Well-maintained with excellent TypeScript support
- Proven reliability and stability

### 2. **Better UX**
- Automatic help generation
- Consistent help format across all commands
- Rich examples and usage information
- Version command out of the box

### 3. **Better Developer Experience**
- Declarative API is easier to read and maintain
- Less boilerplate code
- Type-safe option parsing
- Better error messages for invalid arguments

### 4. **Future-Proof**
- Easy to add new commands and options
- Built-in support for subcommands
- Extensible with custom help formatters
- Supports advanced features (variadic args, custom parsers, etc.)

## Compiled Binary

The CLI still works in compiled mode:

```bash
bun run compile
./out/aletheia --help
./out/aletheia stats --help
```

Commander is bundled into the binary, so no external dependencies are needed at runtime.

## Future Improvements

Now that we have commander, we can easily add:

- **Interactive prompts** - Using commander + inquirer for interactive mode
- **Auto-completion** - Generate shell completion scripts
- **Rich formatting** - Add colors and tables using commander + chalk
- **Command aliases** - Add short aliases for common commands
- **Global options** - Add --quiet, --verbose, --json flags

## Migration Path for Other Commands

If you want to migrate individual commands away from the `CliCommand` interface:

```typescript
// Before (old pattern)
export const myCommand: CliCommand = {
  name: "my-command",
  description: "Does something",
  async run(args: string[]) {
    // Parse args manually
  }
};

// After (commander pattern)
// In src/index.ts:
program
  .command("my-command")
  .description("Does something")
  .option("-f, --flag", "Enable flag")
  .option("-v, --value <type>", "Set value")
  .action(async (options) => {
    // Options already parsed!
    console.log(options.flag, options.value);
  });
```

For now, we keep the backward-compatible interface to minimize changes, but new commands can use commander directly.
