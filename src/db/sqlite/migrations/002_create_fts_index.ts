import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE VIRTUAL TABLE certificates_fts USING fts5(
      domains, issuer_org, subject_cn,
      tokenize='trigram',
      content='certificates',
      content_rowid='id'
    )
  `.execute(db);

  await sql`
    CREATE TRIGGER certificates_ai AFTER INSERT ON certificates BEGIN
      INSERT INTO certificates_fts(rowid, domains, issuer_org, subject_cn)
      VALUES (new.id, new.domains, new.issuer_org, new.subject_cn);
    END
  `.execute(db);

  await sql`
    CREATE TRIGGER certificates_ad AFTER DELETE ON certificates BEGIN
      INSERT INTO certificates_fts(certificates_fts, rowid, domains, issuer_org, subject_cn)
      VALUES ('delete', old.id, old.domains, old.issuer_org, old.subject_cn);
    END
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS certificates_ad`.execute(db);
  await sql`DROP TRIGGER IF EXISTS certificates_ai`.execute(db);
  await sql`DROP TABLE IF EXISTS certificates_fts`.execute(db);
}
