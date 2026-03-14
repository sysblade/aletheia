# Testing Search Cancellation with Real ClickHouse Database

## What Logs to Look For

When you run a search and then cancel it, you should see these logs:

**Note:** Cancellation-specific logs are at **DEBUG** level. Set `LOG_LEVEL=debug` to see them.

Normal query timing logs (start/complete) are at **INFO** level and visible by default.

### 1. Normal Search Flow (Not Cancelled)

```
INFO Starting ClickHouse streaming COUNT query for search "yourquery"
INFO ClickHouse streaming COUNT completed in 1234ms (15 progress events, total=50000) for search "yourquery"
INFO Starting ClickHouse SELECT query (total=50000) for search "yourquery"
INFO ClickHouse SELECT completed in 567ms for search "yourquery"
```

### 2. Search Cancelled During COUNT Query

**What you should see (with LOG_LEVEL=debug):**
```
INFO Starting ClickHouse streaming COUNT query for search "yourquery"
DEBUG Client disconnected, aborting search for query "yourquery"
DEBUG Search aborted for query "yourquery"
DEBUG Search aborted during streaming (after 500ms, 3 progress events) for query "yourquery"
DEBUG SearchWithProgress cancelled for query "yourquery"
```

**What this means:**
- ✅ Client cancelled and server detected it
- ✅ Signal was aborted
- ✅ The streaming read loop detected abort and cancelled the reader
- ⚠️ **Key question**: Did ClickHouse actually stop the query server-side?

**To verify ClickHouse stopped the query:**
- Check if elapsed time is much less than what the query would normally take
- If query normally takes 5 seconds but shows "aborted after 500ms", it likely worked
- If it shows "aborted after 5000ms" (full duration), the query completed anyway

### 3. Search Cancelled After COUNT, Before SELECT

```
INFO Starting ClickHouse streaming COUNT query for search "yourquery"
INFO ClickHouse streaming COUNT completed in 1234ms (15 progress events, total=50000) for search "yourquery"
DEBUG Client disconnected, aborting search for query "yourquery"
DEBUG Search aborted for query "yourquery"
DEBUG Search aborted after streaming COUNT (took 1234ms) for query "yourquery"
DEBUG SearchWithProgress cancelled for query "yourquery"
```

**What this means:**
- COUNT query completed
- Client cancelled before SELECT started
- ✅ SELECT query was never executed (saved time!)

### 4. ClickHouse Throws Abort Error

If ClickHouse actually detects the aborted connection and throws an error:
```
INFO Starting ClickHouse streaming COUNT query for search "yourquery"
DEBUG ClickHouse streaming query aborted (error: Connection closed) for query "yourquery"
DEBUG SearchWithProgress cancelled for query "yourquery"
```

**This is the BEST case** - it means ClickHouse detected the abort and threw an error.

## How to Test

### Enable Debug Logging

Set the log level to debug to see cancellation logs:
```bash
LOG_LEVEL=debug bun run dev
```

### Test 1: Cancel During Long Query

1. **Search for a common term** that will return many results (e.g., `*.com` or a common issuer)
2. **Wait for progress bar** to start showing
3. **Click "Cancel Search"** button after 1-2 seconds
4. **Check server logs** - look for the log patterns above

**Expected timing:**
- If query normally takes 10 seconds
- You cancel after 2 seconds
- Logs should show elapsed time around 2 seconds (not 10)
- If it shows 10 seconds, the query wasn't actually cancelled

### Test 2: Rapid Cancel (Stress Test)

1. Search for something
2. **Immediately** click Cancel (within 100ms)
3. Check logs - should see "aborted" logs very quickly

### Test 3: Compare with/without Cancel

**Without cancel:**
```bash
# Search and let it complete
# Note the timing in logs
INFO ClickHouse streaming COUNT completed in 5432ms ...
INFO ClickHouse SELECT completed in 2100ms ...
```

**With cancel (after 1 second):**
```bash
# Search and cancel after 1 second
# Check if elapsed times are much shorter
DEBUG Search aborted during streaming (after 1000ms, 5 progress events) ...
```

If the "after 1000ms" is close to when you clicked cancel, it's working!

## What Makes You Sure It's Working?

### Strong Evidence of Server-Side Cancellation:
1. ✅ **Short elapsed times** - Query aborted in 500ms when it normally takes 5000ms
2. ✅ **ClickHouse error** - Logs show "Connection closed" or similar error from ClickHouse
3. ✅ **Low progress event count** - Shows "3 progress events" when complete queries show "50 progress events"
4. ✅ **SELECT never starts** - Logs show abort after COUNT, before SELECT starts

### Weak Evidence (May Not Be Working):
1. ⚠️ **Full elapsed times** - Shows "aborted after 5000ms" when query normally takes 5000ms
2. ⚠️ **Many progress events** - Shows "50 progress events" (same as complete query)
3. ⚠️ **Only client-side logs** - Only see "Client disconnected" but no ClickHouse errors

## Additional Verification

### Check ClickHouse Server Logs

On your ClickHouse server, check the query log:
```sql
-- See recent queries and their execution time
SELECT
    query_id,
    query_duration_ms,
    query,
    exception
FROM system.query_log
WHERE event_time > now() - INTERVAL 5 MINUTE
ORDER BY event_time DESC
LIMIT 20;
```

Look for:
- Queries with short durations that were cancelled
- Exception column showing cancellation errors

### Monitor Active Queries

While a search is running, check active queries:
```sql
SELECT query_id, query, elapsed FROM system.processes;
```

Then cancel the search and run the query again - the query should disappear.

## Current Limitations

**SQLite:**
- ⚠️ Queries cannot be interrupted mid-execution (Bun limitation)
- Only abort checks between COUNT and SELECT
- Best case: Saves one of the two queries

**MongoDB:**
- ✅ Should work with native driver cancellation
- Driver sends `killOp` command

**ClickHouse:**
- ✅ Should work IF the HTTP connection close is detected during query execution
- ❓ May depend on query complexity and ClickHouse server settings
- ❓ Quick queries might complete before abort is detected

## What You're Looking For

**The smoking gun that proves it's working:**
```
INFO Starting ClickHouse streaming COUNT query for search "*.google.com"
DEBUG Client disconnected, aborting search for query "*.google.com"
DEBUG Search aborted during streaming (after 847ms, 2 progress events) for query "*.google.com"
DEBUG SearchWithProgress cancelled for query "*.google.com"
```

Notice:
- Started the query
- Client disconnected (you clicked Cancel)
- Aborted after 847ms (not the full query time)
- Only 2 progress events (not dozens)

This would prove the query was actually stopped server-side!
