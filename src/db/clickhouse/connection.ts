import { createClient, type ClickHouseClient } from "@clickhouse/client-web";
import { getLogger } from "../../utils/logger.ts";
import type { Config } from "../../config.ts";
import { runClickHouseMigrations } from "./migrate.ts";

const log = getLogger(["aletheia", "clickhouse"]);

export async function connectClickHouse(
  cfg: Config["clickhouse"],
  skipTableManagement = false,
  appName = "aletheia",
): Promise<ClickHouseClient> {
  log.info("Connecting to ClickHouse at {url}, database {database} (appName={appName})", {
    url: cfg.url,
    database: cfg.database,
    appName,
  });

  const isMaintenance = appName.includes("maintenance");
  const client = createClient({
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    database: cfg.database,
    application: appName,
    request_timeout: isMaintenance ? cfg.maintenanceTimeoutMs : cfg.requestTimeoutMs,
    clickhouse_settings: {
      // Allow experimental lightweight deletes (ALTER TABLE ... DELETE still works on older versions)
      allow_experimental_lightweight_delete: 1,
    },
  });

  // Verify connectivity
  await client.ping();

  if (!skipTableManagement) {
    // Migrations may include long-running table rebuilds (e.g. adding PARTITION BY),
    // so use the maintenance timeout rather than the regular request timeout.
    const migrationClient = createClient({
      url: cfg.url,
      username: cfg.username,
      password: cfg.password,
      database: cfg.database,
      application: `${appName}-migrate`,
      request_timeout: cfg.maintenanceTimeoutMs,
      clickhouse_settings: {
        allow_experimental_lightweight_delete: 1,
      },
    });
    try {
      await runClickHouseMigrations(migrationClient);
    } finally {
      await migrationClient.close();
    }
    log.info("ClickHouse connected, migrations applied");
  } else {
    log.info("ClickHouse connected");
  }

  return client;
}
