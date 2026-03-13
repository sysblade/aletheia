import type { Config } from "../config.ts";
import type { CertificateRepository } from "./repository.ts";

/** Supported storage backend types. Configured via STORE_TYPE environment variable. */
export type StoreType = "sqlite" | "mongodb" | "clickhouse";

/**
 * Factory function to create a certificate repository based on storage type.
 * Handles database connection, schema migration (SQLite), and returns configured repository.
 *
 * @param storeType - Storage backend type (sqlite or mongodb)
 * @param cfg - Application configuration
 * @param skipIndexManagement - Skip MongoDB index management (for worker/maintenance processes)
 */
export async function createRepository(
  storeType: StoreType,
  cfg: Config,
  skipIndexManagement = false,
  appName = "aletheia"
): Promise<CertificateRepository> {
  switch (storeType) {
    case "sqlite": {
      const { createDatabase } = await import("./sqlite/connection.ts");
      const { runMigrations } = await import("./sqlite/migrate.ts");
      const { SqliteRepository } = await import("./sqlite/repository.ts");
      const db = createDatabase(cfg.db.path);
      await runMigrations(db);
      return new SqliteRepository(db);
    }
    case "mongodb": {
      const { connectMongo } = await import("./mongodb/connection.ts");
      const { MongoRepository } = await import("./mongodb/repository.ts");
      const db = await connectMongo(cfg.mongo, skipIndexManagement, appName);
      return new MongoRepository(db);
    }
    case "clickhouse": {
      const { connectClickHouse } = await import("./clickhouse/connection.ts");
      const { ClickHouseRepository } = await import("./clickhouse/repository.ts");
      const client = await connectClickHouse(cfg.clickhouse, skipIndexManagement, appName);
      return new ClickHouseRepository(client);
    }
    default:
      throw new Error(`Unsupported store type: ${storeType satisfies never}`);
  }
}
