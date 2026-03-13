import { configure, getLogger, parseLogLevel } from "@logtape/logtape";
import type { LogLevel, Sink } from "@logtape/logtape";

const VALID_LEVELS: ReadonlySet<string> = new Set(["trace", "debug", "info", "warning", "error", "fatal"]);

function resolveLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (!raw) return "info";
  if (raw === "warn") return "warning";
  if (VALID_LEVELS.has(raw)) return parseLogLevel(raw);
  return "info";
}

/**
 * Create console sink with process role prefix.
 * Formats logs as: [ROLE] timestamp LEVEL category message
 * Writes to stderr to keep stdout clean for IPC messages.
 */
/** Render a single message fragment, expanding Error objects to their stack trace. */
function renderFragment(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  return String(value);
}

function createRoleConsoleSink(role: string): Sink {
  const rolePrefix = `[${role.toUpperCase()}] `;

  return (record) => {
    // Format: [ROLE] timestamp LEVEL category message
    const timestamp = new Date(record.timestamp).toISOString();
    const level = record.level.toUpperCase().padEnd(7);
    const category = record.category.join("·");
    // record.message is interleaved [literal, value, literal, value, …].
    // renderFragment handles Error values so callers can pass errors directly.
    const message = record.message.map(renderFragment).join("");

    const line = `${rolePrefix}${timestamp} ${level} ${category} ${message}\n`;

    // Write to stderr to keep stdout clean for IPC
    process.stderr.write(line);
  };
}

/**
 * Configure LogTape logging with console sink and LOG_LEVEL environment variable.
 * Must be called once at application startup before any logging occurs.
 *
 * @param role - Process role identifier (command name or "main") for log prefixing
 */
export async function configureLogging(role: string = "main"): Promise<void> {
  const level = resolveLogLevel();
  await configure({
    sinks: {
      console: createRoleConsoleSink(role),
    },
    loggers: [
      {
        category: "aletheia",
        lowestLevel: level,
        sinks: ["console"],
      },
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"],
      },
    ],
  });
}

export { getLogger };

/**
 * Returns true for the internal stream-cleanup TypeError that @clickhouse/client-web
 * throws as an unhandled rejection in Bun due to a Web Streams API incompatibility.
 * The error is harmless (queries complete successfully) but would otherwise flood logs.
 * Identified by: TypeError with "undefined is not a function", stack only in native frames.
 */
export function isClickHouseStreamBug(reason: unknown): boolean {
  if (!(reason instanceof TypeError)) return false;
  if (!reason.message.includes("undefined is not a function")) return false;
  // Stack contains only native/compiled frames — no user-code frames
  const stack = reason.stack ?? "";
  return stack.split("\n").slice(1).every((line) => line.includes("native:") || line.trim() === "");
}
