import type { Certificate } from "../../../types/certificate.ts";

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ");
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + "..." : s;
}

export function ResultsTable({ certificates, total, page, totalPages, query }: {
  certificates: Certificate[];
  total: number;
  page: number;
  totalPages: number;
  query: string;
}) {
  if (certificates.length === 0) {
    return (
      <div class="text-center py-12 text-gray-400">
        {query.length >= 2
          ? <p>No certificates found matching "<span class="text-green-400">{query}</span>"</p>
          : <p>Enter at least 2 characters to search</p>}
      </div>
    );
  }

  return (
    <div>
      <div class="text-sm text-gray-400 mb-4">
        Found <span class="text-green-400 font-bold">{total.toLocaleString()}</span> certificate(s)
        {totalPages > 1 && <span> &mdash; page {page} of {totalPages}</span>}
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-gray-400 border-b border-gray-700">
              <th class="pb-2 pr-4">Domains</th>
              <th class="pb-2 pr-4">Issuer</th>
              <th class="pb-2 pr-4">Not Before</th>
              <th class="pb-2 pr-4">Not After</th>
              <th class="pb-2">Seen</th>
            </tr>
          </thead>
          <tbody>
            {certificates.map((cert) => (
              <tr class="border-b border-gray-800 hover:bg-gray-800/50">
                <td class="py-2 pr-4">
                  <a href={`/cert/${cert.id}`} class="text-green-400 hover:text-green-300">
                    {truncate(cert.domains[0] ?? "", 50)}
                  </a>
                  {cert.domainCount > 1 && (
                    <span class="ml-1 text-xs text-gray-500">+{cert.domainCount - 1}</span>
                  )}
                </td>
                <td class="py-2 pr-4 text-gray-300">{truncate(cert.issuerOrg ?? cert.issuerCn ?? "-", 30)}</td>
                <td class="py-2 pr-4 text-gray-400">{formatDate(cert.notBefore)}</td>
                <td class="py-2 pr-4 text-gray-400">{formatDate(cert.notAfter)}</td>
                <td class="py-2 text-gray-400">{formatDate(cert.seenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div class="flex justify-center gap-2 mt-6">
          {page > 1 && (
            <button
              hx-get={`/search/results?q=${encodeURIComponent(query)}&page=${page - 1}`}
              hx-target="#search-results"
              class="px-3 py-1 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 text-sm"
            >
              Previous
            </button>
          )}
          <span class="px-3 py-1 text-gray-400 text-sm">
            Page {page} / {totalPages}
          </span>
          {page < totalPages && (
            <button
              hx-get={`/search/results?q=${encodeURIComponent(query)}&page=${page + 1}`}
              hx-target="#search-results"
              class="px-3 py-1 bg-gray-800 border border-gray-700 rounded hover:bg-gray-700 text-sm"
            >
              Next
            </button>
          )}
        </div>
      )}
    </div>
  );
}
