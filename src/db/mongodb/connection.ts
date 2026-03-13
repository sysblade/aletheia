import { MongoClient, type Db } from "mongodb";
import type { CertificateDocument, CounterDocument } from "./schema.ts";
import { getLogger } from "../../utils/logger.ts";

const log = getLogger(["ctlog", "mongodb"]);

/**
 * Connect to MongoDB and ensure indexes and counters are initialized.
 * Drops obsolete indexes and creates optimized index set.
 */
export async function connectMongo(url: string, database: string): Promise<Db> {
  const redactedUrl = url.replace(/:\/\/[^@]*@/, "://***@");
  log.info("Connecting to MongoDB at {url}, database {database}", { url: redactedUrl, database });

  const client = new MongoClient(url);
  await client.connect();

  const db = client.db(database);

  const certs = db.collection<CertificateDocument>("certificates");

  // Drop obsolete indexes before (re)creating desired ones
  await certs.dropIndex("domains_text_issuerOrg_text_subjectCn_text").catch(() => {});
  await certs.dropIndex("issuerOrg_1").catch(() => {});
  await certs.dropIndex("createdAt_-1").catch(() => {});

  await certs.createIndex({ fingerprint: 1 }, { unique: true });
  await certs.createIndex({ numericId: 1 }, { unique: true });
  await certs.createIndex({ seenAt: -1 });
  await certs.createIndex({ notAfter: 1 });
  await certs.createIndex({ issuerOrg: 1 });

  await db.collection<CounterDocument>("counters").updateOne(
    { _id: "certificates" },
    { $setOnInsert: { seq: 0 } },
    { upsert: true },
  );

  log.info("MongoDB connected, indexes ensured");

  return db;
}
