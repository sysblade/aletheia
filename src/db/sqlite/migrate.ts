import { type Kysely, type Migration, type MigrationProvider, Migrator } from "kysely";
import type { Database } from "./schema.ts";
import { getLogger } from "../../utils/logger.ts";

import * as m001 from "./migrations/001_create_certificates.ts";
import * as m002 from "./migrations/002_create_fts_index.ts";
import * as m003 from "./migrations/003_fts_update_trigger.ts";
import * as m004 from "./migrations/004_fts_detail_none.ts";
import * as m005 from "./migrations/005_fts_detail_full.ts";
import * as m006 from "./migrations/006_add_not_after_index.ts";

const log = getLogger(["ctlog", "migrate"]);

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      "001_create_certificates": m001,
      "002_create_fts_index": m002,
      "003_fts_update_trigger": m003,
      "004_fts_detail_none": m004,
      "005_fts_detail_full": m005,
      "006_add_not_after_index": m006,
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
      log.info("Migration {name} executed successfully", { name: result.migrationName });
    } else if (result.status === "Error") {
      log.error("Migration {name} failed", { name: result.migrationName });
    }
  });

  if (error) {
    log.error("Migration failed with {error}", { error: String(error) });
    throw error;
  }
}
