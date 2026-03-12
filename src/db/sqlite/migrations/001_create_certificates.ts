import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("certificates")
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("fingerprint", "text", (col) => col.notNull().unique())
    .addColumn("domains", "text", (col) => col.notNull())
    .addColumn("domain_count", "integer", (col) => col.notNull())
    .addColumn("issuer_org", "text")
    .addColumn("issuer_cn", "text")
    .addColumn("subject_cn", "text")
    .addColumn("not_before", "integer", (col) => col.notNull())
    .addColumn("not_after", "integer", (col) => col.notNull())
    .addColumn("serial_number", "text", (col) => col.notNull())
    .addColumn("log_name", "text")
    .addColumn("log_url", "text")
    .addColumn("cert_index", "integer")
    .addColumn("cert_link", "text")
    .addColumn("seen_at", "integer", (col) => col.notNull())
    .addColumn("created_at", "integer", (col) => col.notNull().defaultTo(sql`(unixepoch())`))
    .execute();

  await db.schema.createIndex("idx_certificates_seen_at").on("certificates").column("seen_at desc").execute();
  await db.schema.createIndex("idx_certificates_not_before").on("certificates").column("not_before desc").execute();
  await db.schema.createIndex("idx_certificates_issuer_org").on("certificates").column("issuer_org").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("certificates").execute();
}
