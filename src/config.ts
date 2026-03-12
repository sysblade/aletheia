import type { StoreType } from "./db/factory.ts";

const VALID_STORE_TYPES: readonly string[] = ["sqlite", "mongodb"];

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

export interface Config {
  store: { type: StoreType };
  db: { path: string; retentionDays: number };
  mongo: { url: string; database: string };
  certstream: { url: string };
  batch: { size: number; intervalMs: number };
  server: { port: number; host: string };
  filters: { domains: string[]; issuers: string[] };
}

export function loadConfig(): Config {
  return {
    store: {
      type: parseStoreType(process.env.STORE_TYPE),
    },
    db: {
      path: process.env.DB_PATH || "./data/ctlog.sqlite",
      retentionDays: Number(process.env.DB_RETENTION_DAYS) || 90,
    },
    mongo: {
      url: process.env.MONGO_URL || "mongodb://localhost:27017",
      database: process.env.MONGO_DATABASE || "ctlog",
    },
    certstream: {
      url: process.env.CERTSTREAM_URL || "wss://api.certstream.dev/",
    },
    batch: {
      size: Number(process.env.BATCH_SIZE) || 500,
      intervalMs: Number(process.env.BATCH_INTERVAL) || 3000,
    },
    server: {
      port: Number(process.env.PORT) || 3000,
      host: process.env.HOST || "0.0.0.0",
    },
    filters: {
      domains: parseList(process.env.FILTER_DOMAINS),
      issuers: parseList(process.env.FILTER_ISSUERS),
    },
  };
}
