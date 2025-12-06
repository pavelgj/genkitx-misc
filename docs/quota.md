# Quota Middleware

The Quota middleware allows you to enforce rate limits on your Genkit models.

## Configuration

The `quota` function accepts the following options:

-   `store`: The storage backend instance (`QuotaStore`).
-   `limit`: The maximum number of requests allowed within the window.
-   `windowMs`: The duration of the window in milliseconds.
-   `key`: (Optional) A string or a function to generate a unique key for the quota. Defaults to `'global'`.
-   `logOnly`: (Optional) If `true`, logs a warning when quota is exceeded instead of throwing an error. Defaults to `false`.
-   `failOpen`: (Optional) If `true`, allows the request to proceed if the storage backend fails (e.g., database down). If `false` (default), throws an internal error.

## Per-User Quota

To enforce quotas per user, provide a key generation function that extracts the user ID from the request (e.g., from context or message metadata).

```typescript
quota({
  store: myStore,
  limit: 5,
  windowMs: 60000,
  key: ({ request }) => {
    // Example: Extract user ID from request messages or config
    // Note: Ensure your flow/application passes this data to the model
    return context.auth.userId || 'anon';
  }
})
```

## Storage Backends

### Firestore

Uses Cloud Firestore for distributed, durable rate limiting. Requires `@google-cloud/firestore`.

```typescript
import { FirestoreQuotaStore } from 'genkitx-misc/quota/firestore';
import { Firestore } from '@google-cloud/firestore';

const firestore = new Firestore();
const store = new FirestoreQuotaStore(firestore, 'quotas_collection');
```

### Realtime Database

Uses Firebase Realtime Database for low-latency rate limiting. Requires `firebase-admin`.

```typescript
import { RTDBQuotaStore } from 'genkitx-misc/quota/rtdb';
import * as admin from 'firebase-admin';

const db = admin.database();
const store = new RTDBQuotaStore(db, 'quotas_path');
```

Keys are automatically sanitized to replace invalid characters (e.g., `.`, `/`) with `_`.

### In-Memory

Uses an in-memory map. Useful for testing or single-instance deployments (not shared across instances).

```typescript
import { InMemoryQuotaStore } from 'genkitx-misc/quota/memory';

const store = new InMemoryQuotaStore();
```

## Failure Handling

By default, if the quota store fails (e.g., database connection error), the middleware throws an `INTERNAL` error to prevent bypassing limits during outages (`failClosed`).

To allow traffic during storage outages (prioritizing availability over strict limits), set `failOpen: true`.

```typescript
quota({
  // ...
  failOpen: true
})
```

Note: Unless `logOnly` is `true`, if the store successfully reports that the limit is exceeded, the request will be blocked regardless of `failOpen` setting. `failOpen` only applies to storage errors.

## Custom Quota Store

You can implement your own storage backend by implementing the `QuotaStore` interface.

```typescript
import { QuotaStore } from 'genkitx-misc/quota';

export class MyCustomStore implements QuotaStore {
  async increment(key: string, delta: number, windowMs: number, limit?: number): Promise<number> {
    // Implementation here
  }
}
```

### Requirements

1.  **Atomicity**: The `increment` operation MUST be atomic. It should read the current count, check expiration, increment, and write back in a safe manner (e.g., using database transactions or atomic increment operations) to prevent race conditions.
2.  **Window Management**: The store is responsible for managing the time window logic.
    -   **Fixed Window Strategy** (Interval starts on first request):
        -   If the record does not exist or `expiresAt <= Date.now()` (window expired), reset the count to 0 (or `delta`) and set `expiresAt = Date.now() + windowMs`.
        -   If `expiresAt > Date.now()` (window active), increment the existing count.
        -   This strategy ensures users get the full `windowMs` duration, but the window start time depends on when the first request arrives.
3.  **Optimization (Recommended)**: If the `limit` parameter is provided, check if the current usage (before incrementing) already meets or exceeds the limit.
    -   If `usage >= limit`: **Do not write to the database.** Return the simulated new usage (`usage + delta`) or just the current usage (as long as it is > limit). This prevents unnecessary write costs during attacks or heavy load.
    -   If `usage < limit`: Proceed with increment and write.

### Example Implementation Logic

```typescript
async increment(key, delta, windowMs, limit) {
  return db.transaction(async (tx) => {
    const data = await tx.get(key);
    const now = Date.now();
    
    let usage = 0;
    let expiresAt = now + windowMs;

    if (data && data.expiresAt > now) {
      usage = data.count;
      expiresAt = data.expiresAt;
    } else {
      // Window expired or new, reset
      usage = 0;
      expiresAt = now + windowMs;
    }
    
    // Optimization: Fail fast without write if limit exceeded
    if (limit !== undefined && usage >= limit) {
      return usage + delta;
    }

    usage += delta;
    
    tx.set(key, { count: usage, expiresAt });
    return usage;
  });
}
```
