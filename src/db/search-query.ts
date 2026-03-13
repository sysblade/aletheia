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
 * Date range filter extracted from after:/before: tokens.
 * Both bounds are Unix timestamps (seconds).
 * after is inclusive (seen_at >= after), before is exclusive (seen_at < before).
 */
export interface DateFilter {
  after?: number;
  before?: number;
}

/**
 * Outer array: groups joined by OR.
 * Inner array: terms within a group, combined by AND (negated terms excluded via NOT).
 * dateFilter applies globally across all OR groups.
 */
export interface ParsedQuery {
  groups: SearchTerm[][];
  dateFilter: DateFilter;
}

/**
 * Parse a timestamp value from after:/before: tokens.
 * Accepts:
 *   - YYYY-MM-DD          → UTC midnight of that date
 *   - ISO datetime string → parsed via Date.parse, converted to Unix seconds
 *   - Plain integer       → treated as Unix seconds directly
 * Returns null if the value cannot be parsed.
 */
function parseTimestamp(value: string): number | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const ms = Date.parse(value + "T00:00:00Z");
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
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
 * Also supports global date filters: after:TIMESTAMP and before:TIMESTAMP.
 * Timestamps may be a date (YYYY-MM-DD, treated as UTC midnight), a full ISO datetime,
 * or a plain Unix integer.
 * Example: "domain:example.com -test OR issuer:letsencrypt after:2024-01-15"
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const dateFilter: DateFilter = {};

  // Strip after:/before: tokens globally before group parsing.
  // \b ensures we don't match mid-word (e.g. notafter:...).
  const cleaned = raw
    .trim()
    .replace(/\b(after|before):(\S+)/gi, (_match, key: string, val: string) => {
      const ts = parseTimestamp(val);
      if (ts !== null) {
        if (key.toLowerCase() === "after") dateFilter.after = ts;
        else dateFilter.before = ts;
        return "";
      }
      return _match;
    })
    .trim();

  const groups = cleaned
    .split(/\s+OR\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseGroup)
    .filter((g) => g.length > 0);

  return { groups, dateFilter };
}
