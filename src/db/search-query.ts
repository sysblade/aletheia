/** Searchable columns for column-scoped queries (e.g., domain:example.com). */
export type SearchColumn = "domain" | "issuer" | "cn";

/**
 * Individual search term with optional column scope and negation.
 */
export interface SearchTerm {
  text: string;
  column: SearchColumn | null;
  /** true = exclude documents matching this term (NOT operator) */
  negate: boolean;
}

/**
 * Outer array: groups joined by OR.
 * Inner array: terms within a group, combined by AND (negated terms excluded via NOT).
 */
export interface ParsedQuery {
  groups: SearchTerm[][];
}

const COLUMN_PREFIXES: [string, SearchColumn][] = [
  ["domain:", "domain"],
  ["issuer:", "issuer"],
  ["cn:", "cn"],
];

function parseGroup(segment: string): SearchTerm[] {
  let rest = segment.trim();
  let column: SearchColumn | null = null;

  for (const [prefix, col] of COLUMN_PREFIXES) {
    if (rest.toLowerCase().startsWith(prefix)) {
      column = col;
      rest = rest.slice(prefix.length).trim();
      break;
    }
  }

  return rest
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.startsWith("-") && word.length > 1) {
        return { text: word.slice(1), column, negate: true };
      }
      return { text: word, column, negate: false };
    });
}

/**
 * Parse search query string into structured query AST.
 * Supports OR groups, column prefixes (domain:, issuer:, cn:), and negation (-term).
 * Example: "domain:example.com -test OR issuer:letsencrypt"
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const groups = raw
    .trim()
    .split(/\s+OR\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseGroup)
    .filter((g) => g.length > 0);

  return { groups };
}
