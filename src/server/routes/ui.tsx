import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../app.ts";
import { HomePage, StatsCards } from "../views/home.tsx";
import { ResultsTable } from "../views/components/results-table.tsx";
import { CertDetail } from "../views/components/cert-detail.tsx";
import { LiveStreamRows, LiveStreamTable } from "../views/components/live-stream.tsx";
import { Layout } from "../views/layout.tsx";

const LIVE_STREAM_LIMIT = 25;

/** Server-rendered UI routes using HTMX and JSX templates. */
export const uiRoutes = new Hono<AppEnv>();

uiRoutes.get("/", async (c) => {
  const metrics = c.get("metrics");
  const filter = c.get("filter");
  const getStats = c.get("getStats");
  const stats = await getStats();
  const m = metrics.snapshot();

  return c.html(
    <HomePage
      stats={stats}
      insertRate={metrics.insertRate()}
      uptimeSeconds={Math.floor((Date.now() - m.startedAt) / 1000)}
      filterMode={filter.mode}
    />,
  );
});

uiRoutes.get("/search", (c) => c.redirect("/"));

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

uiRoutes.get("/partials/live-stream-table", async (c) => {
  const repo = c.get("repository");
  const certs = await repo.getRecent(LIVE_STREAM_LIMIT);
  return c.html(<LiveStreamTable certificates={certs} />);
});

uiRoutes.get("/partials/live-stream", async (c) => {
  const repo = c.get("repository");
  const certs = await repo.getRecent(LIVE_STREAM_LIMIT);
  return c.html(<LiveStreamRows certificates={certs} />);
});

uiRoutes.get("/partials/stats", async (c) => {
  const metrics = c.get("metrics");
  const filter = c.get("filter");
  const getStats = c.get("getStats");
  const stats = await getStats();
  const m = metrics.snapshot();

  return c.html(
    <StatsCards
      stats={stats}
      insertRate={metrics.insertRate()}
      uptimeSeconds={Math.floor((Date.now() - m.startedAt) / 1000)}
      filterMode={filter.mode}
    />,
  );
});

uiRoutes.get("/events/live-stream", async (c) => {
  const repo = c.get("repository");
  const certEvents = c.get("certEvents");

  return streamSSE(c, async (stream) => {
    const certs = await repo.getRecent(LIVE_STREAM_LIMIT);
    const initialHtml = (<LiveStreamRows certificates={certs} />).toString();
    await stream.writeSSE({ data: initialHtml, event: "certificates" });

    let aborted = false;

    const unsubscribe = certEvents.subscribe(async () => {
      if (aborted) return;
      try {
        const recent = await repo.getRecent(LIVE_STREAM_LIMIT);
        const html = (<LiveStreamRows certificates={recent} />).toString();
        await stream.writeSSE({ data: html, event: "certificates" });
      } catch {}
    });

    stream.onAbort(() => {
      aborted = true;
      unsubscribe();
    });

    while (!aborted) {
      await stream.sleep(30_000);
    }
  });
});
