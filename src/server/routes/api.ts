import { Hono } from "hono";
import type { AppEnv } from "../app.ts";

export const apiRoutes = new Hono<AppEnv>();

apiRoutes.get("/search", async (c) => {
  const repo = c.get("repository");
  const q = c.req.query("q")?.trim();
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 50));

  if (!q || q.length < 2) {
    return c.json({ error: "Query must be at least 2 characters" }, 400);
  }

  const result = await repo.search(q, { page, limit });
  return c.json(result);
});

apiRoutes.get("/cert/:id", async (c) => {
  const repo = c.get("repository");
  const id = Number(c.req.param("id"));

  if (!Number.isFinite(id) || id < 1) {
    return c.json({ error: "Invalid certificate ID" }, 400);
  }

  const cert = await repo.getById(id);
  if (!cert) {
    return c.json({ error: "Certificate not found" }, 404);
  }

  return c.json(cert);
});

apiRoutes.get("/stats", async (c) => {
  const metrics = c.get("metrics");
  const filter = c.get("filter");
  const config = c.get("config");
  const getStats = c.get("getStats");
  const stats = await getStats();
  const m = metrics.snapshot();

  return c.json({
    ...stats,
    ingestion: {
      certsReceived: m.certsReceived,
      certsFiltered: m.certsFiltered,
      certsInserted: m.certsInserted,
      certsDroppedDuplicate: m.certsDroppedDuplicate,
      batchesWritten: m.batchesWritten,
      wsReconnections: m.wsReconnections,
      insertRate: metrics.insertRate(),
      uptimeSeconds: Math.floor((Date.now() - m.startedAt) / 1000),
    },
    filters: {
      domains: config.filters.domains,
      issuers: config.filters.issuers,
      mode: filter.mode,
    },
  });
});
