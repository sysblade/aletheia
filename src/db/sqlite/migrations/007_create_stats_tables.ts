import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Create hourly_stats table
  await db.schema
    .createTable("hourly_stats")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("period_start", "integer", (col) => col.notNull().unique())
    .addColumn("period_end", "integer", (col) => col.notNull())
    .addColumn("total_certificates", "integer", (col) => col.notNull())
    .addColumn("unique_domains", "integer", (col) => col.notNull())
    .addColumn("unique_issuers", "integer", (col) => col.notNull())
    .addColumn("wildcard_count", "integer", (col) => col.notNull())
    .addColumn("avg_san_count", "real", (col) => col.notNull())
    .addColumn("top_domains", "text", (col) => col.notNull())
    .addColumn("top_issuers", "text", (col) => col.notNull())
    .addColumn("computed_at", "integer", (col) => col.notNull().defaultTo(sql`(unixepoch())`))
    .execute();

  await db.schema
    .createIndex("idx_hourly_stats_period_start")
    .on("hourly_stats")
    .column("period_start desc")
    .execute();

  // Create daily_stats table
  await db.schema
    .createTable("daily_stats")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("period_start", "integer", (col) => col.notNull().unique())
    .addColumn("period_end", "integer", (col) => col.notNull())
    .addColumn("total_certificates", "integer", (col) => col.notNull())
    .addColumn("unique_domains", "integer", (col) => col.notNull())
    .addColumn("unique_issuers", "integer", (col) => col.notNull())
    .addColumn("wildcard_count", "integer", (col) => col.notNull())
    .addColumn("avg_san_count", "real", (col) => col.notNull())
    .addColumn("peak_hourly_rate", "integer", (col) => col.notNull())
    .addColumn("top_domains", "text", (col) => col.notNull())
    .addColumn("top_issuers", "text", (col) => col.notNull())
    .addColumn("computed_at", "integer", (col) => col.notNull().defaultTo(sql`(unixepoch())`))
    .execute();

  await db.schema
    .createIndex("idx_daily_stats_period_start")
    .on("daily_stats")
    .column("period_start desc")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("daily_stats").execute();
  await db.schema.dropTable("hourly_stats").execute();
}
