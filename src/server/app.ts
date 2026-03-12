import { Hono } from "hono";
import { logger } from "hono/logger";
import { SearchError, type CertificateRepository } from "../db/repository.ts";
import type { MetricsCollector } from "../utils/metrics.ts";
import type { Config } from "../config.ts";
import type { CertFilter } from "../ingestor/filter.ts";
import type { EventBus } from "../utils/events.ts";
import type { NewCertificate, Stats } from "../types/certificate.ts";
import { cachedFn } from "../utils/cache.ts";
import { apiRoutes } from "./routes/api.ts";
import { uiRoutes } from "./routes/ui.tsx";
import { getLogger } from "../utils/logger.ts";

const log = getLogger(["ctlog", "server"]);

export type HealthProvider = () => { bufferPending: number };

export type AppEnv = {
  Variables: {
    repository: CertificateRepository;
    metrics: MetricsCollector;
    config: Config;
    filter: CertFilter;
    getStats: () => Promise<Stats>;
    certEvents: EventBus<NewCertificate[]>;
  };
};

export interface AppDeps {
  repository: CertificateRepository;
  metrics: MetricsCollector;
  config: Config;
  filter: CertFilter;
  certEvents: EventBus<NewCertificate[]>;
  healthProvider?: HealthProvider;
}

export function createApp(deps: AppDeps) {
  const { repository, metrics, config, filter, certEvents, healthProvider } = deps;
  const getStats = cachedFn(() => repository.getStats(), 10_000);

  const app = new Hono<AppEnv>();

  app.use(logger());

  app.use("*", async (c, next) => {
    c.set("repository", repository);
    c.set("metrics", metrics);
    c.set("config", config);
    c.set("filter", filter);
    c.set("getStats", getStats);
    c.set("certEvents", certEvents);
    await next();
  });

  app.get("/health", (c) => {
    const m = metrics.snapshot();
    const health = healthProvider?.() ?? { bufferPending: 0 };
    return c.json({
      status: "ok",
      uptimeSeconds: Math.floor((Date.now() - m.startedAt) / 1000),
      certsInserted: m.certsInserted,
      bufferPending: health.bufferPending,
    });
  });

  app.onError((err, c) => {
    if (err instanceof SearchError) {
      return c.json({ error: err.message }, 400);
    }
    log.error("Unhandled error on {path}: {error}", { error: String(err), path: c.req.path });
    return c.json({ error: "Internal server error" }, 500);
  });

  app.route("/api", apiRoutes);
  app.route("/", uiRoutes);

  return app;
}
