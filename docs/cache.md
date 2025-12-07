# Cache Middleware

The Cache middleware allows you to cache model responses to reduce costs and latency for identical requests.

## Configuration

The `cache` function accepts the following options:

-   `store`: The storage backend instance (`CacheStore`).
-   `ttlMs`: The time-to-live for cached entries in milliseconds.
-   `key`: (Optional) A string or a function to generate a unique cache key from the request. Defaults to a SHA-256 hash of the request content (messages, config, tools, output).

```typescript
import { cache } from 'genkitx-misc/cache';
import { InMemoryCacheStore } from 'genkitx-misc/cache/memory';

const cacheMiddleware = cache({
  store: new InMemoryCacheStore(),
  ttlMs: 60000, // 1 minute
});
```

## Custom Key Generation

By default, the middleware hashes the stable parts of the `GenerateRequest` (messages, config, tools). If you want to customize how the key is generated (e.g., to exclude certain parameters or include user ID), provide a `key` function.

```typescript
cache({
  // ...
  key: ({ request }) => {
    // Example: specific key based on user and prompt
    return `user:${request.config.userId}:${request.messages[0].content[0].text}`;
  }
})
```

## Storage Backends

### Firestore

Uses Cloud Firestore for distributed, persistent caching. Requires `@google-cloud/firestore`.

```typescript
import { FirestoreCacheStore } from 'genkitx-misc/cache/firestore';
import { Firestore } from '@google-cloud/firestore';

const firestore = new Firestore();
const store = new FirestoreCacheStore(firestore, 'cache_collection');
```

**TTL Management**:
The middleware checks the `expiresAt` field lazily upon read. To ensure expired documents are physically deleted from Firestore (saving storage costs), you should configure a **Time-to-live (TTL) policy** in the Google Cloud Console for the collection used (default `'cache'`) on the `expiresAt` field. The middleware sets this field to a timestamp (number, milliseconds since epoch). Note that Firestore TTL expects a Timestamp or Date, but this library currently uses a number. 
*Correction*: Firestore TTL policy requires a `Date/Timestamp` field. The current implementation stores `expiresAt` as a number (milliseconds).
To support native Firestore TTL policies effectively, you might need to handle cleanup yourself or wait for updates. However, the middleware will treat expired entries as a "miss", effectively logically deleting them.

### Redis

Uses Redis for high-performance, in-memory distributed caching. Requires `ioredis`.

```typescript
import { RedisCacheStore } from 'genkitx-misc/cache/redis';
import Redis from 'ioredis';

const redis = new Redis();
const store = new RedisCacheStore({ client: redis });
```

**TTL Management**:
Redis natively supports key expiration. The middleware sets the expiration (using `PX`) when writing the key. Redis will automatically remove expired keys.

### PostgreSQL

Uses a PostgreSQL database table for caching. Requires `pg`.

```typescript
import { PostgresCacheStore } from 'genkitx-misc/cache/postgres';
import { Pool } from 'pg';

const pool = new Pool({ ... });
const store = new PostgresCacheStore({ pool, tableName: 'genkit_cache' });
```

The store will automatically attempt to create the table if it doesn't exist. The schema used is:

```sql
CREATE TABLE IF NOT EXISTS genkit_cache (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at BIGINT NOT NULL
);
```

**TTL Management**:
The middleware lazily deletes expired rows when they are accessed. However, rows that are never accessed again will remain in the database indefinitely.
**Recommendation**: Set up a background job (e.g., using `pg_cron` or an external scheduler) to periodically delete expired rows to reclaim space:
```sql
DELETE FROM genkit_cache WHERE expires_at < (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint;
```
(Note: `expires_at` is stored as milliseconds since epoch).

### In-Memory

Uses an in-memory map. Useful for testing or single-instance deployments.

```typescript
import { InMemoryCacheStore } from 'genkitx-misc/cache/memory';

const store = new InMemoryCacheStore();
```

**TTL Management**:
Lazy expiration on access and periodic background cleanup (default every 60 seconds) to remove expired entries and prevent memory leaks.

## Failure Handling

The cache middleware implements a **fail-open** strategy. If the cache store fails (throws an error during `get` or `set`), the error is logged to `console.error`, and the request proceeds as if it were a cache miss (executing the model). This ensures that cache outages do not disrupt your application's functionality.

## Custom Cache Store

You can implement your own storage backend by implementing the `CacheStore` interface.

```typescript
import { CacheStore } from 'genkitx-misc/cache';

export class MyCustomCache implements CacheStore {
  async get(key: string): Promise<any | null> {
    // Return cached value or null
  }

  async set(key: string, value: any, ttlMs: number): Promise<void> {
    // Store value with expiration
  }
}
```
