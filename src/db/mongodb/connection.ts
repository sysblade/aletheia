import { MongoClient, type Db } from "mongodb";
import type { CertificateDocument, CounterDocument } from "./schema.ts";
import { getLogger } from "../../utils/logger.ts";
import type { Config } from "../../config.ts";

const log = getLogger(["ctlog", "mongodb"]);

/**
 * Connect to MongoDB and ensure indexes and counters are initialized.
 * Drops obsolete indexes and creates optimized index set.
 */
export async function connectMongo(mongoCfg: Config["mongo"]): Promise<Db> {
  const redactedUrl = mongoCfg.url.replace(/:\/\/[^@]*@/, "://***@");
  log.info("Connecting to MongoDB at {url}, database {database}", {
    url: redactedUrl,
    database: mongoCfg.database,
  });

  const client = new MongoClient(mongoCfg.url, {
    maxPoolSize: mongoCfg.maxPoolSize,
    minPoolSize: mongoCfg.minPoolSize,
    maxIdleTimeMS: 30000,
    socketTimeoutMS: mongoCfg.socketTimeoutMs,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
    retryReads: true,
  });

  await client.connect();

  const db = client.db(mongoCfg.database);

  const certs = db.collection<CertificateDocument>("certificates");

  // Drop obsolete indexes before (re)creating desired ones
  // Silently ignore errors (e.g., index doesn't exist, index build in progress)
  await certs.dropIndex("domains_text_issuerOrg_text_subjectCn_text").catch((err) => {
    log.debug("Skipping drop of domains_text index: {error}", { error: String(err) });
  });
  await certs.dropIndex("issuerOrg_1").catch((err) => {
    log.debug("Skipping drop of issuerOrg_1 index: {error}", { error: String(err) });
  });
  await certs.dropIndex("createdAt_-1").catch((err) => {
    log.debug("Skipping drop of createdAt_-1 index: {error}", { error: String(err) });
  });

  // Create indexes - MongoDB will skip if they already exist
  await certs.createIndex({ fingerprint: 1 }, { unique: true }).catch((err) => {
    // Index might already exist or be building - log and continue
    log.debug("Index creation for fingerprint: {error}", { error: String(err) });
  });
  await certs.createIndex({ numericId: 1 }, { unique: true }).catch((err) => {
    log.debug("Index creation for numericId: {error}", { error: String(err) });
  });
  await certs.createIndex({ seenAt: -1 }).catch((err) => {
    log.debug("Index creation for seenAt: {error}", { error: String(err) });
  });
  await certs.createIndex({ notAfter: 1 }).catch((err) => {
    log.debug("Index creation for notAfter: {error}", { error: String(err) });
  });
  await certs.createIndex({ issuerOrg: 1 }).catch((err) => {
    log.debug("Index creation for issuerOrg: {error}", { error: String(err) });
  });

  await db.collection<CounterDocument>("counters").updateOne(
    { _id: "certificates" },
    { $setOnInsert: { seq: 0 } },
    { upsert: true },
  );

  log.info("MongoDB connected, indexes ensured (pool: max={max}, min={min}, socketTimeout={timeout}ms)", {
    max: mongoCfg.maxPoolSize,
    min: mongoCfg.minPoolSize,
    timeout: mongoCfg.socketTimeoutMs,
  });

  return db;
}
