import { configure, getConsoleSink, getLogger, parseLogLevel } from "@logtape/logtape";
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
 */
function createRoleConsoleSink(role: string): Sink {
  const baseSink = getConsoleSink();
  const rolePrefix = `[${role.toUpperCase()}] `;

  return (record) => {
    // Add role prefix by modifying the record
    const modifiedRecord = {
      ...record,
      message: [rolePrefix, ...record.message],
    };
    return baseSink(modifiedRecord);
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
        category: "ctlog",
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
