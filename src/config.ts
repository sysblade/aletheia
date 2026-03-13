import type { StoreType } from "./db/factory.ts";

const VALID_STORE_TYPES: readonly string[] = ["sqlite", "mongodb", "clickhouse"];

function parseStoreType(value: string | undefined): StoreType {
  const type = value || "sqlite";
  if (!VALID_STORE_TYPES.includes(type)) {
    throw new Error(`Invalid STORE_TYPE "${type}". Valid values: ${VALID_STORE_TYPES.join(", ")}`);
  }
  return type as StoreType;
}

function parseList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Application configuration loaded from environment variables.
 * All settings have sensible defaults for development.
 */
export interface Config {
  store: { type: StoreType };
  db: { path: string; retentionDays: number; maintenanceIntervalHours: number };
  mongo: {
    url: string;
    database: string;
    socketTimeoutMs: number;
    maxPoolSize: number;
    minPoolSize: number;
    maxIdleTimeMs: number;
  };
  clickhouse: {
    url: string;
    database: string;
    username: string;
    password: string;
    requestTimeoutMs: number;
  };
  certstream: { url: string };
  batch: { size: number; intervalMs: number; maxQueueSize: number };
  server: { port: number; host: string };
  filters: { domains: string[]; issuers: string[] };
  stats: { enabled: boolean; hourlySchedule: string; dailySchedule: string };
}

/**
 * Load configuration from environment variables with validation and defaults.
 * Throws on invalid STORE_TYPE. Safe to call multiple times.
 */
export function loadConfig(): Config {
  return {
    store: {
      type: parseStoreType(process.env.STORE_TYPE),
    },
    db: {
      path: process.env.DB_PATH || "./data/aletheia.sqlite",
      retentionDays: Number(process.env.DB_RETENTION_DAYS) || 90,
      maintenanceIntervalHours: Number(process.env.DB_MAINTENANCE_INTERVAL_HOURS) || 6,
    },
    mongo: {
      url: process.env.MONGO_URL || "mongodb://localhost:27017",
      database: process.env.MONGO_DATABASE || "aletheia",
      socketTimeoutMs: Number(process.env.MONGO_SOCKET_TIMEOUT_MS) || 15000,
      maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 10,
      minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE) || 2,
      maxIdleTimeMs: Number(process.env.MONGO_MAX_IDLE_TIME_MS) || 300000,
    },
    clickhouse: {
      url: process.env.CLICKHOUSE_URL || "http://localhost:8123",
      database: process.env.CLICKHOUSE_DATABASE || "aletheia",
      username: process.env.CLICKHOUSE_USERNAME || "default",
      password: process.env.CLICKHOUSE_PASSWORD || "",
      requestTimeoutMs: Number(process.env.CLICKHOUSE_REQUEST_TIMEOUT_MS) || 30000,
    },
    certstream: {
      url: process.env.CERTSTREAM_URL || "wss://api.certstream.dev/",
    },
    batch: {
      size: Number(process.env.BATCH_SIZE) || 500,
      intervalMs: Number(process.env.BATCH_INTERVAL) || 3000,
      maxQueueSize: Number(process.env.BATCH_MAX_QUEUE_SIZE) || 50,
    },
    server: {
      port: Number(process.env.PORT) || 3000,
      host: process.env.HOST || "0.0.0.0",
    },
    filters: {
      domains: parseList(process.env.FILTER_DOMAINS),
      issuers: parseList(process.env.FILTER_ISSUERS),
    },
    stats: {
      enabled: process.env.STATS_ENABLED !== "false",
      hourlySchedule: process.env.STATS_HOURLY_SCHEDULE || "5 * * * *",
      dailySchedule: process.env.STATS_DAILY_SCHEDULE || "5 0 * * *",
    },
  };
}
