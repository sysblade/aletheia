import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../app.ts";
import { HomePage, StatsCards } from "../views/home.tsx";
import { ResultsTable } from "../views/components/results-table.tsx";
import { CertDetail } from "../views/components/cert-detail.tsx";
import { LiveStreamRows, LiveStreamTable } from "../views/components/live-stream.tsx";
import { Layout } from "../views/layout.tsx";
import { StatsPage, StatsContent } from "../views/stats/stats-page.tsx";
import type { TopEntry } from "../../types/certificate.ts";
import { getLogger } from "../../utils/logger.ts";

const LIVE_STREAM_LIMIT = 25;

const log = getLogger(["ctlog", "server", "sse"]);

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

uiRoutes.get("/cert/:fingerprint", async (c) => {
  const repo = c.get("repository");
  const fingerprint = c.req.param("fingerprint");

  const cert = await repo.getByFingerprint(fingerprint);
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

uiRoutes.get("/stats", async (c) => {
  const repo = c.get("repository");
  const range = (c.req.query("range") || "24h") as "24h" | "7d" | "30d";

  const data = await fetchStatsData(repo, range);

  return c.html(<StatsPage range={range} data={data} />);
});

uiRoutes.get("/partials/stats-content", async (c) => {
  const repo = c.get("repository");
  const range = (c.req.query("range") || "24h") as "24h" | "7d" | "30d";

  const data = await fetchStatsData(repo, range);

  return c.html(<StatsContent range={range} data={data} />);
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
      } catch (err) {
        log.error("SSE stream update failed: {error}", { error: String(err) });
        aborted = true;
        unsubscribe();
      }
    });

    stream.onAbort(() => {
      aborted = true;
      unsubscribe();
    });

    let heartbeatCount = 0;
    while (!aborted) {
      await stream.sleep(30_000);

      heartbeatCount++;
      try {
        await stream.writeSSE({
          data: `keepalive ${heartbeatCount}`,
          event: "heartbeat",
        });
      } catch (err) {
        log.warn("SSE heartbeat failed, closing stream: {error}", {
          error: String(err),
        });
        aborted = true;
      }
    }
  });
});

async function fetchStatsData(repo: AppEnv["Variables"]["repository"], range: "24h" | "7d" | "30d") {
  const now = Math.floor(Date.now() / 1000);
  const rangeSeconds = range === "24h" ? 86400 : range === "7d" ? 604800 : 2592000;
  const fromTimestamp = now - rangeSeconds;

  const [hourlyStats, dailyStats] = await Promise.all([
    range === "24h" ? repo.getHourlyStats(fromTimestamp, now) : Promise.resolve([]),
    range !== "24h" ? repo.getDailyStats(fromTimestamp, now) : Promise.resolve([]),
  ]);

  const useHourly = range === "24h";
  const stats = useHourly ? hourlyStats : dailyStats;

  const totalCertificates = stats.reduce((sum, s) => sum + s.totalCertificates, 0);
  const wildcardCount = stats.reduce((sum, s) => sum + s.wildcardCount, 0);

  const domainCounts = new Map<string, number>();
  const issuerCounts = new Map<string, number>();

  for (const stat of stats) {
    for (const entry of stat.topDomains) {
      domainCounts.set(entry.value, (domainCounts.get(entry.value) ?? 0) + entry.count);
    }
    for (const entry of stat.topIssuers) {
      issuerCounts.set(entry.value, (issuerCounts.get(entry.value) ?? 0) + entry.count);
    }
  }

  const topDomains: TopEntry[] = Array.from(domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([value, count]) => ({ value, count }));

  const topIssuers: TopEntry[] = Array.from(issuerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([value, count]) => ({ value, count }));

  const uniqueDomains = domainCounts.size;
  const uniqueIssuers = issuerCounts.size;

  return {
    hourlyStats,
    dailyStats,
    totalCertificates,
    uniqueDomains,
    uniqueIssuers,
    wildcardCount,
    topDomains,
    topIssuers,
  };
}
