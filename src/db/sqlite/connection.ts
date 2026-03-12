import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { Database as BunDatabase } from "bun:sqlite";
import type { Database } from "./schema.ts";
import { getLogger } from "../../utils/logger.ts";

const log = getLogger(["ctlog", "sqlite"]);

export function createDatabase(path: string): Kysely<Database> {
  log.info("Opening database at {path}", { path });

  const sqlite = new BunDatabase(path, { create: true });

  sqlite.exec("PRAGMA page_size = 8192"); // only effective on new databases
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  sqlite.exec("PRAGMA cache_size = -64000"); // 64MB
  sqlite.exec("PRAGMA busy_timeout = 5000");
  sqlite.exec("PRAGMA temp_store = MEMORY");
  sqlite.exec("PRAGMA mmap_size = 268435456"); // 256MB
  sqlite.exec("PRAGMA wal_autocheckpoint = 10000"); // reduce checkpoint frequency for append-heavy workload
  sqlite.exec("PRAGMA foreign_keys = OFF"); // no FK constraints in schema

  log.info("SQLite pragmas configured (WAL mode, 64MB cache)");

  const db = new Kysely<Database>({
    dialect: new BunSqliteDialect({ database: sqlite }),
  });

  return db;
}
