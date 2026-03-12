import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TRIGGER certificates_au AFTER UPDATE ON certificates BEGIN
      INSERT INTO certificates_fts(certificates_fts, rowid, domains, issuer_org, subject_cn)
      VALUES ('delete', old.id, old.domains, old.issuer_org, old.subject_cn);
      INSERT INTO certificates_fts(rowid, domains, issuer_org, subject_cn)
      VALUES (new.id, new.domains, new.issuer_org, new.subject_cn);
    END
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS certificates_au`.execute(db);
}
