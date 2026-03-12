import type { NewCertificate } from "../types/certificate.ts";

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export class CertFilter {
  private domainPatterns: RegExp[];
  private issuerSubstrings: string[];
  readonly isFirehose: boolean;

  constructor(domainGlobs: string[], issuerSubstrings: string[]) {
    this.domainPatterns = domainGlobs.map(globToRegex);
    this.issuerSubstrings = issuerSubstrings.map((s) => s.toLowerCase());
    this.isFirehose = this.domainPatterns.length === 0 && this.issuerSubstrings.length === 0;
  }

  get mode(): "firehose" | "filtered" {
    return this.isFirehose ? "firehose" : "filtered";
  }

  matches(cert: NewCertificate): boolean {
    if (this.isFirehose) return true;

    if (this.domainPatterns.length > 0) {
      for (const domain of cert.domains) {
        for (const pattern of this.domainPatterns) {
          if (pattern.test(domain)) return true;
        }
      }
    }

    if (this.issuerSubstrings.length > 0 && cert.issuerOrg) {
      const issuerLower = cert.issuerOrg.toLowerCase();
      for (const sub of this.issuerSubstrings) {
        if (issuerLower.includes(sub)) return true;
      }
    }

    return false;
  }

  describe(): string {
    if (this.isFirehose) return "firehose (no filters)";
    const parts: string[] = [];
    if (this.domainPatterns.length > 0) {
      parts.push(`${this.domainPatterns.length} domain pattern(s)`);
    }
    if (this.issuerSubstrings.length > 0) {
      parts.push(`${this.issuerSubstrings.length} issuer filter(s)`);
    }
    return parts.join(", ");
  }
}
