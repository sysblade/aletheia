import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { Database as BunDatabase } from "bun:sqlite";
import type { Database } from "./schema.ts";
import { createLogger } from "../../utils/logger.ts";

const log = createLogger("sqlite");

export function createDatabase(path: string): Kysely<Database> {
  log.info("Opening database", { path });

  const sqlite = new BunDatabase(path, { create: true });

  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  sqlite.exec("PRAGMA cache_size = -64000"); // 64MB
  sqlite.exec("PRAGMA busy_timeout = 5000");
  sqlite.exec("PRAGMA temp_store = MEMORY");
  sqlite.exec("PRAGMA mmap_size = 268435456"); // 256MB
  sqlite.exec("PRAGMA foreign_keys = ON");

  log.info("SQLite pragmas configured (WAL mode, 64MB cache)");

  const db = new Kysely<Database>({
    dialect: new BunSqliteDialect({ database: sqlite }),
  });

  return db;
}
