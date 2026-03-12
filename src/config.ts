function parseList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  db: {
    path: process.env.DB_PATH || "./data/ctlog.sqlite",
    retentionDays: Number(process.env.DB_RETENTION_DAYS) || 90,
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
} as const;

export type Config = typeof config;
