import { Layout } from "../layout.tsx";
import { StatsCard } from "../components/stats-card.tsx";
import { VolumeChart } from "./volume-chart.tsx";
import { TopListTable } from "./top-list-table.tsx";
import type { HourlyStats, DailyStats, TopEntry } from "../../../types/certificate.ts";

type TimeRange = "24h" | "7d" | "30d";

interface StatsData {
  hourlyStats: HourlyStats[];
  dailyStats: DailyStats[];
  totalCertificates: number;
  uniqueDomains: number;
  uniqueIssuers: number;
  wildcardCount: number;
  topDomains: TopEntry[];
  topIssuers: TopEntry[];
}

export function StatsPage({ range, data }: { range: TimeRange; data: StatsData }) {
  const useHourly = range === "24h";
  const stats = useHourly ? data.hourlyStats : data.dailyStats;
  const granularity = useHourly ? "hourly" : "daily";

  return (
    <Layout title="Statistics">
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-green-400 mb-2">Certificate Statistics</h1>
        <p class="text-gray-400">Aggregated metrics and trend analysis</p>
      </div>

      <div class="mb-6 flex gap-2">
        <TabButton range="24h" currentRange={range} label="Last 24 Hours" />
        <TabButton range="7d" currentRange={range} label="Last 7 Days" />
        <TabButton range="30d" currentRange={range} label="Last 30 Days" />
      </div>

      <div
        id="stats-content"
        hx-get={`/partials/stats-content?range=${range}`}
        hx-trigger="every 60s"
        hx-swap="innerHTML"
      >
        <StatsContent range={range} data={data} />
      </div>
    </Layout>
  );
}

function TabButton({ range, currentRange, label }: { range: TimeRange; currentRange: TimeRange; label: string }) {
  const isActive = range === currentRange;
  const baseClasses = "px-4 py-2 rounded-lg font-medium transition-colors";
  const classes = isActive
    ? `${baseClasses} bg-green-600 text-white`
    : `${baseClasses} bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200`;

  return (
    <button
      class={classes}
      hx-get={`/stats?range=${range}`}
      hx-target="body"
      hx-swap="innerHTML"
      hx-push-url="true"
    >
      {label}
    </button>
  );
}

export function StatsContent({ range, data }: { range: TimeRange; data: StatsData }) {
  const useHourly = range === "24h";
  const stats = useHourly ? data.hourlyStats : data.dailyStats;
  const granularity = useHourly ? "hourly" : "daily";

  const avgSanCount = stats.length > 0
    ? (stats.reduce((sum, s) => sum + s.avgSanCount, 0) / stats.length).toFixed(1)
    : "0.0";

  return (
    <>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatsCard label="Total Certificates" value={data.totalCertificates} />
        <StatsCard label="Unique Domains" value={data.uniqueDomains} sub="2-level domains" />
        <StatsCard label="Wildcard Certificates" value={data.wildcardCount} />
        <StatsCard label="Avg. SAN Count" value={avgSanCount} sub="domains per cert" />
      </div>

      <div class="mb-8">
        <VolumeChart stats={stats} granularity={granularity} />
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <TopListTable title="Top 100 Domains" entries={data.topDomains} />
        <TopListTable title="Top 100 Issuers" entries={data.topIssuers} />
      </div>
    </>
  );
}
