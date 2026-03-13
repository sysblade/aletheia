import type { HourlyStats, DailyStats } from "../../../types/certificate.ts";

export function VolumeChart({ stats, granularity }: { stats: (HourlyStats | DailyStats)[]; granularity: "hourly" | "daily" }) {
  if (stats.length === 0) {
    return (
      <div class="bg-gray-800 rounded-lg p-8 border border-gray-700 text-center text-gray-400">
        No data available for this time range
      </div>
    );
  }

  const maxCerts = Math.max(...stats.map((s) => s.totalCertificates));
  const scale = maxCerts > 0 ? 100 / maxCerts : 1;

  return (
    <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h3 class="text-lg font-semibold text-green-400 mb-4">Certificate Volume Over Time</h3>
      <div class="space-y-2">
        {stats.map((stat) => {
          const height = Math.max(4, (stat.totalCertificates * scale));
          const date = new Date(stat.periodStart * 1000);
          const label = granularity === "hourly"
            ? date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
            : date.toLocaleString("en-US", { month: "short", day: "numeric" });

          return (
            <div class="flex items-end gap-2">
              <div class="text-xs text-gray-500 w-32 text-right">{label}</div>
              <div class="flex-1 flex items-center">
                <div
                  class="bg-green-500 rounded"
                  style={`width: ${height}%; height: 24px;`}
                  title={`${stat.totalCertificates.toLocaleString()} certificates`}
                ></div>
                <span class="ml-2 text-sm text-gray-400">{stat.totalCertificates.toLocaleString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
