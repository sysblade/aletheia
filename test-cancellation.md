# Testing Server-Side Search Cancellation

## How to Verify DB Cancellation is Actually Working

### For ClickHouse

**What the `abort_signal` parameter does:**
- Passed to the underlying `fetch()` call in `@clickhouse/client-web`
- When aborted: `fetch()` throws an `AbortError` and closes the HTTP connection
- ClickHouse server behavior when HTTP connection closes:
  - **During query execution**: Query is typically cancelled server-side
  - **Query already completed**: Results are simply not sent
  - **Query not yet started**: Never executes

**Test it:**
1. Start the server with a large dataset (or a slow query)
2. Run a search that takes >2 seconds (e.g., search for a common term)
3. Click Cancel after 1 second
4. Check server logs for: `"Search aborted during streaming"` or `"Search cancelled"`
5. **Key indicator**: Check ClickHouse server logs to see if query was killed

**ClickHouse-specific verification:**
```sql
-- On ClickHouse server, run this to see active queries:
SELECT query_id, query, elapsed FROM system.processes;

-- After cancelling, verify the query disappeared from the list
```

### For MongoDB

**What the `signal` option does:**
- MongoDB Node.js driver v6.12.0+ has native AbortSignal support
- When aborted: Driver sends a `killOp` command to MongoDB server
- Server cancels the operation immediately

**Test it:**
1. Start search on large collection
2. Click Cancel
3. Check MongoDB logs for operation killed

**MongoDB-specific verification:**
```javascript
// On MongoDB server:
db.currentOp() // See running operations
// After cancel, operation should disappear
```

### For SQLite

**Limitation:**
- SQLite queries in Bun are **blocking and synchronous**
- Cannot be interrupted mid-execution
- Abort checks only happen **between** COUNT and SELECT queries

**What actually happens:**
1. If cancelled before COUNT completes: COUNT finishes, then throws `SearchCancelledError`
2. If cancelled after COUNT but before SELECT: SELECT never runs
3. If cancelled during SELECT: SELECT finishes, then throws `SearchCancelledError`

**Best case:** Saved one query (either COUNT or SELECT)
**Worst case:** Both queries complete, results discarded

## Visual Test

The easiest way to verify server-side cancellation:

1. Add a slow query delay to ClickHouse repository:
```typescript
// In search() method, before the query
await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
```

2. Start a search, cancel after 1 second
3. Check logs:
   - If you see `"Search aborted before starting"` → Cancellation worked BEFORE query
   - If you see `"Search cancelled"` → Cancellation worked AFTER query started

## Current Implementation Status

✅ **Mechanism in place:**
- AbortController created per request
- Signal passed to all repository methods
- ClickHouse: `abort_signal` parameter passed to `client.query()`
- MongoDB: `{ signal }` option passed to operations
- SQLite: Abort checks between operations

⚠️ **Actual effectiveness:**
- **ClickHouse**: Should cancel server-side if connection closes during execution
- **MongoDB**: Guaranteed cancellation via killOp
- **SQLite**: Best-effort only (cannot interrupt blocking queries)

❓ **Unknown without testing:**
- ClickHouse query cancellation timing (how fast does server respond to closed connection?)
- Whether ClickHouse actually kills the query or just stops sending results
- Edge cases (query completing just as cancel is clicked)
