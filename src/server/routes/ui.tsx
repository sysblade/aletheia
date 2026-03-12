import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { HomePage, StatsCards } from "../views/home.tsx";
import { SearchPage } from "../views/search.tsx";
import { ResultsTable } from "../views/components/results-table.tsx";
import { CertDetail } from "../views/components/cert-detail.tsx";
import { LiveStreamRows } from "../views/components/live-stream.tsx";
import { Layout } from "../views/layout.tsx";
import { metrics } from "../../utils/metrics.ts";
import { config } from "../../config.ts";

const LIVE_STREAM_LIMIT = 25;

export const uiRoutes = new Hono<AppEnv>();

uiRoutes.get("/", async (c) => {
  const repo = c.get("repository");
  const [stats, recentCerts] = await Promise.all([repo.getStats(), repo.getRecent(LIVE_STREAM_LIMIT)]);
  const m = metrics.snapshot();
  const filterMode = config.filters.domains.length === 0 && config.filters.issuers.length === 0 ? "firehose" : "filtered";

  return c.html(
    <HomePage
      stats={stats}
      insertRate={metrics.insertRate()}
      uptimeSeconds={Math.floor((Date.now() - m.startedAt) / 1000)}
      filterMode={filterMode}
      recentCerts={recentCerts}
    />,
  );
});

uiRoutes.get("/search", async (c) => {
  const q = c.req.query("q")?.trim();
  return c.html(<SearchPage query={q} />);
});

uiRoutes.get("/search/results", async (c) => {
  const repo = c.get("repository");
  const q = c.req.query("q")?.trim() ?? "";
  const page = Math.max(1, Number(c.req.query("page")) || 1);

  if (q.length < 2) {
    return c.html(
      <div class="text-center py-12 text-gray-400">
        Enter at least 2 characters to search
      </div>,
    );
  }

  const result = await repo.search(q, { page, limit: 50 });

  return c.html(
    <ResultsTable
      certificates={result.certificates}
      total={result.total}
      page={result.page}
      totalPages={result.totalPages}
      query={q}
    />,
  );
});

uiRoutes.get("/cert/:id", async (c) => {
  const repo = c.get("repository");
  const id = Number(c.req.param("id"));

  if (!Number.isFinite(id) || id < 1) {
    return c.html(
      <Layout title="Not Found">
        <div class="text-center py-12 text-gray-400">Invalid certificate ID</div>
      </Layout>,
      400,
    );
  }

  const cert = await repo.getById(id);
  if (!cert) {
    return c.html(
      <Layout title="Not Found">
        <div class="text-center py-12 text-gray-400">Certificate not found</div>
      </Layout>,
      404,
    );
  }

  return c.html(
    <Layout title={cert.subjectCn || cert.domains[0]}>
      <div class="mb-4">
        <a href="javascript:history.back()" class="text-green-400 hover:text-green-300 text-sm">&larr; Back</a>
      </div>
      <CertDetail cert={cert} />
    </Layout>,
  );
});

uiRoutes.get("/partials/live-stream", async (c) => {
  const repo = c.get("repository");
  const certs = await repo.getRecent(LIVE_STREAM_LIMIT);
  return c.html(<LiveStreamRows certificates={certs} />);
});

uiRoutes.get("/partials/stats", async (c) => {
  const repo = c.get("repository");
  const stats = await repo.getStats();
  const m = metrics.snapshot();
  const filterMode = config.filters.domains.length === 0 && config.filters.issuers.length === 0 ? "firehose" : "filtered";

  return c.html(
    <StatsCards
      stats={stats}
      insertRate={metrics.insertRate()}
      uptimeSeconds={Math.floor((Date.now() - m.startedAt) / 1000)}
      filterMode={filterMode}
    />,
  );
});
