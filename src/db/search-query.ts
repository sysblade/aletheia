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
  /** true = exact match (text was quoted) */
  exact: boolean;
}

/**
 * Numeric comparison operator for domain_count filter.
 */
export type NumericOperator = ">" | ">=" | "<" | "<=" | "=";

/**
 * Numeric filter for domain_count (e.g., domain_count:>5).
 */
export interface NumericFilter {
  operator: NumericOperator;
  value: number;
}

/**
 * Date range filter extracted from after:/before:/created: tokens.
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
 * Filters apply globally across all OR groups.
 */
export interface ParsedQuery {
  groups: SearchTerm[][];
  dateFilter: DateFilter;
  wildcardOnly?: boolean;  // wildcard:true
  domainCountFilter?: NumericFilter;  // domain_count:>5
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

  // Parse quoted strings and regular words
  const terms: SearchTerm[] = [];
  let pos = 0;

  while (pos < rest.length) {
    // Skip whitespace
    while (pos < rest.length && /\s/.test(rest[pos]!)) pos++;
    if (pos >= rest.length) break;

    let negate = false;
    if (rest[pos] === "-") {
      negate = true;
      pos++;
      // Skip whitespace after negation
      while (pos < rest.length && /\s/.test(rest[pos]!)) pos++;
      if (pos >= rest.length) break;
    }

    // Check for quoted string
    const currentChar = rest[pos]!;
    if (currentChar === '"' || currentChar === "'") {
      const quote = currentChar;
      pos++;
      let text = "";
      while (pos < rest.length && rest[pos] !== quote) {
        const ch = rest[pos]!;
        if (ch === "\\") {
          pos++;
          if (pos < rest.length) text += rest[pos]!;
        } else {
          text += ch;
        }
        pos++;
      }
      if (pos < rest.length) pos++; // skip closing quote
      if (text) {
        terms.push({ text, column, negate, exact: true });
      }
    } else {
      // Regular word
      let text = "";
      while (pos < rest.length && !/\s/.test(rest[pos]!)) {
        text += rest[pos]!;
        pos++;
      }
      if (text) {
        terms.push({ text, column, negate, exact: false });
      }
    }
  }

  return terms;
}

/**
 * Parse search query string into structured query AST.
 * Supports OR groups, column prefixes (domain:, issuer:, cn:), and negation (-term).
 * Also supports global filters:
 *   - after:TIMESTAMP, before:TIMESTAMP
 *   - created:YYYY-MM-DD..YYYY-MM-DD
 *   - wildcard:true/false
 *   - domain_count:>5 (supports >, >=, <, <=, =)
 * Timestamps may be a date (YYYY-MM-DD, treated as UTC midnight), a full ISO datetime,
 * or a plain Unix integer.
 * Example: "domain:example.com -test OR issuer:letsencrypt after:2024-01-15 wildcard:true domain_count:>5"
 */
export function parseSearchQuery(raw: string): ParsedQuery {
  const dateFilter: DateFilter = {};
  let wildcardOnly: boolean | undefined;
  let domainCountFilter: NumericFilter | undefined;

  // Strip special filters globally before group parsing
  let cleaned = raw.trim();

  // Handle wildcard:true/false
  cleaned = cleaned.replace(/\bwildcard:(true|false)\b/gi, (_match, val: string) => {
    wildcardOnly = val.toLowerCase() === "true";
    return "";
  });

  // Handle domain_count:>5 (supports >, >=, <, <=, =)
  cleaned = cleaned.replace(/\bdomain_count:(>=?|<=?|=)(\d+)\b/gi, (_match, op: string, val: string) => {
    domainCountFilter = {
      operator: op as NumericOperator,
      value: parseInt(val, 10),
    };
    return "";
  });

  // Handle created:YYYY-MM-DD..YYYY-MM-DD date range
  cleaned = cleaned.replace(/\bcreated:(\S+)\.\.(\S+)\b/gi, (_match, start: string, end: string) => {
    const startTs = parseTimestamp(start);
    const endTs = parseTimestamp(end);
    if (startTs !== null) dateFilter.after = startTs;
    if (endTs !== null) {
      // End date is exclusive (< not <=), so add 1 day if it's YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        dateFilter.before = endTs + 86400; // +1 day
      } else {
        dateFilter.before = endTs;
      }
    }
    return "";
  });

  // Strip after:/before: tokens globally
  cleaned = cleaned.replace(/\b(after|before):(\S+)/gi, (_match, key: string, val: string) => {
    const ts = parseTimestamp(val);
    if (ts !== null) {
      if (key.toLowerCase() === "after") dateFilter.after = ts;
      else dateFilter.before = ts;
      return "";
    }
    return _match;
  });

  cleaned = cleaned.trim();

  const groups = cleaned
    .split(/\s+OR\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseGroup)
    .filter((g) => g.length > 0);

  return { groups, dateFilter, wildcardOnly, domainCountFilter };
}
