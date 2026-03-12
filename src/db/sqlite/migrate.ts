import { type Kysely, type Migration, type MigrationProvider, Migrator } from "kysely";
import type { Database } from "./schema.ts";
import { createLogger } from "../../utils/logger.ts";

import * as m001 from "./migrations/001_create_certificates.ts";
import * as m002 from "./migrations/002_create_fts_index.ts";

const log = createLogger("migrate");

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      "001_create_certificates": m001,
      "002_create_fts_index": m002,
    };
  }
}

export async function runMigrations(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new StaticMigrationProvider(),
  });

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach((result) => {
    if (result.status === "Success") {
      log.info(`Migration "${result.migrationName}" executed successfully`);
    } else if (result.status === "Error") {
      log.error(`Migration "${result.migrationName}" failed`);
    }
  });

  if (error) {
    log.error("Migration failed", { error: String(error) });
    throw error;
  }
}
