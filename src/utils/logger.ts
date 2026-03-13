import { configure, getConsoleSink, getLogger, parseLogLevel } from "@logtape/logtape";
import type { LogLevel } from "@logtape/logtape";

const VALID_LEVELS: ReadonlySet<string> = new Set(["trace", "debug", "info", "warning", "error", "fatal"]);

function resolveLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (!raw) return "info";
  if (raw === "warn") return "warning";
  if (VALID_LEVELS.has(raw)) return parseLogLevel(raw);
  return "info";
}

export async function configureLogging(): Promise<void> {
  const level = resolveLogLevel();
  await configure({
    sinks: {
      console: getConsoleSink(),
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
