# Quota Middleware

The Quota middleware allows you to enforce rate limits on your Genkit model calls.

## Installation

```bash
npm install genkitx-misc
```

## Setup

The quota middleware uses the Genkit `generateMiddleware()` API. You register the storage backend as a plugin, then use the middleware per-request with serializable config.

```typescript
import { genkit } from 'genkit';
import { quota } from 'genkitx-misc/quota';
import { InMemoryQuotaStore } from 'genkitx-misc/quota/memory';

const ai = genkit({
  plugins: [
    quota.plugin({ store: new InMemoryQuotaStore() }),
  ],
});
```

## Usage

```typescript
const response = await ai.generate({
  model: 'googleai/gemini-2.5-flash',
  prompt: 'Hello world',
  use: [
    quota({
      limit: 10,
      windowMs: 60000, // 1 minute
    }),
  ],
});
```

## Configuration

### Per-Use Config (serializable)

The `quota()` function accepts the following config options:

- `limit` *(required)*: The maximum number of requests allowed within the window.
- `windowMs` *(required)*: The duration of the quota window in milliseconds.
- `key` *(optional)*: A static string key for the quota. Defaults to `'global'`.
- `keyFn` *(optional)*: Name of a registered key generation function (from plugin options). Takes precedence over the static `key`.
- `logOnly` *(optional)*: If `true`, logs a warning when quota is exceeded instead of throwing an error. Defaults to `false`.
- `failOpen` *(optional)*: If `true`, allows the request to proceed if the storage backend fails. Defaults to `false` (fail-closed).

### Plugin Options (non-serializable)

The `quota.plugin()` function accepts:

- `store` *(required)*: The storage backend instance (`QuotaStore`).
- `keyFns` *(optional)*: A `Record<string, QuotaKeyFn>` mapping names to key generation functions. These can be referenced by name in the per-use `keyFn` config.

## Per-User Quota

To enforce quotas per user, use named key functions:

```typescript
const ai = genkit({
  plugins: [
    quota.plugin({
      store: new InMemoryQuotaStore(),
      keyFns: {
        byUser: ({ request }) => {
          // Extract user ID from request config or metadata
          return request.config?.userId || 'anon';
        },
      },
    }),
  ],
});

// Reference the named key function:
const response = await ai.generate({
  model: 'my-model',
  prompt: 'hello',
  use: [quota({ limit: 5, windowMs: 60000, keyFn: 'byUser' })],
});
```

## Storage Backends

### In-Memory

Uses an in-memory map. Useful for testing or single-instance deployments (not shared across instances).

```typescript
import { InMemoryQuotaStore } from 'genkitx-misc/quota/memory';

const store = new InMemoryQuotaStore();
```

### Firestore

Uses Cloud Firestore for distributed, durable rate limiting. Requires `@google-cloud/firestore`.

```typescript
import { FirestoreQuotaStore } from 'genkitx-misc/quota/firestore';
import { Firestore } from '@google-cloud/firestore';

const firestore = new Firestore();
const store = new FirestoreQuotaStore(firestore, 'quotas');
```

### Realtime Database

Uses Firebase Realtime Database for low-latency rate limiting. Requires `firebase-admin`.

```typescript
import { RTDBQuotaStore } from 'genkitx-misc/quota/rtdb';
import * as admin from 'firebase-admin';

const db = admin.database();
const store = new RTDBQuotaStore(db, 'quotas');
```

Keys are automatically sanitized to replace invalid characters (e.g., `.`, `/`) with `_`.

### PostgreSQL

Uses a PostgreSQL database table for rate limiting. Requires `pg`.

```typescript
import { PostgresQuotaStore } from 'genkitx-misc/quota/postgres';
import { Pool } from 'pg';

const pool = new Pool({ ... });
const store = new PostgresQuotaStore({ pool, tableName: 'my_quotas' });
```

The store automatically creates the table if it doesn't exist (unless `noCreate` is true):

```sql
CREATE TABLE IF NOT EXISTS quotas (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at BIGINT NOT NULL
);
```

### Redis

Uses Redis for high-performance distributed rate limiting. Requires `ioredis`.

```typescript
import { RedisQuotaStore } from 'genkitx-misc/quota/redis';
import Redis from 'ioredis';

const redis = new Redis();
const store = new RedisQuotaStore({ client: redis });
```

## Failure Handling

By default, if the quota store fails (e.g., database connection error), the middleware throws an `INTERNAL` error to prevent bypassing limits during outages (**fail-closed**).

To allow traffic during storage outages (prioritizing availability over strict limits), set `failOpen: true`:

```typescript
quota({
  limit: 10,
  windowMs: 60000,
  failOpen: true,
})
```

> **Note**: `failOpen` only applies to storage errors. If the store successfully reports that the limit is exceeded, the request will be blocked regardless (unless `logOnly` is `true`).

## Custom Quota Store

Implement the `QuotaStore` interface:

```typescript
import { QuotaStore } from 'genkitx-misc/quota';

export class MyCustomStore implements QuotaStore {
  async increment(key: string, delta: number, windowMs: number, limit?: number): Promise<number> {
    // Atomically increment and return the new usage count.
    // Must handle window expiration logic.
  }
}
```

### Requirements

1. **Atomicity**: The `increment` operation MUST be atomic (use transactions or atomic operations).
2. **Window Management**: Use a fixed-window strategy — reset count when the window expires, increment within the active window.
3. **Optimization**: If `limit` is provided and current usage already meets/exceeds it, skip the write and return the current usage. This prevents unnecessary write costs during attacks or heavy load.
