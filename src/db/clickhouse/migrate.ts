import type { ClickHouseClient } from "@clickhouse/client-web";
import { getLogger } from "../../utils/logger.ts";

import * as m001 from "./migrations/001_create_certificates.ts";
import * as m002 from "./migrations/002_add_ngram_indexes.ts";
import * as m003 from "./migrations/003_create_hourly_stats.ts";
import * as m004 from "./migrations/004_create_metadata.ts";
import * as m005 from "./migrations/005_create_daily_stats.ts";
import * as m006 from "./migrations/006_optimize_indexes.ts";
import * as m007 from "./migrations/007_daily_partitioning.ts";

const log = getLogger(["aletheia", "clickhouse", "migrate"]);

export interface ClickHouseMigration {
  up: (client: ClickHouseClient) => Promise<void>;
  down?: (client: ClickHouseClient) => Promise<void>;
}

/**
 * Static migration registry for ClickHouse.
 * Avoids dynamic file system access for compatibility with bundled/compiled mode.
 */
const migrations: Record<string, ClickHouseMigration> = {
  "001_create_certificates": m001,
  "002_add_ngram_indexes": m002,
  "003_create_hourly_stats": m003,
  "004_create_metadata": m004,
  "005_create_daily_stats": m005,
  "006_optimize_indexes": m006,
  "007_daily_partitioning": m007,
};

/**
 * Get list of applied migrations from metadata table.
 * Returns empty set if metadata table doesn't exist yet.
 */
async function getAppliedMigrations(client: ClickHouseClient): Promise<Set<string>> {
  try {
    const result = await client.query({
      query: `
        SELECT value
        FROM metadata
        WHERE key LIKE 'migration:%'
      `,
      format: "JSONEachRow",
    });

    const rows = await result.json<{ value: string }>();
    return new Set(rows.map((row) => row.value));
  } catch (err) {
    // Metadata table doesn't exist yet (pre-migration 004)
    // This is expected on first run
    return new Set();
  }
}

/**
 * Mark a migration as applied in the metadata table.
 */
async function markMigrationApplied(
  client: ClickHouseClient,
  name: string,
): Promise<void> {
  await client.insert({
    table: "metadata",
    values: [
      {
        key: `migration:${name}`,
        value: name,
        updatedAt: Date.now(),
      },
    ],
    format: "JSONEachRow",
  });
}

/**
 * Run all pending ClickHouse migrations to latest version.
 * Migrations are tracked in the metadata table using keys like "migration:001_create_certificates".
 *
 * Note: Migration 004 creates the metadata table itself, so we handle bootstrapping:
 * - Migrations 001-004 are applied if metadata table doesn't exist
 * - Migration 005+ are applied based on metadata table records
 */
export async function runClickHouseMigrations(client: ClickHouseClient): Promise<void> {
  const appliedMigrations = await getAppliedMigrations(client);
  const migrationNames = Object.keys(migrations).sort();

  let appliedCount = 0;

  for (const name of migrationNames) {
    if (appliedMigrations.has(name)) {
      log.debug("Migration {name} already applied, skipping", { name });
      continue;
    }

    const migration = migrations[name];
    if (!migration) {
      log.error("Migration {name} not found in registry", { name });
      throw new Error(`Migration ${name} not found`);
    }

    log.info("Applying migration {name}", { name });

    try {
      await migration.up(client);

      // Mark as applied (metadata table will exist after migration 004)
      if (name >= "004_create_metadata") {
        await markMigrationApplied(client, name);
      }

      log.info("Migration {name} applied successfully", { name });
      appliedCount++;
    } catch (err) {
      log.error("Migration {name} failed: {error}", {
        name,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(`Migration ${name} failed: ${err}`);
    }
  }

  // Backfill migration records for 001-003 if metadata table was just created
  if (appliedCount > 0 && appliedMigrations.size === 0) {
    log.info("Backfilling migration records for initial migrations");
    for (const name of migrationNames) {
      if (name < "004_create_metadata") {
        await markMigrationApplied(client, name);
      }
    }
  }

  if (appliedCount === 0) {
    log.info("All ClickHouse migrations up to date");
  } else {
    log.info("Applied {count} ClickHouse migration(s)", { count: appliedCount });
  }
}
