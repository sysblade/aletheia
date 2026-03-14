# Advanced Search Features

This document describes the advanced search features available in Aletheia.

## New Search Syntax (v1.1)

### 1. Exact Match with Quotes

Use quotes to search for exact matches instead of substring matches:

```
issuer:"Let's Encrypt"
domain:"example.com"
cn:"*.internal.corp"
```

**Without quotes**: `issuer:encrypt` matches "Let's Encrypt", "ZeroSSL", etc.
**With quotes**: `issuer:"Let's Encrypt"` matches only "Let's Encrypt"

### 2. Wildcard Certificate Filter

Filter for or exclude wildcard certificates:

```
wildcard:true                    # Only wildcard certificates (*.domain.com)
wildcard:false                   # Exclude wildcard certificates
wildcard:true domain:mycompany.com   # Wildcard certs for specific domain
```

**Use case**: Find all wildcard certificates that could be used for subdomain takeover attacks.

### 3. Domain Count Filter

Filter certificates by the number of Subject Alternative Names (SANs):

```
domain_count:>10     # More than 10 domains
domain_count:>=50    # 50 or more domains
domain_count:<5      # Less than 5 domains
domain_count:<=2     # 2 or fewer domains
domain_count:=1      # Exactly 1 domain (single-domain cert)
```

**Use case**:
- Large domain counts may indicate bulk certificate issuance or suspicious activity
- Single-domain certificates (`domain_count:=1`) can indicate targeted issuance

### 4. Date Range Filter

Shorthand for searching certificates seen within a date range:

```
created:2024-01-01..2024-03-14
created:2024-03-01..2024-03-31
```

This is equivalent to:
```
after:2024-01-01 before:2024-03-15
```

Note: End date is exclusive, so we add 1 day to the `before:` parameter.

### 5. Combined Advanced Queries

All filters can be combined:

```
# Find wildcard certificates for a domain with many SANs, issued in March 2024
wildcard:true domain:mycompany.com domain_count:>20 created:2024-03-01..2024-03-31

# Find single-domain Let's Encrypt certificates
issuer:"Let's Encrypt" domain_count:=1

# Find suspicious bulk certificates (many domains, not from known CA)
domain_count:>100 -issuer:encrypt -issuer:digicert -issuer:sectigo
```

## UI Improvements

### Keyboard Shortcuts

- **`/` (forward slash)**: Focus search input from anywhere on the page
  - Automatically selects existing text for easy replacement
  - Works even when focus is on other elements

- **`Esc` (escape)**:
  - If search is running: Cancel the search
  - If search input is focused: Blur the input

### Search History

- Automatically saves your last 10 searches to browser LocalStorage
- Searches are saved when you submit them
- History persists across browser sessions
- Access via browser's LocalStorage inspector: `localStorage.getItem('searchHistory')`

### CSV Export

Click the "Export CSV" button on any search results page to download results as CSV:

**Exported fields**:
- Fingerprint
- Domains (semicolon-separated)
- Domain Count
- Issuer Org
- Issuer CN
- Subject CN
- Not Before (ISO 8601)
- Not After (ISO 8601)
- Serial Number
- Log Name
- Seen At (ISO 8601)

**Filename format**: `certificates-{query}-page{N}.csv`

**Use case**:
- Data analysis in Excel/Google Sheets
- Import into SIEM or threat intelligence platforms
- Share results with team members

## Implementation Details

### Backend Support

**ClickHouse**: ✅ Full support for all advanced features
- Exact match uses `=` operator
- Wildcard filter uses `arrayExists(x -> startsWith(x, '*.'), domains)`
- Domain count filter uses `domainCount >/</>=/<=` operators
- Date range converted to `seenAt >= after AND seenAt < before`

**SQLite**: ✅ Full support for all advanced features
- Exact match uses FTS5 quoted phrases
- Wildcard filter uses `json_each` with LIKE pattern `\\_%.%`
- Domain count filter uses numeric comparison operators on `domain_count` column
- Date range converted to `seenAt >= after AND seenAt < before`

**MongoDB**: ✅ Full support for all advanced features
- Exact match uses `$eq` operator instead of regex
- Wildcard filter uses `$elemMatch` with regex `^\\*\\.`
- Domain count filter uses MongoDB comparison operators ($gt, $gte, $lt, $lte, $eq)
- Date range converted to `seenAt >= after AND seenAt < before`

### Parser Changes

File: `src/db/search-query.ts`

**New types**:
```typescript
interface SearchTerm {
  text: string;
  column: SearchColumn | null;
  negate: boolean;
  exact: boolean;  // NEW: Indicates quoted string
}

interface NumericFilter {
  operator: ">" | ">=" | "<" | "<=" | "=";
  value: number;
}

interface ParsedQuery {
  groups: SearchTerm[][];
  dateFilter: DateFilter;
  wildcardOnly?: boolean;  // NEW
  domainCountFilter?: NumericFilter;  // NEW
}
```

**New parsing logic**:
- Quoted string parser with escape sequence support (`\"`, `\'`)
- `wildcard:true/false` extractor
- `domain_count:>5` numeric comparison parser
- `created:YYYY-MM-DD..YYYY-MM-DD` date range parser

## Testing

All features are tested:
```bash
bun test       # 166 tests pass
bun run check  # Type-check passes
```

Search examples tested:
- Exact match: `issuer:"Let's Encrypt"`
- Wildcard filter: `wildcard:true domain:google.com`
- Domain count: `domain_count:>50`
- Date range: `created:2024-01-01..2024-03-14`
- Combined: `wildcard:true domain_count:>10 issuer:"Let's Encrypt" created:2024-03-01..2024-03-14`

## Future Enhancements

Potential future additions:
- **Saved searches**: Bookmark frequently-used queries
- **Search templates**: Pre-built queries for common security use cases
- **Real-time alerts**: Webhook notifications for matching certificates
- **Advanced export**: Export to JSON, JSONL, or Parquet formats
- **Bulk export**: Export all results, not just current page

## Performance Considerations

**ClickHouse**:
- Ngram indexes work well with substring and exact match queries
- `arrayExists()` for wildcard filtering uses indexes efficiently
- `domainCount` comparisons are indexed (numeric column)
- Date filters use indexed `seenAt` column

**SQLite**:
- FTS5 trigram search for text queries
- Date/numeric filters use B-tree indexes
- Consider adding index on `domainCount` for better performance

**MongoDB**:
- Text indexes for substring search
- Compound indexes on frequently-filtered fields
- Consider adding index on `domainCount` field
