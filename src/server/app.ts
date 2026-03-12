import { Hono } from "hono";
import { logger } from "hono/logger";
import type { CertificateRepository } from "../db/repository.ts";
import { SearchError } from "../db/sqlite/repository.ts";
import { apiRoutes } from "./routes/api.ts";
import { uiRoutes } from "./routes/ui.tsx";
import { getLogger } from "../utils/logger.ts";

const log = getLogger(["ctlog", "server"]);

export type AppEnv = {
  Variables: {
    repository: CertificateRepository;
  };
};

export function createApp(repository: CertificateRepository) {
  const app = new Hono<AppEnv>();

  app.use(logger());

  app.use("*", async (c, next) => {
    c.set("repository", repository);
    await next();
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
