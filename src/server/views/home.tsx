import { Layout } from "./layout.tsx";
import { SearchForm } from "./components/search-form.tsx";
import { SearchGuide } from "./search.tsx";
import { StatsCard } from "./components/stats-card.tsx";
import { LiveStreamSection } from "./components/live-stream.tsx";
import { ResultsTable } from "./components/results-table.tsx";
import type { SearchResult, Stats } from "../../types/certificate.ts";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function HomePage({
  stats,
  insertRate,
  uptimeSeconds,
  filterMode,
  query,
  initialResult,
  initialElapsedMs,
}: {
  stats: Stats;
  insertRate: number;
  uptimeSeconds: number;
  filterMode: string;
  query?: string;
  initialResult?: SearchResult | null;
  initialElapsedMs?: number;
}) {
  return (
    <Layout>
      <div class="mb-8 text-center">
        <h1 class="text-3xl font-bold text-green-400 mb-2">Certificate Transparency Log</h1>
        <p class="text-gray-400">Real-time monitoring of publicly-issued TLS certificates</p>
      </div>

      <div class="mb-8">
        <SearchForm query={query} />
        <SearchGuide />
      </div>

      <div id="search-results">
        {initialResult && (
          <ResultsTable
            certificates={initialResult.certificates}
            total={initialResult.total}
            page={initialResult.page}
            totalPages={initialResult.totalPages}
            query={query ?? ""}
            elapsedMs={initialElapsedMs ?? 0}
          />
        )}
      </div>

      <div
        class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8"
        hx-get="/partials/stats"
        hx-trigger="every 5s"
        hx-swap="innerHTML"
      >
        <StatsCards stats={stats} insertRate={insertRate} uptimeSeconds={uptimeSeconds} filterMode={filterMode} />
      </div>

      <LiveStreamSection />
    </Layout>
  );
}

export function StatsCards({
  stats,
  insertRate,
  uptimeSeconds,
  filterMode,
}: {
  stats: Stats;
  insertRate: number;
  uptimeSeconds: number;
  filterMode: string;
}) {
  return (
    <>
      <StatsCard label="Total Certificates" value={stats.totalCertificates} />
      <StatsCard label="Unique Issuers" value={stats.uniqueIssuers} />
      <StatsCard label="Insert Rate" value={`${insertRate}/s`} sub={filterMode} />
      <StatsCard label="Uptime" value={formatUptime(uptimeSeconds)} />
    </>
  );
}
