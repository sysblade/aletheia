# Migration to p-queue

## Installation Required

Run this command to install p-queue:

```bash
bun add p-queue
```

## Changes Made

### 1. **BatchBuffer now uses p-queue** (`src/ingestor/buffer.ts`)
- Replaced custom queue implementation with battle-tested `p-queue`
- Sequential write processing (concurrency: 1)
- Automatic backpressure handling
- Queue size monitoring with warnings at 80% capacity

### 2. **Updated stop() method**
- Now `async` to wait for pending writes to complete
- Calls `queue.onIdle()` to ensure clean shutdown

### 3. **Benefits**
- ✅ Battle-tested library (used by 1M+ projects)
- ✅ Handles edge cases we might have missed
- ✅ Built-in events and monitoring
- ✅ Automatic queue size enforcement
- ✅ Clean shutdown with `onIdle()`

## Breaking Changes

### Stop method is now async

**Before:**
```typescript
buffer.stop();
```

**After:**
```typescript
await buffer.stop();
```

### Files that need updating:

1. **`src/cli/serve.ts`** - Line ~115 (shutdown function)
2. **`src/ingestor/worker.ts`** - Line ~50 (shutdown handler)
3. **`src/cli/worker.ts`** - Line ~45 (shutdown function)

Change:
```typescript
buffer.stop();
```

To:
```typescript
await buffer.stop();
```

## Testing

After installation, verify everything works:

```bash
# Type check
bun x tsc --noEmit

# Run tests
bun test

# Test locally
bun run dev
```

## Configuration

Queue size is still configurable via environment variable:

```bash
BATCH_MAX_QUEUE_SIZE=50  # Default: 50 batches
```

## Rollback

If you need to rollback, the previous custom implementation is in git history.
The commit before p-queue integration can be reverted.
