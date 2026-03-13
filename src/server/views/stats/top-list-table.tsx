import type { TopEntry } from "../../../types/certificate.ts";

export function TopListTable({ title, entries }: { title: string; entries: TopEntry[] }) {
  if (entries.length === 0) {
    return (
      <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 class="text-lg font-semibold text-green-400 mb-4">{title}</h3>
        <div class="text-center text-gray-400 py-4">No data available</div>
      </div>
    );
  }

  return (
    <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h3 class="text-lg font-semibold text-green-400 mb-4">{title}</h3>
      <div class="max-h-96 overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-gray-800 border-b border-gray-700">
            <tr class="text-left text-gray-400">
              <th class="pb-2 pr-4">#</th>
              <th class="pb-2">Name</th>
              <th class="pb-2 text-right">Count</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-700">
            {entries.map((entry, i) => (
              <tr class="hover:bg-gray-750">
                <td class="py-2 pr-4 text-gray-500">{i + 1}</td>
                <td class="py-2 font-mono text-gray-300">{entry.value}</td>
                <td class="py-2 text-right text-green-400">{entry.count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
