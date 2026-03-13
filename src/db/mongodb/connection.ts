import { MongoClient, type Db, type IndexSpecification, type CreateIndexesOptions } from "mongodb";
import type { CertificateDocument } from "./schema.ts";
import { getLogger } from "../../utils/logger.ts";
import type { Config } from "../../config.ts";

const log = getLogger(["ctlog", "mongodb"]);

/**
 * Connect to MongoDB and optionally ensure indexes and counters are initialized.
 * Drops obsolete indexes and creates optimized index set.
 *
 * @param mongoCfg - MongoDB configuration
 * @param skipIndexManagement - Skip index creation/dropping (for worker processes to avoid conflicts)
 */
export async function connectMongo(mongoCfg: Config["mongo"], skipIndexManagement = false, appName = "ctlog"): Promise<Db> {
  const redactedUrl = mongoCfg.url.replace(/:\/\/[^@]*@/, "://***@");
  log.info("Connecting to MongoDB at {url}, database {database} (appName={appName})", {
    url: redactedUrl,
    database: mongoCfg.database,
    appName,
  });

  const client = new MongoClient(mongoCfg.url, {
    appName,
    maxPoolSize: mongoCfg.maxPoolSize,
    minPoolSize: mongoCfg.minPoolSize,
    maxIdleTimeMS: mongoCfg.maxIdleTimeMs,
    socketTimeoutMS: mongoCfg.socketTimeoutMs,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
    retryReads: true,
  });

  await client.connect();

  const db = client.db(mongoCfg.database);

  if (!skipIndexManagement) {
    const certs = db.collection<CertificateDocument>("certificates");

    // Helper to drop index with error handling
    const dropIndexSafe = async (name: string) => {
      await certs.dropIndex(name).catch((err) => {
        log.debug("Skipping drop of {name} index: {error}", { name, error: String(err) });
      });
    };

    // Helper to create index with error handling
    const createIndexSafe = async (spec: IndexSpecification, options: CreateIndexesOptions, name: string) => {
      await certs.createIndex(spec, options).catch((err) => {
        log.debug("Index creation for {name}: {error}", { name, error: String(err) });
      });
    };

    // Drop obsolete indexes (silently ignore errors)
    await Promise.all([
      dropIndexSafe("domains_text_issuerOrg_text_subjectCn_text"),
      dropIndexSafe("issuerOrg_1"),
      dropIndexSafe("createdAt_-1"),
      dropIndexSafe("numericId_1"),
    ]);

    // Create required indexes (MongoDB skips if they exist)
    await Promise.all([
      createIndexSafe({ fingerprint: 1 }, { unique: true }, "fingerprint"),
      createIndexSafe({ seenAt: -1 }, {}, "seenAt"),
      createIndexSafe({ notAfter: 1 }, {}, "notAfter"),
      createIndexSafe({ issuerOrg: 1 }, {}, "issuerOrg"),
    ]);

    log.info("MongoDB connected, indexes ensured (pool: max={max}, min={min}, maxIdle={maxIdle}ms, socketTimeout={timeout}ms)", {
      max: mongoCfg.maxPoolSize,
      min: mongoCfg.minPoolSize,
      maxIdle: mongoCfg.maxIdleTimeMs,
      timeout: mongoCfg.socketTimeoutMs,
    });
  } else {
    log.info("MongoDB connected (pool: max={max}, min={min}, maxIdle={maxIdle}ms, socketTimeout={timeout}ms)", {
      max: mongoCfg.maxPoolSize,
      min: mongoCfg.minPoolSize,
      maxIdle: mongoCfg.maxIdleTimeMs,
      timeout: mongoCfg.socketTimeoutMs,
    });
  }

  return db;
}
