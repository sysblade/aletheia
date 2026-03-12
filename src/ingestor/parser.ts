import type { CertStreamMessage } from "../types/certstream.ts";
import type { NewCertificate } from "../types/certificate.ts";

export function parseCertStreamMessage(raw: string): NewCertificate | null {
  let msg: CertStreamMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }

  if (msg.message_type !== "certificate_update") return null;

  const { data } = msg;
  if (!data?.leaf_cert) return null;

  const leaf = data.leaf_cert;
  const domains = leaf.all_domains?.filter(Boolean) ?? [];

  if (domains.length === 0) return null;

  const fingerprint = leaf.fingerprint;
  if (!fingerprint) return null;

  return {
    fingerprint: fingerprint.replace(/:/g, "").toLowerCase(),
    domains,
    issuerOrg: leaf.issuer?.O || null,
    issuerCn: leaf.issuer?.CN || null,
    subjectCn: leaf.subject?.CN || null,
    notBefore: leaf.not_before,
    notAfter: leaf.not_after,
    serialNumber: leaf.serial_number || "",
    logName: data.source?.name || null,
    logUrl: data.source?.url || null,
    certIndex: data.cert_index ?? null,
    certLink: data.cert_link || null,
    seenAt: Math.floor(data.seen ?? Date.now() / 1000),
  };
}
