import type { Certificate } from "../../../types/certificate.ts";

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === "") return null;
  return (
    <div class="flex py-2 border-b border-gray-800">
      <div class="w-40 text-gray-400 flex-shrink-0">{label}</div>
      <div class="text-gray-200 break-all">{value}</div>
    </div>
  );
}

export function CertDetail({ cert }: { cert: Certificate }) {
  return (
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h2 class="text-lg font-bold text-green-400 mb-4">{cert.subjectCn || cert.domains[0] || "Unknown"}</h2>

      <div class="space-y-0">
        <DetailRow label="Fingerprint" value={cert.fingerprint} />
        <DetailRow label="Subject CN" value={cert.subjectCn} />
        <DetailRow label="Issuer Org" value={cert.issuerOrg} />
        <DetailRow label="Issuer CN" value={cert.issuerCn} />
        <DetailRow label="Serial" value={cert.serialNumber} />
        <DetailRow label="Not Before" value={formatDate(cert.notBefore)} />
        <DetailRow label="Not After" value={formatDate(cert.notAfter)} />
        <DetailRow label="Seen At" value={formatDate(cert.seenAt)} />
        <DetailRow label="CT Log" value={cert.logName} />
        <DetailRow label="Log URL" value={cert.logUrl} />
        {cert.certIndex != null && <DetailRow label="Log Index" value={cert.certIndex} />}
        {cert.certLink && (
          <div class="flex py-2 border-b border-gray-800">
            <div class="w-40 text-gray-400 flex-shrink-0">Cert Link</div>
            {cert.certLink.startsWith("https://") ? (
              <a href={cert.certLink} target="_blank" rel="noopener noreferrer" class="text-green-400 hover:text-green-300 break-all">
                {cert.certLink}
              </a>
            ) : (
              <span class="text-gray-200 break-all">{cert.certLink}</span>
            )}
          </div>
        )}
      </div>

      <div class="mt-6">
        <h3 class="text-sm font-semibold text-gray-400 mb-2">
          Domains ({cert.domainCount})
        </h3>
        <div class="flex flex-wrap gap-2">
          {cert.domains.map((domain) => (
            <span class="inline-block bg-gray-700 rounded px-2 py-1 text-xs text-green-300">
              {domain}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
