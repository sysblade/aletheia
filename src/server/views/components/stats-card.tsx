export function StatsCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div class="text-sm text-gray-400 mb-1">{label}</div>
      <div class="text-2xl font-bold text-green-400">{typeof value === "number" ? value.toLocaleString() : value}</div>
      {sub && <div class="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
