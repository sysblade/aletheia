import type { Certificate } from "../../../types/certificate.ts";

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ");
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + "..." : s;
}

export function LiveStreamRows({ certificates }: { certificates: Certificate[] }) {
  if (certificates.length === 0) {
    return (
      <tr>
        <td colSpan={3} class="py-8 text-center text-gray-500">
          Waiting for certificates...
        </td>
      </tr>
    );
  }

  return (
    <>
      {certificates.map((cert) => (
        <tr class="border-b border-gray-800 hover:bg-gray-800/50">
          <td class="py-1.5 pr-4">
            <a href={`/cert/${cert.id}`} class="text-green-400 hover:text-green-300">
              {truncate(cert.domains[0] ?? cert.subjectCn ?? "-", 60)}
            </a>
            {cert.domainCount > 1 && (
              <span class="ml-1 text-xs text-gray-500">+{cert.domainCount - 1}</span>
            )}
          </td>
          <td class="py-1.5 pr-4 text-gray-300">{truncate(cert.issuerOrg ?? cert.issuerCn ?? "-", 30)}</td>
          <td class="py-1.5 text-gray-400">{formatDate(cert.seenAt)}</td>
        </tr>
      ))}
    </>
  );
}

export function LiveStreamTable({ certificates }: { certificates: Certificate[] }) {
  return (
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-gray-400 border-b border-gray-700">
            <th class="pb-2 pr-4">Domain</th>
            <th class="pb-2 pr-4">Issuer</th>
            <th class="pb-2">Seen</th>
          </tr>
        </thead>
        <tbody
          hx-ext="sse"
          sse-connect="/events/live-stream"
          sse-swap="certificates"
        >
          <LiveStreamRows certificates={certificates} />
        </tbody>
      </table>
    </div>
  );
}

export function LiveStreamSection() {
  return (
    <details class="mt-8 border border-gray-700 rounded-lg overflow-hidden">
      <summary class="cursor-pointer select-none px-4 py-3 bg-gray-800 hover:bg-gray-750 flex items-center gap-2">
        <span class="relative flex h-2.5 w-2.5">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
        </span>
        <span class="text-lg font-semibold text-gray-200">Live Stream</span>
        <span class="text-gray-600 text-xs font-normal ml-1">(click to expand)</span>
      </summary>
      <div
        id="live-stream-body"
        class="p-4"
        hx-get="/partials/live-stream-table"
        hx-trigger="toggle[event.target.open] from:closest details"
        hx-swap="innerHTML"
      />
    </details>
  );
}
