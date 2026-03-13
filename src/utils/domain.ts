import { parse as pslParse } from "psl";

/**
 * Extract 2-level domain (eTLD+1) from FQDN using public suffix list.
 * Handles wildcards and all known TLDs correctly.
 *
 * @param fqdn - Fully qualified domain name (may include wildcard prefix)
 * @returns 2-level domain or null if invalid/public suffix
 *
 * @example
 * extractTwoLevelDomain("www.api.google.com") // => "google.com"
 * extractTwoLevelDomain("*.cdn.cloudflare.com") // => "cloudflare.com"
 * extractTwoLevelDomain("example.co.uk") // => "example.co.uk"
 * extractTwoLevelDomain("site.github.io") // => "site.github.io"
 * extractTwoLevelDomain("github.io") // => null (public suffix)
 */
export function extractTwoLevelDomain(fqdn: string): string | null {
  if (!fqdn || typeof fqdn !== "string") {
    return null;
  }

  // Normalize to lowercase and trim whitespace
  let domain = fqdn.toLowerCase().trim();

  // Strip leading wildcard if present
  if (domain.startsWith("*.")) {
    domain = domain.slice(2);
  }

  // Empty after stripping wildcard
  if (!domain) {
    return null;
  }

  // Reject IP addresses (IPv4 pattern)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
    return null;
  }

  // Use psl library to extract registrable domain (eTLD+1)
  const parsed = pslParse(domain);

  // psl.parse returns error for invalid domains
  if ("error" in parsed) {
    return null;
  }

  // Return the registrable domain (2-level domain)
  // This will be null for public suffixes like "github.io" or "co.uk"
  return parsed.domain;
}

/**
 * Check if domain string contains wildcard character.
 *
 * @param domain - Domain string to check
 * @returns true if domain starts with wildcard prefix "*."
 *
 * @example
 * isWildcardDomain("*.example.com") // => true
 * isWildcardDomain("example.com") // => false
 * isWildcardDomain("*") // => false
 */
export function isWildcardDomain(domain: string): boolean {
  return domain.startsWith("*.");
}
